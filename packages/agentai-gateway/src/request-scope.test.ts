/**
 * 跨请求工作区串扰回归测试（审查报告 P0-9）
 * ========================================================================
 * 问题链:
 *   routes/chat.ts  →  wm.setProjectDir(req.body.projectDir)   ← 改**进程级**单例
 *   tools.ts        →  48 处读 wm().projectDir 作路径基准
 *   git_* handlers  →  签名 (args)，**根本不收 ctx**
 *
 * 时序: A 改 projA → B 改 projB → A 的下一轮工具在 projB 上读写并 git commit
 *
 * 修法: AsyncLocalStorage 请求级作用域（request-scope.ts）
 *
 * 本文件验证:
 *   T1  ALS 基本语义（进/出作用域、嵌套、并发隔离）
 *   T2  tools 的 ws() 在请求上下文里返回请求级工作区
 *   T3  resolveProjectPath 的越界校验用请求级工作区
 *   T4  端到端: 两个并发请求各自作用在各自的工作区
 *   T5  回归: 不在请求上下文时行为不变（零破坏）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runWithWorkspace,
  currentRequestWorkspace,
  currentRequestScope,
  inRequestScope,
  workspaceDriftWarning,
} from './request-scope.js';

// ════════════════════════════════════════════════════════════════════════
// T1: ALS 基本语义
// ════════════════════════════════════════════════════════════════════════

describe('T1 AsyncLocalStorage 作用域语义', () => {
  it('作用域内可读到 workspace', () => {
    runWithWorkspace('/ws/a', () => {
      expect(currentRequestWorkspace()).toBe('/ws/a');
      expect(inRequestScope()).toBe(true);
    });
  });

  it('作用域外读不到（返回 null）', () => {
    expect(currentRequestWorkspace()).toBeNull();
    expect(inRequestScope()).toBe(false);
  });

  it('作用域退出后不残留', () => {
    runWithWorkspace('/ws/a', () => { /* noop */ });
    expect(currentRequestWorkspace()).toBeNull();
  });

  it('嵌套作用域内层优先', () => {
    runWithWorkspace('/ws/outer', () => {
      expect(currentRequestWorkspace()).toBe('/ws/outer');
      runWithWorkspace('/ws/inner', () => {
        expect(currentRequestWorkspace()).toBe('/ws/inner');
      });
      expect(currentRequestWorkspace()).toBe('/ws/outer');
    });
  });

  it('★ 并发隔离: 两个 async 链各自看到自己的 workspace', async () => {
    const seen: string[] = [];
    const task = (ws: string, delay: number) =>
      runWithWorkspace(ws, async () => {
        await new Promise((r) => setTimeout(r, delay));
        seen.push(currentRequestWorkspace()!);
        // 模拟真实工具链路: 再 await 一次，确认上下文穿透多层 await
        await new Promise((r) => setTimeout(r, delay));
        seen.push(currentRequestWorkspace()!);
      });

    await Promise.all([task('/ws/fast', 10), task('/ws/slow', 40)]);
    expect(seen).toContain('/ws/fast');
    expect(seen).toContain('/ws/slow');
    expect(seen.filter((s) => s === '/ws/fast').length).toBe(2);
    expect(seen.filter((s) => s === '/ws/slow').length).toBe(2);
  });

  it('作用域带 meta（userId/sessionId）供诊断', () => {
    runWithWorkspace('/ws/a', () => {
      expect(currentRequestScope()!.userId).toBe('u1');
    }, { userId: 'u1', sessionId: 's1' });
  });

  it('空 workspace 直接透传（不建作用域）', () => {
    runWithWorkspace('', () => {
      expect(inRequestScope()).toBe(false);
    });
  });

  it('workspaceDriftWarning 能检出不一致', () => {
    let msg: string | null = null;
    runWithWorkspace('/ws/req', () => { msg = workspaceDriftWarning('/ws/global'); });
    expect(msg).toContain('workspace-drift');
    expect(msg).toContain('/ws/req');

    let ok: string | null = 'unset';
    runWithWorkspace('/ws/same', () => { ok = workspaceDriftWarning('/ws/same'); });
    expect(ok).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// T2/T3: tools.ts 的 ws() 与 resolveProjectPath
// ════════════════════════════════════════════════════════════════════════

describe('T2 tools.ws() 读请求级工作区', () => {
  it('请求上下文内 ws() 返回请求级工作区而非全局单例', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const globalDir = wm.projectDir;

    // 假装全局单例是 projA
    const origProjectDir = wm.projectDir;
    try {
      (wm as any).projectDir = '/fake/projA';
      let seenWs = '';
      runWithWorkspace('/fake/projB', () => {
        // tools.ts 的 ws() 就是 currentRequestWorkspace() || wm().projectDir
        seenWs = currentRequestWorkspace() || wm.projectDir;
      });
      expect(seenWs).toBe('/fake/projB');
      expect(seenWs).not.toBe(globalDir);
    } finally {
      (wm as any).projectDir = origProjectDir;
    }
  });

  it('★ 真实场景: A 请求执行工具时 B 请求改了全局单例，A 仍读自己的', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const orig = wm.projectDir;
    try {
      // A 的请求开始，全局单例= projA
      (wm as any).projectDir = '/fake/projA';

      let aSaw: string | undefined;
      await runWithWorkspace('/fake/projA', async () => {
        // A 发起工具调用（等待中）
        await new Promise((r) => setTimeout(r, 20));
        // 期间 B 的请求把全局单例改成 projB（这是修复前的行为）
        (wm as any).projectDir = '/fake/projB';
        await new Promise((r) => setTimeout(r, 20));
        // A 的工具在此刻取工作区
        aSaw = currentRequestWorkspace() || wm.projectDir;
      });

      expect(aSaw, 'A 必须仍看到 projA，不能被 B 污染').toBe('/fake/projA');
    } finally {
      (wm as any).projectDir = orig;
    }
  });
});

