/**
 * suggestionStore.ts
 * 全局建议状态管理 — 跨组件共享未读建议数、浮动弹窗
 */

import { create } from 'zustand';

export interface SuggestionItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  action: string;
  category: string;
  urgency: number;
  confidence: number;
  timestamp: number;
  status: 'pending' | 'dismissed' | 'completed';
  userId: string;
  workspace: string;
}

interface SuggestionState {
  /** 所有待处理建议 */
  suggestions: SuggestionItem[];
  /** 未读数量（用户尚未查看主动建议页面的新增建议） */
  unreadCount: number;
  /** 当前正在浮动弹窗中展示的建议（同一时间只展示一条） */
  floatingSuggestion: SuggestionItem | null;
  /** SSE 连接状态 */
  sseConnected: boolean;

  setSuggestions: (items: SuggestionItem[]) => void;
  addSuggestion: (item: SuggestionItem) => void;
  removeSuggestion: (id: string) => void;
  clearSuggestions: () => void;

  markAllRead: () => void;
  setUnreadCount: (n: number) => void;

  showFloating: (item: SuggestionItem) => void;
  dismissFloating: () => void;

  setSseConnected: (v: boolean) => void;
}

export const useSuggestionStore = create<SuggestionState>((set, get) => ({
  suggestions: [],
  unreadCount: 0,
  floatingSuggestion: null,
  sseConnected: false,

  setSuggestions: (items) => {
    const prev = get().suggestions;
    // 新增的建议数 = 新列表中存在但旧列表中不存在的
    const newOnes = items.filter(item => !prev.some(p => p.id === item.id));
    set({
      suggestions: items,
      unreadCount: get().unreadCount + newOnes.length,
    });
    // 如果有高优先级新建议，自动弹出浮动提示
    const urgent = newOnes.find(
      s => s.priority === 'critical' || s.priority === 'high'
    );
    if (urgent && !get().floatingSuggestion) {
      set({ floatingSuggestion: urgent });
    }
  },

  addSuggestion: (item) => {
    const exists = get().suggestions.some(s => s.id === item.id);
    if (exists) return;
    set(state => ({
      suggestions: [item, ...state.suggestions],
      unreadCount: state.unreadCount + 1,
    }));
    // 高优先级建议自动弹出
    if (
      (item.priority === 'critical' || item.priority === 'high') &&
      !get().floatingSuggestion
    ) {
      set({ floatingSuggestion: item });
    }
  },

  removeSuggestion: (id) => {
    set(state => ({
      suggestions: state.suggestions.filter(s => s.id !== id),
    }));
  },

  clearSuggestions: () => set({ suggestions: [], unreadCount: 0 }),

  markAllRead: () => set({ unreadCount: 0 }),
  setUnreadCount: (n) => set({ unreadCount: n }),

  showFloating: (item) => set({ floatingSuggestion: item }),
  dismissFloating: () => set({ floatingSuggestion: null }),

  setSseConnected: (v) => set({ sseConnected: v }),
}));
