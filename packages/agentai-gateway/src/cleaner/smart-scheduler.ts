/**
 * 智能调度: 决定是否执行深度扫描
 * 条件:
 *  - CPU 占用 < 30% (避免影响用户)
 *  - 用户空闲(无输入 > 5 分钟)
 * 任一不满足 → 跳过本次深度扫描
 */

import { cpus } from 'os';

export interface SchedulerDeps {
    getCpuUsage: () => Promise<number>;
    isUserIdle: () => Promise<boolean>;
}

export interface ScanDecision {
    run: boolean;
    reason: string;
    scope: 'full' | 'light';
}

export class SmartScheduler {
    constructor(private deps: SchedulerDeps) { }

    reportUserHeartbeat(): void {
        // 未来可扩展: 上报心跳让调度器感知用户活跃度
        // 当前实现下,心跳由 CleanerDaemon 维护
    }

    async shouldRunDeepScan(): Promise<ScanDecision> {
        const cpu = await this.deps.getCpuUsage();
        if (cpu > 30) {
            return { run: false, reason: `cpu-high (${cpu}%)`, scope: 'light' };
        }
        const idle = await this.deps.isUserIdle();
        if (!idle) {
            return { run: false, reason: 'user-busy', scope: 'light' };
        }
        return { run: true, reason: 'cpu-low+user-idle', scope: 'full' };
    }
}

/**
 * 采样 CPU 占用率 (%)
 * 计算逻辑: 1 - (idle / total),取整
 */
export function sampleCpuUsage(): number {
    const cpusList = cpus();
    let totalIdle = 0, total = 0;
    for (const c of cpusList) {
        for (const t of c.times) total += t;
        totalIdle += c.times.idle;
    }
    if (total === 0) return 0;
    return Math.round(((1 - totalIdle / total) * 100));
}

/**
 * 根据心跳判断用户是否空闲
 * 默认阈值 5 分钟: 上次心跳距今 > 5min → 视为空闲
 */
export function isUserIdleByHeartbeat(lastHeartbeatMs: number, thresholdMs = 5 * 60_000): boolean {
    return Date.now() - lastHeartbeatMs > thresholdMs;
}
