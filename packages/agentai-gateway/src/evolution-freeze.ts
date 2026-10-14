/**
 * evolution-freeze.ts — 自进化写入冻结开关 (2026-10-14 P2)
 * =========================================================
 * RSIAgent "冻结快照" 理念: 测试/评测期记忆应**冻结**, 不再更新, 确保
 * 结果可复现。本模块实现进程级开关:
 *
 *   - 冻结期: 5 个自进化写入口全部被拦截
 *       1. evolve_prompt add/remove (tools.ts)
 *       2. create_tool (tools.ts)
 *       3. record_failure (tools.ts)
 *       4. 主循环 dup_fail 自动写 (agentai-loop.ts:4557)
 *       5. 子智能体结果回写 (agentai-loop.ts:5876 / 5928)
 *
 *   - 读操作**不受影响** (list / readEvolution / 召回)
 *   - 显式用户记忆**不受影响** (remember / remember_this)
 *
 * 触发入口:
 *   ① 环境变量 AGENTAI_EVOLUTION_FROZEN=1 (启动即读, 不热改) — CI/容器
 *   ② HTTP POST /v1/evolution/freeze { frozen: true|false } — 手动
 *   ③ 工具 set_evolution_frozen({ frozen }) — AI 自己知道要"跑评测"时开
 *
 * 设计要点:
 *   - 进程级 (非 workspace 级): 一次开关所有 workspace 生效, "跑评测"语义
 *   - 拦截带日志: 被拦时 console.warn 带 source, 便于排查"为什么没记上"
 *   - 不阻塞读: 评测时可看现有规则, 只是不能新写 → 可复现
 */

/** 进程级冻结标志 (启动时读环境变量, 可被 setEvolutionFrozen 热改) */
let _frozen: boolean = process.env['AGENTAI_EVOLUTION_FROZEN'] === '1';

/** 当前是否处于冻结期 */
export function isEvolutionFrozen(): boolean {
  return _frozen;
}

/** 设/取消冻结 (幂等, 状态不变时不打日志) */
export function setEvolutionFrozen(v: boolean): void {
  if (_frozen === v) return;
  _frozen = v;
  console.warn(
    `[evolution-freeze] ${v ? '进入' : '解除'}冻结 ` +
    `(后续自进化写入被拦截, 读操作不受影响; ` +
    `来源: ${v ? 'setEvolutionFrozen(true)' : 'setEvolutionFrozen(false)'})`,
  );
}

/**
 * 冻结期拦截自进化写入。
 * @param fn 实际要执行的写入 (由调用方 inline 传, 便于 require 侧统一处理)
 * @param source 写入口名 (日志诊断用, 如 'evolve_prompt:add' / 'dup_fail')
 * @returns 是否真正执行了 fn (冻结期返回 false)
 *
 * 用法 (handler 入口, 伪代码):
 *   if (!requireEvolution(() => { 写盘逻辑 }, 'evolve_prompt:add')) {
 *     return { success: false, output: 'evolution 冻结中, 写入被拦截' };
 *   }
 */
export function requireEvolution(fn: () => void, source: string): boolean {
  if (!isEvolutionFrozen()) {
    fn();
    return true;
  }
  console.warn(`[evolution-freeze] 拦截 ${source} 写入 (冻结中, 如需临时解冻调 set_evolution_frozen 或 POST /v1/evolution/freeze {frozen:false})`);
  return false;
}
