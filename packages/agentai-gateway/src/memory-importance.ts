/**
 * Memory Importance — 记忆重要性评估系统
 * ----------------------------------------
 * 让 AI 判断哪些记忆值得保留，实现智能记忆管理
 *
 * 评估维度:
 *   1. 内容重要性 — 技术决策、架构设计 > 闲聊
 *   2. 访问频率 — 经常被回忆的记忆更重要
 *   3. 时效性 — 近期记忆 > 远期记忆
 *   4. 独特性 — 独特信息 > 重复信息
 *   5. 用户显式标记 — 用户说"记住这个" > 自动提取
 */

import { MemoryEntry } from './memory.js';

/** 重要性评估结果 */
export interface ImportanceScore {
  /** 总分 (0-1) */
  score: number;
  /** 各维度得分 */
  breakdown: {
    content: number;      // 内容重要性
    frequency: number;    // 访问频率
    recency: number;      // 时效性
    uniqueness: number;   // 独特性
    explicit: number;     // 显式标记
  };
  /** 评估原因 */
  reason: string;
  /** 建议操作 */
  recommendation: 'keep' | 'compress' | 'archive' | 'delete';
}

/** 内容重要性关键词 */
const HIGH_VALUE_PATTERNS = [
  // 技术决策
  /架构|设计|decision|design|pattern/i,
  /技术栈|tech stack|framework|library/i,
  /API|接口|endpoint|contract/i,
  // 关键配置
  /配置|config|setting|environment/i,
  /密钥|key|token|password|credential/i,
  // 重要约定
  /约定|convention|standard|规范/i,
  /重要|critical|important|essential/i,
  // 问题解决
  /修复|fix|解决|solved|bug|issue/i,
  /方案|solution|workaround/i,
  // 用户显式标记
  /记住|remember|记下来|note/i,
];

const LOW_VALUE_PATTERNS = [
  // 闲聊
  /你好|hello|hi|在吗/i,
  /谢谢|thanks|thank you/i,
  /再见|bye|goodbye/i,
  // 临时性内容
  /临时|temp|temporary|test/i,
  /试一下|试试|try/i,
];

/** 访问统计（内存缓存，定期持久化） */
const accessStats = new Map<string, { count: number; lastAccess: number }>();

/**
 * 评估记忆重要性
 */
export function evaluateImportance(
  entry: MemoryEntry,
  accessCount?: number,
): ImportanceScore {
  const content = entry.content || '';
  const contentLower = content.toLowerCase();

  // 1. 内容重要性 (0-1)
  let contentScore = 0.5; // 默认中等
  const highMatches = HIGH_VALUE_PATTERNS.filter(p => p.test(content)).length;
  const lowMatches = LOW_VALUE_PATTERNS.filter(p => p.test(content)).length;

  if (highMatches > 0) {
    contentScore = Math.min(0.9, 0.6 + highMatches * 0.1);
  }
  if (lowMatches > 0) {
    contentScore = Math.max(0.1, contentScore - lowMatches * 0.2);
  }

  // 角色加权
  if (entry.role === 'system') contentScore += 0.1;
  if (entry.role === 'tool' && entry.metadata?.error) contentScore += 0.15; // 错误记录更重要

  // 2. 访问频率 (0-1)
  const stats = accessStats.get(entry.content);
  const frequencyScore = stats
    ? Math.min(1, Math.log(stats.count + 1) / Math.log(10))
    : 0;

  // 3. 时效性 (0-1) — 指数衰减
  const age = Date.now() - entry.ts;
  const halfLife = 7 * 24 * 60 * 60 * 1000; // 7天半衰期
  const recencyScore = Math.exp(-age / halfLife);

  // 4. 独特性 (0-1) — 基于内容长度和结构
  const uniquenessScore = Math.min(1, content.length / 500); // 长内容更独特

  // 5. 显式标记 (0-1)
  let explicitScore = 0;
  if (entry.metadata?.explicit === true) explicitScore = 1;
  if (entry.metadata?.userMarked === true) explicitScore = 1;
  if (/记住|remember|记下来/.test(content)) explicitScore = 0.8;

  // 计算总分（加权）
  const weights = {
    content: 0.35,
    frequency: 0.25,
    recency: 0.20,
    uniqueness: 0.10,
    explicit: 0.10,
  };

  const totalScore =
    contentScore * weights.content +
    frequencyScore * weights.frequency +
    recencyScore * weights.recency +
    uniquenessScore * weights.uniqueness +
    explicitScore * weights.explicit;

  // 建议操作
  let recommendation: ImportanceScore['recommendation'];
  if (totalScore >= 0.7) {
    recommendation = 'keep';
  } else if (totalScore >= 0.4) {
    recommendation = 'compress';
  } else if (totalScore >= 0.2) {
    recommendation = 'archive';
  } else {
    recommendation = 'delete';
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    breakdown: {
      content: Math.round(contentScore * 100) / 100,
      frequency: Math.round(frequencyScore * 100) / 100,
      recency: Math.round(recencyScore * 100) / 100,
      uniqueness: Math.round(uniquenessScore * 100) / 100,
      explicit: Math.round(explicitScore * 100) / 100,
    },
    reason: generateReason(totalScore, highMatches, lowMatches, explicitScore),
    recommendation,
  };
}

