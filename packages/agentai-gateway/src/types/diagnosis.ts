/**
 * 诊断优先类型定义
 * ALTES | 岐黄 - 望闻问切 → 因证施治 → 调方
 *
 * @module types/diagnosis
 */

// ═══════════════════════════════════════════════════════════
// 基础类型
// ═══════════════════════════════════════════════════════════

/** 任务复杂度级别 */
export type ComplexityLevel = 'ultraSimple' | 'simple' | 'medium' | 'complex' | 'hard';

/** 任务类型 */
export type TaskType =
  | 'coding'       // 代码编写
  | 'debugging'    // 调试修复
  | 'refactoring'  // 重构优化
  | 'analysis'     // 分析诊断
  | 'writing'      // 文档写作
  | 'creative'     // 创意生成
  | 'general';     // 通用对话

/** 信息缺口类型 */
export type GapType =
  | 'missing_context'        // 缺少上下文
  | 'ambiguous_requirement'  // 需求模糊
  | 'unclear_scope'          // 范围不清
  | 'technical_unknown'      // 技术未知
  | 'missing_preference';    // 偏好未知

/** 建议行动类型 */
export type ActionType =
  | 'proceed'     // 继续执行
  | 'ask'         // 询问用户
  | 'self_fill'   // 自我补全
  | 'defer';      // 延后处理

/** 风险级别 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** 推荐治法 */
export type TreatmentApproach =
  | 'direct'        // 单刀直入 - 简单任务直接执行
  | 'planning'      // 先诊后治 - 需求模糊时先澄清
  | 'exploratory'   // 探索式 - 技术未知时先调研
  | 'multi_step';   // 分阶段 - 复杂项目拆解执行

// ═══════════════════════════════════════════════════════════
// 数据对象
// ═══════════════════════════════════════════════════════════

/**
 * 信息缺口
 * 对应"闻"——识别信息缺失点
 */
export interface InformationGap {
  /** 缺口类型 */
  type: GapType;
  /** 缺口描述 */
  description: string;
  /** 严重程度 */
  severity: 'low' | 'medium' | 'high';
  /** 建议解决方案 */
  suggestedResolution: string;
  /** 是否可自我补全 */
  canSelfFill: boolean;
}

/**
 * 任务感知报告
 * 对应"望闻问"——分析用户真实意图和信息缺口
 */
export interface TaskPerceptionReport {
  /** 任务类型 */
  taskType: TaskType;
  /** 复杂度级别 */
  complexity: ComplexityLevel;
  /** 歧义度 0-1 */
  ambiguity: number;
  /** 信息缺口列表 */
  gapList: InformationGap[];
  /** 建议行动 */
  suggestedAction: ActionType;
  /** 用户原始意图摘要 */
  intentSummary: string;
  /** 关键实体提取 */
  entities?: string[];
}

/**
 * 诊断报告
 * 对应"切"——评估置信度和风险
 */
export interface DiagnosisReport {
  /** 整体置信度 0-1 */
  confidence: number;
  /** 风险级别 */
  riskLevel: RiskLevel;
  /** 推荐治法 */
  recommendedApproach: TreatmentApproach;
  /** 预估步骤数 */
  estimatedSteps: number;
  /** 潜在阻塞点 */
  potentialBlockers: string[];
  /** 成功概率评估 */
  successProbability: number;
  /** 建议的模型类型 */
  suggestedModelType?: 'fast' | 'balanced' | 'thorough';
}

/**
 * 治疗步骤
 * 对应"治"——具体执行步骤
 */
export interface TreatmentStep {
  /** 步骤 ID */
  id: string;
  /** 步骤序号 */
  order: number;
  /** 步骤描述 */
  description: string;
  /** 预期输出 */
  expectedOutput: string;
  /** 验证方法 */
  verificationMethod: string;
  /** 回滚策略 */
  rollbackAction?: string;
  /** 预估 token 消耗 */
  estimatedTokens?: number;
  /** 是否可并行 */
  parallelizable?: boolean;
}

/**
 * 治疗计划
 * 对应"治"——完整治疗方案
 */
