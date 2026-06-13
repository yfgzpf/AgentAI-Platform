// ===========================================================================
// src/knowledge-cache.ts — 知识缓存 (task → best_template → result_score)
// ===========================================================================
/**
 * 职责：
 *   1. 缓存 task → best_template 的映射关系
 *   2. 记录每次模板使用的 result_score
 *   3. 自动淘汰低分缓存项
 *   4. 支持批量查询与统计
 *
 * 数据结构：
 *   CacheEntry { taskHash, templateId, score, hitCount, lastUsedAt }
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== 类型 =====

export interface CacheEntry {
  /** 任务 hash（由 query 生成） */
  taskHash: string;
  /** 最佳模板 ID */
  templateId: string;
  /** 累计评分 */
  totalScore: number;
  /** 使用次数 */
  hitCount: number;
  /** 平均评分 */
  avgScore: number;
  /** 最后使用时间 */
  lastUsedAt: string;
  /** Persona */
  persona: string;
}

export interface CacheQueryResult {
  found: boolean;
  entry?: CacheEntry;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  avgScore: number;
  topTemplates: Array<{ templateId: string; hitCount: number; avgScore: number }>;
}

// ===== 持久化路径 =====
const CACHE_DIR = path.join(os.homedir(), '.agentai', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'knowledge-cache.jsonl');

// ===== 知识缓存引擎 =====
export class KnowledgeCache {
  private cache: Map<string, CacheEntry>;
  private dirty = false;

  constructor() {
    this.cache = new Map();
    this.load();
  }

  /**
   * 生成任务 hash
   */
  private hashTask(query: string): string {
    return createHash('sha256').update(query.trim().toLowerCase()).digest('hex').slice(0, 16);
  }

  /**
   * 查询缓存：给定 query，返回最佳模板
   */
  query(query: string): CacheQueryResult {
    const hash = this.hashTask(query);
    const entry = this.cache.get(hash);

    if (entry) {
      entry.hitCount += 1;
      entry.lastUsedAt = new Date().toISOString();
      this.dirty = true;
      return { found: true, entry };
    }

    return { found: false };
  }

  /**
   * 按关键词模糊查询
   */
  queryByPersona(persona: string): CacheEntry[] {
    return Array.from(this.cache.values())
      .filter(e => e.persona === persona)
      .sort((a, b) => b.avgScore - a.avgScore);
  }

  /**
   * 写入/更新缓存
   */
  upsert(query: string, templateId: string, score: number, persona: string): CacheEntry {
    const hash = this.hashTask(query);
    const existing = this.cache.get(hash);

    if (existing) {
      existing.totalScore += score;
      existing.hitCount += 1;
      existing.avgScore = existing.totalScore / existing.hitCount;
      existing.templateId = templateId;
      existing.lastUsedAt = new Date().toISOString();
      existing.persona = persona;
      this.dirty = true;
      return existing;
    }

    const entry: CacheEntry = {
      taskHash: hash,
      templateId,
      totalScore: score,
      hitCount: 1,
      avgScore: score,
      lastUsedAt: new Date().toISOString(),
      persona,
    };
    this.cache.set(hash, entry);
    this.dirty = true;
    return entry;
  }

  /**
   * 记录评分反馈（更新已有条目的评分）
   */
  recordScore(query: string, score: number): void {
    const hash = this.hashTask(query);
    const entry = this.cache.get(hash);
    if (entry) {
      entry.totalScore += score;
      entry.hitCount += 1;
      entry.avgScore = entry.totalScore / entry.hitCount;
      entry.lastUsedAt = new Date().toISOString();
      this.dirty = true;
    }
  }

  /**
   * 淘汰低分条目（avgScore < threshold 且 hitCount >= minHits）
   */
  evictLowScore(threshold: number = 2, minHits: number = 5): number {
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (entry.avgScore < threshold && entry.hitCount >= minHits) {
        this.cache.delete(key);
        evicted++;
        this.dirty = true;
      }
    }
    return evicted;
  }

  /**
   * 获取统计信息
   */
  getStats(): CacheStats {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((s, e) => s + e.hitCount, 0);
    const totalScore = entries.reduce((s, e) => s + e.totalScore, 0);
    const hitCount = entries.reduce((s, e) => s + e.hitCount, 0);

    // 按模板聚合
    const byTemplate = new Map<string, { hitCount: number; totalScore: number }>();
    for (const e of entries) {
      const existing = byTemplate.get(e.templateId);
      if (existing) {
        existing.hitCount += e.hitCount;
        existing.totalScore += e.totalScore;
      } else {
        byTemplate.set(e.templateId, { hitCount: e.hitCount, totalScore: e.totalScore });
      }
    }

    const topTemplates = Array.from(byTemplate.entries())
      .map(([templateId, data]) => ({
        templateId,
        hitCount: data.hitCount,
        avgScore: data.hitCount > 0 ? data.totalScore / data.hitCount : 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 10);

    return {
      totalEntries: entries.length,
      totalHits,
      avgScore: hitCount > 0 ? totalScore / hitCount : 0,
      topTemplates,
    };
  }

  /**
   * 列出所有缓存条目
   */
  list(): CacheEntry[] {
    return Array.from(this.cache.values());
  }

  /**
   * 持久化到磁盘
   */
  flush(): void {
    if (!this.dirty) return;

    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      const lines = Array.from(this.cache.values())
        .map(e => JSON.stringify(e))
        .join('\n');
      fs.writeFileSync(CACHE_FILE, lines + '\n', 'utf-8');
      this.dirty = false;
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /**
   * 从磁盘加载
   */
  private load(): void {
    try {
      if (!fs.existsSync(CACHE_FILE)) return;
      const content = fs.readFileSync(CACHE_FILE, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry: CacheEntry = JSON.parse(trimmed);
          this.cache.set(entry.taskHash, entry);
        } catch {
          // 跳过损坏的行
        }
      }
    } catch {
      // 静默失败
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.dirty = true;
  }
}

// ===== 单例导出 =====
let _cache: KnowledgeCache | null = null;

export function getKnowledgeCache(): KnowledgeCache {
  if (!_cache) {
    _cache = new KnowledgeCache();
  }
  return _cache;
}
