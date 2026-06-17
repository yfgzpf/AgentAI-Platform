/**
 * modeStore — 智能模式系统 (4 模式 + 持久化 + 推荐)
 * ----------------------------------------------------
 * 模式:
 *   🔮 auto     — 智能推理 + 自动工具调用
 *   📋 planning — 先规划后审批执行
 *   🔍 review   — 只读分析 + 生成审查报告
 *   📖 readonly — 纯对话，不调用工具
 *
 * 功能:
 *   - 模式切换 (全局 Zustand store)
 *   - 默认模式持久化 (localStorage)
 *   - 智能模式推荐 (AI 检测消息意图推荐更合适的模式)
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppMode = 'auto' | 'planning' | 'review' | 'readonly';

/** 模式配置常量 — 全局唯一配置源 */
export const MODE_CONFIG: Record<AppMode, {
  label: string;
  icon: string;
  color: string;
  desc: string;
  tools: 'all' | 'readonly' | 'none';
  streaming: boolean;
  placeholder: string;
}> = {
  auto: {
    label: '自动',
    icon: '🔮',
    color: '#6366F1',
    desc: '智能推理 + 自动工具调用',
    tools: 'all',
    streaming: true,
    placeholder: '输入消息... (@ 提及文件, / 命令, Enter 发送)',
  },
  planning: {
    label: '规划',
    icon: '📋',
    color: '#F59E0B',
    desc: '先制定计划，确认后执行',
    tools: 'readonly',
    streaming: true,
    placeholder: '描述任务... AI 将先制定执行计划 (Enter 发送)',
  },
  review: {
    label: '审查',
    icon: '🔍',
    color: '#06B6D4',
    desc: '只读分析 + 生成审查报告',
    tools: 'readonly',
    streaming: true,
    placeholder: '指定要审查的文件或代码... (Enter 发送)',
  },
  readonly: {
    label: '只读',
    icon: '📖',
    color: '#10B981',
    desc: '纯对话，不调用工具',
    tools: 'none',
    streaming: false,
    placeholder: '纯对话模式 — 输入问题 (Enter 发送)',
  },
};

/** 按显示顺序排列的模式列表 */
export const MODE_ORDER: AppMode[] = ['auto', 'planning', 'review', 'readonly'];

/** 推荐信息 */
export interface ModeRecommendation {
  mode: AppMode;
  reason: string;
}

interface ModeState {
  /** 当前活跃模式 */
  mode: AppMode;
  /** 切换模式 */
  setMode: (m: AppMode) => void;

  /** 默认模式 (持久化) */
  defaultMode: AppMode;
  setDefaultMode: (m: AppMode) => void;

  /** 推荐的模式 (临时, 用户可忽略) */
  suggestedMode: AppMode | null;
  suggestionReason: string;
  /** 设置推荐 */
  setSuggestedMode: (mode: AppMode | null, reason?: string) => void;
  /** 用户忽略推荐 */
  clearSuggestion: () => void;
  /** 用户接受推荐并切换 */
  acceptSuggestion: () => void;

  /** 智能推荐开关 */
  recommendEnabled: boolean;
  setRecommendEnabled: (v: boolean) => void;
}

export const useModeStore = create<ModeState>()(
  persist(
    (set, get) => ({
      mode: 'auto',
      setMode: (mode) => set({ mode }),

      defaultMode: 'auto',
      setDefaultMode: (defaultMode) => set({ defaultMode }),

      suggestedMode: null,
      suggestionReason: '',
      setSuggestedMode: (suggestedMode, reason = '') => set({ suggestedMode, suggestionReason: reason }),
      clearSuggestion: () => set({ suggestedMode: null, suggestionReason: '' }),
      acceptSuggestion: () => {
        const { suggestedMode } = get();
        if (suggestedMode) {
          set({ mode: suggestedMode, suggestedMode: null, suggestionReason: '' });
        }
      },

      recommendEnabled: true,
      setRecommendEnabled: (recommendEnabled) => set({ recommendEnabled }),
    }),
    {
      name: 'agentai.mode',
      storage: createJSONStorage(() => localStorage),
      // 只持久化 defaultMode 和 recommendEnabled
      partialize: (state) => ({
        defaultMode: state.defaultMode,
        recommendEnabled: state.recommendEnabled,
      }),
      // 恢复时用 defaultMode 初始化 mode
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.mode = state.defaultMode;
        }
      },
    },
  ),
);
