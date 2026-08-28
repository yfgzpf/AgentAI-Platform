/**
 * 工具使用率统计模块
 * 【P0-2: 工具使用率统计 + 死工具清理】
 *
 * 通过 ToolRegistry 的拦截器机制记录每次工具调用
 * 7 天未被调用的工具自动降级为"按需加载"
 *
 * 使用方式: 在 tools.ts 中 import { toolUsageStats } 并调用 .attach(registry)
 */

import * as fs from 'fs';
import * as path from 'path';

/** 单条工具使用记录 */
export interface ToolUsageRecord {
  toolName: string;
  callCount: number;
  successCount: number;
  failCount: number;
  lastCalled: number;     // timestamp
  firstCalled: number;    // timestamp
  totalDurationMs: number;
}

/** 统计持久化格式 */
interface ToolUsageData {
  records: Record<string, ToolUsageRecord>;
  version: number;
}

const DATA_VERSION = 1;
const STALE_DAYS = 7;           // 7 天未调用 = 死工具
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

class ToolUsageStats {
  private records = new Map<string, ToolUsageRecord>();
  private dataDir: string;
  private filePath: string;
  private _loaded = false;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const dataDir = process.env.AGENTAI_DATA_DIR || path.join(process.cwd(), '.agentai');
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, 'tool-usage-stats.json');
  }

  /** 加载持久化数据 */
  load(): void {
    if (this._loaded) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data: ToolUsageData = JSON.parse(raw);
        if (data.version === DATA_VERSION && data.records) {
          for (const [name, record] of Object.entries(data.records)) {
            this.records.set(name, record);
          }
        }
      }
    } catch (e) {
      console.warn('[tool-usage-stats] 加载失败，使用空记录:', (e as Error).message);
    }
    this._loaded = true;
  }

  /** 持久化到磁盘 */
  save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const data: ToolUsageData = {
        version: DATA_VERSION,
        records: Object.fromEntries(this.records),
      };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[tool-usage-stats] 持久化失败:', (e as Error).message);
    }
  }

  /** 记录一次工具调用结果 */
  record(name: string, success: boolean, durationMs: number): void {
    this.load();
    const now = Date.now();
    let record = this.records.get(name);
    if (!record) {
      record = {
        toolName: name,
        callCount: 0,
        successCount: 0,
        failCount: 0,
        lastCalled: now,
        firstCalled: now,
        totalDurationMs: 0,
      };
      this.records.set(name, record);
    }
    record.callCount++;
    if (success) record.successCount++;
    else record.failCount++;
    record.lastCalled = now;
    record.totalDurationMs += durationMs;
    this.scheduleFlush();
  }

  /** 防抖持久化 */
  private scheduleFlush(): void {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => {
      this.save();
      this._flushTimer = null;
    }, 5000);
  }

  /** 获取所有工具使用统计 */
  getAllStats(): ToolUsageRecord[] {
    this.load();
    return [...this.records.values()].sort((a, b) => b.callCount - a.callCount);
  }

  /** 获取死工具列表（7 天未调用） */
  getStaleTools(): ToolUsageRecord[] {
    this.load();
    const now = Date.now();
    return [...this.records.values()]
      .filter(r => (now - r.lastCalled) > STALE_MS)
      .sort((a, b) => a.lastCalled - b.lastCalled);
  }

  /** 获取从未被调用的工具（有记录但 callCount = 0） */
  getUnusedTools(): ToolUsageRecord[] {
    this.load();
    return [...this.records.values()].filter(r => r.callCount === 0);
  }

  /** 获取活跃工具列表（7 天内有调用） */
  getActiveToolNames(): Set<string> {
    this.load();
    const now = Date.now();
    const active = new Set<string>();
    for (const [name, record] of this.records) {
      if ((now - record.lastCalled) <= STALE_MS) {
        active.add(name);
      }
    }
    return active;
  }

  /**
   * 返回活跃工具名称集合
   * 如果从未记录过任何工具使用，返回 null（表示全量加载）
   */
  getActiveToolNamesOrNull(): Set<string> | null {
    this.load();
    if (this.records.size === 0) return null;
    return this.getActiveToolNames();
  }

  /** 清理死工具记录 */
  cleanupStale(): number {
    this.load();
    const stale = this.getStaleTools();
    for (const r of stale) {
      this.records.delete(r.toolName);
    }
    if (stale.length > 0) this.save();
    return stale.length;
  }

  /** 获取统计摘要 */
  getSummary(): string {
    this.load();
    const total = this.records.size;
    const active = this.getActiveToolNames().size;
    const stale = this.getStaleTools().length;
    const totalCalls = [...this.records.values()].reduce((s, r) => s + r.callCount, 0);
    return `工具统计: 总计 ${total} 工具, 活跃 ${active}, 死工具 ${stale}, 总调用 ${totalCalls} 次`;
  }
}

/** 单例 */
export const toolUsageStats = new ToolUsageStats();

/**
 * 获取工具使用率统计的拦截器函数
 * 用法: registry.addInterceptor('tool-usage-stats', toolUsageInterceptor)
 */
export function toolUsageInterceptor(
  name: string,
  _args: Record<string, any>,
  _ctx: any,
): null | undefined {
  // 拦截器只负责记录，不拒绝任何调用
  // 实际的记录在 executeOne 完成后通过 record() 方法进行
  return null;
}

/**
 * 包装 executeOne 的原始结果，在完成后记录统计
 * 在 tool-registry.ts 中执行完后调用
 */
export function recordToolCall(name: string, success: boolean, durationMs: number): void {
  toolUsageStats.record(name, success, durationMs);
}