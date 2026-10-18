/**
 * task-snapshot.ts — 长任务快照与恢复系统
 * =================================================================
 * 目的: 让长任务 (小时/天级) 不因超时、断电、跨会话而丢失
 *
 * 三层设计:
 *   1. 实时增量快照 - 每次关键状态变化自动保存
 *   2. 智能触发 - 接近超时 / 异常退出 / 用户暂停 时强制快照
 *   3. 恢复引擎 - 启动时检测未完成任务, 主动询问用户是否继续
 *
 * 与现有模块关系:
 *   - persistent-memory.ts → session 消息级 (短)
 *   - task-snapshot.ts     → task 任务级 (长) ← 本模块
 *   - 互补: task 包含 session 引用, session 是 task 的执行片段
 *
 * 存储位置:
 *   ~/.agentai/tasks/{taskId}/
 *     ├── snapshot.json       最新快照
 *     ├── history/{ts}.json   历史快照 (滚动保留最近 10)
 *     ├── log.jsonl           任务日志 (append-only, 用于回溯)
 *     └── meta.json           任务元信息 (创建时间, 用户等)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { resolveAgentAiHome } from './workspace-manager.js';

// ===== 类型定义 =====

export type TaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'abandoned';
export type TaskStage = 'plan' | 'solve' | 'verify' | 'fix' | 'report' | 'done';

export interface CompletedStep {
  /** 步骤标识 (如 "create-file", "fix-bug-1") */
  step: string;
  /** 步骤结果摘要 */
  result: string;
  /** 完成时间戳 */
  ts: number;
  /** 关联的工具调用 */
  tools?: string[];
  /** 步骤耗时 (ms) */
  durationMs?: number;
}

export interface KeyDecision {
  /** 决策点描述 */
  decision: string;
  /** 决策理由 */
  reasoning: string;
  /** 决策时间 */
  ts: number;
}

export interface FileTouched {
  path: string;
  action: 'created' | 'modified' | 'deleted' | 'read';
  ts: number;
  /** 备份路径 (如果有) */
  backup?: string;
}

export interface TaskCheckpoint {
  /** 检查点标签 (如 "after-plan", "before-deploy") */
  label: string;
  /** 引用: git commit hash / 备份目录 / etc */
  ref: string;
  /** 时间 */
  ts: number;
  /** 备注 */
  note?: string;
}

export interface ResumeHints {
  /** 下一步应该做什么 */
  nextAction?: string;
  /** 当前阻塞原因 */
  blockers?: string[];
  /** 需要检查的文件 */
  filesToCheck?: string[];
  /** 待验证项 */
  pendingVerifications?: string[];
  /** 警告 (需要注意的坑) */
  warnings?: string[];
}

export interface TaskProgress {
  /** 已完成的步骤 */
  completedSteps: CompletedStep[];
  /** 待完成的步骤 */
  pendingSteps: string[];
  /** 关键决策点 (供恢复时理解"我之前为什么这么做") */
  keyDecisions: KeyDecision[];
}

export interface TaskSnapshot {
  /** 任务唯一 ID */
  taskId: string;
  /** 关联的 session ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 工作空间 */
  workspace: string;
  /** 原始目标 */
  goal: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 当前阶段 (state machine) */
  currentStage: TaskStage;
  /** 当前迭代轮次 */
  iteration: number;
  /** 总工具调用次数 */
  totalToolCalls: number;
  /** 已用 token (估算) */
  totalTokens?: number;
  /** 启动时间 */
  startedAt: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
  /** 结束时间 */
  endedAt?: number;
  /** 进度 */
  progress: TaskProgress;
  /** 上下文摘要 (供恢复时快速理解) */
  contextSummary: string;
  /** 恢复提示 */
  resumeHints: ResumeHints;
  /** 接触过的文件 */
  filesTouched: FileTouched[];
  /** 检查点 */
  checkpoints: TaskCheckpoint[];
  /** 错误历史 (最近 10 个) */
  recentErrors: Array<{ ts: number; tool: string; error: string }>;
}

export interface TaskMeta {
  taskId: string;
  userId: string;
  workspace: string;
  goal: string;
  createdAt: number;
  lastUpdatedAt: number;
  status: TaskStatus;
  /** 摘要 (用于列表展示) */
  summary?: string;
}

export interface TaskLogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  detail?: any;
}

// ===== 路径管理 =====

/**
 * 任务存储根目录（每次调用时解析，不在模块加载时求值）
 * 2026-10-16: 原为模块级 const `path.join(os.homedir(), '.agentai', 'tasks')`。
 * 两个问题:
 *   1. 绕过 AGENTAI_HOME → 桌面版落在 %USERPROFILE%，Docker 落在未挂卷目录（重建即丢）
 *   2. 模块加载时求值 → 进程启动后才设的 AGENTAI_HOME 不生效
 * 改为惰性函数，调用方请改用 `tasksRoot()`。
 */
