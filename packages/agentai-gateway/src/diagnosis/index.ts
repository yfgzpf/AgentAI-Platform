/**
 * ALTES | 岐黄 诊断优先模块入口
 *
 * 导出所有诊断相关功能
 */

// 类型
export * from '../types/diagnosis.js';

// 诊断流程
export { perceiveTask } from './task-perception.js';
export { diagnoseTask } from './diagnosis-engine.js';
export { assemblePlan, adjustPlan } from './plan-assembler.js';
export { verifyStep } from './step-verifier.js';
export { executePlan, quickExecute } from './plan-executor.js';

// 辅助
export { analyzeGaps, generateClarificationQuestions, assessGapImpact } from './gap-analyzer.js';
export {
  COMPLEXITY_WEIGHTS,
  TREATMENT_APPROACH_MATRIX,
  DEFAULT_DIAGNOSIS_CONFIG,
  DIAGNOSIS_SSE_EVENTS,
} from './constants.js';
