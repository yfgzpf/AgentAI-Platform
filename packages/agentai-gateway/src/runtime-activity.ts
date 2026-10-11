/**
 * RuntimeActivity — 「用户任务是否正在跑」的进程级心跳标记
 * ------------------------------------------------------------
 * 用途: 自动化引擎 (automation-engine.ts 的 cron:tick) 在用户任务进行时应当让路。
 * 用户 2026-10-11 反馈:「自动化任务会影响任务进程, 导致任务老是卡住 不流畅」——
 * cron 任务与用户任务共用同一个 gateway 进程 + 同一个 workspace, 同时跑会互相抢
 * 工具/文件/子进程, 表现为用户任务卡顿。
 *
 * ⚠️ 为什么用 TTL 心跳, 不用「计数器」(enter/exit 配对):
 *   agentai-loop.run() 内有 15+ 个 return 出口 (含 throw / 用户中断 / 超时)。
 *   计数器只要漏一次 --, 自动化就**永久停摆**且无人发现 —— 典型泄漏。
 *   TTL 心跳没有这个风险: 任务还在推进就持续续期; 任务结束 (无论怎么结束) 后
 *   最多 USER_TASK_TTL_MS 自动失效, 不需要任何清理代码。
 *
 * ⚠️ TTL 必须 > 单次 LLM 调用的最长耗时, 否则「模型正在长时间思考」会被误判成空闲。
 *   正常路径 fetch 超时是 300s (llm-router.ts FLAKY_TIMEOUT_MS 之外的默认值),
 *   故取 5 分钟。代价: 用户任务结束后最长 5 分钟内自动化仍让路 —— 这是可接受的,
 *   因为 cron 表达式粒度本就是分钟级。
 */

/** 用户任务心跳有效期 (ms)。见文件头注释, 必须覆盖单次 LLM 调用的 300s 上限。 */
export const USER_TASK_TTL_MS = 300_000;

let _lastUserTaskAt = 0;

/**
 * 标记「用户任务正在进行」。
 * 调用点: agentai-loop.run() 入口 + 每轮迭代开始 (iteration 边界)。
 */
export function touchUserTask(): void {
  _lastUserTaskAt = Date.now();
}

/**
 * 是否正处于用户任务中 (最近 USER_TASK_TTL_MS 内收到过心跳)。
 * 调用点: automation-engine.ts cron:tick 处理器顶部。
 */
export function isUserTaskActive(): boolean {
  return _lastUserTaskAt > 0 && Date.now() - _lastUserTaskAt < USER_TASK_TTL_MS;
}

/** 距上次用户任务心跳的毫秒数 (未有过心跳时返回 Infinity)。用于日志/诊断。 */
export function msSinceUserTask(): number {
  return _lastUserTaskAt > 0 ? Date.now() - _lastUserTaskAt : Infinity;
}

/** 测试辅助: 复位心跳 (仅供测试, 生产代码不要调用)。 */
export function _resetRuntimeActivity(): void {
  _lastUserTaskAt = 0;
}