export function tasksRoot(): string {
  return path.join(resolveAgentAiHome(), 'tasks');
}

/**
 * 可靠删除目录 (跨平台, Windows 沙箱友好)
 * 依次尝试: fs.rmSync → fs.rmdirSync recursive → cmd rmdir → powershell rm → 逐个 unlink
 * 返回: { ok, method, error? }
 */
export function deleteDirReliable(dir: string): { ok: boolean; method: string; error?: string } {
  if (!fs.existsSync(dir)) return { ok: true, method: 'noop-not-exists' };

  // 1. fs.rmSync
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.existsSync(dir)) return { ok: true, method: 'fs.rmSync' };
  } catch { /* try next */ }

  // 2. fs.rmdirSync recursive
  try {
    fs.rmdirSync(dir, { recursive: true });
    if (!fs.existsSync(dir)) return { ok: true, method: 'fs.rmdirSync-recursive' };
  } catch { /* try next */ }

  // 3. cmd rmdir (Windows 沙箱最可靠)
  try {
    execSync(`cmd /c rmdir /s /q "${dir}"`, { stdio: 'ignore' });
    if (!fs.existsSync(dir)) return { ok: true, method: 'cmd-rmdir' };
  } catch { /* try next */ }

  // 4. PowerShell Remove-Item
  try {
    execSync(`powershell -NoProfile -Command "Remove-Item -Path '${dir}' -Recurse -Force"`, { stdio: 'ignore' });
    if (!fs.existsSync(dir)) return { ok: true, method: 'powershell-rm' };
  } catch { /* try next */ }

  // 5. 逐个 unlink + rmdir (最后兜底)
  try {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      try {
        const stat = fs.lstatSync(p);
        if (stat.isDirectory()) {
          try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
        } else {
          try { fs.unlinkSync(p); } catch {}
        }
      } catch {}
    }
    try { fs.rmdirSync(dir); } catch {}
    if (!fs.existsSync(dir)) return { ok: true, method: 'step-by-step' };
  } catch (e: any) {
    return { ok: false, method: 'all-failed', error: e.message };
  }

  return { ok: false, method: 'all-failed', error: 'Directory still exists after all attempts' };
}

function getTaskDir(taskId: string): string {
  return path.join(tasksRoot(), taskId);
}

function ensureDir(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch (err) {
    console.warn('[task-snapshot] mkdir failed:', dir, err);
    return false;
  }
}

// ===== 任务快照管理器 =====

export class TaskSnapshotManager {
  private taskId: string;
  private taskDir: string;
  private snapshot: TaskSnapshot | null = null;
  private dirty = false;
  /** 自动保存节流: 同一秒多次更新合并为一次写盘 */
  private lastWriteAt = 0;
  private writeTimer: NodeJS.Timeout | null = null;
  /** 监听器: 状态变化时通知 */
  private listeners: Array<(snap: TaskSnapshot) => void> = [];

  constructor(taskId: string) {
    this.taskId = taskId;
    this.taskDir = getTaskDir(taskId);
  }

  /** 初始化: 创建任务目录并加载 (如有) 或创建新的快照 */
  init(params: {
    sessionId: string;
    userId: string;
    workspace: string;
    goal: string;
  }): TaskSnapshot {
    if (!ensureDir(this.taskDir)) {
      throw new Error(`Failed to create task dir: ${this.taskDir}`);
    }
    ensureDir(path.join(this.taskDir, 'history'));

    // 尝试加载已有快照
    const existing = this.load();
    if (existing) {
      // 更新 session (新 session 接管)
      existing.sessionId = params.sessionId;
      existing.status = 'running';
      existing.lastUpdatedAt = Date.now();
      this.snapshot = existing;
      this.appendLog('info', 'task-resumed', { taskId: this.taskId, sessionId: params.sessionId });
    } else {
      // 创建新快照
      const now = Date.now();
      this.snapshot = {
        taskId: this.taskId,
        sessionId: params.sessionId,
        userId: params.userId,
        workspace: params.workspace,
        goal: params.goal,
        status: 'running',
        currentStage: 'plan',
        iteration: 0,
        totalToolCalls: 0,
        startedAt: now,
        lastUpdatedAt: now,
        progress: {
          completedSteps: [],
          pendingSteps: [],
          keyDecisions: [],
        },
        contextSummary: '',
        resumeHints: {},
        filesTouched: [],
        checkpoints: [],
        recentErrors: [],
      };
      this.appendLog('info', 'task-created', { taskId: this.taskId, goal: params.goal });
    }

    this.saveMeta();
    // 强制持久化 snapshot.json, 避免首次 init 后 API 立即查询时返回 404
    this.markDirty();
    this.flush();
    return this.snapshot;
  }

