/**
 * model-switch-policy.ts — 模型轮换策略 (2026-10-21 简化)
 * ============================================================================
 * 用户定调: "模型轮换这个机制现在感觉不太重要了"。
 * 现状问题是四层机制叠加 (主动推荐 / 故障切换 / router 跨 provider 替换 /
 * 能力矩阵动态 tier), 长任务里中途换模型会改变工具调用风格与上下文理解,
 * 比"等 30 秒重试"更容易把任务搞坏。
 *
 * 简化原则:
 *   1) 主动推荐默认关闭 (只保留 UI 提示入口, 不再往对话注入系统消息)。
 *   2) 故障切换默认只对非安全任务生效; security/长任务一律"保存断点 + 询问用户",
 *      不自动换模型。
 *   3) 用户显式选定的模型仍由 modelLocked 保护 (不变)。
 *
 * 环境变量:
 *   AGENTAI_AUTO_MODEL_SWITCH=off|on-failure|always  (默认 on-failure)
 *   AGENTAI_MODEL_RECOMMEND=1|0                     (默认 0, 关闭主动推荐注入)
 */

export type AutoSwitchMode = 'off' | 'on-failure' | 'always';

export function resolveAutoSwitchMode(raw?: string): AutoSwitchMode {
  const v = String(raw ?? process.env.AGENTAI_AUTO_MODEL_SWITCH ?? 'on-failure').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'never') return 'off';
  if (v === 'always' || v === '1' || v === 'true') return 'always';
  return 'on-failure';
}

/**
 * 是否允许在故障时自动切换模型。
 * on-failure 模式下, security 任务不自动切换 —— 长任务中途换模型风险高于收益。
 */
export function shouldAutoSwitchModels(taskType: string, mode: AutoSwitchMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return String(taskType || 'general') !== 'security';
}

/** 是否允许把"建议换强模型"注入对话 (默认关闭, 只在 UI 展示提示) */
export function shouldInjectModelRecommendation(raw?: string): boolean {
  return /^(1|true|on|yes)$/i.test(String(raw ?? process.env.AGENTAI_MODEL_RECOMMEND ?? '0').trim());
}
