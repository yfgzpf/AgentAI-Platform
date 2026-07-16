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

// ===== 类型定义 =====

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** 工具调用 ID (可选) */
  toolCallId?: string;
  /** 工具名称 (可选) */
  toolName?: string;
  timestamp: number;
}

export interface SessionCheckpoint {
  /** Session 唯一标识 */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 工作空间路径 */
  workspace: string;
  /** 消息列表 (最多 200 条, 超过时截断旧消息) */
  messages: ChatMessage[];
  /** Session 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 总 token 用量 (可选) */
  totalTokens?: number;
  /** 总调用次数 */
  callCount: number;
  /** 是否已标记为"重要" (不被 LRU 淘汰) */
  pinned?: boolean;
}

export interface ProjectMemory {
  /** 项目根路径 */
  projectPath: string;
  /** 记忆条目 */
  entries: MemoryEntry[];
  /** 最后更新时间 */
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  category: 'skill' | 'pattern' | 'context' | 'preference';
  content: string;
  tags: string[];
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

export interface GlobalMemory {
  /** 全局偏好设置 */
  preferences: Record<string, any>;
  /** 常用模式提炼 */
  commonPatterns: Pattern[];
  /** 最后更新时间 */
  updatedAt: number;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  trigger: string[];
  action: string[];
  frequency: number;
  lastTriggered: number;
}

// ===== 路径常量 (通过 WorkspaceManager 动态解析) =====

function getAgentaiDir(): string {
  return WorkspaceManager.getInstance().aiWorkDir;
}
function getSessionsDir(): string {
  return WorkspaceManager.getInstance().subdir('sessions');
}
function getGlobalMemoryFile(): string {
  return WorkspaceManager.getInstance().globalMemoryPath;
}
const MAX_MESSAGES_PER_CHECKPOINT = 200;
const AUTO_SAVE_INTERVAL_MS = 30_000; // 30 秒自动保存一次

// ===== 工具函数 =====

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (err: any) {
    console.warn(`[persistent-memory] cannot create dir ${dir}: ${err.message}`);
    return false;
  }
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

// ===== PersistentMemory 类 =====

export class PersistentMemory {
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private checkpointCache = new Map<string, SessionCheckpoint | undefined>();
  private dirtySessions = new Set<string>();
  private diskAvailable: boolean;

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
  createCheckpoint(
    sessionId: string,
    userId: string,
    workspace: string,
  ): SessionCheckpoint {
    const checkpoint: SessionCheckpoint = {
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
  addMessage(sessionId: string, message: Omit<ChatMessage, 'timestamp'>): void {
    let checkpoint = this.checkpointCache.get(sessionId);
    if (!checkpoint) {
      // 如果 cache 中没有, 从文件加载
      checkpoint = this.loadCheckpointFromFile(sessionId) ?? undefined;
      if (checkpoint) {
        this.checkpointCache.set(sessionId, checkpoint);
      } else {
        // 全新 session
        checkpoint = this.createCheckpoint(sessionId, 'unknown', '.');
      }
    }

    const chatMsg: ChatMessage = {
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
  getMessages(sessionId: string): ChatMessage[] {
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
  getCheckpoint(sessionId: string): SessionCheckpoint | null {
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
  updateMeta(
    sessionId: string,
    partial: Partial<Pick<SessionCheckpoint, 'totalTokens' | 'callCount' | 'pinned'>>,
  ): void {
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
  deleteCheckpoint(sessionId: string): void {
    this.checkpointCache.delete(sessionId);
    this.dirtySessions.delete(sessionId);
    const checkpoint = this.getCheckpoint(sessionId);
    if (checkpoint) {
      const dir = this.getCheckpointDir(sessionId);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // 静默忽略
      }
    }
  }

  /**
   * 保存到文件 (立即)
   */
  private saveCheckpointToFile(
    sessionId: string,
    checkpoint: SessionCheckpoint,
  ): void {
    if (!this.diskAvailable) return;
    const dir = this.getCheckpointDir(sessionId);
    if (!ensureDir(dir)) return;
    const filePath = path.join(dir, 'checkpoint.json');
    try {
      fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
    } catch (err) {
      console.warn('[persistent-memory] save failed:', err);
    }
  }

  /**
   * 从文件加载 checkpoint
   */
  private loadCheckpointFromFile(
    sessionId: string,
  ): SessionCheckpoint | null {
    const filePath = path.join(this.getCheckpointDir(sessionId), 'checkpoint.json');
    return safeReadJson<SessionCheckpoint | null>(filePath, null);
  }

  private getCheckpointDir(sessionId: string): string {
    return path.join(getSessionsDir(), sessionId);
  }

  // ========================
  // 异步后台持久化 (Checkpoint-Writer)
  // ========================

  /**
   * 启动后台自动保存
   * 借鉴 MiMo Code 的子代理机制: 与主对话流解耦
   */
  private startAutoSave(): void {
    this.saveTimer = setInterval(() => {
      this.flushDirty();
    }, AUTO_SAVE_INTERVAL_MS);
    this.saveTimer.unref?.();
    console.log('[persistent-memory] 后台自动保存已启动 (每30秒)');
  }

  /**
   * 将脏 session 写入磁盘
   */
  private flushDirty(): void {
    if (this.dirtySessions.size === 0) return;

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
  flushAll(): void {
    this.flushDirty();
  }

  /**
   * 列出所有 checkpoint
   */
  listCheckpoints(): Array<{
    sessionId: string;
    userId: string;
    workspace: string;
    createdAt: number;
    updatedAt: number;
    messageCount: number;
  }> {
    const result: Array<{
      sessionId: string;
      userId: string;
      workspace: string;
      createdAt: number;
      updatedAt: number;
      messageCount: number;
    }> = [];

    if (!fs.existsSync(getSessionsDir())) return result;
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
  listRecentSessions(userId?: string, limit = 5): Array<{
    sessionId: string;
    summary?: string;
    createdAt: number;
    updatedAt: number;
    callCount: number;
  }> {
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
  loadGlobalMemory(): GlobalMemory {
    return safeReadJson<GlobalMemory>(getGlobalMemoryFile(), {
      preferences: {},
      commonPatterns: [],
      updatedAt: Date.now(),
    });
  }

  /**
   * 保存全局记忆
   */
  saveGlobalMemory(memory: GlobalMemory): void {
    memory.updatedAt = Date.now();
    try {
      fs.writeFileSync(getGlobalMemoryFile(), JSON.stringify(memory, null, 2));
    } catch (err) {
      console.warn('[persistent-memory] global memory save failed:', err);
    }
  }

  /**
   * 添加全局模式
   */
  addPattern(pattern: Omit<Pattern, 'frequency' | 'lastTriggered'>): void {
    const memory = this.loadGlobalMemory();
    const fullPattern: Pattern = {
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
  incrementPatternUsage(patternId: string): void {
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
  loadProjectMemory(projectPath: string): ProjectMemory {
    const memoryFile = path.join(projectPath, '.agentai', 'MEMORY.md');
    if (!fs.existsSync(memoryFile)) {
      return { projectPath, entries: [], updatedAt: Date.now() };
    }
    try {
      const content = fs.readFileSync(memoryFile, 'utf-8');
      // 简易解析: 从 Markdown 中提取条目
      const entries: MemoryEntry[] = [];
      const blocks = content.split(/^## /m);
      for (const block of blocks) {
        if (block.startsWith('MEMORY')) continue; // 跳过标题
        const lines = block.split('\n');
        if (lines.length > 0) {
          entries.push({
            id: uid(),
            category: 'context' as const,
            content: lines.join('\n').trim(),
            tags: [],
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            useCount: 0,
          });
        }
      }
      return { projectPath, entries, updatedAt: Date.now() };
    } catch {
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
  getMemoryStats(opts: { workspace?: string; userId?: string } = {}): {
    projectCount: number;
    userCount: number;
    totalCount: number;
    lastUpdated: number;
  } {
    let projectCount = 0;
    let userCount = 0;
    let lastUpdated = 0;

    // 1. 项目级记忆
    if (opts.workspace) {
      try {
        const pm = this.loadProjectMemory(opts.workspace);
        projectCount = pm.entries.length;
        if (pm.updatedAt > lastUpdated) lastUpdated = pm.updatedAt;
      } catch { /* silent */ }
    }

    // 2. 用户级记忆 (全局 NDJSON)
    const globalDir = path.join(os.homedir(), '.agentai', 'memory');
    const globalFile = path.join(globalDir, 'global.jsonl');
    try {
      if (fs.existsSync(globalFile)) {
        const lines = fs.readFileSync(globalFile, 'utf-8').split('\n').filter(l => l.trim());
        userCount = lines.length;
        const stat = fs.statSync(globalFile);
        if (stat.mtimeMs > lastUpdated) lastUpdated = stat.mtimeMs;
      }
    } catch { /* silent */ }

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
  saveProjectEntry(projectPath: string, entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'lastUsedAt' | 'useCount'>): void {
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
  saveSessionSummary(workspace: string, summary: {
    userGoal: string;
    toolsUsed: string[];
    filesModified: string[];
    summary: string;
    taskType?: string;
  }): void {
    try {
      const dir = path.join(workspace, '.agentai');
      ensureDir(dir);
      const file = path.join(dir, 'last-session.json');
      const data = { ...summary, timestamp: Date.now() };
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e: any) {
      console.warn('[persistent-memory] saveSessionSummary failed:', e?.message);
    }
  }

  /**
   * 读取上次会话摘要 (新会话启动时注入上下文)
   */
  getLastSessionSummary(workspace: string): {
    userGoal: string;
    toolsUsed: string[];
    filesModified: string[];
    summary: string;
    taskType?: string;
    timestamp: number;
  } | null {
    try {
      const file = path.join(workspace, '.agentai', 'last-session.json');
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }

  // ========================
  // 清理 (Dream/Distill)
  // ========================

  /**
   * 清理过期 checkpoint (借鉴 MiMo Code Dream: 7天合并去重)
   */
  cleanupOldCheckpoints(days: number = 7): number {
    if (!fs.existsSync(getSessionsDir())) return 0;

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
        } catch {
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
  stop(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    this.flushAll();
  }
}

// ===== 全局单例 =====

let _instance: PersistentMemory | null = null;

export function getPersistentMemory(): PersistentMemory {
  if (!_instance) {
    _instance = new PersistentMemory();
  }
  return _instance;
}

export function resetPersistentMemory(): void {
  if (_instance) {
    _instance.stop();
    _instance = null;
  }
}
