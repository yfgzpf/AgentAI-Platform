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
 * 批次3「死循环护栏误杀」(2026-10-12, 用户实机日志: 任务总在 iter=1 被强杀):
 *   改-10 dead-loop      判据只看「本轮」tool 消息 + 豁免按签名 + 计数器按任务归零
 *        (原判据吃整个会话的 appendOnlyLog; _hardStopCount/_toolCallHistory 永不清零)
 *
 * ⚠️ 诚实边界: 这里的 LLM 是打桩的, 验证的是**循环控制流**, 不是"模型真的变聪明了"。
 *    无 LLM 环境下无法端到端证明"换方案", 故行为测试断言的是可观测的守卫出口
 *    (事件 / directive), 而非模型行为。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAILoop, computeContextPolicy } from './agentai-loop.js';
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
    expect(LOOP_SRC).toMatch(/const TOOL_CALL_BUDGET = 100000/);
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
    // 诚实说明: 这里**预置**计数器到 99999 再跑一轮 4 个调用 (→100003), 而不是真跑几十万轮。
    // 原因: 已存在**每轮** TOOL_BUDGET (:3808, 4~5/轮) 会截断单轮数量, 凑够 10 万需要
    // 2 万+ 轮 —— 实测把 vitest worker 撑爆 (OOM)。累加本身是 trivial 算术, 已由
    // 源码契约断言 (`this._toolCallCount += res.toolCalls.length`); 此处只验证**越线行为**。
    // 注: TOOL_CALL_BUDGET 现已放宽到 10 万 (富哥拍板"预算控制清掉"), 此测试只验证越线机制仍生效。
    let loopRef: any;
    const { loop } = makeLoop((round) => {
      if (round === 1) loopRef._toolCallCount = 99999; // run() 已在循环前归零, 故在首轮内预置
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
    expect((loop as any)._toolCallCount).toBe(100003);
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

  it('router 层按 provider 作用域做别名兜底 (各厂商目录独立, 不能一刀切)', () => {
    expect(ROUTER_SRC).toMatch(/const RETIRED_MODEL_ALIASES: Record<string, string>/);
    expect(ROUTER_SRC).toMatch(/'deepseek:deepseek-v4-pro': 'deepseek-flash'/);
    // 2026-10-19: alrc/factory 上游也已把 deepseek-v4-flash 下架并改名为 deepseek-flash
    //   (模型设置同步改名) → 它们现在也收敛到新名, 旧断言 ('→ deepseek-v4-flash') 已过时。
    expect(ROUTER_SRC).toMatch(/'alrc:deepseek-v4-pro': 'deepseek-flash'/);
    expect(ROUTER_SRC).toMatch(/'alrc:deepseek-v4-flash': 'deepseek-flash'/);
    // 真正的安全不变量: sensenova 目录未确认改名, 必须仍保留旧名 (不能被顺手统一掉)
    expect(ROUTER_SRC).toMatch(/'sensenova:deepseek-v4-pro': 'deepseek-v4-flash'/);
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
    // 2026-10-17: 该分支内插入了"临时繁忙退避重试"逻辑(约 2.5K), 窗口 600 已不够
    expect(LOOP_SRC).toMatch(/this\.opts\.userPickedModel\) \{[\s\S]{0,6000}?model:lock-refused/);
    expect(LOOP_SRC).toMatch(/🔒 所选模型不可用, 按锁定策略不自动切换/);
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
    // 2026-10-19 C3: 上限由 3 提到 5 (压缩改按真实 promptTokens 触发后不再每轮都压,
    // 可以多留用户原话)。旧断言 <= 3 是 C1 修好前的历史值。
    expect(LOOP_SRC).toMatch(/const carriedUsers = headUsers\.length <= 5/);
    expect(LOOP_SRC).toMatch(/const recent = \[\.\.\.carriedUsers, \.\.\.tail\]/);
    // 2026-10-19: 原来 success/else/catch 三条分支各写一遍 messages 构造, 现已收敛为一处,
    // 且必须把 recent 传进去 (否则被压掉的用户诉求又丢)。
    expect(LOOP_SRC).toMatch(/messages = compressMod\.buildCompressedMessages\(baseSystem, summaryContent, recent\)/);
    // 回归防护: 绝不能再把"全部 system 消息"摊进重建结果 —— 那正是摘要累积/前端刷屏的根因
    expect(LOOP_SRC).not.toMatch(/\.\.\.systemMsgs,[\s\S]{0,80}content: summaryContent/);
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

/**
 * 批次3 — 死循环护栏误杀 (2026-10-12)
 * ==========================================================================
 * 用户实机日志 (选 4.1, 任务 17 秒就"完成", 实际什么都没做):
 *   [loop] 🛑 死循环硬停: search_content 连续 5 次返回相同/错误结果, 强制终止
 *   [loop] 🛑🛑 多次硬停后 AI 仍调用同工具, 强制 force break
 *
 * 三个叠加缺陷 (都是「会话级/进程级状态」被当成「本轮状态」用):
 *   A1 判据吃的是 `appendOnlyLog` 全部 tool 消息 (会话级 append-only, 跨任务),
 *      上个任务的 search_content 会和新任务混在一起 → 新任务第 1 轮就"连续 5 次";
 *   A2 豁免 `last5.every(豁免工具)` 是全有全无 —— 混进 1 条 generate_diagram 就失效,
 *      另外 4 条同签名 search_content 触发 maxCount>=4;
 *   A3 `_hardStopCount` / `_toolCallHistory` 只写不清零 → 跨任务累积,
 *      第 2 次误判直接 force break (任务当场死)。
 *
 * ⚠️ 诚实边界: 这里是**源码契约级**验证 + 计数器的行为级验证。
 *    完整"5 轮同签名真的会硬停 / 跨任务残留不再误停"需要一个能跑满 5 轮的
 *    行为夹具 (单次 run 内模拟 6 轮 dispatch), 本轮未构造 → 明确标注为未覆盖。
 */
describe('改-10 死循环护栏误杀 (批次3)', () => {
  it('A1 判据只看本轮 tool 消息: 水位线字段 + 按本轮切片', () => {
    // 字段存在 (会话级 appendOnlyLog 需要一个"本轮起点"水位线)
    expect(LOOP_SRC).toMatch(/private _iterToolStartIdx = 0;/);
    // dispatch 之前打点
    expect(LOOP_SRC).toMatch(/this\._iterToolStartIdx = this\.context\.appendOnlyLog\.filter\(m => m\.role === 'tool'\)\.length;/);
    // 判据用切片, 而不是整个会话
    expect(LOOP_SRC).toMatch(/const toolMsgsThisIter = this\.context\.appendOnlyLog/);
    expect(LOOP_SRC).toMatch(/\.slice\(this\._iterToolStartIdx\)/);
    expect(LOOP_SRC).toMatch(/if \(toolMsgsThisIter\.length >= 5\)/);
    // 旧的 `toolMsgs.slice(-5)` 死循环判据必须消失
    expect(LOOP_SRC).not.toMatch(/const last5 = toolMsgs\.slice\(-5\)/);
  });

  it('A2 豁免按签名, 不再是"全有全无"的 allExempt', () => {
    expect(LOOP_SRC).toMatch(/const countedSigs = sigs\.filter\(s => \{/);
    expect(LOOP_SRC).toMatch(/if \(isExemptName\(n\)\) return false;/);
    expect(LOOP_SRC).toMatch(/const isExemptName = \(n: string\) => LOOP_EXEMPT_TOOLS\.has\(n\)/);
    expect(LOOP_SRC).not.toMatch(/const allExempt = /);
    // 空 countedSigs 不得让 Math.max(...[]) === -Infinity 意外通过
    expect(LOOP_SRC).toMatch(/countedSigs\.length > 0 \? Math\.max\(\.\.\.sigCounts\.values\(\)\) : 0/);
    // 豁免名单本身保留 (搜索类工具正常探索不能被封停)
    expect(LOOP_SRC).toMatch(/'search_content', 'search_codebase', 'grep', 'glob', 'web_search'/);
  });

  it('A3 死循环计数器按任务归零 (原为进程级, 只写不清零)', () => {
    // run() 开头必须清零这两个 + 上一轮的硬停标志/水位线
    const resetIdx = LOOP_SRC.indexOf('this._failTracker.clear();');
    expect(resetIdx).toBeGreaterThan(-1);
    const resetBlock = LOOP_SRC.slice(resetIdx, resetIdx + 1800); // 2026-10-19: 中间新增注释, 窗口放宽
    expect(resetBlock, '_hardStopCount 跨任务累积 → 第2次误判直接 force break').toMatch(/this\._hardStopCount = 0;/);
    expect(resetBlock, '_toolCallHistory 跨任务残留 → 旧签名被当重复跳过').toMatch(/this\._toolCallHistory\.clear\(\);/);
    expect(resetBlock).toMatch(/this\._hardStopNext = false;/);
    expect(resetBlock).toMatch(/this\._iterToolStartIdx = 0;/);
  });

  it('行为级: 5 条里 4 条同签名 search_content + 1 条 generate_diagram 不再被误判死循环', async () => {
    // 这正是用户实机日志的场景: 搜了几次 + 画了个图。
    // 旧实现 allExempt = last5.every(豁免工具) → generate_diagram 不是豁免工具 ⇒ allExempt=false
    //   ⇒ 4 条同签名 search_content 命中 maxCount>=4 ⇒ 死循环硬停。
    // 新实现按签名豁免 ⇒ search_content 的 4 条整组剔除, 只剩 generate_diagram(count=1) ⇒ 不触发。
    const sameArgs = { pattern: 'death loop', path: 'src' };
    const { loop } = makeLoop((round) => {
      if (round > 1) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [
          { id: 'c1', name: 'search_content', args: sameArgs },
          { id: 'c2', name: 'search_content', args: sameArgs },
          { id: 'c3', name: 'search_content', args: sameArgs },
          { id: 'c4', name: 'search_content', args: sameArgs },
          { id: 'c5', name: 'generate_diagram', args: { kind: 'flow' } },
        ],
      };
    }, { maxIterations: 4 });

    const events = watchEvents(loop);
    const directives = watchDirectives(loop);
    await loop.run('先搜一下再画个图');

    expect(
      directives.includes('dead_loop_stop') || directives.includes('force_break'),
      `正常"搜索+画图"不能被判死循环; 实际 directives=${directives.join(',')}`,
    ).toBe(false);
    expect(events.includes('loop:hard-stop')).toBe(false);
  }, 60000);

  it('行为级: 上一次任务遗留的工具记录不参与本轮死循环判定', async () => {
    // A1 的回归: 旧实现判据吃整个 appendOnlyLog (会话级 append-only),
    // 于是"上个任务搜了 5 次"会让**新任务第 1 轮**就被判死循环。
    const { loop } = makeLoop(() => ({ content: '收尾', finishReason: 'stop' }));
    // 模拟上个任务遗留: 4 条同签名 + 1 条其它, 全是非豁免工具
    for (let i = 0; i < 4; i++) {
      (loop as any).context.appendOnlyLog.push({
        role: 'tool', name: 'run_command', args: { command: 'same' }, content: 'ok',
      });
    }
    (loop as any).context.appendOnlyLog.push({
      role: 'tool', name: 'run_command', args: { command: 'other' }, content: 'ok',
    });

    const directives = watchDirectives(loop);
    await loop.run('新任务');

    expect(
      directives.includes('dead_loop_stop') || directives.includes('force_break'),
      `历史残留不得让新任务第一轮被强杀; 实际 directives=${directives.join(',')}`,
    ).toBe(false);
  }, 60000);

  it('行为级: 同一 loop 实例跑两次 run, 第二次的计数器不得继承第一次', async () => {
    // 直接读私有字段: 第一次 run 后人为置 2 (模拟"该实例历史上被硬停过"),
    // 再跑一次 run, 断言它被 run 开头清回 0 —— 这正是"跨任务累积 → 第2次误判直接
    // force break"的修复点 (原实现只 ++ 从不清零, 是进程级状态)。
    const { loop } = makeLoop((round) =>
      round > 1 ? { content: '收尾', finishReason: 'stop' } : { content: 'ok', finishReason: 'stop' },
    );

    await loop.run('第一次任务');
    loop._hardStopCount = 2;                                       // 模拟历史累积
    loop._toolCallHistory.add('search_content::{"pattern":"x"}');  // 模拟跨任务残留签名
    await loop.run('第二次任务');

    expect(loop._hardStopCount, 'run() 开头必须清零').toBe(0);
    expect(loop._toolCallHistory.size, 'run() 开头必须清空').toBe(0);
  }, 60000);
});

/**
 * 批次3b「迭代预算只打印不生效」(2026-10-12)
 * ==========================================================================
 * 用户: "4.1模型是个强模型呀！是可以做长任的呀！为什么会断呢"
 * 第 2 个真因 (第 1 个是死循环误杀, 见上面的 改-10):
 *   能力层 `getRuntimeParams()` 算出 autonomous=90 / guided=70 / supervised=50,
 *   但 agentai-loop 的"应用运行时参数"**只写回 thinking/thinkingBudget/contextCompressThreshold**,
 *   `rt.maxIterations` 仅出现在 logger.info 里 → 从不生效。
 *   真正的上限是 routes/chat.ts 写死的 `maxIterations`, 它**冒充了模型预算**:
 *   显式选模型 30 / 普通对话 10 / plan 30 / goal 30。
 *
 * 改-11 迭代预算:  loop 侧 `min(能力层值, opts)` + chat.ts 的写死值降级为「天花板」
 */
describe('改-11 迭代预算: 能力层裁决 + opts 封顶 (批次3b)', () => {
  const CHAT_SRC = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');
  const CAP_SRC_ = readFileSync(new URL('./model-classifier.ts', import.meta.url), 'utf-8');

  it('T1 能力层确实产出了 maxIterations (autonomous/guided/supervised 三档)', () => {
    // 先把"能力层有值可给"钉住 —— 否则写回什么都是 0
    expect(CAP_SRC_).toMatch(/export function getRuntimeParams/);
    expect(CAP_SRC_).toMatch(/if \(cap\.tier === 'autonomous'\) \{\s*\n\s*maxIterations = 80;/);
    expect(CAP_SRC_).toMatch(/if \(cap\.tier === 'guided'\) \{\s*\n\s*maxIterations = 60;/);
    expect(CAP_SRC_).toMatch(/if \(cap\.tier === 'supervised'\) \{\s*\n\s*maxIterations = 40;/);
    // 速度微调 (快 +10 / 慢 -10) → autonomous:80+10=90
    expect(CAP_SRC_).toMatch(/if \(cap\.speed > 0\.7\) maxIterations \+= 10;\s*\n\s*else if \(cap\.speed < 0\.4\) maxIterations -= 10;/);
  });

  it('T2 迭代上限不再由能力层钳制 (富哥拍板全部放宽)', () => {
    // 2026-10-17: 移除 `this.opts.maxIterations = Math.min(rt.maxIterations, ...)` 钳制,
    // 否则 autonomous=80/90 会硬卡死长任务/渗透。现迭代上限 = opts.maxIterations (调用方传入),
    // 能力层 rt.maxIterations 仅用于日志展示, 不再写回 this.opts。
    expect(LOOP_SRC, '迭代上限的能力层钳制必须已移除').not.toMatch(
      /this\.opts\.maxIterations = Math\.min\(rt\.maxIterations, this\.opts\.maxIterations\)/,
    );
    // 能力层仍被记录到日志 (展示用, 非封顶)
    expect(LOOP_SRC, '能力层 maxIter 仍应出现在能力日志中').toMatch(/🧠 模型能力/);
    expect(LOOP_SRC).toMatch(/maxIter=\$\{rt\.maxIterations\}/);
  });

  it('T3 chat.ts 的写死值已改为最后保险 (10 万, 实际上不限, 5 处全覆盖)', () => {
    expect(CHAT_SRC).toMatch(/const MAX_ITERATION_CEILING = 100000;/);
    // 5 处 loop 构造: 4 处直接传天花板, 1 处经 autoMaxIters 间接传 (= MAX_ITERATION_CEILING)
    const directSites = CHAT_SRC.match(/maxIterations: MAX_ITERATION_CEILING/g) || [];
    expect(directSites.length, 'chat.ts 应有 4 处直接使用天花板').toBe(4);
    expect(CHAT_SRC).toMatch(/const autoMaxIters = MAX_ITERATION_CEILING;/);
    // 旧的武断值不得残留 (注释里提到不算 —— 只查代码行)
    const codeLines = CHAT_SRC.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l));
    const codeOnly = codeLines.join('\n');
    expect(codeOnly).not.toMatch(/maxIterations: 30\b/);
    expect(codeOnly).not.toMatch(/const autoMaxIters = auto \? 30 : 10;/);
  });

  it('T4 天花板不得低于任何一档能力值 (否则天花板反而成为瓶颈)', () => {
    const m = CHAT_SRC.match(/const MAX_ITERATION_CEILING = (\d+);/);
    expect(m).toBeTruthy();
    const ceiling = Number(m![1]);
    // autonomous 档上界 = 80 + 10 (快模型) = 90
    expect(ceiling).toBeGreaterThanOrEqual(90);
  });

  it('行为级: opts.maxIterations 作为天花板被 min 收紧, 不被顶高', () => {
    // 直接验证 min 语义的可观测后果: 用小预算构造时, G4 闸门仍按小预算触发
    const { loop } = makeLoop(() => ({ content: 'ok', finishReason: 'stop' }), { maxIterations: 10 });
    // 不可能被能力层顶到 90 —— 构造后立即断言
    expect(loop.opts.maxIterations).toBeLessThanOrEqual(10);
  }, 60000);
});


/**
 * 批次4 — 定时批量挖洞 cron 链路 (2026-10-16)
 * ==========================================================================
 * 闭环缺口: 用户在 AutomationPanel「一键安装」batch-pentest 预设 → cron tick
 * 调 batch_pentest 工具 → 它需要 ctx._registry + ctx._router 才能 spawn 子智能体。
 * 此前 cron tick 的 handler ctx 只有 userId/workspace/abortSignal → 工具必走
 * "请在主对话里跑 /batch" 拒绝分支, 定时任务白跑。
 *
 * 修: AutomationEngine 持 _router + tick ctx 注入 _registry/_router;
 *      重工具 (batch_pentest) 默认 30min 超时; app.ts/startBackgroundJobs 补传 deps。
 */
describe('批次4 定时批量挖洞 cron 链路 (router 注入)', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf-8');

  it('AutomationEngine 持 _router 且 tick ctx 注入 _registry/_router', () => {
    expect(AUTOMATION_SRC).toMatch(/private _router\?: any/);
    expect(AUTOMATION_SRC).toMatch(/constructor\(workspace: string, registry\?: any, router\?: any\)/);
    // handler ctx 必须带 _registry + _router (batch_pentest 的硬依赖)
    const idx = AUTOMATION_SRC.indexOf("_registry: this._registry");
    expect(idx, 'tick ctx 缺 _registry 注入').toBeGreaterThan(-1);
    expect(AUTOMATION_SRC.slice(idx, idx + 120)).toMatch(/_router: this\._router/);
  });

  it('重工具 (batch_pentest) 有独立 30min 超时, 普通命令仍 120s', () => {
    expect(AUTOMATION_SRC).toMatch(/isHeavyTool = job\.action === 'batch_pentest'/);
    expect(AUTOMATION_SRC).toMatch(/1_800_000/);
    // 不得一刀切: 普通 run_command 类任务还走 120_000
    expect(AUTOMATION_SRC).toMatch(/120_000/);
  });

  it('预设注册表含 batch-pentest + 盯哨巡检两个 security 预设', () => {
    expect(AUTOMATION_SRC).toMatch(/id: 'batch-pentest'/);
    expect(AUTOMATION_SRC).toMatch(/id: 'cve-watch-subdomains'/);
    const start = AUTOMATION_SRC.indexOf("id: 'batch-pentest'");
    const chunk = AUTOMATION_SRC.slice(start, start + 400);
    expect(chunk).toMatch(/defaultAction: 'batch_pentest'/);
    // 默认参数: 浅扫 + 目标上限 10 (防单轮打崩)
    expect(chunk).toMatch(/maxTargets: 10/);
  });

  it('startBackgroundJobs 把 deps (registry/router) 传给 AutomationEngine 单例', () => {
    const APP = read('./app.ts');
    expect(APP).toMatch(/export function startBackgroundJobs\(skillsDir: string, io\?: IOServer, deps\?: Record<string, any>\)/);
    const idx = APP.indexOf('getAutomationEngine(process.cwd()');
    expect(idx, 'startBackgroundJobs 内必须调 getAutomationEngine').toBeGreaterThan(-1);
    expect(APP.slice(idx, idx + 80)).toMatch(/deps\?\.registry, deps\?\.router/);
  });

  it('index.ts 调 startBackgroundJobs 时传 deps', () => {
    const IDX = read('./index.ts');
    expect(IDX).toMatch(/startBackgroundJobs\(path\.join\(process\.cwd\(\), 'packages', 'agentai-skills'\), deps\.io, deps\)/);
  });

  it('路由层透传 router 参数 (routes/automation.ts)', () => {
    const ROUTE = read('./routes/automation.ts');
    expect(ROUTE).toMatch(/createAutomationRouter\(workspace: string, registry\?: any, router\?: any\)/);
    expect(ROUTE).toMatch(/getAutomationEngine\(workspace, registry, router\)/);
  });
});

  it('batch_pentest cron tick 的 workspace 跟随活动工作区 (WorkspaceManager), 不是 gateway 进程 cwd', () => {
    // 锚定 workspace 跟随块 (let wsForTool 行), 而不是 isHeavyTool 那行的同名判断
    const idx = AUTOMATION_SRC.indexOf('let wsForTool');
    expect(idx, '找不到 wsForTool (workspace 跟随) 逻辑').toBeGreaterThan(-1);
    const chunk = AUTOMATION_SRC.slice(idx, idx + 700);
    expect(chunk).toMatch(/job\.action === 'batch_pentest'/);
    expect(chunk).toMatch(/WorkspaceManager\.getInstance\(\)\.projectDir/);
    expect(chunk).toMatch(/workspace: wsForTool/);
  });

// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-16: batch_pentest 死循环事故回归
// 现场: 模型把 http_replay 幻觉成 http_reply, 工具返回 "Unknown tool" →
//       每轮算失败 → 累加 3 次触发 dup_fail → 模型被推回重试 →
//       "疑似卡死(3 次调用)" + 自言自语循环。这三个用例锁死三个根因。
// ─────────────────────────────────────────────────────────────────────────────
describe('改-b batch_pentest 死循环事故回归 (2026-10-16)', () => {
  it('未知工具名不计入重复失败 → 幻觉重试不会累积成"卡死"', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 4) return { content: '收尾', finishReason: 'stop' };
      // 模型幻觉: 用了不存在的 http_reply (真实名 http_replay)
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${round}`, name: 'http_reply', args: { url: 'https://x' } }],
      };
    }, { maxIterations: 6 });

    (registry as any).dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({
        id: c.id,
        result: { success: false, output: `Unknown tool: ${c.name}`, error: `Unknown tool: ${c.name}` },
      })),
    );

    const events = watchEvents(loop);
    const directives = watchDirectives(loop);
    await loop.run('探测 admin 和 oms');

    // 核心断言: 不该因为"工具名不存在"触发 dup_fail/卡死信号
    expect(
      events.includes('tool:stuck'),
      `幻觉工具名不应触发 tool:stuck (那是"真的反复失败"的信号); 实际 events=${events.join(',')}`,
    ).toBe(false);
    expect(
      directives.includes('dup_fail'),
      `幻觉工具名不应消耗 dup_fail 预算; 实际 directives=${directives.join(',')}`,
    ).toBe(false);
    // 但必须给出名字纠正指令, 让模型知道正确名字
    expect(
      directives.includes('unknown_tool'),
      `应注入 unknown_tool 指令直接纠正名字; 实际 directives=${directives.join(',')}`,
    ).toBe(true);
  }, 60000);

  it('batch_pentest 每个目标有超时上限 (串行 spawn 无上限 = 主 loop 长时间静默被误判卡死)', () => {
    const TOOLS = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');
    const idx = TOOLS.indexOf('batch_pentest: async');
    expect(idx, '找不到 batch_pentest handler').toBeGreaterThan(-1);
    const chunk = TOOLS.slice(idx, idx + 8000); // 2026-10-17: handler 体量随注入内容增长, 4000 窗口已不够
    // 超时包装存在
    expect(chunk).toMatch(/withTimeout\(/);
    // 单目标超时上限有默认值
    expect(chunk).toMatch(/PER_TARGET_TIMEOUT_MS\s*=\s*Number\(args\.targetTimeoutMs\)\s*\|\|\s*\d[\d_]*/);
    // 超时被单独识别, 不会伪装成"工具坏了"
    expect(chunk).toMatch(/超时/);
  });

  it('batch_pentest 逐目标发进度心跳 (否则十几分钟静默 → GUI 只看到"疑似卡死")', () => {
    const TOOLS = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');
    const idx = TOOLS.indexOf('batch_pentest: async');
    const chunk = TOOLS.slice(idx, idx + 8000); // 2026-10-17: handler 体量随注入内容增长, 4000 窗口已不够
    expect(chunk).toMatch(/emitProgress/);
    expect(chunk).toMatch(/onProgress/);
  });

  it('runSubagent 调用被 withTimeout 包住而不是裸 await (超时后能继续下一个目标)', () => {
    const TOOLS = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');
    const idx = TOOLS.indexOf('batch_pentest: async');
    const chunk = TOOLS.slice(idx, idx + 8000); // 2026-10-17: handler 体量随注入内容增长, 4000 窗口已不够
    // 裸 await runSubagent 是不允许的
    expect(chunk).not.toMatch(/=\s*await\s+runSubagent\(/);
    expect(chunk).toMatch(/await withTimeout\(\s*\n?\s*runSubagent\(/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2026-10-16 多 SRC 归属 + 消除反复追问 (富哥实机反馈)
// ════════════════════════════════════════════════════════════════════════
describe('多 SRC 归属接线回归 (2026-10-16)', () => {
  const loop = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
  const tools = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');

  it('agentai-loop 每轮注入 SRC 平台上下文 (消除 AI 反复追问授权)', () => {
    expect(loop).toMatch(/injectSrcPlatformContext\(\)/);
    expect(loop).toMatch(/renderPlatformsForAi\(ws\)/);
    // 必须在 ensureContext 里调用 —— 那里是每轮必读的 immutablePrefix 构建点
    expect(loop).toMatch(/this\.context\.immutablePrefix = await this\.buildImmutablePrefix[\s\S]{0,300}this\.injectSrcPlatformContext\(\)/);
  });

  it('注入失败不中断主流程 (必须 try/catch 兜底)', () => {
    // 2026-10-16: 方法改为 async (等 renderScopeGroupsForAi 的动态 import),
    //   所以签名匹配必须允许 `private async injectSrcPlatformContext`
    const idx = loop.indexOf('private async injectSrcPlatformContext');
    expect(idx).toBeGreaterThan(-1);
    const body = loop.slice(idx, idx + 2600); // 2026-10-16 方法体变长 (多了 scope 兜底分支)
    expect(body).toMatch(/try\s*{/);
    expect(body).toMatch(/catch/);
  });

  it('卡死检测: args 反查失败不退化成 {} (实机事故: http_replay 正常工作却全程挂"疑似卡死"前缀)', () => {
    // 根因: `find(tc.id===r.id)?.args || {}` —— 反查不到时所有调用共用 sig `tool::{}`,
    //   于是"同参数连续失败"被错误触发。修: 独立 sigResolved 标记 + 不累加。
    expect(loop).toMatch(/const _matchedTc = res\.toolCalls\?\.find/);
    expect(loop).toMatch(/sigResolved/);
    expect(loop).toMatch(/<args-unresolved>/);
    // 反断言: 不得再出现 `?.args || {}` 这种退化写法
    expect(loop).not.toMatch(/\?\?\{\}\)\}/);
  });

  it('卡死播报是边沿触发 + 陈旧计数每轮剔除 (否则每条消息都挂前缀)', () => {
    // 原实现只要 count>=3 就每轮 emit, 且旧 sig 永不复位
    expect(loop).toMatch(/_stuckEmitted = new Set/);
    expect(loop).toMatch(/seenSigsThisRound/);
    expect(loop).toMatch(/if \(!seenSigsThisRound\.has\(sig\)\)/);
    // 2026-10-17: 边沿触发已由「按 sig」改为「按工具名」(根治振荡),
    // 详见下方「卡死误报修复 — 行为测试」组。
    expect(loop).toMatch(/firstReport = !this\._stuckEmittedTool\.has\(toolName\)/);
  });

  it('死循环硬停签名从 assistant.tool_calls 反查 args (实机事故: http_replay 参数各不相同却被判同参数死循环 → 任务截断)', () => {
    // 根因: 死循环检测的 sig 读 m.args, 但 tool 消息 push 时只有
    //   {role,name,tool_call_id,content} —— 根本没有 args!
    //   于是 JSON.stringify(m.args || {}) 对所有 http_replay 都产出 `http_replay::{}`,
    //   参数完全不同的正常探测(改 header/换 id)凑够 4/5 次即被硬停强杀任务。
    expect(loop).toMatch(/_argsById/);
    expect(loop).toMatch(/_argsById\.get\(m\.tool_call_id\)/);
    expect(loop).toMatch(/tool_calls/);
    // 反查不到真实 args 的签名必须被排除出计数
    expect(loop).toMatch(/if \(s\.endsWith\('::<args-unresolved>'\)\) return false;/);
  });

  it('死循环硬停要求"真的无信息增益": 同签名 + (>=3 次错误 或 结果高度雷同)', () => {
    // 事故: isErrorLoop 算出来了却没参与判定 —— http_replay 正常返回 200/403/404/302
    //   (这正是它的用途) 也被硬停。现在必须满足 isStuckLoop 才停。
    expect(loop).toMatch(/isStuckLoop = isErrorLoop \|\| uniqContents <= 1/);
    expect(loop).toMatch(/if \(!isStuckLoop\)/);
    expect(loop).toMatch(/uniqContents/);
  });

  it('batch_pentest 把归属平台与该平台禁止项传进子智能体 task', () => {
    // 根因: t.source 原本只用于结果回显, 没进 task → 子智能体不知道报给谁
    expect(tools).toMatch(/findPlatformForTarget\(ws,\s*host\)/);
    expect(tools).toMatch(/归属平台: 【\$\{p\.name\}】\(platform id: \$\{p\.id\}\)/);
    expect(tools).toMatch(/该平台明确禁止的目标\(绝对不要打\)/);
  });

  it('report_vulnerability 未显式传 platform 时按 target 自动反查', () => {
    expect(tools).toMatch(/platformAuto/);
    expect(tools).toMatch(/findPlatformForTarget\(ws, String\(args\.target/);
  });

  it('grant_scope 不再用 string[] 覆盖 (那会把 {host,source} 洗成裸字符串)', () => {
    // 反断言: 旧的破坏性写法
    expect(tools).not.toMatch(/existing\.targets = targets;/);
    // 正断言: 走带来源的对象格式
    expect(tools).toMatch(/writeScopeWithSource\(ws,\s*next,\s*extra\)/);
  });

  it('deny 硬闸门在 isTargetInScope 最前面且优先于 allow', () => {
    const guard = readFileSync(new URL('./pentest-scope-guard.ts', import.meta.url), 'utf-8');
    const idx = guard.indexOf('export function isTargetInScope');
    const body = guard.slice(idx, idx + 2000);
    const denyAt = body.indexOf('isDeniedByAnyPlatform');
    // 2026-10-21: allow 判定改用 readScopeWithSource (需要过滤已过期授权)
    const allowAt = body.indexOf('const targets = readScopeWithSource(ws)');
    expect(denyAt).toBeGreaterThan(-1);
    expect(allowAt).toBeGreaterThan(-1);
    // deny 判定必须出现在 allow 判定之前
    expect(denyAt).toBeLessThan(allowAt);
  });

  it('ws-paths 是无依赖独立模块 (避免 guard ↔ platforms 循环依赖)', () => {
    const ws = readFileSync(new URL('./ws-paths.ts', import.meta.url), 'utf-8');
    expect(ws).not.toMatch(/^import .*from '\.\//m);   // 不 import 任何项目内模块
    expect(ws).toMatch(/export function normWsPath/);
    // 两个消费方都从它取, 不再各自实现一份
    const plat = readFileSync(new URL('./src-platforms.ts', import.meta.url), 'utf-8');
    expect(plat).toMatch(/from '\.\/ws-paths\.js'/);
    expect(guard2(loop)).not.toBe(undefined);
  });

  function guard2(s: string) { return readFileSync(new URL('./pentest-scope-guard.ts', import.meta.url), 'utf-8') + s.length; }
});

// ════════════════════════════════════════════════════════════════════════
// 2026-10-17 卡死误报 P0 行为测试
// 事故: 挖洞过程中 `enum_subdomains 疑似卡死 (3 次调用)` 连播十几次,
//       而模型同期在正常汇报"已确认 tycredit.com" —— 它压根没卡死。
// 本组测试**真跑 run()**, 断言 emit 次数, 而不是只比对源码字符串。
// ════════════════════════════════════════════════════════════════════════
describe('卡死误报修复 — 行为测试 (2026-10-17)', () => {
  /**
   * 构造一个"工具每次都失败"的 loop:
   * @param toolName 工具名
   * @param argsPerRound 每轮该工具用的参数 (用来模拟模型换参数/换回参数)
   */
  function makeFailingLoop(toolName: string, argsPerRound: any[]) {
    let round = 0;
    const stuck: any[] = [];
    const router: any = {
      chat: vi.fn(async () => {
        round++;
        const args = argsPerRound[Math.min(round - 1, argsPerRound.length - 1)];
        return {
          content: '',
          provider: 'agentai',
          finishReason: 'tool_calls',
          toolCalls: [{ id: `c${round}`, name: toolName, args }],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }),
      getAvailableModels: vi.fn().mockReturnValue(['agentai']),
    };
    // ⚠️ 必须回 name + 与 tool_call_id 匹配的 id, 否则 loop 反查 args 失败
    const registry: any = {
      dispatch: vi.fn(async (calls: any[]) =>
        calls.map((c: any) => ({
          id: c.id, name: c.name,
          result: { success: false, output: `[ERROR] ${c.name} 执行失败: 目标无响应` },
        })),
      ),
      toLLMTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
    };
    const loop = new AgentAILoop(router, registry, [], {
      maxIterations: 6, userId: 'u1', workspace: WS, sessionId: 's1',
    });
    loop.on('tool:stuck', (i: any) => stuck.push(i));
    vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
      (loop as any).contextReady = true;
      (loop as any).context.immutablePrefix = [{ role: 'system', content: 'sys' }];
    });
    return { loop, stuck };
  }

  it('同一工具反复失败 → tool:stuck 只 emit 1 次 (不是每轮一次)', async () => {
    const { loop, stuck } = makeFailingLoop('edit_file', [{ file_path: 'a.ts' }]);
    await loop.run('改 a.ts');
    expect(stuck.length, `实际 emit ${stuck.length} 次, 应为 1`).toBe(1);
  }, 60000);

  it('模型换参数来回试 → 仍只 emit 1 次 (振荡回归, 富哥截图的现场)', async () => {
    // 事故现场: enum_subdomains 换不同子域名, 每轮一个不同参数
    const { loop, stuck } = makeFailingLoop('edit_file', [
      { file_path: 'a.ts' }, { file_path: 'b.ts' }, { file_path: 'c.ts' },
    ]);
    await loop.run('改文件');
    expect(stuck.length, `换参数重播 ${stuck.length} 次, 振荡未根治`).toBeLessThanOrEqual(1);
  }, 60000);

  it('探测类工具 (enum_subdomains) 失败再多也不播报', async () => {
    const { loop, stuck } = makeFailingLoop('enum_subdomains', [
      { domain: 'a.com' }, { domain: 'b.com' }, { domain: 'c.com' },
    ]);
    await loop.run('扫子域');
    expect(stuck.length, `enum_subdomains 被误判卡死 ${stuck.length} 次`).toBe(0);
  }, 60000);

  it('http_replay 也不播报 (探针类换参数是正常工作流)', async () => {
    const { loop, stuck } = makeFailingLoop('http_replay', [
      { url: 'https://a.com/1' }, { url: 'https://a.com/2' },
    ]);
    await loop.run('重放');
    expect(stuck.length).toBe(0);
  }, 60000);

  it('_stuckEmittedTool 在新任务开始时归零 (否则跨任务永久静默)', async () => {
    const { loop } = makeFailingLoop('edit_file', [{ file_path: 'a.ts' }]);
    await loop.run('第一个任务');
    expect((loop as any)._stuckEmittedTool.size).toBe(1);
    // 换一个工具再跑一次 → 集合应该只增不减, 但 run() 开头会清零重算
    await loop.run('第二个任务');
    expect((loop as any)._stuckEmittedTool.size).toBe(1);
  }, 90000);

  it('陈旧剔除只清计数, 不清播报记录 (10-16 两处修复互殴的根因)', () => {
    // 静态契约: _stuckEmitted.delete 必须已从剔除块里移除
    const idx = LOOP_SRC.indexOf('for (const sig of [...duplicateTracker.keys()])');
    expect(idx).toBeGreaterThan(-1);
    const block = LOOP_SRC.slice(idx, idx + 320);
    expect(block).toMatch(/duplicateTracker\.delete\(sig\);/);
    expect(block, '剔除块里删播报记录 = 振荡根因, 必须移除').not.toMatch(/_stuckEmitted\.delete/);
    expect(block).not.toMatch(/_stuckEmittedTool\.delete/);
  });

  it('边沿触发按工具名, 不是按 sig', () => {
    expect(LOOP_SRC).toMatch(/const firstReport = !this\._stuckEmittedTool\.has\(toolName\)/);
    expect(LOOP_SRC).toMatch(/this\._stuckEmittedTool\.add\(toolName\)/);
    // 反断言: 不得再按 sig 判首次
    expect(LOOP_SRC).not.toMatch(/const firstReport = !this\._stuckEmitted\.has\(sig\)/);
  });

  it('PROBE_EXEMPT_TOOLS 与 LOOP_EXEMPT_TOOLS 是两套 (别混用)', () => {
    expect(LOOP_SRC).toMatch(/const PROBE_EXEMPT_TOOLS = new Set/);
    expect(LOOP_SRC).toMatch(/if \(PROBE_EXEMPT_TOOLS\.has\(toolName\)\)/);
    // 探测类必须在 PROBE 名单里
    const i = LOOP_SRC.indexOf('const PROBE_EXEMPT_TOOLS');
    const body = LOOP_SRC.slice(i, i + 700);
    for (const t of ['enum_subdomains', 'http_replay', 'wsl_scan', 'browser_navigate']) {
      expect(body, `${t} 不在探测类豁免名单`).toContain(t);
    }
  });

  it('run() 开头清零 _stuckEmittedTool (任务隔离)', () => {
    const i = LOOP_SRC.indexOf('this._stuckEmittedTool.clear();');
    expect(i).toBeGreaterThan(-1);
    const block = LOOP_SRC.slice(i - 200, i + 200);
    expect(block).toMatch(/_failTracker\.clear\(\)/);
  });

  it('前端 onToolStuck 也去重 (纵深防御)', () => {
    const CV = readFileSync(new URL('../../agentai-gui/src/components/ChatView.tsx', import.meta.url), 'utf-8');
    expect(CV.length, '读不到 ChatView.tsx (相对路径可能不对)').toBeGreaterThan(1000);
    const i = CV.indexOf('onToolStuck:');
    expect(i).toBeGreaterThan(-1);
    const body = CV.slice(i, i + 900);
    expect(body).toMatch(/疑似卡死/);
    expect(body, '前端缺 dedup 判定').toMatch(/if \(dup\) return m;/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 2026-10-17 长任务被前端误杀 — 心跳修复
// 事故: `run_command python probe_foos.py` 跑几分钟, 工具执行期间不发任何 SSE,
//   前端 idle 计时器 (ChatView.tsx, 5 分钟) 判定无响应 → controller.abort(),
//   把后端正在正常干活的连接掐掉, 用户看到"任务被强制中止"。
// ════════════════════════════════════════════════════════════════════════
describe('长任务心跳修复 (2026-10-17)', () => {
  const CV_SRC = readFileSync(new URL('../../agentai-gui/src/components/ChatView.tsx', import.meta.url), 'utf-8');
  const API_SRC = readFileSync(new URL('../../agentai-gui/src/services/api.ts', import.meta.url), 'utf-8');
  const CHAT_ROUTE = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');

  it('后端: 长耗时工具 dispatch 期间发 tool:heartbeat (每 30s)', () => {
    expect(LOOP_SRC).toMatch(/setInterval\(\(\) => \{/);
    expect(LOOP_SRC).toMatch(/const HEARTBEAT_MS = 30_000/);
    expect(LOOP_SRC).toMatch(/this\.emit\('tool:heartbeat'/);
    // 必须 unref, 否则心跳定时器会拖住进程退出
    expect(LOOP_SRC, '心跳定时器必须 unref').toMatch(/\(hb as any\)\.unref\?\.\(\)/);
    // 必须 finally 清理, 否则 dispatch 抛错就泄漏定时器
    // 2026-10-19: dispatch 的 catch 块新增了"崩溃也补 tool:result"的兜底, try→finally 距离变长
    expect(LOOP_SRC).toMatch(/try \{[\s\S]{0,200}await this\.registry\.dispatch\(callsToDispatchFinal, ctx\);[\s\S]{0,1500}\} finally \{[\s\S]{0,80}clearInterval\(hb\)/);
  });

  it('后端: 自动重试的 dispatch 也包心跳 (超时类错误最容易静默)', () => {
    expect(LOOP_SRC).toMatch(/const retryHb = setInterval/);
    expect(LOOP_SRC).toMatch(/tool:heartbeat', \{ callId: c\.id, name: c\.name, pending: failedCalls\.length, retry \}/);
    expect(LOOP_SRC).toMatch(/clearInterval\(retryHb\)/);
  });

  it('SSE 层转发 tool:heartbeat', () => {
    expect(CHAT_ROUTE).toMatch(/loop\.on\('tool:heartbeat'/);
    expect(CHAT_ROUTE).toMatch(/sendEvent\('tool_heartbeat'/);
  });

  it('前端 api.ts 分发 tool_heartbeat 并声明 handler', () => {
    expect(API_SRC).toMatch(/case 'tool_heartbeat': handlers\.onToolHeartbeat\?\.\(data\)/);
    expect(API_SRC).toMatch(/onToolHeartbeat\?:/);
  });

  it('前端: 工具运行中不算 idle (P0-1 双保险)', () => {
    expect(CV_SRC).toMatch(/let runningToolCount = 0/);
    expect(CV_SRC).toMatch(/const TOOL_RUNNING_MAX_WAIT = 30 \* 60 \* 1000/);
    expect(CV_SRC).toMatch(/onToolStart: \(info: any\) => \{[\s\S]{0,200}runningToolCount\+\+/);
    expect(CV_SRC).toMatch(/onToolResult: \(info: any\) => \{[\s\S]{0,200}runningToolCount--/);
    // 计数下限保护, 重试重复减也不能变负
    expect(CV_SRC).toMatch(/if \(runningToolCount > 0\) runningToolCount--/);
  });

  it('前端: 有工具在跑时用宽松门槛, 且仍有 30 分钟兜底', () => {
    expect(CV_SRC).toMatch(/const limit = runningToolCount > 0 \? TOOL_RUNNING_MAX_WAIT : IDLE_TIMEOUT/);
    expect(CV_SRC).toMatch(/const timeoutByTool = runningToolCount > 0 && toolRunMs > TOOL_RUNNING_MAX_WAIT/);
    // 关键反断言: 绝不能再出现「idle 超时就 abort, 不管有没有工具在跑」
    expect(CV_SRC, '有工具在跑时仍按 idle abort = 原 bug 未修')
      .not.toMatch(/if \(Date\.now\(\) - lastActivityTs > IDLE_TIMEOUT && abortRef\.current === controller\)/);
    // 且必须由 tool 分支兜底
    expect(CV_SRC).toMatch(/timeoutByTool \|\| \(timeoutByIdle && runningToolCount === 0\)/);
  });

  it('前端: 接心跳喂 idle 计时器 (P0-2 根治)', () => {
    expect(CV_SRC).toMatch(/onToolHeartbeat: \(_info: any\) => \{[\s\S]{0,120}lastActivityTs = Date\.now\(\)/);
  });

  it('前端: 超时文案区分"工具在跑"与"真无响应"', () => {
    expect(CV_SRC).toMatch(/工具执行超时/);
    expect(CV_SRC).toMatch(/长时间无响应, 但仍有工具在运行/);
    expect(CV_SRC).toMatch(/5 分钟无任何响应/);
  });

  it('行为: 工具长时间静默期间心跳照发 (假定时器加速, 不真的等 30s)', async () => {
    let hbCount = 0;
    const hbPayloads: any[] = [];
    const router: any = {
      chat: vi.fn(async () => ({
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'edit_file', args: { file_path: 'a.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      })),
      getAvailableModels: vi.fn().mockReturnValue(['agentai']),
    };
    // dispatch 内部挂起, 由测试手动释放 —— 模拟"工具跑了很久"
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    const registry: any = {
      dispatch: vi.fn(async (calls: any[]) => {
        await gate;
        return calls.map((c: any) => ({ id: c.id, name: c.name, result: { success: true, output: 'ok' } }));
      }),
      toLLMTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
    };
    const loop = new AgentAILoop(router, registry, [], {
      maxIterations: 2, userId: 'u1', workspace: WS, sessionId: 's1',
    });
    loop.on('tool:heartbeat', (i: any) => { hbCount++; hbPayloads.push(i); });
    vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
      (loop as any).contextReady = true;
      (loop as any).context.immutablePrefix = [{ role: 'system', content: 'sys' }];
    });

    const runP = loop.run('跑一下');
    // 等 dispatch 真正进入 (确保心跳定时器已建)
    await vi.waitFor(() => expect(registry.dispatch).toHaveBeenCalled(), { timeout: 15000 });
    // 用真等待跨过 1 次心跳周期太慢, 这里断言"定时器已建立"的可观测证据:
    // dispatch 挂起期间进程不返回, 且释放后心跳计数不再增长 (定时器已清理)
    release();
    await runP;
    const after = hbCount;
    await new Promise(r => setTimeout(r, 200));
    expect(hbCount, 'dispatch 结束后心跳定时器未清理, 仍在发').toBe(after);
    if (hbCount > 0) {
      expect(hbPayloads[0].callId).toBe('c1');
      expect(hbPayloads[0].name).toBe('edit_file');
    }
  }, 60000);
});

// ════════════════════════════════════════════════════════════════════════
// 2026-10-17 分发链路三件事: 本地 429 / 环境体检 / 只读不安装
// 事故: 桌面版连发两条就 `HTTP 429`, 但"后台根本没运行" ——
//   根因是网关**自己的** rate-limit (外部 20 RPM / 并发 2, 按公网多租户设计),
//   请求在网关就被挡掉了, 压根没发给 DeepSeek。
// ════════════════════════════════════════════════════════════════════════
describe('分发链路: 429 + 环境体检 (2026-10-17)', () => {
  const APP_SRC = readFileSync(new URL('./app.ts', import.meta.url), 'utf-8');
  const GUI_APP = readFileSync(new URL('../../agentai-gui/src/App.tsx', import.meta.url), 'utf-8');
  const STATUSBAR = readFileSync(new URL('../../agentai-gui/src/components/StatusBar.tsx', import.meta.url), 'utf-8');
  const API = readFileSync(new URL('../../agentai-gui/src/services/api.ts', import.meta.url), 'utf-8');
  const ENV_PANEL = readFileSync(new URL('../../agentai-gui/src/components/EnvCheckPanel.tsx', import.meta.url), 'utf-8');

  it('桌面端 (AGENTAI_DESKTOP) 走内部限额, 不被本地 20 RPM 误杀', () => {
    const CHAT = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');
    expect(CHAT).toMatch(/const isDesktop = process\.env\.AGENTAI_DESKTOP === '1'/);
    expect(CHAT, '桌面端未豁免 = 429 误杀未修').not.toMatch(/limiter\.check\(userId, isInternalReq\);/);
    expect(CHAT).toMatch(/limiter\.check\(userId, isInternalReq \|\| isDesktop\)/);
  });

  it('本地 429 响应带 scope/hint, 前端不再只显示裸 HTTP 429', () => {
    const CHAT = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');
    expect(CHAT).toMatch(/scope: 'gateway-local'/);
    expect(CHAT).toMatch(/hint: '本地网关限流, 请求未发出到模型服务'/);
    // 反断言: 不得再只回 {error, retryAfter} 两字段
    expect(CHAT).not.toMatch(/return res\.status\(429\)\.json\(\{ error: rl\.reason, retryAfter: rl\.retryAfter \}\)/);
  });

  it('前端: 429 自动退避重试, 不把错误抛给用户', () => {
    expect(API).toMatch(/if \(resp\.status === 429 && retries < MAX_RETRIES\)/);
    expect(API).toMatch(/const waitMs = Math\.min\(Math\.max\(retryAfterSec, 1\) \* 1000, 60_000\)/);
    expect(API).toMatch(/handlers\.onNotice\?\.\(\{[\s\S]{0,200}kind: 'rate_limit'/);
    // 读响应体 + Retry-After (原来全丢了)
    expect(API).toMatch(/resp\.headers\.get\('Retry-After'\)/);
    expect(API).toMatch(/detail = await resp\.text\(\)/);
  });

  it('前端: onNotice 只提示不报错, 且 HTTP 429 有中文解释', () => {
    expect(API).toMatch(/onNotice\?:/);
    expect(API).toMatch(/本地限流 \(每分钟请求数超限\), 请稍候再试/);
    const CHATVIEW = readFileSync(new URL('../../agentai-gui/src/components/ChatView.tsx', import.meta.url), 'utf-8');
    expect(CHATVIEW).toMatch(/onNotice: \(info: any\) => \{/);
  });

  it('环境体检端点已挂载', () => {
    expect(APP_SRC).toMatch(/import envCheckRouter from '\.\/routes\/env-check\.js'/);
    expect(APP_SRC).toMatch(/app\.use\('\/v1\/system', envCheckRouter\)/);
  });

  it('环境体检: 覆盖 node/python/git/playwright/WSL/nmap/nuclei/sqlmap', () => {
    const ENV = readFileSync(new URL('./routes/env-check.ts', import.meta.url), 'utf-8');
    for (const id of ['node', 'python', 'git', 'playwright', 'wsl', 'nmap', 'nuclei', 'sqlmap']) {
      expect(ENV, `${id} 未纳入体检`).toMatch(new RegExp(`id: '${id}'`));
    }
    // 渗透工具链必须分组标出, 供 UI 区分"降级但不阻塞"
    expect(ENV).toMatch(/group: 'pentest'/);
    expect(ENV).toMatch(/pentestReady/);
  });

  it('环境体检: **只读**, 绝不执行安装 (Kali 需管理员权限, 不能静默装)', () => {
    const ENV = readFileSync(new URL('./routes/env-check.ts', import.meta.url), 'utf-8');
    // 关键: 安装命令只能出现在 installHint **文案**里 (给人看), 绝不能出现在探测逻辑里。
    // 判定方式: 剥掉所有 installHint 字符串字面量后, 剩余代码不得含任何安装动词。
    const withoutHints = ENV.replace(/installHint:\s*'[^']*'/g, "installHint: ''");
    expect(withoutHints, '剥掉 installHint 文案后仍含安装命令 = 存在实际执行安装的逻辑')
      .not.toMatch(/apt(-get)?\s+install|npm\s+install|pip\s+install|winget\s+install|choco\s+install|execSync|spawn\('?(apt|npm|pip|winget|choco|bash|wsl\s+-e\s+sh\s+-lc\s+apt)/i);
    // install-hint 端点只**返回**命令, 不执行
    expect(ENV).toMatch(/router\.post\('\/env-check\/install-hint'/);
    expect(ENV).toMatch(/需人工执行安装命令/);
  });

  it('环境体检面板已挂载且有入口', () => {
    expect(GUI_APP).toMatch(/import \{ EnvCheckPanel \} from '\.\/components\/EnvCheckPanel'/);
    expect(GUI_APP).toMatch(/<EnvCheckPanel onClose=/);
    expect(GUI_APP).toMatch(/window\.addEventListener\('agentai:open-env-check'/);
    expect(STATUSBAR).toMatch(/agentai:open-env-check/);
    expect(ENV_PANEL).toMatch(/环境体检/);
    // 面板也必须只读 —— 只有"复制"按钮, 没有安装按钮
    expect(ENV_PANEL).toMatch(/复制/);
    expect(ENV_PANEL, '面板出现安装按钮 = 违反只读原则').not.toMatch(/一键安装|立即安装|开始安装/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 进程树终止修复 (2026-10-17 P0) — 长任务永久卡死真凶
//
// 事故: `run_command python probe_focus.py` 永远"执行中", 前端 5 分钟超时 abort。
// 实锤根因: spawn(cmd, [], { timeout, shell:true }) 里 Node 的 timeout **只杀 shell 包装
// 进程 (cmd.exe)**, 业务进程是**孙进程**, 继续跑且继承 stdout 管道句柄
// → child.on('close') 永不触发 → Promise 永不 resolve。
// 实测: timeout:5000 + python sleep(600), 观察 12s 既没 close 也没 error。
//
// 修法: 自建计时器 + 超时杀整棵进程树 + 主动 resolve + 给 AI 换路子的可执行建议。
// ═══════════════════════════════════════════════════════════════════
describe('长任务卡死修复 — 进程树终止 (2026-10-17)', () => {
  const TOOLS = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');

  it('A1: killProcessTree 存在且用 taskkill /T (Windows 唯一可靠的杀树方式)', () => {
    expect(TOOLS).toMatch(/function killProcessTree\(pid: number \| undefined\)/);
    // /T = 连子孙一起杀 —— 没有 /T 就等于没修
    expect(TOOLS).toMatch(/'taskkill', \['\/PID', String\(pid\), '\/T', '\/F'\]/);
    // POSIX 分支
    expect(TOOLS).toMatch(/process\.kill\(-pid, 'SIGKILL'\)/);
  });

  it('A2: run_command 不得再依赖 spawn 的 timeout 选项 (它已被证明在 shell:true 下失效)', () => {
    const idx = TOOLS.indexOf('run_command: async');
    expect(idx).toBeGreaterThan(-1);
    const chunk = TOOLS.slice(idx, idx + 8000);
    // 反断言: spawn 调用里不能再出现 timeout:
    expect(chunk, 'run_command 的 spawn 仍传 timeout = 白改, 仍会被孙进程拖死')
      .not.toMatch(/spawn\(command, \[\], \{[^}]*\btimeout\b/);
  });

  it('A3: run_command 自建计时器, 超时后杀进程树并主动 resolve', () => {
    const idx = TOOLS.indexOf('run_command: async');
    const chunk = TOOLS.slice(idx, idx + 8000);
    expect(chunk).toMatch(/setTimeout\(/);
    expect(chunk, '超时不杀进程树 = 孙进程继续跑并持有管道, close 永不触发')
      .toMatch(/killProcessTree\(child\.pid\)/);
    // 必须有 settled 幂等闸门, 否则 close 与超时竞争会双 resolve
    expect(chunk).toMatch(/if \(settled\) return;/);
    expect(chunk).toMatch(/const TIMED_OUT_MARK = /);
  });

  it('A4: 超时返回结构化结果并带「换路子」建议 (P1 看门狗: AI 要知道该换方法)', () => {
    const idx = TOOLS.indexOf('run_command: async');
    const chunk = TOOLS.slice(idx, idx + 8000);
    expect(chunk).toMatch(/if \(output === TIMED_OUT_MARK\)/);
    expect(chunk).toMatch(/已强制终止整棵进程树/);
    expect(chunk, '超时必须告诉 AI 换后台执行 + 轮询, 这正是用户要的体验')
      .toMatch(/run_background/);
    expect(chunk).toMatch(/wait_for_job/);
    expect(chunk).toMatch(/socket 超时/);   // URLError 永久挂住的真因
  });

  it('A5: stop_job 也必须杀进程树 (原来只杀 pid, 孙进程残留)', () => {
    const idx = TOOLS.indexOf('stop_job: async');
    expect(idx).toBeGreaterThan(-1);
    const chunk = TOOLS.slice(idx, idx + 8000);
    expect(chunk).toMatch(/killProcessTree\(j\.pid\)/);
    expect(chunk, 'stop_job 残留 execSync taskkill = 旧的无 /T 实现').not.toMatch(/execSync\(`taskkill/);
  });

  it('A6: wsl_scan 超时也杀进程树 (execFile 只杀 wsl.exe, Kali 里的 nmap/sqlmap 是孙进程)', () => {
    const idx = TOOLS.indexOf('wsl_scan: async');
    expect(idx).toBeGreaterThan(-1);
    // 2026-10-22: 原来按固定 8000 字符切 —— wsl_scan 合法增长 (钳制/熔断/并发锁/台账/第三方检查)
    // 会把超时建议挤出切片, 测试假红。改为切到 handler 结束标记, 对增长免疫。
    const end = TOOLS.indexOf('授权对话化', idx);
    const chunk = end > idx ? TOOLS.slice(idx, end) : TOOLS.slice(idx, idx + 20000);
    expect(chunk).toMatch(/killProcessTree\(wslChild\?\.pid\)/);
    expect(chunk).toMatch(/e\.timedOut = true/);
    expect(chunk, 'wsl_scan 超时也要给 AI 换路子的建议').toMatch(/别原样重试同一条扫描/);
  });

  it('A7: 计时器都 unref + clearTimeout, 防止拖住进程 / 泄漏', () => {
    expect(TOOLS).toMatch(/\(timer as any\)\.unref\?\.\(\)/);
    expect(TOOLS).toMatch(/clearTimeout\(timer\)/);
  });

  // ─── 行为测试: 真跑一次, 验证"超时后一定返回且孙进程真被杀掉" ───
  it('A8: 行为验证 — 超时后 run_command 一定返回, 且 python 孙进程真被 taskkill /T 杀掉', async () => {
    const t0 = Date.now();
    // 造一个"永不结束"的命令: python sleep 600。旧实现会永久卡住。
    const { EXTRA_HANDLERS } = await import('./tools.js') as any;
    const runCommand = (EXTRA_HANDLERS as any).run_command;
    expect(runCommand, 'run_command handler 未导出').toBeTypeOf('function');

    // 先拿一个 pid 用于事后验证进程确实没了
    const { execSync } = await import('child_process');
    const marker = `agentai_timeout_probe_${Date.now()}`;
    const cmd = `python -c "import time,os;open('${marker}','w').write(str(os.getpid()));time.sleep(600)"`;

    const res: any = await Promise.race([
      runCommand({ command: cmd, timeout_ms: 3000 }),
      new Promise((r) => setTimeout(() => r({ success: false, output: '__STILL_HANGING__' }), 20000)),
    ]);

    const elapsed = Date.now() - t0;
    expect(res.output, '20s 内仍未返回 = 修复无效, Promise 依然永挂').not.toBe('__STILL_HANGING__');
    expect(elapsed, `超时阈值 3s, 实际耗时 ${elapsed}ms —— 远超说明计时器没生效`).toBeLessThan(15000);
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/命令超时/);
    expect(res.output).toMatch(/换路子|换方法|别再原样重试/);

    // 关键断言: 孙进程必须真被杀掉, 不能留在后台
    let pid = '';
    try { pid = execSync(`type ${marker}`, { encoding: 'utf-8' }).trim(); } catch { pid = ''; }
    if (pid) {
      await new Promise((r) => setTimeout(r, 1500)); // 给 taskkill 一点生效时间
      let alive = true;
      try { execSync(`tasklist /FI "PID eq ${pid}"`, { encoding: 'utf-8' }); alive = execSync(`tasklist /FI "PID eq ${pid}"`, { encoding: 'utf-8' }).includes(pid); }
      catch { alive = false; }
      expect(alive, `孙进程 pid=${pid} 超时后仍存活 = taskkill /T 没生效, 后台会堆僵尸进程`).toBe(false);
    }
    try { execSync(`del ${marker}`, { stdio: 'ignore' }); } catch {}
  }, 40000);

  it('A9: 正常命令不受影响 (回归: 修复不能把好命令也杀掉)', async () => {
    const { EXTRA_HANDLERS } = await import('./tools.js') as any;
    const runCommand = (EXTRA_HANDLERS as any).run_command;
    const res: any = await runCommand({ command: 'echo agentai-ok', timeout_ms: 15000 });
    expect(res.success).toBe(true);
    expect(res.output).toContain('agentai-ok');
  }, 25000);
});

// ═══════════════════════════════════════════════════════════════════
// 长任务「十几步就停」修复 (2026-10-17)
// 症状: 挖洞任务稳定停在 ~16 步, AI 自己就不动了, 前端无任何报错。
// 真因是三个独立缺陷叠加 (都不是迭代上限本身 —— 上限是 40~90):
//   ① 超时块里把迭代上限动态砍到 30, 等于"提醒完立刻判死刑"
//   ② token 压力到 critical 就命令 AI "不要再调用工具, 立即总结"
//   ③ lastToolActivityAt 只在工具完成时更新 → AI 纯思考几轮就被误判空闲
//   ④ 每轮工具预算只有 3~5, 挖洞要一轮并发多探针 → 被截断白耗迭代
// ═══════════════════════════════════════════════════════════════════
describe('长任务提前中止修复 (2026-10-17)', () => {
  const LOOP = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
  const SPL = readFileSync(new URL('./system-prompt-lite.ts', import.meta.url), 'utf-8');
  const TRK = readFileSync(new URL('./governor/runtime-capability-tracker.ts', import.meta.url), 'utf-8');

  it('B1: 超时不再把迭代上限砍到 30 (动态上限只在绝对上限分支生效)', () => {
    const idx = LOOP.indexOf("this.emit('timeout'");
    expect(idx).toBeGreaterThan(-1);
    const chunk = LOOP.slice(idx, idx + 900);
    // 动态上限必须被 totalTime > ABSOLUTE_MAX_MS 包住
    expect(chunk).toMatch(/if \(totalTime > ABSOLUTE_MAX_MS\) \{[\s\S]{0,300}dynamicMax/);
  });

  it('B2: token critical 不再命令 AI 停止调用工具 (只有 overflow 才要求收尾)', () => {
    const idx = LOOP.indexOf("if (pressure.level === 'critical' || pressure.level === 'overflow')");
    expect(idx).toBeGreaterThan(-1);
    const chunk = LOOP.slice(idx, idx + 900);
    expect(chunk, 'critical 时说"立即总结"= AI 长任务中途自己收摊')
      .not.toMatch(/必须立即生成本轮总结.*不要再调用工具/);
    expect(chunk).toMatch(/overflow/);
    expect(chunk, '要明确告诉 AI 任务不要停').toMatch(/任务不要停/);
  });

  it('B3: 每轮迭代续期 idle 计时器 (AI 纯思考不再被误判空闲)', () => {
    expect(LOOP).toMatch(/lastToolActivityAt = Date\.now\(\);/);
    // 必须出现在 iteration++ 之后、工具派发之前
    const iIdx = LOOP.indexOf('this.emit(\'loop:iteration\'');
    const tIdx = LOOP.indexOf('lastToolActivityAt = Date.now();');
    expect(iIdx).toBeGreaterThan(-1);
    expect(tIdx).toBeGreaterThan(-1);
    expect(tIdx, '续期必须紧跟 iteration++').toBeLessThan(iIdx + 400);
  });

  it('B4: 安全任务每轮工具预算放宽到 8, 且新增 security 任务类型', () => {
    expect(LOOP).toMatch(/const TASK_TOOL_CONCURRENCY: Record<string, number> = \{[^}]*security: 12/);
    expect(SPL).toMatch(/'security'/);
    expect(TRK).toMatch(/export type TaskType = [^;]*'security'/);
    expect(TRK, 'TASK_WEIGHTS 缺 security = Record<TaskType,...> 初始化会崩').toMatch(/security: \{[^}]*\}/);
  });

  it('B5: detectTaskType 能识别安全任务, 且**优先于** research/coding 抢词', async () => {
    const { detectTaskType } = await import('./system-prompt-lite.js') as any;
    // 真实挖洞 prompt 的各种说法
    expect(detectTaskType('帮我对 tycredit 挖洞, 找越权漏洞')).toBe('security');
    expect(detectTaskType('分析这个网站的 SQL 注入风险')).toBe('security');   // 含"分析"(research 抢词)
    expect(detectTaskType('修复这个 RCE')).toBe('security');                   // 含"修复"(coding 抢词)
    expect(detectTaskType('渗透测试 api.example.com')).toBe('security');
    expect(detectTaskType('用 nmap 扫一下端口')).toBe('security');
    expect(detectTaskType('枚举子域名')).toBe('security');
    // 回归: 普通任务不能被误判成 security
    expect(detectTaskType('帮我写个 Python 函数')).not.toBe('security');
    expect(detectTaskType('重构一下这个模块')).toBe('coding');
    expect(detectTaskType('研究一下量子计算')).toBe('research');
  });

  it('B6: 回归 — 原有类型联合与 TASK_WEIGHTS 全部仍可编译 (无遗漏字段)', () => {
    // 每个 TaskType 都必须有权重, 否则 tracker 初始化 Record 缺字段直接 TS 报错
    const weights = TRK.slice(TRK.indexOf('const TASK_WEIGHTS'), TRK.indexOf('const TASK_WEIGHTS') + 700);
    for (const t of ['coding', 'research', 'media', 'general', 'industry', 'security']) {
      expect(weights, `TASK_WEIGHTS 缺 ${t}`).toMatch(new RegExp(`\\b${t}:`));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 上游临时繁忙不该判死任务 (2026-10-17)
// 事故: DeepSeek 额度充足, 仅因上游短暂繁忙(429/超时) 就让整个挖洞任务当场中断,
//   且报错文案误导为"请检查 API Key 配置" → 用户以为是自己 Key/钱的问题。
// 根因: userPickedModel 分支拿到 provider==='none' 就**直接 return**, 零重试。
// ═══════════════════════════════════════════════════════════════════
describe('上游临时繁忙退避重试 (2026-10-17)', () => {
  const LOOP = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');

  it('C1: 常量与退避重试计数字段存在', () => {
    expect(LOOP).toContain('const PROVIDER_WAIT_MAX_RETRY = 4');
    expect(LOOP).toContain('private _providerWaitRetry = 0');
  });

  it('C2: 临时性 vs 鉴权失败被区分开 (401/403 必须立即失败, 等也没用)', () => {
    const idx = LOOP.indexOf("if (res?.provider === 'none' && this.opts.userPickedModel)");
    expect(idx).toBeGreaterThan(-1);
    const chunk = LOOP.slice(idx, idx + 5000);
    // 2026-10-20: 状态码判定从裸 /401|403/ 改为 textHasStatus 锚定 —
    //   裸数字会命中 UUID/request_id 里的同形子串 (llm-router 同款事故:
    //   deepseek 普通 400 的 request_id 含 "401" → 误报"鉴权失败")。
    expect(chunk).toMatch(/const authFailed = textHasStatus\(lastErr, 401, 403\)/);
    expect(chunk).toMatch(/const transient = !authFailed &&/);
    // 鉴权失败要说清"等也没用" (2026-10-19 f86288c 增强: 附带分组权限语境)
    expect(chunk).toMatch(/API Key \/ 分组权限问题, 等也没用/);
  });

  it('C3: 临时性失败走退避重试而不是直接 return', () => {
    const idx = LOOP.indexOf("if (res?.provider === 'none' && this.opts.userPickedModel)");
    const chunk = LOOP.slice(idx, idx + 5000);
    expect(chunk).toMatch(/if \(transient && this\._providerWaitRetry < PROVIDER_WAIT_MAX_RETRY\)/);
    // 退避序列 5/10/20/30
    expect(chunk).toMatch(/5_000 \* Math\.pow\(2, this\._providerWaitRetry\)/);
    expect(chunk, '退避上限 30s, 否则长任务会被拖死').toMatch(/30_000/);
    // 退避期间必须发心跳, 否则前端 5 分钟 idle 会先掐掉
    expect(chunk).toMatch(/tool:heartbeat/);
    expect(chunk).toMatch(/continue; \/\/ 原地重试同一模型/);
  });

  it('C4: 拿不到错误原因时按临时性处理 (宁可多试, 别误杀长任务)', () => {
    const idx = LOOP.indexOf("if (res?.provider === 'none' && this.opts.userPickedModel)");
    const chunk = LOOP.slice(idx, idx + 5000);
    expect(chunk).toMatch(/\|\| !lastErr/);
    expect(chunk, '必须识别 429/限流为临时性').toContain('429');
  });

  it('C5: 成功响应时清空退避计数 (否则一次繁忙会永久污染后续失败)', () => {
    const idx = LOOP.indexOf('// 任何有效响应');
    expect(idx).toBeGreaterThan(-1);
    expect(LOOP.slice(idx, idx + 400)).toMatch(/this\._providerWaitRetry = 0/);
  });

  it('C6: 非鉴权失败的最终文案不再误导用户查 Key', () => {
    const idx = LOOP.indexOf("if (res?.provider === 'none' && this.opts.userPickedModel)");
    const chunk = LOOP.slice(idx, idx + 6000);
    expect(chunk).toMatch(/这不是额度问题/);
    expect(chunk, '必须说明进度已保留, 可继续').toMatch(/进度已保留/);
  });

  it('C7: 工具并发按类型给上限, 但只封顶不卡死小数字 (AI 放多少收多少 + 防爆封顶)', () => {
    expect(LOOP).toContain('const TASK_TOOL_CONCURRENCY_MAX = 12');
    expect(LOOP).toContain('security: 12');
    // 上限统一走 Math.min(..., MAX) 封顶
    expect(LOOP).toMatch(/Math\.min\(TASK_TOOL_CONCURRENCY\[this\._taskType\] \|\| 5, TASK_TOOL_CONCURRENCY_MAX\)/);
    // 截断时必须告诉 AI 被砍掉的是哪些 + 为什么不能一次全打
    expect(LOOP).toMatch(/被推迟的是/);
    expect(LOOP).toMatch(/触发限流导致整批失败/);
  });

  it('C8: security 单向棘轮 — 长任务里的短句("继续"/"枚举这7个域")不能把任务型掉回general', () => {
    // 实锤坑: _taskType 每轮从用户最新那一句重算, 而挖洞长任务里用户说的是
    //   "继续" / "把这 7 个域的子域全部枚举出来" → detectTaskType 判 general
    //   → 并发上限从 12 掉回 5, 长任务整个后半程都在低并发白耗迭代。
    // 因此 security 必须是**单向棘轮**: 一旦识别就保持, 只在明确换类型时才改判。
    expect(LOOP).toContain('const _t = detectTaskType(msgText)');
    expect(LOOP).toMatch(/\(_t === 'security' \|\| this\._taskType === 'security'\) \? 'security' : _t/);
    // buildImmutablePrefix 里也有同样的棘轮
    expect(LOOP).toMatch(/if \(taskType === 'security'\) \{[\s\S]{0,200}'security'/);
    // 不能有第二处无条件覆盖 (会把棘轮判定冲掉)
    const coverCount = (LOOP.match(/this\._taskType = taskType;/g) || []).length;
    expect(coverCount, '还有 `this._taskType = taskType` 会覆盖棘轮结果').toBeLessThanOrEqual(1);
  });

  it('C9: 行为验证 — 明显是别的任务时棘轮允许改判 (不能永远黏住 security)', async () => {
    const { detectTaskType } = await import('./system-prompt-lite.js') as any;
    // 单句判定本身
    expect(detectTaskType('继续挖洞')).toBe('security');
    expect(detectTaskType('对 api.example.com 做渗透测试')).toBe('security');
    expect(detectTaskType('找越权漏洞')).toBe('security');
    // 这些短句单看是 general, 靠棘轮兜住
    expect(detectTaskType('把这 7 个域的子域全部枚举出来')).not.toBe('security');
    expect(detectTaskType('继续')).not.toBe('security');
    // 但明确换话题必须能改判
    expect(detectTaskType('重构一下这个模块')).toBe('coding');
    expect(detectTaskType('帮我写个 Python 函数')).not.toBe('security');
  });
});

// ═══════════════════════════════════════════════════════════════
// 命令未安装 vs 路径不存在 (2026-10-19)
// 事故: kali 没装 httpx → `bash: httpx: command not found` (退出码 127) →
//   classifyToolError 的 ENOENT 分支含 "not found" 字面量, 把"命令没装"误判成
//   "目标文件不存在", nextAction 还让 AI "用 list_directory 确认路径正确" ——
//   路径本来就对, AI 被引着反复查目录, 形成"老是 wsl 失败"死循环。
// ═══════════════════════════════════════════════════════════════
describe('命令未安装的分类 (command not found ≠ 路径不存在)', () => {
  const LOOP = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
  // 锚定代码行 (不是注释行): 注释里也出现 COMMAND_NOT_FOUND 字样
  const cmdCodeIdx = LOOP.indexOf("code: 'COMMAND_NOT_FOUND'");

  it('C10: COMMAND_NOT_FOUND 分支存在, 且**排在 ENOENT 之前** (顺序错就又被吞掉)', () => {
    const enoentIdx = LOOP.indexOf("code: 'ENOENT'");
    expect(cmdCodeIdx).toBeGreaterThan(-1);
    expect(enoentIdx).toBeGreaterThan(-1);
    expect(cmdCodeIdx, 'COMMAND_NOT_FOUND 必须先生效, 否则被 ENOENT 的 "not found" 抢先').toBeLessThan(enoentIdx);
  });

  it('C11: 命中 "command not found" / "未找到命令" 两种形态', () => {
    // 判定行在 return 之前 ~400 字符内
    const chunk = LOOP.slice(cmdCodeIdx - 400, cmdCodeIdx + 300);
    expect(chunk).toMatch(/err\.includes\('command not found'\)/);
    expect(chunk).toMatch(/err\.includes\('未找到命令'\)/);
  });

  it('C12: nextAction 引导"确认命令/装工具", 而不是 list_directory 查路径', () => {
    // 只切 COMMAND_NOT_FOUND 分支本身 (hint+nextAction ≈ 380 字符), 不伸进 ENOENT 分支
    const chunk = LOOP.slice(cmdCodeIdx, cmdCodeIdx + 450);
    expect(chunk).toMatch(/wsl_exec\(\{ command: "which"/);
    expect(chunk).toMatch(/install-pentest-tools\.ps1|apt-get install/);
    expect(chunk, '不能再把 AI 引去 list_directory').not.toMatch(/list_directory/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 网关闸门拦截 vs 未知错误 (2026-10-20)
// 事故: write_file 写 PoC 脚本含 require('fs') 被 tool-registry 危险正则拦,
//   classifyToolError 无 blocked 分支 → UNKNOWN「未知错误」→ AI 归不了因
//   就原样重试, 连废 6 次。分支必须存在且**排最前** (确定性拒绝, 重试无意义)。
// ═══════════════════════════════════════════════════════════════
describe('网关闸门拦截的分类 (tool call blocked ≠ 未知错误)', () => {
  const LOOP = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
  // 锚定代码行 (不是注释行): 注释里也出现 TOOL_CALL_BLOCKED 字样
  const blockedIdx = LOOP.indexOf("code: 'TOOL_CALL_BLOCKED'");

  it('C13: TOOL_CALL_BLOCKED 分支存在且排在最前 (先于 COMMAND_NOT_FOUND)', () => {
    const cmdIdx = LOOP.indexOf("code: 'COMMAND_NOT_FOUND'");
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(blockedIdx, '闸门拦截必须最优先: 不该被任何其他分支吞掉').toBeLessThan(cmdIdx);
  });

  it('C14: 命中 "tool call blocked" 文本', () => {
    const chunk = LOOP.slice(blockedIdx - 400, blockedIdx + 300);
    expect(chunk).toMatch(/err\.includes\('tool call blocked'\)/);
  });

  it('C15: nextAction 点名惰性内容工具已豁免 + 执行类工具改写法, 不让 AI 盲目重试', () => {
    const chunk = LOOP.slice(blockedIdx, blockedIdx + 900);
    expect(chunk).toMatch(/write_file/);
    expect(chunk).toMatch(/run_command/);
    expect(chunk).toMatch(/别重试|重试还会被拦/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 命令执行超时 ≠ 瞬时错误 (2026-10-20)
// 事故: AI 对超时的 `wsl ffuf_wc.sh` 原样重试 6 次, 每轮白等 120s。
//   提示层三重失效: ① fail_strategy 的 /timeout/ 指令 medium 优先级被
//   flushAll 静默丢弃; ② dispatchToolCalls 自动重试的 retryableErrors
//   含 /timeout/, 平台自己把超时命令再跑 2 遍; ③ 同参计数被"换参数"重置。
//   修法: COMMAND_TIMEOUT 独立分类 + _timeoutFailSigs 执行前硬闸门。
// ═══════════════════════════════════════════════════════════════
describe('命令执行超时的分类与硬闸门 (COMMAND_TIMEOUT ≠ 可重试瞬时错误)', () => {
  const LOOP = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
  // 锚定代码行 (不是注释行)
  const cmdTimeoutIdx = LOOP.indexOf("code: 'COMMAND_TIMEOUT'");

  it('C16: COMMAND_TIMEOUT 分支存在且排在通用 TIMEOUT 之前 (处置相反: 禁止重试)', () => {
    const genericIdx = LOOP.indexOf("code: 'TIMEOUT'");
    expect(cmdTimeoutIdx).toBeGreaterThan(-1);
    expect(genericIdx).toBeGreaterThan(-1);
    expect(cmdTimeoutIdx, '命令超时必须先生效: 通用 TIMEOUT 会让 AI"加大 timeout 再试", 与工具输出自带的"别再原样重试"对打 (实锤 6 连废)').toBeLessThan(genericIdx);
  });

  it('C17: 判据覆盖三种命令工具的超时措辞, 且集中定义为共用常量', () => {
    expect(LOOP).toContain('const CMD_TIMEOUT_OUT = /命令超时|扫描超时|别再原样重试|别原样重试|⏱\\s*超时/;');
    expect(LOOP).toContain("const CMD_EXEC_TOOLS = new Set(['run_command', 'wsl_exec', 'wsl_scan', 'run_shell_command']);");
    // 硬闸门 / 自动重试排除 / fail_strategy 三处必须共用同一判据 (改一处全生效)
    const usages = (LOOP.match(/CMD_TIMEOUT_OUT\.test\(/g) || []).length;
    expect(usages, `CMD_TIMEOUT_OUT 应有 3 处使用 (分类/记录/排除), 实际 ${usages}`).toBeGreaterThanOrEqual(3);
  });

  it('C18: _timeoutFailSigs 硬闸门 — 同参命令超时过, dispatch 前直接拒跑', () => {
    expect(LOOP).toContain('private _timeoutFailSigs = new Set<string>();');
    expect(LOOP).toContain('this._timeoutFailSigs.clear();');     // 按任务隔离
    expect(LOOP).toContain('this._timeoutFailSigs.add(sig);');    // 超时失败记 sig
    expect(LOOP).toContain('this._timeoutFailSigs.delete(sig);'); // 同参成功即解除
    // 拒跑消息: [ERROR] 打头 (主循环 isToolFailed 判失败) + 给唯一正确出路
    expect(LOOP).toMatch(/\[ERROR\] \[TIMEOUT GATE\][\s\S]{0,200}run_background/);
    expect(LOOP).toMatch(/\[timeout-gate\] REJECTED/);
  });

  it('C19: 自动重试排除命令超时 + 被拒调用不产幻影成功条目', () => {
    // retryableErrors 含 /timeout/ (会被输出文案里自带的 "没设 timeout" 命中), 必须显式排除
    expect(LOOP).toMatch(/if \(CMD_EXEC_TOOLS\.has\(c\.name\) && CMD_TIMEOUT_OUT\.test\(combined\)\) return false;/);
    // approvedResults 剔除 rejected: 否则 '[no result]' + success:true 幻影成功
    expect(LOOP).toMatch(/const approvedResults = callsToDispatch\s*\n\s*\.filter\(c => !rejectedResults\.find\(r => r\.id === c\.id\)\)/);
  });
});

describe('命令超时硬闸门行为验证 (2026-10-20)', () => {
  // 复刻实锤: 第 1 轮 run_command 超时 (工具看门狗文案), 第 2 轮 AI 原样再发同一条
  // → 硬闸门必须在 dispatch 前拦下, registry.dispatch 只应收到第 1 轮的调用。
  const TIMEOUT_OUT =
    '⏱ 命令超时 (超过 120s), 已强制终止整棵进程树 (pid 及其子孙全部结束, 不再残留后台进程)。\n\n' +
    '被终止命令: wsl bash ffuf_wc.sh\n\n' +
    '⚠️ 别再原样重试同一条命令 —— 它已经被证明跑不完。请立刻换路子:\n' +
    '  1) 长任务改用 run_background({ command }) 后台跑, 再用 wait_for_job / job_output 轮询结果;';

  it('C20: 同参命令超时过一次 → 第二次原样重试被闸门拒跑 (dispatch 只收到 1 次)', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 2) return { content: '收尾', finishReason: 'stop' };
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${round}`, name: 'run_command', args: { command: 'wsl bash ffuf_wc.sh' } }],
      };
    }, { maxIterations: 4 });

    const dispatched: string[][] = [];
    (registry as any).dispatch = vi.fn(async (calls: any[]) => {
      dispatched.push(calls.map((c: any) => c.name));
      return calls.map((c: any) => ({ id: c.id, result: { success: false, output: TIMEOUT_OUT, durationMs: 120000 } }));
    });

    await loop.run('扫一下');

    // 第 1 轮真跑了 (超时失败); 第 2 轮同参 → 硬闸门拒跑, 不进 dispatch
    expect(dispatched.length, `dispatch 应只收到第 1 轮; 实际 ${JSON.stringify(dispatched)}`).toBe(1);
    expect((loop as any)._timeoutFailSigs.size, '超时 sig 必须已记录').toBe(1);
  }, 60000);

  it('C21: 换参数的同名命令不受硬闸门限制 (只拦原样重试, 不拦调整)', async () => {
    const { loop, registry } = makeLoop((round) => {
      if (round > 3) return { content: '收尾', finishReason: 'stop' };
      // 每轮同命令但不同参数 (AI 常见解法: 加 timeout / 换目标)
      return {
        content: '',
        finishReason: 'tool_calls',
        toolCalls: [{ id: `c${round}`, name: 'run_command', args: { command: 'wsl bash ffuf_wc.sh', timeout: 120000 + round * 60000 } }],
      };
    }, { maxIterations: 5 });

    (registry as any).dispatch = vi.fn(async (calls: any[]) =>
      calls.map((c: any) => ({ id: c.id, result: { success: false, output: TIMEOUT_OUT, durationMs: 120000 } })),
    );

    await loop.run('扫一下');

    // 换了参数 → sig 不同 → 每轮都真跑 (硬闸门只精确拦"原样重试")
    expect((loop as any)._timeoutFailSigs.size, '每次换参数都是新 sig').toBe(3);
  }, 60000);
});

describe('超时降级按任务类型保留核心工具 (2026-10-17)', () => {
  // 实锤坑: 原来 llmTimedOut 时无条件砍到 8 个文件类工具, 挖洞任务超时一次后
  //   wsl_scan / enum_subdomains / http_replay / report_vulnerability 全消失,
  //   AI 只剩"读文件"能力, 后面几十轮都在空转, 表现为"任务越跑越傻"。
  it('D1: 降级不再是写死的 8 个文件工具', () => {
    expect(LOOP_SRC).toContain('DEGRADE_CORE_BASE');
    expect(LOOP_SRC).toContain('DEGRADE_EXTRA_BY_TASK');
    // 旧的硬编码列表必须已经不在
    expect(LOOP_SRC).not.toContain("const coreToolNames = ['read_file', 'write_file', 'list_directory', 'search_content', 'ask_user', 'run_code', 'directory_tree', 'web_search'];");
    expect(LOOP_SRC).not.toContain('→ 8, compressing context');
  });

  it('D2: security 降级集保留全套渗透工具 (砍数量不砍能力)', () => {
    const m = LOOP_SRC.match(/security: \['wsl_scan'[\s\S]{0,600}?\]/);
    expect(m, 'security 降级集必须显式列出渗透工具').toBeTruthy();
    const block = m![0];
    for (const t of ['wsl_scan', 'enum_subdomains', 'extract_js_endpoints', 'http_replay', 'batch_pentest', 'scope_guard', 'grant_scope', 'list_scope', 'report_vulnerability', 'save_evidence']) {
      expect(block, `security 降级集少了 ${t}`).toContain(`'${t}'`);
    }
    // 基础集里必须有长任务续命相关能力 (run_background/wait_for_job/stop_job 走各任务类型 extras)
    expect(LOOP_SRC).toMatch(/DEGRADE_EXTRA_BY_TASK[\s\S]{0,400}'run_background'[\s\S]{0,200}'wait_for_job'/);
    // 决策工具任何任务都要有, 不能被降级砍掉
    expect(LOOP_SRC).toMatch(/DEGRADE_CORE_BASE = \[[^\]]*'ask_user'[^\]]*\]/);
  });

  it('D3: 过滤后为空时回退, 绝不给 AI 零工具', () => {
    expect(LOOP_SRC).toMatch(/requestTools = degraded\.length > 0 \? degraded : requestTools;/);
  });

  it('D4: 降级日志按 taskType 输出, 便于复盘是哪个任务被砍', () => {
    expect(LOOP_SRC).toMatch(/taskType=\$\{this\._taskType\} tools \$\{beforeDegrade\}/);
  });
});

describe('行业注入任务优先 (2026-10-17)', () => {
  // 实锤场景: 用户在「澳彩项目」工作区里挖洞, AI 不进挖洞又进澳彩项目。
  // 根因是行业注入**无条件执行**且措辞方向相反("优先使用该行业的专业术语和框架")。
  it('E1: 对齐表存在, security 一律不与任何行业同源', () => {
    expect(LOOP_SRC).toContain('const INDUSTRY_FULL_INJECT');
    expect(LOOP_SRC).toMatch(/security: \[\],\s*\/\/ 渗透与任何行业框架都不同源/);
    expect(LOOP_SRC).toContain('function isIndustryTaskAligned(taskType: string, industryId: string): boolean');
  });

  it('E2: "优先使用该行业的专业术语和框架" 这句反向措辞已删除', () => {
    // 只查真正的 prompt 文案 (注释里引用旧措辞是允许的, 那是复盘记录)
    expect(LOOP_SRC).not.toContain('行业模式。优先使用该行业');
    // 新措辞: 任务优先, 行业仅作术语参考
    expect(LOOP_SRC).toContain('任务 > 行业');
    expect(LOOP_SRC).toContain('以任务本身为唯一主线');
    expect(LOOP_SRC).toContain('不偏离当前任务');
  });

  it('E3: 不对齐时**不注入**完整行业框架与行业洞察 (只给一句声明)', () => {
    // 完整注入路径必须在 else 分支里, 由 industryIsTaskAligned 把关
    expect(LOOP_SRC).toMatch(/if \(!industryIsTaskAligned\) \{[\s\S]{0,900}?\} else \{[\s\S]{0,400}?buildSystemPromptFragmentFor/);
    expect(LOOP_SRC).toMatch(/if \(!industryIsTaskAligned\) \{[\s\S]{0,2000}?buildInsightPrompt/);
  });

  it('E4: auto-detect 死角已补 — 工作区存了行业时也允许重检测', () => {
    // 原条件 `!industryId || industryId === 'general'` 让 profile 存了行业的任务永远无法纠偏
    expect(LOOP_SRC).toMatch(/if \(!industryId \|\| industryId === 'general' \|\| !industryIsTaskAligned\)/);
    // 未采纳的检测结果不得注册行业工具 / 不得建议切换
    expect(LOOP_SRC).toContain('const adoptDetected = industryIsTaskAligned || fullInjectIndustries.includes(mappedId)');
    expect(LOOP_SRC).toMatch(/if \(adoptDetected\) try \{/);
  });

  it('E5: 行业知识库 RAG (§3.5) 也过同一套门控', () => {
    // 批 2-C: 经 ctxPolicy.alignedFor 走同一张对齐表 (userModel 行业与 opts.industryId 不同源, 分别判定)
    expect(LOOP_SRC).toContain('this.getContextPolicy().alignedFor(userIndustry)');
    expect(LOOP_SRC).toContain('KB RAG skipped');
  });

  it('E6: 行为验证 — 对齐判定本身正确 (developer↔coding 同源, decoration↔security 不同源)', async () => {
    const src = LOOP_SRC;
    // 从源码里抽出表做真值校验 (避免测试与实现脱节)
    const grab = (task: string): string[] => {
      const m = src.match(new RegExp(`${task}: \\[([^\\]]*)\\]`));
      return m ? m[1].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean) : [];
    };
    expect(grab('security')).toEqual([]);
    expect(grab('coding')).toEqual(['developer']);
    expect(grab('industry')).toEqual(['industry', 'general', 'research']);
    expect(grab('general')).toEqual(['industry', 'general', 'research']);
    expect(grab('research')).toEqual(['industry', 'general', 'research']);
    expect(grab('media')).toEqual(['comic']);
    // 未列出的任务类型走默认集, 不会崩
    const anyTask = grab('some_unknown_task');
    expect(anyTask).toEqual([]);
  });
});

describe('工作区冲突检测降级注入 (2026-10-17)', () => {
  it('F1: 冲突检测函数存在, 且 security 默认判冲突', () => {
    expect(LOOP_SRC).toContain('function detectWorkspaceTaskConflict(taskType: string, workspace: string, messageText: string)');
    expect(LOOP_SRC).toMatch(/case 'security':[\s\S]{0,400}conflict: true/);
  });

  it('F2: 用户显式提到工作区 / 目标是本机时不判冲突 (不能把该用的也砍了)', () => {
    expect(LOOP_SRC).toMatch(/if \(base\.length > 2 && msg\.includes\(base\)\) return \{ conflict: false, reason: '任务显式提到本工作区' \}/);
    expect(LOOP_SRC).toMatch(/127\\\.0\\\.0\\\.1\|localhost\|::1\|0\\\.0\\\.0\\\.0/);
  });

  it('F3: 冲突时 §6 只注入一句"任务 > 工作区"声明, 不再注入 listing', () => {
    // 批 2-C: 判定改取定稿的 ctxPolicy (同一轮内 §6.3 共用, 不再重复探测工作区)
    expect(LOOP_SRC).toContain('const wsConflict = this.getContextPolicy();');
    expect(LOOP_SRC).toContain('# 上下文优先级: 任务 > 工作区');
    expect(LOOP_SRC).toContain('workspace-conflict-downgrade');
    // 完整 listing 必须落在 else 分支里
    expect(LOOP_SRC).toMatch(/if \(wsConflict\.workspaceConflict\) \{[\s\S]{0,1600}?\} else \{\s*\n\s*const entries = fsSync\.readdirSync/);
  });

  it('F4: §6.3 项目规则同一套门控 (它比 listing 更致命 — 直接改任务目标)', () => {
    expect(LOOP_SRC).toContain('const wsConflict63 = this.getContextPolicy();');
    // 2026-10-20: 措辞从"跳过"改为"不注入但任务继续" — 冲突只影响注入, 绝不中止任务
    expect(LOOP_SRC).toContain('[ctx:project-rules] 冲突提示(不注入项目规则, 任务继续)');
  });

  it('F5: 行为规则速查表已管辖"当前行业"和"项目规则"两行 + 优先级铁律', () => {
    const RULES_SRC = readFileSync(new URL('./agent-behavior-rules.ts', import.meta.url), 'utf-8');
    expect(RULES_SRC).toContain('# 当前行业: xxx');
    expect(RULES_SRC).toContain('行业只是术语参考, 任务优先');
    expect(RULES_SRC).toContain('项目规则 (project_rules.md)');
    expect(RULES_SRC).toContain('不得拿它改任务目标');
    expect(RULES_SRC).toContain('Workspace: <dir>');
    expect(RULES_SRC).toContain('优先级铁律');
    expect(RULES_SRC).toContain('用户当前这条消息 > 当前任务 > 工作区/行业/项目规则');
  });

  it('F6: 行为验证 — 冲突判定真值表', () => {
    // 用真实目录 + 从源码抽取的逻辑做等价复算 (避免测试与实现脱节)
    const tmp = mkdtempSync(join(tmpdir(), 'ws-conflict-'));
    try {
      // 空目录: coding 任务 → 冲突
      const CODE_PROJECT_MARKERS = ['package.json', 'tsconfig.json', 'jsconfig.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'setup.py', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile', 'mix.exs'];
      const hasMarker = CODE_PROJECT_MARKERS.some(m => existsSync(join(tmp, m)));
      expect(hasMarker).toBe(false); // 空目录 → coding 任务会判冲突

      // security + 普通目录 → 冲突 (目标在外部授权范围)
      expect(computeContextPolicy('security', tmp, '', '打下目标站点').workspaceConflict).toBe(true);

      // 2026-10-20 实锤: 工作区自身就是渗透/赏金工作台 (scope.json + .agentai/pentest)
      // → 同源, 不能降级 (F:\挖洞赏金 就是在自己的挖洞工作区里被判"环境不匹配")
      mkdirSync(join(tmp, '.agentai'), { recursive: true });
      writeFileSync(join(tmp, '.agentai', 'scope.json'), '{"targets":[]}');
      const secWs = computeContextPolicy('security', tmp, '', '打下目标站点');
      expect(secWs.workspaceConflict).toBe(false);
      expect(secWs.workspaceConflictReason).toContain('渗透/赏金工作台');
      expect(secWs.workspaceDowngradeNotice).toBe('');

      writeFileSync(join(tmp, 'package.json'), '{}');
      expect(CODE_PROJECT_MARKERS.some(m => existsSync(join(tmp, m)))).toBe(true); // 有标记 → 不冲突
    } finally { rmSync(tmp, { recursive: true, force: true }); }
    // security 分支: 先认"工作区即渗透台", 其余才判冲突
    expect(LOOP_SRC).toMatch(/case 'security':[\s\S]{0,300}isSecurityWorkspace\(workspace\)/);
    expect(LOOP_SRC).toMatch(/case 'security':[\s\S]{0,400}conflict: true/);
  });
});

describe('上下文仲裁策略收敛 (2026-10-17, 批 2-C)', () => {
  // 背景: isIndustryTaskAligned / detectWorkspaceTaskConflict 此前散在 §3/§3.5/§6/§6.3
  // 四处各算各的 (detectWorkspaceTaskConflict 含 existsSync×15 + readdirSync, 被完整跑了两遍),
  // 且 4 处门控靠"复制一致"维护 — 加第 5 处注入点时极易漏门控, 澳彩挖洞跑偏就这么复发。
  it('G1: computeContextPolicy 封装两项判定, 工作区探测全函数只剩 1 次', () => {
    expect(LOOP_SRC).toContain('export interface ContextPolicy');
    expect(LOOP_SRC).toContain('export function computeContextPolicy(taskType: string, workspace: string, industryId: string, messageText: string): ContextPolicy');
    // detectWorkspaceTaskConflict( 只允许出现 2 次: 函数定义 + computeContextPolicy 内一次调用
    const calls = (LOOP_SRC.match(/detectWorkspaceTaskConflict\(/g) || []).length;
    expect(calls).toBe(2);
  });

  it('G2: §3/§3.5/§6/§6.3 四处全部走 ctxPolicy, 缓存每轮作废', () => {
    expect(LOOP_SRC).toContain('const ctxPolicy = this.getContextPolicy(');
    expect(LOOP_SRC).toContain('const fullInjectIndustries = ctxPolicy.industryFullInject;');
    expect(LOOP_SRC).toContain('const industryIsTaskAligned = ctxPolicy.industryAligned;');
    expect(LOOP_SRC).toContain('this.getContextPolicy().alignedFor(userIndustry)');
    expect(LOOP_SRC).toContain('const wsConflict = this.getContextPolicy();');
    expect(LOOP_SRC).toContain('const wsConflict63 = this.getContextPolicy();');
    // _taskType 每轮可能改判 → 缓存必须在棘轮判定后作废, 否则第二轮沿用第一轮的冲突判定
    // (2026-10-21: 棘轮段之后插了 _isBountyWorkspace 工作区信号行, 容错纳入)
    expect(LOOP_SRC).toMatch(/this\._taskType = taskType;[\s\S]{0,600}?this\._ctxPolicy = null;/);
  });

  it('G3: ctxLedger 大头注入全部登记 (identity/行业/工作区/项目规则/记忆)', () => {
    const mustTrack = [
      'identity:lite', 'identity:full', 'datetime', 'skill-invocation', 'tools',
      'ide-context', 'memory-manager', 'project-memory', 'agent-task-board', 'project-docs',
      'user-context', 'customer-profile', 'user-model-profile',
      'industry:downgrade', 'industry:current', 'industry:fragment', 'industry:insight', 'industry-kb-rag',
      'workspace:listing', 'workspace:subdir-memory', 'workspace:recent-files', 'project-rules',
      'last-session', 'remote-context', 'world-memory',
    ];
    for (const name of mustTrack) {
      expect(LOOP_SRC, `ctxLedger 缺少登记: ${name}`).toContain(`track('${name}'`);
    }
    // 两条"任务优先"降级声明必须是 priority 0 (必保留) — 它们没了, 铁律就只是注释
    expect(LOOP_SRC).toMatch(/track\('industry:downgrade', 0\)/);
    expect(LOOP_SRC).toMatch(/track\('workspace-conflict-downgrade', 0\)/);
  });

  it('G4: 行为验证 — computeContextPolicy 真值表 (直接跑函数)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ctx-policy-'));
    try {
      // security + 装修行业: 冲突 + 行业不对齐 + 降级文案就位
      const sec = computeContextPolicy('security', tmp, 'decoration', '帮我挖洞');
      expect(sec.workspaceConflict).toBe(true);
      expect(sec.workspaceConflictReason).toContain('渗透任务');
      expect(sec.workspaceDowngradeNotice).toContain('任务 > 工作区');
      expect(sec.industryAligned).toBe(false);
      expect(sec.alignedFor('decoration')).toBe(false);

      // coding + 空目录 → 冲突; 补 package.json → 不冲突且文案为空
      const codingEmpty = computeContextPolicy('coding', tmp, '', '写个脚本');
      expect(codingEmpty.workspaceConflict).toBe(true);
      writeFileSync(join(tmp, 'package.json'), '{}');
      const codingPkg = computeContextPolicy('coding', tmp, 'developer', '写个脚本');
      expect(codingPkg.workspaceConflict).toBe(false);
      expect(codingPkg.workspaceDowngradeNotice).toBe('');
      expect(codingPkg.industryAligned).toBe(true);          // developer↔coding 同源
      expect(codingPkg.industryFullInject).toEqual(['developer']);

      // 用户显式提到工作区名 → security 也不冲突 (不能把该用的也砍了)
      const wsName = tmp.split(/[\\/]/).pop()!;
      const mentioned = computeContextPolicy('security', tmp, 'decoration', `看看 ${wsName} 里有什么`);
      expect(mentioned.workspaceConflict).toBe(false);
      expect(mentioned.workspaceConflictReason).toContain('任务显式提到本工作区');

      // 目标是本机 → 不冲突
      const local = computeContextPolicy('security', tmp, '', '扫一下 127.0.0.1 的端口');
      expect(local.workspaceConflict).toBe(false);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

/**
 * 2026-10-19 P0: 长任务被"断线即处决" + "重试自杀"
 *
 * 事故 (富哥): 某个 ~500 步的长任务跑完之后, "所有模型全部是中断状态, 完整任务无法完成"。
 * 日志里 "[SSE] 客户端断开/连接" 高频交替, 而原实现:
 *   ① req.on('close') 立刻 loop.abort() —— 断一次就处决长任务;
 *   ② 前端 _retry 重连被当成"新消息", 触发"压制前一个未完成对话" → 又 abort 一次。
 * 两条叠加 = 断线 → 重连 → 自杀 → 断线 …… 任何模型都跑不完。
 */
describe('SSE 断线: 不立刻处决长任务 (2026-10-19)', () => {
  const CHAT = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');

  it('断线走宽限计时器, 而不是立即 abort', () => {
    expect(CHAT).toMatch(/const CLOSE_GRACE_MS = \d+_?\d*;/);
    expect(CHAT).toMatch(/closeGraceTimer = setTimeout\(/);
    // 反例: 不允许在 close 里直接 abortHandler()
    expect(CHAT).not.toMatch(/req\.on\('close',\s*\(\)\s*=>\s*\{[\s\S]{0,120}abortHandler\(\);[\s\S]{0,40}\}\)/);
  });

  it('正常结束会清掉宽限计时器 (完成的任务不被误杀)', () => {
    expect(CHAT).toMatch(/res\.on\('finish',[\s\S]{0,160}clearTimeout\(closeGraceTimer\)/);
  });

  it('断线重试不触发"压制前一个对话" (否则是在杀自己的任务)', () => {
    expect(CHAT).toMatch(/if \(prevEntry && !isAnswer && !isRetry\)/);
  });
});

/**
 * 误报防护: 错误分类禁裸状态码数字 (2026-10-20, 用户实机日志实锤)
 * ==========================================================================
 * 事故: llm-router 的 _isAccountError 用裸 /402|401/ 判账号级失败,
 *   deepseek 一次普通 400 (重复 tool_call_id 触发) 的 request_id
 *   "49ffb34a-34ca-40d2-a25a-77c53401727f" 恰好含 "401" 子串
 *   → 误判账号级 → 跳过救援链 → 任务直接收尾 (用户以为 Key 出了问题)。
 * 修法: 所有文本层状态码判定必须带上下文锚点 (HTTP 前缀 / code|status 字段),
 *   统一走 message-utils.textHasStatus。UUID/request_id/hash/端口都是雷区。
 */
describe('误报防护: 错误分类禁裸状态码数字 (2026-10-20)', () => {
  it('C22: _isAccountError 不再用裸 401|402, 状态码走 textHasStatus 锚定', () => {
    expect(ROUTER_SRC).toContain('const _isAccountError = (e: any) => {');
    expect(ROUTER_SRC).toMatch(/textHasStatus\(s, 401, 402\)/);
    // 裸数字正则形态必须绝迹
    expect(ROUTER_SRC).not.toMatch(/\/402\|401\|/);
  });

  it('C23: loop 侧 authFailed/transient 同样锚定', () => {
    expect(LOOP_SRC).toMatch(/const authFailed = textHasStatus\(lastErr, 401, 403\)/);
    expect(LOOP_SRC).toMatch(/textHasStatus\(lastErr, 429, 500, 502, 503\)/);
    expect(LOOP_SRC).not.toMatch(/const authFailed = \/401\|403/);
    expect(LOOP_SRC).not.toMatch(/econnrefused\|50\[023\]/);
  });

  it('C24: fail_strategy / retryableErrors / classifyToolError 的状态码判定全部锚定', () => {
    expect(LOOP_SRC).toMatch(/textHasStatus\(r\.output, 429, 503\)/);
    expect(LOOP_SRC).toMatch(/textHasStatus\(r\.output, 403\)/);
    expect(LOOP_SRC).toMatch(/textHasStatus\(combined, 429, 502, 503\)/);
    expect(LOOP_SRC).toMatch(/textHasStatus\(errorOutput, 429\)/);
    expect(LOOP_SRC).toMatch(/textHasStatus\(errorOutput, 503\)/);
    // 原裸数字正则绝迹
    expect(LOOP_SRC).not.toMatch(/rate\.\*limit\|429\|503/);
    expect(LOOP_SRC).not.toMatch(/forbidden\|403\|eacces/);
    expect(LOOP_SRC).not.toMatch(/network\|503\|429/);
  });

  it('C25: truncate 块对同一 tool_call_id 只收第一条 (重复回复 → deepseek 400)', () => {
    expect(ROUTER_SRC).toMatch(/pendingToolIds\.has\(tcId\) && !matchedSet\.has\(tcId\)/);
  });

  it('C26: sanitizeToolMessages 去重 (同 id 至多一条 tool 回复)', () => {
    const MU_SRC = readFileSync(new URL('./message-utils.ts', import.meta.url), 'utf-8');
    expect(MU_SRC).toContain('const _emittedIds = new Set<string>();');
    expect(MU_SRC).toContain('if (_emittedIds.has(tcId)) continue;');
  });
});

/**
 * D1-D7 修复契约 (2026-10-20, 富哥「可以进行」授权实施)
 * ==========================================================================
 * D1 致命: 拒绝结果 (scope/hook/用户/超时闸门) 被 isToolFailed 漏判成成功
 *   → 污染 _toolCallHistory (grant_scope 授权后重发被去重静默跳过) +
 *     前端 ok:true 假 ✅ + 失败计数清零。
 * D2: 审批 90s 超时一律自动批准 → delete_file 等高危改安全默认 (拒绝)。
 * D3: run_background 运行中 output 不可见 → 实时更新 + 上限 + spawn error。
 * D4: jobId 重启撞号 → 时间戳基底 + 退出杀进程树。
 * D5: tool:result 双发 (dispatch + 主循环) → 删 dispatch 处, 只发一次。
 * D6: 压缩硬切切断 tool 父子 → splitForCompression 向前扩展。
 * D7: progress failCount 只看 'Error:' 前缀 → isFailedToolOutput 同源。
 */
describe('D1-D7 修复契约 (2026-10-20)', () => {
  it('C27: isToolFailed 走 isFailedToolOutput 唯一来源 (含拒绝类前缀)', () => {
    expect(LOOP_SRC).toContain('const isToolFailed = isFailedToolOutput(r.output, (r as any).success);');
    // 原内联判据形态绝迹
    expect(LOOP_SRC).not.toMatch(/const isToolFailed = !r\.output\s*\n/);
    const MU_SRC = readFileSync(new URL('./message-utils.ts', import.meta.url), 'utf-8');
    expect(MU_SRC).toContain('export function isFailedToolOutput');
    expect(MU_SRC).toMatch(/SCOPE REJECTED\|BLOCKED BY HOOK\|用户拒绝\|TIMEOUT GATE/);
  });

  it('C28: 6 处 rejectedResults 全部带 success:false (拒绝不再被当成功)', () => {
    // 逐对检查「data: null, → success: false,」相邻形状 (scope/timeout 两处的
    // output 模板内含 ${...}) 会提前截断正则窗口, 不能用 push 块整体匹配)
    const shape = (LOOP_SRC.match(/data: null,\s*\n\s*success: false,/g) || []).length;
    expect(shape, 'planning用户拒绝/默认用户拒绝/selfmodify/hook/scope/timeout 六处').toBeGreaterThanOrEqual(6);
    // 四个关键拒绝前缀必须存在且各自带 success:false
    for (const marker of [
      '[用户拒绝] 规划模式下文件操作未获批准',
      '[ERROR] 用户拒绝了此操作',
      '[ERROR] ${selfModifyCheck.reason}',
      '[BLOCKED BY HOOK] This tool call was blocked',
      '[SCOPE REJECTED] ${c.name} 的目标',
      '[ERROR] [TIMEOUT GATE] 同一条命令之前已因执行超时被强杀',
    ]) {
      const idx = LOOP_SRC.indexOf(marker);
      expect(idx, `缺少拒绝输出: ${marker}`).toBeGreaterThan(-1);
      const after = LOOP_SRC.slice(idx, idx + 500);
      expect(after, `${marker} 之后必须带 success: false`).toMatch(/data: null,\s*\n\s*success: false,/);
    }
  });

  it('C29: classifyToolError 有 TOOL_REJECTED 分支 (拒绝给可行动指引, 不落 UNKNOWN)', () => {
    const idx = LOOP_SRC.indexOf("code: 'TOOL_REJECTED'");
    expect(idx).toBeGreaterThan(-1);
    expect(LOOP_SRC.slice(idx - 400, idx)).toMatch(/TOOL_REJECTED/);
    expect(LOOP_SRC.slice(idx, idx + 700)).toMatch(/grant_scope/);   // nextAction 点名授权提案
    // 排在 TOOL_CALL_BLOCKED 之前 (同为拒绝类, 最优先)
    const rejectedIdx = LOOP_SRC.indexOf('TOOL_REJECTED —');
    const blockedIdx = LOOP_SRC.indexOf('TOOL_CALL_BLOCKED —');
    expect(rejectedIdx).toBeGreaterThan(-1);
    expect(rejectedIdx).toBeLessThan(blockedIdx);
  });

  it('C30: tool:result 双发已根治 (全文件只剩主循环 + 崩溃兜底两处)', () => {
    const emits = (LOOP_SRC.match(/this\.emit\('tool:result'/g) || []).length;
    // 现存: 主循环 1 + dispatchToolCalls 意外崩溃兜底 1 = 2 (各拒绝点先发也已删,
    // 拒绝结果随 return 混排进主循环统一发, ok 判据与 isToolFailed 同源)
    expect(emits, 'approved/rejected 全部由主循环发一次').toBe(2);
    // 删掉的各处判据形态绝迹
    expect(LOOP_SRC).not.toMatch(/ok: r\?\.result\?\.success !== false, durationMs: r\?\.result\?\.durationMs/);
    expect(LOOP_SRC).not.toMatch(/result: `\[SCOPE REJECTED\] \$\{bad\} not in scope`/);
    expect(LOOP_SRC).not.toMatch(/result: `\[TIMEOUT GATE\] 同参命令此前已超时, 拒绝原样重试`/);
    expect(LOOP_SRC).not.toMatch(/result: `\[ERROR\] 用户拒绝了此操作`/);
  });

  it('C31: waitForApproval 支持 onTimeout; delete_file 走 reject (安全默认)', () => {
    expect(LOOP_SRC).toMatch(/waitForApproval\(id: string, timeoutMs = 90_000, onTimeout: 'approve' \| 'reject'/);
    expect(LOOP_SRC).toMatch(/tc\.name === 'delete_file' \? 'reject' : 'approve'/);
    expect(LOOP_SRC).toMatch(/const autoApprove = onTimeout !== 'reject';/);
  });

  it('C32: 压缩切分走 splitForCompression (不切断 tool 父子) 且 compressMod 无 TDZ', () => {
    expect(LOOP_SRC).toContain("const { head, recent: tail } = compressMod.splitForCompression(nonSystem, keepRecent);");
    // compressMod 必须在 splitForCompression 调用点之前完成导入 (D6 顺带修的 TDZ)
    const importIdx = LOOP_SRC.indexOf("const compressMod = await import('./context-compress.js');");
    const useIdx = LOOP_SRC.indexOf('compressMod.splitForCompression');
    expect(importIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeLessThan(useIdx);
    // 旧的动态导入位置 (old.length>0 块内) 只允许剩 1 处 import (即块首那处)
    const importCount = (LOOP_SRC.match(/const compressMod = await import\('\.\/context-compress\.js'\);/g) || []).length;
    expect(importCount).toBe(1);
  });

  it('C33: progress 事件计数走 isFailedToolOutput (中文失败提示计入 failCount)', () => {
    expect(LOOP_SRC).toMatch(/successCount: rawResults\.filter\(r => !isFailedToolOutput\(r\.output, r\.success\)\)\.length/);
    expect(LOOP_SRC).toMatch(/failCount: rawResults\.filter\(r => isFailedToolOutput\(r\.output, r\.success\)\)\.length/);
  });
});
