/**
 * 用量统计收集器
 * ==============
 * 记录每次工具调用的成功/失败/耗时，生成日报/周报
 *
 * 存储: .agentai/usage-stats.json
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ToolCallEntry {
  timestamp: number;
  tool: string;
  success: boolean;
  durationMs: number;
  userId?: string;
  /** 工具操作的额外元数据 */
  meta?: Record<string, any>;
}

export interface DailyStats {
  date: string;
  totalCalls: number;
  successCount: number;
  failCount: number;
  totalDurationMs: number;
  topTools: Array<{ tool: string; count: number }>;
  /** 估算时间节省 (分钟) — 假设每次成功工具调用平均节省 2 分钟 */
  estimatedTimeSavedMin: number;
}

interface UsageStore {
  entries: ToolCallEntry[];
  lastTrim?: number;
}

const STATS_FILE = '.agentai/usage-stats.json';
const MAX_ENTRIES = 10000;

function getStatsPath(workspace: string): string {
  return path.join(workspace, STATS_FILE);
}

function readStore(workspace: string): UsageStore {
  try {
    const p = getStatsPath(workspace);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch {}
  return { entries: [] };
}

function writeStore(workspace: string, store: UsageStore): void {
  const p = getStatsPath(workspace);
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store), 'utf-8');
}

/** 记录一次工具调用 */
export function recordCall(workspace: string, entry: ToolCallEntry): void {
  const store = readStore(workspace);
  store.entries.push(entry);
  // 定期裁剪
  if (store.entries.length > MAX_ENTRIES + 1000) {
    store.entries = store.entries.slice(-MAX_ENTRIES);
    store.lastTrim = Date.now();
  }
  writeStore(workspace, store);
}

/** 计算日报 */
export function getDailyStats(workspace: string, date?: string): DailyStats {
  const today = date || new Date().toISOString().slice(0, 10);
  const store = readStore(workspace);
  const entries = store.entries.filter(e => {
    const d = new Date(e.timestamp).toISOString().slice(0, 10);
    return d === today;
  });

  const toolCounts: Record<string, number> = {};
  let successCount = 0;
  let failCount = 0;
  let totalDuration = 0;

  for (const e of entries) {
    if (e.success) successCount++;
    else failCount++;
    totalDuration += e.durationMs;
    toolCounts[e.tool] = (toolCounts[e.tool] || 0) + 1;
  }

  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));

  // 估算: 每次成功的工具调用 ≈ 2 分钟人力
  const estimatedTimeSavedMin = Math.round(successCount * 2 * 10) / 10;

  return {
    date: today,
    totalCalls: entries.length,
    successCount,
    failCount,
    totalDurationMs: totalDuration,
    topTools,
    estimatedTimeSavedMin,
  };
}

/** 计算周报 */
export function getWeeklyStats(workspace: string): {
  days: DailyStats[];
  totals: { calls: number; success: number; fail: number; timeSaved: number };
  topTools: Array<{ tool: string; count: number }>;
  trend: 'up' | 'down' | 'stable';
} {
  const days: DailyStats[] = [];
  const now = new Date();
  let totalCalls = 0, totalSuccess = 0, totalFail = 0, totalTimeSaved = 0;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const stats = getDailyStats(workspace, dateStr);
    days.push(stats);
    totalCalls += stats.totalCalls;
    totalSuccess += stats.successCount;
    totalFail += stats.failCount;
    totalTimeSaved += stats.estimatedTimeSavedMin;
  }

  // 汇总 top tools
  const toolMap: Record<string, number> = {};
  for (const d of days) {
    for (const t of d.topTools) {
      toolMap[t.tool] = (toolMap[t.tool] || 0) + t.count;
    }
  }
  const topTools = Object.entries(toolMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));

  // 趋势: 比较前3天和后3天
  const first3 = days.slice(0, 3).reduce((s, d) => s + d.totalCalls, 0);
  const last3 = days.slice(3, 7).reduce((s, d) => s + d.totalCalls, 0);
  const trend = last3 > first3 * 1.2 ? 'up' : last3 < first3 * 0.8 ? 'down' : 'stable';

  return {
    days,
    totals: { calls: totalCalls, success: totalSuccess, fail: totalFail, timeSaved: Math.round(totalTimeSaved * 10) / 10 },
    topTools,
    trend,
  };
}

/** 获取成功率 */
export function getSuccessRate(workspace: string, days = 7): number {
  const cutoff = Date.now() - days * 86400000;
  const store = readStore(workspace);
  const recent = store.entries.filter(e => e.timestamp > cutoff);
  if (recent.length === 0) return 100;
  const success = recent.filter(e => e.success).length;
  return Math.round(success / recent.length * 100);
}
