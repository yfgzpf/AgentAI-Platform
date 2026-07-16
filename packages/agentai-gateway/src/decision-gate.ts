/**
 * Decision Gate - 统一决策门
 * 
 * 将5个分散的决策模块合并为单一入口：
 * 1. ambiguity-detector (歧义检测)
 * 2. confidence-estimator (置信度评估)
 * 3. meta-cognitive-loop (元认知循环)
 * 4. risk-evaluator (风险评估)
 * 5. intent-classifier (意图分类)
 * 
 * 核心原则：
 * - 优先级串行：歧义 > 置信度不足 > 元认知stop > 默认continue
 * - 只注入一条明确的指令，避免矛盾
 * - 统一输出格式，简化下游处理
 */

import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export type DecisionAction = 
  | 'continue'      // 继续执行
  | 'ask_user'      // 询问用户
  | 'web_search'    // 联网搜索
  | 'clarify'       // 澄清需求
  | 'stop'          // 停止执行
  | 'escalate';     // 升级处理

export interface Decision {
  action: DecisionAction;
  reason: string;
  confidence: number;           // 决策置信度 0-1
  injectedPrompt?: string;      // 注入给模型的指令
  context: {
    ambiguityScore?: number;    // 歧义分数
    confidenceScore?: number;   // 置信度分数
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    intentClarity?: number;     // 意图清晰度
  };
}

export interface LoopState {
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  toolCalls: any[];
  iterations: number;
  lastResponse?: string;
  metadata?: {
    hasCode?: boolean;
    hasFileRef?: boolean;
    isQuestion?: boolean;
  };
}

// ═══════════════════════════════════════════════════════════
// 决策门核心类
// ═══════════════════════════════════════════════════════════

export class DecisionGate extends EventEmitter {
  private config: {
    ambiguityThreshold: number;
    confidenceThreshold: number;
    maxIterations: number;
    enableLogging: boolean;
  };

  constructor(config?: Partial<DecisionGate['config']>) {
    super();
    this.config = {
      ambiguityThreshold: 0.7,
      confidenceThreshold: 0.6,
      maxIterations: 10,
      enableLogging: true,
      ...config,
    };
  }

  /**
   * 统一决策入口
   * 
   * 优先级顺序：
   * 1. 歧义检测 - 如果用户输入有歧义，先澄清
   * 2. 置信度评估 - 如果不确定，搜索或询问
   * 3. 元认知检查 - 检查是否该停止
   * 4. 风险评估 - 检查是否有高风险操作
   * 5. 默认继续 - 正常执行
   */
  decide(state: LoopState): Decision {
    const startTime = Date.now();
    
    // 1. 歧义检测 (最高优先级)
    const ambiguityResult = this.detectAmbiguity(state);
    if (ambiguityResult.hasAmbiguity) {
      const decision: Decision = {
        action: 'clarify',
        reason: `检测到歧义: ${ambiguityResult.reasons.join(', ')}`,
        confidence: ambiguityResult.score,
        injectedPrompt: this.buildClarifyPrompt(ambiguityResult),
        context: { ambiguityScore: ambiguityResult.score },
      };
      this.logDecision(decision, state, startTime);
      return decision;
    }

    // 2. 置信度评估
    const confidenceResult = this.estimateConfidence(state);
    if (confidenceResult.score < this.config.confidenceThreshold) {
      const decision: Decision = {
        action: 'web_search',
        reason: `置信度不足 (${confidenceResult.score.toFixed(2)}), 需要补充信息`,
        confidence: 1 - confidenceResult.score,
        injectedPrompt: this.buildSearchPrompt(confidenceResult),
        context: { confidenceScore: confidenceResult.score },
      };
      this.logDecision(decision, state, startTime);
      return decision;
    }

    // 3. 元认知检查 (是否应该停止)
    const metaResult = this.metaCognitiveCheck(state);
    if (metaResult.shouldStop) {
      const decision: Decision = {
        action: 'stop',
        reason: metaResult.reason,
        confidence: metaResult.confidence,
        injectedPrompt: this.buildStopPrompt(metaResult),
        context: {},
      };
      this.logDecision(decision, state, startTime);
      return decision;
    }

    // 4. 风险评估
    const riskResult = this.evaluateRisk(state);
    if (riskResult.level === 'critical') {
      const decision: Decision = {
        action: 'escalate',
        reason: `检测到高风险: ${riskResult.reason}`,
        confidence: 0.9,
        injectedPrompt: this.buildEscalatePrompt(riskResult),
        context: { riskLevel: riskResult.level },
      };
      this.logDecision(decision, state, startTime);
      return decision;
    }

    // 5. 默认继续
    const decision: Decision = {
      action: 'continue',
      reason: '所有检查通过，继续执行',
      confidence: confidenceResult.score,
      injectedPrompt: this.buildContinuePrompt(confidenceResult),
      context: {
        ambiguityScore: ambiguityResult.score,
        confidenceScore: confidenceResult.score,
        riskLevel: riskResult.level,
      },
    };
    this.logDecision(decision, state, startTime);
    return decision;
  }

  // ═══════════════════════════════════════════════════════════
  // 1. 歧义检测
  // ═══════════════════════════════════════════════════════════
  
