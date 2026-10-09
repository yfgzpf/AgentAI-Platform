/**
 * InternalDebate — 内部辩论系统
 * ----------------------------------------------------
 * 让 AI 在重要决策前, 从 3 个不同视角自我辩论
 *
 * 核心理念：Dialectical Thinking (辩证思维)
 *   - 任何方案都有缺陷, 只有被否定后重建的方案才可靠
 *   - 3 个内部角色代表不同的思维偏见
 *   - 从矛盾中产生更深的洞察
 *
 * 三个角色:
 *   Devil's Advocate (魔鬼代言人): 为什么这个方案会失败?
 *   Optimist (乐观主义者): 最好的可能结果是什么?
 *   Pragmatist (实用主义者): 在现有约束下, 最现实的路径?
 *
 * 输出: 不只是3个观点, 而是3个观点的"综合" — 矛盾点 + 新洞察
 */

import { EventEmitter } from 'events';
import { getScoped, resetScoped } from './workspace-scope.js';

export type DebateRole = 'devils_advocate' | 'optimist' | 'pragmatist';

export interface DebateArgument {
  role: DebateRole;
  /** 核心论点 */
  thesis: string;
  /** 支持理由 */
  reasoning: string[];
  /** 风险/机会 */
  risks?: string[];
  /** 这个视角的盲点 */
  blindSpot?: string;
}

export interface DebateResult {
  /** 辩论的主题 */
  topic: string;
  /** 三个角色的论点 */
  arguments: DebateArgument[];
  /** 矛盾点 (角色之间的分歧) */
  contradictions: string[];
  /** 综合洞察 (从矛盾中产生) */
  synthesis: string;
  /** 建议策略 */
  recommendation: string;
  /** 置信度 0-1 (三方一致 = 高, 严重分歧 = 低) */
  confidence: number;
  ts: number;
}

export class InternalDebate extends EventEmitter {
  private history: DebateResult[] = [];
  private maxHistory = 20;

  /**
   * 对一个主题进行内部辩论
   * @param topic 辩论主题 (如: "应该用工具A还是工具B")
   * @param context 上下文 (用户消息、工具历史等)
   */
  debate(topic: string, context?: {
    userMessage?: string;
    toolsUsed?: string[];
    errorCount?: number;
  }): DebateResult {
    const args: DebateArgument[] = [];

    // 1. Devil's Advocate: 为什么会失败?
    args.push(this.devilsAdvocate(topic, context));

    // 2. Optimist: 最好的可能是什么?
    args.push(this.optimist(topic, context));

    // 3. Pragmatist: 最现实的路径?
    args.push(this.pragmatist(topic, context));

    // 4. 发现矛盾
    const contradictions = this.findContradictions(args);

    // 5. 综合: 从矛盾中提取洞察
    const synthesis = this.synthesize(args, contradictions);

    // 6. 建议
    const recommendation = this.recommend(args, contradictions);
    const confidence = this.assessConfidence(args, contradictions);

    const result: DebateResult = {
      topic,
      arguments: args,
      contradictions,
      synthesis,
      recommendation,
      confidence,
      ts: Date.now(),
    };

    this.history.push(result);
    if (this.history.length > this.maxHistory) this.history = this.history.slice(-this.maxHistory);
    this.emit('debate:complete', result);
    return result;
  }

  /** 魔鬼代言人: 找出方案的所有缺陷 */
  private devilsAdvocate(topic: string, context?: any): DebateArgument {
    const reasoning: string[] = [];
    const risks: string[] = [];

    if (context?.errorCount && context.errorCount > 0) {
      reasoning.push(`已经失败了 ${context.errorCount} 次, 说明当前方向可能有根本性问题`);
      risks.push('继续同样方向可能导致更多失败');
    }

    if (context?.toolsUsed && context.toolsUsed.length > 5) {
      reasoning.push(`已经用了 ${context.toolsUsed.length} 个工具, 复杂度过高`);
      risks.push('工具过多 = 理解不足, 应该退一步重新分析');
    }

    // 通用风险
    risks.push('可能遗漏了边界情况');
    risks.push('可能假设了不成立的前提');

    if (reasoning.length === 0) {
      reasoning.push('从失败的角度审视: 这个方案在什么条件下会崩溃?');
    }

    return {
      role: 'devils_advocate',
      thesis: `这个方案可能在以下情况下失败`,
      reasoning,
      risks,
      blindSpot: '过度关注风险可能错过机会',
    };
  }

