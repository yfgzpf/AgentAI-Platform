/**
 * subagent-schema — 子智能体结构化协议 (2026-10-21, 富哥方案落地)
 * ----------------------------------------------------------------
 * 富哥《并行子智能体编排改造方案》第 4 节: 工具化委托, 结构化返回。
 *
 * 设计原则:
 *   · 子智能体是**可选工具**, 不是任务中转 — Task 里没有"下发"语义,
 *     只有 subject/objective/constraints/context/reason
 *   · reason 必填 (防滥用审计): 模型必须说明"为什么这次要委托",
 *     日志可复盘; 大量"例行委托"= 提示词需收紧 (方案 9.3)
 *   · Result 固定 schema: 主智能体收到就能判断可用性,
 *     不用解析自由文本 (方案 4.3)
 *   · 兼容存量: 现有 spawn_subagent({type, task}) 参数继续可用,
 *     type 保留作角色路由 (pentest_* 闸门依据), 不破坏既有调用
 */

/** 子任务输入 (方案 4.2) */
export interface SubagentTask {
  /** 任务对象: 目标 host / 主题 / 文件 / URL (由子智能体自行解释) */
  subject: string;
  /** 本次子任务的具体目标 */
  objective: string;
  /** 可选约束: 范围/白名单/时间预算 */
  constraints: Record<string, unknown>;
  /** 主智能体显式传递的必要背景 (子智能体不共享主对话历史) */
  context: string;
  /** 必填: 触发本次调用的理由 (审计+复盘用) */
  reason: string;
  /** 角色路由 (兼容存量: pentest_planner/recon/...; 空=通用) */
  type: string;
  /** 回合内同步等待上限 ms (默认 300000; 到点转后台不杀) */
  timeoutMs: number;
  /** 显式后台执行 (不等回合内结果) */
  background: boolean;
}

/** 子任务结果 (方案 4.3) */
export interface SubagentResult {
  status: 'success' | 'partial' | 'failed' | 'timeout';
  /** 一句话结论 */
  summary: string;
  /** 关键证据 (输出摘要/引用片段) */
  evidence: string[];
  /** 结构化发现 (字段由子智能体自定义) */
  findings: Array<Record<string, unknown>>;
  /** 建议的下一步 (仅参考, 决策权在主智能体) */
  next_suggestion: string;
  /** 本次子任务消耗 token (成本核算用, 方案 4.3/11 节) */
  tokens_used: number;
  /** 本次子任务耗时 ms */
  durationMs: number;
  /** 子任务 id (前端/产物面板可查) */
  subagentId: string;
  /** 是否已转后台继续跑 (timeout 时 true) */
  wentBackground: boolean;
  /** 实际用的模型 */
  model?: string;
  /** 迭代轮数 */
  iterations?: number;
}

export const SUBAGENT_SYNC_TIMEOUT_MS = 300_000; // 回合内同步等待上限 (方案 6.2 默认 300s)

/**
 * 把工具入参归一成 SubagentTask。
 * 兼容存量调用形态: {type, task} / {subject, objective, reason}
 * reason 缺失不报错 (老调用方/老模型), 但 reasonProvided=false 供审计计数。
 */
export function normalizeSubagentTask(args: Record<string, any>): {
  task: SubagentTask;
  reasonProvided: boolean;
} {
  const type = String(args?.type || '').trim();
  const task = String(args?.task || '').trim();
  const subject = String(args?.subject || args?.target || '').trim();
  const objective = String(args?.objective || task || '').trim();
  const reason = String(args?.reason || '').trim();
  const constraints = (args?.constraints && typeof args.constraints === 'object')
    ? args.constraints as Record<string, unknown>
    : {};
  const context = String(args?.context || '').trim();
  const timeoutMs = Math.min(Number(args?.timeout_ms) || SUBAGENT_SYNC_TIMEOUT_MS, 600_000);
  const background = args?.background === true;
  return {
    task: {
      subject: subject || objective.slice(0, 80),
      objective,
      constraints,
      context,
      reason: reason || '(未说明理由)',
      type,
      timeoutMs,
      background,
    },
    reasonProvided: !!reason,
  };
}

/** 构造 SubagentResult (带默认值, 防漏字段) */
export function makeSubagentResult(init: Partial<SubagentResult> & { status: SubagentResult['status']; summary: string }): SubagentResult {
  return {
    evidence: [],
    findings: [],
    next_suggestion: '',
    tokens_used: 0,
    durationMs: 0,
    subagentId: '',
    wentBackground: false,
    ...init,
  };
}

/**
 * 把 SubagentResult 格式化成主循环可见的 tool result 文本。
 * 主智能体"最终产出必须基于自己确认过的信息" (方案第 8 节) —
 * 所以证据原样带上, 不让它只能转述结论。
 */
