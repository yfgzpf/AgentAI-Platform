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
  recommendation: string; // e.g. "proceed", "gather_more_evidence", "retry_with_pua", "ask_human"
  details: Record<string, string>; // human-readable explanations per factor
  /** PUA 压力等级 0-2 (0=未触发, 1=温和提醒, 2=绩效压力) */
  puaLevel?: number;
}

export class ConfidenceEstimator {
  private signals: ConfidenceSignal[];
  private factorWeights: Record<string, number>;

  constructor(factorWeights?: Record<string, number>) {
    this.signals = [];
    this.factorWeights = factorWeights || {
      evidence_density: 0.25,     // how much factual evidence supports the answer
      tool_coverage: 0.20,        // fraction of relevant tools that were tried
      consistency: 0.15,          // agreement across multiple reasoning attempts
      semantic_completeness: 0.15,// how complete the response is relative to the query
      uncertainty_markers: 0.10,  // inverse: fewer hedging words = higher confidence
      knowledge_boundary: 0.15,   // is the AI answering within its verified knowledge?
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
      knowledge_boundary: rawScore >= 0.8
        ? '回答基于已验证的信息，未超出知识边界'
        : rawScore >= 0.5
          ? '部分内容可能超出已验证范围，建议补充查证'
          : '回答包含大量未经验证的推测，已超出知识边界',
    };
    return map[factor] || `因子得分: ${(rawScore * 100).toFixed(0)}%`;
  }

  /**
   * 认知边界检测: 分析回复文本是否包含超出知识边界的内容
   * 返回 0-1 分数, 1 = 完全在知识边界内, 0 = 严重越界
   */
  static assessKnowledgeBoundary(responseText: string, hasSearched: boolean, hasReadFile: boolean): number {
    if (!responseText || responseText.length < 10) return 0.5;

    let score = 0.7; // 基础分

    // 正面信号: 有工具支撑 → 在知识边界内
    if (hasSearched) score += 0.15;
    if (hasReadFile) score += 0.15;

    // 负面信号: 包含特定版本号/日期/价格等易过时信息 → 可能越界
    const staleInfoPatterns = [
      /\b20\d{2}年\d{1,2}月/,           // 具体年月 (可能过时)
      /版本\s*\d+\.\d+/,                // 具体版本号
      /价格|费用|收费|cost|price|\$\d+/,  // 价格信息 (易变)
      /最新|最近|目前|当前版本/,           // 时效性词汇 (未验证)
    ];
    const staleCount = staleInfoPatterns.filter(p => p.test(responseText)).length;
    score -= staleCount * 0.1;

    // 负面信号: 包含具体API/函数签名但未读取文件 → 可能编造
    const apiPattern = /\b\w+\.\w+\([^)]*\)/g;
    const apiMatches = responseText.match(apiPattern) || [];
    if (apiMatches.length > 3 && !hasReadFile) {
      score -= 0.15; // 大量API调用但没读文件 → 可能编造
    }

    // 负面信号: 包含"我记得""据我所知"等记忆性表述但无搜索验证
    const memoryPattern = /我记得|据我所知|据我所知|在我的记忆中|as far as I know|I recall|from my knowledge/i;
    if (memoryPattern.test(responseText) && !hasSearched) {
      score -= 0.2; // 基于记忆但未验证
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * 自我提问: 根据回复内容生成自检问题
   * 返回问题列表, 空列表表示无需自检
   */
  static generateSelfQuestions(responseText: string, userMessage: string): string[] {
    const questions: string[] = [];

    // 检测1: 回复包含代码但未验证
    if (/```/.test(responseText) && !/已验证|已测试|已运行|tested|verified/i.test(responseText)) {
      questions.push('我提供的代码是否经过了验证？是否考虑了边界情况？');
    }

    // 检测2: 回复包含具体文件路径但未读取
    if (/[A-Za-z]:\\|\.\//.test(responseText) && !/已读取|已查看|read_file/i.test(responseText)) {
      questions.push('我提到的文件路径是否真实存在？是否已确认文件内容？');
    }

    // 检测3: 用户要求修改但回复只是描述
    if (/修改|创建|修复|fix|create|modify/i.test(userMessage) &&
        /我建议|你可以|应该|需要/i.test(responseText) &&
        !/已完成|已修改|已创建|done|completed/i.test(responseText)) {
      questions.push('用户要求实际操作，但我只是给出了建议。是否应该直接执行？');
    }

    // 检测4: 回复包含绝对化表述
    if (/一定|必然|肯定|绝对不会|impossible|always|never|guaranteed/i.test(responseText)) {
      questions.push('我使用了绝对化表述，是否有例外情况？');
    }

    return questions;
  }
}
