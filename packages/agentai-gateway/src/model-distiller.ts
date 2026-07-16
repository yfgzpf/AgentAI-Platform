/**
 * Model Distiller — 模型蒸馏模块
 * ----------------------------------------------------
 * 从 evolution.jsonl 中提取成功经验模式，蒸馏为可复用的
 * system prompt / SKILL.md / 隐式规则，让小模型获得大模型经验。
 *
 * 工作流程:
 *   1. 读取 evolution.jsonl → 提取 success 类型的成功模式
 *   2. 聚类相似模式 → 提取共性与高频技巧
 *   3. 生成 distilled_patterns → 存入 evolution_distilled.jsonl
 *   4. 更新 system prompt 中的 implicit_rules 块
 *
 * @see 参考: TurnMemory / BrowserAct / 小模型蒸馏大模型文章
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvolutionEntry, readEvolution, writeEvolution } from './evolution.js';

// Re-export writeEvolution for backward compatibility (agentai-loop.ts imports it)
export { writeEvolution };

// ===== 类型定义 =====

export interface DistilledPattern {
  /** 模式标题 */
  title: string;
  /** 模式类型 */
  category: 'coding' | 'debugging' | 'workflow' | 'tool_usage' | 'communication';
  /**  distilled 的规则/技巧 */
  rule: string;
  /** 出现频率 (多少个成功案例中) */
  frequency: number;
  /** 总成功案例数 */
  totalSuccesses: number;
  /** 置信度 (frequency / total) */
  confidence: number;
  /** 源 evolution entries 的 sessionIds */
  sourceSessionIds?: string[];
}

export interface DistillationResult {
  /** 蒸馏时间戳 */
  ts: number;
  /** 生成的模式列表 */
  patterns: DistilledPattern[];
  /** 统计信息 */
  stats: {
    totalSuccesses: number;
    totalFailures: number;
    patternsGenerated: number;
    highConfidencePatterns: number;
  };
}

// ===== 常量定义 =====

const DISTILLATION_DIR = process.env.AGENTAI_EVOLUTION_DIR || path.join(os.homedir(), '.agentai', 'evolution');
const DISTILLED_FILE = path.join(DISTILLATION_DIR, 'evolution_distilled.jsonl');
const MIN_FREQUENCY = 2;       // 最少出现次数才蒸馏
const MIN_CONFIDENCE = 0.3;    // 最低置信度 30%
const MAX_PATTERNS = 50;       // 最多保留 50 个模式

// ===== 核心蒸馏逻辑 =====

/**
 * 从 evolution.jsonl 中提取成功模式
 */
export function extractSuccessPatterns(limit: number = 200): EvolutionEntry[] {
  const entries = readEvolution(limit);
  return entries.filter(e => e.type === 'success' && e.content?.trim());
}

/**
 * 对成功模式进行简单聚类 (基于 taskType + keywords)
 */
export function clusterPatterns(patterns: EvolutionEntry[]): Map<string, EvolutionEntry[]> {
  const clusters = new Map<string, EvolutionEntry[]>();

  for (const entry of patterns) {
    const key = [
      entry.taskType || 'general',
      ...(entry.keywords || []),
      entry.industry || 'general',
    ].filter(Boolean).join(':');

    if (!clusters.has(key)) {
      clusters.set(key, []);
    }
    clusters.get(key)!.push(entry);
  }

  return clusters;
}

/**
 * 从集群中提取高频规则
 */
export function distillPatterns(clusters: Map<string, EvolutionEntry[]>): DistilledPattern[] {
  const allPatterns: DistilledPattern[] = [];

  for (const [clusterKey, entries] of clusters) {
    if (entries.length < MIN_FREQUENCY) continue;

    const totalSuccesses = entries.length;
    const category = clusterKey.split(':')[0] as DistilledPattern['category'];

    // 提取前 N 个高频技巧
    const techniques: string[] = [];
    const sessionIds: string[] = [];

    for (const entry of entries.slice(0, MAX_PATTERNS)) {
      const technique = (entry.content || '').slice(0, 200);
      techniques.push(technique);
      if (entry.sessionId) sessionIds.push(entry.sessionId);
    }

    // 合并为一条规则
    const rule = [
      `📌 ${clusterKey.replace(/:/g, ' > ')}`,
      `✅ 成功案例数: ${totalSuccesses}`,
      `💡 关键技巧:`,
      ...techniques.slice(0, 3).map((t, i) => `  ${i + 1}. ${t}`),
    ].join('\n');

    allPatterns.push({
      title: clusterKey.replace(/:/g, ' > '),
      category,
      rule,
      frequency: techniques.length,
      totalSuccesses,
      confidence: techniques.length / Math.max(totalSuccesses, 1),
      sourceSessionIds: sessionIds.slice(0, 10),
    });
  }

  // 按置信度降序排序
  allPatterns.sort((a, b) => b.confidence - a.confidence);

  return allPatterns.slice(0, MAX_PATTERNS);
}

