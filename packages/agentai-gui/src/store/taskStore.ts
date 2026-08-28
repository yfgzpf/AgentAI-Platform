/**
 * taskStore — 任务管理全局状态 (合并自 taskResumeStore + taskOrchestratorStore)
 * ============================================================
 * 领域: 任务生命周期管理 — 持久化 (恢复/历史) + 实时执行 (编排器)
 *
 * 合并说明 [P1-2]:
 *   - taskResumeStore: 任务持久化/恢复 (persist 到 localStorage)
 *   - taskOrchestratorStore: 实时任务执行跟踪 (类似 Trae 任务面板, 不持久化)
 *   两者状态隔离, 但同属"任务"领域, 合并为单一文件便于维护
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useProfileStore } from '../store';
import {
  listTasks,
  listResumableTasks,
  getTask,
  getTaskContext,
  markTaskStatus as markTaskStatusApi,
  deleteTask as deleteTaskApi,
  cleanupTasks as cleanupTasksApi,
  prepareResume,
  type TaskMeta as ApiTaskMeta,
  type ResumableTask as ApiResumableTask,
  type TaskSnapshot,
  type TaskStatus as ApiTaskStatus,
} from '../services/tasksApi';

// ======================== 类型 (合并自 taskOrchestratorStore) ========================

/** 工具/步骤状态 (与后端 TaskStatus 区分) */
export type StepStatus = 'pending' | 'running' | 'success' | 'failed';
/** 兼容旧导出 (taskOrchestratorStore 原 TaskStatus 别名) */
export type TaskStatus = StepStatus;

/** 单个工具调用记录 */
export interface ToolCallRecord {
  callId: string;
  name: string;
  args: any;
  status: StepStatus;
  result?: string;
  ok?: boolean;
  durationMs?: number;
  startedAt: number;
  finishedAt?: number;
}

/** 代码变更记录 */
export interface CodeChangeRecord {
  filePath: string;
  type: 'created' | 'modified' | 'deleted';
  summary: string;
  diff?: string;
  timestamp: number;
}

/** 沙箱执行记录 */
export interface SandboxRecord {
  id: string;
  code: string;
  language: string;
  status: StepStatus;
  output?: string;
  error?: string;
  exitCode?: number;
  durationMs?: number;
  timestamp: number;
}

/** 任务阶段 */
export interface TaskStage {
  key: string;
  label: string;
  status: StepStatus;
}

/** 一次完整的任务编排 (taskOrchestrator) */
export interface TaskSession {
  id: string;
  goal: string;
  stages: TaskStage[];
  currentStage: string;
  toolCalls: ToolCallRecord[];
  codeChanges: CodeChangeRecord[];
  sandboxRuns: SandboxRecord[];
  startedAt: number;
  finishedAt?: number;
  status: StepStatus;
  needsApproval: boolean;
}

/** 面板显示状态 */
export type PanelMode = 'hidden' | 'expanded' | 'collapsed';

// ======================== Store 状态 ========================

interface TaskState {
  // ===== [taskResume] 持久化任务恢复 =====
  activeTaskId: string | null;
  resumableTasks: ApiResumableTask[];
  allTasks: ApiTaskMeta[];
  currentTask: TaskSnapshot | null;
  taskLoading: boolean;
  taskError: string | null;
  lastRefreshAt: number;

  setActiveTaskId: (taskId: string | null) => void;
  refreshResumable: (userId?: string) => Promise<void>;
  refreshAll: (userId?: string) => Promise<void>;
  loadTask: (taskId: string) => Promise<TaskSnapshot | null>;
  loadContext: (taskId: string) => Promise<string | null>;
  prepareResume: (taskId: string) => Promise<{ context: string; suggestion: string } | null>;
  markCompleted: (taskId: string, note?: string) => Promise<boolean>;
  markFailed: (taskId: string, note?: string) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<boolean>;
  cleanupOld: (maxAgeDays?: number) => Promise<number>;
  clearTaskError: () => void;

  // ===== [taskOrchestrator] 实时任务编排 =====
  activeTask: TaskSession | null;
  lastCompletedTask: TaskSession | null;
  taskHistory: TaskSession[];
  panelMode: PanelMode;
  panelTab: 'progress' | 'tools' | 'changes' | 'sandbox';

