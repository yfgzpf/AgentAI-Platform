// @ts-nocheck
/**
 * Enterprise Automation Core - 企业级桌面自动化核心
 *
 * 设计原则：
 * 1. 纯桌面自动化，不调用任何API，完全规避平台监管
 * 2. 多账号轮换，单点故障自动切换
 * 3. 智能行为模拟，完全模拟真人操作
 * 4. 7x24小时无人值守，自动恢复
 * 5. 完整监控告警，实时掌握状态
 */
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';
// ═══════════════════════════════════════════════════════════
// 企业级自动化核心
// ═══════════════════════════════════════════════════════════
export class EnterpriseAutomationCore extends EventEmitter {
    db;
    config;
    activeWorkers = new Map();
    taskQueue = [];
    isRunning = false;
    healthCheckTimer;
    constructor(config) {
        super();
        this.config = config;
        this.db = this.initDatabase();
    }
    initDatabase() {
        const dbPath = path.join(process.cwd(), '.agentai', 'enterprise-automation.db');
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        const db = new Database(dbPath);
        db.exec(`
      CREATE TABLE IF NOT EXISTS automation_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        params TEXT,
        priority INTEGER DEFAULT 5,
        status TEXT DEFAULT 'pending',
        assigned_account TEXT,
        result TEXT,
        error_message TEXT,
        retries INTEGER DEFAULT 0,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS account_stats (
        account_id TEXT PRIMARY KEY,
        platform TEXT,
        total_tasks INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        last_task_at INTEGER,
        daily_quota_used INTEGER DEFAULT 0,
        last_reset_date TEXT,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS operation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT,
        account_id TEXT,
        action TEXT,
        details TEXT,
        screenshot_path TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON automation_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_account ON automation_tasks(assigned_account);
    `);
        return db;
    }
    /**
     * 启动企业级自动化引擎
     */
    async start() {
        if (this.isRunning) {
            console.log('[EnterpriseCore] 引擎已在运行');
            return true;
        }
        console.log('[EnterpriseCore] 启动企业级自动化引擎...');
        console.log(`[EnterpriseCore] 账号池: ${this.config.accounts.length}个`);
        console.log(`[EnterpriseCore] 工作时段: ${this.config.behavior.workHoursStart}:00-${this.config.behavior.workHoursEnd}:00`);
        this.isRunning = true;
        // 启动健康检查
        this.startHealthCheck();
        // 启动任务调度器
        this.startTaskScheduler();
        // 启动账号状态监控
        this.startAccountMonitor();
        this.emit('started');
        console.log('[EnterpriseCore] ✅ 引擎启动成功');
        return true;
    }
    /**
     * 添加任务到队列
     */
    addTask(type, params, priority = 5) {
        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const task = {
            id: taskId,
            type,
            params,
            priority,
            retries: 0,
            createdAt: Date.now(),
        };
        // 插入队列（按优先级排序）
        const insertIndex = this.taskQueue.findIndex(t => t.priority < priority);
        if (insertIndex === -1) {
            this.taskQueue.push(task);
        }
        else {
            this.taskQueue.splice(insertIndex, 0, task);
        }
        // 保存到数据库
        const stmt = this.db.prepare(`
      INSERT INTO automation_tasks (id, type, params, priority, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
        stmt.run(taskId, type, JSON.stringify(params), priority, Date.now());
        console.log(`[EnterpriseCore] 任务已添加: ${taskId}, 类型: ${type}, 优先级: ${priority}`);
        this.emit('task:added', task);
        return taskId;
    }
    /**
     * 启动任务调度器
     */
    startTaskScheduler() {
        const scheduleLoop = async () => {
            if (!this.isRunning)
                return;
            try {
                // 检查是否在工作时间
                if (!this.isWorkHours()) {
                    console.log('[EnterpriseCore] 非工作时间，等待中...');
                    setTimeout(scheduleLoop, 60000); // 1分钟后检查
                    return;
                }
                // 获取待处理任务
                if (this.taskQueue.length > 0) {
                    const task = this.taskQueue[0];
                    // 选择最佳账号
                    const account = this.selectBestAccount(task.type);
                    if (account) {
                        // 从队列移除
                        this.taskQueue.shift();
                        // 执行任务
                        await this.executeTask(task, account);
                    }
                    else {
                        console.log('[EnterpriseCore] 无可用账号，等待中...');
                    }
                }
                // 计算下次调度时间（随机间隔）
                const interval = this.getRandomInterval();
                setTimeout(scheduleLoop, interval);
            }
            catch (error) {
                console.error('[EnterpriseCore] 调度错误:', error);
                setTimeout(scheduleLoop, 5000);
            }
        };
        // 启动调度
        scheduleLoop();
    }
    /**
     * 选择最佳账号
     */
    selectBestAccount(taskType) {
        const now = Date.now();
        const today = new Date().toISOString().split('T')[0];
        // 筛选可用账号
        const availableAccounts = this.config.accounts.filter(acc => {
            // 检查状态
            if (acc.status !== 'active')
                return false;
            // 检查冷却时间
            if (acc.cooldownUntil && now < acc.cooldownUntil)
                return false;
            // 检查日配额
            if (acc.usedToday >= acc.dailyQuota)
                return false;
            // 检查平台匹配
            if (taskType.includes('wechat') && acc.platform !== 'wechat')
                return false;
            if (taskType.includes('xiaohongshu') && acc.platform !== 'xiaohongshu')
                return false;
            return true;
        });
        if (availableAccounts.length === 0)
            return null;
        // 选择使用次数最少的账号（负载均衡）
        const bestAccount = availableAccounts.reduce((best, acc) => acc.usedToday < best.usedToday ? acc : best);
        return bestAccount;
    }
    /**
     * 执行任务
     */
    async executeTask(task, account) {
        console.log(`[EnterpriseCore] 执行任务: ${task.id}, 账号: ${account.username}`);
        // 更新任务状态
        this.updateTaskStatus(task.id, 'running', { assignedAccount: account.id });
        // 更新账号使用统计
        account.usedToday++;
        account.lastUsedAt = Date.now();
        try {
            // 模拟行为延迟
            await this.simulateHumanBehavior();
            // 执行具体操作（调用Python脚本）
            const result = await this.runPythonAutomation(task, account);
            if (result.success) {
                this.updateTaskStatus(task.id, 'completed', { result: JSON.stringify(result) });
                this.logOperation(task.id, account.id, 'success', result);
                this.emit('task:completed', { taskId: task.id, result });
            }
            else {
                throw new Error(result.error || '执行失败');
            }
        }
        catch (error) {
            console.error(`[EnterpriseCore] 任务失败: ${task.id}`, error.message);
            // 重试逻辑
            if (task.retries < this.config.queue.maxRetries) {
                task.retries++;
                task.assignedAccount = undefined;
                // 重新放入队列（延迟重试）
                setTimeout(() => {
                    this.taskQueue.push(task);
                }, this.config.queue.retryInterval);
                this.updateTaskStatus(task.id, 'retrying', {
                    errorMessage: error.message,
                    retries: task.retries
                });
            }
            else {
                // 重试耗尽，标记失败
                this.updateTaskStatus(task.id, 'failed', { errorMessage: error.message });
                this.logOperation(task.id, account.id, 'failed', { error: error.message });
                this.emit('task:failed', { taskId: task.id, error: error.message });
                // 账号可能被封，标记冷却
                account.status = 'cooldown';
                account.cooldownUntil = Date.now() + 3600000; // 冷却1小时
            }
        }
    }
    /**
     * 运行Python自动化脚本
     */
    async runPythonAutomation(task, account) {
        return new Promise((resolve) => {
            // 构建Python命令
            const scriptPath = path.join(__dirname, 'automation_worker.py');
            const pythonProcess = spawn('python', [
                scriptPath,
                '--task-type', task.type,
                '--task-params', JSON.stringify(task.params),
                '--account', JSON.stringify({
                    id: account.id,
                    platform: account.platform,
                    username: account.username,
                    password: account.password,
                }),
                '--behavior', JSON.stringify(this.config.behavior),
            ], {
                env: {
                    ...process.env,
                    PYTHONIOENCODING: 'utf-8',
                },
                timeout: 300000, // 5分钟超时
            });
            let output = '';
            let errorOutput = '';
            pythonProcess.stdout?.on('data', (data) => {
                output += data.toString();
            });
            pythonProcess.stderr?.on('data', (data) => {
                errorOutput += data.toString();
            });
            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(output);
                        resolve(result);
                    }
                    catch (e) {
                        resolve({ success: true, data: { output } });
                    }
                }
                else {
                    resolve({
                        success: false,
                        error: errorOutput || `进程退出码: ${code}`
                    });
                }
            });
            pythonProcess.on('error', (error) => {
                resolve({ success: false, error: error.message });
            });
        });
    }
    /**
     * 模拟人类行为
     */
    async simulateHumanBehavior() {
        const { minActionInterval, maxActionInterval } = this.config.behavior;
        const delay = Math.floor(Math.random() * (maxActionInterval - minActionInterval) + minActionInterval);
        console.log(`[EnterpriseCore] 模拟人类行为，等待 ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    /**
     * 获取随机间隔
     */
    getRandomInterval() {
        const { minActionInterval, maxActionInterval } = this.config.behavior;
        return Math.floor(Math.random() * (maxActionInterval - minActionInterval) + minActionInterval);
    }
    /**
     * 检查是否在工作时间
     */
    isWorkHours() {
        const now = new Date();
        const hour = now.getHours();
        const { workHoursStart, workHoursEnd, lunchBreakStart, lunchBreakEnd } = this.config.behavior;
        // 检查是否在午餐时间
        if (hour >= lunchBreakStart && hour < lunchBreakEnd) {
            return false;
        }
        // 检查是否在工作时间
        return hour >= workHoursStart && hour < workHoursEnd;
    }
    /**
     * 启动健康检查
     */
    startHealthCheck() {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.config.monitoring.healthCheckInterval);
    }
    /**
     * 执行健康检查
     */
    performHealthCheck() {
        const stats = {
            queueSize: this.taskQueue.length,
            activeWorkers: this.activeWorkers.size,
            activeAccounts: this.config.accounts.filter(a => a.status === 'active').length,
            totalTasks: this.db.prepare('SELECT COUNT(*) as count FROM automation_tasks').get(),
            failedTasks: this.db.prepare("SELECT COUNT(*) as count FROM automation_tasks WHERE status = 'failed'").get(),
        };
        console.log('[EnterpriseCore] 健康检查:', stats);
        // 检查是否需要告警
        if (stats.failedTasks.count > this.config.monitoring.alertThreshold) {
            this.emit('alert', {
                type: 'high_failure_rate',
                message: `失败任务数过高: ${stats.failedTasks.count}`,
                stats,
            });
        }
        // 检查是否需要自动重启
        if (this.config.monitoring.autoRestart && stats.activeAccounts === 0) {
            console.log('[EnterpriseCore] 无可用账号，尝试恢复...');
            this.recoverAccounts();
        }
    }
    /**
     * 恢复账号
     */
    recoverAccounts() {
        const now = Date.now();
        this.config.accounts.forEach(acc => {
            if (acc.status === 'cooldown' && acc.cooldownUntil && now >= acc.cooldownUntil) {
                acc.status = 'active';
                acc.cooldownUntil = undefined;
                console.log(`[EnterpriseCore] 账号恢复: ${acc.username}`);
            }
        });
    }
    /**
     * 启动账号监控
     */
    startAccountMonitor() {
        // 每天零点重置配额
        setInterval(() => {
            const now = new Date();
            if (now.getHours() === 0 && now.getMinutes() === 0) {
                this.resetDailyQuota();
            }
        }, 60000); // 每分钟检查
    }
    /**
     * 重置日配额
     */
    resetDailyQuota() {
        console.log('[EnterpriseCore] 重置日配额');
        this.config.accounts.forEach(acc => {
            acc.usedToday = 0;
        });
        // 更新数据库
        this.db.prepare('UPDATE account_stats SET daily_quota_used = 0').run();
    }
    /**
     * 更新任务状态
     */
    updateTaskStatus(taskId, status, updates) {
        const fields = ['status = ?', 'updated_at = ?'];
        const values = [status, Date.now()];
        if (updates?.assignedAccount) {
            fields.push('assigned_account = ?');
            values.push(updates.assignedAccount);
        }
        if (updates?.result) {
            fields.push('result = ?');
            values.push(updates.result);
        }
        if (updates?.errorMessage) {
            fields.push('error_message = ?');
            values.push(updates.errorMessage);
        }
        if (updates?.retries !== undefined) {
            fields.push('retries = ?');
            values.push(updates.retries);
        }
        values.push(taskId);
        const stmt = this.db.prepare(`
      UPDATE automation_tasks SET ${fields.join(', ')} WHERE id = ?
    `);
        stmt.run(...values);
    }
    /**
     * 记录操作日志
     */
    logOperation(taskId, accountId, action, details) {
        const stmt = this.db.prepare(`
      INSERT INTO operation_logs (task_id, account_id, action, details, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
        stmt.run(taskId, accountId, action, JSON.stringify(details), Date.now());
    }
    /**
     * 获取统计信息
     */
    getStats() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStart = today.getTime();
        const totalTasks = this.db.prepare('SELECT COUNT(*) as count FROM automation_tasks WHERE created_at >= ?').get(todayStart);
        const successTasks = this.db.prepare("SELECT COUNT(*) as count FROM automation_tasks WHERE status = 'completed' AND created_at >= ?").get(todayStart);
        const failedTasks = this.db.prepare("SELECT COUNT(*) as count FROM automation_tasks WHERE status = 'failed' AND created_at >= ?").get(todayStart);
        return {
            queueSize: this.taskQueue.length,
            activeAccounts: this.config.accounts.filter(a => a.status === 'active').length,
            todayTasks: totalTasks.count,
            todaySuccess: successTasks.count,
            todayFailed: failedTasks.count,
        };
    }
    /**
     * 停止引擎
     */
    async stop() {
        console.log('[EnterpriseCore] 停止企业级自动化引擎...');
        this.isRunning = false;
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        // 等待所有worker完成
        for (const [id, worker] of this.activeWorkers) {
            worker.kill();
        }
        this.activeWorkers.clear();
        this.db.close();
        this.emit('stopped');
        console.log('[EnterpriseCore] ✅ 引擎已停止');
    }
}
// 单例导出
let enterpriseCore = null;
export function getEnterpriseAutomationCore(config) {
    if (!enterpriseCore && config) {
        enterpriseCore = new EnterpriseAutomationCore(config);
    }
    return enterpriseCore;
}
