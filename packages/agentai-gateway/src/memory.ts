/**
 * AgentAI 三层记忆 (学 WorkBuddy 经验)
 * ----------------------------------------------------
 * - cloud:  (云端, 阶段 4 接)
 * - user:   用户级 (跨工作空间)
 * - workspace: 工作空间级 (项目内, .agentai/memory/)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

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

export async function writeMemory(entry: Omit<MemoryEntry, 'ts'>): Promise<MemoryEntry> {
  const full: MemoryEntry = { ts: Date.now(), ...entry };

  // 1. workspace 记忆 (项目内)
  const workspaceFile = path.join(entry.workspace, '.agentai', 'memory.jsonl');
  await fs.mkdir(path.dirname(workspaceFile), { recursive: true });
  await fs.appendFile(workspaceFile, JSON.stringify(full) + '\n', 'utf-8');

  // 2. user 记忆 (跨项目)
  const userFile = path.join(userDir, `${entry.userId}.jsonl`);
  await fs.mkdir(path.dirname(userFile), { recursive: true });
  await fs.appendFile(userFile, JSON.stringify({ ...full, workspace: '*' }) + '\n', 'utf-8');

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