  /** 加载已有快照 (用于恢复) */
  load(): TaskSnapshot | null {
    const filePath = path.join(this.taskDir, 'snapshot.json');
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (!raw || !raw.trim()) {
        // 空文件 — 删除并返回 null
        try { fs.unlinkSync(filePath); } catch {}
        return null;
      }
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[task-snapshot] load failed:', err);
      // 损坏的文件 — 删除避免反复报错
      try { fs.unlinkSync(filePath); } catch {}
      return null;
    }
  }

  /** 获取当前快照 (不可变) */
  getSnapshot(): TaskSnapshot {
    if (!this.snapshot) throw new Error('TaskSnapshot not initialized');
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  /** 监听状态变化 */
  onChange(listener: (snap: TaskSnapshot) => void): void {
    this.listeners.push(listener);
  }

  // ===== 更新方法 =====

  /** 更新当前阶段 */
  setStage(stage: TaskStage): void {
    if (!this.snapshot) return;
    this.snapshot.currentStage = stage;
    this.markDirty();
  }

  /** 增加迭代轮次 */
  bumpIteration(): void {
    if (!this.snapshot) return;
    this.snapshot.iteration += 1;
    this.markDirty();
  }

  /** 记录完成的步骤 */
  completeStep(step: string, result: string, tools?: string[], durationMs?: number): void {
    if (!this.snapshot) return;
    this.snapshot.progress.completedSteps.push({
      step, result, ts: Date.now(), tools, durationMs,
    });
    // 从 pending 移除
    this.snapshot.progress.pendingSteps = this.snapshot.progress.pendingSteps.filter(
      s => s !== step
    );
    this.snapshot.totalToolCalls += tools?.length || 1;
    this.markDirty();
  }

  /** 添加待办步骤 */
  addPendingStep(step: string): void {
    if (!this.snapshot) return;
    if (!this.snapshot.progress.pendingSteps.includes(step)) {
      this.snapshot.progress.pendingSteps.push(step);
    }
    this.markDirty();
  }

  /** 记录关键决策 */
  recordDecision(decision: string, reasoning: string): void {
    if (!this.snapshot) return;
    this.snapshot.progress.keyDecisions.push({
      decision, reasoning, ts: Date.now(),
    });
    this.markDirty();
  }

  /** 记录文件接触 */
  recordFileTouch(filePath: string, action: FileTouched['action'], backup?: string): void {
    if (!this.snapshot) return;
    this.snapshot.filesTouched.push({
      path: filePath, action, ts: Date.now(), backup,
    });
    this.markDirty();
  }

  /** 记录检查点 (如 git commit) */
  addCheckpoint(label: string, ref: string, note?: string): void {
    if (!this.snapshot) return;
    this.snapshot.checkpoints.push({
      label, ref, ts: Date.now(), note,
    });
    this.markDirty();
  }

  /** 记录错误 */
  recordError(tool: string, error: string): void {
    if (!this.snapshot) return;
    this.snapshot.recentErrors.push({
      ts: Date.now(), tool, error: error.slice(0, 500),
    });
    // 限制最近 10 个错误
    if (this.snapshot.recentErrors.length > 10) {
      this.snapshot.recentErrors = this.snapshot.recentErrors.slice(-10);
    }
    this.markDirty();
  }

  /** 更新上下文摘要 */
  setContextSummary(summary: string): void {
    if (!this.snapshot) return;
    this.snapshot.contextSummary = summary;
    this.markDirty();
  }

  /** 设置恢复提示 */
  setResumeHints(hints: Partial<ResumeHints>): void {
    if (!this.snapshot) return;
    this.snapshot.resumeHints = { ...this.snapshot.resumeHints, ...hints };
    this.markDirty();
  }

  /** 更新 token 用量 */
  setTotalTokens(tokens: number): void {
    if (!this.snapshot) return;
    this.snapshot.totalTokens = tokens;
    this.markDirty();
  }

  // ===== 状态转换 =====

  /** 暂停任务 (用户主动) */
  pause(reason?: string): void {
    if (!this.snapshot) return;
    this.snapshot.status = 'paused';
    this.appendLog('info', 'task-paused', { reason });
    this.saveMeta();
    this.persist({ force: true });
  }

  /** 完成任务 */
  complete(summary: string): void {
    if (!this.snapshot) return;
    this.snapshot.status = 'completed';
    this.snapshot.endedAt = Date.now();
    this.snapshot.currentStage = 'done';
    this.snapshot.contextSummary = summary;
    this.appendLog('info', 'task-completed', { durationMs: Date.now() - this.snapshot.startedAt });
    this.saveMeta();
    this.persist({ force: true });
  }

  /** 标记失败 */
  fail(error: string): void {
    if (!this.snapshot) return;
    this.snapshot.status = 'failed';
    this.snapshot.endedAt = Date.now();
    this.appendLog('error', 'task-failed', { error });
    this.saveMeta();
    this.persist({ force: true });
  }

  /** 标记为 abandoned (超时无响应) */
  markAbandoned(): void {
    if (!this.snapshot) return;
    this.snapshot.status = 'abandoned';
    this.snapshot.endedAt = Date.now();
    this.appendLog('warn', 'task-abandoned', {});
    this.saveMeta();
    this.persist({ force: true });
  }

  // ===== 持久化 =====

  private markDirty(): void {
    if (!this.snapshot) return;
    this.snapshot.lastUpdatedAt = Date.now();
    this.dirty = true;
    // 节流: 500ms 内合并写盘
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persist();
    }, 500);
    // 通知监听器
    const snap = this.getSnapshot();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* listener 异常不影响主流程 */ }
    }
  }

  private persist(opts: { force?: boolean } = {}): void {
    if (!this.snapshot) return;
    if (!this.dirty && !opts.force) return;

    const filePath = path.join(this.taskDir, 'snapshot.json');
    const tmpPath = filePath + '.tmp';
    try {
      // 原子写入: 先写 .tmp 再重命名
      fs.writeFileSync(tmpPath, JSON.stringify(this.snapshot, null, 2));
      fs.renameSync(tmpPath, filePath);
      this.dirty = false;
      this.lastWriteAt = Date.now();
    } catch (err) {
      console.warn('[task-snapshot] persist failed:', err);
    }
  }

  /** 强制同步写盘 (用于超时前) */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persist({ force: true });
  }

  private saveMeta(): void {
    if (!this.snapshot) return;
    const meta: TaskMeta = {
      taskId: this.snapshot.taskId,
      userId: this.snapshot.userId,
      workspace: this.snapshot.workspace,
      goal: this.snapshot.goal,
      createdAt: this.snapshot.startedAt,
      lastUpdatedAt: this.snapshot.lastUpdatedAt,
      status: this.snapshot.status,
      summary: this.snapshot.contextSummary?.slice(0, 200),
    };
    try {
      fs.writeFileSync(
        path.join(this.taskDir, 'meta.json'),
        JSON.stringify(meta, null, 2)
      );
    } catch (err) {
      console.warn('[task-snapshot] saveMeta failed:', err);
    }
  }

  /** 追加日志 (append-only) */
  appendLog(level: TaskLogEntry['level'], event: string, detail?: any): void {
    if (!this.snapshot) return;
    const entry: TaskLogEntry = { ts: Date.now(), level, event, detail };
    const logPath = path.join(this.taskDir, 'log.jsonl');
    try {
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      console.warn('[task-snapshot] appendLog failed:', err);
    }
  }

  /** 归档历史快照 (保留最近 10 个) */
  archiveSnapshot(): void {
    if (!this.snapshot) return;
    const historyDir = path.join(this.taskDir, 'history');
    if (!ensureDir(historyDir)) return;
    const ts = Date.now();
    try {
      const data = fs.readFileSync(path.join(this.taskDir, 'snapshot.json'), 'utf-8');
      fs.writeFileSync(path.join(historyDir, `${ts}.json`), data);
      // 清理: 保留最近 10 个
      const files = fs.readdirSync(historyDir)
        .filter(f => f.endsWith('.json'))
        .sort();
      if (files.length > 10) {
        for (const f of files.slice(0, files.length - 10)) {
          try { fs.unlinkSync(path.join(historyDir, f)); } catch {}
        }
      }
    } catch (err) {
      console.warn('[task-snapshot] archive failed:', err);
    }
  }
}

