/**
 * Session Manager - LRU + 定时清理
 * ----------------------------------------------------
 * 解决 sessions Map 无限增长问题
 * - LRU 淘汰: 超过 maxCapacity 淘汰最久未使用
 * - TTL 清理:   超过 ttl 毫秒未访问自动清理
 * - 定时任务:   每 intervalMs 扫描过期 session
 */

import type { AgentAILoop } from './agentai-loop.js';

interface SessionMeta {
  loop: AgentAILoop;
  lastAccessedAt: number;
  createdAt: number;
  userId: string;
  workspace: string;
  /** 总调用次数, 用于清理低使用频率 */
  callCount: number;
}

export interface SessionManagerOptions {
  maxCapacity?: number;
  ttlMs?: number;
  cleanupIntervalMs?: number;
}

const DEFAULT_MAX_CAPACITY = 200;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分钟
const DEFAULT_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 分钟

export class SessionManager {
  private map = new Map<string, SessionMeta>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private capacity: number;
  private ttl: number;
  private interval: number;

  constructor(opts: SessionManagerOptions = {}) {
    this.capacity = opts.maxCapacity ?? DEFAULT_MAX_CAPACITY;
    this.ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.interval = opts.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL;

    // 启动清理定时器
    this.startCleanup();
  }

  /**
   * 获取或创建 session
   * 使用 LRU 策略: 访问时移到 Map 末尾 (最久未用在前)
   */
  getOrCreate(
    key: string,
    factory: () => { loop: AgentAILoop; userId: string; workspace: string },
  ): AgentAILoop {
    const existing = this.map.get(key);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      existing.callCount++;
      // 重新插入到 Map 末尾 (LRU 语义)
      this.map.delete(key);
      this.map.set(key, existing);
      return existing.loop;
    }

    // 容量检查
    if (this.map.size >= this.capacity) {
      this.evictLeastRecentlyUsed();
    }

    // 创建新 session
    const { loop, userId, workspace } = factory();
    const meta: SessionMeta = {
      loop,
      lastAccessedAt: Date.now(),
      createdAt: Date.now(),
      userId,
      workspace,
      callCount: 1,
    };
    this.map.set(key, meta);
    return loop;
  }

  /**
   * 直接获取 (不创建)
   */
  get(key: string): AgentAILoop | undefined {
    const meta = this.map.get(key);
    if (!meta) return undefined;
    meta.lastAccessedAt = Date.now();
    this.map.delete(key);
    this.map.set(key, meta);
    return meta.loop;
  }

  /**
   * 删除指定 session
   */
  delete(key: string): boolean {
    return this.map.delete(key);
  }

  /**
   * 清空所有
   */
  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  /**
   * 获取统计信息
   */
  stats(): {
    size: number;
    capacity: number;
    ttlMs: number;
    oldestAgeMs: number;
    totalCalls: number;
  } {
    let oldest = Date.now();
    let totalCalls = 0;
    for (const m of this.map.values()) {
      if (m.createdAt < oldest) oldest = m.createdAt;
      totalCalls += m.callCount;
    }
    return {
      size: this.map.size,
      capacity: this.capacity,
      ttlMs: this.ttl,
      oldestAgeMs: this.map.size > 0 ? Date.now() - oldest : 0,
      totalCalls,
    };
  }

  /**
   * 淘汰最久未用
   */
  private evictLeastRecentlyUsed(): void {
    // Map 迭代顺序 = 插入顺序, 第一个就是最久未用
    const firstKey = this.map.keys().next().value;
    if (firstKey) {
      this.map.delete(firstKey);
    }
  }

  /**
   * 清理过期 session
   */
  private cleanupExpired(): number {
    const now = Date.now();
    let deleted = 0;
    for (const [key, meta] of this.map.entries()) {
      if (now - meta.lastAccessedAt > this.ttl) {
        this.map.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanupExpired();
      if (removed > 0) {
        console.log(`[session-mgr] 清理 ${removed} 个过期 session, 剩余 ${this.map.size}`);
      }
    }, this.interval);
    // 防止 unref 错误: 不阻止进程退出
    this.cleanupTimer.unref?.();
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

/** 全局单例 */
let _instance: SessionManager | null = null;
export function getSessionManager(): SessionManager {
  if (!_instance) {
    _instance = new SessionManager();
  }
  return _instance;
}

export function resetSessionManager(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}
