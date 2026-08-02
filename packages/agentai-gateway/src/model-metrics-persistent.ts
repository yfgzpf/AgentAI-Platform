/**
 * ModelMetricsPersistent - 模型性能指标持久化存储
 * ================================================
 * 使用 SQLite 存储指标数据，支持历史查询和数据分析
 */

import type { ModelCallRecord, ModelStats } from './model-metrics-service.js';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as pathModule from 'path';

// 使用 createRequire 在 ES Module 中加载 CommonJS 模块
const require = createRequire(import.meta.url);
const DatabaseConstructor = (require('better-sqlite3') as any) as any;

// 最小化 better-sqlite3 类型声明（仅覆盖本文件用到的 API）
interface Database {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  close(): void;
}
interface Statement {
  run(...params: any[]): { changes: number };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export class ModelMetricsPersistent {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './data/model-metrics.db') {
    this.dbPath = dbPath;
    this.init();
  }

  private init(): void {
    try {
      // 确保目录存在
      const dir = pathModule.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 初始化数据库
      this.db = new DatabaseConstructor(this.dbPath) as unknown as Database;
      this.createTables();
      console.log('[ModelMetricsPersistent] 数据库初始化成功:', this.dbPath);
    } catch (e) {
      console.error('[ModelMetricsPersistent] 初始化失败:', e);
    }
  }

