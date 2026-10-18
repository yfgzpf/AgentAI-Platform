/**
 * tools-filter-security.test.ts — 渗透任务必须拿到 Kali 工具 (2026-10-18)
 * ============================================================
 * 实机事故 (富哥): 挖洞任务里 AI 全程只用 write_file / run_command / run_code,
 *   Kali 的 nmap/nuclei/sqlmap 一次都没调 —— 但 `/v1/tools` 里 345 个工具全都在。
 *
 * 根因 (两道闸叠加, 都在"工具下发"这一步, 与工具是否注册无关):
 *   ① `filterToolsByIntent` 的 CORE 里没有任何渗透工具, INTENT_TOOLS 也没有渗透意图
 *      → security 任务类型只影响"工具组", 到这一步就被滤光;
 *   ② 即便进来了, `MAX_TOOLS` (deepseek 非 pro 只有 25) 会把排在 rest 里的
 *      wsl_scan 裁掉 (rest 按注册顺序, wsl_scan 在 tools.ts 近千行处)。
 *
 * 本测试锁死三处修复, 防回归。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { TOOL_GROUPS, TASK_TYPE_TOOL_MAP } from './tool-groups';

const src = readFileSync(nodePath.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const code = strip(src);

const PENTEST = [
  'wsl_scan', 'batch_pentest', 'scope_guard', 'grant_scope', 'list_scope',
  'enum_subdomains', 'extract_js_endpoints', 'http_replay',
  'report_vulnerability', 'save_evidence',
];

describe('工具组层面: security 任务配齐渗透工具', () => {
  it('security_ops 组包含全部 10 个渗透工具', () => {
    const ops = TOOL_GROUPS.security_ops || [];
    for (const t of PENTEST) expect(ops, `security_ops 缺 ${t}`).toContain(t);
  });

  it('TASK_TYPE_TOOL_MAP.security 存在且带 security_ops (不回退 general)', () => {
    expect(TASK_TYPE_TOOL_MAP.security).toBeTruthy();
    for (const t of PENTEST) expect(TASK_TYPE_TOOL_MAP.security).toContain(t);
  });
});

describe('意图层面: 渗透关键词能选中 Kali 工具 (修复①)', () => {
  it('INTENT_TOOLS 有渗透条目, 且列了 wsl_scan', () => {
    expect(code).toContain('挖洞|渗透');
    expect(code).toMatch(/挖洞\|渗透[\s\S]{0,600}'wsl_scan'/);
  });

  it('关键词覆盖常见挖洞说法 (越权/IDOR/子域/未授权)', () => {
    const block = code.slice(code.indexOf('挖洞|渗透'), code.indexOf('挖洞|渗透') + 900);
    for (const kw of ['越权', 'idor', '子域名', '未授权', 'nuclei', 'sqlmap']) {
      expect(block.toLowerCase(), `意图表缺关键词 ${kw}`).toContain(kw.toLowerCase());
    }
  });

  it('security 任务类型无条件补上渗透工具组 (不靠关键词, 兼顾客"继续")', () => {
    expect(code).toMatch(/_taskType === 'security'[\s\S]{0,200}TOOL_GROUPS\.security_ops/);
  });
});

describe('数量层面: 渗透工具不会被 MAX_TOOLS 裁掉 (修复②)', () => {
  it('PRIORITY_TOOLS 含全部渗透工具', () => {
    const start = code.indexOf('const PRIORITY_TOOLS = new Set([');
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf(']);', start));
    for (const t of PENTEST) expect(block, `PRIORITY_TOOLS 缺 ${t}`).toContain(`'${t}'`);
  });

  it('PRIORITY 在 rest 之前拼接 (cap 只裁 rest, 不裁 priority)', () => {
    expect(code).toMatch(/const capped = \[\.\.\.priority, \.\.\.rest\.slice\(/);
  });
});

describe('自主档也不再把 345 个工具全量砸给模型 (修复③)', () => {
  it('autonomous 分支里 security 任务走收敛而不是 allTools', () => {
    // 以赋值点为锚 (文件里 'autonomous' 出现多处, 直接 indexOf 会锚错)
    const start = code.indexOf('requestTools = allTools;');
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(Math.max(0, start - 350), start + 650);
    expect(block).toMatch(/autonomous/);
    expect(block).toMatch(/_taskType === 'security'[\s\S]{0,200}filterToolsByIntent/);
  });
});
