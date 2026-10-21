/**
 * 子智能体协作回归测试 — 2026-10-21 午后 (富哥《并行子智能体编排改造方案》落地)
 * ----------------------------------------------------------------
 * 富哥原话: 「deepseek 发子任务, 会边去干另蝗会一直去等任务完成, 不是说把任务
 * 全给子任务来做」+ Q1 拍板「转后台继续」。
 *
 * 架构变迁 (本测试锁死新契约):
 *   旧: spawn = fire-and-forget + 收口点阻塞等待 10 分钟 (方案 5.1 明确否定)
 *   新: ① 回合内并发执行 — 同回合多个 spawn_subagent 一起跑, 结果按 tool_call_id
 *         回填, 主循环 continue (不 break 不等外部唤醒)
 *      ② 单任务 300s 回合内上限, 到点**不杀**转后台继续 (富哥拍板), 成果经
 *         _pendingSubagentResults 回注或前端自动唤醒回收
 *      ③ 收口时后台还有在跑 → 告知式收口 (directive + 一次 continue), 不阻塞
 *      ④ 三保险: 调用预算 3 次/会话 (硬) + reason 审计 + 简单任务短路
 *
 * ⚠️ 注册表是 globalThis 挂载的进程级 Map — 每例必须用独立 sessionId (防串味)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentAILoop } from './agentai-loop.js';
import { registerSubagent, completeSubagent, listSubagents } from './subagent-registry.js';
import {
  normalizeSubagentTask, makeSubagentResult, formatSubagentResult,
  spawnBudgetState, recordSpawn, resetSpawnBudgetForTest, shouldShortCircuitSubagent,
  SPAWN_BUDGET_PER_SESSION, SUBAGENT_SYNC_TIMEOUT_MS,
} from './subagent-schema.js';

let WS = '';
let CASE = 0;
const loopSrc = fs.readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
beforeEach(() => { WS = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-wait-')); CASE++; resetSpawnBudgetForTest(); });
afterEach(() => {
  for (const r of listSubagents()) {
    if (r.workspace === WS) completeSubagent(r.id, 'error', { error: 'test-cleanup' });
  }
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** 最小可测 loop (照 runtime-guard.test.ts 的模式); 每例独立 sessionId */
function makeLoop() {
  const sid = `s-wait-${CASE}`;
  const router: any = { chat: vi.fn(), getAvailableModels: vi.fn().mockReturnValue(['agentai']) };
  const registry: any = { dispatch: vi.fn(), toLLMTools: vi.fn().mockReturnValue([]), list: vi.fn().mockReturnValue([]) };
  const loop = new AgentAILoop(router, registry, [], { maxIterations: 4, userId: 'u1', workspace: WS, sessionId: sid }) as any;
  return { loop, sid };
}

/** 造一个 _turnSpawns 条目 (私有字段, 测试直接构造) */
function mkEntry(over: Partial<any> = {}) {
  const entry = {
    tc: { id: over.tcId || `tc-${CASE}-${Math.random().toString(36).slice(2, 6)}`, name: 'spawn_subagent', args: {} },
    subId: over.subId || `sub-${CASE}-${Math.random().toString(36).slice(2, 6)}`,
    norm: over.norm || normalizeSubagentTask({ task: '侦察目标', reason: 'b) 独立子目标' }).task,
    startedAt: over.startedAt ?? Date.now(),
    resolve: (_r: any) => { entry.settled = true; entry.result = _r; },
    settled: false,
    result: null as any,
    timedOutInTurn: false,
  };
  return entry;
}

