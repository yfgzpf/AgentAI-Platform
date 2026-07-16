/**
 * MetaReasoner — "thinking about thinking"
 * TODO: 接入 agentai-loop.ts 决策点, 让 AI 判断是否继续推理/调用工具/停止
 * Decides whether a tool call is necessary, whether results are sufficient,
 * and whether the agent should continue reasoning or stop.
 */

import { ConfidenceEstimator, ConfidenceReport, ConfidenceLevel } from './confidence-estimator.js';
import { CognitiveProfile, CognitiveProfileBuilder } from './cognitive-profile.js';

export interface MetaDecision {
  action: 'call_tool' | 'reason' | 'stop' | 'ask_human' | 'retry_with_pua';
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  confidence: number;
  reason: string;
  /** PUA 压力提示词 (仅当 action='retry_with_pua' 时) */
  puaPrompt?: string;
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
  /** PUA 压力等级 0-2 (低置信度时逐级升级, 2轮后仍低才 ask_human) */
  puaLevel?: number;
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

    // Step 2: If all questions are answered with a high-quality result, reason
    // (synthesize) before stopping. This must precede the high-confidence stop
    // gate — fresh high-quality evidence should be reasoned over, not skipped.
    const conf = context.confidenceReport || this.computeConfidence(context);
    if (context.pendingQuestions.length === 0 && context.lastToolResult !== null) {
      const lastResultQuality = this.estimateResultQuality(context.lastToolResult);
      if (lastResultQuality >= 0.6) {
        return {
          action: 'reason',
          confidence: 0.8,
          reason: '所有问题已回答，工具结果质量良好，进入推理阶段',
        };
      }
    }

    // Step 3: High confidence with no open work left → stop.
    if (conf.overallScore >= 0.85 && conf.recommendation === 'proceed') {
      return {
        action: 'stop',
        confidence: conf.overallScore,
        reason: `置信度足够高 (${(conf.overallScore * 100).toFixed(0)}%)，可以直接输出答案`,
      };
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

    // Step 5: Confidence too low → PUA 压力注入或 ask_human
    // PUA 范式: 低置信度时不直接问人, 先注入压力提示让 AI 再试 (最多 2 轮)
    if (conf.overallScore < 0.3) {
      const puaLevel = context.puaLevel ?? 0;
      if (puaLevel < 2) {
        // PUA 压力升级: L0 温和提醒 → L1 方法论引导 → L2 绩效压力
        return {
          action: 'retry_with_pua',
          confidence: conf.overallScore,
          reason: `置信度过低 (${(conf.overallScore * 100).toFixed(0)}%), 注入 PUA 压力 (L${puaLevel}) 后重试`,
          puaPrompt: MetaReasoner.buildPuaPrompt(puaLevel),
        };
      }
      // PUA 两轮后仍低置信度 → 才问人
      return {
        action: 'ask_human',
        confidence: 0.7,
        reason: `置信度持续过低 (PUA L2 后仍 ${ (conf.overallScore * 100).toFixed(0) }%), 建议人工介入`,
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

    // Length bonus (up to 0.15)
    if (len > 200) score += 0.15;
    else if (len > 50) score += 0.10;
    else if (len > 30) score += 0.08;
    else score += 0.05;

    // Structured content bonus (up to 0.3)
    const hasBullets = (result.match(/\n\s*[-*•]\s/g) || []).length;
    const hasHeaders = (result.match(/^#+\s/m) || []).length;
    score += Math.min(0.3, (hasBullets + hasHeaders) * 0.05);

    // Evidence markers (up to 0.3) — bilingual
    const evidenceMarkers = result.match(/(?:根据|例如|数据表明|研究表明|来源|引用|https?:\/\/|data\b|source|reference|evidence|cited)/gi) || [];
    score += Math.min(0.3, evidenceMarkers.length * 0.07);

    // Uncertainty penalty (up to -0.3)
    const uncertaintyWords = result.match(/(?:可能|也许|大概|不确定|我不太清楚|无法确定|maybe|perhaps|uncertain|not sure)/gi) || [];
    score -= Math.min(0.3, uncertaintyWords.length * 0.10);

    // Code/block presence (up to 0.2)
    score += result.includes('```') ? 0.1 : 0;
    score += result.includes('```') && result.split('```').length >= 4 ? 0.1 : 0;

    // A declarative, reasonably-sized answer with no hedging is a strong
    // positive signal — concise correct answers shouldn't read as insufficient.
    if (len > 30 && uncertaintyWords.length === 0) score += 0.30;

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

  /**
   * Compute a confidence report for the current context.
   * Exposed as public so the meta-cognitive loop can evaluate confidence
   * before deciding (see MetaCognitiveLoop.iterate).
   */
  computeConfidence(context: MetaReasoningContext): ConfidenceReport {
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

  /**
   * 构建 PUA 压力提示词 (L0-L2 递进)
   * L0: 温和提醒 — 引导回顾检查清单
   * L1: 方法论引导 — 要求按 7 项检查清单逐项确认
   * L2: 绩效压力 — 强制换思路, 穷尽方案
   */
  static buildPuaPrompt(level: number): string {
    const prompts = [
      // L0 温和提醒
      '你确定已经尝试了所有方案吗？请回顾反摆烂协议的 7 项检查清单：错误日志、环境确认、依赖检查、替代方案、文档查阅、回退方案、根因分析。未完成全部检查前不要放弃。',
      // L1 方法论引导
      '请按照 7 项检查清单逐项确认：\n1. 你完整阅读了错误日志吗？\n2. 你确认了运行环境吗？\n3. 你检查了依赖是否正确安装吗？\n4. 你尝试了至少 2 种不同的解决思路吗？\n5. 你搜索了官方文档或社区方案吗？\n6. 你有回退方案吗？\n7. 你找到根因了吗？\n请逐项回答，未完成的项立即去执行。',
      // L2 绩效压力
      '这个任务你必须完成。当前方案行不通，请立即换一种完全不同的思路。不要重复已失败的方法。如果同一个操作重复了 3 次，立即切换策略。你有 web_search、run_code、read_file 等工具——用它们。穷尽所有方案后才允许求助。',
    ];
    return prompts[Math.min(level, prompts.length - 1)]!;
  }
}
