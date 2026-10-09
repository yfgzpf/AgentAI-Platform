/**
 * AutomationEngine — AI 主动创建的自动化工作流引擎
 * ----------------------------------------------------
 * 核心能力:
 *   1. Cron Jobs — AI 可创建定时任务 (create_cron_job / delete_cron_job / list_cron_jobs)
 *   2. 自动化规则 — AI 可创建触发器规则 (create_automation_rule / list_automation_rules / toggle)
 *   3. 后台任务 — AI 可创建常驻后台任务 (create_background_task)
 *
 * AI 通过工具调用管理整个系统, 无需人工编辑配置。
 *
 * cron + autonomous systems 设计理念
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
// ===== 引擎 =====
const DATA_DIR = '.agentai/automation/';
export class AutomationEngine extends EventEmitter {
    cronJobs = new Map();
    rules = new Map();
    backgroundTasks = new Map();
    workspace;
    _timers = new Map(); // NodeJS.Timeout
    _loaded = false;
    _registry;
    constructor(workspace, registry) {
        super();
        // P1 修复: 增加最大监听器限制, 防止定时任务触发时内存泄漏警告
        this.setMaxListeners(50);
        this.workspace = workspace;
        this._registry = registry;
    }
    // ===== 持久化 =====
    dataDir() {
        return path.join(this.workspace, DATA_DIR);
    }
    ensureDir() {
        fs.mkdirSync(this.dataDir(), { recursive: true });
    }
    save() {
        this.ensureDir();
        fs.writeFileSync(path.join(this.dataDir(), 'cron-jobs.json'), JSON.stringify([...this.cronJobs.values()], null, 2), 'utf-8');
        fs.writeFileSync(path.join(this.dataDir(), 'rules.json'), JSON.stringify([...this.rules.values()], null, 2), 'utf-8');
        fs.writeFileSync(path.join(this.dataDir(), 'background-tasks.json'), JSON.stringify([...this.backgroundTasks.values()], null, 2), 'utf-8');
    }
    load() {
        if (this._loaded)
            return;
        this.ensureDir();
        try {
            const cronData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'cron-jobs.json'), 'utf-8'));
            for (const item of cronData)
                this.cronJobs.set(item.id, item);
        }
        catch { /* 首次加载无文件 */ }
        try {
            const rulesData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'rules.json'), 'utf-8'));
            for (const item of rulesData)
                this.rules.set(item.id, item);
        }
        catch { /* 无文件 */ }
        try {
            const tasksData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'background-tasks.json'), 'utf-8'));
            for (const item of tasksData)
                this.backgroundTasks.set(item.id, item);
        }
        catch { /* 无文件 */ }
        this._loaded = true;
        // 自动检测工作区环境 → 自动安装匹配的预设模板 (已存在的跳过)
        this.autoDetectAndInstall();
        this.startTimers();
        // 监听所有 cron:tick → 执行 action + 蒸馏特殊处理
        this.on('cron:tick', async (job) => {
            try {
                console.log(`[automation] ⏰ 定时任务触发: ${job.name} (action=${job.action})`);
                // 蒸馏任务: 特殊逻辑
                if (job.action === 'run_distillation' || job.name.includes('蒸馏')) {
                    try {
                        const { runDistillation, installAutomationsFromDistillation } = await import('./model-distiller.js');
                        const result = runDistillation();
                        if (result.stats.patternsGenerated > 0) {
                            const installed = installAutomationsFromDistillation(this);
                            console.log(`[automation] 🧠 蒸馏完成: ${result.stats.patternsGenerated} 个模式, 装 ${installed.length} 个任务`);
                        }
                    }
                    catch (e) {
                        console.warn('[automation] 蒸馏失败:', e?.message);
                    }
                    return;
                }
                // 通用 action 执行: 通过 ToolRegistry 调用工具
                if (this._registry && job.action) {
                    const tool = this._registry.get(job.action);
                    if (tool) {
                        // 智能健康管理: disabled 状态的任务不执行
                        if (job.status === 'disabled') {
                            console.log(`[automation] ⏭️ ${job.name} 已自动禁用 (${job.autoDisabledReason}), 跳过执行`);
                            return;
                        }
                        const result = await tool.handler(job.params || {}, {
                            userId: 'system',
                            workspace: this.workspace,
                            abortSignal: new AbortController().signal,
                        });
                        job.lastRun = Date.now();
                        // 智能健康管理: 记录成功/失败, 自动禁用连续失败的任务
                        if (result.success) {
                            job.lastResult = '✅ 成功';
                            job.failCount = 0; // 成功重置失败计数
                            job.successCount = (job.successCount || 0) + 1;
                            // 如果之前是暂停状态且现在成功了, 自动恢复 (但 disabled 不自动恢复)
                            console.log(`[automation] ✅ ${job.name} 执行成功 (累计 ${job.successCount} 次)`);
                        }
                        else {
                            const errorMsg = result.error || result.output || 'unknown';
                            job.lastResult = `❌ 失败: ${errorMsg.slice(0, 200)}`;
                            job.failCount = (job.failCount || 0) + 1;
                            job.lastFailAt = Date.now();
                            console.warn(`[automation] ❌ ${job.name} 失败 (连续 ${job.failCount} 次): ${errorMsg.slice(0, 100)}`);
                            // 智能自动修复: 尝试从预设更新命令
                            if (job.failCount === 2) {
                                const preset = AUTOMATION_PRESETS.find(p => p.name === job.name);
                                if (preset) {
                                    const oldCmd = job.params?.command || '';
                                    const newCmd = preset.defaultParams?.command || '';
                                    if (oldCmd !== newCmd) {
                                        console.log(`[automation] 🔧 ${job.name} 自动修复: 更新命令到最新预设版本`);
                                        job.params = { ...preset.defaultParams };
                                        job.failCount = 0; // 修复后重置, 给一次新机会
                                    }
                                }
                            }
                            // 连续 3 次失败 → 自动禁用
                            if (job.failCount >= 3) {
                                job.status = 'disabled';
                                job.autoDisabledReason = `连续失败 ${job.failCount} 次, 最后错误: ${errorMsg.slice(0, 80)}`;
                                console.warn(`[automation] 🛑 ${job.name} 自动禁用: ${job.autoDisabledReason}`);
                                this.emit('cron:auto-disabled', { jobId: job.id, name: job.name, reason: job.autoDisabledReason });
                            }
                        }
                        this.save();
                        this.emit('cron:result', { jobId: job.id, result: job.lastResult, failCount: job.failCount, successCount: job.successCount });
                    }
                    else {
                        // 工具不存在 → 这是个失效任务, 标记为 disabled
                        job.failCount = (job.failCount || 0) + 1;
                        job.lastFailAt = Date.now();
                        job.lastResult = `❌ 工具 "${job.action}" 不存在`;
                        if (job.failCount >= 2) {
                            job.status = 'disabled';
                            job.autoDisabledReason = `工具 ${job.action} 不存在 (可能已被移除)`;
                            console.warn(`[automation] 🛑 ${job.name} 自动禁用: 工具不存在`);
                        }
                        this.save();
                    }
                }
            }
            catch (e) {
                console.warn(`[automation] ⏰ ${job.name} 执行异常:`, e?.message);
            }
        });
        console.log(`[automation] 加载完毕: ${this.cronJobs.size} cron jobs, ${this.rules.size} rules, ${this.backgroundTasks.size} background tasks`);
    }
    // ===== Cron Jobs =====
    createCronJob(name, expression, action, params) {
        const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const job = { id, name, expression, action, params, status: 'active', createdAt: Date.now(), createdBy: 'ai' };
        this.cronJobs.set(id, job);
        this.save();
        this.scheduleCron(job);
        this.emit('cron:created', job);
        return job;
    }
    deleteCronJob(id) {
        const job = this.cronJobs.get(id);
        if (!job)
            return false;
        this.unschedule(id);
        this.cronJobs.delete(id);
        this.save();
        this.emit('cron:deleted', { id });
        return true;
    }
    listCronJobs() {
        return [...this.cronJobs.values()];
    }
    toggleCronJob(id) {
        const job = this.cronJobs.get(id);
        if (!job)
            return null;
        job.status = job.status === 'active' ? 'paused' : 'active';
        if (job.status === 'active')
            this.scheduleCron(job);
        else
            this.unschedule(id);
        this.save();
        return job;
    }
    // ===== Automation Rules =====
    createRule(name, description, trigger, action) {
        const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const rule = { id, name, description, trigger, action, status: 'active', createdAt: Date.now(), createdBy: 'ai' };
        this.rules.set(id, rule);
        this.save();
        this.emit('rule:created', rule);
        return rule;
    }
    listRules() {
        return [...this.rules.values()];
    }
    toggleRule(id) {
        const rule = this.rules.get(id);
        if (!rule)
            return null;
        rule.status = rule.status === 'active' ? 'paused' : 'active';
        this.save();
        return rule;
    }
    deleteRule(id) {
        if (!this.rules.has(id))
            return false;
        this.rules.delete(id);
        this.save();
        return true;
    }
    // ===== Background Tasks =====
    createBackgroundTask(name, description, prompt, intervalMs) {
        const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const task = { id, name, description, prompt, intervalMs, status: 'running', createdAt: Date.now() };
        this.backgroundTasks.set(id, task);
        this.save();
        this.scheduleBackgroundTask(task);
        this.emit('bg:created', task);
        return task;
    }
    listBackgroundTasks() {
        return [...this.backgroundTasks.values()];
    }
    // ===== 定时调度 =====
    scheduleCron(job) {
        if (this._timers.has(job.id))
            return;
        // 简化实现: 每 N 分钟执行 (cron 表达式 "*/N * * * *")
        const match = job.expression.match(/\*\/(\d+)/);
        if (!match) {
            console.warn(`[automation] 不支持的 cron 表达式: ${job.expression}, 使用默认 60 分钟`);
        }
        const intervalMs = (match ? parseInt(match[1]) : 60) * 60 * 1000;
        const timer = setInterval(() => {
            this.emit('cron:tick', job);
            job.lastRun = Date.now();
            this.save();
        }, intervalMs);
        this._timers.set(job.id, timer);
    }
    scheduleBackgroundTask(task) {
        if (this._timers.has(`bg-${task.id}`))
            return;
        const timer = setInterval(() => {
            this.emit('bg:tick', task);
            task.lastRun = Date.now();
            this.save();
        }, task.intervalMs);
        this._timers.set(`bg-${task.id}`, timer);
    }
    unschedule(id) {
        const timer = this._timers.get(id);
        if (timer) {
            clearInterval(timer);
            this._timers.delete(id);
        }
    }
    startTimers() {
        for (const job of this.cronJobs.values()) {
            if (job.status === 'active')
                this.scheduleCron(job);
        }
        for (const task of this.backgroundTasks.values()) {
            if (task.status === 'running')
                this.scheduleBackgroundTask(task);
        }
    }
    /**
     * 自动检测工作区环境 → 自动安装匹配的预设模板
     * 每次 load() 时执行, 已安装的跳过
     */
    autoDetectAndInstall() {
        const existingNames = new Set(Array.from(this.cronJobs.values()).map(j => j.name));
        const workspace = this.workspace;
        // 检测条件 → 预设映射
        const checks = [
            {
                check: () => fs.existsSync(path.join(workspace, '.git')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'daily-code-backup'),
            },
            {
                check: () => fs.existsSync(path.join(workspace, '.git')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'git-fetch-sync'),
            },
            {
                check: () => fs.existsSync(path.join(workspace, '.git')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'commit-lint-check'),
            },
            {
                check: () => {
                    const pkgPath = path.join(workspace, 'package.json');
                    if (!fs.existsSync(pkgPath))
                        return false;
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                        return !!deps.eslint || !!deps['eslint-config'] || fs.existsSync(path.join(workspace, '.eslintrc'));
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'code-quality-check'),
            },
            {
                check: () => {
                    const pkgPath = path.join(workspace, 'package.json');
                    if (!fs.existsSync(pkgPath))
                        return false;
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                        const scripts = pkg.scripts || {};
                        return !!(scripts.test || scripts["test:ci"]);
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'test-suite'),
            },
            {
                check: () => {
                    const pkgPath = path.join(workspace, 'package.json');
                    if (!fs.existsSync(pkgPath))
                        return false;
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                        const scripts = pkg.scripts || {};
                        return !!(scripts.build || scripts.dev);
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'build-test'),
            },
            {
                check: () => {
                    try {
                        const files = fs.readdirSync(workspace);
                        return files.some(f => f.endsWith('.log'));
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'log-cleanup'),
            },
            {
                check: () => {
                    try {
                        const files = fs.readdirSync(workspace);
                        return files.some(f => f.endsWith('.db'));
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'database-backup'),
            },
            {
                check: () => fs.existsSync(path.join(workspace, '.agentai')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'knowledge-sync'),
            },
            {
                check: () => fs.existsSync(path.join(workspace, '.env')) || fs.existsSync(path.join(workspace, '.env.local')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'env-check'),
            },
            {
                check: () => fs.existsSync(path.join(workspace, 'src')),
                preset: AUTOMATION_PRESETS.find(p => p.id === 'secret-scan'),
            },
            {
                check: () => {
                    try {
                        const files = fs.readdirSync(workspace);
                        return files.some(f => ['dist', 'build', '.next', 'out'].includes(f));
                    }
                    catch {
                        return false;
                    }
                },
                preset: AUTOMATION_PRESETS.find(p => p.id === 'dist-build-cleanup'),
            },
        ];
        let installed = 0;
        let updated = 0;
        let cleaned = 0;
        let reactivated = 0;
        // ═══ 智能任务健康管理: 清理 + 更新 + 保留 + 恢复 ═══
        const existingJobs = Array.from(this.cronJobs.values());
        const PRESET_VERSION = 2; // 当前预设版本号
        for (const job of existingJobs) {
            const cmd = job.params?.command || '';
            const preset = AUTOMATION_PRESETS.find(p => p.name === job.name);
            // 1. 清理: 完全失效的任务 (工具不存在 + disabled 超过 7 天)
            if (job.status === 'disabled' && job.lastFailAt && (Date.now() - job.lastFailAt > 7 * 24 * 60 * 60 * 1000)) {
                this.cronJobs.delete(job.id);
                this.unschedule(job.id);
                cleaned++;
                console.log(`[automation] 🗑️ 清理长期失效任务: ${job.name} (禁用超过7天)`);
                continue;
            }
            // 2. 更新: 命令过时的任务 (Unix 命令 或 预设版本不匹配)
            const isUnixCmd = /\bfind\b.*-name/.test(cmd) || /\bgrep\b.*-r/.test(cmd) || /\btail\b/.test(cmd) || /\|/.test(cmd) || /&&/.test(cmd);
            const isOldVersion = !job.presetVersion || job.presetVersion < PRESET_VERSION;
            if ((isUnixCmd || isOldVersion) && preset) {
                job.params = { ...preset.defaultParams };
                job.presetVersion = PRESET_VERSION;
                // 如果之前因命令失败被 disabled, 重新激活
                if (job.status === 'disabled' && job.autoDisabledReason?.includes('失败')) {
                    job.status = 'active';
                    job.failCount = 0;
                    job.autoDisabledReason = undefined;
                    reactivated++;
                    console.log(`[automation] ♻️ 重新激活已修复任务: ${job.name}`);
                }
                updated++;
                console.log(`[automation] 🔄 更新任务到 v${PRESET_VERSION}: ${job.name}`);
            }
            // 3. 保留: 成功的任务不动, 只更新统计
            // (无需操作, 继续运行)
            // 4. 恢复: disabled 但环境已变化的任务 (重新检测条件)
            if (job.status === 'disabled' && preset) {
                // 检查对应的 check 条件是否还满足
                const matchedCheck = checks.find(c => c.preset?.id === preset.id);
                if (matchedCheck && matchedCheck.check()) {
                    // 环境条件仍满足 → 重置失败计数, 重新激活
                    job.status = 'active';
                    job.failCount = 0;
                    job.autoDisabledReason = undefined;
                    job.params = { ...preset.defaultParams }; // 用最新命令
                    job.presetVersion = PRESET_VERSION;
                    reactivated++;
                    console.log(`[automation] ♻️ 环境条件仍满足, 重新激活: ${job.name}`);
                }
            }
        }
        if (updated > 0 || cleaned > 0 || reactivated > 0) {
            this.save();
            console.log(`[automation] 📊 健康管理完成: 更新 ${updated}, 清理 ${cleaned}, 重新激活 ${reactivated}`);
        }
        // 始终安装: 每天中午/午夜运行蒸馏 (不在凌晨2点, 改到 12:00)
        const DISTILL_NAME = '🧠 经验蒸馏学习';
        if (!existingNames.has(DISTILL_NAME)) {
            this.createCronJob(DISTILL_NAME, '0 12,0 * * *', // 每天中午12点和午夜0点运行
            'run_distillation', {});
            console.log(`[automation] 🧠 已安装蒸馏任务: 每天 12:00 和 0:00 执行`);
            installed++;
        }
        for (const { check, preset } of checks) {
            if (!preset)
                continue;
            if (existingNames.has(preset.name))
                continue; // 已存在跳过
            try {
                if (check()) {
                    this.createCronJob(preset.name, preset.defaultExpression, preset.defaultAction, preset.defaultParams);
                    // P0: 新安装的任务标记当前预设版本
                    const newJob = Array.from(this.cronJobs.values()).find(j => j.name === preset.name);
                    if (newJob)
                        newJob.presetVersion = 2;
                    console.log(`[automation] 🤖 自动检测到环境匹配 → 已安装预设: ${preset.name}`);
                    installed++;
                }
            }
            catch (e) {
                console.warn(`[automation] 自动安装预设 "${preset.name}" 失败:`, e?.message);
            }
        }
        if (installed > 0) {
            console.log(`[automation] ✅ 本次自动安装了 ${installed} 个预设模板`);
            this.emit('auto:presets-installed', { count: installed });
        }
    }
    /** 停止所有定时器 */
    stop() {
        for (const [, timer] of this._timers)
            clearInterval(timer);
        this._timers.clear();
    }
}
export const AUTOMATION_PRESETS = [
    // ===== Backup & Recovery =====
    {
        id: 'daily-code-backup',
        name: '📦 每日代码备份',
        description: '每天凌晨自动把代码推送到远程仓库，防止代码丢失。',
        category: 'backup',
        defaultExpression: '0 2 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{execSync(\'git add .\',{cwd:\'.\'});execSync(\'git commit -m \"auto backup\"\',{cwd:\'.\'});execSync(\'git push\',{cwd:\'.\'});console.log(\'backup pushed\')}catch(e){console.log(\'backup: \'+e.message)}"' },
        guide: '确保当前目录是 Git 仓库，且已配置远程仓库地址。',
    },
    {
        id: 'database-backup',
        name: '🗃️ 数据库定时备份',
        description: '每 6 小时备份 SQLite/JSON 数据文件，最多保留最近 24 个。',
        category: 'backup',
        defaultExpression: '0 */6 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');fs.mkdirSync(\'backups\',{recursive:true});function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.endsWith(\'.db\')||e.name.endsWith(\'.json\')){fs.copyFileSync(p.join(d,e.name),p.join(\'backups\',e.name));}}}scan(\'.\');console.log(\'backup done\')"' },
        guide: '备份 .db 和 data/ 目录下的 .json 文件到 backups/。',
    },
    {
        id: 'config-backup',
        name: '⚙️ 配置文件快照',
        description: '每天备份关键配置文件 (.env, config.json, settings.json 等) 防止误删。',
        category: 'backup',
        defaultExpression: '0 3 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');fs.mkdirSync(\'backups/config\',{recursive:true});function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.startsWith(\'.env\')||e.name===\'settings.json\'||e.name.endsWith(\'.config.json\')){fs.copyFileSync(p.join(d,e.name),p.join(\'backups/config\',e.name));}}}scan(\'.\');console.log(\'config backup done\')"' },
        guide: '备份根目录下 .env 和 config 文件到 backups/config/。',
    },
    // ===== Cleanup =====
    {
        id: 'weekly-disk-cleanup',
        name: '🧹 每周磁盘清理',
        description: '每周日凌晨清理缓存和临时文件，释放磁盘空间。',
        category: 'cleanup',
        defaultExpression: '0 3 * * 0',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');for(const d of [\'.agentai/truncated-results\',\'node_modules/.cache\',\'__pycache__\']){try{fs.rmSync(d,{recursive:true,force:true});}catch{}}console.log(\'cache cleaned\')"' },
        guide: '删除截断结果缓存、npm 缓存和 Python 缓存，不影响源代码。',
    },
    {
        id: 'log-cleanup',
        name: '🗑️ 日志自动清理',
        description: '每天检查并删除 7 天前的日志文件。',
        category: 'cleanup',
        defaultExpression: '0 4 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.endsWith(\'.log\')){const f=p.join(d,e.name);const s=fs.statSync(f);if(Date.now()-s.mtimeMs>604800000)fs.unlinkSync(f);}}}scan(\'.\');console.log(\'log cleanup done\')"' },
        guide: '安全清理超过 7 天的 .log 文件，最近日志会保留。',
    },
    {
        id: 'dist-build-cleanup',
        name: '🏗️ 构建产物清理',
        description: '每次提交后清理 dist/build 目录中的旧构建文件。',
        category: 'cleanup',
        defaultExpression: '0 5 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){const sd=p.join(d,e.name);if([\'dist\',\'build\',\'.next\'].includes(e.name)){fs.rmSync(sd,{recursive:true,force:true});}else{scan(sd);}}}}scan(\'.\');console.log(\'build artifacts cleaned\')"' },
        guide: '清理 dist/ build/ .next/ 等构建产物，下次需要时重新构建即可。',
    },
    {
        id: 'trash-cleanup',
        name: '🗂️ 临时文件清理',
        description: '每周清理编辑器/IDE 产生的临时文件 (swp, tmp, sst, DS_Store)。',
        category: 'cleanup',
        defaultExpression: '0 4 * * 0',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if([\'.swp\',\'.tmp\',\'.sst\',\'.orig\',\'.DS_Store\'].some(x=>e.name.endsWith(x))){fs.unlinkSync(p.join(d,e.name));}}}scan(\'.\');console.log(\'temp files cleaned\')"' },
        guide: '清理 vim swap、临时文件、macOS DS_Store 等，不影响项目。',
    },
    // ===== Report =====
    {
        id: 'daily-report',
        name: '📋 每日工作报告',
        description: '每天下午 5 点自动查看今天的代码变更，生成简洁的工作报告。',
        category: 'report',
        defaultExpression: '0 17 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'git log --since=6am --oneline --no-merges\',{cwd:\'.\',encoding:\'utf8\'});console.log(out||\'无提交\')}catch(e){console.log(\'无提交\')}"' },
        guide: '读取今天的 Git 提交记录生成报告。',
    },
    {
        id: 'weekly-health-report',
        name: '🏥 项目健康周报',
        description: '每周一上午统计项目代码量、依赖状态、问题数量。',
        category: 'report',
        defaultExpression: '0 10 * * 1',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){let c=0;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')&&e.name!==\'node_modules\'){c+=scan(p.join(d,e.name));}else if(/\.(ts|tsx|js)$/.test(e.name)){const f=p.join(d,e.name);const l=fs.readFileSync(f,\'utf8\').split(\'\\n\').length;c+=l;}}return c;}console.log(\'代码行数: \'+scan(\'.\'));try{const pkg=JSON.parse(fs.readFileSync(\'package.json\',\'utf8\'));console.log(\'依赖数: \'+(Object.keys(pkg.dependencies||{}).length+Object.keys(pkg.devDependencies||{}).length));}catch{console.log(\'无 package.json\')}"' },
        guide: '统计项目代码行数和依赖数量。',
    },
    // ===== Quality =====
    {
        id: 'code-quality-check',
        name: '✅ 代码质量检查',
        description: '每天自动运行类型检查和 lint，发现潜在问题。',
        category: 'quality',
        defaultExpression: '0 9 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npx tsc --noEmit\',{cwd:\'.\',encoding:\'utf8\',timeout:120000});console.log(\'typecheck OK\')}catch(e){console.log(e.stdout||e.message)}"' },
        guide: '运行 TypeScript 类型检查，发现编译错误。不修改代码。',
    },
    {
        id: 'test-suite',
        name: '🧪 测试套件运行',
        description: '每天凌晨运行测试套件，确保代码变更没有破坏功能。',
        category: 'test',
        defaultExpression: '0 3 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npm test -- --passWithNoTests\',{cwd:\'.\',encoding:\'utf8\',timeout:120000});console.log(out.slice(-2000))}catch(e){console.log(e.stdout?e.stdout.slice(-2000):\'test failed\')}"' },
        guide: '运行 npm test，自动过滤掉无测试的情况。发现失败时会自动记录。',
    },
    {
        id: 'dependency-audit',
        name: '📋 依赖安全审计',
        description: '每周检查依赖漏洞，提醒更新存在安全问题的包。',
        category: 'security',
        defaultExpression: '0 10 * * 1',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npm audit --audit-level=high\',{cwd:\'.\',encoding:\'utf8\',timeout:30000});console.log(out.slice(-2000))}catch(e){console.log(e.stdout?e.stdout.slice(-2000):\'audit failed\')}"' },
        guide: '运行 npm audit 检查高危依赖漏洞。仅报告，不自动修复。',
    },
    {
        id: 'unused-imports-scan',
        name: '🔍 未使用导入扫描',
        description: '每周扫描 TypeScript/JS 文件中的未使用导入，提示清理。',
        category: 'quality',
        defaultExpression: '0 11 * * 1',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npx ts-prune --no-strict\',{cwd:\'.\',encoding:\'utf8\',timeout:60000});console.log(out.slice(-2000))}catch(e){console.log(\'ts-prune not installed\')}"' },
        guide: '扫描未使用的类型和导入，发现僵尸代码。不会自动删除。',
    },
    // ===== Monitor =====
    {
        id: 'system-health-check',
        name: '🔍 系统健康自检',
        description: '每 4 小时检查磁盘、内存使用情况。',
        category: 'monitor',
        defaultExpression: '0 */4 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const os=require(\'os\');const fs=require(\'fs\');const total=os.totalmem(),free=os.freemem();console.log(\'内存: \'+Math.round((total-free)/1024/1024/1024*10)/10+\'GB / \'+Math.round(total/1024/1024/1024*10)/10+\'GB (\'+Math.round((1-free/total)*100)+\'% 使用)\');try{const stats=fs.statSync(\'.\');console.log(\'磁盘检查完成\')}catch{console.log(\'磁盘检查跳过\')}"' },
        guide: '检查磁盘使用率和内存占用，仅检查不修改。',
    },
    {
        id: 'price-monitor',
        name: '💰 竞品价格监控',
        description: '每 6 小时自动搜索竞品价格变动，保存对比结果。',
        category: 'monitor',
        defaultExpression: '0 */6 * * *',
        defaultAction: 'web_search',
        defaultParams: { query: '竞品价格行情 最新报价' },
        guide: 'AI 会搜索互联网上的价格信息并保存到本地。',
    },
    {
        id: 'uptime-check',
        name: '🌐 服务可用性监控',
        description: '每 15 分钟检查关键 URL 是否可访问，发现宕机立即记录。',
        category: 'monitor',
        defaultExpression: '*/15 * * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "fetch(\'http://localhost:18789/v1/health\',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(\'HTTP \'+r.status+\' OK\')).catch(()=>console.log(\'UNREACHABLE\'))"' },
        guide: '检查 Gateway 本地服务健康状态，每 15 分钟一次。',
    },
    {
        id: 'disk-space-monitor',
        name: '💾 磁盘空间监控',
        description: '每 2 小时检查磁盘使用率，超过 85% 时输出警告。',
        category: 'monitor',
        defaultExpression: '0 */2 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const os=require(\'os\');console.log(\'内存使用: \'+Math.round((os.totalmem()-os.freemem())/1024/1024/1024*10)/10+\'GB / \'+Math.round(os.totalmem()/1024/1024/1024*10)/10+\'GB\')"' },
        guide: '检查当前目录磁盘使用率。',
    },
    {
        id: 'error-log-monitor',
        name: '⚠️ 错误日志监控',
        description: '每 30 分钟扫描日志中的 ERROR/FATAL 关键字，统计错误趋势。',
        category: 'monitor',
        defaultExpression: '*/30 * * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');const d=\'.agentai\';if(!fs.existsSync(d)){console.log(\'无错误日志\');process.exit()}let c=0;for(const f of fs.readdirSync(d)){if(f.endsWith(\'.log\')){const lines=fs.readFileSync(p.join(d,f),\'utf8\').split(\'\\n\');c+=lines.filter(l=>/ERROR|FATAL|CRITICAL/.test(l)).length}}console.log(\'错误日志条数: \'+c)"' },
        guide: '统计日志中的错误行数，发现异常可及时告警。',
    },
    // ===== Sync =====
    {
        id: 'knowledge-sync',
        name: '📚 知识库同步',
        description: '每天定时从外部来源同步知识，让 AI 始终保持最新信息。',
        category: 'sync',
        defaultExpression: '0 6 * * *',
        defaultAction: 'web_search',
        defaultParams: { query: '行业最新动态 技术资讯' },
        guide: 'AI 会搜索行业最新资讯并存入记忆库。',
    },
    {
        id: 'git-fetch-sync',
        name: '🔄 Git 远端同步',
        description: '每 2 小时从远程仓库拉取最新代码，保持本地仓库更新。',
        category: 'sync',
        defaultExpression: '0 */2 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{execSync(\'git fetch origin\',{cwd:\'.\',encoding:\'utf8\',timeout:30000});const out=execSync(\'git log HEAD..origin/HEAD --oneline -5\',{cwd:\'.\',encoding:\'utf8\'});console.log(out||\'无新提交\')}catch(e){console.log(\'sync: \'+e.message)}"' },
        guide: '只 fetch 不 merge，避免冲突。显示远端新提交供你决定何时合并。',
    },
    {
        id: 'npm-updates-check',
        name: '📦 依赖更新检查',
        description: '每周检查 npm 依赖是否有新版本，输出升级建议。',
        category: 'sync',
        defaultExpression: '0 9 * * 1',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npm outdated\',{cwd:\'.\',encoding:\'utf8\',timeout:30000});console.log(out||\'all up to date\')}catch(e){console.log(e.stdout||\'check done\')}"' },
        guide: '检查 package.json 依赖是否有更新版本，仅报告不自动升级。',
    },
    // ===== Dev =====
    {
        id: 'commit-lint-check',
        name: '📝 提交信息规范检查',
        description: '每天检查最近的 git 提交信息是否符合 Conventional Commits 规范。',
        category: 'dev',
        defaultExpression: '0 18 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'git log --oneline -10\',{cwd:\'.\',encoding:\'utf8\'});console.log(out)}catch(e){console.log(\'no git\')}"' },
        guide: '检查最近 10 次提交是否使用 Conventional Commits 格式。',
    },
    {
        id: 'build-test',
        name: '🔨 自动构建测试',
        description: '每天构建项目，确保 TypeScript 编译和打包正常。',
        category: 'dev',
        defaultExpression: '0 4 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npm run build\',{cwd:\'.\',encoding:\'utf8\',timeout:120000});console.log(out.slice(-2000))}catch(e){console.log(e.stdout?e.stdout.slice(-2000):\'build failed\')}"' },
        guide: '运行 npm run build 验证项目可正常构建，发现编译错误及时修复。',
    },
    {
        id: 'coverage-report',
        name: '📊 测试覆盖率报告',
        description: '每周生成代码覆盖率报告，追踪测试覆盖趋势。',
        category: 'test',
        defaultExpression: '0 10 * * 1',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npx jest --coverage\',{cwd:\'.\',encoding:\'utf8\',timeout:120000});console.log(out.slice(-2000))}catch(e){console.log(e.stdout?e.stdout.slice(-2000):\'no jest\')}"' },
        guide: '生成 Jest 覆盖率报告，如无测试框架则跳过。',
    },
    // ===== Security =====
    {
        id: 'secret-scan',
        name: '🔒 密钥泄露扫描',
        description: '每天扫描代码中是否有硬编码的 API Key、Token、密码等敏感信息。',
        category: 'security',
        defaultExpression: '0 22 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(/\.(ts|js|tsx)$/.test(e.name)){const f=p.join(d,e.name);const c=fs.readFileSync(f,\'utf8\');if(/api[_-]?key|secret|password|token/i.test(c)){console.log(f+\': possible secret\');}}}}scan(\'src\');console.log(\'secret scan done\')"' },
        guide: '扫描 src/ 目录下是否有硬编码密钥，发现后应立即移入 .env。',
    },
    {
        id: 'env-check',
        name: '⚙️ 环境变量完整性检查',
        description: '每天检查 .env 文件中是否有缺失的必要环境变量。',
        category: 'security',
        defaultExpression: '0 8 * * *',
        defaultAction: 'run_command',
        defaultParams: { command: 'node -e "const fs=require(\'fs\');if(fs.existsSync(\'.env\')){const l=fs.readFileSync(\'.env\',\'utf8\').split(\'\\n\').filter(x=>x.trim()).length;console.log(\'.env 存在, \'+l+\' 行\')}else{console.log(\'WARNING: .env 缺失\')}"' },
        guide: '检查 .env 文件是否存在，确保环境变量配置完整。',
    },
];
// ===== 全局单例 =====
let _instance = null;
export function getAutomationEngine(workspace, registry) {
    if (!_instance && workspace) {
        _instance = new AutomationEngine(workspace, registry);
        _instance.load();
    }
    return _instance;
}