// ===== 全局管理器: 跟踪所有活跃任务 =====

const ACTIVE_TASKS = new Map<string, TaskSnapshotManager>();

/** 创建或恢复任务快照 */
export function getOrCreateSnapshot(taskId: string, init?: {
  sessionId: string;
  userId: string;
  workspace: string;
  goal: string;
}): TaskSnapshotManager {
  let mgr = ACTIVE_TASKS.get(taskId);
  if (mgr) return mgr;
  mgr = new TaskSnapshotManager(taskId);
  if (init) mgr.init(init);
  ACTIVE_TASKS.set(taskId, mgr);
  return mgr;
}

/** 列出所有任务 (用于恢复检测) */
export function listAllTasks(opts: {
status?: TaskStatus;
userId?: string;
/** 工作区路径: 只返回该工作区的任务 (工作区隔离) */
workspace?: string;
/** 最后更新时间早于该值的视为"超时未响应" (ms) */
staleThresholdMs?: number;
/** 是否过滤掉无效任务 (trivial goal), 默认 true */
filterTrivial?: boolean;
} = {}): TaskMeta[] {
  if (!fs.existsSync(tasksRoot())) return [];
  const now = Date.now();
  const stale = opts.staleThresholdMs ?? 30 * 60 * 1000; // 默认 30 分钟
  const filterTrivial = opts.filterTrivial ?? true;
  const result: TaskMeta[] = [];

  for (const taskId of fs.readdirSync(tasksRoot())) {
    const taskDir = path.join(tasksRoot(), taskId);
    try {
      if (!fs.statSync(taskDir).isDirectory()) continue;
    } catch { continue; }
    const metaPath = path.join(taskDir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;
      // 过滤状态
      if (opts.status && meta.status !== opts.status) continue;
      if (opts.userId && meta.userId !== opts.userId) continue;
      // 工作区隔离: 只返回当前工作区的任务
      if (opts.workspace && meta.workspace !== opts.workspace) continue;
      // 智能筛选: 过滤掉无效任务 (goal 为 "继续"/"好的" 等琐碎消息)
      if (filterTrivial && !isWorthSnapshotting(meta.goal || '')) continue;
      // 自动标记超时未响应为 abandoned
      if (meta.status === 'running' && (now - meta.lastUpdatedAt) > stale) {
        meta.status = 'abandoned';
      }
      result.push(meta);
    } catch (err) {
      console.warn('[task-snapshot] listAllTasks failed for', taskId, err);
    }
  }

  // 排序: 最近更新优先
  result.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  return result;
}

