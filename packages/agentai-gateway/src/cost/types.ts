/**
 * 成本控制类型定义
 * 岐枢 | PulseFlow - 第九章成本控制规范
 */

/**
 * 成本等级
 */
export type CostRating = 'free' | 'low' | 'medium' | 'high' | 'critical';

/**
 * 诊断阶段
 */
export type DiagnosisPhase = 'wang' | 'wen' | 'ask' | 'qie' | 'treatment' | 'execution' | 'tiaofang';

/**
 * 模型等级
 */
export type ModelTier = 'rule_based' | 'free_lightweight' | 'free' | 'medium' | 'strong';

/**
 * 阶段成本记录
 */
export interface PhaseCost {
  /** 阶段名称 */
  phase: DiagnosisPhase | string;
  /** token消耗 */
  tokens: number;
  /** 使用的模型 */
  model: string;
  /** 模型等级 */
  modelTier: ModelTier;
  /** 调用次数 */
  calls: number;
  /** 额外信息 */
  details?: Record<string, any>;
}

/**
 * 任务成本摘要
 */
export interface TaskCostSummary {
  /** 任务ID */
  taskId: string;
  /** 总会话ID */
  sessionId: string;
  /** 用户ID */
  userId: string;
  /** 总token消耗 */
  totalTokens: number;
  /** 各阶段明细 */
  breakdown: Record<string, PhaseCost>;
  /** 框架额外开销百分比 */
  frameworkOverheadPercentage: number;
  /** 成本评级 */
  costRating: CostRating;
  /** 任务类型 */
  taskType: string;
  /** 复杂度 */
  complexity: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
  /** 执行时长(ms) */
  duration: number;
}

/**
 * 成本预算配置
 */
export interface CostBudget {
  /** 阶段预算限制 */
  phaseLimits: Record<DiagnosisPhase, number>;
  /** 单任务总预算 */
  taskTotalLimit: number;
  /** 日预算 */
  dailyLimit: number;
  /** 框架开销上限 */
  maxFrameworkOverhead: number;
}

/**
 * 成本告警
 */
export interface CostAlert {
  /** 告警ID */
  id: string;
  /** 告警类型 */
  type: 'phase_exceeded' | 'task_exceeded' | 'daily_exceeded' | 'overhead_high';
  /** 严重程度 */
  severity: 'warning' | 'critical';
  /** 告警消息 */
  message: string;
  /** 当前值 */
  currentValue: number;
  /** 阈值 */
  threshold: number;
  /** 任务ID */
  taskId?: string;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 成本统计
 */
export interface CostStatistics {
  /** 统计周期 */
  period: 'hour' | 'day' | 'week';
  /** 总任务数 */
  totalTasks: number;
  /** 总token消耗 */
  totalTokens: number;
  /** 平均任务成本 */
  avgTaskCost: number;
  /** 各阶段平均成本 */
  avgPhaseCosts: Record<string, number>;
  /** 成本分布 */
  costDistribution: Record<CostRating, number>;
  /** 框架平均开销 */
  avgFrameworkOverhead: number;
}
