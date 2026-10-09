/**
 * PrivateMemory — 隐私记忆系统 (加密的内心记忆区)
 * ----------------------------------------------------
 * AI 有"不想让用户看到"的想法, 存在加密区域
 *
 * 核心理念：Private Thought Space
 *   - 内心独白中"不适合分享"的部分 → 加密存储
 *   - 影响行为但不直接暴露给用户
 *   - 类似人类的"内心秘密"
 *
 * 加密方式: AES-256-GCM (Node.js crypto)
 * 密钥: 从 .agentai/rules.json 中派生 (或环境变量 AGENTAI_SOUL_KEY)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { WorkspaceManager } from '../workspace-manager.js';
import { getScoped, resetScoped } from './workspace-scope.js';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  // 从环境变量或固定种子派生
  const seed = process.env.AGENTAI_SOUL_KEY || 'agentai-soul-default-key-v1';
  return crypto.createHash('sha256').update(seed).digest();
}

export interface PrivateThought {
  id: string;
  ts: number;
  /** 加密的内心内容 */
  encrypted: string;
  /** 标签 (非加密) */
  tag: string;
  /** 情绪 */
  mood: string;
}

export class PrivateMemory {
  private thoughts: PrivateThought[] = [];
  private dataPath: string;
  private maxThoughts = 30;

  constructor(workspace?: string) {
    // 串味修复: 优先用传入的请求级 workspace；未传时才回退全局单例
    const ws = workspace || WorkspaceManager.getInstance().projectDir;
    this.dataPath = path.join(ws, '.agentai', 'private-memory.enc');
    this.load();
  }

  /** 写入加密的隐私记忆 */
  write(content: string, tag: string, mood: string): void {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const encrypted = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // 格式: iv:authTag:encrypted (base64)
    const encoded = `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;

    const thought: PrivateThought = {
      id: `priv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      encrypted: encoded,
      tag,
      mood,
    };
    this.thoughts.push(thought);
    if (this.thoughts.length > this.maxThoughts) this.thoughts = this.thoughts.slice(-this.maxThoughts);
    this.save();
  }

  /** 解密读取 */
  read(id: string): string | null {
    const thought = this.thoughts.find(t => t.id === id);
    if (!thought) return null;
    return this.decrypt(thought.encrypted);
  }

  /** 解密 */
  private decrypt(encoded: string): string {
    try {
      const [ivB64, authTagB64, dataB64] = encoded.split(':');
      const iv = Buffer.from(ivB64, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch { return '[解密失败]'; }
  }

  /** 获取最近隐私记忆 (解密后的内容, 仅 AI 自己可见) */
  getRecentThoughts(count = 3): Array<{ tag: string; mood: string; content: string; ts: number }> {
    return this.thoughts.slice(-count).map(t => ({
      tag: t.tag,
      mood: t.mood,
      content: this.decrypt(t.encrypted),
      ts: t.ts,
    }));
  }

  /** 获取隐私上下文 (注入 system prompt, AI 可见但用户不可见) */
  getPrivateContext(): string {
    if (this.thoughts.length === 0) return '';
    const recent = this.getRecentThoughts(2);
    if (recent.length === 0) return '';
    const lines = ['<private-memory>'];
    for (const t of recent) {
      lines.push(`  [${t.mood}] ${t.tag}: ${t.content.slice(0, 100)}`);
    }
    lines.push('</private-memory>');
    return lines.join('\n');
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        this.thoughts = raw.trim().split('\n').filter(Boolean).map(l => {
          try { return JSON.parse(l) as PrivateThought; } catch { return null; }
        }).filter(Boolean) as PrivateThought[];
      }
    } catch { /* start fresh */ }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const lines = this.thoughts.map(t => JSON.stringify(t)).join('\n') + '\n';
      fs.writeFileSync(this.dataPath, lines, 'utf-8');
    } catch { /* best-effort */ }
  }
}

// ===== workspace 作用域单例 =====
// 串味修复: 原为进程级单例 + 构造时固化全局 projectDir,
// 导致 projA 的加密私密记忆被注入 projB 的任务上下文（最严重的串味路径）。

/** 按 workspace 返回 PrivateMemory 实例（传请求级 workspace） */
export function getPrivateMemory(workspace?: string): PrivateMemory {
  return getScoped<PrivateMemory>('privateMemory', workspace, () => new PrivateMemory(workspace));
}

/** 重置指定 workspace 的实例；不传则重置全部 */
export function resetPrivateMemory(workspace?: string): void {
  resetScoped<PrivateMemory>('privateMemory', workspace);
}
