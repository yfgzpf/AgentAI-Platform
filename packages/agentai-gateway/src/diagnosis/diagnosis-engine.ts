/**
 * 诊断引擎
 * 岐枢 | PulseFlow - 望闻问切之"切"
 *
 * 职责：
 * 1. 评估置信度（切脉）
 * 2. 分析风险（辨证）
 * 3. 选择治法（施治）
 *
 * @module diagnosis/diagnosis-engine
 */

import {
  TaskPerceptionReport,
  DiagnosisReport,
  DiagnosisContext,
  DiagnosisConfig,
  TreatmentApproach,
  RiskLevel,
} from '../types/diagnosis.js';
export type { TaskPerceptionReport, DiagnosisReport, DiagnosisContext, DiagnosisConfig, TreatmentApproach, RiskLevel } from '../types/diagnosis.js';
import {
  DEFAULT_DIAGNOSIS_CONFIG,
  TREATMENT_APPROACH_MATRIX,
} from './constants.js';

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 诊断任务 - 生成诊断报告
 *
 * 对应中医"切诊"：
 * - 切脉 → 评估置信度
 * - 辨证 → 分析风险
 * - 施治 → 选择治法
 */
export async function diagnoseTask(
  perception: TaskPerceptionReport,
  context: DiagnosisContext,
  config?: DiagnosisConfig
): Promise<DiagnosisReport> {
  const cfg = { ...DEFAULT_DIAGNOSIS_CONFIG, ...config };
  
  // 1. 评估置信度（切脉）
  const confidence = estimateConfidence(perception, context);
  
  // 2. 分析风险（辨证）
  const risk = analyzeRisk(perception, confidence);
  
  // 3. 选择治法（施治）
  const approach = selectTreatmentApproach(perception, risk, cfg as any);
  
  // 4. 预估步骤数
  const estimatedSteps = estimateSteps(perception, approach);
  
  // 5. 识别潜在阻塞点
  const blockers = identifyBlockers(perception, risk);
  
  // 6. 计算成功率
  const successProbability = calculateSuccessProbability(perception, confidence, risk);
  
  return {
    confidence: confidence.score,
    riskLevel: risk.level,
    recommendedApproach: approach,
    estimatedSteps,
    potentialBlockers: blockers,
    successProbability,
    suggestedModelType: selectModelType(perception, approach),
  };
}

// ═══════════════════════════════════════════════════════════
// 置信度评估（切脉）
// ═══════════════════════════════════════════════════════════

interface ConfidenceScore {
  score: number;
  factors: {
    clarity: number;
    completeness: number;
    feasibility: number;
  };
}

function estimateConfidence(
  perception: TaskPerceptionReport,
  context: DiagnosisContext
): ConfidenceScore {
  const clarity = calculateClarity(perception);
  const completeness = calculateCompleteness(perception);
  const feasibility = calculateFeasibility(perception);
  
  // 加权计算
  const score = clarity * 0.35 + completeness * 0.35 + feasibility * 0.3;
  
  return { score, factors: { clarity, completeness, feasibility } };
}

function calculateClarity(perception: TaskPerceptionReport): number {
  return Math.max(0, 1 - perception.ambiguity - perception.gapList.length * 0.1);
}

function calculateCompleteness(perception: TaskPerceptionReport): number {
  const highSeverity = perception.gapList.filter(g => g.severity === 'high').length;
  const mediumSeverity = perception.gapList.filter(g => g.severity === 'medium').length;
  return Math.max(0, 1 - highSeverity * 0.3 - mediumSeverity * 0.15);
}

function calculateFeasibility(perception: TaskPerceptionReport): number {
  const scores = { ultraSimple: 0.98, simple: 0.95, medium: 0.85, complex: 0.75, hard: 0.65 };
  return scores[perception.complexity];
}

// ═══════════════════════════════════════════════════════════
// 风险分析（辨证）
// ═══════════════════════════════════════════════════════════

