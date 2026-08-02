/**
 * 诊断优先常量定义
 * 岐枢 | PulseFlow - 望闻问切 → 因证施治 → 调方
 *
 * @module diagnosis/constants
 */

import { ComplexityLevel, TreatmentApproach } from '../types/diagnosis.js';

// ═══════════════════════════════════════════════════════════
// 复杂度权重矩阵
// 对应《伤寒论》"观其脉证，知犯何逆，随证治之"
// ═══════════════════════════════════════════════════════════

/**
 * 复杂度级别顺序
 */
export const COMPLEXITY_ORDER: ComplexityLevel[] = [
  'ultraSimple',
  'simple',
  'medium',
  'complex',
  'hard',
];

/**
 * 复杂度权重矩阵
 * 用于计算任务与模型的匹配度
 */
export const COMPLEXITY_WEIGHTS: Record<ComplexityLevel, number[]> = {
  ultraSimple: [1.0, 0.8, 0.4, 0.2, 0.0],  // 超简单任务偏好简单模型
  simple: [0.8, 1.0, 0.8, 0.4, 0.2],       // 简单任务
  medium: [0.4, 0.8, 1.0, 0.8, 0.4],       // 中等任务
  complex: [0.2, 0.4, 0.8, 1.0, 0.8],      // 复杂任务偏好复杂模型
  hard: [0.0, 0.2, 0.4, 0.8, 1.0],         // 困难任务必须用强模型
};

// ═══════════════════════════════════════════════════════════
// 治法映射
// 对应中医"因证施治"——不同症状用不同治法
// ═══════════════════════════════════════════════════════════

/**
 * 治法选择矩阵
 * 根据复杂度和歧义度选择治法
 */
export const TREATMENT_APPROACH_MATRIX: Record<
  ComplexityLevel,
  Record<'low' | 'high', TreatmentApproach>
> = {
  // 超简单任务：无论歧义高低都直接执行
  ultraSimple: { low: 'direct', high: 'direct' },
  // 简单任务：歧义低直接执行，歧义高先规划
  simple: { low: 'direct', high: 'planning' },
  // 中等任务：歧义低规划，歧义高探索
  medium: { low: 'planning', high: 'exploratory' },
  // 复杂任务：歧义低分阶段，歧义高探索+分阶段
  complex: { low: 'multi_step', high: 'exploratory' },
  // 困难任务：必须分阶段执行
  hard: { low: 'multi_step', high: 'multi_step' },
};

/**
 * 治法说明
 */
export const TREATMENT_APPROACH_DESCRIPTION: Record<TreatmentApproach, string> = {
  direct: '单刀直入——简单任务直接执行',
  planning: '先诊后治——需求模糊时先澄清再执行',
  exploratory: '探索式——技术未知时先调研再实施',
  multi_step: '分阶段调理——复杂项目拆解为多个步骤',
};

// ═══════════════════════════════════════════════════════════
// 阈值配置
// ═══════════════════════════════════════════════════════════

/**
 * 默认诊断配置
 */
export const DEFAULT_DIAGNOSIS_CONFIG = {
  // 歧义阈值：超过此值需要询问用户
  ambiguityThreshold: 0.6,
  // 置信度阈值：低于此值增加验证
  confidenceThreshold: 0.7,
  // 风险阈值：超过此值需要额外确认
  riskThreshold: 0.7,
  // 最大重试次数
  maxRetries: 3,
  // 最大步骤数
  maxSteps: 20,
  // 是否允许自我补全
  allowSelfFill: true,
};

/**
 * 复杂度判定阈值
 * 基于消息长度和关键词密度
 */
export const COMPLEXITY_THRESHOLDS = {
  ultraSimple: { maxLength: 50, maxKeywords: 2 },
  simple: { maxLength: 200, maxKeywords: 5 },
  medium: { maxLength: 1000, maxKeywords: 10 },
  complex: { maxLength: 5000, maxKeywords: 20 },
  // hard 超过以上阈值
};

// ═══════════════════════════════════════════════════════════
// 关键词库
// ═══════════════════════════════════════════════════════════

/**
 * 任务类型关键词
 */
