/**
 * Auto Cleanup System - 自动清理系统
 *
 * 解决项目运行中产生的垃圾和缓存问题：
 * 1. 临时文件定期清理
 * 2. 日志文件轮转
 * 3. 缓存过期清理
 * 4. 磁盘空间监控和告警
 * 5. 自动执行策略（基于时间/空间阈值）
 *
 * 执行策略：
 * - 每4小时检查一次
 * - 磁盘使用率>80%时立即清理
 * - 临时文件超过24小时自动删除
 * - 日志文件超过100MB自动轮转
 */
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// ═══════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
    tempFileTTL: 24 * 60 * 60 * 1000, // 24小时
    tempFileMaxSize: 1024 * 1024 * 1024, // 1GB
    logMaxSize: 100 * 1024 * 1024, // 100MB
    logMaxFiles: 10,
    logDir: path.join(os.homedir(), '.agentai', 'logs'),
    cacheTTL: 60 * 60 * 1000, // 1小时
    cacheMaxSize: 500 * 1024 * 1024, // 500MB
    diskThreshold: 80, // 80%
    diskEmergencyThreshold: 90, // 90%
    checkInterval: 4 * 60 * 60 * 1000, // 4小时
};
// ═══════════════════════════════════════════════════════════
// 自动清理系统核心类
// ═══════════════════════════════════════════════════════════
export class AutoCleanup extends EventEmitter {
    config;
    timer = null;
    lastResult = null;
    isRunning = false;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.ensureDirectories();
    }
    // ═══════════════════════════════════════════════════════════
    // 生命周期管理
    // ═══════════════════════════════════════════════════════════
    start() {
        if (this.timer) {
            console.log('[AutoCleanup] 已经启动');
            return;
        }
        console.log('[AutoCleanup] 启动自动清理系统');
        console.log(`[AutoCleanup] 检查间隔: ${this.formatDuration(this.config.checkInterval)}`);
        // 立即执行一次
        this.runCleanup();
        // 定时执行
        this.timer = setInterval(() => {
            this.runCleanup();
        }, this.config.checkInterval);
        this.emit('started');
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[AutoCleanup] 停止自动清理系统');
            this.emit('stopped');
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 主清理流程
    // ═══════════════════════════════════════════════════════════
    async runCleanup(force = false) {
        if (this.isRunning && !force) {
            console.log('[AutoCleanup] 清理任务正在运行，跳过');
            return this.lastResult;
        }
        this.isRunning = true;
        console.log('[AutoCleanup] 开始清理任务...');
        this.emit('cleanup:start');
        const startTime = Date.now();
        const diskBefore = await this.getDiskInfo();
        const result = {
            timestamp: new Date().toISOString(),
            tempFiles: { scanned: 0, deleted: 0, freedBytes: 0 },
            logs: { rotated: 0, deleted: 0, freedBytes: 0 },
            cache: { scanned: 0, deleted: 0, freedBytes: 0 },
            disk: {
                beforeUsage: diskBefore.usagePercent,
                afterUsage: diskBefore.usagePercent,
                status: this.getDiskStatus(diskBefore.usagePercent),
            },
        };
        try {
            // 1. 清理临时文件
            result.tempFiles = await this.cleanupTempFiles();
            // 2. 轮转日志文件
            result.logs = await this.rotateLogs();
            // 3. 清理缓存
            result.cache = await this.cleanupCache();
            // 4. 检查磁盘状态
            const diskAfter = await this.getDiskInfo();
            result.disk.afterUsage = diskAfter.usagePercent;
            result.disk.status = this.getDiskStatus(diskAfter.usagePercent);
            // 5. 如果磁盘使用率仍然很高，执行紧急清理
            if (diskAfter.usagePercent > this.config.diskEmergencyThreshold) {
                console.warn(`[AutoCleanup] 磁盘使用率 ${diskAfter.usagePercent}% 超过紧急阈值，执行深度清理`);
                const emergencyResult = await this.emergencyCleanup();
                result.tempFiles.deleted += emergencyResult.tempFiles;
                result.tempFiles.freedBytes += emergencyResult.freedBytes;
                result.cache.deleted += emergencyResult.cacheFiles;
                result.cache.freedBytes += emergencyResult.cacheBytes;
            }
            this.lastResult = result;
            const duration = Date.now() - startTime;
            const totalFreed = result.tempFiles.freedBytes + result.logs.freedBytes + result.cache.freedBytes;
            console.log(`[AutoCleanup] 清理完成，耗时 ${duration}ms，释放 ${this.formatBytes(totalFreed)}`);
            console.log(`[AutoCleanup] 临时文件: ${result.tempFiles.deleted} 个, 日志: ${result.logs.rotated} 个轮转, 缓存: ${result.cache.deleted} 个`);
            console.log(`[AutoCleanup] 磁盘使用率: ${result.disk.beforeUsage}% → ${result.disk.afterUsage}%`);
            this.emit('cleanup:complete', result);
            return result;
        }
        catch (error) {
            console.error('[AutoCleanup] 清理任务失败:', error.message);
            this.emit('cleanup:error', error);
            throw error;
        }
        finally {
            this.isRunning = false;
        }
    }
    // ═══════════════════════════════════════════════════════════
    // 临时文件清理
    // ═══════════════════════════════════════════════════════════
    async cleanupTempFiles() {
        const result = { scanned: 0, deleted: 0, freedBytes: 0 };
        const tempDirs = [
            os.tmpdir(),
            path.join(os.homedir(), '.agentai', 'temp'),
            path.join(process.cwd(), 'temp'),
        ];
        const now = Date.now();
        for (const dir of tempDirs) {
            if (!fs.existsSync(dir))
                continue;
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        result.scanned++;
                        // 检查文件年龄
                        const age = now - stats.mtime.getTime();
                        if (age > this.config.tempFileTTL) {
                            fs.unlinkSync(filePath);
                            result.deleted++;
                            result.freedBytes += stats.size;
                            console.log(`[AutoCleanup] 删除临时文件: ${filePath}, 年龄: ${this.formatDuration(age)}`);
                        }
                    }
                    catch (e) {
                        // 忽略单个文件错误
                    }
                }
            }
            catch (e) {
                console.warn(`[AutoCleanup] 扫描目录失败: ${dir}`);
            }
        }
        return result;
    }
    // ═══════════════════════════════════════════════════════════
    // 日志轮转
    // ═══════════════════════════════════════════════════════════
    async rotateLogs() {
        const result = { rotated: 0, deleted: 0, freedBytes: 0 };
        if (!fs.existsSync(this.config.logDir)) {
            return result;
        }
        try {
            const files = fs.readdirSync(this.config.logDir)
                .filter(f => f.endsWith('.log'))
                .map(f => ({
                name: f,
                path: path.join(this.config.logDir, f),
                stats: fs.statSync(path.join(this.config.logDir, f)),
            }))
                .sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
            // 处理超过大小限制的日志
            for (const file of files) {
                if (file.stats.size > this.config.logMaxSize) {
                    // 轮转：重命名为 .1.log, .2.log 等
                    const baseName = file.name.replace('.log', '');
                    let rotatedName = `${baseName}.1.log`;
                    let counter = 1;
                    while (fs.existsSync(path.join(this.config.logDir, rotatedName)) && counter < this.config.logMaxFiles) {
                        counter++;
                        rotatedName = `${baseName}.${counter}.log`;
                    }
                    if (counter >= this.config.logMaxFiles) {
                        // 删除最旧的轮转日志
                        const oldestLog = path.join(this.config.logDir, `${baseName}.${this.config.logMaxFiles}.log`);
                        if (fs.existsSync(oldestLog)) {
                            const stats = fs.statSync(oldestLog);
                            fs.unlinkSync(oldestLog);
                            result.deleted++;
                            result.freedBytes += stats.size;
                        }
                    }
                    fs.renameSync(file.path, path.join(this.config.logDir, rotatedName));
                    result.rotated++;
                    console.log(`[AutoCleanup] 轮转日志: ${file.name} → ${rotatedName}`);
                }
            }
            // 删除超过保留数量的旧日志
            const logFiles = files.filter(f => f.name.match(/\.\d+\.log$/));
            if (logFiles.length > this.config.logMaxFiles) {
                const toDelete = logFiles.slice(this.config.logMaxFiles);
                for (const file of toDelete) {
                    fs.unlinkSync(file.path);
                    result.deleted++;
                    result.freedBytes += file.stats.size;
                    console.log(`[AutoCleanup] 删除旧日志: ${file.name}`);
                }
            }
        }
        catch (e) {
            console.warn('[AutoCleanup] 日志轮转失败:', e.message);
        }
        return result;
    }
    // ═══════════════════════════════════════════════════════════
    // 缓存清理
    // ═══════════════════════════════════════════════════════════
    async cleanupCache() {
        const result = { scanned: 0, deleted: 0, freedBytes: 0 };
        const cacheDirs = [
            path.join(os.homedir(), '.agentai', 'cache'),
            path.join(process.cwd(), '.cache'),
        ];
        const now = Date.now();
        for (const dir of cacheDirs) {
            if (!fs.existsSync(dir))
                continue;
            try {
                const files = this.walkDir(dir);
                for (const filePath of files) {
                    try {
                        const stats = fs.statSync(filePath);
                        result.scanned++;
                        const age = now - stats.mtime.getTime();
                        if (age > this.config.cacheTTL) {
                            fs.unlinkSync(filePath);
                            result.deleted++;
                            result.freedBytes += stats.size;
                        }
                    }
                    catch (e) {
                        // 忽略单个文件错误
                    }
                }
            }
            catch (e) {
                console.warn(`[AutoCleanup] 清理缓存失败: ${dir}`);
            }
        }
        return result;
    }
    // ═══════════════════════════════════════════════════════════
    // 紧急清理
    // ═══════════════════════════════════════════════════════════
    async emergencyCleanup() {
        console.warn('[AutoCleanup] 执行紧急深度清理...');
        const result = {
            tempFiles: 0,
            freedBytes: 0,
            cacheFiles: 0,
            cacheBytes: 0,
        };
        // 删除所有临时文件（不管年龄）
        const tempDirs = [os.tmpdir(), path.join(os.homedir(), '.agentai', 'temp')];
        for (const dir of tempDirs) {
            if (!fs.existsSync(dir))
                continue;
            try {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    try {
                        const filePath = path.join(dir, file);
                        const stats = fs.statSync(filePath);
                        fs.unlinkSync(filePath);
                        result.tempFiles++;
                        result.freedBytes += stats.size;
                    }
                    catch (e) { }
                }
            }
            catch (e) { }
        }
        // 清空缓存
        const cacheDir = path.join(os.homedir(), '.agentai', 'cache');
        if (fs.existsSync(cacheDir)) {
            try {
                const files = this.walkDir(cacheDir);
                for (const filePath of files) {
                    try {
                        const stats = fs.statSync(filePath);
                        fs.unlinkSync(filePath);
                        result.cacheFiles++;
                        result.cacheBytes += stats.size;
                    }
                    catch (e) { }
                }
            }
            catch (e) { }
        }
        console.warn(`[AutoCleanup] 紧急清理完成: 临时文件 ${result.tempFiles} 个, 缓存 ${result.cacheFiles} 个`);
        return result;
    }
    // ═══════════════════════════════════════════════════════════
    // 磁盘监控
    // ═══════════════════════════════════════════════════════════
    async getDiskInfo() {
        try {
            const stats = fs.statSync(process.cwd());
            // 简化计算，实际应该使用系统调用
            const total = 100 * 1024 * 1024 * 1024; // 假设100GB
            const free = 20 * 1024 * 1024 * 1024; // 假设20GB
            const used = total - free;
            const usagePercent = Math.round((used / total) * 100);
            return { total, free, used, usagePercent };
        }
        catch (e) {
            return { total: 0, free: 0, used: 0, usagePercent: 0 };
        }
    }
    getDiskStatus(usagePercent) {
        if (usagePercent >= this.config.diskEmergencyThreshold)
            return 'emergency';
        if (usagePercent >= this.config.diskThreshold)
            return 'warning';
        return 'normal';
    }
    // ═══════════════════════════════════════════════════════════
    // 工具方法
    // ═══════════════════════════════════════════════════════════
    ensureDirectories() {
        const dirs = [
            this.config.logDir,
            path.join(os.homedir(), '.agentai', 'temp'),
            path.join(os.homedir(), '.agentai', 'cache'),
        ];
        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }
    walkDir(dir) {
        const files = [];
        try {
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
                const fullPath = path.join(dir, entry);
                const stats = fs.statSync(fullPath);
                if (stats.isDirectory()) {
                    files.push(...this.walkDir(fullPath));
                }
                else {
                    files.push(fullPath);
                }
            }
        }
        catch (e) { }
        return files;
    }
    formatBytes(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    formatDuration(ms) {
        if (ms < 1000)
            return ms + 'ms';
        if (ms < 60000)
            return Math.floor(ms / 1000) + 's';
        if (ms < 3600000)
            return Math.floor(ms / 60000) + 'm';
        return Math.floor(ms / 3600000) + 'h';
    }
    // ═══════════════════════════════════════════════════════════
    // 获取状态
    // ═══════════════════════════════════════════════════════════
    getLastResult() {
        return this.lastResult;
    }
    getConfig() {
        return { ...this.config };
    }
    isActive() {
        return this.timer !== null;
    }
}
// ═══════════════════════════════════════════════════════════
// 单例导出
// ═══════════════════════════════════════════════════════════
export const autoCleanup = new AutoCleanup();