describe('_awaitTurnSpawns: 回合内并发等待 (方案 5.2/6)', () => {
  it('① timeout 内完成 → 拿到真实 success 结果 (不是占位符)', async () => {
    const { loop } = makeLoop();
    const e = mkEntry();
    e.norm = normalizeSubagentTask({ task: '侦察目标', reason: 'b) 独立子目标', timeout_ms: 5000 }).task;
    loop._turnSpawns = [e];
    setTimeout(() => e.resolve(makeSubagentResult({ status: 'success', subagentId: e.subId, summary: '开放 80/443' })), 100);
    await loop._awaitTurnSpawns();
    expect(e.settled).toBe(true);
    expect(e.result?.status).toBe('success');
    expect(e.result?.summary).toBe('开放 80/443');
    expect(e.timedOutInTurn).toBe(false);
  });

  it('② 超过回合内上限 → status=timeout + wentBackground (不杀, 富哥拍板"转后台继续")', async () => {
    const { loop } = makeLoop();
    const e = mkEntry({ startedAt: Date.now() - 400_000 }); // 已过 300s 上限
    e.norm = normalizeSubagentTask({ task: '跑长扫描', reason: 'c) 重复操作省 token', timeout_ms: 300000 }).task;
    loop._turnSpawns = [e];
    await loop._awaitTurnSpawns();
    expect(e.timedOutInTurn).toBe(true);
    expect(e.result?.status).toBe('timeout');
    expect(e.result?.wentBackground).toBe(true);
    expect(e.result?.summary).toContain('转后台继续跑');
    expect(e.result?.next_suggestion).toContain('自动带回');
  });

  it('③ 显式 background:true → 不等待 (立即返回, entry 保持 unsettled)', async () => {
    const { loop } = makeLoop();
    const e = mkEntry();
    e.norm = normalizeSubagentTask({ task: '后台调研', reason: 'b) 独立子目标', background: true }).task;
    loop._turnSpawns = [e];
    await loop._awaitTurnSpawns();
    expect(e.settled).toBe(false); // 没等它
    expect(e.timedOutInTurn).toBe(false);
  });

  it('④ 用户中断 → 停止等待, 标 timeout+wentBackground (不劫持中断权, 也不杀子任务)', async () => {
    const { loop } = makeLoop();
    const e = mkEntry({ startedAt: Date.now() }); // 上限在 300s 后, 没超时
    loop._turnSpawns = [e];
    loop._aborted = true;
    await loop._awaitTurnSpawns();
    expect(e.timedOutInTurn).toBe(true);
    expect(e.result?.status).toBe('timeout');
    expect(e.result?.summary).toContain('主任务已中止');
  });

  it('⑤ 空收集 → 立即返回 (不空转轮询)', async () => {
    const { loop } = makeLoop();
    loop._turnSpawns = [];
    const t0 = Date.now();
    await loop._awaitTurnSpawns();
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('⑥ 多条并发: 快的拿真实结果, 慢的转后台 (互不阻塞, 不用等最慢的那个上限)', async () => {
    const { loop } = makeLoop();
    // fast: 100ms 后真实完成, 上限 5s → 应拿 success
    const fast = mkEntry({ startedAt: Date.now() });
    fast.norm = normalizeSubagentTask({ task: '快任务', reason: 'b) 独立', timeout_ms: 5000 }).task;
    // slow: 从未 settle, 且已过自己的 1s 上限 → 应拿 timeout 转后台
    const slow = mkEntry({ startedAt: Date.now() - 10_000 });
    slow.norm = normalizeSubagentTask({ task: '慢任务', reason: 'b) 独立', timeout_ms: 1000 }).task;
    loop._turnSpawns = [fast, slow];
    setTimeout(() => fast.resolve(makeSubagentResult({ status: 'success', subagentId: fast.subId, summary: '快任务完成' })), 100);
    const t0 = Date.now();
    await loop._awaitTurnSpawns();
    expect(Date.now() - t0).toBeLessThan(3000); // 没被 slow 的原始上限拖住
    expect(fast.result?.status).toBe('success');
    expect(fast.timedOutInTurn).toBe(false);
    expect(slow.result?.status).toBe('timeout');
    expect(slow.timedOutInTurn).toBe(true);
    expect(slow.result?.wentBackground).toBe(true);
  });
});

describe('_applySpawnOutcomes: 结果按 tool_call_id 回填 (方案 5.2)', () => {
  it('① 闸门拦下的 (策略/预算/并发) → gated 文本覆盖占位符', async () => {
    const { loop } = makeLoop();
    loop._spawnOutcomes.set('tc-g1', '[派发被拒] 赏金工作区禁止派子智能体, 用 batch_pentest');
    const raw = [{ id: 'tc-g1', name: 'spawn_subagent', output: '[已在主循环处理] 占位符', data: null }];
    loop._applySpawnOutcomes(raw);
    expect(raw[0].output).toContain('[派发被拒]');
    expect(raw[0].output).toContain('batch_pentest');
    expect(raw[0].data?.spawnOutcome).toBe('gated');
  });

  it('② 真实 SubagentResult → formatSubagentResult 覆盖占位符 (带 status/evidence)', async () => {
    const { loop } = makeLoop();
    const e = mkEntry({ tcId: 'tc-r1' });
    e.settled = true;
    e.result = makeSubagentResult({
      status: 'success', subagentId: 'sub-x', summary: '发现 3 个子域',
      evidence: ['a.jxnu.edu.cn', 'b.jxnu.edu.cn'], durationMs: 45000,
    });
    loop._turnSpawns = [e];
    const raw = [{ id: 'tc-r1', name: 'spawn_subagent', output: '[已在主循环处理] 占位符', data: null }];
    loop._applySpawnOutcomes(raw);
    expect(raw[0].output).toContain('status=success');
    expect(raw[0].output).toContain('发现 3 个子域');
    expect(raw[0].output).toContain('a.jxnu.edu.cn');
    expect(raw[0].output).toContain('id: sub-x');
    expect(typeof raw[0].data?.subagentId).toBe('string');
    expect(raw[0].data?.subagentStatus).toBe('success');
  });

  it('③ timeout 转后台的结果 → 文本说明"已转后台继续"', async () => {
    const { loop } = makeLoop();
    const e = mkEntry({ tcId: 'tc-t1' });
    e.settled = true;
    e.result = makeSubagentResult({ status: 'timeout', subagentId: 'sub-y', summary: '上限已到, 转后台', wentBackground: true });
    loop._turnSpawns = [e];
    const raw = [{ id: 'tc-t1', name: 'spawn_subagent', output: '占位', data: null }];
    loop._applySpawnOutcomes(raw);
    expect(raw[0].output).toContain('已转后台继续');
    expect(raw[0].data?.background).toBe(true);
  });

  it('④ 显式后台派发未 settle → "已派发到后台" + 别重复发起', async () => {
    const { loop } = makeLoop();
    const e = mkEntry({ tcId: 'tc-b1' });
    e.norm = normalizeSubagentTask({ task: '后台任务', reason: 'b) 独立', background: true }).task;
    loop._turnSpawns = [e];
    const raw = [{ id: 'tc-b1', name: 'spawn_subagent', output: '占位', data: null }];
    loop._applySpawnOutcomes(raw);
    expect(raw[0].output).toContain('已派发到后台');
    expect(raw[0].output).toContain('不要重复派发');
    expect(raw[0].data?.background).toBe(true);
  });

  it('⑤ 非 spawn 调用不受影响 (不能误伤普通工具)', async () => {
    const { loop } = makeLoop();
    loop._spawnOutcomes.set('tc-x', '[派发被拒] 不应匹配到别的工具');
    const raw = [{ id: 'tc-x', name: 'read_file', output: '文件内容', data: null }];
    loop._applySpawnOutcomes(raw);
    expect(raw[0].output).toBe('文件内容');
  });
});

describe('收口点: 告知式收口 (方案 5.1, 阻塞等待已退役)', () => {
  it('① 源码: 阻塞等待方法已删 (方案明文否定)', () => {
    expect(loopSrc).not.toContain('_awaitRunningSubagents');
    expect(loopSrc).not.toContain('SUBAGENT_WAIT_CAP_MS');
    expect(loopSrc).not.toContain('MAX_SUB_WAIT_ROUNDS');
  });

  it('② 源码: 收口点是告知式 (directive + 一次 continue, 不 await 等待)', () => {
    expect(loopSrc).toContain('subagent_background_running');
    expect(loopSrc).toContain('_subWaitNotified');
    // 告知指令必须要求模型明告用户 + 不等待
    const idx = loopSrc.indexOf('subagent_background_running');
    const block = loopSrc.slice(idx - 200, idx + 900);
    expect(block).toContain('后台继续执行');
    expect(block).toContain('明确告知用户');
  });

  it('③ 源码: 回合内并发三件套齐了 (收集/等待/回填)', () => {
    expect(loopSrc).toContain('_awaitTurnSpawns');
    expect(loopSrc).toContain('_applySpawnOutcomes');
    // 回填点必须在 dispatchToolCalls 之后 (普通工具与子任务并发跑完再统一回填)
    const dispatchIdx = loopSrc.indexOf('rawResults = await this.dispatchToolCalls(res.toolCalls)');
    const awaitIdx = loopSrc.indexOf('await this._awaitTurnSpawns()');
    const applyIdx = loopSrc.indexOf('this._applySpawnOutcomes(rawResults)');
    expect(dispatchIdx).toBeGreaterThan(0);
    expect(awaitIdx).toBeGreaterThan(dispatchIdx);
    expect(applyIdx).toBeGreaterThan(awaitIdx);
  });

  it('④ 源码: spawn IIFE 不再直推 appendOnlyLog (一条 tc.id 一条真实消息)', () => {
    // 旧架构: IIFE 完成时直推 + 占位符 = 同 id 双消息; 新架构走 spawnEntry.resolve
    expect(loopSrc).toContain('spawnEntry.resolve(makeSubagentResult(');
    const spawnBlock = loopSrc.slice(loopSrc.indexOf('spawnEntry.resolve(makeSubagentResult('), loopSrc.indexOf('spawnEntry.resolve(makeSubagentResult(') + 400);
    expect(spawnBlock).not.toContain('appendOnlyLog.push');
  });

  it('⑤ SSE 链路不变: subagent:waiting 仍到前端 (chat.ts → api.ts → ChatView)', () => {
    const gw = path.resolve(__dirname, '..');
    const chatRoute = fs.readFileSync(path.join(gw, 'src/routes/chat.ts'), 'utf-8');
    const api = fs.readFileSync(path.join(gw, '../agentai-gui/src/services/api.ts'), 'utf-8');
    const chatView = fs.readFileSync(path.join(gw, '../agentai-gui/src/components/ChatView.tsx'), 'utf-8');
    expect(chatRoute).toContain("sendEvent('subagent_waiting'");
    expect(api).toContain("case 'subagent_waiting'");
    expect(chatView).toContain('onSubagentWaiting');
    // 文案已从"阻塞等待"改为"转后台继续"
    expect(chatView).toContain('转后台继续执行');
  });
});

describe('subagent-schema: 结构化协议 (方案 4.2/4.3)', () => {
  it('① normalizeSubagentTask: 兼容旧参数 {type,task} + reason 默认值', () => {
    const { task, reasonProvided } = normalizeSubagentTask({ type: 'research', task: '调研竞品' });
    expect(task.type).toBe('research');
    expect(task.objective).toBe('调研竞品');
    expect(task.reason).toBe('(未说明理由)');
    expect(reasonProvided).toBe(false);
    expect(task.timeoutMs).toBe(SUBAGENT_SYNC_TIMEOUT_MS);
    expect(task.background).toBe(false);
  });

  it('② normalizeSubagentTask: 新参数齐全 + timeout 上限 600s', () => {
    const { task, reasonProvided } = normalizeSubagentTask({
      subject: 'jxnu.edu.cn', objective: '枚举子域', reason: 'b) 独立子目标', timeout_ms: 999_999,
    });
    expect(task.subject).toBe('jxnu.edu.cn');
    expect(reasonProvided).toBe(true);
    expect(task.timeoutMs).toBe(600_000);
  });

  it('③ formatSubagentResult: status/evidence/next_suggestion 全带上', () => {
    const text = formatSubagentResult(makeSubagentResult({
      status: 'partial', summary: '部分完成', evidence: ['e1'], next_suggestion: '补充验证',
    }));
    expect(text).toContain('status=partial');
    expect(text).toContain('部分完成');
    expect(text).toContain('e1');
    expect(text).toContain('补充验证');
  });

  it('④ formatSubagentResult: timeout 形态提示"先推进, 完成自动带回"', () => {
    const text = formatSubagentResult(makeSubagentResult({
      status: 'timeout', summary: '超时转后台', wentBackground: true,
    }));
    expect(text).toContain('已转后台继续');
    expect(text).toContain('自动');
  });

  it('⑤ 调用预算: 默认 3 次/会话, 超了 exhausted (方案 9.2)', () => {
    const sid = `budget-${CASE}`;
    expect(spawnBudgetState(sid)).toEqual({ used: 0, limit: SPAWN_BUDGET_PER_SESSION, exhausted: false });
    recordSpawn(sid); recordSpawn(sid);
    expect(spawnBudgetState(sid).used).toBe(2);
    expect(spawnBudgetState(sid).exhausted).toBe(false);
    recordSpawn(sid);
    expect(spawnBudgetState(sid).exhausted).toBe(true);
  });

  it('⑥ 简单任务短路: 短消息命中, 并行/安全信号不误伤 (方案 9.1)', () => {
    expect(shouldShortCircuitSubagent('改个按钮颜色')).toBe(true);
    expect(shouldShortCircuitSubagent('你好')).toBe(true);
    // 有并行信号 → 不短路
    expect(shouldShortCircuitSubagent('同时扫这几个站')).toBe(false);
    expect(shouldShortCircuitSubagent('批量处理文件')).toBe(false);
    // 有安全信号 → 不短路 (那类任务另有 bounty 闸门)
    expect(shouldShortCircuitSubagent('扫一下端口')).toBe(false);
    expect(shouldShortCircuitSubagent('看看这个漏洞')).toBe(false);
    // 长消息 → 不短路
    expect(shouldShortCircuitSubagent('帮我把这个项目的登录模块重构一下, 顺便补上单元测试, 要注意兼容旧的 token 格式')).toBe(false);
    // 空消息 → 不短路 (无信号不动作)
    expect(shouldShortCircuitSubagent('')).toBe(false);
  });

  it('⑦ 源码: 预算闸门 + reason 审计 + 短路都接进了 loop', () => {
    expect(loopSrc).toContain('spawnBudgetState(_sid)');
    expect(loopSrc).toContain('recordSpawn(_sid)');
    expect(loopSrc).toContain('[spawn-audit]');
    expect(loopSrc).toContain('shouldShortCircuitSubagent(message)');
    expect(loopSrc).toContain("'spawn_subagent') : filtered");
  });

  it('⑧ 源码: 并发上限 2 → 5 (方案 6.2)', () => {
    expect(loopSrc).toContain('MAX_SUBAGENTS = 5');
  });

  it('⑨ 源码: spawn 是"收集后立即启动 IIFE" (真并发, 非串行 for 等一个再起一个 — 方案 10.2 检查点)', () => {
    // 判据: this._turnSpawns.push(spawnEntry) 之后 600 字符内必须出现 IIFE 启动
    //   "(async () => {" 且其中调用 subLoop.run — 即收集与启动在同一 for 迭代内完成
    const pushIdx = loopSrc.indexOf('this._turnSpawns.push(spawnEntry)');
    expect(pushIdx).toBeGreaterThan(0);
    const after = loopSrc.slice(pushIdx, pushIdx + 1500);
    expect(after).toContain('(async () => {');
    // 墙钟计时器 + 子循环构造都在 IIFE 内 (启动即开跑)
    expect(after).toContain('subWallTimer');
    // 全部 spawn 收集完才统一 await (await 在 for 循环外)
    const awaitIdx = loopSrc.indexOf('await this._awaitTurnSpawns()');
    const forIdx = loopSrc.lastIndexOf('for (const tc of res.toolCalls)', awaitIdx);
    expect(awaitIdx).toBeGreaterThan(forIdx);
  });
});

describe('工具声明: 可选工具语义 (方案 4.1)', () => {
  const toolsSrc = fs.readFileSync(path.resolve(__dirname, 'tools.ts'), 'utf-8');

  it('① 三要素齐: 能力边界/可选性/并行提示', () => {
    const declStart = toolsSrc.indexOf("{ name: 'spawn_subagent'");
    const decl = toolsSrc.slice(declStart, declStart + 3000);
    expect(decl).toContain('可选项');
    expect(decl).toContain('不是必须步骤');
    expect(decl).toContain('同一次响应里同时发出');
    expect(decl).toContain('并发执行 (上限 5)');
  });

  it('② 禁用"派发/分派/下属/指挥官"措辞 (方案第 8 节: 这些词让模型只想发任务)', () => {
    const declStart = toolsSrc.indexOf("{ name: 'spawn_subagent'");
    const decl = toolsSrc.slice(declStart, declStart + 3000);
    expect(decl).not.toContain('派发');
    expect(decl).not.toContain('分派');
    expect(decl).not.toContain('下属');
    expect(decl).not.toContain('指挥官');
  });

  it('③ reason 必填进 schema + 超时/后台参数声明', () => {
    const declStart = toolsSrc.indexOf("{ name: 'spawn_subagent'");
    const decl = toolsSrc.slice(declStart, declStart + 6000);
    expect(decl).toContain("required: ['type','task','reason']");
    expect(decl).toContain('回合内同步等待上限');
    expect(decl).toContain('background');
  });

  it('④ 提示词同步: 唯一执行者 + a/b/c 三条件 (方案第 8 节全文进 system-prompt)', () => {
    const prompt = fs.readFileSync(path.resolve(__dirname, 'system-prompt.ts'), 'utf-8');
    expect(prompt).toContain('你是唯一对最终结果负责的执行者');
    expect(prompt).toContain('不是你的下属');
    expect(prompt).toContain('默认由你自己直接使用手头的工具完成任务');
    expect(prompt).toContain('调用后不要结束回合');
    expect(prompt).toContain('不要直接转述子智能体的结论');
    // 旧的"优先 split 成子智能体"框架已删 (富哥点名的错误逻辑)
    expect(prompt).not.toContain('优先 split 成子智能体并行执行');
    expect(prompt).not.toContain('大规模探索优先用子智能体并行');
  });
});
