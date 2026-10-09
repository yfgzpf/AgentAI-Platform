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
  | { kind: 'tool'; callId: string; name: string; args?: Record<string, unknown>; state?: string; result?: string; ok?: boolean; durationMs?: number; data?: Record<string, unknown> }
  | { kind: 'image'; url?: string; base64?: string; alt?: string; filePath?: string }
  | { kind: 'error'; error: string; details?: string; fix?: string }
  | { kind: 'video'; url: string; poster?: string; alt?: string }
  | { kind: 'widget'; title: string; contentType: 'svg' | 'html'; content: string; width?: number | null; height?: number | null };

export type MessageStatus = 'sending' | 'sent' | 'received' | 'processing' | 'done' | 'error';

export interface InjectedFile {
  path: string;
  name: string;
  content?: string;
  injectedAt: number;
}

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
  // ===== [P1-2] 合并自 editorChatStore: 编辑器内 AI 对话独立状态 =====
  /** 编辑器内对话消息 (不持久化, 编辑器关闭即丢失) */
  editorMessages: ChatMessage[];
  appendEditorMessage: (m: ChatMessage) => void;
  updateEditorMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void;
  clearEditorMessages: () => void;
  // ===== [P1-2] 合并自 contextStore: 注入到 AI 上下文的文件 =====
  /** 已注入的文件列表 */
  injectedFiles: InjectedFile[];
  /** 添加文件到上下文 */
  addInjectedFile: (file: Omit<InjectedFile, 'injectedAt'>) => void;
  /** 从上下文中移除文件 */
  removeInjectedFile: (path: string) => void;
  /** 清空所有注入的文件 */
  clearInjectedFiles: () => void;
  /** 检查文件是否已注入 */
  isFileInjected: (path: string) => boolean;
  /** 获取所有注入文件的内容（用于发送到后端） */
  getInjectedFilesContent: () => { path: string; name: string; content: string }[];
}

// ═══ updateMessage 合帧刷新: SSE 高频 delta 更新合并, 减少 React 重渲染 ═══
// 2026-09-04 优化: 原 queueMicrotask 只合并"同一宏任务内的同步帧"; SSE 每个网络包是独立任务,
// 高频流式时仍每包渲染一次(整树 + 流式文本全量 Markdown 重解析)。改为 rAF 合帧(≤60次/秒),
// 并用 100ms setTimeout 兜底, 避免后台标签页 rAF 被冻结时流式渲染卡死。
const pendingUpdates = new Map<string, ((m: ChatMessage) => ChatMessage)[]>();
let flushScheduled = false;
let flushRafToken: number | null = null;
let flushSafetyTimer: ReturnType<typeof setTimeout> | null = null;

function doFlush(set: (fn: (s: ChatState) => Partial<ChatState>) => void) {
  flushScheduled = false;
  if (flushRafToken !== null) { cancelAnimationFrame(flushRafToken); flushRafToken = null; }
  if (flushSafetyTimer !== null) { clearTimeout(flushSafetyTimer); flushSafetyTimer = null; }
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
}

function scheduleFlush(set: (fn: (s: ChatState) => Partial<ChatState>) => void) {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestAnimationFrame === 'function') {
    flushRafToken = requestAnimationFrame(() => doFlush(set));
  }
  // 兜底: rAF 在后台标签页不触发; 若 100ms 内未合帧则强制 flush 一次
  flushSafetyTimer = setTimeout(() => doFlush(set), 100);
}

// ═══ [P1-2] 合并自 editorChatStore: 编辑器消息使用 requestAnimationFrame 批量更新 ═══
const editorPendingUpdates = new Map<string, ((m: ChatMessage) => ChatMessage)[]>();
let editorFlushTimer: ReturnType<typeof requestAnimationFrame> | null = null;

function scheduleEditorFlush(set: (fn: (s: ChatState) => Partial<ChatState>) => void) {
  if (editorFlushTimer) return;
  editorFlushTimer = requestAnimationFrame(() => {
    editorFlushTimer = null;
    if (editorPendingUpdates.size === 0) return;
    const updates = new Map(editorPendingUpdates);
    editorPendingUpdates.clear();
    set((s) => ({
      editorMessages: s.editorMessages.map((m) => {
        const fns = updates.get(m.id);
        if (!fns) return m;
        return fns.reduce((acc, fn) => fn(acc), m);
      }),
    }));
  });
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
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
      // ===== [P1-2] 合并自 editorChatStore =====
      editorMessages: [],
      appendEditorMessage: (m) => set((s) => ({ editorMessages: [...s.editorMessages, m] })),
      updateEditorMessage: (id, fn) => {
        const existing = editorPendingUpdates.get(id) || [];
        existing.push(fn);
        editorPendingUpdates.set(id, existing);
        scheduleEditorFlush(set);
      },
      clearEditorMessages: () => {
        editorPendingUpdates.clear();
        set({ editorMessages: [] });
      },
      // ===== [P1-2] 合并自 contextStore =====
      injectedFiles: [],
      addInjectedFile: (file) => {
        const state = get();
        if (state.injectedFiles.some(f => f.path === file.path)) return;
        set({ injectedFiles: [...state.injectedFiles, { ...file, injectedAt: Date.now() }] });
      },
      removeInjectedFile: (path) => {
        set((s) => ({ injectedFiles: s.injectedFiles.filter(f => f.path !== path) }));
      },
      clearInjectedFiles: () => set({ injectedFiles: [] }),
      isFileInjected: (path) => get().injectedFiles.some(f => f.path === path),
      getInjectedFilesContent: () => get().injectedFiles.filter(f => f.content).map(f => ({ path: f.path, name: f.name, content: f.content! })),
    }),
    {
      name: 'agentai-chat-messages',
      storage: createJSONStorage(() => throttledStorage),
      partialize: (s) => ({ messages: s.messages.slice(-200), injectedFiles: s.injectedFiles }),
    },
  ),
);