/** 查找可恢复的任务 (运行中/暂停/超时) — 按工作区隔离 */
export function findResumableTasks(userId?: string, workspace?: string): TaskMeta[] {
  return listAllTasks({
    status: 'running',
    userId,
    workspace,
    staleThresholdMs: 30 * 60 * 1000,
  }).filter(t => t.status === 'running' || t.status === 'abandoned');
}

/** 加载指定任务快照 */
export function loadTaskSnapshot(taskId: string): TaskSnapshot | null {
  const mgr = new TaskSnapshotManager(taskId);
  return mgr.load();
}

/** 标记任务为完成/失败 (从外部) */
export function markTaskStatus(taskId: string, status: 'completed' | 'failed' | 'abandoned', note?: string): boolean {
  const mgr = ACTIVE_TASKS.get(taskId);
  if (mgr) {
    if (status === 'completed') mgr.complete(note || '');
    else if (status === 'failed') mgr.fail(note || '');
    else mgr.markAbandoned();
    return true;
  }
  // 任务管理器不在内存中, 直接修改文件
  const snap = loadTaskSnapshot(taskId);
  if (!snap) return false;
  snap.status = status;
  snap.endedAt = Date.now();
  snap.lastUpdatedAt = Date.now();
  if (note) snap.contextSummary = note;
  if (status === 'completed') snap.currentStage = 'done';
  try {
    const taskDir = path.join(tasksRoot(), taskId);
    fs.writeFileSync(
      path.join(taskDir, 'snapshot.json'),
      JSON.stringify(snap, null, 2)
    );
    // 同步更新 meta.json, 保证 listAllTasks 的 status 过滤生效
    const meta: TaskMeta = {
      taskId: snap.taskId,
      userId: snap.userId,
      workspace: snap.workspace,
      goal: snap.goal,
      createdAt: snap.startedAt,
      lastUpdatedAt: snap.lastUpdatedAt,
      status: snap.status,
      summary: snap.contextSummary?.slice(0, 200),
    };
    fs.writeFileSync(
      path.join(taskDir, 'meta.json'),
      JSON.stringify(meta, null, 2)
    );
    return true;
  } catch {
    return false;
  }
}

/** 生成新任务 ID */
export function generateTaskId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `task-${ts}-${rand}`;
}

/** 格式化恢复提示 (注入 system prompt) */
export function formatResumeContext(snap: TaskSnapshot): string {
  const ageMin = Math.round((Date.now() - snap.startedAt) / 60000);
  const idleMin = Math.round((Date.now() - snap.lastUpdatedAt) / 60000);
  const lines: string[] = [];
  lines.push(`[TASK RESUME] 检测到未完成任务: ${snap.taskId}`);
  lines.push(`目标: ${snap.goal}`);
  lines.push(`工作空间: ${snap.workspace}`);
  lines.push(`状态: ${snap.status} | 阶段: ${snap.currentStage} | 迭代: ${snap.iteration}`);
  lines.push(`开始: ${ageMin}分钟前 | 最后更新: ${idleMin}分钟前`);
  if (snap.progress.completedSteps.length > 0) {
    lines.push(`\n已完成 (${snap.progress.completedSteps.length} 步):`);
    for (const s of snap.progress.completedSteps.slice(-5)) {
      lines.push(`  ✓ ${s.step}: ${s.result.slice(0, 80)}`);
    }
  }
  if (snap.progress.pendingSteps.length > 0) {
    lines.push(`\n待完成 (${snap.progress.pendingSteps.length} 步):`);
    for (const s of snap.progress.pendingSteps.slice(0, 5)) {
      lines.push(`  → ${s}`);
    }
  }
  if (snap.resumeHints.nextAction) {
    lines.push(`\n下一步: ${snap.resumeHints.nextAction}`);
  }
  if (snap.resumeHints.blockers && snap.resumeHints.blockers.length > 0) {
    lines.push(`\n阻塞: ${snap.resumeHints.blockers.join('; ')}`);
  }
  if (snap.contextSummary) {
    lines.push(`\n上下文摘要: ${snap.contextSummary.slice(0, 300)}`);
  }
  if (snap.checkpoints.length > 0) {
    const last = snap.checkpoints[snap.checkpoints.length - 1];
    if (last) lines.push(`\n最后检查点: ${last.label} (${last.ref.slice(0, 12)})`);
  }
  return lines.join('\n');
}

