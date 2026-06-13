/**
 * MetaReasoner — "thinking about thinking"
 * Decides whether a tool call is necessary, whether results are sufficient,
 * and whether the agent should continue reasoning or stop.
 */

import { ConfidenceEstimator, ConfidenceReport, ConfidenceLevel } from './confidence-estimator.js';
import { CognitiveProfile, CognitiveProfileBuilder } from './cognitive-profile.js';

export interface MetaDecision {
  action: 'call_tool' | 'reason' | 'stop' | 'ask_human';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  confidence: number;
  reason: string;
}

export interface MetaReasoningContext {
  taskDescription: string;
  currentPlan: string[];
  completedSteps: string[];
  pendingQuestions: string[];
  lastToolResult: string | null;
  confidenceReport: ConfidenceReport | null;
  profile?: CognitiveProfile;
  maxSteps: number;
  currentStep: number;
}

export class MetaReasoner {
  private confidence: ConfidenceEstimator;

  constructor(confidence?: ConfidenceEstimator) {
    this.confidence = confidence || new ConfidenceEstimator();
  }

  /**
   * Meta-reason at a decision point.
   * Evaluates whether the agent should call a tool, reason internally, stop, or escalate.
   */
  decide(context: MetaReasoningContext): MetaDecision {
    // Step 1: Check if we've exceeded max steps
    if (context.currentStep >= context.maxSteps) {
      return {
        action: 'ask_human',
        confidence: 0.9,
        reason: `已达到最大推理步数 (${context.maxSteps})，需要人工介入`,
      };
    }

    // Step 2: Check confidence
    const conf = context.confidenceReport || this.computeConfidence(context);
    if (conf.overallScore >= 0.85 && conf.recommendation === 'proceed') {
      return {
        action: 'stop',
        confidence: conf.overallScore,
        reason: `置信度足够高 (${(conf.overallScore * 100).toFixed(0)}%)，可以直接输出答案`,
      };
    }

    // Step 3: Check if all pending questions are answered
    if (context.pendingQuestions.length === 0 && context.lastToolResult !== null) {
      const lastResultQuality = this.estimateResultQuality(context.lastToolResult);
      if (lastResultQuality >= 0.7) {
        return {
          action: 'reason',
          confidence: 0.8,
          reason: '所有问题已回答，工具结果质量良好，进入推理阶段',
        };
      }
    }

    // Step 4: Check cognitive profile for strength-based tool recommendation
    if (context.profile) {
      const topTools = context.profile.getTopTools(1);
      if (topTools.length > 0 && topTools[0]!.avgScore >= 0.75) {
        return {
          action: 'call_tool',
          toolName: topTools[0]!.toolName,
          confidence: topTools[0]!.avgScore,
          reason: `根据历史画像，工具 "${topTools[0]!.toolName}" 成功率最高 (${(topTools[0]!.avgScore * 100).toFixed(0)}%)，建议优先使用`,
        };
      }
    }

    // Step 5: Confidence too low → suggest retry or different strategy
    if (conf.overallScore < 0.3) {
      return {
        action: 'ask_human',
        confidence: 0.7,
        reason: '置信度过低，建议更换策略或人工介入',
      };
    }

    // Default: call a tool (generic)
    return {
      action: 'call_tool',
      confidence: 0.6,
      reason: '需要更多信息，继续调用工具',
    };
  }

  /**
   * Evaluate whether a tool result is sufficient to proceed.
   */
  isResultSufficient(result: string, minQualityThreshold = 0.5): boolean {
    const quality = this.estimateResultQuality(result);
    return quality >= minQualityThreshold;
  }

  /**
   * Estimate result quality from a string (heuristic).
   * Looks for: length, structure, evidence markers, uncertainty language.
   */
  estimateResultQuality(result: string): number {
    if (!result || result.trim().length === 0) return 0;

    let score = 0;
    const len = result.length;

    // Length bonus (up to 0.2)
    if (len > 200) score += 0.15;
    else if (len > 50) score += 0.1;
    else score += 0.05;

    // Structured content bonus (up to 0.3)
    const hasBullets = (result.match(/\n\s*[-*•]\s/g) || []).length;
    const hasHeaders = (result.match(/^#+\s/m) || []).length;
    score += Math.min(0.3, (hasBullets + hasHeaders) * 0.05);

    // Evidence markers (up to 0.3)
    const evidenceMarkers = result.match(/(?:根据|例如|数据表明|研究表明|来源|引用|https?:\/\/)/g) || [];
    score += Math.min(0.3, evidenceMarkers.length * 0.06);

    // Uncertainty penalty (up to -0.2)
    const uncertaintyWords = result.match(/(?:可能|也许|大概|不确定|我不太清楚|无法确定|也许)还是/g) || [];
    score -= Math.min(0.2, uncertaintyWords.length * 0.04);

    // Code/block presence (up to 0.2)
    score += result.includes('```') ? 0.1 : 0;
    score += result.includes('```') && result.split('```').length >= 4 ? 0.1 : 0;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Update cognitive profile with a new task result.
   */
  updateProfile(profileBuilder: CognitiveProfileBuilder, taskType: string, score: number, toolUsed?: string): this {
    // Update relevant dimension
    profileBuilder.updateDimension(taskType, score);

    // Record tool usage if a tool was used
    if (toolUsed) {
      profileBuilder.recordToolUsage({
        toolName: toolUsed,
        callCount: 1,
        avgScore: score,
        avgLatencyMs: 0, // would be populated from timing data
      });
    }

    // Log failure if score is very low
    if (score < 0.3) {
      profileBuilder.logFailureMode(`low_performance_on_${taskType}`);
    }

    return this;
  }

  // ---- Private ----

  private computeConfidence(context: MetaReasoningContext): ConfidenceReport {
    this.confidence.reset();

    // Factor 1: Evidence density
    const evidenceCount = (context.lastToolResult?.match(/(?:根据|数据|来源|https?:\/\/)/g) || []).length;
    this.confidence.addSignal('evidence_density', 0.3, Math.min(1, evidenceCount / 3));

    // Factor 2: Tool coverage (are there pending questions?)
    const coverage = context.pendingQuestions.length === 0 ? 1.0 : context.pendingQuestions.length > 3 ? 0.3 : 0.6;
    this.confidence.addSignal('tool_coverage', 0.25, coverage);

    // Factor 3: Consistency (are completed steps aligned with the plan?)
    const consistency = context.completedSteps.length >= context.currentPlan.length * 0.5 ? 0.8 : 0.4;
    this.confidence.addSignal('consistency', 0.2, consistency);

    // Factor 4: Semantic completeness
    const completeness = context.lastToolResult && context.lastToolResult.length > 100 ? 0.7 : 0.3;
    this.confidence.addSignal('semantic_completeness', 0.15, completeness);

    // Factor 5: Uncertainty markers
    const uncertaintyCount = (context.lastToolResult?.match(/(?:可能|也许|大概|不确定)/g) || []).length;
    this.confidence.addSignal('uncertainty_markers', 0.1, Math.max(0, 1 - uncertaintyCount * 0.2));

    return this.confidence.evaluate();
  }
}
