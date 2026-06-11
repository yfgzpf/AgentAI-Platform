/**
 * Evolution - 自进化记忆系统 (跨项目学习)
 * ----------------------------------------------------
 * 闭环设计:
 *   1. AgentAILoop 每次结束 → writeEvolution()
 *   2. 后台任务每 6 小时 → cleanupEvolution() 限制文件大小
 *   3. AgentAILoop 启动时 → readEvolution() 作为长期记忆上下文
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface EvolutionEntry {
  ts: number;
  type: 'success' | 'failure' | 'preference' | 'tool_stats';
  content: string;
  metadata?: Record<string, any>;
  /** 关联的 session id (可追溯) */
  sessionId?: string;
  /** 关联的 user id */
  userId?: string;
  /** 关联的工作空间 */
  workspace?: string;
}

const EVOLUTION_DIR = path.join(os.homedir(), '.agentai', 'evolution');
const EVOLUTION_FILE = path.join(EVOLUTION_DIR, 'evolution.jsonl');

/** 写入队列 (线程安全) */
const writeQueues = new Map<string, Promise<void>>();

function atomicAppend(filePath: string, line: string): Promise<void> {
  const queue = writeQueues.get(filePath) || Promise.resolve();
  const next = queue.then(async () => {
    try {
      await fs.promises.appendFile(filePath, line, 'utf-8');
    } catch {
      // 文件可能不存在
    }
  }).finally(() => {
    writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

/**
 * 写入 evolution 记录
 * 适用于 AgentAILoop 完成时调用
 */
export function writeEvolution(entry: Omit<EvolutionEntry, 'ts'>): void {
  try {
    fs.mkdirSync(EVOLUTION_DIR, { recursive: true });
    const full = { ...entry, ts: Date.now() };
    atomicAppend(EVOLUTION_FILE, JSON.stringify(full) + '\n');
  } catch {}
}

/**
 * 异步版本 (不阻塞主流程)
 */
export function writeEvolutionAsync(entry: Omit<EvolutionEntry, 'ts'>): Promise<void> {
  return new Promise((resolve) => {
    try {
      fs.promises.mkdir(EVOLUTION_DIR, { recursive: true })
        .then(() => atomicAppend(EVOLUTION_FILE, JSON.stringify({ ...entry, ts: Date.now() }) + '\n'))
        .then(() => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * 读取 evolution 记录
 */
export function readEvolution(limit: number = 50): EvolutionEntry[] {
  try {
    if (!fs.existsSync(EVOLUTION_FILE)) return [];
    const lines = fs.readFileSync(EVOLUTION_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

/**
 * 启动时的批量预热 (读取相关 user/workspace 的历史)
 */
export function readEvolutionForContext(opts: { userId?: string; workspace?: string; limit?: number }): EvolutionEntry[] {
  const all = readEvolution(opts.limit || 100);
  if (!opts.userId && !opts.workspace) return all;

  return all.filter(e => {
    if (opts.userId && e.userId && e.userId !== opts.userId) return false;
    if (opts.workspace && e.workspace && e.workspace !== opts.workspace) return false;
    return true;
  });
}

/**
 * 清理 evolution 文件 (限制大小)
 * - 保留最近 7 天
 * - 最多 1000 条
 * - 删除过期的 success/tool_stats, 保留 failure/preference (用于调优)
 */
const MAX_ENTRIES = 1000;
const RETENTION_DAYS = 7;

export async function cleanupEvolution(): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  try {
    if (!fs.existsSync(EVOLUTION_FILE)) return { deleted: 0, kept: 0 };
    const content = await fs.promises.readFile(EVOLUTION_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;

    const kept: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as EvolutionEntry;
        const isImportant = entry.type === 'failure' || entry.type === 'preference';
        const isFresh = entry.ts >= cutoff;

        if (isImportant || isFresh) {
          kept.push(line);
        } else {
          deleted++;
        }
      } catch {
        kept.push(line); // 坏行保留
      }
    }

    // 限制最大条数 (只保留最新的)
    let finalKept = kept;
    if (kept.length > MAX_ENTRIES) {
      const trimmed = kept.slice(kept.length - MAX_ENTRIES);
      deleted += kept.length - trimmed.length;
      finalKept = trimmed;
    }

    await fs.promises.writeFile(EVOLUTION_FILE, finalKept.join('\n') + '\n', 'utf-8');
    return { deleted, kept: finalKept.length };
  } catch {
    return { deleted: 0, kept: 0 };
  }
}

/**
 * 摘要统计
 */
export function getSummary(): {
  successRate: number;
  topPreferences: string[];
  recentTopics: string[];
  failureCount: number;
  totalEntries: number;
} {
  const entries = readEvolution(500);
  const successes = entries.filter(e => e.type === 'success').length;
  const failures = entries.filter(e => e.type === 'failure').length;
  const total = successes + failures;

  // 偏好统计
  const prefCounts = new Map<string, number>();
  for (const e of entries.filter(e => e.type === 'preference')) {
    prefCounts.set(e.content, (prefCounts.get(e.content) || 0) + 1);
  }
  const topPreferences = [...prefCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  // 主题统计
  const topicCounts = new Map<string, number>();
  for (const e of entries) {
    const topic = e.content.slice(0, 30);
    topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  const recentTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  return {
    successRate: total > 0 ? successes / total : 1.0,
    topPreferences,
    recentTopics,
    failureCount: failures,
    totalEntries: entries.length,
  };
}

/**
 * 启动清理定时器 (每 6 小时执行一次)
 */
let cleanupInterval: NodeJS.Timeout | null = null;
export function startEvolutionCleanupLoop(): void {
  if (cleanupInterval) return;
  // 启动时立即清理一次
  cleanupEvolution().catch(() => {});
  cleanupInterval = setInterval(() => {
    cleanupEvolution().catch(() => {});
  }, 6 * 60 * 60 * 1000); // 6 小时
}

export function stopEvolutionCleanupLoop(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
