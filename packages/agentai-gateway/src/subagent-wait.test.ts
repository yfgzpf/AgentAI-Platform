/**
 * 主任务「服务端等待子智能体」回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 富哥原话: 「作为要子智能体任务主任国应该不断的去看完成没有而不是中断任务呀?」
 *
 * 旧行为: 模型一句"已完成"就 break 收口 → 子智能体还在跑 → 成果只能靠前端
 *   _resumeFrom 唤醒 (页面关了就永久 orphan, 主任务等于白中断)。
 * 新行为: 收口前发现本会话还有 running 子智能体 → 服务端轮询等待 (与前端解耦),
 *   全部完成后经 _pendingSubagentResults 回注, 主 AI 拿着成果继续。
 *
 * 本测试锁死 _awaitRunningSubagents 的行为契约:
 *   ① 全部完成 → 结果回注 (done/error 两种形态)
 *   ② 已回注过的不重复回注 (防旧成果在后续等待轮重复注入)
 *   ③ 用户中断/代际替换 → 立即退出 (不劫持中断权)
 *   ④ 墙钟上限 → timedOut (不死等)
 *   ⑤ 空会话 → 立即返回 (空集合不是等待理由)
 *
 * ⚠️ 注册表是 globalThis 挂载的进程级 Map — 每例必须用**独立 sessionId**,
 *   否则上一例的 done 记录会被下一例的 finishedResultsForSession 捞回来 (串味)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentAILoop } from './agentai-loop.js';
import { registerSubagent, completeSubagent, listSubagents } from './subagent-registry.js';

let WS = '';
let CASE = 0;
beforeEach(() => { WS = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-wait-')); CASE++; });
afterEach(() => {
  // 清注册表, 避免跨用例串味 (globalThis 挂载, 同进程内持久)
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

describe('_awaitRunningSubagents: 服务端等待 (富哥: 主导方不断去看完成没有)', () => {
  it('① 子智能体完成 → 结果经 _pendingSubagentResults 回注', async () => {
    const { loop, sid } = makeLoop();
    registerSubagent({ id: `w-${CASE}-1`, parentSessionId: sid, workspace: WS, status: 'running' });
    const p = loop._awaitRunningSubagents(loop._runGeneration);
    await new Promise(r => setTimeout(r, 2100)); // 过一个轮询周期
    completeSubagent(`w-${CASE}-1`, 'done', { result: '扫描结果: 开放 80/443' });
    const r = await p;
    expect(r).toEqual({ injected: 1, aborted: false, timedOut: false, remaining: 0 });
    expect(loop._pendingSubagentResults.get(`w-${CASE}-1`)).toEqual({
      status: 'done', content: '扫描结果: 开放 80/443', subId: `w-${CASE}-1`,
    });
  });

  it('①b error 终态 → 回注内容带"执行失败" (失败也是成果, 不能静默吞)', async () => {
    const { loop, sid } = makeLoop();
    registerSubagent({ id: `w-${CASE}-2`, parentSessionId: sid, workspace: WS, status: 'running' });
    const p = loop._awaitRunningSubagents(loop._runGeneration);
    await new Promise(r => setTimeout(r, 2100));
    completeSubagent(`w-${CASE}-2`, 'error', { error: '模型熔断' });
    const r = await p;
    expect(r.injected).toBe(1);
    const rec = loop._pendingSubagentResults.get(`w-${CASE}-2`);
    expect(rec.status).toBe('error');
    expect(rec.content).toContain('执行失败');
    expect(rec.content).toContain('模型熔断');
  });

  it('② 已回注过的不重复回注 (防旧成果在后续等待轮重复注入)', async () => {
    const { loop, sid } = makeLoop();
    registerSubagent({ id: `w-${CASE}-3`, parentSessionId: sid, workspace: WS, status: 'running' });
    const p1 = loop._awaitRunningSubagents(loop._runGeneration);
    await new Promise(r => setTimeout(r, 2100));
    completeSubagent(`w-${CASE}-3`, 'done', { result: 'R' });
    await p1;
    // 第二次等待 (同一会话, 该子任务仍是 done 态) → 不应再注入
    const r2 = await loop._awaitRunningSubagents(loop._runGeneration);
    expect(r2.injected).toBe(0);
    expect(loop._pendingSubagentResults.size).toBe(1);
  });

  it('③ 用户中断 → 立即退出, 不注入 (不劫持用户的中断权)', async () => {
    const { loop, sid } = makeLoop();
    registerSubagent({ id: `w-${CASE}-4`, parentSessionId: sid, workspace: WS, status: 'running' });
    loop._aborted = true;
    const r = await loop._awaitRunningSubagents(loop._runGeneration);
    expect(r.aborted).toBe(true);
    expect(r.injected).toBe(0);
    expect(loop._pendingSubagentResults.size).toBe(0);
  });

  it('③b 代际替换 (被新 run() 取代) → 立即退出', async () => {
    const { loop, sid } = makeLoop();
    registerSubagent({ id: `w-${CASE}-5`, parentSessionId: sid, workspace: WS, status: 'running' });
    const myGen = loop._runGeneration;
    (loop as any)._runGeneration = myGen + 1; // 模拟新 run() 顶掉代际
    const r = await loop._awaitRunningSubagents(myGen);
    expect(r.aborted).toBe(true);
  });

  it('④ 墙钟上限 → timedOut 不死等 (fake timers 快进 10 分钟)', async () => {
    vi.useFakeTimers();
    try {
      const { loop, sid } = makeLoop();
      registerSubagent({ id: `w-${CASE}-6`, parentSessionId: sid, workspace: WS, status: 'running' });
      const p = loop._awaitRunningSubagents(loop._runGeneration);
      // 快进: 每 2s 醒一次, 超过 10 分钟上限后返回 timedOut
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
      const r = await p;
      expect(r.timedOut).toBe(true);
      expect(r.aborted).toBe(false);
      expect(r.remaining).toBe(1);
      expect(r.injected).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('⑤ 没有子任务的会话 → 立即返回 injected=0 (空集合不是等待理由)', async () => {
    const { loop } = makeLoop();
    const r = await loop._awaitRunningSubagents(loop._runGeneration);
    expect(r).toEqual({ injected: 0, aborted: false, timedOut: false, remaining: 0 });
  });
});

describe('等待策略的源码结构 (防回归被摘)', () => {
  const SRC = fs.readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');

  it('收口点插桩: 无 tool_calls + 本会话有 running 子智能体才等待', () => {
    expect(SRC).toContain("if (!res.toolCalls?.length && this.opts.sessionId");
    expect(SRC).toContain('runningForSession(this.opts.sessionId).length > 0');
  });

  it('等待次数有上限 (防模型每轮派新的然后等, 无限续命)', () => {
    expect(SRC).toContain('MAX_SUB_WAIT_ROUNDS = 3');
    expect(SRC).toContain('this._subWaitRounds < AgentAILoop.MAX_SUB_WAIT_ROUNDS');
  });

  it('墙钟上限 10 分钟 (与子智能体墙钟一致)', () => {
    expect(SRC).toContain('SUBAGENT_WAIT_CAP_MS = 10 * 60 * 1000');
  });

  it('等待前 emit subagent:waiting (前端据此解释主 AI 的沉默)', () => {
    expect(SRC).toContain("this.emit('subagent:waiting'");
  });

  it('超时不死等: 带 directive 让 AI 基于已有信息收口', () => {
    expect(SRC).toContain("this.directives.add('subagent_wait_timeout'");
  });

  it('chat.ts 转发 subagent:waiting → SSE', () => {
    const chat = fs.readFileSync(path.resolve(__dirname, 'routes/chat.ts'), 'utf-8');
    expect(chat).toContain("loop.on('subagent:waiting'");
    expect(chat).toContain("sendEvent('subagent_waiting'");
  });

  it('api.ts 分发 subagent_waiting → onSubagentWaiting', () => {
    const api = fs.readFileSync(path.resolve(__dirname, '../../agentai-gui/src/services/api.ts'), 'utf-8');
    expect(api).toContain("case 'subagent_waiting': handlers.onSubagentWaiting?.(data); break;");
  });

  it('ChatView 有 onSubagentWaiting (noticeKind 覆盖, 不刷屏)', () => {
    const cv = fs.readFileSync(path.resolve(__dirname, '../../agentai-gui/src/components/ChatView.tsx'), 'utf-8');
    expect(cv).toContain('onSubagentWaiting:');
    expect(cv).toContain("noticeKind: 'subagent_waiting'");
  });
});