// ===== 智能筛选: 判断消息是否值得创建任务快照 =====

/**
 * 无效消息模式 — 这些消息不值得创建任务快照
 * 分类:
 *   1. 闲聊/确认词: 继续/好的/嗯/ok/yes/no/对/谢谢...
 *   2. 恢复关键词单独出现: 上次/恢复/接着/resume/continue
 *   3. 问候语: 你好/hello/hi/在吗...
 *   4. 单标点/表情: ?/!/👍/...
 */
const TRIVIAL_PATTERNS: RegExp[] = [
  // 纯标点/表情 (无实质文字)
  /^[\s\p{P}\p{S}\u1F000-\u1FFFF]+$/u,
  // 纯数字
  /^\d+$/,
];

/** 无效消息关键词 (精确匹配, 大小写不敏感) */
const TRIVIAL_KEYWORDS = new Set([
  // 闲聊确认
  '继续', '好的', '好啊', '好吧', '行', '可以', '嗯', '嗯嗯', '哦', '哦哦', '噢', '哈', '哈哈', '哈哈哈',
  '对', '不对', '不是', '是的', '没问题', 'OK', 'ok', 'Okay', 'okay', 'Ok',
  'yes', 'no', 'No', 'Yes', 'Y', 'N', 'y', 'n',
  '谢谢', '感谢', 'thanks', 'thank', 'thx', 'ty',
  'done', 'Done', 'DONE', '完成', '已完成', 'finished', '完了',
  '明白', '了解', '收到', '懂了', '知道了', '理解',
  '好', '不好', '行吧', '算了', '没事', '没关系',
  // 恢复关键词单独出现 (无额外上下文)
  '上次', '恢复', '接着', 'resume', 'continue', '上次那个', '还没完成', '未完成',
  // 问候
  '你好', '您好', 'hi', 'Hi', 'HI', 'hello', 'Hello', 'HELLO', '嘿', 'hey', 'Hey',
  '在吗', '在不在', '有人吗', '在么',
  '早上好', '下午好', '晚上好', '早安', '晚安',
  // 指令性短词
  '继续吧', '说吧', '请讲', '请说', '讲', '说',
]);

/**
 * 判断用户消息是否值得创建任务快照
 * 规则:
 *   1. 空消息 → 不值得
 *   2. 纯标点/表情/数字 → 不值得
 *   3. 精确匹配无效关键词 → 不值得
 *   4. 中文 < 3 字 → 不值得
 *   5. 英文 < 6 字符 → 不值得
 *   6. / 开头的指令 (非任务) → 不值得
 *   其余 → 值得
 */
export function isWorthSnapshotting(goal: string): boolean {
  if (!goal || typeof goal !== 'string') return false;
  const trimmed = goal.trim();
  if (!trimmed) return false;

  // / 开头的斜杠指令 (如 /help /clear) 不创建任务
  if (trimmed.startsWith('/')) return false;

  // 纯标点/表情/数字
  for (const pat of TRIVIAL_PATTERNS) {
    if (pat.test(trimmed)) return false;
  }

  // 精确匹配无效关键词 (大小写不敏感)
  const lower = trimmed.toLowerCase();
  if (TRIVIAL_KEYWORDS.has(lower) || TRIVIAL_KEYWORDS.has(trimmed)) return false;

  // 提取纯文字内容 (去掉标点和空格)
  const textOnly = trimmed.replace(/[\s\p{P}\p{S}]/gu, '');

  // 中文消息: 去掉标点后 < 3 字 → 太短
  if (textOnly.length > 0 && /[\u4e00-\u9fff]/.test(textOnly)) {
    if (textOnly.length < 3) return false;
  } else {
    // 纯英文/数字消息: < 6 字符 → 太短
    if (trimmed.length < 6) return false;
  }

  return true;
}

// ===== 定期清理: 删除过老/无效/超量的任务 =====

