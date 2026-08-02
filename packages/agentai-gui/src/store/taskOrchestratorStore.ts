/**
 * taskOrchestratorStore — AI 触发的任务编排器状态管理
 * ----------------------------------------------------
 * 类似 TRAE 的任务跟随面板:
 *   - AI 发起任务 → 面板展开显示
 *   - 任务完成 → 面板折叠为摘要条
 *   - 下一个任务 → 新面板展开
 *   - 无任务 → 不显示
 *
 * 生命周期:
 *   SSE plan_created → startTask() → 面板展开
 *   SSE plan_stage   → updateStage()
 *   SSE tool_start   → addToolCall()
 *   SSE tool_result  → updateToolCall()
 *   SSE done/error   → finishTask() → 延迟折叠
 *   用户手动关闭     → dismissCompleted()
 */
import { create } from 'zustand';

// ===== 类型 =====

export type TaskStatus = 'pending' | 'running' | 'success' | 'failed';

/** 单个工具调用记录 */
export interface ToolCallRecord {
  callId: string;
  name: string;
  args: any;
  status: TaskStatus;
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
  status: TaskStatus;
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
  status: TaskStatus;
}

/** 一次完整的任务编排 */
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
  status: TaskStatus;
  needsApproval: boolean;
}

// ===== Store =====

/** 面板显示状态 */
export type PanelMode = 'hidden' | 'expanded' | 'collapsed';

interface TaskOrchestratorState {
  /** 当前活跃的任务 (同一时间只有一个) */
  activeTask: TaskSession | null;
  /** 最近完成的任务摘要 (用于折叠状态显示) */
  lastCompletedTask: TaskSession | null;
  /** 历史任务 (最近 20 个) */
  taskHistory: TaskSession[];
  /** 面板显示模式: hidden(无任务) / expanded(展开) / collapsed(折叠摘要) */
  panelMode: PanelMode;
  /** 面板当前 tab */
  panelTab: 'progress' | 'tools' | 'changes' | 'sandbox';

  // ===== Actions =====
  /** AI 触发新任务 (SSE plan_created) */
  startTask: (id: string, goal: string, stages: TaskStage[]) => void;
  /** 更新阶段状态 (SSE plan_stage) */
  updateStage: (stageKey: string, status: TaskStatus) => void;
  /** 添加工具调用 (SSE tool_start) */
  addToolCall: (record: ToolCallRecord) => void;
  /** 更新工具调用结果 (SSE tool_result) */
  updateToolCall: (callId: string, result: string, ok: boolean, durationMs: number) => void;
  /** 添加代码变更 (从 tool_result 中解析) */
  addCodeChange: (change: CodeChangeRecord) => void;
  /** 添加沙箱执行 */
  addSandboxRun: (run: SandboxRecord) => void;
  /** 更新沙箱结果 */
  updateSandboxRun: (id: string, output: string, error?: string, exitCode?: number, durationMs?: number) => void;
  /** 任务完成 (SSE done) — 折叠面板, 显示摘要 */
  finishTask: (success?: boolean) => void;
  /** 审批任务 */
  approveTask: () => void;
  /** 拒绝任务 */
  rejectTask: () => void;
  /** 展开/折叠面板 */
  togglePanel: () => void;
  /** 用户手动关闭折叠的摘要 */
  dismissCompleted: () => void;
  /** 切换面板 tab */
  setPanelTab: (tab: TaskOrchestratorState['panelTab']) => void;
  /** 清空历史 */
  clearHistory: () => void;
}

export const useTaskOrchestrator = create<TaskOrchestratorState>((set, get) => ({
  activeTask: null,
  lastCompletedTask: null,
  taskHistory: [],
  panelMode: 'hidden',
  panelTab: 'progress',

  startTask: (id, goal, stages) => {
    const existing = get().activeTask;
    // 如果有正在进行的任务，先移入历史
    if (existing && existing.status === 'running') {
      const interrupted = { ...existing, status: 'failed' as const, finishedAt: Date.now() };
      set(s => ({
        taskHistory: [interrupted, ...s.taskHistory].slice(0, 20),
        lastCompletedTask: interrupted,
      }));
    }
    // AI 触发新任务 → 面板展开
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
      // 自动推进 currentStage
      const runningIdx = stages.findIndex(st => st.status === 'running');
      const currentStage = runningIdx >= 0 ? stages[runningIdx].key :
        stages.find(st => st.status === 'pending')?.key || s.activeTask!.currentStage;
      return {
        activeTask: {
          ...s.activeTask,
          stages,
          currentStage,
        },
      };
    });
  },

  addToolCall: (record) => {
    set(s => {
      if (!s.activeTask) return s;
      return {
        activeTask: {
          ...s.activeTask,
          toolCalls: [...s.activeTask.toolCalls, record],
        },
        // 确保面板可见
        panelMode: s.panelMode === 'hidden' ? 'expanded' : s.panelMode,
      };
    });
  },

  updateToolCall: (callId, result, ok, durationMs) => {
    set(s => {
      if (!s.activeTask) return s;
      const toolCalls = s.activeTask.toolCalls.map(tc =>
        tc.callId === callId
          ? { ...tc, status: ok ? 'success' as const : 'failed' as const, result, ok, durationMs, finishedAt: Date.now() }
          : tc
      );
      return { activeTask: { ...s.activeTask, toolCalls } };
    });
  },

  addCodeChange: (change) => {
    set(s => {
      if (!s.activeTask) return s;
      return {
        activeTask: {
          ...s.activeTask,
          codeChanges: [...s.activeTask.codeChanges, change],
        },
      };
    });
  },

  addSandboxRun: (run) => {
    set(s => {
      if (!s.activeTask) return s;
      return {
        activeTask: {
          ...s.activeTask,
          sandboxRuns: [...s.activeTask.sandboxRuns, run],
        },
      };
    });
  },

  updateSandboxRun: (id, output, error, exitCode, durationMs) => {
    set(s => {
      if (!s.activeTask) return s;
      const sandboxRuns = s.activeTask.sandboxRuns.map(r =>
        r.id === id
          ? { ...r, status: error ? 'failed' as const : 'success' as const, output, error, exitCode, durationMs }
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
        status: success ? 'success' as const : 'failed' as const,
        finishedAt: Date.now(),
      };
      return {
        activeTask: null,
        taskHistory: [finished, ...s.taskHistory].slice(0, 20),
        lastCompletedTask: finished,
        // 完成后折叠面板 (显示摘要)
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
}));
