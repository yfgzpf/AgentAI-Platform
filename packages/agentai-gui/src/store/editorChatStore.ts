/**
 * editorChatStore — 编辑器内 AI 对话独立状态
 * ----------------------------------------------------
 * 与首页 chatStore 完全隔离，不共用消息、不持久化到 localStorage。
 * 编辑器关闭或刷新后消息即丢失（符合编辑器临时对话的预期行为）。
 */
import { create } from 'zustand';
import type { ChatMessage, MessageStatus } from './chatStore';

interface EditorChatState {
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void;
  clearMessages: () => void;
}

const pendingUpdates = new Map<string, ((m: ChatMessage) => ChatMessage)[]>();
let flushTimer: ReturnType<typeof requestAnimationFrame> | null = null;

function scheduleFlush(set: (fn: (s: EditorChatState) => Partial<EditorChatState>) => void) {
  if (flushTimer) return;
  flushTimer = requestAnimationFrame(() => {
    flushTimer = null;
    if (pendingUpdates.size === 0) return;
    const updates = new Map(pendingUpdates);
    pendingUpdates.clear();
    set((s) => ({
      messages: s.messages.map((m) => {
        const fns = updates.get(m.id);
        if (!fns) return m;
        return fns.reduce((acc, fn) => fn(acc), m);
      }),
    }));
  });
}

export const useEditorChatStore = create<EditorChatState>()((set) => ({
  messages: [],
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, fn) => {
    const existing = pendingUpdates.get(id) || [];
    existing.push(fn);
    pendingUpdates.set(id, existing);
    scheduleFlush(set);
  },
  clearMessages: () => set({ messages: [] }),
}));