/** 默认保留天数 */
const DEFAULT_MAX_AGE_DAYS = 7;
/** 默认最大任务数 (超过则删除最老的) */
const DEFAULT_MAX_TASK_COUNT = 50;
/** running 任务超过该天数视为僵死, 自动标记 abandoned */
const STALE_RUNNING_DAYS = 3;

interface CleanupOptions {
  /** 最大保留天数 (默认 7) */
  maxAgeDays?: number;
  /** 最大任务数 (默认 50, 超出则删最老的) */
  maxTaskCount?: number;
  /** 是否同时清理无效任务 (trivial goal), 默认 true */
  removeTrivial?: boolean;
}

interface CleanupResult {
  /** 删除的任务总数 */
  removed: number;
  /** 按原因分类 */
  byReason: {
    expired: number;      // 超龄
    trivial: number;      // 无效/琐碎
    overLimit: number;    // 超量
    staleRunning: number; // 僵死 running
    corrupt: number;      // 损坏 (meta.json 无效)
  };
}

/**
 * 清理任务快照 (增强版)
 * 1. 超龄任务删除 (已完成/失败/废弃, 超过 maxAgeDays)
 * 2. 无效任务删除 (goal 不值得快照, 无论状态)
 * 3. 僵死 running 任务标记 abandoned (超过 staleRunningDays)
 * 4. 超量任务删除 (超过 maxTaskCount, 删最老的已完成任务)
 */
export function cleanupOldTasks(maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): number {
  return cleanupTasks({ maxAgeDays }).removed;
}

/** 完整清理 (返回详细结果) */
export function cleanupTasks(opts: CleanupOptions = {}): CleanupResult {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxTaskCount = opts.maxTaskCount ?? DEFAULT_MAX_TASK_COUNT;
  const removeTrivial = opts.removeTrivial ?? true;

  const result: CleanupResult = {
    removed: 0,
    byReason: { expired: 0, trivial: 0, overLimit: 0, staleRunning: 0, corrupt: 0 },
  };

  if (!fs.existsSync(tasksRoot())) return result;

  const now = Date.now();
  const ageCutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  const staleCutoff = now - STALE_RUNNING_DAYS * 24 * 60 * 60 * 1000;

  // 先收集所有任务的 meta
  const allMeta: Array<{ taskId: string; taskDir: string; meta: TaskMeta }> = [];
  const corruptDirs: string[] = [];

  for (const taskId of fs.readdirSync(tasksRoot())) {
    const taskDir = path.join(tasksRoot(), taskId);
    try {
      if (!fs.statSync(taskDir).isDirectory()) continue;
    } catch { continue; }
    const metaPath = path.join(taskDir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      // 无 meta.json 的孤立目录, 直接删
      corruptDirs.push(taskDir);
      continue;
    }
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;
      allMeta.push({ taskId, taskDir, meta });
    } catch (err) {
      console.warn('[task-snapshot] cleanup: corrupt meta.json for', taskId, err);
      corruptDirs.push(taskDir);
    }
  }

  // 删除损坏的目录
  for (const dir of corruptDirs) {
    const r = deleteDirReliable(dir);
    if (r.ok) {
      result.removed++;
      result.byReason.corrupt++;
    }
  }

  // 按最后更新时间倒序 (最新在前)
  allMeta.sort((a, b) => b.meta.lastUpdatedAt - a.meta.lastUpdatedAt);

  // 标记需要删除的任务
  const toDelete = new Set<string>();

  for (const { taskId, taskDir, meta } of allMeta) {
    let shouldDelete = false;
    let reason = '';

    // 1. 僵死 running 任务 → 标记 abandoned (不直接删, 留待后续规则处理)
    if (meta.status === 'running' && meta.lastUpdatedAt < staleCutoff) {
      meta.status = 'abandoned';
      try {
        fs.writeFileSync(
          path.join(taskDir, 'meta.json'),
          JSON.stringify(meta, null, 2)
        );
      } catch { /* ignore */ }
      result.byReason.staleRunning++;
      console.log(`[task-snapshot] cleanup: stale running → abandoned: ${taskId}`);
    }

    const isFinished = ['completed', 'failed', 'abandoned'].includes(meta.status);

    // 2. 无效任务 (trivial goal) — 无论状态直接删
    if (removeTrivial && !isWorthSnapshotting(meta.goal || '')) {
      shouldDelete = true;
      reason = 'trivial';
    }

    // 3. 超龄已完成任务
    if (!shouldDelete && isFinished && meta.lastUpdatedAt < ageCutoff) {
      shouldDelete = true;
      reason = 'expired';
    }

    if (shouldDelete) {
      toDelete.add(taskId);
      if (reason === 'trivial') result.byReason.trivial++;
      else if (reason === 'expired') result.byReason.expired++;
    }
  }

  // 4. 超量: 已完成任务超过 maxTaskCount → 删最老的
  const survivingFinished = allMeta
    .filter(m => !toDelete.has(m.taskId) && ['completed', 'failed', 'abandoned'].includes(m.meta.status))
    .sort((a, b) => a.meta.lastUpdatedAt - b.meta.lastUpdatedAt); // 最老在前

  if (survivingFinished.length > maxTaskCount) {
    const excess = survivingFinished.slice(0, survivingFinished.length - maxTaskCount);
    for (const { taskId } of excess) {
      toDelete.add(taskId);
      result.byReason.overLimit++;
    }
  }

  // 执行删除
  for (const { taskId, taskDir, meta } of allMeta) {
    if (!toDelete.has(taskId)) continue;
    const r = deleteDirReliable(taskDir);
    if (r.ok) {
      result.removed++;
      console.log(`[task-snapshot] cleanup removed ${taskId} (status=${meta.status}, goal="${(meta.goal || '').slice(0, 40)}", method=${r.method})`);
    } else {
      console.warn(`[task-snapshot] cleanup FAILED to remove ${taskDir} (method=${r.method}, error=${r.error})`);
    }
  }

  return result;
}