/**
 * 记录访问（用于频率统计）
 */
export function recordAccess(content: string): void {
  const stats = accessStats.get(content);
  if (stats) {
    stats.count++;
    stats.lastAccess = Date.now();
  } else {
    accessStats.set(content, { count: 1, lastAccess: Date.now() });
  }
}

/**
 * 批量评估记忆重要性
 */
export function evaluateBatch(entries: MemoryEntry[]): Array<MemoryEntry & { _importance: ImportanceScore }> {
  return entries.map(entry => ({
    ...entry,
    _importance: evaluateImportance(entry),
  })) as Array<MemoryEntry & { _importance: ImportanceScore }>;
}

/**
 * 筛选高价值记忆
 */
export function filterHighValue(
  entries: MemoryEntry[],
  threshold: number = 0.5,
): MemoryEntry[] {
  return entries.filter(entry => {
    const score = evaluateImportance(entry);
    return score.score >= threshold;
  });
}

/** 获取评估后的重要性分数 */
export function getImportanceScore(entry: MemoryEntry & { _importance?: ImportanceScore }): number {
  return entry._importance?.score ?? entry.importance ?? 0.5;
}

/**
 * 生成评估原因
 */
function generateReason(
  score: number,
  highMatches: number,
  lowMatches: number,
  explicitScore: number,
): string {
  const reasons: string[] = [];

  if (score >= 0.7) {
    reasons.push('高价值内容');
  } else if (score <= 0.3) {
    reasons.push('低价值内容');
  }

  if (highMatches > 0) {
    reasons.push(`匹配 ${highMatches} 个高价值模式`);
  }
  if (lowMatches > 0) {
    reasons.push(`匹配 ${lowMatches} 个低价值模式`);
  }
  if (explicitScore > 0) {
    reasons.push('用户显式标记');
  }

  return reasons.join(', ') || '普通内容';
}

/**
 * 智能压缩建议
 * 返回应该被压缩的记忆索引
 */
export function suggestCompression(entries: MemoryEntry[]): number[] {
  const evaluated = evaluateBatch(entries);

  // 按重要性排序，返回低价值记忆的索引
  const withIndex = evaluated.map((e, i) => ({ ...e, index: i }));
  const sorted = withIndex.sort((a, b) => (a._importance?.score ?? 0) - (b._importance?.score ?? 0));

  // 建议压缩后 30% 的低价值记忆
  const compressCount = Math.floor(entries.length * 0.3);
  return sorted.slice(0, compressCount).map(e => e.index);
}

/**
 * 生成记忆摘要（用于压缩）
 */
export function generateSummary(entries: MemoryEntry[]): string {
  const evaluated = evaluateBatch(entries);
  const highValue = evaluated.filter(e => (e._importance?.score ?? 0) >= 0.6);

  if (highValue.length === 0) {
    return `[摘要] ${entries.length} 条记忆，无高价值内容`;
  }

  const summary = highValue
    .slice(0, 5)
    .map(e => `- ${e.content.slice(0, 80)}... (重要性: ${e._importance?.score ?? 0})`)
    .join('\n');

  return `[摘要] ${entries.length} 条记忆，其中 ${highValue.length} 条高价值:\n${summary}`;
}