export function formatSubagentResult(r: SubagentResult): string {
  const lines: string[] = [];
  lines.push(`[子智能体结果] status=${r.status}${r.wentBackground ? ' (已转后台继续, 完成会自动通知)' : ''}`);
  lines.push(`summary: ${r.summary}`);
  if (r.subagentId) lines.push(`id: ${r.subagentId} (${(r.durationMs / 1000).toFixed(1)}s${r.iterations != null ? `, ${r.iterations} 轮` : ''}${r.tokens_used > 0 ? `, ${r.tokens_used} tokens` : ''})`);
  if (r.evidence.length > 0) {
    lines.push('evidence:');
    for (const e of r.evidence.slice(0, 8)) lines.push(`  - ${String(e).slice(0, 300)}`);
  }
  if (r.next_suggestion) lines.push(`next_suggestion: ${r.next_suggestion}`);
  if (r.status === 'timeout') {
    lines.push('提示: 该子任务已转后台继续跑 (未杀), 完成后前端会自动唤醒你整合; 你也可以先基于已有信息推进。');
  }
  if (r.status === 'failed') {
    lines.push('提示: 自行决定重试/换方式/跳过, 不要卡住 (方案第 8 节结果处理纪律)。');
  }
  return lines.join('\n');
}

// ═══ 简单任务短路 (方案 9.1: 简单任务不让子智能体工具出现在列表里) ═══

/**
 * 判据 (保守优先, 防误伤):
 *   · 消息短 (< 40 字符) — 复杂任务描述必然长
 *   · 不含"并行/批量/多个"类信号词 — 有并行诉求就不是简单任务
 *   · 不含授权/渗透/安全类关键词 — 那类任务有另一套闸门 (bounty 硬禁),
 *     不要在这里互相干扰
 * 命中 → 本次请求的 tool 列表里剔除 spawn_subagent (模型想调也调不了)。
 */
export function shouldShortCircuitSubagent(message: string): boolean {
  const msg = String(message || '').trim();
  if (!msg) return false;
  if (msg.length >= 40) return false;
  if (/并行|同时|分别|各自|批量|多个|所有|全部|一起|挨个|逐个|扫描|扫一下|扫端口|枚举|侦察|渗透|授权|靶场|漏洞|赏金|挖洞|审计|审查一批/i.test(msg)) return false;
  return true;
}

// ═══ 调用预算 (方案 9.2: 每会话默认 3 次, 超了工具从列表移除) ═══

/** sessionId → { count, ts }; 带 TTL 防内存泄漏 (会话早没了还留着计数) */
const _spawnBudget = new Map<string, { count: number; ts: number }>();
const BUDGET_TTL_MS = 6 * 60 * 60 * 1000;
export const SPAWN_BUDGET_PER_SESSION = 3;

export function spawnBudgetState(sessionId: string): { used: number; limit: number; exhausted: boolean } {
  const rec = _spawnBudget.get(sessionId);
  const used = rec?.count ?? 0;
  return { used, limit: SPAWN_BUDGET_PER_SESSION, exhausted: used >= SPAWN_BUDGET_PER_SESSION };
}

export function recordSpawn(sessionId: string): void {
  const rec = _spawnBudget.get(sessionId);
  const now = Date.now();
  if (rec) { rec.count++; rec.ts = now; }
  else _spawnBudget.set(sessionId, { count: 1, ts: now });
  // TTL 清理 (只清过期记录, 不碰活跃会话)
  if (_spawnBudget.size > 50) {
    for (const [k, v] of _spawnBudget) {
      if (now - v.ts > BUDGET_TTL_MS) _spawnBudget.delete(k);
    }
  }
}

/** 测试专用: 清空预算 (防用例间串味) */
export function resetSpawnBudgetForTest(): void {
  _spawnBudget.clear();
}

// ═══ 模型级熔断器 (2026-10-21, 富哥: "模型能力不行就不给它") ═══
// 系统监督的本体: 某个模型的子智能体委托长期失败/超时/不看规则乱派 →
// 自动摘除它的 spawn_subagent (模型想调也调不了), 逼它自行完成 —
// 治"任务动不动就中断" (笨模型派了跑不动, 主循环被拖死)。
//
// 仿熔断器三态:
//   closed    正常 — 工具在列表里
//   open      摘工具 — TTL (CIRCUIT_TTL_MS) 内不给派
//   half-open TTL 到 → 放 1 次试跑: 结局好 → closed 清零; 又坏 → 重新 open
// 防误伤: 样本 < CIRCUIT_MIN_SAMPLES 不判 (偶然失败不熔);
//   免费档降级不计 (产品限制非模型问题, 由调用方选择不记)。
// 进程级 Map — 网关重启 = 全部重新学习 (重启本身是强恢复信号, 可接受)。

