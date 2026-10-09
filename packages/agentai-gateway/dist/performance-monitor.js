/**
 * Performance Monitor - 性能监控器
 *
 * 追踪关键性能指标：
 * - 响应时间
 * - 内存使用
 * - CPU使用率
 * - 技能执行时间
 * - 工具调用延迟
 */
import { EventEmitter } from 'events';
import * as os from 'os';
export class PerformanceMonitor extends EventEmitter {
    metrics = [];
    latencies = new Map();
    snapshots = [];
    timer = null;
    // 配置
    maxMetrics = 10000;
    maxSnapshots = 1000;
    snapshotInterval = 60000; // 1分钟
    /**
     * 启动监控
     */
    start() {
        if (this.timer)
            return;
        console.log('[PerformanceMonitor] 启动性能监控');
        // 定期采集系统指标
        this.timer = setInterval(() => {
            this.collectSnapshot();
        }, this.snapshotInterval);
        // 立即采集一次
        this.collectSnapshot();
    }
    /**
     * 停止监控
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[PerformanceMonitor] 停止性能监控');
        }
    }
    /**
     * 记录指标
     */
    record(name, value, tags) {
        this.metrics.push({
            name,
            value,
            timestamp: Date.now(),
            tags,
        });
        // 限制数量
        if (this.metrics.length > this.maxMetrics) {
            this.metrics = this.metrics.slice(-this.maxMetrics);
        }
        // 触发告警
        this.checkThresholds(name, value, tags);
    }
    /**
     * 记录延迟
     */
    recordLatency(operation, durationMs) {
        if (!this.latencies.has(operation)) {
            this.latencies.set(operation, []);
        }
        const latencies = this.latencies.get(operation);
        latencies.push(durationMs);
        // 只保留最近1000个
        if (latencies.length > 1000) {
            latencies.shift();
        }
        // 记录指标
        this.record(`latency.${operation}`, durationMs);
    }
    /**
     * 计时器包装
     */
    async measure(operation, fn, tags) {
        const start = Date.now();
        try {
            const result = await fn();
            const duration = Date.now() - start;
            this.recordLatency(operation, duration);
            return result;
        }
        catch (error) {
            const duration = Date.now() - start;
            this.recordLatency(`${operation}.error`, duration);
            throw error;
        }
    }
    /**
     * 获取延迟统计
     */
    getLatencyStats(operation) {
        const latencies = this.latencies.get(operation);
        if (!latencies || latencies.length === 0) {
            return null;
        }
        const sorted = [...latencies].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);
        return {
            count,
            min: sorted[0],
            max: sorted[count - 1],
            avg: sum / count,
            p95: sorted[Math.floor(count * 0.95)],
            p99: sorted[Math.floor(count * 0.99)],
        };
    }
    /**
     * 获取所有延迟统计
     */
    getAllLatencyStats() {
        const stats = {};
        for (const [operation, _] of this.latencies) {
            const stat = this.getLatencyStats(operation);
            if (stat) {
                stats[operation] = stat;
            }
        }
        return stats;
    }
    /**
     * 获取性能快照
     */
    getLatestSnapshot() {
        return this.snapshots[this.snapshots.length - 1] || null;
    }
    /**
     * 获取历史快照
     */
    getSnapshots(durationMs) {
        const cutoff = Date.now() - durationMs;
        return this.snapshots.filter(s => s.timestamp >= cutoff);
    }
    /**
     * 生成性能报告
     */
    generateReport() {
        const snapshot = this.getLatestSnapshot();
        const latencies = this.getAllLatencyStats();
        let report = '=== 性能报告 ===\n\n';
        // 系统资源
        if (snapshot) {
            report += '【系统资源】\n';
            report += `内存使用: ${(snapshot.memory.used / 1024 / 1024).toFixed(2)} MB / ${(snapshot.memory.total / 1024 / 1024).toFixed(2)} MB (${snapshot.memory.percent.toFixed(1)}%)\n`;
            report += `CPU使用率: ${snapshot.cpu.usage.toFixed(1)}%\n`;
            report += `负载均衡: ${snapshot.cpu.loadAvg.map(l => l.toFixed(2)).join(', ')}\n`;
            report += `Event Loop延迟: ${snapshot.eventLoop.lag.toFixed(2)} ms\n\n`;
        }
        // 延迟统计
        report += '【操作延迟】\n';
        for (const [operation, stat] of Object.entries(latencies)) {
            report += `${operation}:\n`;
            report += `  次数: ${stat.count}, 平均: ${stat.avg.toFixed(2)}ms, P95: ${stat.p95.toFixed(2)}ms, P99: ${stat.p99.toFixed(2)}ms\n`;
        }
        return report;
    }
    /**
     * 获取健康状态
     */
    getHealthStatus() {
        const issues = [];
        const snapshot = this.getLatestSnapshot();
        if (snapshot) {
            if (snapshot.memory.percent > 90) {
                issues.push(`内存使用率过高: ${snapshot.memory.percent.toFixed(1)}%`);
            }
            if (snapshot.cpu.usage > 80) {
                issues.push(`CPU使用率过高: ${snapshot.cpu.usage.toFixed(1)}%`);
            }
            if (snapshot.eventLoop.lag > 100) {
                issues.push(`Event Loop延迟过高: ${snapshot.eventLoop.lag.toFixed(2)}ms`);
            }
        }
        // 检查延迟
        const latencies = this.getAllLatencyStats();
        for (const [operation, stat] of Object.entries(latencies)) {
            if (stat.p95 > 5000) {
                issues.push(`${operation} P95延迟过高: ${stat.p95.toFixed(2)}ms`);
            }
        }
        let status = 'healthy';
        if (issues.length > 2) {
            status = 'critical';
        }
        else if (issues.length > 0) {
            status = 'warning';
        }
        return { status, issues };
    }
    // ═══════════════════════════════════════════════════════════
    // 私有方法
    // ═══════════════════════════════════════════════════════════
    collectSnapshot() {
        const memUsage = process.memoryUsage();
        const totalMem = os.totalmem();
        const snapshot = {
            timestamp: Date.now(),
            memory: {
                used: memUsage.heapUsed,
                total: totalMem,
                percent: (memUsage.heapUsed / totalMem) * 100,
            },
            cpu: {
                usage: this.getCPUUsage(),
                loadAvg: os.loadavg(),
            },
            eventLoop: {
                lag: this.measureEventLoopLag(),
            },
        };
        this.snapshots.push(snapshot);
        // 限制数量
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots = this.snapshots.slice(-this.maxSnapshots);
        }
        // 检查健康状态
        const health = this.getHealthStatus();
        if (health.status !== 'healthy') {
            this.emit('health:warning', health);
        }
    }
    getCPUUsage() {
        const cpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                totalTick += cpu.times[type];
            }
            totalIdle += cpu.times.idle;
        }
        return 100 - (100 * totalIdle / totalTick);
    }
    measureEventLoopLag() {
        const start = process.hrtime.bigint();
        return new Promise((resolve) => {
            setImmediate(() => {
                const end = process.hrtime.bigint();
                const lag = Number(end - start) / 1000000; // 转换为ms
                resolve(lag);
            });
        });
    }
    checkThresholds(name, value, tags) {
        // 内存阈值
        if (name === 'memory.percent' && value > 90) {
            this.emit('threshold:exceeded', { metric: name, value, threshold: 90 });
        }
        // 延迟阈值
        if (name.startsWith('latency.') && value > 5000) {
            this.emit('threshold:exceeded', { metric: name, value, threshold: 5000, tags });
        }
    }
}
// 单例导出
export const performanceMonitor = new PerformanceMonitor();
