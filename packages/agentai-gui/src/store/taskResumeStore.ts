// @ts-nocheck
/**
 * taskResumeStore.ts — 任务恢复全局状态
 * =======================================
 * 维护:
 *   - 当前激活的 taskId (chat 时附带, 让 AI 加载之前的进度)
 *   - 可恢复任务列表 (running/paused/abandoned)
 *   - 全部任务缓存
 *   - 加载/恢复/标记完成方法
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  listTasks,
  listResumableTasks,
  getTask,
  getTaskContext,
  markTaskStatus as markTaskStatusApi,
  deleteTask as deleteTaskApi,
  cleanupTasks as cleanupTasksApi,
  prepareResume,
  type TaskMeta,
  type ResumableTask,
  type TaskSnapshot,
  type TaskStatus,
} from '../services/tasksApi';

interface TaskResumeState {
  /** 当前激活的 taskId (chat 会附带) */
  activeTaskId: string | null;
  /** 可恢复任务列表 (running/paused/abandoned) */
  resumableTasks: ResumableTask[];
  /** 全部任务缓存 (按 lastUpdatedAt 倒序) */
  allTasks: TaskMeta[];
  /** 当前查看的任务详情 */
  currentTask: TaskSnapshot | null;
  /** 加载状态 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 最后刷新时间 */
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
  clearError: () => void;
}

export const useTaskResumeStore = create<TaskResumeState>()(
  persist(
    (set, get) => ({
      activeTaskId: null,
      resumableTasks: [],
      allTasks: [],
      currentTask: null,
      loading: false,
      error: null,
      lastRefreshAt: 0,

      setActiveTaskId: (taskId) => set({ activeTaskId: taskId }),

      refreshResumable: async (userId) => {
        try {
          const r = await listResumableTasks(userId);
          if (r.success) {
            set({ resumableTasks: r.tasks, lastRefreshAt: Date.now() });
          }
        } catch (e: any) {
          set({ error: e.message });
        }
      },

      refreshAll: async (userId) => {
        set({ loading: true, error: null });
        try {
          const [all, resumable] = await Promise.all([
            listTasks({ userId, limit: 200 }),
            listResumableTasks(userId),
          ]);
          set({
            allTasks: all.success ? all.tasks : [],
            resumableTasks: resumable.success ? resumable.tasks : [],
            loading: false,
            lastRefreshAt: Date.now(),
          });
        } catch (e: any) {
          set({ loading: false, error: e.message });
        }
      },

      loadTask: async (taskId) => {
        try {
          const r = await getTask(taskId);
          if (r.success && r.task) {
            set({ currentTask: r.task });
            return r.task;
          }
          set({ error: r.error || 'Task not found' });
          return null;
        } catch (e: any) {
          set({ error: e.message });
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
            // 恢复后自动设为活跃 taskId
            set({ activeTaskId: taskId });
            return { context: r.context, suggestion: r.suggestion || '' };
          }
          return null;
        } catch (e: any) {
          set({ error: e.message });
          return null;
        }
      },

      markCompleted: async (taskId, note) => {
        try {
          const r = await markTaskStatusApi(taskId, 'completed', note);
          if (r.success) {
            // 清理激活状态
            if (get().activeTaskId === taskId) {
              set({ activeTaskId: null });
            }
            // 刷新列表
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
            if (get().activeTaskId === taskId) {
              set({ activeTaskId: null });
            }
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
            if (get().activeTaskId === taskId) {
              set({ activeTaskId: null });
            }
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

      cleanupOld: async (maxAgeDays = 30) => {
        try {
          const r = await cleanupTasks(maxAgeDays);
          if (r.success) {
            get().refreshAll();
            return r.removed;
          }
          return 0;
        } catch {
          return 0;
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'agentai-task-resume',
      partialize: (s) => ({ activeTaskId: s.activeTaskId }),
    },
  ),
);
