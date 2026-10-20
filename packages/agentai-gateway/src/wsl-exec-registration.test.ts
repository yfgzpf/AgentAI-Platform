/**
 * wsl_exec 「注册 + 启动」回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 富哥实锤两连:
 *   ① "调 wsl_exec 实际落到了 run_code, code 只是把命令原样 echo 回" —
 *      wsl_exec 有声明 (tools.ts:1115) 有 handler (tools.ts:4932),
 *      但**没进本轮下发给模型的函数清单**: 渗透意图表 (INTENT_TOOLS) 里
 *      只有 wsl_scan; 且赏金会话里一句"改一下这个脚本"把 taskType 打落成
 *      coding 后, 4499 行按 taskType 过滤把 security_ops 整组滤掉 →
 *      AI 手里只剩 run_code → 拿它糊弄 wsl 命令。
 *   ② "真去 spawn 时是 Command failed" — execFile('wsl', ['-u','root',...])
 *      非零退出无输出; 两个假设 (PATH 无 wsl.exe / -u root 未启用)。
 *
 * 本测试锁死修复的结构性存在 (行为测试在 wsl-runtime.test.ts):
 *   · wsl_exec 进渗透意图表 + 意图关键词
 *   · 赏金工作区 = security 上下文 (与 taskType 棘轮取或)
 *   · 组过滤在 security 上下文保留 security_ops
 *   · wsl_exec/wsl_scan 走 wsl-runtime (绝对路径 + 用户回退)
 *   · run_code 识别"冒充成代码的 wsl 命令"并重定向
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GW = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(p, 'utf-8');
// ⚠️ 不能用 /\/\*[\s\S]*?\*\//g 剥块注释 —— tools.ts 里的正则/字符串含假 `/*` `*/`
//   定界符, 非贪婪配对会把大段真实代码吃掉 (实测: wsl_exec 整段被剥没 → 断言假失败)。
// 行过滤: 只丢"整行都是注释"的行, 代码行一律保留 (对存在性断言足够)。
const strip = (s: string) => s.split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

const loop = strip(read(path.join(GW, 'src/agentai-loop.ts')));
const tools = strip(read(path.join(GW, 'src/tools.ts')));
const policy = strip(read(path.join(GW, 'src/subagent-policy.ts')));

describe('① wsl_exec 必须进本轮下发的函数清单', () => {
  it('渗透意图表 (INTENT_TOOLS) 含 wsl_exec (实锤: 之前只有 wsl_scan)', () => {
    // 意图表那段: tools 数组里 wsl_scan 与 wsl_exec 必须同时出现
    const intentBlock = loop.slice(loop.indexOf("'wsl_scan'"), loop.indexOf("'wsl_scan'") + 400);
    expect(intentBlock).toContain("'wsl_exec'");
  });

  it('意图关键词含 wsl_exec / go install / apt install (触发就下发)', () => {
    const patternBlock = loop.slice(loop.indexOf('挖洞|渗透|攻防'), loop.indexOf('挖洞|渗透|攻防') + 500);
    expect(patternBlock).toContain('wsl_exec');
    expect(patternBlock).toContain('go install');
    expect(patternBlock).toContain('apt install');
  });

  it('PRIORITY_TOOLS 含 wsl_exec (防 MAX_TOOLS cap 裁掉)', () => {
    expect(loop).toContain("'pentest_pipeline', 'wsl_exec'");
  });
});

describe('② 赏金工作区 = security 上下文 (taskType 打落也不掉工具)', () => {
  it('loop 有 _isBountyWorkspace 字段, 且从 opts.workspace 计算', () => {
    expect(loop).toContain('private _isBountyWorkspace = false');
    expect(loop).toContain('this._isBountyWorkspace = isBountyWorkspace(this.opts.workspace)');
  });

  it('filterToolsByIntent 的 security 组注入用 "taskType || 赏金工作区" 取或', () => {
    expect(loop).toContain('const securityCtx = this._taskType === \'security\' || this._isBountyWorkspace');
    expect(loop).toContain('if (securityCtx) {');
  });

  it('★ 4499 行组过滤在 security 上下文保留 security_ops (实锤掉档洞)', () => {
    expect(loop).toContain('securityKeep?.has(name) ?? false');
    const groupFilter = loop.slice(loop.indexOf('securityKeep'), loop.indexOf('securityKeep') + 200);
    expect(groupFilter).toContain('TOOL_GROUPS.security_ops');
  });

  it('autonomous 分支的收敛条件也带工作区信号', () => {
    expect(loop).toContain("if (this._taskType === 'security' || this._isBountyWorkspace) {");
  });
});

describe('③ wsl 进程启动走 wsl-runtime (两个假设的根治)', () => {
  it('tools.ts 导入 wslRun / formatWslFailure / resolveWslExe', () => {
    expect(tools).toContain("import { wslRun, formatWslFailure, resolveWslExe } from './wsl-runtime.js'");
  });

  it('wsl_exec 用 wslRun (含 onSpawn 杀进程树钩子)', () => {
    const execBlock = tools.slice(tools.indexOf('wsl_exec: async'), tools.indexOf('wsl_scan: async'));
    expect(execBlock).toContain('await wslRun({');
    expect(execBlock).toContain('onSpawn:');
    expect(execBlock).toContain('formatWslFailure');
    // 不能再有裸 execFile('wsl') (绝对路径由 wsl-runtime 内部解析)
    expect(execBlock).not.toContain("execFile('wsl'");
  });

  it('wsl_scan 用 resolveWslExe() 而非裸 wsl', () => {
    const scanBlock = tools.slice(tools.indexOf('wsl_scan: async'), tools.indexOf('grant_scope: async'));
    expect(scanBlock).toContain('execFile(resolveWslExe()');
    expect(scanBlock).not.toContain("execFile('wsl'");
  });

  it('wsl-runtime 模块存在且导出三件套', () => {
    const rt = strip(read(path.join(GW, 'src/wsl-runtime.ts')));
    expect(rt).toContain('export function resolveWslExe');
    expect(rt).toContain('export async function wslRun');
    expect(rt).toContain('export function formatWslFailure');
    // 用户回退: 静默失败才重试, 且只重试一次
    expect(rt).toContain('const silent = !first.stdout.trim() && !first.stderr.trim()');
    expect(rt).toContain("await attempt(exe, '', distro, command, args, timeout, maxBuffer)");
  });
});

describe('④ run_code 重定向 "冒充成代码的 wsl 命令"', () => {
  it('run_code 开头识别 wsl/wsl.exe 命令并指向 wsl_exec', () => {
    const rc = tools.slice(tools.indexOf('run_code: async'), tools.indexOf('run_code: async') + 1600);
    expect(rc).toContain("firstLine = codeStr.split('\\n')[0].trim()");
    expect(rc).toContain('/^(wsl\\.exe|wsl)\\s+-/i.test(firstLine)');
    expect(rc).toContain('wsl_exec({ command: "bash"');
    // 策略性拒绝: success:true (不算失败, 不进熔断计数)
    expect(rc).toMatch(/return \{\s*success: true,\s*output: `⛔ 这是一条 WSL 命令/);
  });

  it('★ run_code 重定向只查首行 — 代码中部出现 wsl 字样不误伤', () => {
    const rc = tools.slice(tools.indexOf('run_code: async'), tools.indexOf('run_code: async') + 1600);
    // 不允许出现"全文任意位置匹配 wsl"的宽 pattern (会把 console.log("wsl --status") 也拦了)
    expect(rc).not.toContain('/\\bwsl\\s+(-\\w|--)/i');
  });
});

describe('⑤ isBountyWorkspace 判定 (policy 单一真源)', () => {
  it('导出且判据与 spawn 闸门同源', () => {
    expect(policy).toContain('export function isBountyWorkspace');
    expect(policy).toContain('BOUNTY_WS_RE.test(ws)');
  });
});
