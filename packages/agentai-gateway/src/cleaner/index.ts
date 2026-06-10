/**
 * CleanerDaemon: 360 风格智能清理器核心
 * 职责:
 *  - 加载规则 + 监听热重载
 *  - 周期扫描 + 快速磁盘检查
 *  - 调度执行(SAFE 直清 / RISKY 入队 / ALERT 推送)
 *  - 状态持久化(轮转备份)
 *  - 用户确认接口
 *  - 用户心跳追踪(配合智能调度)
 *
 * 不直接处理 HTTP — 由 index.ts 注册路由调用
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { loadRulesWithCache, watchRules } from './rule-engine.js';
import { scan, expandHome } from './scanner.js';
import { plan } from './planner.js';
import { executeSafe } from './executor.js';
import { loadState, saveState, stateDir } from './state.js';
import { sendAlert, PushNotification } from './alerts.js';
import { SmartScheduler, sampleCpuUsage, isUserIdleByHeartbeat } from './smart-scheduler.js';
import type { Rule, FileAction, CleanerState, RiskyPlan, AuditWriter } from './types.js';
import { EMPTY_STATE } from './types.js';

export interface DaemonConfig {
    rules: Rule[];
    stateDir: string;
    scanRoots: string[];
    workspace: string;
    audit: AuditWriter;
    pushNotification?: PushNotification;
    scheduler?: SmartScheduler;
}

export interface RunResult {
    bytesFreed: number;
    riskyCount: number;
    alertCount: number;
    scannedCount: number;
    failures: number;
}

export class CleanerDaemon {
    private state: CleanerState = { ...EMPTY_STATE };
    private rules: Rule[];
    private cfg: DaemonConfig;
    private lock: Promise<any> = Promise.resolve();
    private lastUserHeartbeat: number = Date.now();
    private fullTimer?: NodeJS.Timeout;
    private quickTimer?: NodeJS.Timeout;
    private ruleWatcherDispose?: () => void;

    constructor(cfg: DaemonConfig) {
        this.cfg = cfg;
        this.rules = cfg.rules;
        // 注意: EMPTY_STATE 中的 pendingRiskyPlans 是共享引用,
        // 必须重新分配为独立数组,避免多实例污染
        this.state = { ...EMPTY_STATE, pendingRiskyPlans: [] };
    }

    /**
     * 启动守护进程: 加载状态 + 设置定时器 + 监听规则
     */
    async start(): Promise<void> {
        this.state = await loadState(this.cfg.stateDir);

        // 暴露 next* 给前端(硬编码 5min/1h, 与下方 setInterval 周期一致)
        this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
        this.state.nextFullRunAt = Date.now() + 60 * 60 * 1000;
        await saveState(this.cfg.stateDir, this.state);

        // 全量定时: 启动 1 小时后第一次,之后每 24 小时一次
        this.fullTimer = setTimeout(() => {
            this.runOnce({ scope: 'safe' }).catch(() => { /* swallow */ });
            this.fullTimer = setInterval(
                () => this.runOnce({ scope: 'safe' }).catch(() => { /* swallow */ }),
                24 * 60 * 60 * 1000,
            );
        }, 60 * 60 * 1000);

        // 快速检查: 每 5 分钟检查磁盘占用
        this.quickTimer = setInterval(
            () => this.checkDiskAndRun().catch(() => { /* swallow */ }),
            5 * 60 * 1000,
        );

        // 规则热重载监听
        try {
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            this.ruleWatcherDispose = watchRules(
                path.join(__dirname, 'rules.json'),
                (rs) => { this.rules = rs; this.state.lastRuleReload = Date.now(); },
            );
        } catch {
            /* rules.json may not be loadable in tests */
        }
    }

    /**
     * 停止守护进程(测试和优雅退出用)
     */
    stop(): void {
        if (this.fullTimer) {
            clearTimeout(this.fullTimer);
            clearInterval(this.fullTimer);
            this.fullTimer = undefined;
        }
        if (this.quickTimer) {
            clearInterval(this.quickTimer);
            this.quickTimer = undefined;
        }
        if (this.ruleWatcherDispose) {
            this.ruleWatcherDispose();
            this.ruleWatcherDispose = undefined;
        }
    }

    /**
     * 上报用户心跳(供智能调度判断)
     */
    reportUserHeartbeat(): void {
        this.lastUserHeartbeat = Date.now();
        this.cfg.scheduler?.reportUserHeartbeat();
    }

    /**
     * 串行化执行(runOnce 不可并发)
     */
    private async withLock<T>(op: () => Promise<T>): Promise<T> {
        const prev = this.lock;
        let release!: () => void;
        this.lock = new Promise<void>(r => { release = r; });
        try {
            await prev;
            return await op();
        } finally {
            release();
        }
    }

    /**
     * 执行一次扫描+分类+执行
     * scope:
     *  - 'safe': 只执行 SAFE 桶
     *  - 'risky': 只入队 RISKY 桶(不发告警)
     *  - 'all': SAFE 直清 + RISKY 入队 + ALERT 告警
     */
    async runOnce(opts: { scope: 'all' | 'safe' | 'risky' }): Promise<RunResult> {
        return this.withLock(async () => {
            const files = await scan({
                roots: this.cfg.scanRoots,
                maxDepth: 4,
                timeoutMs: 30_000,
            });
            const ctx = {
                home: expandHome('~'),
                workspace: this.cfg.workspace,
            };
            const p = plan(this.rules, files, ctx);
            const result: RunResult = {
                bytesFreed: 0,
                riskyCount: 0,
                alertCount: 0,
                scannedCount: files.length,
                failures: 0,
            };

            if (opts.scope !== 'risky') {
                const exec = await executeSafe(p.safe, this.cfg.audit);
                result.bytesFreed += exec.bytesFreed;
                result.failures += exec.failures.length;
                this.state.cumulativeBytes += exec.bytesFreed;
            }

            if (opts.scope !== 'safe') {
                // RISKY 入队
                for (const r of p.risky) {
                    const newPlan: RiskyPlan = {
                        planId: r.planId,
                        category: r.ruleId,
                        files: [r.file],
                        createdAt: Date.now(),
                        reason: `${r.action} requires confirmation`,
                    };
                    if (!this.state.pendingRiskyPlans.find(x => x.planId === newPlan.planId)) {
                        this.state.pendingRiskyPlans.push(newPlan);
                        result.riskyCount++;
                        if (this.cfg.pushNotification) {
                            await this.cfg.pushNotification({
                                type: 'cleaner_confirm_required',
                                level: 'warning',
                                message: `需确认: ${newPlan.reason} (${r.file.path})`,
                                meta: newPlan,
                            });
                        }
                    }
                }
                // ALERT 推送
                for (const a of p.alerts) {
                    result.alertCount++;
                    if (this.cfg.pushNotification) {
                        await sendAlert({ kind: 'oversize-file', file: a.file.path, size: a.file.size }, this.cfg.pushNotification);
                    }
                }
                this.state.alertsLast24h = result.alertCount;
            }

            this.state.lastScan = Date.now();
            if (opts.scope === 'all') this.state.lastFullRun = Date.now();
            // 滚动 next*: 任何 scope 都更新(nextQuick 固定 +5min, nextFull 滚动到 +24h 作为预估)
            // 注: 当前 setInterval 实际触发 scope:'safe', 但 nextFullRunAt 仍按 24h 周期滚动
            this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
            this.state.nextFullRunAt = Date.now() + 24 * 60 * 60 * 1000;
            await saveState(this.cfg.stateDir, this.state);
            return result;
        });
    }

    /**
     * 获取状态(供端点展示)
     */
    async getState(): Promise<CleanerState> {
        return this.state;
    }

    /**
     * 确认/拒绝一个 RISKY 计划
     *  - approve: 尝试执行(当前仅支持 delete)
     *  - reject:  从队列移除
     */
    async confirmPlan(planId: string, action: 'approve' | 'reject'): Promise<{ ok: boolean; bytesFreed?: number; error?: string }> {
        return this.withLock(async () => {
            const idx = this.state.pendingRiskyPlans.findIndex(p => p.planId === planId);
            if (idx < 0) {
                return { ok: false, error: 'plan not found or already resolved' };
            }
            const planItem = this.state.pendingRiskyPlans[idx]!;
            if (action === 'reject') {
                this.state.pendingRiskyPlans.splice(idx, 1);
                await saveState(this.cfg.stateDir, this.state);
                return { ok: true };
            }
            // approve: 尝试删除计划内的文件(最佳努力)
            const actions: FileAction[] = planItem.files.map(f => ({
                planId: planItem.planId,
                ruleId: planItem.category,
                risk: 'risky',
                action: 'delete',
                file: { path: f.path, size: f.size, mtime: f.mtime, atime: f.atime, isFile: true },
            }));
            const exec = await executeSafe(actions, this.cfg.audit);
            this.state.pendingRiskyPlans.splice(idx, 1);
            this.state.cumulativeBytes += exec.bytesFreed;
            await saveState(this.cfg.stateDir, this.state);
            return { ok: true, bytesFreed: exec.bytesFreed };
        });
    }

    /**
     * 快速磁盘检查: 总占用超 1GB 触发一次安全清理
     */
    private async checkDiskAndRun(): Promise<void> {
        let total = 0;
        for (const r of this.cfg.scanRoots) {
            try {
                const files = await scan({ roots: [r], maxDepth: 4, timeoutMs: 10_000 });
                for (const f of files) total += f.size;
            } catch {
                /* skip */
            }
        }
        if (total > 1024 ** 3) {
            await this.runOnce({ scope: 'safe' });
        }
        // 每次磁盘检查完毕都更新 nextQuickCheckAt(无论是否触发清理)
        this.state.nextQuickCheckAt = Date.now() + 5 * 60 * 1000;
        await saveState(this.cfg.stateDir, this.state);
    }
}

// 重新导出,方便 index.ts 一处引入
export { stateDir } from './state.js';
export { sampleCpuUsage, isUserIdleByHeartbeat } from './smart-scheduler.js';
export type { Rule, FileMeta, CleanerState } from './types.js';
