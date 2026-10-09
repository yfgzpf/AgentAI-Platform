/**
 * ModelMetricsService - 模型性能指标收集服务
 * =============================================
 * 零侵入设计：只记录，不影响主业务流程
 * 异步写入：不阻塞模型响应
 * 自动清理：防止内存无限增长
 * 持久化存储：集成 SQLite 存储历史数据
 */
import { EventEmitter } from 'events';
import { modelMetricsPersistent } from './model-metrics-persistent.js';
class ModelMetricsService extends EventEmitter {
    records = [];
    maxRecords = 10000;
    usePersistent = true;
    constructor() {
        super();
        // 每小时清理一次旧数据
        setInterval(() => {
            this.cleanupOldRecords();
            if (this.usePersistent) {
                modelMetricsPersistent.cleanup(90); // 保留90天
            }
        }, 60 * 60 * 1000);
    }
    /**
     * 开始一次调用
     */
    startCall(modelId, provider, sessionId) {
        const startTime = Date.now();
        let firstTokenTime = null;
        return {
            markFirstToken: () => {
                if (firstTokenTime === null) {
                    firstTokenTime = Date.now();
                }
            },
            finish: (data) => {
                const endTime = Date.now();
                const record = {
                    modelId,
                    provider,
                    timestamp: startTime,
                    ttft: firstTokenTime ? firstTokenTime - startTime : endTime - startTime,
                    totalLatency: endTime - startTime,
                    inputTokens: data.inputTokens,
                    outputTokens: data.outputTokens,
                    totalTokens: data.inputTokens + data.outputTokens,
                    cost: data.cost,
                    success: data.success,
                    cacheHit: data.cacheHit,
                    errorType: data.errorType,
                    sessionId,
                };
                this.record(record);
            },
        };
    }
    /**
     * 记录一次调用
     */
    record(record) {
        try {
            // 内存存储
            this.records.push(record);
            this.emit('record', record);
            // 持久化存储
            if (this.usePersistent) {
                modelMetricsPersistent.saveRecord(record);
            }
            // 防止内存无限增长
            if (this.records.length > this.maxRecords) {
                this.cleanupOldRecords();
            }
        }
        catch (e) {
            console.error('[ModelMetrics] record error:', e);
        }
    }
    /**
     * 清理旧记录
     */
    cleanupOldRecords() {
        if (this.records.length > this.maxRecords * 0.8) {
            this.records = this.records.slice(-this.maxRecords * 0.8);
        }
    }
    /**
     * 获取所有模型统计
     */
    getAllStats() {
        // 优先从持久化存储获取（包含历史数据）
        if (this.usePersistent) {
            try {
                return modelMetricsPersistent.getAllStats(7); // 最近7天
            }
            catch (e) {
                console.error('[ModelMetrics] 从持久化获取统计失败:', e);
            }
        }
        // 回退到内存统计
        return this.getAllStatsFromMemory();
    }
    /**
     * 从内存获取统计
     */
    getAllStatsFromMemory() {
        try {
            const groups = new Map();
            for (const r of this.records) {
                const list = groups.get(r.modelId) || [];
                list.push(r);
                groups.set(r.modelId, list);
            }
            return Array.from(groups.entries()).map(([modelId, records]) => {
                const total = records.length;
                const success = records.filter(r => r.success).length;
                const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
                const cacheHits = records.filter(r => r.cacheHit).length;
                return {
                    modelId,
                    provider: records[0]?.provider || 'unknown',
                    totalCalls: total,
                    successCalls: success,
                    failedCalls: total - success,
                    avgTTFT: records.reduce((sum, r) => sum + r.ttft, 0) / total,
                    avgLatency: records.reduce((sum, r) => sum + r.totalLatency, 0) / total,
                    avgCost: totalCost / total,
                    totalCost,
                    successRate: success / total,
                    cacheHitRate: cacheHits / total,
                    lastCallAt: Math.max(...records.map(r => r.timestamp)),
                };
            });
        }
        catch (e) {
            console.error('[ModelMetrics] getAllStats error:', e);
            return [];
        }
    }
    /**
     * 获取单个模型统计
     */
    getStats(modelId) {
        // 优先从持久化存储获取
        if (this.usePersistent) {
            try {
                return modelMetricsPersistent.getStats(modelId, 7);
            }
            catch (e) {
                console.error('[ModelMetrics] 从持久化获取单模型统计失败:', e);
            }
        }
        // 回退到内存
        const all = this.getAllStatsFromMemory();
        return all.find(s => s.modelId === modelId) || null;
    }
    /**
     * 获取最近N条记录
     */
    getRecentRecords(limit = 100) {
        // 优先从持久化存储获取
        if (this.usePersistent) {
            try {
                return modelMetricsPersistent.getRecentRecords(limit);
            }
            catch (e) {
                console.error('[ModelMetrics] 从持久化获取最近记录失败:', e);
            }
        }
        // 回退到内存
        return this.records.slice(-limit);
    }
    /**
     * 获取每日统计
     */
    getDailyStats(days = 30) {
        if (this.usePersistent) {
            try {
                return modelMetricsPersistent.getDailyStats(days);
            }
            catch (e) {
                console.error('[ModelMetrics] 获取每日统计失败:', e);
            }
        }
        return [];
    }
    /**
     * 导出数据为CSV
     */
    exportToCSV(startDate, endDate) {
        if (this.usePersistent) {
            return modelMetricsPersistent.exportToCSV(startDate, endDate);
        }
        return '';
    }
    /**
     * 清空数据
     */
    clear() {
        this.records = [];
        this.emit('clear');
    }
    /**
     * 设置是否使用持久化存储
     */
    setUsePersistent(use) {
        this.usePersistent = use;
    }
}
// 单例导出
export const modelMetrics = new ModelMetricsService();