export const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  coding: ['写代码', '实现', '编写', '开发', 'create', 'implement', 'write code', 'function', 'class'],
  debugging: ['调试', '修复', 'bug', '错误', 'debug', 'fix', 'repair', 'error', 'issue'],
  refactoring: ['重构', '优化', '改写', 'refactor', 'optimize', 'rewrite', 'improve'],
  analysis: ['分析', '诊断', '评估', 'analyze', 'diagnose', 'evaluate', 'review'],
  writing: ['文档', '写作', '说明', 'document', 'write', 'readme', 'comment'],
  creative: ['创意', '设计', '生成', 'creative', 'design', 'generate', 'idea'],
};

/**
 * 复杂度关键词
 */
export const COMPLEXITY_KEYWORDS: Record<ComplexityLevel, string[]> = {
  ultraSimple: ['你好', 'hi', 'hello', '谢谢', '再见'],
  simple: ['简单', '快速', '一下', 'simple', 'quick', 'easy'],
  medium: ['实现', '功能', '模块', 'implement', 'feature', 'module'],
  complex: ['系统', '架构', '设计模式', 'system', 'architecture', 'pattern'],
  hard: ['分布式', '微服务', '高并发', '性能优化', 'distributed', 'microservice', 'performance'],
};

/**
 * 风险关键词
 */
export const RISK_KEYWORDS = {
  high: ['删除', '删除所有', 'rm -rf', 'drop', 'delete all', '清空'],
  critical: ['生产环境', '线上', 'production', 'live', 'master branch'],
};

// ═══════════════════════════════════════════════════════════
// 评分权重
// ═══════════════════════════════════════════════════════════

/**
 * 诊断评分权重
 * 用于计算整体诊断得分
 */
export const DIAGNOSIS_SCORE_WEIGHTS = {
  complexityMatch: 0.30,  // 复杂度匹配度
  contextFit: 0.20,       // 上下文适配度
  confidence: 0.25,       // 置信度
  riskAssessment: 0.15,   // 风险评估
  historicalSuccess: 0.10, // 历史成功率
};

// ═══════════════════════════════════════════════════════════
// 提示模板
// ═══════════════════════════════════════════════════════════

/**
 * 任务感知提示模板
 */
export const TASK_PERCEPTION_PROMPT = `请分析以下用户请求，提取关键信息：

用户请求：{{userMessage}}

请输出 JSON 格式：
{
  "taskType": "任务类型(coding/debugging/refactoring/analysis/writing/creative/general)",
  "complexity": "复杂度(ultraSimple/simple/medium/complex/hard)",
  "ambiguity": "歧义度(0-1)",
  "keyEntities": ["关键实体1", "关键实体2"],
  "intentSummary": "意图摘要(20字以内)"
}`;

/**
 * 缺口分析提示模板
 */
export const GAP_ANALYSIS_PROMPT = `请分析以下任务的信息缺口：

任务类型：{{taskType}}
复杂度：{{complexity}}
用户请求：{{userMessage}}

请识别可能缺失的信息，输出 JSON 格式：
{
  "gaps": [
    {
      "type": "缺口类型(missing_context/ambiguous_requirement/unclear_scope/technical_unknown/missing_preference)",
      "description": "缺口描述",
      "severity": "严重程度(low/medium/high)",
      "canSelfFill": "是否可自我补全(true/false)"
    }
  ]
}`;

// ═══════════════════════════════════════════════════════════
// 事件名称
// ═══════════════════════════════════════════════════════════

/**
 * SSE 事件名称
 */
export const DIAGNOSIS_SSE_EVENTS = {
  TASK_PERCEPTION_STARTED: 'task_perception_started',
  TASK_PERCEPTION_COMPLETED: 'task_perception_completed',
  DIAGNOSIS_STARTED: 'diagnosis_started',
  DIAGNOSIS_COMPLETED: 'diagnosis_completed',
  TREATMENT_PLAN_CREATED: 'treatment_plan_created',
  TREATMENT_PLAN_ADJUSTED: 'treatment_plan_adjusted',
  STEP_STARTED: 'step_started',
  STEP_COMPLETED: 'step_completed',
  STEP_VERIFICATION_COMPLETED: 'step_verification_completed',
  TREATMENT_COMPLETED: 'treatment_completed',
  CLARIFICATION_NEEDED: 'clarification_needed',
} as const;
