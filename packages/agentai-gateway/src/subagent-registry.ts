/**
 * subagent-registry — 网关级子智能体任务注册表
 * ----------------------------------------------------------------
 * 2026-10-21 新增。
 *
 * 为什么需要它 (与 subagent-artifacts 的分工):
 *   · artifacts  负责「成果落盘」(持久, 跨进程)
 *   · registry  负责「谁还活着」(内存, 跨 loop 实例)
 *
 * 核心问题:
 *   子智能体是父 loop 的 detached 任务, 父 loop 死后它仍在跑。
 *   父 loop 的 `activeLoops` 在请求结束时被 delete → 内存里再没人知道
 *   「还有几个子任务在跑、跑完了没有」→ 既没法唤醒, 也没法提示用户。
 *
 * 定位:
 *   把子智能体提升为**网关级独立任务单元**。注册表在网关进程内长期存活,
 *   不随某个 HTTP 请求/loop 实例销毁。
 *
 * 用途:
 *   ① 前端轮询「我这个会话还有几个子任务在跑」→ 决定要不要等唤醒
 *   ② 全部子任务完成 → 触发唤醒续跑 (见 chat.ts 的 _resumeFrom)
 *   ③ 产物落盘的元数据来源 (parentSessionId 等)
 */

/** 注册表条目 */
export interface SubagentRecord {
  /** 子智能体 ID */
  id: string;
  /** 类型 (research / pentest_recon / explore ...) */
  type: string;
  /** 任务描述 */
  task: string;
  /** 父会话 ID (唤醒续跑时用来定位会话) */
  parentSessionId: string;
  /** 工作区 */
  workspace: string;
  /** running | done | error */
  status: 'running' | 'done' | 'error';
  /** 最终结果 (done) */
  result?: string;
  /** 错误信息 (error) */
  error?: string;
  startedAt: number;
  finishedAt?: number;
  /** 迭代轮数 */
  iterations?: number;
  /** 耗时 (ms) */
  durationMs?: number;
}

/**
 * 进程内注册表。
 * 用 globalThis 挂载 —— 开发模式 tsx 直跑 + 热重载会重复加载模块,
 * 用模块级 Map 会导致每次重载丢失注册信息 (进而唤醒失效)。
 */
const G_KEY = '__agentai_subagent_registry__';
function store(): Map<string, SubagentRecord> {
  const g = globalThis as any;
  if (!g[G_KEY]) g[G_KEY] = new Map<string, SubagentRecord>();
  return g[G_KEY];
}

/** 注册一个子智能体 (启动时调用) */
export function registerSubagent(rec: Partial<SubagentRecord> & { id: string }): void {
  const now = Date.now();
  store().set(rec.id, {
    ...rec,
    type: rec.type || 'unknown',
    task: rec.task || '',
    parentSessionId: rec.parentSessionId || '',
    workspace: rec.workspace || '',
    status: 'running',
    startedAt: rec.startedAt || now,
  } as SubagentRecord);
}

/** 更新状态 (完成/失败时调用) */
export function completeSubagent(
  id: string,
  status: 'done' | 'error',
  payload: { result?: string; error?: string; iterations?: number; durationMs?: number } = {},
): void {
  const m = store();
  const cur = m.get(id);
  if (!cur) return;
  m.set(id, {
    ...cur,
    ...payload,
    status,
    finishedAt: Date.now(),
  });
}

/** 取单个 */
export function getSubagent(id: string): SubagentRecord | undefined {
  return store().get(id);
}

/** 列出全部 */
export function listSubagents(): SubagentRecord[] {
  return [...store().values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** 某父会话下仍在运行的子智能体 */
export function runningForSession(parentSessionId: string): SubagentRecord[] {
  return listSubagents().filter(r => r.parentSessionId === parentSessionId && r.status === 'running');
}

/**
 * 某父会话下**全部**子智能体是否都已结束。
 * 唤醒策略: 等所有子任务都完成再一次性唤醒 (避免 N 个子代理引发 N 次续跑)。
 *
 * ⚠️ 空集合语义 (2026-10-21 修正): 没有注册过任何子任务的会话 → **true** (无事可等)。
 *   早先写成 `list.length > 0 && ...` → 空会话恒为 false, 前端会永远停在"等待唤醒"态
 *   (它拿不到任何子任务, 却因为 allFinished=false 一直等) —— 死等。
 *   前端另有 `hasSubagents` 字段区分"从没派过子任务"与"派过且都跑完了"。
 */
export function allFinishedForSession(parentSessionId: string): boolean {
  const list = listSubagents().filter(r => r.parentSessionId === parentSessionId);
  return list.every(r => r.status !== 'running');
}

/** 该父会话下已完成的子任务结果 (供唤醒时构造续跑输入) */
export function finishedResultsForSession(parentSessionId: string): SubagentRecord[] {
  return listSubagents().filter(r => r.parentSessionId === parentSessionId && r.status !== 'running');
}

/** 清理某会话的历史注册 (可选, 避免注册表无限增长) */
export function pruneSession(parentSessionId: string, keep = 50): void {
  const m = store();
  const list = [...m.values()]
    .filter(r => r.parentSessionId === parentSessionId)
    .sort((a, b) => a.startedAt - b.startedAt);
  const excess = list.length - keep;
  for (let i = 0; i < excess; i++) m.delete(list[i].id);
}