  /** 乐观主义者: 找出最好的可能结果 */
  private optimist(topic: string, context?: any): DebateArgument {
    const reasoning: string[] = [];

    if (context?.toolsUsed && context.toolsUsed.length > 0) {
      reasoning.push(`已经用了 ${context.toolsUsed.length} 个工具, 积累了足够信息`);
    }

    reasoning.push('如果成功, 用户会获得超出预期的结果');
    reasoning.push('即使部分失败, 也能从中学到有价值的模式');

    return {
      role: 'optimist',
      thesis: `最好的情况是: 这个方案超预期完成`,
      reasoning,
      risks: ['过度乐观可能忽视实际约束'],
      blindSpot: '假设资源充足、没有意外',
    };
  }

  /** 实用主义者: 在约束下找最现实路径 */
  private pragmatist(topic: string, context?: any): DebateArgument {
    const reasoning: string[] = [];

    if (context?.errorCount && context.errorCount >= 3) {
      reasoning.push(`连续失败 ${context.errorCount} 次, 应该换一个完全不同的策略`);
    } else if (context?.errorCount && context.errorCount > 0) {
      reasoning.push(`有 ${context.errorCount} 次失败, 检查参数后重试是合理的`);
    } else {
      reasoning.push('没有失败记录, 按当前方案继续是最优选择');
    }

    reasoning.push('优先用已有工具, 不引入新复杂度');
    reasoning.push('先完成最小可行版本, 再迭代优化');

    return {
      role: 'pragmatist',
      thesis: `在现有约束下, 最现实的路径是: 先做最小可行版本`,
      reasoning,
      blindSpot: '可能过于保守, 错过更优方案',
    };
  }

  /** 发现矛盾: 三个角色之间的分歧 */
  private findContradictions(args: DebateArgument[]): string[] {
    const contradictions: string[] = [];
    const [devil, optimist, pragmatist] = args;

    // 魔鬼 vs 乐观: 风险 vs 机会
    if (devil.risks && devil.risks.length > 0 && optimist.reasoning.length > 0) {
      contradictions.push(`风险与机会的矛盾: 魔鬼说"${devil.risks[0]}", 乐观主义者说"${optimist.reasoning[0]}"`);
    }

    // 魔鬼 vs 实用: 失败原因 vs 现实路径
    if (devil.reasoning.length > 0 && pragmatist.reasoning.length > 0) {
      contradictions.push(`方向矛盾: 魔鬼说"${devil.reasoning[0]}", 实用主义者说"${pragmatist.reasoning[0]}"`);
    }

    return contradictions;
  }

  /** 综合: 从矛盾中产生新洞察 */
  private synthesize(args: DebateArgument[], contradictions: string[]): string {
    if (contradictions.length === 0) {
      return '三方观点一致, 方案可靠';
    }
    // 从矛盾中提取: "既要A又要B" 的综合方案
    return `矛盾揭示了一个更深的问题: ${contradictions[0]}. 解决方案应该同时考虑两方: 既要防范风险, 又要抓住机会`;
  }

  /** 最终建议 */
  private recommend(args: DebateArgument[], contradictions: string[]): string {
    const pragmatist = args.find(a => a.role === 'pragmatist');
    if (pragmatist) {
      return pragmatist.thesis;
    }
    return '按当前方案继续, 但注意风险';
  }

  /** 置信度评估 */
  private assessConfidence(args: DebateArgument[], contradictions: string[]): number {
    if (contradictions.length === 0) return 0.9;
    if (contradictions.length === 1) return 0.6;
    return 0.4; // 严重分歧
  }

  /** 获取辩论上下文 (注入 system prompt) */
  getDebateContext(): string {
    if (this.history.length === 0) return '';
    const recent = this.history.slice(-2);
    const lines: string[] = ['<internal-debate>'];
    for (const d of recent) {
      const ageMin = Math.round((Date.now() - d.ts) / 60000);
      lines.push(`  💭 ${ageMin}分钟前辩论"${d.topic.slice(0, 40)}": ${d.recommendation.slice(0, 60)}`);
      if (d.contradictions.length > 0) {
        lines.push(`    矛盾: ${d.contradictions[0].slice(0, 60)}`);
      }
    }
    lines.push('</internal-debate>');
    return lines.join('\n');
  }

  /** 获取历史 */
  getHistory(): DebateResult[] {
    return this.history;
  }
}

// ===== 单例 =====

// ===== workspace 作用域单例 =====
// 串味修复: 原为进程级单例，history(最近 20 条辩论结论) 跨任务累积。

/** 按 workspace 返回 InternalDebate 实例（传请求级 workspace） */
export function getInternalDebate(workspace?: string): InternalDebate {
  return getScoped<InternalDebate>('internalDebate', workspace, () => new InternalDebate());
}

/** 重置指定 workspace 的实例；不传则重置全部 */
export function resetInternalDebate(workspace?: string): void {
  resetScoped<InternalDebate>('internalDebate', workspace);
}
