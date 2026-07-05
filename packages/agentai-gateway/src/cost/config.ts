/**
 * 成本控制配置
 * ALTES | 岐黄 - 第九章成本控制规范
 *
 * 基于规范 9.3 各组件成本预算
 */

import { CostBudget, ModelTier } from './types.js';

/**
 * 默认成本预算
 * 符合规范 9.3 要求
 */
export const DEFAULT_COST_BUDGET: CostBudget = {
  phaseLimits: {
    // 望 - 规则匹配 (0 token) + 轻量分类 (10 token)
    wang: 10,
    
    // 闻 - 缺口分析 (100 token)
    wen: 100,
    
    // 问 - 问题生成 (300 token/轮，最多3轮)
    ask: 900, // 300 * 3
    
    // 切 - 分层诊断
    // 50%简单(50) + 30%中等(300) + 15%复杂(1000) + 5%疑难(5000)
    // 加权平均: 0.5*50 + 0.3*300 + 0.15*1000 + 0.05*5000 = 25+90+150+250 = 515
    qie: 1000, // 上限1000，实际期望500左右
    
    // 治 - 治疗执行
    treatment: 2000,
    
    // 执行
    execution: 3000,
    
    // 调方
    tiaofang: 100,
  },
  
  // 单任务总预算
  // 规范要求：框架额外开销控制在10-20%
  // 核心任务预算约 2000-3000 token，总预算 2500-4000
  taskTotalLimit: 4000,
  
  // 日预算 (每用户)
  dailyLimit: 50000, // 约 50k token/天
  
  // 框架开销上限 20%
  maxFrameworkOverhead: 20,
};

/**
 * 模型等级配置
 * 基于规范 9.3 模型等级要求
 */
export const MODEL_TIER_CONFIG: Record<ModelTier, {
  maxTokens: number;
  providers: string[];
  priority: number;
}> = {
  rule_based: {
    maxTokens: 0,
    providers: ['rule'],
    priority: 1,
  },
  free_lightweight: {
    maxTokens: 500,
    providers: ['agentai', 'zhipu'],
    priority: 2,
  },
  free: {
    maxTokens: 2000,
    providers: ['agentai', 'zhipu', 'deepseek'],
    priority: 3,
  },
  medium: {
    maxTokens: 4000,
    providers: ['deepseek', 'openai'],
    priority: 4,
  },
  strong: {
    maxTokens: 8000,
    providers: ['openai', 'deepseek'],
    priority: 5,
  },
};

/**
 * 成本评级阈值
 */
export const COST_RATING_THRESHOLDS = {
  free: 0,
  low: 500,
  medium: 2000,
  high: 5000,
  critical: 10000,
};

/**
 * 降级策略配置
 * 基于规范 9.5 降级策略
 */
export const DEGRADATION_STRATEGY = {
  // 双引擎减少并行路数（3→2→1）
  creativeEngine: {
    normal: { k: 3 },
    degraded: { k: 2 },
    minimal: { k: 1 },
  },
  
  // 辩论室减少辩论轮数（3→2→1）
  debateRoom: {
    normal: { rounds: 3 },
    degraded: { rounds: 2 },
    minimal: { rounds: 1 },
  },
  
  // 问阶段减少最大轮数（3→2→1）
  askPhase: {
    normal: { maxRounds: 3 },
    degraded: { maxRounds: 2 },
    minimal: { maxRounds: 1 },
  },
  
  // 诊断等级降级（complex→medium→simple模板）
  diagnosisLevel: {
    normal: ['complex', 'medium', 'simple'],
    degraded: ['medium', 'simple'],
    minimal: ['simple'],
  },
};

/**
 * 获取当前预算配置
 * 支持环境变量覆盖
 */
export function getCostBudget(): CostBudget {
  return {
    phaseLimits: {
      wang: parseInt(process.env.COST_BUDGET_WANG || '') || DEFAULT_COST_BUDGET.phaseLimits.wang,
      wen: parseInt(process.env.COST_BUDGET_WEN || '') || DEFAULT_COST_BUDGET.phaseLimits.wen,
      ask: parseInt(process.env.COST_BUDGET_ASK || '') || DEFAULT_COST_BUDGET.phaseLimits.ask,
      qie: parseInt(process.env.COST_BUDGET_QIE || '') || DEFAULT_COST_BUDGET.phaseLimits.qie,
      treatment: parseInt(process.env.COST_BUDGET_TREATMENT || '') || DEFAULT_COST_BUDGET.phaseLimits.treatment,
      execution: parseInt(process.env.COST_BUDGET_EXECUTION || '') || DEFAULT_COST_BUDGET.phaseLimits.execution,
      tiaofang: parseInt(process.env.COST_BUDGET_TIAOFANG || '') || DEFAULT_COST_BUDGET.phaseLimits.tiaofang,
    },
    taskTotalLimit: parseInt(process.env.COST_BUDGET_TASK_TOTAL || '') || DEFAULT_COST_BUDGET.taskTotalLimit,
    dailyLimit: parseInt(process.env.COST_BUDGET_DAILY || '') || DEFAULT_COST_BUDGET.dailyLimit,
    maxFrameworkOverhead: parseInt(process.env.COST_BUDGET_MAX_OVERHEAD || '') || DEFAULT_COST_BUDGET.maxFrameworkOverhead,
  };
}

/**
 * 检查是否在预算内
 */
export function isWithinBudget(current: number, budget: number, warningThreshold = 0.8): {
  ok: boolean;
  warning: boolean;
  remaining: number;
} {
  const remaining = budget - current;
  const warning = current >= budget * warningThreshold;
  const ok = current < budget;
  
  return { ok, warning, remaining };
}
