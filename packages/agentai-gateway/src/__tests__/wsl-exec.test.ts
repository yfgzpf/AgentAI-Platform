import { describe, it, expect } from 'vitest';
import { EXTRA_HANDLERS, EXTRA_TOOLS } from '../tools.js';
import { TOOL_GROUPS } from '../tool-groups.js';
import { SECURITY_PLAYBOOK, SECURITY_OPS_TOOLS } from '../security-playbook.js';

describe('wsl_exec: 绕开 cmd.exe 的 WSL 执行器 (2026-10-19)', () => {
  it('已声明且可从 EXTRA_HANDLERS 取到', () => {
    expect(EXTRA_TOOLS.some((t: any) => t.name === 'wsl_exec')).toBe(true);
    expect(typeof EXTRA_HANDLERS.wsl_exec).toBe('function');
  });

  it('声明里点名"不要用 run_command 跑 wsl bash -lc" (AI 才知道何时用)', () => {
    const decl = EXTRA_TOOLS.find((t: any) => t.name === 'wsl_exec') as any;
    expect(decl.description).toContain('run_command');
    expect(decl.description).toContain('bash');
    expect(decl.description).toContain('args');
    // 必须说清"发行版没装"时怎么办 (否则 AI 会卡死在那)
    expect(decl.description).toContain('enum_subdomains');
  });

  it('缺 command → 明确报错', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({});
    expect(r.success).toBe(false);
    expect(String(r.output)).toContain('缺 command');
  });

  it('进 security_ops 组 + 偏离检测集 (AI 才拿得到)', () => {
    expect(TOOL_GROUPS.security_ops).toContain('wsl_exec');
    expect(SECURITY_OPS_TOOLS.has('wsl_exec')).toBe(true);
  });

  it('Playbook 点名 wsl_exec 且明写"别用 run_command 跑 wsl bash -lc"', () => {
    expect(SECURITY_PLAYBOOK).toContain('wsl_exec');
    expect(SECURITY_PLAYBOOK).toContain('bash -lc');
    expect(SECURITY_PLAYBOOK).toContain('结构性破坏');
  });
});

describe('run_command: 拦截四层 shell 嵌套 (引号破坏的根治提示)', () => {
  it('wsl + bash -lc + 引号脚本 → 拒绝并给出 wsl_exec 替代方案', async () => {
    const bad = 'wsl -u root -d kali-linux -- bash -lc "export PATH=$PATH:/usr/local/go/bin; go install x@latest | tail -3"';
    const r = await EXTRA_HANDLERS.run_command({ command: bad, timeout_ms: 5000 });
    expect(r.success).toBe(false);
    const out = String(r.output);
    // 必须点破根因
    expect(out).toContain('引号');
    // 必须给出可行动替代 (不是"你自己想办法")
    expect(out).toContain('wsl_exec');
    // 必须禁止原样重试
    expect(out).toContain('别原样重试');
  });

  it('普通命令不受影响 (不能误伤)', async () => {
    const r = await EXTRA_HANDLERS.run_command({ command: 'echo hello', timeout_ms: 8000 });
    expect(r.success).toBe(true);
    expect(String(r.output)).toContain('hello');
  });

  it('不含 wsl 的普通 bash -c 不被误伤 (本机 bash 也常用)', async () => {
    // 形态接近但没有 wsl → 应放行
    const r = await EXTRA_HANDLERS.run_command({ command: 'echo "a b c"', timeout_ms: 8000 });
    expect(r.success).toBe(true);
  });
});