interface RiskAnalysis {
  level: RiskLevel;
  score: number;
  factors: {
    technical: number;
    operational: number;
  };
}

function analyzeRisk(
  perception: TaskPerceptionReport,
  confidence: ConfidenceScore
): RiskAnalysis {
  const technical = assessTechnicalRisk(perception);
  const operational = assessOperationalRisk(perception);
  
  const score = Math.min(1, (1 - confidence.score) * 1.2 + (technical + operational) / 2 * 0.3);
  
  let level: RiskLevel;
  if (score > 0.8) level = 'critical';
  else if (score > 0.6) level = 'high';
  else if (score > 0.4) level = 'medium';
  else level = 'low';
  
  return { level, score, factors: { technical, operational } };
}

function assessTechnicalRisk(perception: TaskPerceptionReport): number {
  const complexityRisk = { ultraSimple: 0.05, simple: 0.1, medium: 0.2, complex: 0.35, hard: 0.5 }[perception.complexity];
  const techUnknown = perception.gapList.filter(g => g.type === 'technical_unknown').length;
  return Math.min(1, complexityRisk + techUnknown * 0.15);
}

function assessOperationalRisk(perception: TaskPerceptionReport): number {
  const highRiskPatterns = [/删除.*所有/i, /清空/i, /rm -rf/i];
  for (const pattern of highRiskPatterns) {
    if (pattern.test(perception.intentSummary)) return 0.6;
  }
  if (/生产|线上|production/i.test(perception.intentSummary)) return 0.4;
  return 0;
}

// ═══════════════════════════════════════════════════════════
// 治法选择（施治）
// ═══════════════════════════════════════════════════════════

function selectTreatmentApproach(
  perception: TaskPerceptionReport,
  risk: RiskAnalysis,
  config: DiagnosisConfig
): TreatmentApproach {
  const ambiguityLevel = perception.ambiguity > config.ambiguityThreshold ? 'high' : 'low';
  const baseApproach = TREATMENT_APPROACH_MATRIX[perception.complexity][ambiguityLevel];
  
  if (risk.level === 'critical') return 'multi_step';
  if (risk.level === 'high' && baseApproach === 'direct') return 'planning';
  
  return baseApproach;
}

function estimateSteps(perception: TaskPerceptionReport, approach: TreatmentApproach): number {
  const baseSteps = { ultraSimple: 1, simple: 1, medium: 2, complex: 3, hard: 5 }[perception.complexity];
  const multiplier = { direct: 1, planning: 1.5, exploratory: 2, multi_step: 1.2 }[approach];
  return Math.ceil(baseSteps * multiplier);
}

function identifyBlockers(perception: TaskPerceptionReport, risk: RiskAnalysis): string[] {
  const blockers: string[] = [];
  for (const gap of perception.gapList) {
    if (gap.severity === 'high' && !gap.canSelfFill) {
      blockers.push(gap.suggestedResolution);
    }
  }
  if (risk.factors.technical > 0.5) blockers.push('技术方案需要确认');
  if (risk.factors.operational > 0.5) blockers.push('操作风险需要评估');
  return blockers.slice(0, 5);
}

function calculateSuccessProbability(
  perception: TaskPerceptionReport,
  confidence: ConfidenceScore,
  risk: RiskAnalysis
): number {
  let probability = confidence.score - risk.score * 0.3;
  const adjustment = { ultraSimple: 0.05, simple: 0.03, medium: 0, complex: -0.05, hard: -0.1 }[perception.complexity];
  return Math.max(0.3, Math.min(0.98, probability + adjustment));
}

function selectModelType(
  perception: TaskPerceptionReport,
  approach: TreatmentApproach
): 'fast' | 'balanced' | 'thorough' {
  if (perception.complexity === 'hard' || approach === 'exploratory') {
    return 'thorough';
  }
  if (perception.complexity === 'complex' || approach === 'multi_step') {
    return 'balanced';
  }
  return 'fast';
}
