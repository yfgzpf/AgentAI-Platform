/**
 * 渗透测试安全闸门 + 赏金漏洞落盘 (HexStrike 文章 P0/P2) — 回归测试 (2026-10-14)
 * ============================================================================
 * 文章灵魂 = "任何扫描前先 check_scope + rate_limit, 越界拒绝"。
 * 三层:
 *   契约: tools.ts 有 scope_guard + report_vulnerability 声明; subagent.ts pentest
 *         工具集含这两个 + prompt 有硬约束 (先 check_scope / 禁 DoS / 越界拒绝);
 *         mcp/config.ts 有 hexstrike 外部条目 (默认 disabled)。
 *   行为: scope_guard check_scope 越界 → in_scope:false; rate_limit 返回 ok;
 *         report_vulnerability 落盘 .agentai/vulns/。
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(nodePath.join(ROOT, rel), 'utf-8');
const toolsSrc = src('packages/agentai-gateway/src/tools.ts');
const subagentSrc = src('packages/agentai-gateway/src/subagent.ts');
const mcpConfigSrc = src('packages/agentai-gateway/src/mcp/config.ts');

function codeOnly(s: string): string {
  const NL = String.fromCharCode(10);
  return s.split(NL).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(NL);
}
const toolsCode = codeOnly(toolsSrc);
const subagentCode = codeOnly(subagentSrc);

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: scope_guard + report_vulnerability + hexstrike 接线', () => {
  it('tools.ts 有 scope_guard 声明 (check_scope + rate_limit 两 action)', () => {
    expect(toolsCode).toMatch(/name:\s*'scope_guard'/);
    expect(toolsCode).toMatch(/'check_scope'\s*,\s*'rate_limit'/);
  });

  it('tools.ts 有 report_vulnerability 声明 (漏洞落盘)', () => {
    expect(toolsCode).toMatch(/name:\s*'report_vulnerability'/);
  });

  it('subagent.ts pentest 工具集含 scope_guard + report_vulnerability', () => {
    // 锚 SUBAGENT_TOOLS 里的 "pentest: [" 数组字面量本身 (SUBAGENT_PROMPTS 里也有
    // "pentest" 但那是模板串, 不是数组), 匹配 scope_guard + report_vulnerability 同块。
    const m = subagentCode.match(/pentest:\s*\[\s*('[\w:]+')(?:\s*,\s*('[\w:]+'))*(?:\s*,\s*'scope_guard')?/);
    // 上面太苛刻, 用更稳的: 找 "pentest: [" 开头、含 scope_guard 和 report_vulnerability 的连续段
    const segMatch = subagentCode.match(/pentest:\s*\[[\s\S]*?'scope_guard',\s*'report_vulnerability'/);
    expect(segMatch, 'pentest 工具集段未同时含 scope_guard + report_vulnerability').toBeTruthy();
  });

  it('pentest prompt 有安全硬约束 (先 check_scope / 禁 DoS / 越界拒绝)', () => {
    // 硬约束在 prompt 模板串里是 markdown (**必须先调…), 开头 * 会被 codeOnly 剥掉,
    // 故断言走**原始** subagentSrc, 不能走 subagentCode。
    expect(subagentSrc).toMatch(/必须先调\s*scope_guard/);
    expect(subagentSrc).toMatch(/DoS|拒绝服务/);
    expect(subagentSrc).toMatch(/in_scope:?\s*false|拒绝越界/);
  });

  it('mcp/config.ts 有 hexstrike 外部 MCP 条目 (默认 disabled, 需 HEXSTRIKE_MCP_URL)', () => {
    expect(mcpConfigSrc).toMatch(/name:\s*'hexstrike'/);
    expect(mcpConfigSrc).toMatch(/HEXSTRIKE_MCP_URL/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — scope_guard / report_vulnerability 实际行为
// ════════════════════════════════════════════════════════════════════════
describe('行为: scope_guard + report_vulnerability', () => {
  const gwSrcDir = nodePath.join(ROOT, 'packages', 'agentai-gateway', 'src');
  const toolsMod = nodePath.join(gwSrcDir, 'tools.ts');
  // 用一个临时 workspace 隔离, 不污染真实 .agentai
  const tmpWs = nodePath.join(gwSrcDir, '..', '.scope-guard-test-ws');

  beforeAll(() => {
    rmSync(tmpWs, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(tmpWs, { recursive: true, force: true });
  });

  it('check_scope 越界 → in_scope:false (拒绝攻击)', async () => {
    // 造一个只有 example.com 的 scope.json
    const fs = await import('node:fs');
    fs.mkdirSync(nodePath.join(tmpWs, '.agentai'), { recursive: true });
    fs.writeFileSync(nodePath.join(tmpWs, '.agentai', 'scope.json'),
      JSON.stringify({ targets: ['example.com'], max_rps: 5 }), 'utf8');

    // 直接调 handler 逻辑 (import EXTRA_HANDLERS, ctx.workspace 指向 tmpWs)
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs, abortSignal: new AbortController().signal } as any;

    const inScope = await EXTRA_HANDLERS['scope_guard']({ target: 'https://example.com', action: 'check_scope' }, ctx);
    expect(inScope.data?.in_scope).toBe(true);

    const outOfScope = await EXTRA_HANDLERS['scope_guard']({ target: 'https://bank.com', action: 'check_scope' }, ctx);
    expect(outOfScope.data?.in_scope).toBe(false);
  });

  it('rate_limit → ok:true (限频闸门通过)', async () => {
    const fs = await import('node:fs');
    if (!fs.existsSync(nodePath.join(tmpWs, '.agentai', 'scope.json'))) {
      fs.mkdirSync(nodePath.join(tmpWs, '.agentai'), { recursive: true });
      fs.writeFileSync(nodePath.join(tmpWs, '.agentai', 'scope.json'), JSON.stringify({ targets: ['example.com'], max_rps: 5 }));
    }
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['scope_guard']({ target: 'https://example.com', action: 'rate_limit' }, ctx);
    expect(r.data?.ok).toBe(true);
  });

  it('report_vulnerability 落盘到 .agentai/vulns/vulns.jsonl', async () => {
    const fs = await import('node:fs');
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['report_vulnerability'](
      { title: '反射型XSS', target: 'example.com', severity: 'high', vulnType: 'xss', poc: '<script>alert(1)</script>', evidence: '响应 302' },
      ctx,
    );
    expect(r.success).toBe(true);
    const vulnsFile = nodePath.join(tmpWs, '.agentai', 'vulns', 'vulns.jsonl');
    expect(fs.existsSync(vulnsFile)).toBe(true);
    const lastLine = fs.readFileSync(vulnsFile, 'utf8').trim().split('\n').pop()!;
    expect(JSON.parse(lastLine).title).toBe('反射型XSS');
  });
});


// ════════════════════════════════════════════════════════════════════════
// kali 扫描器接线 (2026-10-15): wsl_scan + grant_scope + list_scope
// ════════════════════════════════════════════════════════════════════════
describe('契约: wsl_scan + grant_scope + list_scope (kali 接线)', () => {
  it('tools.ts 有 wsl_scan 声明 (工具白名单 6 扫描器)', () => {
    expect(toolsCode).toMatch(/name:\s*'wsl_scan'/);
    expect(toolsCode).toMatch(/enum:\s*\['nmap'\s*,\s*'nuclei'\s*,\s*'sqlmap'/);
  });

  it('tools.ts 有 grant_scope + list_scope 声明 (授权对话化)', () => {
    expect(toolsCode).toMatch(/name:\s*'grant_scope'/);
    expect(toolsCode).toMatch(/name:\s*'list_scope'/);
  });

  it('subagent.ts pentest 工具集含 wsl_scan + grant_scope + list_scope', () => {
    const m = subagentCode.match(/pentest:\s*\[[\s\S]*?'wsl_scan',\s*'grant_scope',\s*'list_scope'/);
    expect(m, 'pentest 工具集段未含 kali 接线三件').toBeTruthy();
  });

  it('pentest prompt 工作流提到 wsl_scan / grant_scope', () => {
    expect(subagentSrc).toMatch(/wsl_scan/);
    expect(subagentSrc).toMatch(/grant_scope/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为: wsl_scan 越界拒绝 + 白名单 + grant_scope 写盘
// ════════════════════════════════════════════════════════════════════════
describe('行为: wsl_scan 授权闸门 + grant_scope 落盘', () => {
  const gwSrcDir = nodePath.join(ROOT, 'packages', 'agentai-gateway', 'src');
  const tmpWs2 = nodePath.join(gwSrcDir, '..', '.scope-guard-test-ws-wsl');
  const fsMod = { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync };

  beforeAll(() => {
    fsMod.rmSync(tmpWs2, { recursive: true, force: true });
    fsMod.mkdirSync(nodePath.join(tmpWs2, '.agentai'), { recursive: true });
    fsMod.writeFileSync(nodePath.join(tmpWs2, '.agentai', 'scope.json'),
      JSON.stringify({ targets: ['example.com'], max_rps: 5 }));
  });
  afterAll(() => {
    fsMod.rmSync(tmpWs2, { recursive: true, force: true });
  });

  it('wsl_scan 越界目标 → 拒绝 (不真跑 wsl)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['wsl_scan']({ target: 'https://bank.com', tool: 'nmap', args: ['-sV'] }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/越界|不在授权/);
  });

  it('wsl_scan 白名单外工具 → 拒绝 (防任意命令)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['wsl_scan']({ target: 'https://example.com', tool: 'rm' }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/未知工具|允许/);
  });

  it('grant_scope 把目标写进 scope.json (对话式授权)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['grant_scope']({ target: 'admin.example.com', max_rps: 3 }, ctx);
    expect(r.success).toBe(true);
    const scope = JSON.parse(fsMod.readFileSync(nodePath.join(tmpWs2, '.agentai', 'scope.json'), 'utf8'));
    expect(scope.targets).toContain('admin.example.com');
    expect(scope.max_rps).toBe(3);
  });

  it('grant_scope 去重 (同 host 不重复加)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r1 = await EXTRA_HANDLERS['grant_scope']({ target: 'https://admin.example.com' }, ctx);
    expect(r1.data?.granted).toBe(false);
    const scope = JSON.parse(fsMod.readFileSync(nodePath.join(tmpWs2, '.agentai', 'scope.json'), 'utf8'));
    const adminCount = scope.targets.filter((t: string) => t.includes('admin.example.com')).length;
    expect(adminCount).toBe(1);
  });

  it('list_scope 返回当前授权范围', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['list_scope']({}, ctx);
    expect(r.success).toBe(true);
    expect(r.data?.targets?.length).toBeGreaterThan(0);
    expect(r.output).toMatch(/admin.example.com/);
  });
});