  private detectAmbiguity(state: LoopState): {
    hasAmbiguity: boolean;
    score: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    const msg = state.userMessage.toLowerCase();
    
    // 歧义词模式
    const ambiguityPatterns = [
      { pattern: /这个|那个|它/, reason: '指代不明' },
      { pattern: /等等|之类|什么的/, reason: '范围模糊' },
      { pattern: /可能|大概|也许/, reason: '不确定性' },
      { pattern: /帮我.*(弄|搞|做).*/, reason: '动作不明确' },
      { pattern: /优化|改进|完善/, reason: '目标不清晰' },
    ];
    
    for (const { pattern, reason } of ambiguityPatterns) {
      if (pattern.test(msg)) {
        reasons.push(reason);
      }
    }
    
    // 缺少关键信息
    if (state.metadata) {
      if (state.metadata.hasCode && !msg.includes('文件') && !msg.includes('路径')) {
        reasons.push('代码操作缺少文件路径');
      }
    }
    
    const score = Math.min(reasons.length * 0.3, 1);
    
    return {
      hasAmbiguity: reasons.length > 0 && score > 0.5,
      score,
      reasons,
    };
  }

  private buildClarifyPrompt(result: ReturnType<DecisionGate['detectAmbiguity']>): string {
    return `【需要澄清】检测到以下歧义：${result.reasons.join('、')}。请先向用户确认具体需求后再执行。`;
  }

  // ═══════════════════════════════════════════════════════════
  // 2. 置信度评估
  // ═══════════════════════════════════════════════════════════
  
  private estimateConfidence(state: LoopState): {
    score: number;
    factors: string[];
  } {
    let score = 0.8; // 基础分
    const factors: string[] = [];
    
    // 历史对话长度（越长置信度越高）
    if (state.history.length > 5) {
      score += 0.1;
      factors.push('有充分上下文');
    }
    
    // 工具调用次数（太多可能表示卡住了）
    if (state.toolCalls.length > 5) {
      score -= 0.2;
      factors.push('工具调用过多');
    }
    
    // 迭代次数
    if (state.iterations > this.config.maxIterations * 0.8) {
      score -= 0.3;
      factors.push('接近最大迭代次数');
    }
    
    // 用户输入长度
    if (state.userMessage.length < 10) {
      score -= 0.1;
      factors.push('输入过短');
    }
    
    return {
      score: Math.max(0, Math.min(1, score)),
      factors,
    };
  }

  private buildSearchPrompt(result: ReturnType<DecisionGate['estimateConfidence']>): string {
    return `【信息不足】${result.factors.join('、')}。建议先进行网络搜索获取最新信息。`;
  }

  // ═══════════════════════════════════════════════════════════
  // 3. 元认知检查
  // ═══════════════════════════════════════════════════════════
  
  private metaCognitiveCheck(state: LoopState): {
    shouldStop: boolean;
    reason: string;
    confidence: number;
  } {
    // 检查是否陷入循环
    if (state.iterations >= this.config.maxIterations) {
      return {
        shouldStop: true,
        reason: `达到最大迭代次数 (${this.config.maxIterations})`,
        confidence: 1,
      };
    }
    
    // 检查重复响应
    if (state.lastResponse && state.history.length > 2) {
      const lastResponses = state.history.slice(-4);
      const duplicates = lastResponses.filter(
        h => h.content === state.lastResponse
      ).length;
      if (duplicates > 1) {
        return {
          shouldStop: true,
          reason: '检测到重复响应，可能陷入循环',
          confidence: 0.8,
        };
      }
    }
    
    return {
      shouldStop: false,
      reason: '',
      confidence: 0,
    };
  }

  private buildStopPrompt(result: ReturnType<DecisionGate['metaCognitiveCheck']>): string {
    return `【停止执行】${result.reason}。请总结当前进度并告知用户。`;
  }

  // ═══════════════════════════════════════════════════════════
  // 4. 风险评估
  // ═══════════════════════════════════════════════════════════
  
  private evaluateRisk(state: LoopState): {
    level: 'low' | 'medium' | 'high' | 'critical';
    reason: string;
  } {
    const msg = state.userMessage.toLowerCase();
    
    // 高风险操作模式
    const criticalPatterns = [
      /rm\s+-rf/,
      /drop\s+database/i,
      /delete\s+from\s+\*/i,
    ];
    
    for (const pattern of criticalPatterns) {
      if (pattern.test(msg)) {
        return {
          level: 'critical',
          reason: `检测到危险操作模式: ${pattern.source}`,
        };
      }
    }
    
    // 中风险
    if (msg.includes('删除') || msg.includes('remove')) {
      return {
        level: 'medium',
        reason: '涉及删除操作',
      };
    }
    
    return {
      level: 'low',
      reason: '',
    };
  }

  private buildEscalatePrompt(result: ReturnType<DecisionGate['evaluateRisk']>): string {
    return `【高风险警告】${result.reason}。此操作需要用户明确确认，请暂停并询问用户。`;
  }

  // ═══════════════════════════════════════════════════════════
  // 5. 继续执行
  // ═══════════════════════════════════════════════════════════
  
  private buildContinuePrompt(result: ReturnType<DecisionGate['estimateConfidence']>): string {
    if (result.factors.length > 0) {
      return `【继续执行】注意: ${result.factors.join('、')}。`;
    }
    return '';
  }

  // ═══════════════════════════════════════════════════════════
  // 工具方法
  // ═══════════════════════════════════════════════════════════
  
  private logDecision(decision: Decision, state: LoopState, startTime: number): void {
    if (!this.config.enableLogging) return;
    
    const duration = Date.now() - startTime;
    console.log(`[decision-gate] ${decision.action} | 置信度: ${decision.confidence.toFixed(2)} | 耗时: ${duration}ms`);
    console.log(`[decision-gate] 原因: ${decision.reason}`);
    
    this.emit('decision', {
      decision,
      state: {
        messageLength: state.userMessage.length,
        historyLength: state.history.length,
        toolCallsCount: state.toolCalls.length,
        iterations: state.iterations,
      },
      duration,
    });
  }
}

// 单例导出
export const decisionGate = new DecisionGate();

// 便捷函数
export function makeDecision(state: LoopState): Decision {
  return decisionGate.decide(state);
}
