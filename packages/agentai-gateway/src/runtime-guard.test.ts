/**
 * 运行时守卫回归测试 — 批次1「止血」(2026-10-11)
 * ==========================================================================
 * 本轮修的是 4 个**真缺口**(不是新建功能层), 每个都配行为级回归:
 *   改-1  _failTracker   跨迭代连续失败计数 (原每轮重建 → "失败3次换方案"从未生效)
 *   改-2  repeat_write   同目标反复写提醒 (全签名去重拦不到"同文件改来改去")
 *   改-3  tool_budget    工具调用总预算 + 独立迭代硬闸 (原上限埋在超时块里)
 *   改-4  goal anchor    冷启动从 active-plan.json 回填目标
 *
 * ⚠️ 诚实边界: 这里的 LLM 是打桩的, 验证的是**循环控制流**, 不是"模型真的变聪明了"。
 *    无 LLM 环境下无法端到端证明"换方案", 故行为测试断言的是可观测的守卫出口
 *    (事件 / directive), 而非模型行为。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAILoop } from './agentai-loop.js';
import { clearLedgers } from './task-ledger.js';

vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

const LOOP_SRC = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
const LEDGER_SRC = readFileSync(new URL('./task-ledger.ts', import.meta.url), 'utf-8');

let WS: string;

beforeEach(() => {
  WS = mkdtempSync(join(tmpdir(), 'runtime-guard-'));
  clearLedgers();
});

afterEach(() => {
  try { rmSync(WS, { recursive: true, force: true }); } catch { /* best-effort */ }
});

/** 与 ledger-wiring.test.ts 同款最小 harness */
function makeLoop(
  chatImpl: (round: number, msgs: any[]) => any,
  opts: Record<string, any> = {},
) {
  let round = 0;
  const router: any = {
    chat: vi.fn(async (payload: any) => {
      round++;
      return {
        content: '已完成本轮',
        provider: 'agentai',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        ...(chatImpl(round, payload?.messages || []) || {}),
      };
    }),
    getAvailableModels: vi.fn().mockReturnValue(['agentai']),
  };
  const registry: any = {
    dispatch: vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'ok' } })),
    ),
    toLLMTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
  };
  const loop = new AgentAILoop(router, registry, [], {
    maxIterations: 4,
    userId: 'u1',
    workspace: WS,
    sessionId: 's1',
    ...opts,
  });
  vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
    (loop as any).contextReady = true;
    (loop as any).context.immutablePrefix = [{ role: 'system', content: 'sys' }];
  });
  return { loop, router, registry, getRound: () => round };
}

/** 观测所有 emit 事件名 (测试内无监听者, 直接吞掉事件是安全的) */
function watchEvents(loop: any): string[] {
  const seen: string[] = [];
  vi.spyOn(loop, 'emit').mockImplementation((name: string) => {
    seen.push(name);
    return true;
  });
  return seen;
}

/** 观测所有 directive (source 名) */
function watchDirectives(loop: any): string[] {
  const seen: string[] = [];
  vi.spyOn(loop.directives, 'add').mockImplementation((source: string) => {
    seen.push(source);
  });
  return seen;
}