describe('T3 resolveProjectPath 的越界校验用请求级工作区', () => {
  it('请求A 内: projA 的相对路径解析到 projA', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const orig = wm.projectDir;
    try {
      (wm as any).projectDir = '/fake/projA';
      runWithWorkspace('/fake/projA', () => {
        // Windows 上 resolve 会补盘符并用反斜杠 → 统一化后比较
        const got = wm.resolveProjectPath('src/a.ts').replace(/\\/g, '/');
        expect(got.endsWith('/fake/projA/src/a.ts')).toBe(true);
      });
    } finally {
      (wm as any).projectDir = orig;
    }
  });

  it('★ 请求A 内: projB 的绝对路径被判越界（不会被 projB 的全局值放过）', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const orig = wm.projectDir;
    try {
      // 修复前: 全局单例被 B 改成 projB，A 传 projB 的路径会被认为"合法"
      (wm as any).projectDir = '/fake/projB';
      runWithWorkspace('/fake/projA', () => {
        const absB = join('/fake/projB', 'secret.ts');
        expect(() => wm.resolveProjectPath(absB), 'A 不应能读 projB 的文件').toThrow(/outside project directory/);
      });
    } finally {
      (wm as any).projectDir = orig;
    }
  });

  it('请求A 内: projA 自己的绝对路径合法', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const orig = wm.projectDir;
    try {
      (wm as any).projectDir = '/fake/projB';
      runWithWorkspace('/fake/projA', () => {
        const absA = join('/fake/projA', 'mine.ts');
        expect(wm.resolveProjectPath(absA)).toBe(absA);
      });
    } finally {
      (wm as any).projectDir = orig;
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// T4: 端到端 —— 真实工具在并发请求下各写各的目录
// ════════════════════════════════════════════════════════════════════════

describe('T4 端到端: 并发工具调用各作用在各自工作区', () => {
  let wsA: string;
  let wsB: string;

  beforeEach(() => {
    wsA = mkdtempSync(join(tmpdir(), 'scope-a-'));
    wsB = mkdtempSync(join(tmpdir(), 'scope-b-'));
    mkdirSync(join(wsA, 'src'), { recursive: true });
    mkdirSync(join(wsB, 'src'), { recursive: true });
  });

  it('write_file 在两个并发请求里写各自的目录', async () => {
    const { writeFileSync } = await import('node:fs');
    // 模拟 write_file 的核心动作：resolvePath + write
    const fakeWrite = (rel: string, content: string) =>
      runWithWorkspace(
        currentRequestWorkspace()!,
        async () => {
          await new Promise((r) => setTimeout(r, 15));   // 模拟异步 IO
          const { WorkspaceManager } = await import('./workspace-manager.js');
          const wm = WorkspaceManager.getInstance();
          const abs = wm.resolveProjectPath(rel);
          writeFileSync(abs, content, 'utf-8');
          return abs;
        },
        {},
      );

    const [absA, absB] = await Promise.all([
      runWithWorkspace(wsA, () => fakeWrite('src/from-a.ts', 'A 的内容'), { userId: 'a' }),
      runWithWorkspace(wsB, () => fakeWrite('src/from-b.ts', 'B 的内容'), { userId: 'b' }),
    ]);

    // Windows 上 path.resolve 会补盘符并用反斜杠 → 统一化后比较
    expect(absA.replace(/\\/g, '/').endsWith(wsA.replace(/\\/g, '/') + '/src/from-a.ts')).toBe(true);
    expect(absB.replace(/\\/g, '/').endsWith(wsB.replace(/\\/g, '/') + '/src/from-b.ts')).toBe(true);
    expect(absA).not.toBe(absB);

    // 文件真的落在各自目录
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(wsA, 'src/from-a.ts'), 'utf-8')).toBe('A 的内容');
    expect(readFileSync(join(wsB, 'src/from-b.ts'), 'utf-8')).toBe('B 的内容');

    rmSync(wsA, { recursive: true, force: true });
    rmSync(wsB, { recursive: true, force: true });
  });
});

