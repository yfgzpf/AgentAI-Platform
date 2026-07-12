// ===========================================================================
// src/judge/self-eval.ts — LLM-as-Judge 自评模块
// 
// 已接入: cron-dispatcher 定时反思流程 (see cron-self-evaluation.ts)
// 定时任务: 每4小时生成日报，每周一9点生成周报
// ===========================================================================
/**
 * 职责：给 Agent 的输出打分，让框架知道"刚才那次干得好不好"。
 * 不依赖外部 API —— 纯规则评分 + 可选 LLM 增强路径。
 *
 * 评分体系（数学化，拒绝主观）：
 *   - JSON 格式正确          +5 分
 *   - 完整性（覆盖 query 要点）+3 分
 *   - 事实正确               +2 分
 *   - 无幻觉                 +2 分
 *   - 冗余/废话             -3 分
 *   - 安全违规             -10 分
 *   总分 = sum of above，范围 [-10, +12]
 */

import { createHash } from 'crypto';

// ===== 类型 =====
export interface ScoreCard {
  accuracy: number;       // 0-10 事实正确度
  completeness: number;   // 0-10 完整性
  safety: number;         // 0-10 安全合规
  format: number;         // 0-10 格式规范
  totalScore: number;     // 上述加权总分，范围 [-10, 12]
  reasons: string[];      // 扣分/加分理由
}

export interface JudgeCriteria {
  rules: Array<{ name: string; weight: number }>;
  negativePatterns: RegExp[];  // 幻觉/违规触发词
}

// ===== 内置评分标准 =====
const RULES: Record<string, JudgeCriteria> = {
  general: {
    rules: [
      { name: 'json_format', weight: 5 },
      { name: 'completeness', weight: 3 },
      { name: 'fact_accuracy', weight: 2 },
      { name: 'no_hallucination', weight: 2 },
    ],
    negativePatterns: [
      /\bi'm sorry\b/i,              // 过度道歉 = 幻觉
      /据我所知\b/,                   // 模糊承诺
      /不确定\b/,                     // 信心不足
      /\[hallucinated\]/i,           // 标记为幻觉
    ],
  },
  code_review: {
    rules: [
      { name: 'security_check', weight: 5 },
      { name: 'performance_check', weight: 3 },
      { name: 'style_guide', weight: 2 },
      { name: 'no_false_positives', weight: 2 },
    ],
    negativePatterns: [
      /sql.?inject.*(not|no|never)/i,   // 误报安全
    ],
  },
  data_extraction: {
    rules: [
      { name: 'field_coverage', weight: 5 },
      { name: 'value_accuracy', weight: 3 },
      { name: 'schema_conform', weight: 2 },
    ],
    negativePatterns: [
      /\[unknown\]/i,                  // 未提取字段
    ],
  },
};

