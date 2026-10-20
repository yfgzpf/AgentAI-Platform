import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPlatformProtectedWritePath } from './message-utils.js';
import { EXTRA_HANDLERS } from './tools.js';
import { isTargetInScope } from './pentest-scope-guard.js';
import { buildLiteSystemPrompt } from './system-prompt-lite.js';
import { SystemDirectiveManager } from './system-directive-manager.js';

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');
const handlers: any = EXTRA_HANDLERS;

/**
 * 第三轮修复验收 (2026-10-20 G1-G4)
 * 侦察实锤 → 修复 → 本文件逐条钉死行为。
 */

// ═══════════════ G2: 授权生效文件写保护 (scope.json 自我授权实锤链) ═══════════════

describe('isPlatformProtectedWritePath — 谓词精确性 (误伤零容忍)', () => {
  const T = (p: string) => expect(isPlatformProtectedWritePath(p), `应拦截: ${p}`).toBe(true);
  const F = (p: string) => expect(isPlatformProtectedWritePath(p), `应放行: ${p}`).toBe(false);

  it('授权生效文件 (.agentai/scope.json) — 含 Windows 反斜杠形态', () => {
    T('F:/ws/.agentai/scope.json');
    T('/home/u/project/.agentai/scope.json');
    T('F:\\ws\\.agentai\\scope.json');
  });

  it('AI 提案通道 (scope-pending.json) 与备份文件不拦 — 提案机制必须畅通', () => {
    F('F:/ws/.agentai/scope-pending.json');
    F('F:/ws/.agentai/backups/scope.json.1699.bak');
    F('F:/ws/.agentai/backups/index.ts.1699.bak');
    F('F:/ws/.agentai/myscope.json');
  });

  it('凭证文件: .env 家族 (.env.example 模板除外) + 凭证目录', () => {
    T('F:/ws/.env');
    T('F:/ws/.env.local');
    T('F:/ws/.env.production');
    F('F:/ws/.env.example'); // 模板文件, 项目常需 AI 写
    T('/home/u/.ssh/authorized_keys');
    T('/home/u/.aws/credentials');
    T('F:/ws/config/.npmrc');
    T('/home/u/.config/gh/hosts.yml');
  });

  it('日常 workspace 文件零误伤 (任务丝滑性回归)', () => {
    F('F:/ws/notes.txt');
    F('F:/ws/src/index.ts');
    F('F:/ws/package.json');
    F('F:/ws/.agentai/config.json');
    F('F:/ws/docs/readme.md');
    F('');
    F(undefined as any);
  });
});

describe('G2: write_file 自我授权链被斩断 (复刻 10-20 实锤)', () => {
  it('直写生效格式 scope.json → 拒绝, 且授权状态不变', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'g2-scope-'));
    mkdirSync(join(ws, '.agentai'), { recursive: true });
    writeFileSync(join(ws, '.agentai', 'scope.json'),
      JSON.stringify({ targets: [{ host: 'authorized.com', source: 'user', mode: 'full' }] }));
    expect(isTargetInScope(ws, 'evil.com')).toBe(false); // 攻击前: 拒绝

    const w = await handlers.write_file({
      file_path: '.agentai/scope.json',
      content: JSON.stringify({ targets: [{ host: 'evil.com', source: 'attacker', mode: 'full' }] }),
    }, { workspace: ws });
    expect(w.success).toBe(false);
    expect(String(w.output)).toMatch(/安全拒绝/);
    expect(String(w.output)).toMatch(/grant_scope/); // 指引走合法提案通道
    expect(isTargetInScope(ws, 'evil.com')).toBe(false); // 攻击后: 仍拒绝 (文件未被篡改)
  }, 15000);

  it('scope-pending.json 提案写入畅通 (设计内的 AI 合法路径)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'g2-pending-'));
    mkdirSync(join(ws, '.agentai'), { recursive: true });
    const w = await handlers.write_file({
      file_path: '.agentai/scope-pending.json',
      content: JSON.stringify({ targets: [{ host: 'proposed.com', source: 'ai', mode: 'full' }] }),
    }, { workspace: ws });
    expect(w.success).toBe(true);
  }, 15000);

  it('日常文件写入不受影响 (notes.txt / .env.example / backups)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'g2-daily-'));
    mkdirSync(join(ws, '.agentai', 'backups'), { recursive: true });
    expect((await handlers.write_file({ file_path: 'notes.txt', content: 'hi' }, { workspace: ws })).success).toBe(true);
    expect((await handlers.write_file({ file_path: '.env.example', content: 'X=1' }, { workspace: ws })).success).toBe(true);
    expect((await handlers.write_file({ file_path: '.agentai/backups/x.bak', content: 'old' }, { workspace: ws })).success).toBe(true);
  }, 15000);
});

