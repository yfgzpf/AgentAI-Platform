// @ts-nocheck
/**
 * tasksApi.ts — 任务快照 API 客户端
 * =====================================
 * 包装 Gateway /v1/tasks/* 全部端点, 给前端组件使用
 */
import { apiGet, apiPost, apiUrl } from './api';

// ===== 类型 (与服务端 task-snapshot.ts 对齐) =====

export type TaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'abandoned';
export type TaskStage = 'plan' | 'solve' | 'verify' | 'fix' | 'report' | 'done';

export interface TaskMeta {
  taskId: string;
  userId: string;
  workspace: string;
  goal: string;
  createdAt: number;
  lastUpdatedAt: number;
  status: TaskStatus;
  summary?: string;
}

export interface TaskSnapshot {
  taskId: string;
  sessionId: string;
  userId: string;
  workspace: string;
  goal: string;
  status: TaskStatus;
  currentStage: TaskStage;
  iteration: number;
  totalToolCalls: number;
  totalTokens?: number;
  startedAt: number;
  lastUpdatedAt: number;
  endedAt?: number;
  progress: {
    completedSteps: Array<{ step: string; result: string; ts: number; tools?: string[] }>;
    pendingSteps: string[];
    keyDecisions: Array<{ decision: string; reasoning: string; ts: number }>;
  };
  contextSummary: string;
  resumeHints: {
    nextAction?: string;
    blockers?: string[];
    filesToCheck?: string[];
    pendingVerifications?: string[];
    warnings?: string[];
  };
  filesTouched: Array<{ path: string; action: string; ts: number }>;
  checkpoints: Array<{ label: string; ref: string; ts: number }>;
  recentErrors: Array<{ ts: number; tool: string; error: string }>;
}

export interface ResumableTask extends TaskMeta {
  resumeContext?: string;
}

// ===== API 调用 =====

/** 列出全部任务 */
export async function listTasks(opts: { userId?: string; status?: TaskStatus; limit?: number } = {}): Promise<{
  success: boolean;
  count: number;
  tasks: TaskMeta[];
  tasksRoot: string;
}> {
  const params = new URLSearchParams();
  if (opts.userId) params.set('userId', opts.userId);
  if (opts.status) params.set('status', opts.status);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiGet(`/v1/tasks${qs ? `?${qs}` : ''}`);
}

/** 列出可恢复任务 (running/paused/abandoned) */
export async function listResumableTasks(userId?: string): Promise<{
  success: boolean;
  count: number;
  tasks: ResumableTask[];
}> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  return apiGet(`/v1/tasks/resumable${qs}`);
}

/** 获取任务快照详情 */
export async function getTask(taskId: string): Promise<{ success: boolean; task?: TaskSnapshot; error?: string }> {
  return apiGet(`/v1/tasks/${encodeURIComponent(taskId)}`);
}

/** 获取格式化的恢复上下文 (注入 LLM) */
export async function getTaskContext(taskId: string): Promise<{
  success: boolean;
  taskId: string;
  context?: string;
  status?: TaskStatus;
  stage?: TaskStage;
  progress?: { completed: number; pending: number };
  error?: string;
}> {
  return apiGet(`/v1/tasks/${encodeURIComponent(taskId)}/context`);
}

/** 标记任务状态 */
export async function markTaskStatus(taskId: string, status: 'completed' | 'failed' | 'abandoned', note?: string): Promise<{
  success: boolean;
  taskId: string;
  status: TaskStatus;
  error?: string;
}> {
  return apiPost(`/v1/tasks/${encodeURIComponent(taskId)}/status`, { status, note });
}

/** 准备恢复任务 (返回 taskId 给前端作为 chat 上下文) */
export async function prepareResume(taskId: string): Promise<{
  success: boolean;
  taskId: string;
  goal?: string;
  status?: TaskStatus;
  context?: string;
  suggestion?: string;
  error?: string;
}> {
  return apiPost(`/v1/tasks/${encodeURIComponent(taskId)}/resume`, {});
}

/** 删除任务 (HTTP DELETE) */
export async function deleteTask(taskId: string): Promise<{ success: boolean; taskId: string; deleted: boolean; method?: string; error?: string }> {
  const url = apiUrl(`/v1/tasks/${encodeURIComponent(taskId)}`);
  try {
    const resp = await fetch(url, { method: 'DELETE' });
    return (await resp.json()) as any;
  } catch (e: any) {
    return { success: false, taskId, deleted: false, error: e.message };
  }
}

/** 清理过期任务 */
export async function cleanupTasks(maxAgeDays = 30): Promise<{ success: boolean; removed: number; maxAgeDays: number }> {
  return apiPost('/v1/tasks/cleanup', { maxAgeDays });
}

// ===== 工具函数 =====

/** 任务持续时间 (人类可读) */
export function taskDuration(snap: TaskMeta | TaskSnapshot): string {
  const end = 'endedAt' in snap && snap.endedAt ? snap.endedAt : Date.now();
  const ms = end - snap.startedAt;
  if (ms < 60_000) return `${Math.round(ms / 1000)}秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}分钟`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}小时`;
  return `${(ms / 86_400_000).toFixed(1)}天`;
}

/** 任务空闲时间 (lastUpdatedAt 距今) */
export function taskIdleMin(meta: TaskMeta): number {
  return Math.round((Date.now() - meta.lastUpdatedAt) / 60_000);
}

/** 状态标签 */
export function statusLabel(s: TaskStatus): string {
  return {
    running: '运行中',
    paused: '已暂停',
    completed: '已完成',
    failed: '失败',
    abandoned: '已放弃',
  }[s] || s;
}

/** 状态颜色 (Antd Tag) */
export function statusColor(s: TaskStatus): string {
  return {
    running: 'processing',
    paused: 'warning',
    completed: 'success',
    failed: 'error',
    abandoned: 'default',
  }[s] || 'default';
}
