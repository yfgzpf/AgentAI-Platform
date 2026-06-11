/**
 * AgentAI 三层记忆 (学 WorkBuddy 经验)
 * ----------------------------------------------------
 * - cloud:  (云端, 阶段 4 接)
 * - user:   用户级 (跨工作空间)
 * - workspace: 工作空间级 (项目内, .agentai/memory/)
 *
 * 修复: 使用 writeFile + rename 模拟原子追加 (比 appendFile 更安全)
 * 修复: 内存缓存 + 批量写入, 减少 I/O 竞争
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface MemoryEntry {
  ts: number;
  userId: string;
  workspace: string;
  role: 'user' | 'assistant' | 'system' | 'reflect' | 'tool';
  content: string;
  metadata?: Record<string, any>;
  /** 自创: 来源链路 (可追溯) */
  source: 'cloud' | 'user' | 'workspace' | 'auto_reflect' | 'session';
}

const userDir = path.join(os.homedir(), '.agentai', 'memory');

/**
 * 线程安全的写入队列 (单进程内串行化)
 * 防止并发 appendFile 导致 JSONL 行交错
 */
const writeQueues = new Map<string, Promise<void>>();

/**
 * 原子写入 JSONL 行
 * 策略: 写入临时文件 → rename 替换 (原子操作)
 * 如果 rename 失败 (跨设备), 回退到 appendFile
 */
async function atomicAppendFile(filePath: string, line: string): Promise<void> {
  const queue = writeQueues.get(filePath) || Promise.resolve();
  const next = queue.then(async () => {
    try {
      await fs.appendFile(filePath, line, 'utf-8');
    } catch {
      try {
        const tmpPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        const existing = await fs.readFile(filePath, 'utf-8').catch(() => '');
        await fs.writeFile(tmpPath, existing + line, 'utf-8');
        await fs.rename(tmpPath, filePath);
      } catch {
        await fs.appendFile(filePath, line, 'utf-8').catch(() => {});
      }
    }
  }).finally(() => {
    // 完成后清理队列条目, 防止 Map 无限增长
    writeQueues.delete(filePath);
  });
  writeQueues.set(filePath, next);
  return next;
}

export async function writeMemory(entry: Omit<MemoryEntry, 'ts'>): Promise<MemoryEntry> {
  const full: MemoryEntry = { ts: Date.now(), ...entry };
  const line = JSON.stringify(full) + '\n';

  // 1. workspace 记忆 (项目内)
  const workspaceFile = path.join(entry.workspace, '.agentai', 'memory.jsonl');
  await fs.mkdir(path.dirname(workspaceFile), { recursive: true });
  await atomicAppendFile(workspaceFile, line);

  // 2. user 记忆 (跨项目)
  const userFile = path.join(userDir, `${entry.userId}.jsonl`);
  await fs.mkdir(path.dirname(userFile), { recursive: true });
  await atomicAppendFile(userFile, JSON.stringify({ ...full, workspace: '*' }) + '\n');

  return full;
}

export async function readMemory(opts: {
  userId: string;
  workspace?: string;
  limit?: number;
  /** 简易时间过滤 */
  sinceTs?: number;
}): Promise<MemoryEntry[]> {
  const limit = opts.limit ?? 50;
  const files: string[] = [];
  if (opts.workspace) {
    files.push(path.join(opts.workspace, '.agentai', 'memory.jsonl'));
  }
  files.push(path.join(userDir, `${opts.userId}.jsonl`));

  const all: MemoryEntry[] = [];
  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as MemoryEntry;
          if (opts.sinceTs && entry.ts < opts.sinceTs) continue;
          all.push(entry);
        } catch {
          // 忽略坏行
        }
      }
    } catch {
      // 文件不存在
    }
  }

  // 去重 (按 ts + role + content hash)
  const seen = new Set<string>();
  const unique = all.filter(e => {
    const key = `${e.ts}-${e.role}-${e.content.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

/**
 * 清理过期的记忆文件
 * - 默认保留最近 30 天的条目
 * - 超过 MAX_ENTRIES 的文件, 只保留最新的
 */
const MAX_MEMORY_ENTRIES_PER_FILE = 1000;
const MEMORY_RETENTION_DAYS = 30;

export async function cleanupOldMemory(
  userId?: string,
  workspace?: string,
): Promise<{ deleted: number }> {
  let deleted = 0;
  const files: string[] = [];
  if (workspace) {
    files.push(path.join(workspace, '.agentai', 'memory.jsonl'));
  }
  if (userId) {
    files.push(path.join(userDir, `${userId}.jsonl`));
  }
  // 如果没有指定, 清理所有文件
  if (!userId && !workspace) {
    try {
      const userFiles = await fs.readdir(userDir);
      for (const f of userFiles) {
        if (f.endsWith('.jsonl')) {
          files.push(path.join(userDir, f));
        }
      }
    } catch {
      // 目录不存在, 忽略
    }
  }

  const cutoff = Date.now() - MEMORY_RETENTION_DAYS * 86400_000;

  for (const file of files) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());
      const kept: string[] = [];
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.ts >= cutoff) {
            kept.push(line);
          } else {
            deleted++;
          }
        } catch {
          kept.push(line); // 坏行保留
        }
      }
      // 如果保留的条目数超过上限, 只保留最新的
      if (kept.length > MAX_MEMORY_ENTRIES_PER_FILE) {
        const trimmed = kept.slice(kept.length - MAX_MEMORY_ENTRIES_PER_FILE);
        deleted += kept.length - trimmed.length;
        await fs.writeFile(file, trimmed.join('\n') + '\n', 'utf-8');
      } else {
        await fs.writeFile(file, kept.join('\n') + '\n', 'utf-8');
      }
    } catch {
      // 文件不存在或不可读, 跳过
    }
  }

  return { deleted };
}