const _modelHealth = new Map<string, {
  total: number;      // 已完结 spawn 数 (success/partial/failed/timeout)
  bad: number;        // 坏结局数 (failed+timeout+gated)
  noReason: number;   // 未提供 reason 数 (不理解 a/b/c 的信号)
  tripped: boolean;   // 熔断中
  trippedAt: number;  // 本次熔断时刻 (半开 TTL 判据)
  halfOpen: boolean;  // 半开试跑中 (此状态下 1 次坏结局即重新熔断)
  ts: number;         // 最近一次记录时刻 (TTL 清理判据)
}>();
const _HEALTH_TTL_MS = 6 * 60 * 60 * 1000;   // 记录老化 (同预算 TTL)
export const CIRCUIT_TTL_MS = 30 * 60 * 1000;    // 熔断 30 分钟后半开
export const CIRCUIT_MIN_SAMPLES = 3;            // 最少样本数 (防偶然误伤)
export const CIRCUIT_BAD_RATE = 0.6;             // 坏结局率阈值
export const CIRCUIT_NO_REASON_RATE = 0.6;       // 无理由率阈值 (乱委托信号)

export type SpawnOutcome = 'success' | 'partial' | 'failed' | 'timeout' | 'gated' | 'noReason';

/** 记一次子智能体结局 (模型维度)。noReason 与结局正交, 分别计数。 */
export function recordSpawnOutcome(model: string, outcome: SpawnOutcome): void {
  const key = String(model || 'unknown');
  const now = Date.now();
  let h = _modelHealth.get(key);
  if (!h) {
    h = { total: 0, bad: 0, noReason: 0, tripped: false, trippedAt: 0, halfOpen: false, ts: 0 };
    _modelHealth.set(key, h);
  }
  h.ts = now;
  // 半开试跑判决优先: 1 次坏 (含 noReason) → 重新 open; 1 次好 → closed 清零
  if (h.halfOpen) {
    const bad = outcome === 'failed' || outcome === 'timeout' || outcome === 'gated' || outcome === 'noReason';
    if (bad) {
      h.tripped = true; h.trippedAt = now; h.halfOpen = false;
    } else {
      h.tripped = false; h.halfOpen = false; h.total = 1; h.bad = 0; h.noReason = 0;
    }
    return;
  }
  // noReason 也进 total (它是"模型派了"的样本证据), 但不算坏结局 —
  //   乱委托是独立信号, 由 noReasonRate 单独判 (否则纯无理由调用永远攒不够样本)
  if (outcome === 'noReason') {
    h.noReason++; h.total++;
  } else {
    h.total++;
    if (outcome === 'failed' || outcome === 'timeout' || outcome === 'gated') h.bad++;
  }
  if (h.total > 50) { // 长会话滚动窗口: 只留最近 50 次的统计基底
    h.total = 50; h.bad = Math.min(h.bad, 50); h.noReason = Math.min(h.noReason, 50);
  }
  if (!h.tripped) {
    const badRate = h.bad / h.total;
    const noReasonRate = h.noReason / Math.max(1, h.total);
    if (h.total >= CIRCUIT_MIN_SAMPLES && (badRate >= CIRCUIT_BAD_RATE || noReasonRate >= CIRCUIT_NO_REASON_RATE)) {
      h.tripped = true; h.trippedAt = now; h.halfOpen = false;
    }
  }
  // TTL 清理 (只清过期记录, 不碰活跃模型)
  if (_modelHealth.size > 50) {
    for (const [k, v] of _modelHealth) {
      if (now - v.ts > _HEALTH_TTL_MS) _modelHealth.delete(k);
    }
  }
}

export function modelSubagentHealth(model: string): {
  total: number; bad: number; noReason: number;
  badRate: number; tripped: boolean; halfOpen: boolean; remainingMs: number;
} {
  const h = _modelHealth.get(String(model || 'unknown'));
  if (!h) return { total: 0, bad: 0, noReason: 0, badRate: 0, tripped: false, halfOpen: false, remainingMs: 0 };
  const remainingMs = h.tripped ? Math.max(0, CIRCUIT_TTL_MS - (Date.now() - h.trippedAt)) : 0;
  return {
    total: h.total, bad: h.bad, noReason: h.noReason,
    badRate: h.total > 0 ? h.bad / h.total : 0,
    tripped: h.tripped, halfOpen: h.halfOpen, remainingMs,
  };
}

/**
 * 是否该摘除该模型的 spawn_subagent (工具列表构造前调用)。
 * half-open 转换在这里做 (读时判决): tripped 且 TTL 到 → 放行 1 次试跑。
 * 返回 true = 摘工具; 调用方应同时把原因写进日志 (模型看不到工具, 人看得到)。
 */
export function shouldStripSubagentForModel(model: string): boolean {
  const h = _modelHealth.get(String(model || 'unknown'));
  if (!h || !h.tripped) return false;
  if (Date.now() - h.trippedAt >= CIRCUIT_TTL_MS) {
    // TTL 到 → 半开: 放 1 次试跑 (total 归零, 下次结局重新累计; tripped 清掉,
    //   否则 handler 双保险 (modelSubagentHealth.tripped) 会误拒这次试跑)
    h.halfOpen = true;
    h.tripped = false;
    h.total = 0; h.bad = 0; h.noReason = 0;
    return false;
  }
  return true;
}

/** 测试专用: 清空熔断状态 */
export function resetModelCircuitForTest(): void {
  _modelHealth.clear();
}
