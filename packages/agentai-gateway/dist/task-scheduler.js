/**
 * Task Scheduler — 用户可配置的定时任务调度器
 * ==================================================
 * 核心能力:
 *   1. 定时执行 RPA 脚本 (browser_replay)
 *   2. 定时执行自定义 AI 任务 (通过 agentai-loop 发送消息)
 *   3. 定时触发通知推送
 *   4. Cron 表达式调度 + 一次性定时
 *   5. 任务执行历史 + 失败重试 + 通知告警
 *
 * 存储路径: ~/.agentai/task-schedules.json
 *
 * 与现有 cron-dispatcher.ts 的关系:
 *   cron-dispatcher.ts 是系统内置的 6 个固定定时任务 (反思/清理/进化等)
 *   task-scheduler.ts 是用户/AI 动态创建的定时任务 (RPA/AI任务/通知)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'events';
import { CronJob } from './cron-job.js';
// ===== 持久化 =====
const SCHEDULES_FILE = path.join(os.homedir(), '.agentai', 'task-schedules.json');
function ensureFile() {
    const dir = path.dirname(SCHEDULES_FILE);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(SCHEDULES_FILE))
        fs.writeFileSync(SCHEDULES_FILE, '[]', 'utf-8');
}
// ===== 调度器 =====
class TaskScheduler extends EventEmitter {
    schedules = new Map();
    jobs = new Map();
    gatewayUrl = 'http://127.0.0.1:18789';
    constructor() {
        super();
        this._load();
    }
    setGatewayUrl(url) {
        this.gatewayUrl = url;
    }
    _load() {
        try {
            ensureFile();
            const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8'));
            for (const s of data) {
                // 数据迁移：确保旧数据有 config 字段
                if (!s.config)
                    s.config = {};
                this.schedules.set(s.id, s);
                // 自动恢复 active 状态的任务
                if (s.status === 'active') {
                    this._startJob(s);
                }
            }
            console.log(`[task-scheduler] 加载 ${this.schedules.size} 个调度任务`);
        }
        catch { /* first run */ }
    }
    _save() {
        try {
            ensureFile();
            const data = Array.from(this.schedules.values());
            fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2), 'utf-8');
        }
        catch (e) {
            console.warn(`[task-scheduler] 保存失败: ${e.message}`);
        }
    }
    // ─── CRUD ───
    create(data) {
        const schedule = {
            ...data,
            id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            runCount: 0,
            successCount: 0,
            failCount: 0,
            maxRetries: data.maxRetries ?? 0,
            timeoutMs: data.timeoutMs ?? 120_000,
            notifyOnFailure: data.notifyOnFailure ?? true,
            notifyOnSuccess: data.notifyOnSuccess ?? false,
            config: data.config || {}, // 确保 config 不为 undefined
        };
        this.schedules.set(schedule.id, schedule);
        if (schedule.status === 'active')
            this._startJob(schedule);
        this._save();
        return schedule;
    }
    get(id) {
        return this.schedules.get(id);
    }
    list(status) {
        const all = Array.from(this.schedules.values()).sort((a, b) => b.createdAt - a.createdAt);
        return status ? all.filter(s => s.status === status) : all;
    }
    update(id, updates) {
        const existing = this.schedules.get(id);
        if (!existing)
            return null;
        const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
        this.schedules.set(id, updated);
        // 重启 job
        this._stopJob(id);
        if (updated.status === 'active')
            this._startJob(updated);
        this._save();
        return updated;
    }
    delete(id) {
        this._stopJob(id);
        const existed = this.schedules.delete(id);
        if (existed)
            this._save();
        return existed;
    }
    pause(id) {
        return this.update(id, { status: 'paused' });
    }
    resume(id) {
        return this.update(id, { status: 'active' });
    }
    /** 手动触发一次执行 (不影响调度) */
    async runOnce(id) {
        const schedule = this.schedules.get(id);
        if (!schedule) {
            return { scheduleId: id, success: false, error: '调度任务不存在', durationMs: 0, executedAt: Date.now() };
        }
        return this._execute(schedule);
    }
    // ─── 调度执行 ───
    _startJob(schedule) {
        // 一次性任务
        if (schedule.cron === 'once' && schedule.runAt) {
            const delay = new Date(schedule.runAt).getTime() - Date.now();
            if (delay <= 0) {
                // 已过期, 立即执行一次然后标记为 disabled
                this._execute(schedule).then(() => {
                    this.update(schedule.id, { status: 'disabled' });
                });
                return;
            }
            const timer = setTimeout(() => {
                this._execute(schedule).then(() => {
                    this.update(schedule.id, { status: 'disabled' });
                });
            }, delay);
            // 用 CronJob 的 interval 机制模拟 (实际上是一次性的)
            // 存 timer 引用以便取消
            timer._scheduleId = schedule.id;
            this.jobs.set(schedule.id, { stop: () => clearTimeout(timer) });
            return;
        }
        // 周期性任务
        try {
            const job = new CronJob(schedule.cron, async () => {
                await this._execute(schedule);
            });
            job.start();
            this.jobs.set(schedule.id, job);
        }
        catch (e) {
            console.warn(`[task-scheduler] 启动失败 ${schedule.name}: ${e.message}`);
        }
    }
    _stopJob(id) {
        const job = this.jobs.get(id);
        if (job) {
            try {
                job.stop();
            }
            catch { }
            this.jobs.delete(id);
        }
    }
    /** 执行调度任务（带重试） */
    async _execute(schedule) {
        const startTime = Date.now();
        console.log(`[task-scheduler] 执行: ${schedule.name} (${schedule.type})`);
        // 记录执行开始
        const { executionHistory } = await import('./execution-history.js');
        const executionId = executionHistory.recordStart(schedule.id, schedule.name, schedule.type, 'cron');
        let result;
        let attempts = 0;
        const maxRetries = schedule.maxRetries || 0;
        while (attempts <= maxRetries) {
            attempts++;
            try {
                // 超时保护
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`任务超时 (${schedule.timeoutMs}ms)`)), schedule.timeoutMs);
                });
                const execPromise = this._executeByType(schedule);
                result = await Promise.race([execPromise, timeoutPromise]);
                // 成功，跳出重试循环
                if (result.success)
                    break;
                // 失败但还有重试次数
                if (attempts <= maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000); // 指数退避，最大30秒
                    console.log(`[task-scheduler] 任务失败，${delay}ms后第${attempts}次重试...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
            catch (e) {
                result = {
                    scheduleId: schedule.id,
                    success: false,
                    error: e.message,
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
                // 异常但还有重试次数
                if (attempts <= maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
                    console.log(`[task-scheduler] 任务异常，${delay}ms后第${attempts}次重试...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        // result 在此一定已赋值（while 至少执行一次）
        const safeResult = result;
        // 更新统计
        const s = this.schedules.get(safeResult.scheduleId);
        if (s) {
            s.lastRunAt = Date.now();
            s.lastResult = {
                success: safeResult.success,
                output: safeResult.output?.slice(0, 500),
                error: safeResult.error,
                durationMs: safeResult.durationMs,
            };
            s.runCount++;
            if (safeResult.success)
                s.successCount++;
            else
                s.failCount++;
            this._save();
        }
        // 通知
        if (!safeResult.success && schedule.notifyOnFailure) {
            await this._notify(schedule, false, safeResult, attempts);
        }
        else if (safeResult.success && schedule.notifyOnSuccess) {
            await this._notify(schedule, true, safeResult, attempts);
        }
        const retryInfo = attempts > 1 ? ` (重试${attempts - 1}次)` : '';
        console.log(`[task-scheduler] 完成: ${schedule.name} → ${safeResult.success ? '✅' : '❌'}${retryInfo} (${safeResult.durationMs}ms)`);
        // 记录执行完成
        executionHistory.recordComplete(executionId, safeResult.success ? 'success' : (safeResult.error?.includes('超时') ? 'timeout' : 'failed'), safeResult.output, safeResult.error, safeResult.sessionId);
        // 发射统一 execution:result 事件 (前端 ChatView/TaskCenterPanel 接收)
        this.emit('execution:result', {
            source: 'cron',
            event: 'done',
            id: schedule.id,
            name: schedule.name,
            success: safeResult.success,
            status: safeResult.success ? 'completed' : 'failed',
            durationMs: safeResult.durationMs,
            error: safeResult.error,
            output: safeResult.output,
            type: schedule.type,
        });
        return safeResult;
    }
    /** 根据类型执行 */
    async _executeByType(schedule) {
        const startTime = Date.now();
        const cfg = schedule.config || {};
        switch (schedule.type) {
            case 'rpa': {
                // 调用 RPA 回放
                const body = {};
                if (cfg.rpaScriptId)
                    body.script_id = cfg.rpaScriptId;
                if (cfg.rpaSteps)
                    body.steps = cfg.rpaSteps;
                if (cfg.rpaVariables)
                    body.variables = cfg.rpaVariables;
                const resp = await fetch(`${this.gatewayUrl}/v1/chat/tools`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: 'browser_replay', args: body }),
                });
                const data = await resp.json();
                return {
                    scheduleId: schedule.id,
                    success: data.success !== false,
                    output: data.output || JSON.stringify(data).slice(0, 500),
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
            }
            case 'ai_task': {
                // 生成新的会话 ID，确保每次自动化任务都在独立对话中执行
                const timestamp = Date.now();
                const newSessionId = `auto-${schedule.id}-${timestamp}`;
                const sessionTitle = `${schedule.name} (${new Date(timestamp).toLocaleString('zh-CN')})`;
                // 先创建会话记录
                try {
                    await fetch(`${this.gatewayUrl}/api/sessions`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: sessionTitle,
                            userId: 'automation',
                            workspace: `auto-${schedule.id}`,
                        }),
                    });
                }
                catch (e) {
                    console.warn(`[task-scheduler] 创建会话记录失败: ${e.message}`);
                }
                // 发送 AI 消息到新会话
                const resp = await fetch(`${this.gatewayUrl}/v1/chat`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: cfg.aiMessage || schedule.description,
                        sessionId: newSessionId,
                        auto: true,
                        source: 'automation',
                        scheduleId: schedule.id,
                    }),
                });
                const data = await resp.json();
                return {
                    scheduleId: schedule.id,
                    success: !data.error,
                    output: data.response?.slice(0, 500) || data.error,
                    sessionId: newSessionId,
                    durationMs: Date.now() - startTime,
                    executedAt: timestamp,
                };
            }
            case 'notification': {
                // 发送通知
                const resp = await fetch(`${this.gatewayUrl}/v1/chat/tools`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: 'send_notification',
                        args: {
                            title: cfg.notifTitle || schedule.name,
                            body: cfg.notifBody || schedule.description,
                            level: cfg.notifLevel || 'info',
                            channel: cfg.notifChannel || 'sse',
                            source: `定时任务: ${schedule.name}`,
                        },
                    }),
                });
                const data = await resp.json();
                return {
                    scheduleId: schedule.id,
                    success: data.success !== false,
                    output: data.output || '通知已发送',
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
            }
            case 'custom': {
                // 自定义 HTTP 调用
                const resp = await fetch(cfg.customUrl || '', {
                    method: cfg.customMethod || 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: cfg.customBody ? JSON.stringify(cfg.customBody) : undefined,
                });
                const text = await resp.text();
                return {
                    scheduleId: schedule.id,
                    success: resp.ok,
                    output: text.slice(0, 500),
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
            }
            case 'workflow': {
                // 执行工作流模板
                const { getWorkflowEngine } = await import('./workflow-template-engine.js');
                const engine = getWorkflowEngine();
                engine.setGatewayUrl(this.gatewayUrl);
                if (!cfg.workflowTemplateId) {
                    return { scheduleId: schedule.id, success: false, output: '缺少工作流模板ID', error: 'workflowTemplateId is required', durationMs: Date.now() - startTime, executedAt: Date.now() };
                }
                const execution = await engine.execute(cfg.workflowTemplateId, cfg.workflowVariables || {});
                return {
                    scheduleId: schedule.id,
                    success: execution.status !== 'failed',
                    output: `工作流 ${execution.status}: ${execution.templateName} (${execution.stepResults.size}步)`,
                    error: execution.error,
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
            }
            default:
                return {
                    scheduleId: schedule.id,
                    success: false,
                    error: `未知任务类型: ${schedule.type}`,
                    durationMs: Date.now() - startTime,
                    executedAt: Date.now(),
                };
        }
    }
    /** 发送通知 (成功/失败) */
    async _notify(schedule, success, result, attempts = 1) {
        try {
            const { getNotificationEngine } = await import('./notification-engine.js');
            const engine = getNotificationEngine();
            const retryInfo = attempts > 1 ? ` (重试${attempts - 1}次)` : '';
            await engine.send({
                title: `[定时任务] ${schedule.name} ${success ? '✅ 执行成功' : '❌ 执行失败'}${retryInfo}`,
                body: result.error
                    ? `错误: ${result.error}\n耗时: ${result.durationMs}ms\n尝试次数: ${attempts}\n总执行次数: ${schedule.runCount}`
                    : `结果: ${result.output || '完成'}\n耗时: ${result.durationMs}ms\n尝试次数: ${attempts}\n总执行次数: ${schedule.runCount}`,
                level: success ? 'success' : 'error',
                channel: 'sse',
                source: `定时任务调度器`,
            });
        }
        catch { /* best effort */ }
    }
    /** 获取统计 */
    getStats() {
        let active = 0, paused = 0, totalRuns = 0, totalSuccess = 0, totalFail = 0;
        for (const s of this.schedules.values()) {
            if (s.status === 'active')
                active++;
            else if (s.status === 'paused')
                paused++;
            totalRuns += s.runCount;
            totalSuccess += s.successCount;
            totalFail += s.failCount;
        }
        return { total: this.schedules.size, active, paused, totalRuns, totalSuccess, totalFail };
    }
    /** 停止所有任务 */
    stopAll() {
        for (const id of this.jobs.keys()) {
            this._stopJob(id);
        }
        console.log('[task-scheduler] 已停止所有调度任务');
    }
}
// ===== 单例 =====
let _instance = null;
export function getTaskScheduler() {
    if (!_instance)
        _instance = new TaskScheduler();
    return _instance;
}