// ===== 定时清理循环 =====

let cleanupTimer: NodeJS.Timeout | null = null;

/**
 * 跨进程清理锁（2026-10-16 部署加固）
 * ---------------------------------------------------------------------------
 * 背景: 原本 startTaskCleanupLoop 无条件启动、无实例选主。多副本部署
 * （K8s / docker-compose --scale / PM2 cluster）共享同一个数据卷时，
 * 各实例每 6 小时**并发**对同一批目录执行 `rmSync(recursive, force)`：
 *   - ENOTEMPTY 竞争：一个删到一半另一个也在删 → 报错噪音
 *   - 理论上还可能删掉其他实例正在使用的会话（判定只看 mtime，不看归属）
 *
 * 锁实现: 原子 O_EXCL 创建 `<lock>.lock`，写入本进程 pid + 时间戳。
 * 锁本身带 TTL（默认 6h，略小于清理周期），进程崩溃留下的死锁会被自动过期，
 * 不会永久阻塞清理。
 * @returns true = 本进程抢到锁，应当执行清理
 */
function tryAcquireCleanupLock(ttlMs = 6 * 60 * 60 * 1000): boolean {
  const lockFile = path.join(resolveAgentAiHome(), '.cleanup.lock');
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });

    // 读旧锁：存在且未过期 → 别人正在跑，直接放弃
    if (fs.existsSync(lockFile)) {
      try {
        const st = fs.statSync(lockFile);
        if (Date.now() - st.mtimeMs < ttlMs) return false;
        // 过期死锁 → 删掉重抢
        fs.rmSync(lockFile, { force: true });
      } catch { /* 读锁失败就当它不存在 */ }
    }

    // O_EXCL 保证原子性：多个进程同时创建，只有一个成功
    const fd = fs.openSync(lockFile, 'wx');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      fs.closeSync(fd);
    }
    return true;
  } catch {
    // 抢锁失败（已被别人占 / 目录只读）→ 不清理。宁可磁盘涨也不互删。
    return false;
  }
}

/** 启动定时清理 (每 6 小时执行一次, 启动时立即执行一次) */
export function startTaskCleanupLoop(): void {
  if (cleanupTimer) return;
  /** 2026-10-16: 会话级 checkpoint 存储清扫 ——
   *  与任务快照共用这一个定时器, 不另起 (省一个 setInterval, 也省一处生命周期管理)。
   *  会话废弃后它的 blobs 没人再管, 不清扫就是磁盘只涨不跌。 */
  const sweepCheckpoints = () => {
    try {
      // 动态 import: session-checkpoint 与 task-snapshot 无依赖关系, 但避免顶层环
      import('./session-checkpoint.js')
        .then(m => m.sweepOldSessionsOnce())
        .catch(() => { /* 失败不打扰任务清理 */ });
    } catch { /* ignore */ }
  };
  const runCleanup = () => {
    // 多副本共享卷时只让一个实例干活（单副本部署下总是抢到，无行为变化）
    if (!tryAcquireCleanupLock()) return;
    try {
      const r = cleanupTasks({});
      if (r.removed > 0) {
        console.log(`[task-snapshot] cleanup: removed ${r.removed} tasks (expired=${r.byReason.expired}, trivial=${r.byReason.trivial}, overLimit=${r.byReason.overLimit}, stale=${r.byReason.staleRunning}, corrupt=${r.byReason.corrupt})`);
      }
    } catch (e: any) {
      console.warn('[task-snapshot] cleanup failed:', e?.message);
    }
    sweepCheckpoints();
  };
  // 启动时立即清理一次
  runCleanup();
  // 每 6 小时清理一次
  cleanupTimer = setInterval(runCleanup, 6 * 60 * 60 * 1000);
}

/** 停止定时清理 */
export function stopTaskCleanupLoop(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

