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

const TASKS_ROOT = path.join(os.homedir(), '.agentai', 'tasks');

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
  return path.join(TASKS_ROOT, taskId);
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
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[task-snapshot] load failed:', err);
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
  /** 最后更新时间早于该值的视为"超时未响应" (ms) */
  staleThresholdMs?: number;
} = {}): TaskMeta[] {
  if (!fs.existsSync(TASKS_ROOT)) return [];
  const now = Date.now();
  const stale = opts.staleThresholdMs ?? 30 * 60 * 1000; // 默认 30 分钟
  const result: TaskMeta[] = [];

  for (const taskId of fs.readdirSync(TASKS_ROOT)) {
    const taskDir = path.join(TASKS_ROOT, taskId);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const metaPath = path.join(taskDir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;
      // 过滤状态
      if (opts.status && meta.status !== opts.status) continue;
      if (opts.userId && meta.userId !== opts.userId) continue;
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

/** 查找可恢复的任务 (运行中/暂停/超时) */
export function findResumableTasks(userId?: string): TaskMeta[] {
  return listAllTasks({
    status: 'running',
    userId,
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
    const taskDir = path.join(TASKS_ROOT, taskId);
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

// ===== 定期清理: 删除过老的已完成任务 =====

export function cleanupOldTasks(maxAgeDays: number = 30): number {
  if (!fs.existsSync(TASKS_ROOT)) return 0;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const taskId of fs.readdirSync(TASKS_ROOT)) {
    const taskDir = path.join(TASKS_ROOT, taskId);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const metaPath = path.join(taskDir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as TaskMeta;
      // 只清理已完成/失败/废弃的任务
      const statusOk = ['completed', 'failed', 'abandoned'].includes(meta.status);
      const ageOk = meta.lastUpdatedAt < cutoff;
      if (statusOk && ageOk) {
        // 跨平台可靠删除 (Windows 沙箱下 fs.rmSync 可能无效, 退回 cmd rmdir)
        const result = deleteDirReliable(taskDir);
        if (result.ok) {
          removed++;
          console.log(`[task-snapshot] cleanup removed ${taskId} (status=${meta.status}, lastUpdatedAt=${meta.lastUpdatedAt}, method=${result.method})`);
        } else {
          console.warn(`[task-snapshot] cleanup FAILED to remove ${taskDir} (method=${result.method}, error=${result.error})`);
        }
      } else {
        // 减少噪音: 只在 debug 模式下打印 skipped
        // console.log(`[task-snapshot] cleanup skipped ${taskId} ...`);
      }
    } catch (err) {
      console.warn(`[task-snapshot] cleanup error for ${taskId}:`, err);
    }
  }
  return removed;
}

export { TASKS_ROOT };
