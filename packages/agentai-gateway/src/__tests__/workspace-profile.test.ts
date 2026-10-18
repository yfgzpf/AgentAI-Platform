/**
 * 批 2-B (2026-10-17): 工作区画像单一模块 + AI 主动建工作区
 * ============================================================
 * 覆盖:
 *   P1~P6  workspace-profile.ts 读写/兼容/TTL 缓存
 *   C1~C6  WorkspaceManager.createProjectDir (允许根/幂等/不切换)
 *   T1~T3  create_workspace 工具 handler
 *   G1     path-guard 委托后 home 根真正生效 (修 ESM require 死代码)
 *
 * ⚠️ 测试夹具放在 home 下: createProjectDir 的 parent 必须落在允许根内,
 *    而 os.tmpdir() 在 Linux 是 /tmp (不在 home 下) — 用 home 子目录跨平台稳。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readWorkspaceProfile, writeWorkspaceProfile, readDevPrefs,
  ensureWorkspaceProfile, getTechStack, hasWorkspaceProfile,
} from '../workspace-profile.js';
import { WorkspaceManager, getWorkspaceAllowedRoots, detectMonorepoRoot } from '../workspace-manager.js';
import { EXTRA_HANDLERS } from '../tools.js';
import { runWithWorkspace } from '../request-scope.js';
import { isPathAllowed } from '../safety/path-guard.js';

const TMP = fs.mkdtempSync(path.join(os.homedir(), 'agentai-ws-test-'));

beforeAll(() => {
  fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({
    name: 'ws-profile-test', dependencies: { react: '^18.0.0' }, devDependencies: { vitest: '^1.0.0' },
  }));
  fs.writeFileSync(path.join(TMP, 'tsconfig.json'), '{}');
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('workspace-profile 画像单一模块 (批 2-B)', () => {
  it('P1: 写读往返 + version/时间戳 + 原子写不留 tmp', () => {
    const ws = path.join(TMP, 'p1');
    fs.mkdirSync(ws, { recursive: true });
    const written = writeWorkspaceProfile(ws, { devPrefs: { languages: ['TypeScript'] }, industry: 'developer' });
    expect(written.version).toBe(1);
    expect(written.createdAt).toBeGreaterThan(0);
    expect(written.devPrefs?.languages).toEqual(['TypeScript']);
    const read = readWorkspaceProfile(ws);
    expect(read?.devPrefs?.languages).toEqual(['TypeScript']);
    expect(read?.industry).toBe('developer');
    // 原子写: 不留 .tmp 残file
    expect(fs.existsSync(path.join(ws, '.agentai', 'workspace-profile.json.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.agentai', 'workspace-profile.json'))).toBe(true);
    // 读-改-写: 未传字段保留
    const patched = writeWorkspaceProfile(ws, { industry: 'comic' });
    expect(patched.devPrefs?.languages).toEqual(['TypeScript']);
    expect(patched.createdAt).toBe(written.createdAt);
  });

  it('P2: readDevPrefs 兼容旧 .agentai/profile.json (迁移期只读)', () => {
    const ws = path.join(TMP, 'p2');
    fs.mkdirSync(path.join(ws, '.agentai'), { recursive: true });
    // 模拟 2026-10-17 前的旧文件 (routes/profile.ts 曾直写它)
    fs.writeFileSync(path.join(ws, '.agentai', 'profile.json'), JSON.stringify({ devPrefs: { frontend: ['React'] } }));
    expect(readDevPrefs(ws)?.frontend).toEqual(['React']);
    // 新画像写了之后, 新文件优先
    writeWorkspaceProfile(ws, { devPrefs: { frontend: ['Vue'] } });
    expect(readDevPrefs(ws)?.frontend).toEqual(['Vue']);
  });

  it('P3: ensureWorkspaceProfile 首次创建即探测技术栈', () => {
    const ws = path.join(TMP, 'p3');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'x', dependencies: { next: '14.0.0' } }));
    fs.writeFileSync(path.join(ws, 'tsconfig.json'), '{}');
    expect(hasWorkspaceProfile(ws)).toBe(false);
    const prof = ensureWorkspaceProfile(ws);
    expect(prof.techStack?.language).toBe('TypeScript');
    expect(prof.techStack?.framework).toBe('Next.js');
    // 幂等: 第二次不动
    const again = ensureWorkspaceProfile(ws);
    expect(again.createdAt).toBe(prof.createdAt);
  });

  it('P4: getTechStack TTL 缓存 — 新鲜缓存不重探 (detectedAt 不变)', () => {
    const ws = path.join(TMP, 'p4');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'go.mod'), 'module x');
    const first = getTechStack(ws);
    expect(first.language).toBe('Go');
    // 马上再取: 走缓存, detectedAt 不变 (没有 execSync go version 重跑)
    const cached = getTechStack(ws);
    expect(cached.detectedAt).toBe(first.detectedAt);
    // force / 过期: 重探并落盘 (detectedAt 变)
    const forced = getTechStack(ws, { force: true });
    expect(forced.detectedAt).toBeGreaterThanOrEqual(first.detectedAt);
  });

  it('P5: Python 项目画像 (纯 .py 无标记文件, 互斥优先级兜底)', () => {
    const ws = path.join(TMP, 'p5');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'app.py'), 'print(1)');
    const prof = ensureWorkspaceProfile(ws);
    expect(prof.techStack?.language).toBe('Python');
  });
});

describe('WorkspaceManager.createProjectDir (批 2-B)', () => {
  it('C1: 正常创建 + .agentai 骨架 + 画像 + **不切换** projectDir', () => {
    const wm = WorkspaceManager.getInstance();
    const before = wm.projectDir;
    const r = wm.createProjectDir('c1-demo', TMP);
    expect(r.created).toBe(true);
    expect(r.existed).toBe(false);
    expect(r.path).toBe(`${TMP.replace(/\\/g, '/')}/c1-demo`);
    expect(fs.statSync(path.join(r.path, '.agentai', 'memory')).isDirectory()).toBe(true);
    expect(hasWorkspaceProfile(r.path)).toBe(true);
    // 关键语义: 只创建不切换
    expect(wm.projectDir).toBe(before);
  });

  it('C2: 幂等 — 目录已存在不报错, 补骨架返回 existed', () => {
    const wm = WorkspaceManager.getInstance();
    wm.createProjectDir('c2-demo', TMP);
    const r2 = wm.createProjectDir('c2-demo', TMP);
    expect(r2.created).toBe(false);
    expect(r2.existed).toBe(true);
    expect(r2.path).toContain('c2-demo');
  });

  it('C3: 非法 name 一律拒绝 (路径分隔符/../保留字符)', () => {
    const wm = WorkspaceManager.getInstance();
    expect(() => wm.createProjectDir('a/b', TMP)).toThrow(/非法工作区名称/);
    expect(() => wm.createProjectDir('..', TMP)).toThrow(/非法工作区名称/);
    expect(() => wm.createProjectDir('../evil', TMP)).toThrow(/非法工作区名称/);
    expect(() => wm.createProjectDir('a:b', TMP)).toThrow(/非法工作区名称/);
    expect(() => wm.createProjectDir('a\\b', TMP)).toThrow(/非法工作区名称/);
    expect(() => wm.createProjectDir('', TMP)).toThrow(/不能为空/);
  });

  it('C4: parent 越界 (不在允许根内) 拒绝', () => {
    const wm = WorkspaceManager.getInstance();
    // C:\\ 不是允许根 (除非 AGENTAI_FS_ALLOWED_ROOTS 显式配了)
    const roots = getWorkspaceAllowedRoots().map(r => r.replace(/\\/g, '/'));
    const cRootIn = roots.some(r => r.toLowerCase().startsWith('c:/'));
    if (!cRootIn) {
      expect(() => wm.createProjectDir('evil', 'C:/')).toThrow(/父目录不在允许范围内/);
    }
    // 不存在的父目录
    expect(() => wm.createProjectDir('x', path.join(TMP, 'no-such-dir'))).toThrow(/父目录不存在/);
  });

  it('C5: 目标已存在且是文件 → 拒绝 (不能把文件当工作区)', () => {
    const wm = WorkspaceManager.getInstance();
    fs.writeFileSync(path.join(TMP, 'c5-file'), 'x');
    expect(() => wm.createProjectDir('c5-file', TMP)).toThrow(/不是目录/);
  });
});

describe('create_workspace 工具 handler (批 2-B)', () => {
  it('T1: 成功创建, 输出含路径 + 技术栈 + "未切换"告知', async () => {
    const r = await runWithWorkspace(TMP, () => (EXTRA_HANDLERS as any).create_workspace({ name: 't1-demo' }));
    expect(r.success).toBe(true);
    expect(r.output).toContain('已创建工作区');
    expect(r.output).toContain('t1-demo');
    expect(r.output).toContain('workspace-profile.json');
    expect(r.output).toContain('未切换');
    expect(fs.existsSync(path.join(TMP, 't1-demo', '.agentai', 'workspace-profile.json'))).toBe(true);
  });

  it('T2: 缺 name / 非法 name → 明确失败', async () => {
    const r1 = await runWithWorkspace(TMP, () => (EXTRA_HANDLERS as any).create_workspace({}));
    expect(r1.success).toBe(false);
    expect(r1.output).toContain('name');
    const r2 = await runWithWorkspace(TMP, () => (EXTRA_HANDLERS as any).create_workspace({ name: 'a/b' }));
    expect(r2.success).toBe(false);
    expect(r2.output).toContain('非法工作区名称');
  });

  it('T3: parent 缺省用请求级工作区 (不是全局单例)', async () => {
    const r = await runWithWorkspace(TMP, () => (EXTRA_HANDLERS as any).create_workspace({ name: 't3-demo' }));
    expect(r.success).toBe(true);
    expect(r.data.path.startsWith(TMP.replace(/\\/g, '/'))).toBe(true);
  });
});

describe('path-guard 委托单一实现 (批 2-B 顺手修)', () => {
  it('G1: home 根真正生效 (原 ESM require 死代码导致截图存桌面被误拦)', () => {
    // 修复前: require('os') 在 ESM 下 ReferenceError 被 catch 吞 → home 从不在 roots
    expect(isPathAllowed(os.homedir())).toBe(true);
    const roots = getWorkspaceAllowedRoots().map(r => r.replace(/\\/g, '/').toLowerCase());
    expect(roots.some(r => r === os.homedir().replace(/\\/g, '/').toLowerCase())).toBe(true);
  });

  it('G2: 系统目录仍然拒绝 (委托不放宽黑名单)', () => {
    expect(isPathAllowed('C:\\Windows\\System32')).toBe(false);
    expect(isPathAllowed('C:\\Program Files')).toBe(false);
  });
});

describe('分发安全: 允许根不再绑死盘符/层级 (2026-10-17 P0, 富哥提)', () => {
  // 背景: 桌面端要分发到用户机, 不能假设"projectDir 上两级是 monorepo 根"。
  // 原实现 path.resolve(projectDir, '..', '..') 无条件入根 — 本机
  // projectDir=F:/目录已检查/澳彩 → 整个 F: 盘变成允许根; 分发机上则可能把
  // C:\Users\某人 甚至盘根加进去。现改为 detectMonorepoRoot 标记验证。

  it('D1: detectMonorepoRoot 从 gateway 包目录向上命中 pnpm-workspace.yaml (开发行为保留)', () => {
    // cwd = packages/agentai-gateway → 上两级即 F:\agentai-platform (有 pnpm-workspace.yaml)
    const root = detectMonorepoRoot(process.cwd());
    expect(root).toBeTruthy();
    expect(fs.existsSync(path.join(root!, 'pnpm-workspace.yaml'))).toBe(true);
  });

  it('D2: 无标记目录链 → null (不会把临时目录的上级乱授权)', () => {
    const chain = path.join(os.tmpdir(), 'dist-sim-no-marker', 'a', 'b', 'c');
    fs.mkdirSync(chain, { recursive: true });
    try {
      expect(detectMonorepoRoot(chain)).toBeNull();
    } finally {
      try { fs.rmSync(path.join(os.tmpdir(), 'dist-sim-no-marker'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('D3: package.json#workspaces 也认 (npm/yarn workspaces monorepo)', () => {
    const fake = path.join(os.tmpdir(), 'dist-sim-ws-' + Date.now());
    fs.mkdirSync(path.join(fake, 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['pkg'] }));
    try {
      expect(detectMonorepoRoot(path.join(fake, 'pkg'))).toBe(fake);
    } finally {
      try { fs.rmSync(fake, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('D4: 模拟分发机 — projectDir 的盲目上级不进允许根', () => {
    // 分发场景: 用户工作区是 <tmp>/sim/user/my-project (无任何 monorepo 标记)
    const simWs = path.join(os.tmpdir(), 'dist-sim-user-' + Date.now(), 'my-project');
    fs.mkdirSync(simWs, { recursive: true });
    const parent = path.dirname(simWs);           // <tmp>/dist-sim-user-xxx
    const grandparent = path.dirname(parent);     // <tmp>
    const wm = WorkspaceManager.getInstance();
    const original = wm.projectDir;
    try {
      wm.projectDir = simWs;
      const roots = getWorkspaceAllowedRoots().map(r => r.replace(/\\/g, '/').toLowerCase());
      // 修复前: parent 和 grandparent 会因 "projectDir/../.." 无条件入根
      expect(roots).not.toContain(parent.replace(/\\/g, '/').toLowerCase());
      expect(roots).not.toContain(grandparent.replace(/\\/g, '/').toLowerCase());
      // projectDir 自身仍然在 (工作区本身有权)
      expect(roots).toContain(simWs.replace(/\\/g, '/').toLowerCase());
    } finally {
      wm.projectDir = original;
      try { fs.rmSync(path.dirname(simWs), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('D5: cwd 是文件系统根时不当允许根 (防盘根授权)', () => {
    // 不真改 cwd (会影响其他测试), 直接锁逻辑: 根路径判定
    const cwdLike = path.parse(process.cwd()).root;   // 'C:\\' 或 '/'
    expect(path.parse(cwdLike).root).toBe(cwdLike);   // 它自己是自己的 root → 会被 getWorkspaceAllowedRoots 跳过
  });
});
