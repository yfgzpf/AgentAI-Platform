import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// 节流 localStorage: 流式输出期间最多每 2 秒写入一次, 避免频繁序列化阻塞主线程
const throttledStorage = (() => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    getItem: (name: string) => {
      try {
        return localStorage.getItem(name);
      } catch (e) {
        console.error('[chatStore] getItem failed:', e);
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      const t = timers.get(name);
      if (t) clearTimeout(t);
      timers.set(name, setTimeout(() => {
        try {
          localStorage.setItem(name, value);
        } catch (e) {
          console.error('[chatStore] setItem failed:', e);
        }
        timers.delete(name);
      }, 2000));
    },
    removeItem: (name: string) => {
      const t = timers.get(name);
      if (t) {
        clearTimeout(t);
        timers.delete(name);
      }
      try {
        localStorage.removeItem(name);
      } catch (e) {
        console.error('[chatStore] removeItem failed:', e);
      }
    },
  };
})();

export type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; callId: string; name: string; args?: any; state?: string; result?: string; ok?: boolean; durationMs?: number }
  | { kind: 'image'; url?: string; base64?: string; alt?: string; filePath?: string }
  | { kind: 'error'; error: string; details?: string; fix?: string }
  | { kind: 'video'; url: string; poster?: string; alt?: string }
  | { kind: 'widget'; title: string; contentType: 'svg' | 'html'; content: string; width?: number | null; height?: number | null };

export type MessageStatus = 'sending' | 'sent' | 'received' | 'processing' | 'done' | 'error';

export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  /** 缓存命中 (自研优化) */
  cacheHit?: boolean;
  /** token 来源: api 官方返回 / estimated 本地估算 */
  source?: 'api' | 'estimated';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  segments: ChatSegment[];
  ts: number;
  provider?: string;
  framework?: string;
  streaming?: boolean;
  status?: MessageStatus;
  usage?: TokenUsage | null;
}

interface ChatState {
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void;
  clearMessages: () => void;
  /** P1-7: 批量替换所有消息 (会话切换时原子操作, 避免闪烁) */
  setMessages: (msgs: ChatMessage[]) => void;
  setMessageStatus: (id: string, status: MessageStatus) => void;
  /** 按 id 批量删除 (用于重新生成) */
  removeMessages: (ids: string[]) => void;
  /** 替换某条消息 (用于重新生成时整体替换) */
  replaceMessage: (id: string, m: ChatMessage) => void;
}

// ═══ updateMessage 微任务刷新: SSE 高频 delta 更新合并, 减少 React 重渲染 ═══
// 使用 Promise.resolve().then() 替代 requestAnimationFrame, 延迟从 ~16ms 降至 ~0ms
const pendingUpdates = new Map<string, ((m: ChatMessage) => ChatMessage)[]>();
let flushScheduled = false;

function scheduleFlush(set: (fn: (s: ChatState) => Partial<ChatState>) => void) {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
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

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      appendMessage: (m) => set((s) => {
        // P1-7: 去重 — 同 ID 消息不重复追加
        if (s.messages.some(x => x.id === m.id)) return s;
        return { messages: [...s.messages, m] };
      }),
      updateMessage: (id, fn) => {
        // 链式合并: 同一消息的多次更新按顺序追加
        const existing = pendingUpdates.get(id) || [];
        existing.push(fn);
        pendingUpdates.set(id, existing);
        scheduleFlush(set);
      },
      clearMessages: () => set({ messages: [] }),
      setMessages: (msgs) => {
        // P1-7: 原子替换 — 先清除 pendingUpdates 避免旧更新污染新消息
        pendingUpdates.clear();
        set({ messages: msgs });
      },
      setMessageStatus: (id, status) => {
        const existing = pendingUpdates.get(id) || [];
        existing.push((m) => ({ ...m, status }));
        pendingUpdates.set(id, existing);
        scheduleFlush(set);
      },
      removeMessages: (ids) => set((s) => {
        const idSet = new Set(ids);
        return { messages: s.messages.filter(m => !idSet.has(m.id)) };
      }),
      replaceMessage: (id, m) => set((s) => ({
        messages: s.messages.map(x => x.id === id ? m : x),
      })),
    }),
    {
      name: 'agentai-chat-messages',
      storage: createJSONStorage(() => throttledStorage),
      partialize: (s) => ({ messages: s.messages.slice(-200) }),
    },
  ),
);
