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
