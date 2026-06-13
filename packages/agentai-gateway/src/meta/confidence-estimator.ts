/**
 * Confidence Estimator — Agent self-assesses "how sure am I about this answer?"
 * Uses a multi-factor model: evidence density, consistency across attempts,
 * tool-call coverage, and semantic completeness.
 */

export type ConfidenceLevel = 'very-low' | 'low' | 'medium' | 'high' | 'very-high';

export interface ConfidenceSignal {
  factor: string;       // e.g. "evidence_density", "tool_coverage"
  weight: number;       // 0–1, how much this factor contributes to final score
  rawScore: number;     // 0–1, the measured value for this attempt
}

export interface ConfidenceReport {
  overallScore: number;   // 0–1
  level: ConfidenceLevel;
  signals: ConfidenceSignal[];
  recommendation: string; // e.g. "proceed", "gather_more_evidence", "retry_with_different_strategy"
  details: Record<string, string>; // human-readable explanations per factor
}

export class ConfidenceEstimator {
  private signals: ConfidenceSignal[];
  private factorWeights: Record<string, number>;

  constructor(factorWeights?: Record<string, number>) {
    this.signals = [];
    this.factorWeights = factorWeights || {
      evidence_density: 0.30,     // how much factual evidence supports the answer
      tool_coverage: 0.25,        // fraction of relevant tools that were tried
      consistency: 0.20,          // agreement across multiple reasoning attempts
      semantic_completeness: 0.15,// how complete the response is relative to the query
      uncertainty_markers: 0.10,  // inverse: fewer hedging words = higher confidence
    };
  }

  /** Add a confidence signal to the current evaluation. */
  addSignal(factor: string, weight: number, rawScore: number): this {
    this.signals.push({ factor, weight, rawScore });
    return this;
  }

  /**
   * Evaluate confidence based on collected signals.
   * Score = weighted average of (weight * rawScore) / sum(all weights used).
   */
  evaluate(): ConfidenceReport {
    if (this.signals.length === 0) {
      return this.buildReport(0, [], 'no-data');
    }

    // Compute weighted score
    let weightedSum = 0;
    let totalWeight = 0;
    const details: Record<string, string> = {};

    for (const signal of this.signals) {
      const contribution = signal.weight * signal.rawScore;
      weightedSum += contribution;
      totalWeight += signal.weight;
      details[signal.factor] = this.factorExplanation(signal.factor, signal.rawScore);
    }

    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
    const level = this.scoreToLevel(overallScore);
    const recommendation = this.scoreToRecommendation(overallScore, this.signals);

    return {
      overallScore: Math.round(overallScore * 100) / 100,
      level,
      signals: [...this.signals],
      recommendation,
      details,
    };
  }

  /** Reset signals for next evaluation. */
  reset(): this {
    this.signals = [];
    return this;
  }

  // ---- Private helpers ----

  private buildReport(score: number, signals: ConfidenceSignal[], recommendation: string): ConfidenceReport {
    return {
      overallScore: score,
      level: this.scoreToLevel(score),
      signals,
      recommendation,
      details: {},
    };
  }

  private scoreToLevel(score: number): ConfidenceLevel {
    if (score >= 0.9) return 'very-high';
    if (score >= 0.75) return 'high';
    if (score >= 0.5) return 'medium';
    if (score >= 0.3) return 'low';
    return 'very-low';
  }

  private scoreToRecommendation(score: number, signals: ConfidenceSignal[]): string {
    if (score >= 0.8) return 'proceed';
    if (score >= 0.6) return 'consider_verifying_key_points';
    if (score >= 0.4) return 'gather_more_evidence';
    return 'retry_with_different_strategy';
  }

  private factorExplanation(factor: string, rawScore: number): string {
    const map: Record<string, string> = {
      evidence_density: rawScore >= 0.7
        ? '丰富的证据支持结论'
        : rawScore >= 0.4
          ? '证据一般，建议补充参考资料'
          : '证据不足，结论可靠性较低',
      tool_coverage: rawScore >= 0.7
        ? '已充分使用相关工具'
        : rawScore >= 0.4
          ? '部分工具未尝试，可能遗漏信息'
          : '工具使用不足，结论可能不完整',
      consistency: rawScore >= 0.8
        ? '多次推理结果高度一致'
        : rawScore >= 0.5
          ? '结果基本一致，偶有分歧'
          : '多次推理结果差异较大，结论不稳定',
      semantic_completeness: rawScore >= 0.8
        ? '回答覆盖了查询的所有方面'
        : rawScore >= 0.5
          ? '回答部分完整，可能遗漏细节'
          : '回答不完整，需要补充',
      uncertainty_markers: rawScore >= 0.8
        ? '结论表述明确，无明显犹豫用语'
        : rawScore >= 0.5
          ? '包含部分犹豫用语，但核心结论清晰'
          : '大量使用不确定词汇，置信度低',
    };
    return map[factor] || `因子得分: ${(rawScore * 100).toFixed(0)}%`;
  }
}
