/**
 * Execution History - 任务执行历史记录
 * 
 * 解决任务执行无记录的问题：
 * 1. 记录每次任务执行详情
 * 2. 支持查询执行历史
 * 3. 统计执行成功率
 * 4. 失败任务重试追踪
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface ExecutionRecord {
  id: string;
  scheduleId: string;
  scheduleName: string;
  scheduleType: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  output?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  retryCount: number;
  triggeredBy: 'cron' | 'manual' | 'retry';
  sessionId?: string; // AI 任务创建的会话 ID
}

export interface ExecutionStats {
  total: number;
  success: number;
  failed: number;
  timeout: number;
  successRate: number;
  avgDurationMs: number;
}

export interface ExecutionQuery {
  scheduleId?: string;
  status?: ExecutionRecord['status'];
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

// ═══════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════

const HISTORY_DIR = path.join(os.homedir(), '.agentai', 'history');
const HISTORY_FILE = path.join(HISTORY_DIR, 'execution-history.jsonl');
const MAX_HISTORY = 10000; // 最多保留1万条记录

// ═══════════════════════════════════════════════════════════
// 执行历史管理器
// ═══════════════════════════════════════════════════════════

export class ExecutionHistory {
  private records: ExecutionRecord[] = [];
  private dirty = false;

  constructor() {
    this.load();
  }

  /**
   * 记录执行开始
   */
  recordStart(
    scheduleId: string,
    scheduleName: string,
    scheduleType: string,
    triggeredBy: ExecutionRecord['triggeredBy'] = 'cron'
  ): string {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const record: ExecutionRecord = {
      id,
      scheduleId,
      scheduleName,
      scheduleType,
      status: 'running',
      startedAt: Date.now(),
      retryCount: 0,
      triggeredBy,
    };

    this.records.push(record);
    this.dirty = true;
    
    // 限制数量
    if (this.records.length > MAX_HISTORY) {
      this.records = this.records.slice(-MAX_HISTORY);
    }

    console.log(`[ExecutionHistory] 开始执行: ${scheduleName} (${id})`);
    return id;
  }

  /**
   * 记录执行完成
   */
  recordComplete(
    executionId: string,
    status: ExecutionRecord['status'],
    output?: string,
    error?: string,
    sessionId?: string
  ): void {
    const record = this.records.find(r => r.id === executionId);
    if (!record) {
      console.warn(`[ExecutionHistory] 未找到执行记录: ${executionId}`);
      return;
    }

    record.status = status;
    record.completedAt = Date.now();
    record.durationMs = record.completedAt - record.startedAt;
    
    if (output) {
      record.output = output.slice(0, 10000); // 限制长度
    }
    if (error) {
      record.error = error.slice(0, 5000); // 限制长度
    }
    if (sessionId) {
      record.sessionId = sessionId;
    }

    this.dirty = true;
    this.save();

    console.log(`[ExecutionHistory] 执行完成: ${record.scheduleName} (${status}, ${record.durationMs}ms)`);
  }

  /**
   * 记录重试
   */
  recordRetry(executionId: string): void {
    const record = this.records.find(r => r.id === executionId);
    if (record) {
      record.retryCount++;
      this.dirty = true;
    }
  }

  /**
   * 查询执行历史
   */
  query(query: ExecutionQuery = {}): ExecutionRecord[] {
    let results = [...this.records];

    if (query.scheduleId) {
      results = results.filter(r => r.scheduleId === query.scheduleId);
    }

    if (query.status) {
      results = results.filter(r => r.status === query.status);
    }

    if (query.startTime) {
      results = results.filter(r => r.startedAt >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter(r => r.startedAt <= query.endTime!);
    }

    // 按时间倒序
    results.sort((a, b) => b.startedAt - a.startedAt);

    // 分页
    const offset = query.offset || 0;
    const limit = query.limit || 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * 获取执行统计
   */
  getStats(scheduleId?: string): ExecutionStats {
    let records = this.records;
    if (scheduleId) {
      records = records.filter(r => r.scheduleId === scheduleId);
    }

    const completed = records.filter(r => r.status !== 'running');
    const success = completed.filter(r => r.status === 'success');
    const failed = completed.filter(r => r.status === 'failed');
    const timeout = completed.filter(r => r.status === 'timeout');

    const totalDuration = completed
      .filter(r => r.durationMs)
      .reduce((sum, r) => sum + r.durationMs!, 0);

    return {
      total: completed.length,
      success: success.length,
      failed: failed.length,
      timeout: timeout.length,
      successRate: completed.length > 0 ? success.length / completed.length : 0,
      avgDurationMs: completed.length > 0 ? totalDuration / completed.length : 0,
    };
  }

  /**
   * 获取最近失败的任务
   */
  getRecentFailures(limit: number = 10): ExecutionRecord[] {
    return this.records
      .filter(r => r.status === 'failed')
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * 获取任务成功率趋势
   */
  getSuccessTrend(days: number = 7): Array<{ date: string; successRate: number }> {
    const result: Array<{ date: string; successRate: number }> = [];
    const now = Date.now();

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;

      const dayRecords = this.records.filter(
        r => r.startedAt >= dayStart && r.startedAt < dayEnd && r.status !== 'running'
      );

      const successCount = dayRecords.filter(r => r.status === 'success').length;
      const successRate = dayRecords.length > 0 ? successCount / dayRecords.length : 0;

      result.push({
        date: new Date(dayStart).toISOString().split('T')[0],
        successRate,
      });
    }

    return result;
  }

  /**
   * 清理旧记录
   */
  cleanup(keepDays: number = 30): number {
    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const beforeCount = this.records.length;
    
    this.records = this.records.filter(r => r.startedAt >= cutoff);
    
    const deleted = beforeCount - this.records.length;
    if (deleted > 0) {
      this.dirty = true;
      this.save();
      console.log(`[ExecutionHistory] 清理 ${deleted} 条旧记录`);
    }
    
    return deleted;
  }

  // ═══════════════════════════════════════════════════════════
  // 持久化
  // ═══════════════════════════════════════════════════════════

  private load(): void {
    try {
      if (!fs.existsSync(HISTORY_FILE)) {
        return;
      }

      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());
      
      this.records = lines.map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      }).filter(Boolean);

      console.log(`[ExecutionHistory] 加载 ${this.records.length} 条记录`);
    } catch (e: any) {
      console.error('[ExecutionHistory] 加载失败:', e.message);
    }
  }

  private save(): void {
    if (!this.dirty) return;

    try {
      fs.mkdirSync(HISTORY_DIR, { recursive: true });
      
      const lines = this.records.map(r => JSON.stringify(r)).join('\n');
      fs.writeFileSync(HISTORY_FILE, lines + '\n', 'utf-8');
      
      this.dirty = false;
    } catch (e: any) {
      console.error('[ExecutionHistory] 保存失败:', e.message);
    }
  }

  /**
   * 强制保存
   */
  flush(): void {
    this.save();
  }
}

// 单例导出
export const executionHistory = new ExecutionHistory();
