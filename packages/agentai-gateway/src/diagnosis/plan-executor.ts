/**
 * 计划执行器 — 已废弃 (DEPRECATED)
 * ====================================================================
 * 此模块于 2026-07-13 标记为废弃。
 *
 * 原因：从未被任何文件调用（孤儿代码）。完整的计划执行功能由
 *       `master-controller.ts` 的 `MasterController.executePlan()` 方法提供。
 *
 * 迁移路径：
 *   - 如需执行治疗计划，使用 `MasterController.executePlan(plan, model, context)`
 *   - 真正的诊断流程在 `routes/chat.ts` 第 309 行（PulseFlow Xuanji 集成）
 *
 * 为保持向后兼容（防止意外的 import 错误），接口保留但所有函数返回空结果。
 *
 * 备份：`.agentai/backups/plan-executor.ts.bak.20260713`
 *
 * @deprecated 2026-07-13
 */

import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import {
  TreatmentPlan,
  StepVerificationResult,
  DiagnosisContext,
} from '../types/diagnosis.js';

// 保留接口以避免破坏意外引用
export interface PlanExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  finalOutput: any;
  verificationResults: StepVerificationResult[];
}

export interface StepExecutionResult {
  stepOrder: number;
  success: boolean;
  output: any;
  verification: StepVerificationResult;
  error?: string;
}

function warnDeprecated(fnName: string): void {
  console.warn(
    `[plan-executor] DEPRECATED: ${fnName}() 已废弃，请使用 MasterController.executePlan()` +
    `\n  备份位置: .agentai/backups/plan-executor.ts.bak.20260713`
  );
}

/**
 * @deprecated 请使用 MasterController.executePlan()
 */
export async function executePlan(
  _plan: TreatmentPlan,
  _router: AgentAIRouter,
  _registry: ToolRegistry,
  _context?: DiagnosisContext
): Promise<PlanExecutionResult> {
  warnDeprecated('executePlan');
  return {
    success: false,
    completedSteps: 0,
    totalSteps: 0,
    finalOutput: null,
    verificationResults: [],
  };
}

/**
 * @deprecated 请使用 MasterController.executePlan()
 */
export async function quickExecute(
  _plan: TreatmentPlan,
  _router: AgentAIRouter,
  _registry: ToolRegistry
): Promise<PlanExecutionResult> {
  warnDeprecated('quickExecute');
  return {
    success: false,
    completedSteps: 0,
    totalSteps: 0,
    finalOutput: null,
    verificationResults: [],
  };
}