/**
 * 执行完整蒸馏流程
 */
export function runDistillation(): DistillationResult {
  console.log('[distiller] Starting distillation...');

  const successes = extractSuccessPatterns();
  const failures = readEvolution(200).filter(e => e.type === 'failure');
  
  const clusters = clusterPatterns(successes);
  const patterns = distillPatterns(clusters);

  const highConfidence = patterns.filter(p => p.confidence >= MIN_CONFIDENCE);

  const result: DistillationResult = {
    ts: Date.now(),
    patterns,
    stats: {
      totalSuccesses: successes.length,
      totalFailures: failures.length,
      patternsGenerated: patterns.length,
      highConfidencePatterns: highConfidence.length,
    },
  };

  // 持久化到 distilled file
  try {
    fs.mkdirSync(DISTILLATION_DIR, { recursive: true });
    const line = JSON.stringify(result) + '\n';
    fs.appendFileSync(DISTILLED_FILE, line, 'utf-8');
  } catch (err) {
    console.warn('[distiller] Failed to save distilled patterns:', err);
  }

  // 更新 system prompt 中的 implicit_rules 块
  try {
    const promptFragment = patternsToSystemPrompt(patterns);
    if (promptFragment.trim()) {
      const promptFile = path.join(DISTILLATION_DIR, 'implicit_rules.md');
      fs.writeFileSync(promptFile, promptFragment, 'utf-8');
      console.log('[distiller] Updated implicit_rules.md');
    }
  } catch (err) {
    console.warn('[distiller] Failed to update implicit_rules.md:', err);
  }

  console.log(`[distiller] Done! Generated ${patterns.length} patterns (${highConfidence.length} high-confidence)`);

  return result;
}

/**
 * 将蒸馏结果转换为 system prompt 片段
 */
export function patternsToSystemPrompt(patterns: DistilledPattern[]): string {
  if (patterns.length === 0) return '';

  const sections = patterns
    .filter(p => p.confidence >= MIN_CONFIDENCE)
    .slice(0, 20)  // 最多 20 个高置信度模式
    .map(p => {
      return `### ${p.title}
- 置信度: ${(p.confidence * 100).toFixed(0)}%
- 成功案例: ${p.frequency}
- 规则:
${p.rule}`;
    });

  return `
<!-- IMPLICIT_RULES_START -->
## 🧠 蒸馏经验 (从小模型蒸馏大模型)
以下是我们从 ${sections.length} 个成功案例中提炼的最佳实践:

${sections.join('\n\n')}

## 💡 使用建议
- 遇到类似任务时，优先应用上述规则
- 每次成功后，系统会自动蒸馏新经验
- 经验会随时间衰减，定期运行蒸馏以保持新鲜

<!-- IMPLICIT_RULES_END -->
`;
}

/**
 * 读取已蒸馏的模式 (用于上下文注入)
 */
export function readDistilledPatterns(limit: number = 10): DistillationResult[] {
  try {
    if (!fs.existsSync(DISTILLED_FILE)) return [];
    const lines = fs.readFileSync(DISTILLED_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean) as DistillationResult[];
  } catch {
    return [];
  }
}

/**
 * 夜间巩固: 异步蒸馏任务
 * 每天凌晨 2 点运行 (通过 automation 触发)
 */
export async function nightlyConsolidation(): Promise<void> {
  console.log('[distiller] Running nightly consolidation...');
  
  try {
    const result = runDistillation();
    
    // 生成 report
    const report = `## 🌙 夜间巩固报告 (${new Date().toISOString().slice(0, 10)})
- 总成功案例: ${result.stats.totalSuccesses}
- 总失败案例: ${result.stats.totalFailures}
- 新模式数: ${result.stats.patternsGenerated}
- 高置信度模式: ${result.stats.highConfidencePatterns}

### Top 5 经验:
${result.patterns.slice(0, 5).map((p, i) => `${i + 1}. ${p.title} (置信度: ${(p.confidence * 100).toFixed(0)}%)`).join('\n')}`;

    // 追加到 workspace journal
    const { workspaceJournal } = await import('./memory.js');
    await workspaceJournal.append(process.cwd(), {
      summary: '夜间巩固蒸馏',
      taskType: 'distillation',
      files: [DISTILLED_FILE],
      decision: report,
    });

    console.log('[distiller] Nightly consolidation complete.');
  } catch (err) {
    console.warn('[distiller] Nightly consolidation failed:', err);
  }
}

// 导出供其他模块使用
export const modelDistiller = {
  runDistillation,
  patternsToSystemPrompt,
  readDistilledPatterns,
  nightlyConsolidation,
};