// ─────────────────────────────────────────────────────────────────────────────
// 源码契约: 防止重構把守卫改回原样 / 偷偷加 tier 门控
// ─────────────────────────────────────────────────────────────────────────────
describe('批次1 源码契约', () => {
  it('改-1: _failTracker 是实例字段, 局部 duplicateTracker 已归零', () => {
    expect(LOOP_SRC).toMatch(/private _failTracker = new Map<string, number>\(\)/);
    expect(LOOP_SRC, '局部 Map 重建是原 bug 的根因, 不许回来')
      .not.toMatch(/const duplicateTracker = new Map<string, number>\(\)/);
    expect(LOOP_SRC).toMatch(/const duplicateTracker = this\._failTracker/);
    expect(LOOP_SRC, '必须按任务归零, 否则跨 run 累积误报').toMatch(/this\._failTracker\.clear\(\)/);
  });

  it('改-2: 写类重复只提醒不拦截, 且只读白名单未被破坏', () => {
    expect(LOOP_SRC).toMatch(/const WRITE_CLASS_TOOLS = new Set\(\[/);
    expect(LOOP_SRC).toMatch(/this\.ledger\.writeCount\(_wTarget\)/);
    expect(LOOP_SRC).toMatch(/directives\.add\('repeat_write'/);
    // 复用台账既有的只读访问器, 不许另造状态
    expect(LEDGER_SRC).toMatch(/writeCount\(target: string\): number/);
    // 只读工具仍然豁免去重 (历史教训: 误判会导致 AI 卡死)
    expect(LOOP_SRC).toMatch(/READ_ONLY_TOOLS = new Set\(\[[\s\S]*?read_file[\s\S]*?\]\)/);
  });

  it('改-3: 工具调用预算 + 独立迭代硬闸都存在', () => {
    expect(LOOP_SRC).toMatch(/const TOOL_CALL_BUDGET = 200/);
    expect(LOOP_SRC).toMatch(/this\._toolCallCount \+= res\.toolCalls\.length/);
    expect(LOOP_SRC).toMatch(/this\._toolCallCount > TOOL_CALL_BUDGET/);
    expect(LOOP_SRC).toMatch(/directives\.add\('tool_budget_total'/);
    expect(LOOP_SRC, '独立于时间/预算的迭代出口').toMatch(/this\.iteration >= this\.opts\.maxIterations/);
    expect(LOOP_SRC).toMatch(/directives\.add\('iter_cap'/);
    expect(LOOP_SRC).toMatch(/this\._iterCapWarned = false/);
  });

  it('改-4: 目标锚点只在"当前无目标"时回填', () => {
    expect(LOOP_SRC).toMatch(/if \(!this\.ledger\.getGoal\(\)\) \{[\s\S]{0,300}?getActivePlan/);
    expect(LOOP_SRC).toMatch(/await import\('\.\/tools\.js'\)/);
  });

  it('新守卫对所有 tier 生效 — 未新增 _capabilityTier 门控', () => {
    // 2026-10-11 实测基线: 全文 5 处 `_capabilityTier !== 'autonomous'` (元认知/置信度等既有门控)。
    // 这个数字变化 = 有人加了或删了 tier 门控 → 必须人工确认新守卫没被 gate 掉。
    const gates = LOOP_SRC.match(/_capabilityTier !== 'autonomous'/g) || [];
    expect(gates.length, `tier 门控数从基线 5 变为 ${gates.length} — 请确认新守卫未被 gate`).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 改-1: 跨迭代连续失败
// ─────────────────────────────────────────────────────────────────────────────
describe('改-1 跨迭代连续失败计数', () => {
  it('同一工具同参数连续失败 3 轮 → 触发 tool:stuck / dup_fail (原实现恒为 1, 永不触发)', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 3) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${round}`, name: 'run_command', args: { command: 'npm run build' } }],
      };
    }, { maxIterations: 6 });

    // 同样的调用, 每轮都失败
    (registry as any).dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: false, output: 'Error: build failed' } })),
    );

    const events = watchEvents(loop);
    const directives = watchDirectives(loop);

    await loop.run('反复跑 build 直到成功');

    expect(
      events.includes('tool:stuck') || directives.includes('dup_fail'),
      `连续失败 3 轮必须触发卡住信号; 实际 events=${events.filter(e => e.startsWith('tool:')).join(',')} directives=${directives.join(',')}`,
    ).toBe(true);
  }, 60000);

  it('失败后成功会重置计数 (连续语义, 不是累计)', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 5) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${round}`, name: 'run_command', args: { command: 'npm test' } }],
      };
    }, { maxIterations: 6 });

    let n = 0;
    (registry as any).dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => {
        n++;
        // fail, fail, success, fail, fail  → 永远不到"连续 3 次"
        const ok = n === 3;
        return { id: c.id, result: ok ? { success: true, output: 'ok' } : { success: false, output: 'Error: flaky' } };
      }),
    );

    const tracker = (loop as any)._failTracker as Map<string, number>;
    const directives = watchDirectives(loop);
    await loop.run('跑测试');

    expect(directives.includes('dup_fail'), '中间成功过一次 → 不应判定卡住').toBe(false);
    expect(tracker.size === 0 || [...tracker.values()].every(v => v < 3)).toBe(true);
  }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 改-2: 同文件反复写 → 提醒不拦
// ─────────────────────────────────────────────────────────────────────────────
describe('改-2 同目标反复写', () => {
  it('第 3 次改同一文件 → repeat_write 提醒, 但调用仍被派发 (绝不静默丢弃用户改动)', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 4) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        // 每轮内容都不同 → 全签名去重拦不到, 正是漏网场景
        toolCalls: [{ id: `w${round}`, name: 'write_file', args: { file_path: 'src/x.ts', content: `v${round}` } }],
      };
    }, { maxIterations: 6 });

    const writes: string[][] = [];
    (registry as any).dispatch = vi.fn(async (calls: any[]) => {
      writes.push(calls.map((c: any) => c.name));
      return calls.map((c: any) => ({ id: c.id, result: { success: true, output: 'written' } }));
    });

    const directives = watchDirectives(loop);
    await loop.run('改到对为止');

    expect(directives.includes('repeat_write'), '同一文件第 3 次写入必须提醒').toBe(true);
    // 关键反证: 提醒 ≠ 拦截。每次调用都真的到了 registry
    expect(writes.length, '提醒不得阻止派发').toBeGreaterThanOrEqual(3);
    expect((loop as any)._skippedToolCalls.length).toBe(0);
  }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 改-3: 双预算
// ─────────────────────────────────────────────────────────────────────────────
describe('改-3 预算守卫', () => {
  it('累计工具调用超过 TOOL_CALL_BUDGET → tool:budget-exceeded + 要求收尾', async () => {
    // 诚实说明: 这里**预置**计数器到 199 再跑一轮 4 个调用 (→203), 而不是真跑 40+ 轮去凑够 200。
    // 原因: 已存在**每轮** TOOL_BUDGET (:3808, 4~5/轮) 会截断单轮数量, 凑够 200 需要
    // 40 轮以上 —— 实测把 vitest worker 撑爆 (OOM)。累加本身是 trivial 算术, 已由
    // 源码契约断言 (`this._toolCallCount += res.toolCalls.length`); 此处只验证**越线行为**。
    // 这个缺口本身是真的: 每轮都合规, 合计仍可在预算内空转几十轮。
    let loopRef: any;
    const { loop } = makeLoop((round) => {
      if (round === 1) loopRef._toolCallCount = 199; // run() 已在循环前归零, 故在首轮内预置
      if (round > 1) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [0, 1, 2, 3].map((k) => ({
          id: `b${round}_${k}`, name: 'read_file', args: { file_path: `src/f${round}_${k}.ts` },
        })),
      };
    }, { maxIterations: 5 });
    loopRef = loop;

    const events = watchEvents(loop);
    const directives = watchDirectives(loop);
    await loop.run('读一大堆文件');

    expect(events.includes('tool:budget-exceeded'), '累计超预算必须发出信号').toBe(true);
    expect(directives.includes('tool_budget_total')).toBe(true);
    expect((loop as any)._toolCallCount).toBe(203);
    // 软着陆: 置 _hardStopNext 让 AI 在下一轮收尾, 而不是硬 break 掉长任务
    expect((loop as any)._hardStopNext).toBe(false); // 已在下一轮循环顶部消费
    expect(events.includes('tool:budget-exceeded')).toBe(true);
  }, 60000);

  it('迭代达到 maxIterations → 先软提醒, 再一轮才硬退出', async () => {
    const { loop } = makeLoop((round) => {
      if (round > 8) return { content: '兜底收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `i${round}`, name: 'read_file', args: { file_path: `src/y${round}.ts` } }],
      };
    }, { maxIterations: 2 });

    const caps: any[] = [];
    vi.spyOn(loop as any, 'emit').mockImplementation((name: string, payload: any) => {
      if (name === 'loop:iteration-cap') caps.push(payload);
      return true;
    });

    await loop.run('一直读文件');

    expect(caps.length, '必须触发迭代上限出口').toBeGreaterThanOrEqual(2);
    expect(caps[0].hard, '第一轮应软着陆 (避免硬中断长任务)').toBe(false);
    expect(caps[caps.length - 1].hard, '警告一轮后必须硬退出').toBe(true);
    expect((loop as any).iteration, '硬退出不得越过上限太多').toBeLessThanOrEqual(4);
  }, 60000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 改-4: 目标锚点冷启动回填
// ─────────────────────────────────────────────────────────────────────────────
describe('改-4 目标锚点回填', () => {
  it('台账为空时从 active-plan.json 回填目标', async () => {
    const { loop } = makeLoop((round) => {
      if (round > 1) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'p1', name: 'read_file', args: { file_path: 'src/z.ts' } }],
      };
    }, { maxIterations: 3 });

    // 预置持久化计划 (模拟上次会话重启后落盘的 goal)
    const { mkdirSync, writeFileSync } = require('node:fs');
    mkdirSync(join(WS, '.agentai'), { recursive: true });
    writeFileSync(
      join(WS, '.agentai', 'active-plan.json'),
      JSON.stringify({ id: 'plan1', goal: '重构支付模块的错误处理', subtasks: [{ id: 's1', status: 'pending' }] }),
      'utf-8',
    );

    // 空消息 → 不触发用户输入覆盖, 走纯回填路径
    await loop.run('   ');

    expect((loop as any).ledger.getGoal()).toContain('重构支付模块');
  }, 60000);
});