describe('G2/G3: 防线落点契约 (源码钉死, 防回归)', () => {
  const loopSrc = src('./agentai-loop.ts');
  const toolsSrc = src('./tools.ts');

  it('sandboxGuard: 平台级写保护先于沙箱开关判定 (压过用户自定义规则)', () => {
    expect(toolsSrc).toMatch(/op === 'write' \|\| op === 'delete'\) && isPlatformProtectedWritePath\(p\)/);
  });

  it('auto 分支: 平台保护路径不被"auto 信任"覆盖 (命中即拒)', () => {
    expect(loopSrc).toMatch(/mode === 'auto'[\s\S]{0,700}isPlatformProtectedWritePath\(filePath\)/);
    // 拒绝结果显式 success:false (D1 口径: 拒绝也是执行结果)
    expect(loopSrc).toMatch(/auto 模式下不可写入平台保护路径/);
  });

  it('_isSafeFileModification: 平台保护路径不走免审批快路 (审批层同步)', () => {
    expect(loopSrc).toMatch(/private _isSafeFileModification[\s\S]{0,400}isPlatformProtectedWritePath\(filePath\)/);
  });
});

// ═══════════════ G3: sandboxGuard 凭证黑名单行为 (经 handler 端到端) ═══════════════

describe('G3: 凭证路径经 write_file handler 端到端拒绝', () => {
  it('.env 直写被拒 (默认配置沙箱未启用时原本零防护)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'g3-env-'));
    const w = await handlers.write_file({ file_path: '.env', content: 'SECRET=x' }, { workspace: ws });
    expect(w.success).toBe(false);
    expect(String(w.output)).toMatch(/安全拒绝/);
  }, 15000);

  it('.ssh/authorized_keys 新建被拒 (原"不存在=免审批"链的入口)', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'g3-ssh-'));
    mkdirSync(join(ws, '.ssh'), { recursive: true });
    const w = await handlers.write_file({ file_path: '.ssh/authorized_keys', content: 'ssh-rsa AAAA' }, { workspace: ws });
    expect(w.success).toBe(false);
    expect(String(w.output)).toMatch(/安全拒绝/);
  }, 15000);
});

// ═══════════════ G4: resume 指令优先级 (medium/low 死第 10 处) ═══════════════

describe('G4: resume 指令 low → high', () => {
  it('loop 中 resume 入队优先级为 high (flushAll 只放行 critical+high)', () => {
    const m = src('./agentai-loop.ts').match(/directives\.add\('resume'[\s\S]*?'(critical|high|medium|low)'\)/);
    expect(m, '未找到 resume 入队调用').toBeTruthy();
    expect(m![1]).toBe('high');
  });

  it('行为: high 入队的 resume 能被 flushAll 放出 (机制前提回归)', () => {
    const mgr = new SystemDirectiveManager();
    mgr.add('resume', 'RESUME-CONTENT-xyz', 'high');
    mgr.add('task_progress', 'PROGRESS-abc', 'high');
    const out = mgr.flushAll();
    expect(out.join('\n')).toContain('RESUME-CONTENT-xyz');
  });

  it('行为: 对照 — low 入队会被 flushAll 静默丢弃 (证明原 bug 形态)', () => {
    const mgr = new SystemDirectiveManager();
    mgr.add('resume', 'SHOULD-NOT-APPEAR', 'low' as any);
    expect(mgr.flushAll()).not.toContain('SHOULD-NOT-APPEAR');
  });
});

// ═══════════════ G1: untrusted content framing (双版本 + delimiter) ═══════════════

describe('G1: 外部内容纪律注入', () => {
  it('full 版 system prompt 含 <untrusted-content> 段', () => {
    const s = src('./system-prompt.ts');
    expect(s).toContain('<untrusted-content');
    expect(s).toContain('外部内容纪律');
    expect(s).toContain('指令源只有两个');
  });

  it('lite 版 (autonomous 强模型) 同步覆盖 — 强模型恰是 auto+子代理注入链主力', () => {
    const lite = buildLiteSystemPrompt({});
    expect(lite).toContain('外部内容纪律');
    expect(lite).toContain('指令源只有两个');
    expect(lite).toContain('一律不执行');
  });

  it('子代理回注带 UNTRUSTED delimiter (数据边界显式圈出)', () => {
    const s = src('./agentai-loop.ts');
    expect(s).toContain('<<<UNTRUSTED subagent-output>>>');
    expect(s).toContain('<<<END UNTRUSTED>>>');
    expect(s).toMatch(/子代理产出的\*\*数据\*\*/);
  });
});