  startTask: (id: string, goal: string, stages: TaskStage[]) => void;
  updateStage: (stageKey: string, status: StepStatus) => void;
  addToolCall: (record: ToolCallRecord) => void;
  updateToolCall: (callId: string, result: string, ok: boolean, durationMs: number) => void;
  addCodeChange: (change: CodeChangeRecord) => void;
  addSandboxRun: (run: SandboxRecord) => void;
  updateSandboxRun: (id: string, output: string, error?: string, exitCode?: number, durationMs?: number) => void;
  finishTask: (success?: boolean) => void;
  approveTask: () => void;
  rejectTask: () => void;
  togglePanel: () => void;
  dismissCompleted: () => void;
  setPanelTab: (tab: TaskState['panelTab']) => void;
  clearHistory: () => void;
}

// ======================== Store 实现 ========================

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      // ===== 初始状态: taskResume =====
      activeTaskId: null,
      resumableTasks: [],
      allTasks: [],
      currentTask: null,
      taskLoading: false,
      taskError: null,
      lastRefreshAt: 0,

      setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

      refreshResumable: async (userId) => {
        try {
          const ws = useProfileStore.getState()?.profile?.workspace || localStorage.getItem('agentai.workspace') || '';
          const r = await listResumableTasks(userId, ws);
          if (r.success) {
            set({ resumableTasks: r.tasks, lastRefreshAt: Date.now() });
          }
        } catch (e: any) {
          set({ taskError: e.message });
        }
      },

      refreshAll: async (userId) => {
        set({ taskLoading: true, taskError: null });
        try {
          const ws = useProfileStore.getState()?.profile?.workspace || localStorage.getItem('agentai.workspace') || '';
          const [all, resumable] = await Promise.all([
            listTasks({ userId, limit: 200, workspace: ws }),
            listResumableTasks(userId, ws),
          ]);
          set({
            allTasks: all.success ? all.tasks : [],
            resumableTasks: resumable.success ? resumable.tasks : [],
            taskLoading: false,
            lastRefreshAt: Date.now(),
          });
        } catch (e: any) {
          set({ taskLoading: false, taskError: e.message });
        }
      },

      loadTask: async (taskId) => {
        try {
          const r = await getTask(taskId);
          if (r.success && r.task) {
            set({ currentTask: r.task });
            return r.task;
          }
          set({ taskError: r.error || 'Task not found' });
          return null;
        } catch (e: any) {
          set({ taskError: e.message });
          return null;
        }
      },

      loadContext: async (taskId) => {
        try {
          const r = await getTaskContext(taskId);
          if (r.success && r.context) return r.context;
          return null;
        } catch {
          return null;
        }
      },

      prepareResume: async (taskId) => {
        try {
          const r = await prepareResume(taskId);
          if (r.success && r.context) {
            set({ activeTaskId: taskId });
            return { context: r.context, suggestion: r.suggestion || '' };
          }
          return null;
        } catch (e: any) {
          set({ taskError: e.message });
          return null;
        }
      },

      markCompleted: async (taskId, note) => {
        try {
          const r = await markTaskStatusApi(taskId, 'completed', note);
          if (r.success) {
            if (get().activeTaskId === taskId) set({ activeTaskId: null });
            get().refreshAll();
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      markFailed: async (taskId, note) => {
        try {
          const r = await markTaskStatusApi(taskId, 'failed', note);
          if (r.success) {
            if (get().activeTaskId === taskId) set({ activeTaskId: null });
            get().refreshAll();
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      deleteTask: async (taskId) => {
        try {
          const r = await deleteTaskApi(taskId);
          if (r.success) {
            if (get().activeTaskId === taskId) set({ activeTaskId: null });
            set({
              allTasks: get().allTasks.filter((t) => t.taskId !== taskId),
              resumableTasks: get().resumableTasks.filter((t) => t.taskId !== taskId),
            });
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },

      cleanupOld: async (maxAgeDays = 7) => {
        try {
          const r = await cleanupTasksApi(maxAgeDays);
          if (r.success) {
            get().refreshAll();
            return r.removed;
          }
          return 0;
        } catch {
          return 0;
        }
      },

      clearTaskError: () => set({ taskError: null }),

      // ===== 初始状态: taskOrchestrator =====
      activeTask: null,
      lastCompletedTask: null,
      taskHistory: [],
      panelMode: 'hidden',
      panelTab: 'progress',

      startTask: (id, goal, stages) => {
        const existing = get().activeTask;
        if (existing && existing.status === 'running') {
          const interrupted = { ...existing, status: 'failed' as const, finishedAt: Date.now() };
          set(s => ({
            taskHistory: [interrupted, ...s.taskHistory].slice(0, 20),
            lastCompletedTask: interrupted,
          }));
        }
        set({
          activeTask: {
            id, goal, stages,
            currentStage: stages[0]?.key || 'plan',
            toolCalls: [],
            codeChanges: [],
            sandboxRuns: [],
            startedAt: Date.now(),
            status: 'running',
            needsApproval: false,
          },
          panelMode: 'expanded',
          panelTab: 'progress',
          lastCompletedTask: null,
        });
      },

      updateStage: (stageKey, status) => {
        set(s => {
          if (!s.activeTask) return s;
          const stages = s.activeTask.stages.map(st =>
            st.key === stageKey ? { ...st, status } : st
          );
          const runningIdx = stages.findIndex(st => st.status === 'running');
          const currentStage = runningIdx >= 0 ? stages[runningIdx].key :
            stages.find(st => st.status === 'pending')?.key || s.activeTask!.currentStage;
          return { activeTask: { ...s.activeTask, stages, currentStage } };
        });
      },

      addToolCall: (record) => {
        set(s => {
          if (!s.activeTask) return s;
          return {
            activeTask: { ...s.activeTask, toolCalls: [...s.activeTask.toolCalls, record] },
            panelMode: s.panelMode === 'hidden' ? 'expanded' : s.panelMode,
          };
        });
      },

      updateToolCall: (callId, result, ok, durationMs) => {
        set(s => {
          if (!s.activeTask) return s;
          const toolCalls = s.activeTask.toolCalls.map(tc =>
            tc.callId === callId
              ? { ...tc, status: ok ? ('success' as const) : ('failed' as const), result, ok, durationMs, finishedAt: Date.now() }
              : tc
          );
          return { activeTask: { ...s.activeTask, toolCalls } };
        });
      },

      addCodeChange: (change) => {
        set(s => {
          if (!s.activeTask) return s;
          return { activeTask: { ...s.activeTask, codeChanges: [...s.activeTask.codeChanges, change] } };
        });
      },

      addSandboxRun: (run) => {
        set(s => {
          if (!s.activeTask) return s;
          return { activeTask: { ...s.activeTask, sandboxRuns: [...s.activeTask.sandboxRuns, run] } };
        });
      },

      updateSandboxRun: (id, output, error, exitCode, durationMs) => {
        set(s => {
          if (!s.activeTask) return s;
          const sandboxRuns = s.activeTask.sandboxRuns.map(r =>
            r.id === id
              ? { ...r, status: error ? ('failed' as const) : ('success' as const), output, error, exitCode, durationMs }
              : r
          );
          return { activeTask: { ...s.activeTask, sandboxRuns } };
        });
      },

      finishTask: (success = true) => {
        set(s => {
          if (!s.activeTask) return s;
          const finished: TaskSession = {
            ...s.activeTask,
            status: success ? ('success' as const) : ('failed' as const),
            finishedAt: Date.now(),
          };
          return {
            activeTask: null,
            taskHistory: [finished, ...s.taskHistory].slice(0, 20),
            lastCompletedTask: finished,
            panelMode: 'collapsed',
          };
        });
      },

      approveTask: () => {
        set(s => {
          if (!s.activeTask) return s;
          return { activeTask: { ...s.activeTask, needsApproval: false } };
        });
      },

      rejectTask: () => {
        set(s => {
          if (!s.activeTask) return s;
          const rejected = {
            ...s.activeTask,
            status: 'failed' as const,
            finishedAt: Date.now(),
          };
          return {
            activeTask: null,
            taskHistory: [rejected, ...s.taskHistory].slice(0, 20),
            lastCompletedTask: rejected,
            panelMode: 'collapsed',
          };
        });
      },

      togglePanel: () => set(s => ({
        panelMode: s.panelMode === 'expanded' ? 'collapsed' : 'expanded',
      })),

      dismissCompleted: () => set({
        panelMode: 'hidden',
        lastCompletedTask: null,
      }),

      setPanelTab: (tab) => set({ panelTab: tab }),
      clearHistory: () => set({ taskHistory: [] }),
    }),
    {
      name: 'agentai-task-resume',
      partialize: (s) => ({ activeTaskId: s.activeTaskId }),
    },
  ),
);

// ======================== 兼容导出 (旧 import 可用) ========================

/** @deprecated 请使用 useTaskStore */
export const useTaskResumeStore = useTaskStore;
/** @deprecated 请使用 useTaskStore */
export const useTaskOrchestrator = useTaskStore;