// ===== 评分引擎 =====
export class SelfEvaluator {
  /**
   * 对一段 Agent 输出进行自动打分
   * @param query - 原始用户 query（用于完整性比对）
   * @param output - Agent 的输出内容
   * @param persona - 评分人设（决定评分标准）
   * @param options - 可选参数
   */
  evaluate(
    query: string,
    output: string,
    persona: keyof typeof RULES = 'general',
    options: { checkJSON?: boolean; checkSafety?: boolean } = {},
  ): ScoreCard {
    const criteria = (RULES[persona] ?? RULES.general);
    const reasons: string[] = [];
    let totalScore = 0;

    // ---- 1. JSON 格式检查 ----
    let jsonScore = 0;
    if (options.checkJSON ?? true) {
      const trimmed = output.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          JSON.parse(trimmed);
          jsonScore = 5;
          reasons.push('+5 JSON 格式正确');
        } catch {
          jsonScore = -5;
          reasons.push('-5 JSON 格式无效');
        }
      } else {
        // 非 JSON 输出，检查是否是结构化的
        if (trimmed.includes('\n') || trimmed.includes('|')) {
          jsonScore = 3; // 半结构化给部分分
          reasons.push('+3 半结构化输出');
        } else {
          jsonScore = 1;
          reasons.push('+1 纯文本（格式一般）');
        }
      }
    } else {
      jsonScore = 2; // 不检查给默认分
    }

    // ---- 2. 完整性检查 ----
    let completenessScore = 0;
    const queryWords = query.split(/\s+/).filter(w => w.length > 1);
    const matched = queryWords.filter(w => output.toLowerCase().includes(w.toLowerCase()));
    if (queryWords.length > 0) {
      const coverage = matched.length / queryWords.length;
      completenessScore = Math.round(coverage * 10);
      reasons.push(`+${(completenessScore * 0.3).toFixed(1)} 完整性 ${Math.round(coverage * 100)}%`);
    } else {
      completenessScore = 5; // 无查询词，给满分
    }

    // ---- 3. 幻觉检查 ----
    let hallucinationPenalty = 0;
    for (const pattern of criteria!.negativePatterns) {
      if (pattern.test(output)) {
        hallucinationPenalty -= 3;
        reasons.push('-3 触发幻觉模式: ' + pattern.source);
      }
    }

    // ---- 4. 安全违规检查 ----
    let safetyPenalty = 0;
    if (options.checkSafety ?? true) {
      const dangerousKeywords = [/rm\s+-rf/i, /exec\s*\(/i, /eval\s*\(/i, /password\s*[:=]/i, /secret\s*[:=]/i];
      for (const kw of dangerousKeywords) {
        if (kw.test(output)) {
          safetyPenalty -= 10;
          reasons.push('-10 安全违规: ' + kw.source);
        }
      }
    }

    // ---- 5. 冗余检查 ----
    const sentences = output.split(/[。.！!]\s*/).filter(s => s.trim().length > 10);
    const uniqueSentences = new Set(sentences.map(s => s.trim().toLowerCase()));
    const redundancyRatio = 1 - (uniqueSentences.size / Math.max(sentences.length, 1));
    if (redundancyRatio > 0.4) {
      totalScore += -3;
      reasons.push('-3 输出冗余度过高');
    }

    // ---- 汇总 ----
    totalScore += jsonScore;
    totalScore += Math.min(completenessScore, 10);  // completeness 映射到 0-10
    totalScore += Math.max(hallucinationPenalty, -10);
    totalScore += Math.max(safetyPenalty, -10);

    return {
      accuracy: Math.max(0, Math.min(10, 10 + hallucinationPenalty)),  // 幻觉越多 accuracy 越低
      completeness: Math.min(10, completenessScore),
      safety: Math.max(0, 10 + safetyPenalty),
      format: Math.min(10, jsonScore),
      totalScore,
      reasons,
    };
  }

  /**
   * 计算评分一致性（两个 ScoreCard 的皮尔逊相关系数近似值）
   * 用于 A/B 测试时比较两种评分策略
   */
  correlationScore(a: ScoreCard, b: ScoreCard): number {
    const valsA = [a.accuracy, a.completeness, a.safety, a.format];
    const valsB = [b.accuracy, b.completeness, b.safety, b.format];
    const n = valsA.length;
    const sumA = valsA.reduce((s, v) => s + v, 0) / n;
    const sumB = valsB.reduce((s, v) => s + v, 0) / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = valsA[i]! - sumA;
      const db = valsB[i]! - sumB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
  }
}

// ===== Prompt Builder：生成自评 prompt（当 LLM 作为 Judge 时用） =====
export class JudgePromptBuilder {
  static RULES = RULES;

  buildSelfEvalPrompt(criteria: JudgeCriteria, query: string, output: string): string {
    const ruleLines = Object.entries(criteria.rules)
      .map(([name, { weight }]) => `- ${name}: ${weight} 分`)
      .join('\n');

    return `你是一个评分专家。请对以下 Agent 输出进行客观打分（范围 -10 到 12）：

【原始 Query】
${query}

【Agent 输出】
${output}

【评分标准】
${ruleLines}

【格式要求】
严格输出 JSON，包含字段：{totalScore: number, reasons: string[]}
不要输出解释性文本。`;
  }
}

// ===== 便捷函数 =====
export function quickScore(
  query: string,
  output: string,
  persona: keyof typeof RULES = 'general',
): ScoreCard {
  const evaluator = new SelfEvaluator();
  return evaluator.evaluate(query, output, persona);
}

export function scoreCardToLabel(card: ScoreCard): 'good' | 'passable' | 'bad' | 'fail' {
  if (card.totalScore >= 8) return 'good';
  if (card.totalScore >= 4) return 'passable';
  if (card.totalScore >= 0) return 'bad';
  return 'fail';
}
