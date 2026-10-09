/**
 * PersistentMemory - 持久记忆系统
 * 对齐 MiMo Code 三层记忆架构
 *
 * 架构:
 *   Session Checkpoint (单 session 对话上下文)
 *       → ~/.agentai/sessions/{sessionId}/checkpoint.json
 *   Project Memory (项目级知识库)
 *       → {workspace}/.agentai/MEMORY.md
 *   Global Memory (全局模式提炼)
 *       → ~/.agentai/global-memory.json
 *
 * 与 SessionManager 的关系:
 *   - SessionManager 管理内存中的活跃 session (LRU)
 *   - PersistentMemory 负责将 session 状态落盘
 *   - Gateway 重启时从磁盘自动恢复
 *
 * 借鉴 MiMo Code 子代理机制:
 *   - Checkpoint-Writer: 异步写入 checkpoint
 *   - 与主对话流解耦, 不阻塞 AI 回复
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceManager } from './workspace-manager.js';
// ===== 路径常量 (通过 WorkspaceManager 动态解析) =====
function getAgentaiDir() {
    return WorkspaceManager.getInstance().aiWorkDir;
}
function getSessionsDir() {
    return WorkspaceManager.getInstance().subdir('sessions');
}
function getGlobalMemoryFile() {
    return WorkspaceManager.getInstance().globalMemoryPath;
}
const MAX_MESSAGES_PER_CHECKPOINT = 200;
const AUTO_SAVE_INTERVAL_MS = 30_000; // 30 秒自动保存一次
// ===== 工具函数 =====
function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function ensureDir(dir) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return true;
    }
    catch (err) {
        console.warn(`[persistent-memory] cannot create dir ${dir}: ${err.message}`);
        return false;
    }
}
function safeReadJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath))
            return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return fallback;
    }
}
// ===== PersistentMemory 类 =====
export class PersistentMemory {
    saveTimer = null;
    checkpointCache = new Map();
    dirtySessions = new Set();
    diskAvailable;
    constructor() {
        const dirOk = ensureDir(getAgentaiDir());
        const sessOk = ensureDir(getSessionsDir());
        this.diskAvailable = dirOk && sessOk;
        if (!this.diskAvailable) {
            console.warn('[persistent-memory] 磁盘不可写, 会话不会持久化到磁盘 (不影响对话)');
        }
        // 启动后台自动保存
        this.startAutoSave();
    }
    // ========================
    // Session Checkpoint (单会话持久化)
    // ========================
    /**
     * 创建一个新的 checkpoint (Gateway 启动时调用)
     */
    createCheckpoint(sessionId, userId, workspace) {
        const checkpoint = {
            sessionId,
            userId,
            workspace,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            callCount: 0,
        };
        this.checkpointCache.set(sessionId, checkpoint);
        this.saveCheckpointToFile(sessionId, checkpoint);
        return checkpoint;
    }
    /**
     * 添加一条消息到 checkpoint
     */
    addMessage(sessionId, message) {
        let checkpoint = this.checkpointCache.get(sessionId);
        if (!checkpoint) {
            // 如果 cache 中没有, 从文件加载
            checkpoint = this.loadCheckpointFromFile(sessionId) ?? undefined;
            if (checkpoint) {
                this.checkpointCache.set(sessionId, checkpoint);
            }
            else {
                // 全新 session
                checkpoint = this.createCheckpoint(sessionId, 'unknown', '.');
            }
        }
        const chatMsg = {
            ...message,
            timestamp: Date.now(),
        };
        checkpoint.messages.push(chatMsg);
        // 限制消息数量 (保留最新 MAX_MESSAGES 条)
        if (checkpoint.messages.length > MAX_MESSAGES_PER_CHECKPOINT) {
            checkpoint.messages = checkpoint.messages.slice(-MAX_MESSAGES_PER_CHECKPOINT);
        }
        checkpoint.updatedAt = Date.now();
        checkpoint.callCount++;
        this.dirtySessions.add(sessionId);
    }
    /**
     * 获取 checkpoint 的消息列表
     */
    getMessages(sessionId) {
        let checkpoint = this.checkpointCache.get(sessionId);
        if (!checkpoint) {
            checkpoint = this.loadCheckpointFromFile(sessionId) ?? undefined;
            if (checkpoint) {
                this.checkpointCache.set(sessionId, checkpoint);
            }
        }
        return checkpoint?.messages ?? [];
    }
    /**
     * 获取 checkpoint (用于恢复 session)
     */
    getCheckpoint(sessionId) {
        let checkpoint = this.checkpointCache.get(sessionId);
        if (!checkpoint) {
            checkpoint = this.loadCheckpointFromFile(sessionId) ?? undefined;
            if (checkpoint) {
                this.checkpointCache.set(sessionId, checkpoint);
            }
        }
        return (checkpoint ?? null);
    }
    /**
     * 更新 checkpoint 元数据
     */
    updateMeta(sessionId, partial) {
        let checkpoint = this.checkpointCache.get(sessionId);
        if (!checkpoint) {
            checkpoint = this.loadCheckpointFromFile(sessionId) ?? undefined;
            if (checkpoint) {
                this.checkpointCache.set(sessionId, checkpoint);
            }
        }
        if (checkpoint) {
            Object.assign(checkpoint, partial);
            checkpoint.updatedAt = Date.now();
            this.dirtySessions.add(sessionId);
        }
    }
    /**
     * 删除 checkpoint
     */
    deleteCheckpoint(sessionId) {
        this.checkpointCache.delete(sessionId);
        this.dirtySessions.delete(sessionId);
        const checkpoint = this.getCheckpoint(sessionId);
        if (checkpoint) {
            const dir = this.getCheckpointDir(sessionId);
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            }
            catch {
                // 静默忽略
            }
        }
    }
    /**
     * 保存到文件 (立即)
     */
    saveCheckpointToFile(sessionId, checkpoint) {
        if (!this.diskAvailable)
            return;
        const dir = this.getCheckpointDir(sessionId);
        if (!ensureDir(dir))
            return;
        const filePath = path.join(dir, 'checkpoint.json');
        try {
            fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
        }
        catch (err) {
            console.warn('[persistent-memory] save failed:', err);
        }
    }
    /**
     * 从文件加载 checkpoint
     */
    loadCheckpointFromFile(sessionId) {
        const filePath = path.join(this.getCheckpointDir(sessionId), 'checkpoint.json');
        return safeReadJson(filePath, null);
    }
    getCheckpointDir(sessionId) {
        return path.join(getSessionsDir(), sessionId);
    }
    // ========================
    // 异步后台持久化 (Checkpoint-Writer)
    // ========================
    /**
     * 启动后台自动保存
     * 借鉴 MiMo Code 的子代理机制: 与主对话流解耦
     */
    startAutoSave() {
        this.saveTimer = setInterval(() => {
            this.flushDirty();
        }, AUTO_SAVE_INTERVAL_MS);
        this.saveTimer.unref?.();
        console.log('[persistent-memory] 后台自动保存已启动 (每30秒)');
    }
    /**
     * 将脏 session 写入磁盘
     */
    flushDirty() {
        if (this.dirtySessions.size === 0)
            return;
        const count = this.dirtySessions.size;
        for (const sessionId of this.dirtySessions) {
            const checkpoint = this.checkpointCache.get(sessionId);
            if (checkpoint) {
                this.saveCheckpointToFile(sessionId, checkpoint);
            }
        }
        this.dirtySessions.clear();
        console.log(`[persistent-memory] 自动保存 ${count} 个 session`);
    }
    /**
     * 立即保存所有 dirty session (用于优雅关闭)
     */
    flushAll() {
        this.flushDirty();
    }
    // P1 修复: 启动后注册定期清理旧 checkpoint (每 6 小时)
    static cleanupRegistered = false;
    static registerPeriodicCleanup() {
        if (PersistentMemory.cleanupRegistered)
            return;
        PersistentMemory.cleanupRegistered = true;
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        const timer = setInterval(() => {
            try {
                const inst = getPersistentMemory();
                const n = inst.cleanupOldCheckpoints(3); // 清理 3 天前的
                if (n > 0)
                    console.log(`[persistent-memory] 🧹 定期清理: 删除 ${n} 个 >3天 的旧 checkpoint`);
            }
            catch { /* ignore */ }
        }, SIX_HOURS);
        timer.unref?.();
    }
    /**
     * 列出所有 checkpoint
     */
    listCheckpoints() {
        const result = [];
        if (!fs.existsSync(getSessionsDir()))
            return result;
        const dirs = fs.readdirSync(getSessionsDir()).filter(d => {
            const dirPath = path.join(getSessionsDir(), d);
            return fs.statSync(dirPath).isDirectory();
        });
        for (const dir of dirs) {
            const checkpoint = this.loadCheckpointFromFile(dir);
            if (checkpoint) {
                this.checkpointCache.set(dir, checkpoint);
                result.push({
                    sessionId: dir,
                    userId: checkpoint.userId,
                    workspace: checkpoint.workspace,
                    createdAt: checkpoint.createdAt,
                    updatedAt: checkpoint.updatedAt,
                    messageCount: checkpoint.messages.length,
                });
            }
        }
        // 按 updatedAt 降序
        result.sort((a, b) => b.updatedAt - a.updatedAt);
        return result;
    }
    /**
     * 列出最近的 sessions (用于注入上下文)
     * @param userId 过滤用户
     * @param limit 最大返回数量
     */
    listRecentSessions(userId, limit = 5) {
        const all = this.listCheckpoints();
        const filtered = userId
            ? all.filter(s => s.userId === userId)
            : all;
        return filtered.slice(0, limit).map(s => {
            const cp = this.getCheckpoint(s.sessionId);
            // 生成更有意义的摘要: 取最近5条用户/助手消息
            const recentMsgs = (cp?.messages || [])
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .slice(-5)
                .map(m => `[${m.role}]: ${(m.content || '').slice(0, 80)}`)
                .join(' | ');
            return {
                sessionId: s.sessionId,
                summary: recentMsgs.slice(0, 300) || undefined,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                callCount: s.messageCount,
            };
        });
    }
    // ========================
    // 全局记忆 (Global Memory)
    // ========================
    /**
     * 加载全局记忆
     */
    loadGlobalMemory() {
        return safeReadJson(getGlobalMemoryFile(), {
            preferences: {},
            commonPatterns: [],
            updatedAt: Date.now(),
        });
    }
    /**
     * 保存全局记忆
     */
    saveGlobalMemory(memory) {
        memory.updatedAt = Date.now();
        try {
            fs.writeFileSync(getGlobalMemoryFile(), JSON.stringify(memory, null, 2));
        }
        catch (err) {
            console.warn('[persistent-memory] global memory save failed:', err);
        }
    }
    /**
     * 添加全局模式
     */
    addPattern(pattern) {
        const memory = this.loadGlobalMemory();
        const fullPattern = {
            ...pattern,
            id: uid(),
            frequency: 0,
            lastTriggered: 0,
        };
        memory.commonPatterns.push(fullPattern);
        this.saveGlobalMemory(memory);
    }
    /**
     * 统计模式使用次数
     */
    incrementPatternUsage(patternId) {
        const memory = this.loadGlobalMemory();
        const pattern = memory.commonPatterns.find(p => p.id === patternId);
        if (pattern) {
            pattern.frequency++;
            pattern.lastTriggered = Date.now();
            this.saveGlobalMemory(memory);
        }
    }
    // ========================
    // 项目记忆 (Project Memory)
    // ========================
    /**
     * 加载项目记忆
     */
    loadProjectMemory(projectPath) {
        const memoryFile = path.join(projectPath, '.agentai', 'MEMORY.md');
        if (!fs.existsSync(memoryFile)) {
            return { projectPath, entries: [], updatedAt: Date.now() };
        }
        try {
            const content = fs.readFileSync(memoryFile, 'utf-8');
            // 简易解析: 从 Markdown 中提取条目
            const entries = [];
            const blocks = content.split(/^## /m);
            for (const block of blocks) {
                if (block.startsWith('MEMORY'))
                    continue; // 跳过标题
                const lines = block.split('\n');
                if (lines.length > 0) {
                    entries.push({
                        id: uid(),
                        category: 'context',
                        content: lines.join('\n').trim(),
                        tags: [],
                        createdAt: Date.now(),
                        lastUsedAt: Date.now(),
                        useCount: 0,
                    });
                }
            }
            return { projectPath, entries, updatedAt: Date.now() };
        }
        catch {
            return { projectPath, entries: [], updatedAt: Date.now() };
        }
    }
    /**
     * v3.1: 跨会话记忆统计 (供 GUI 注入上下文面板使用)
     * 返回: 项目级 + 用户级 + 总记忆条数
     * 数据源:
     *   - 项目级: {workspace}/.agentai/MEMORY.md (loadProjectMemory)
     *   - 用户级: ~/.agentai/memory/global.jsonl (NDJSON)
     */
    getMemoryStats(opts = {}) {
        let projectCount = 0;
        let userCount = 0;
        let lastUpdated = 0;
        // 1. 项目级记忆
        if (opts.workspace) {
            try {
                const pm = this.loadProjectMemory(opts.workspace);
                projectCount = pm.entries.length;
                if (pm.updatedAt > lastUpdated)
                    lastUpdated = pm.updatedAt;
            }
            catch { /* silent */ }
        }
        // 2. 用户级记忆 (全局 NDJSON)
        const globalDir = path.join(os.homedir(), '.agentai', 'memory');
        const globalFile = path.join(globalDir, 'global.jsonl');
        try {
            if (fs.existsSync(globalFile)) {
                const lines = fs.readFileSync(globalFile, 'utf-8').split('\n').filter(l => l.trim());
                userCount = lines.length;
                const stat = fs.statSync(globalFile);
                if (stat.mtimeMs > lastUpdated)
                    lastUpdated = stat.mtimeMs;
            }
        }
        catch { /* silent */ }
        return {
            projectCount,
            userCount,
            totalCount: projectCount + userCount,
            lastUpdated: lastUpdated || Date.now(),
        };
    }
    /**
     * 保存项目记忆条目
     */
    saveProjectEntry(projectPath, entry) {
        const memoryFile = path.join(projectPath, '.agentai', 'MEMORY.md');
        ensureDir(path.dirname(memoryFile));
        const firstLine = (entry.content?.split('\n')[0]?.slice(0, 50)) || 'untitled';
        const md = `## ${firstLine}\n\n${entry.content}\n\n---\n`;
        fs.appendFileSync(memoryFile, md);
    }
    // ========================
    // 会话摘要 (跨会话连续记忆)
    // ========================
    /**
     * 保存会话摘要 (任务结束时调用)
     * 存储到 {workspace}/.agentai/last-session.json
     */
    saveSessionSummary(workspace, summary) {
        try {
            const dir = path.join(workspace, '.agentai');
            ensureDir(dir);
            const file = path.join(dir, 'last-session.json');
            const data = { ...summary, timestamp: Date.now() };
            fs.writeFileSync(file, JSON.stringify(data, null, 2));
        }
        catch (e) {
            console.warn('[persistent-memory] saveSessionSummary failed:', e?.message);
        }
    }
    /**
     * 读取上次会话摘要 (新会话启动时注入上下文)
     */
    getLastSessionSummary(workspace) {
        try {
            const file = path.join(workspace, '.agentai', 'last-session.json');
            if (!fs.existsSync(file))
                return null;
            return JSON.parse(fs.readFileSync(file, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    // ========================
    // 清理 (Dream/Distill)
    // ========================
    /**
     * 清理过期 checkpoint (借鉴 MiMo Code Dream: 7天合并去重)
     */
    cleanupOldCheckpoints(days = 7) {
        if (!fs.existsSync(getSessionsDir()))
            return 0;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        let deleted = 0;
        const dirs = fs.readdirSync(getSessionsDir()).filter(d => {
            const dirPath = path.join(getSessionsDir(), d);
            return fs.statSync(dirPath).isDirectory();
        });
        for (const dir of dirs) {
            const checkpoint = this.loadCheckpointFromFile(dir);
            if (checkpoint && checkpoint.updatedAt < cutoff && !checkpoint.pinned) {
                try {
                    fs.rmSync(path.join(getSessionsDir(), dir), { recursive: true, force: true });
                    this.checkpointCache.delete(dir);
                    deleted++;
                }
                catch {
                    // 忽略删除失败
                }
            }
        }
        if (deleted > 0) {
            console.log(`[persistent-memory] 清理 ${deleted} 个过期 checkpoint (>${days}天)`);
        }
        return deleted;
    }
    /**
     * 停止后台定时器
     */
    stop() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        this.flushAll();
    }
}
// ===== 全局单例 =====
let _instance = null;
export function getPersistentMemory() {
    if (!_instance) {
        _instance = new PersistentMemory();
    }
    return _instance;
}
export function resetPersistentMemory() {
    if (_instance) {
        _instance.stop();
        _instance = null;
    }
}