  private createTables(): void {
    if (!this.db) return;

    // 创建调用记录表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        ttft INTEGER NOT NULL,
        total_latency INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        cost REAL NOT NULL,
        success INTEGER NOT NULL,
        cache_hit INTEGER,
        error_type TEXT,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_model_calls_model_id ON model_calls(model_id);
      CREATE INDEX IF NOT EXISTS idx_model_calls_timestamp ON model_calls(timestamp);
      CREATE INDEX IF NOT EXISTS idx_model_calls_provider ON model_calls(provider);
    `);

    // 创建每日统计表（用于快速查询）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        model_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        total_calls INTEGER NOT NULL DEFAULT 0,
        success_calls INTEGER NOT NULL DEFAULT 0,
        failed_calls INTEGER NOT NULL DEFAULT 0,
        avg_ttft REAL,
        avg_latency REAL,
        avg_cost REAL,
        total_cost REAL NOT NULL DEFAULT 0,
        total_input_tokens INTEGER NOT NULL DEFAULT 0,
        total_output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_hits INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, model_id)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
      CREATE INDEX IF NOT EXISTS idx_daily_stats_model ON daily_stats(model_id);
    `);
  }

  /**
   * 保存调用记录
   */
  public saveRecord(record: ModelCallRecord): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO model_calls 
        (model_id, provider, timestamp, ttft, total_latency, input_tokens, output_tokens, total_tokens, cost, success, cache_hit, error_type, session_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.modelId,
        record.provider,
        record.timestamp,
        record.ttft,
        record.totalLatency,
        record.inputTokens,
        record.outputTokens,
        record.totalTokens,
        record.cost,
        record.success ? 1 : 0,
        record.cacheHit ? 1 : 0,
        record.errorType || null,
        record.sessionId || null
      );

      // 更新每日统计
      this.updateDailyStats(record);
    } catch (e) {
      console.error('[ModelMetricsPersistent] 保存记录失败:', e);
    }
  }

  /**
   * 更新每日统计
   */
  private updateDailyStats(record: ModelCallRecord): void {
    if (!this.db) return;

    const date = new Date(record.timestamp).toISOString().split('T')[0];

    try {
      // 检查是否已有记录
      const existing = this.db.prepare(
        'SELECT * FROM daily_stats WHERE date = ? AND model_id = ?'
      ).get(date, record.modelId);

      if (existing) {
        // 更新记录
        this.db.prepare(`
          UPDATE daily_stats SET
            total_calls = total_calls + 1,
            success_calls = success_calls + ?,
            failed_calls = failed_calls + ?,
            total_cost = total_cost + ?,
            total_input_tokens = total_input_tokens + ?,
            total_output_tokens = total_output_tokens + ?,
            cache_hits = cache_hits + ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE date = ? AND model_id = ?
        `).run(
          record.success ? 1 : 0,
          record.success ? 0 : 1,
          record.cost,
          record.inputTokens,
          record.outputTokens,
          record.cacheHit ? 1 : 0,
          date,
          record.modelId
        );
      } else {
        // 插入新记录
        this.db.prepare(`
          INSERT INTO daily_stats 
          (date, model_id, provider, total_calls, success_calls, failed_calls, total_cost, total_input_tokens, total_output_tokens, cache_hits)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
        `).run(
          date,
          record.modelId,
          record.provider,
          record.success ? 1 : 0,
          record.success ? 0 : 1,
          record.cost,
          record.inputTokens,
          record.outputTokens,
          record.cacheHit ? 1 : 0
        );
      }
    } catch (e) {
      console.error('[ModelMetricsPersistent] 更新每日统计失败:', e);
    }
  }

  /**
   * 获取所有模型统计
   */
  public getAllStats(days: number = 7): ModelStats[] {
    if (!this.db) return [];

    try {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      
      const rows = this.db.prepare(`
        SELECT 
          model_id,
          provider,
          COUNT(*) as total_calls,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_calls,
          AVG(ttft) as avg_ttft,
          AVG(total_latency) as avg_latency,
          AVG(cost) as avg_cost,
          SUM(cost) as total_cost,
          AVG(input_tokens) as avg_input_tokens,
          AVG(output_tokens) as avg_output_tokens,
          SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
          MAX(timestamp) as last_call_at
        FROM model_calls
        WHERE timestamp > ?
        GROUP BY model_id, provider
        ORDER BY total_calls DESC
      `).all(since);

      return rows.map((row: any) => ({
        modelId: row.model_id,
        provider: row.provider,
        totalCalls: row.total_calls,
        successCalls: row.success_calls,
        failedCalls: row.failed_calls,
        avgTTFT: row.avg_ttft || 0,
        avgLatency: row.avg_latency || 0,
        avgCost: row.avg_cost || 0,
        totalCost: row.total_cost || 0,
        successRate: row.total_calls > 0 ? row.success_calls / row.total_calls : 0,
        cacheHitRate: row.total_calls > 0 ? row.cache_hits / row.total_calls : 0,
        lastCallAt: row.last_call_at,
      }));
    } catch (e) {
      console.error('[ModelMetricsPersistent] 获取统计失败:', e);
      return [];
    }
  }

  /**
   * 获取单个模型统计
   */
  public getStats(modelId: string, days: number = 7): ModelStats | null {
    if (!this.db) return null;

    try {
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      
      const row = this.db.prepare(`
        SELECT 
          model_id,
          provider,
          COUNT(*) as total_calls,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_calls,
          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_calls,
          AVG(ttft) as avg_ttft,
          AVG(total_latency) as avg_latency,
          AVG(cost) as avg_cost,
          SUM(cost) as total_cost,
          SUM(CASE WHEN cache_hit = 1 THEN 1 ELSE 0 END) as cache_hits,
          MAX(timestamp) as last_call_at
        FROM model_calls
        WHERE model_id = ? AND timestamp > ?
        GROUP BY model_id, provider
      `).get(modelId, since);

      if (!row) return null;

      return {
        modelId: row.model_id,
        provider: row.provider,
        totalCalls: row.total_calls,
        successCalls: row.success_calls,
        failedCalls: row.failed_calls,
        avgTTFT: row.avg_ttft || 0,
        avgLatency: row.avg_latency || 0,
        avgCost: row.avg_cost || 0,
        totalCost: row.total_cost || 0,
        successRate: row.total_calls > 0 ? row.success_calls / row.total_calls : 0,
        cacheHitRate: row.total_calls > 0 ? row.cache_hits / row.total_calls : 0,
        lastCallAt: row.last_call_at,
      };
    } catch (e) {
      console.error('[ModelMetricsPersistent] 获取单模型统计失败:', e);
      return null;
    }
  }

  /**
   * 获取最近记录
   */
  public getRecentRecords(limit: number = 100): ModelCallRecord[] {
    if (!this.db) return [];

    try {
      const rows = this.db.prepare(`
        SELECT * FROM model_calls
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit);

      return rows.map((row: any) => ({
        modelId: row.model_id,
        provider: row.provider,
        timestamp: row.timestamp,
        ttft: row.ttft,
        totalLatency: row.total_latency,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens,
        cost: row.cost,
        success: row.success === 1,
        cacheHit: row.cache_hit === 1,
        errorType: row.error_type,
        sessionId: row.session_id,
      }));
    } catch (e) {
      console.error('[ModelMetricsPersistent] 获取最近记录失败:', e);
      return [];
    }
  }

  /**
   * 获取每日统计
   */
  public getDailyStats(days: number = 30): any[] {
    if (!this.db) return [];

    try {
      const rows = this.db.prepare(`
        SELECT * FROM daily_stats
        WHERE date > date('now', '-${days} days')
        ORDER BY date DESC, total_calls DESC
      `).all();

      return rows;
    } catch (e) {
      console.error('[ModelMetricsPersistent] 获取每日统计失败:', e);
      return [];
    }
  }

  /**
   * 导出数据为 CSV
   */
  public exportToCSV(startDate?: string, endDate?: string): string {
    if (!this.db) return '';

    try {
      let query = 'SELECT * FROM model_calls WHERE 1=1';
      const params: any[] = [];

      if (startDate) {
        query += ' AND date(timestamp/1000, "unixepoch") >= ?';
        params.push(startDate);
      }
      if (endDate) {
        query += ' AND date(timestamp/1000, "unixepoch") <= ?';
        params.push(endDate);
      }

      query += ' ORDER BY timestamp DESC';

      const rows = this.db.prepare(query).all(...params);

      // CSV 头部
      const headers = [
        'model_id', 'provider', 'timestamp', 'ttft', 'total_latency',
        'input_tokens', 'output_tokens', 'total_tokens', 'cost',
        'success', 'cache_hit', 'error_type', 'session_id'
      ];

      // CSV 内容
      const csv = [
        headers.join(','),
        ...rows.map((row: any) => headers.map(h => row[h]).join(','))
      ].join('\n');

      return csv;
    } catch (e) {
      console.error('[ModelMetricsPersistent] 导出CSV失败:', e);
      return '';
    }
  }

  /**
   * 清理旧数据
   */
  public cleanup(daysToKeep: number = 90): void {
    if (!this.db) return;

    try {
      const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      
      const result = this.db.prepare(
        'DELETE FROM model_calls WHERE timestamp < ?'
      ).run(cutoff);

      console.log(`[ModelMetricsPersistent] 清理了 ${result.changes} 条旧记录`);
    } catch (e) {
      console.error('[ModelMetricsPersistent] 清理旧数据失败:', e);
    }
  }

  /**
   * 关闭数据库
   */
  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// 单例导出
export const modelMetricsPersistent = new ModelMetricsPersistent();
