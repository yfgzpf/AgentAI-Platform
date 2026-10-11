/**
 * 运行时守卫回归测试 — 批次1「止血」(2026-10-11)
 * ==========================================================================
 * 批次1 修的是 4 个**真缺口**(不是新建功能层), 每个都配行为级回归:
 *   改-1  _failTracker   跨迭代连续失败计数 (原每轮重建 → "失败3次换方案"从未生效)
 *   改-2  repeat_write   同目标反复写提醒 (全签名去重拦不到"同文件改来改去")
 *   改-3  tool_budget    工具调用总预算 + 独立迭代硬闸 (原上限埋在超时块里)
 *   改-4  goal anchor    冷启动从 active-plan.json 回填目标
 *
 * 批次2「模型切换 / 自动化让路」(2026-10-11, 见文件下半部分):
 *   改-5  pro 下线        deepseek-v4-pro 从注册表/推荐/救援链/GUI 删除 + 别名兜底
 *   改-6  modelLocked     用户显式选定的模型不再被跨模型替换
 *   改-7  rescue budget   救援链 60s 预算改 180s (原来每层窗口短于正常 300s 必挂)
 *   改-8  history-compress MAX_MSGS 比较对象修正 — user 消息不再被吞 (空回复根因)
 *   改-9  runtime-activity 用户任务期间 cron 让路 + officecli 不再同步阻塞事件循环
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
import { touchUserTask, isUserTaskActive, _resetRuntimeActivity, USER_TASK_TTL_MS } from './runtime-activity.js';

vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

const LOOP_SRC = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
const LEDGER_SRC = readFileSync(new URL('./task-ledger.ts', import.meta.url), 'utf-8');
const ROUTER_SRC = readFileSync(new URL('./llm-router.ts', import.meta.url), 'utf-8');
const AUTOMATION_SRC = readFileSync(new URL('./automation-engine.ts', import.meta.url), 'utf-8');
const CAPS_SRC = readFileSync(new URL('./model-capabilities.ts', import.meta.url), 'utf-8');
const CLASSIFIER_SRC = readFileSync(new URL('./model-classifier.ts', import.meta.url), 'utf-8');

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

// ═════════════════════════════════════════════════════════════════════════════
// 批次2 (2026-10-11): 模型切换逻辑 + 自动化让路
// ═════════════════════════════════════════════════════════════════════════════

describe('改-5 pro 下线 — 注册表 / 别名兜底', () => {
  it('classifier 与 capabilities 都不再注册 deepseek-v4-pro', () => {
    // provider 级条目
    expect(CLASSIFIER_SRC).not.toMatch(/id: 'deepseek:v4-pro'/);
    expect(CAPS_SRC).not.toMatch(/id: 'deepseek-pro'/);
    // 但保留「为什么删」的痕迹, 免得后人以为是误删又加回来
    expect(CLASSIFIER_SRC).toMatch(/deepseek:v4-pro 已下线/);
  });

  it('推荐规则不再把任务派给 pro (改指向 v4-flash)', () => {
    expect(CLASSIFIER_SRC).not.toMatch(/recommended: 'deepseek:v4-pro'/);
    expect(CLASSIFIER_SRC.match(/recommended: 'deepseek:v4-flash'/g)?.length).toBe(4);
  });

  it('flash 的 complexityRange 放宽到 hard (补 pro 删除后的覆盖空洞)', () => {
    expect(CLASSIFIER_SRC).toMatch(/complexityRange: \['ultraSimple', 'hard'\]/);
  });

  it('router 层按 provider 作用域做别名兜底 (中继厂商不能被误改成 deepseek-flash)', () => {
    expect(ROUTER_SRC).toMatch(/const RETIRED_MODEL_ALIASES: Record<string, string>/);
    expect(ROUTER_SRC).toMatch(/'deepseek:deepseek-v4-pro': 'deepseek-flash'/);
    // 中继厂商目录里没有 deepseek-flash, 只能退到它们认识的 deepseek-v4-flash
    expect(ROUTER_SRC).toMatch(/'alrc:deepseek-v4-pro': 'deepseek-v4-flash'/);
    // 两个 modelName 计算分支都必须过别名
    expect(ROUTER_SRC.match(/modelName = resolveRetiredModelAlias\(id,/g)?.length).toBe(2);
  });

  it('capabilities 别名表覆盖 pro (旧 id 的 contextWindow 仍可解析)', () => {
    expect(CAPS_SRC).toMatch(/'deepseek-v4-pro': 'deepseek-flash'/);
  });
});

describe('改-6 modelLocked — 用户显式选定的模型不被跨模型替换', () => {
  it('loop 在 userPickedModel 时把 modelLocked 传给 router', async () => {
    const { loop, router } = makeLoop((round) =>
      round > 1 ? { content: '收尾', finishReason: 'stop' } : { content: 'ok', finishReason: 'stop' },
    { userPickedModel: true, maxIterations: 3 });

    await loop.run('用我选的模型跑');

    const payload = (router.chat as any).mock.calls[0]?.[0];
    expect(payload?.modelLocked, '用户指定模型必须带 modelLocked, 否则 router 会静默换成付费模型').toBe(true);
  });

  it('未指定模型时 modelLocked 为 false (保留自动降级能力)', async () => {
    const { loop, router } = makeLoop(() => ({ content: 'ok', finishReason: 'stop' }), { maxIterations: 3 });

    await loop.run('随便聊聊');

    expect((router.chat as any).mock.calls[0]?.[0]?.modelLocked).toBe(false);
  });

  it('router 的跨 provider 兜底分支都被 modelLocked 关掉', () => {
    // 免费限流 → 静默换 deepseek(付费) 是用户明确抱怨的「不该切的时候切」
    expect(ROUTER_SRC).toMatch(/req\.modelLocked \? undefined : this\.providers\.get\('deepseek'\)/);
    expect(ROUTER_SRC).toMatch(/req\.modelLocked \? undefined : this\.providers\.get\('dxnt'\)/);
  });

  it('loop 侧的自动切换也被 userPickedModel 拦住, 且给用户可理解的说明', () => {
    expect(LOOP_SRC).toMatch(/this\.opts\.userPickedModel\) \{[\s\S]{0,600}?model:lock-refused/);
    expect(LOOP_SRC).toMatch(/🔒 用户显式选定的模型不可用/);
  });
});

describe('改-7 救援链预算', () => {
  it('预算 180s, 且 L2「跨模型升级到 pro」已删除', () => {
    expect(LOOP_SRC).toMatch(/const RESCUE_BUDGET_MS = 180_000/);
    // 救援等级只剩 3 层: L1 同模型 / L3 最小工具 / L4 无工具。
    // 计数比字符串匹配可靠 —— 注释里提到 "L2 ... pro" 是解释"为什么删", 不该被判失败。
    expect(LOOP_SRC.match(/rescueReq\(\d/g)?.length, 'L2 若回来会多出第 4 个救援层').toBe(3);
    expect(LOOP_SRC).not.toMatch(/✓ L2 rescue/);
  });
});

describe('改-8 历史压缩不再吞掉 user 消息', () => {
  it('被压掉的 user 消息原样搬回 recent (不再出现 appendOnlyLog 0 条 user)', () => {
    // 原实现 head.slice(-10) 之外的东西全进摘要后丢弃, 用户原始诉求不再是真实 user turn
    // → router 注入泛泛的"请继续完成之前的任务。" → 空回复 → 救援链 → 任务中断。
    expect(LOOP_SRC).toMatch(/const headUsers = head\.filter\(m => m\.role === 'user'\)/);
    expect(LOOP_SRC).toMatch(/const carriedUsers = headUsers\.length <= 3/);
    expect(LOOP_SRC).toMatch(/const recent = \[\.\.\.carriedUsers, \.\.\.tail\]/);
    // 三个重建 messages 的分支都必须用 recent (而非裸 tail)
    expect(LOOP_SRC.match(/\.\.\.recent,/g)?.length, 'summary 分支必须带上 carriedUsers').toBe(3);
  });

  it('摘要输入仍包含 user (否则被压掉的诉求连摘要里都看不到)', () => {
    // 实测教训: 曾把 old 改成"非 user", 直接打破 context-fidelity 的 3 条契约, 且
    // head 全为 user 时 old.length===0 → 整段压缩被 if (old.length>0) 跳过 → 摘要彻底消失。
    expect(LOOP_SRC).toMatch(/const old = head;/);
    expect(LOOP_SRC).not.toMatch(/const old = head\.filter\(m => m\.role !== 'user'\)/);
    expect(LOOP_SRC).toMatch(/if \(old\.length > 0\) \{/);
  });
});

describe('改-9 自动化让路 + 不再同步阻塞事件循环', () => {
  it('cron:tick 顶部按 isUserTaskActive() 让路', () => {
    expect(AUTOMATION_SRC).toMatch(/import \{ isUserTaskActive \} from '\.\/runtime-activity\.js'/);
    const tickIdx = AUTOMATION_SRC.indexOf("this.on('cron:tick'");
    const guardIdx = AUTOMATION_SRC.indexOf('isUserTaskActive()');
    expect(tickIdx, '找不到 cron:tick 处理器').toBeGreaterThan(-1);
    expect(guardIdx, '让路判断必须在 handler 顶部').toBeGreaterThan(tickIdx);
    // 让路 ≠ 失败: 不得走 failCount / 自动禁用路径
    expect(AUTOMATION_SRC.slice(guardIdx, guardIdx + 200)).not.toMatch(/failCount/);
  });

  it('loop 在入口 + 每轮迭代续期心跳', () => {
    expect(LOOP_SRC).toMatch(/import \{ touchUserTask \} from '\.\/runtime-activity\.js'/);
    expect(LOOP_SRC.match(/touchUserTask\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('TTL 心跳语义: 过期自动失效, 无需 enter/exit 配对 (无泄漏风险)', () => {
    vi.useFakeTimers();
    try {
      _resetRuntimeActivity();
      expect(isUserTaskActive(), '未开始时应为 false').toBe(false);
      touchUserTask();
      expect(isUserTaskActive()).toBe(true);
      vi.advanceTimersByTime(USER_TASK_TTL_MS - 1);
      expect(isUserTaskActive(), 'TTL 内仍视为进行中').toBe(true);
      vi.advanceTimersByTime(2);
      expect(isUserTaskActive(), 'TTL 过期后自动让路结束 (无需清理代码)').toBe(false);
    } finally {
      _resetRuntimeActivity();
      vi.useRealTimers();
    }
  });

  it('officecli 不再用 execSync 阻塞事件循环', () => {
    const TOOLS_SRC = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');
    const officeStart = TOOLS_SRC.indexOf('officecli: async (args)');
    expect(officeStart).toBeGreaterThan(-1);
    const officeBody = TOOLS_SRC.slice(officeStart, officeStart + 4000);
    expect(officeBody, 'execSync 会冻结整个 gateway (SSE 停推/其他会话卡死)').not.toMatch(/execSync\(/);
    expect(officeBody).toMatch(/exec\(cmd, \{/);
  });
});