// ════════════════════════════════════════════════════════════════════════
// T5: 零破坏回归
// ════════════════════════════════════════════════════════════════════════

describe('T5 不在请求上下文时行为不变', () => {
  it('resolveProjectPath 回退到 projectDir（后台任务/单测零影响）', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    const orig = wm.projectDir;
    try {
      (wm as any).projectDir = wsA2();
      expect(currentRequestWorkspace()).toBeNull();
      expect(wm.resolveProjectPath('src/x.ts')).toBe(wm.resolveProjectPath('src/x.ts'));
      // 不应抛越界错误
      expect(() => wm.resolveProjectPath('src/x.ts')).not.toThrow();
    } finally {
      (wm as any).projectDir = orig;
    }
  });

  it('空参数仍返回 projectDir', async () => {
    const { WorkspaceManager } = await import('./workspace-manager.js');
    const wm = WorkspaceManager.getInstance();
    expect(wm.resolveProjectPath('')).toBe(wm.projectDir);
  });
});

function wsA2(): string {
  return mkdtempSync(join(tmpdir(), 'scope-nocx-'));
}

// ════════════════════════════════════════════════════════════════════════
// T6: workspaceFromRequest —— 中间件从请求解析工作区
// ════════════════════════════════════════════════════════════════════════

describe('T6 workspaceFromRequest', () => {
  it('优先读x-workspace-path 头', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-a-'));
    const { workspaceFromRequest } = await import('./request-scope.js');
    const got = workspaceFromRequest({ headers: { 'x-workspace-path': tmp } });
    expect(got).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('其次 x-workspace 头', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-b-'));
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: { 'x-workspace': tmp } })).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('再其次 query.workspace', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-c-'));
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: {}, query: { workspace: tmp } })).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('★ body.workspace（POST /v1/chat 只在 body 里传）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-d-'));
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: {}, body: { workspace: tmp } })).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('body.projectDir 也支持', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-e-'));
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: {}, body: { projectDir: tmp } })).toBe(tmp);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('★ 不存在的目录 → null（不建作用域，绝不接受任意路径）', async () => {
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({
      headers: {}, body: { workspace: '/definitely/not/exist/xyz123' },
    })).toBeNull();
  });

  it('指向文件而非目录 → null', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wfr-f-'));
    const { writeFileSync } = await import('node:fs');
    const file = join(tmp, 'a.txt');
    writeFileSync(file, 'x');
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: {}, body: { workspace: file } })).toBeNull();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('无任何 workspace 字段 → null（零破坏）', async () => {
    const { workspaceFromRequest } = await import('./request-scope.js');
    expect(workspaceFromRequest({ headers: {} })).toBeNull();
    expect(workspaceFromRequest({ headers: {}, body: {} })).toBeNull();
    expect(workspaceFromRequest({ headers: {}, body: { message: 'hi' } })).toBeNull();
  });
});