export interface TreatmentPlan {
  /** 计划 ID */
  id: string;
  /** 计划版本 */
  version: number;
  /** 执行步骤 */
  steps: TreatmentStep[];
  /** 验证检查点 */
  verificationPoints: string[];
  /** 回滚策略 */
  rollbackStrategy: string;
  /** 预估总 token */
  estimatedTotalTokens?: number;
  /** 预估执行时间（秒） */
  estimatedDuration?: number;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/**
 * 步骤验证结果
 * 对应"调方"——验证执行结果
 */
export interface StepVerificationResult {
  /** 是否通过 */
  passed: boolean;
  /** 验证分数 0-1 */
  score: number;
  /** 问题列表 */
  issues: string[];
  /** 改进建议 */
  suggestion?: string;
  /** 是否需要重试 */
  needsRetry: boolean;
  /** 是否需要调整方案 */
  needsPlanAdjustment: boolean;
}

/**
 * 方案调整记录
 * 对应"调方"——记录方案变更
 */
export interface PlanAdjustment {
  /** 调整时间 */
  timestamp: number;
  /** 调整原因 */
  reason: string;
  /** 原步骤 */
  originalStep?: TreatmentStep;
  /** 调整后步骤 */
  adjustedStep?: TreatmentStep;
  /** 新增步骤 */
  addedSteps?: TreatmentStep[];
  /** 删除步骤 */
  removedStepIds?: string[];
}

// ═══════════════════════════════════════════════════════════
// 上下文与配置
// ═══════════════════════════════════════════════════════════

/**
 * 诊断上下文
 */
export interface DiagnosisContext {
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 项目路径 */
  projectPath?: string;
  /** 历史对话摘要 */
  conversationSummary?: string;
  /** 用户偏好 */
  userPreferences?: Record<string, any>;
  /** 行业上下文 */
  industryContext?: string;
}

/**
 * 诊断配置
 */
export interface DiagnosisConfig {
  /** 是否启用任务感知 */
  enableTaskPerception: boolean;
  /** 是否启用诊断报告 */
  enableDiagnosisReport: boolean;
  /** 是否启用治疗计划 */
  enableTreatmentPlan: boolean;
  /** 是否启用步骤验证 */
  enableStepVerification: boolean;
  /** 歧义阈值（超过则询问用户） */
  ambiguityThreshold: number;
  /** 置信度阈值（低于则增加验证） */
  confidenceThreshold: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 是否允许自我补全 */
  allowSelfFill: boolean;
}

// ═══════════════════════════════════════════════════════════
// 事件与状态
// ═══════════════════════════════════════════════════════════

/**
 * 诊断事件类型
 */
export type DiagnosisEventType =
  | 'task_perception_started'
  | 'task_perception_completed'
  | 'diagnosis_started'
  | 'diagnosis_completed'
  | 'treatment_plan_created'
  | 'treatment_plan_adjusted'
  | 'step_started'
  | 'step_completed'
  | 'step_verification_completed'
  | 'treatment_completed'
  | 'clarification_needed';

/**
 * 诊断事件
 */
export interface DiagnosisEvent {
  /** 事件类型 */
  type: DiagnosisEventType;
  /** 事件时间戳 */
  timestamp: number;
  /** 会话 ID */
  sessionId: string;
  /** 事件数据 */
  data: any;
}

/**
 * 完整诊断状态
 */
export interface DiagnosisState {
  /** 任务感知报告 */
  perception?: TaskPerceptionReport;
  /** 诊断报告 */
  diagnosis?: DiagnosisReport;
  /** 治疗计划 */
  plan?: TreatmentPlan;
  /** 当前步骤索引 */
  currentStepIndex: number;
  /** 验证结果历史 */
  verificationHistory: StepVerificationResult[];
  /** 方案调整历史 */
  adjustmentHistory: PlanAdjustment[];
  /** 是否完成 */
  isCompleted: boolean;
  /** 是否出错 */
  hasError: boolean;
  /** 错误信息 */
  errorMessage?: string;
}

// ═══════════════════════════════════════════════════════════
// 工具函数类型
// ═══════════════════════════════════════════════════════════

/** 任务感知函数 */
export type TaskPerceptionFunction = (
  messages: any[],
  context: DiagnosisContext,
  config: DiagnosisConfig
) => Promise<TaskPerceptionReport>;

/** 诊断函数 */
export type DiagnosisFunction = (
  perception: TaskPerceptionReport,
  context: DiagnosisContext,
  config: DiagnosisConfig
) => Promise<DiagnosisReport>;

/** 计划组装函数 */
export type PlanAssemblyFunction = (
  diagnosis: DiagnosisReport,
  perception: TaskPerceptionReport,
  context: DiagnosisContext
) => TreatmentPlan;

/** 步骤验证函数 */
export type StepVerificationFunction = (
  step: TreatmentStep,
  result: any,
  context: DiagnosisContext
) => Promise<StepVerificationResult>;

/** 方案调整函数 */
export type PlanAdjustmentFunction = (
  plan: TreatmentPlan,
  verification: StepVerificationResult,
  context: DiagnosisContext
) => Promise<TreatmentPlan>;
