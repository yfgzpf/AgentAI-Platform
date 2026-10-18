import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createQuotaSafeStorage, createTieredPruner, capText } from '../utils/quota-safe-storage';

/**
 * 聊天气息持久化 —— 节流 + 配额安全 (2026-10-18)
 *
 * 原实现只做节流 + 把配额异常 console.error 吞掉: 页面不崩, 但消息**静默丢失**,
 * 用户重进发现对话没了。现改为走统一配额安全层: 超预算时按级瘦身再写, 写不进去
 * 才降级为内存态, 并留下可诊断的日志。
 *
 * 这里的裁剪重点与 sessions 不同 —— 真正的黑洞是 `segments` 里的:
 *   - image.base64 / data: URI (一张图可达数 MB)
 *   - tool.result (整段命令输出)
 *   - widget.content (内联 SVG/HTML 整页)
 */
const chatPruner = createTieredPruner([
  // L0 图片段去掉 base64/data URI; 工具输出截到 2000; widget 截到 4000
  (st) => eachSegment(st, (seg) => {
    let changed = false;
    if (seg.kind === 'image') {
      if (seg.base64) { delete seg.base64; changed = true; }
      if (typeof seg.url === 'string' && seg.url.startsWith('data:')) {
        seg.url = '[本地图片已省略: 体积过大]';
        changed = true;
      }
    }
    if (seg.kind === 'tool') {
      if (seg.data) { delete seg.data; changed = true; }
      const r = capText(seg.result, 2000);
      if (r.changed) { seg.result = r.text; changed = true; }
    }
    if (seg.kind === 'widget') {
      const r = capText(seg.content, 4000);
      if (r.changed) { seg.content = r.text; changed = true; }
    }
    return changed;
  }),
  // L1 文本类段落截到 4000; 工具输出截到 800
  (st) => eachSegment(st, (seg) => {
    if (seg.kind === 'tool') {
      const r = capText(seg.result, 800);
      if (!r.changed) return false;
      seg.result = r.text;
      return true;
    }
    if (seg.kind === 'text' || seg.kind === 'reasoning' || seg.kind === 'thinking') {
      const r = capText(seg.text, 4000);
      if (!r.changed) return false;
      seg.text = r.text;
      return true;
    }
    return false;
  }),
  // L2 注入文件只留路径 (content 是整份文件内容, 最占地方)
  (st) => {
    if (!Array.isArray(st.injectedFiles)) return false;
    let changed = false;
    st.injectedFiles = st.injectedFiles.map((f: any) => {
      if (!f || typeof f.content !== 'string') return f;
      changed = true;
      const { content, ...rest } = f;
      return { ...rest, contentDropped: (content as string).length };
    });
    return changed;
  },
  // L3 只留最近 80 条消息
  (st) => keepLast(st, 80),
  // L4 文本 1500 / 工具 300
  (st) => eachSegment(st, (seg) => {
    if (seg.kind === 'tool') {
      const r = capText(seg.result, 300);
      if (!r.changed) return false;
      seg.result = r.text;
      return true;
    }
    if (seg.kind === 'text' || seg.kind === 'reasoning' || seg.kind === 'thinking') {
      const r = capText(seg.text, 1500);
      if (!r.changed) return false;
      seg.text = r.text;
      return true;
    }
    return false;
  }),
  // L5 只留最近 30 条
  (st) => keepLast(st, 30),
  // L6 文本 600
  (st) => eachSegment(st, (seg) => {
    if (seg.kind === 'text' || seg.kind === 'reasoning' || seg.kind === 'thinking') {
      const r = capText(seg.text, 600);
      if (!r.changed) return false;
      seg.text = r.text;
      return true;
    }
    return false;
  }),
  // L7 只留最近 8 条
  (st) => keepLast(st, 8),
  // L8 只留最近 3 条, 每条 300
  (st) => {
    const a = keepLast(st, 3);
    const b = eachSegment(st, (seg) => {
      const key = seg.kind === 'text' || seg.kind === 'reasoning' || seg.kind === 'thinking' ? 'text'
        : seg.kind === 'tool' ? 'result' : null;
      if (!key) return false;
      const r = capText((seg as any)[key], 300);
      if (!r.changed) return false;
      (seg as any)[key] = r.text;
      return true;
    });
    return a || b;
  },
], 900_000);

function eachSegment(st: any, fn: (seg: any) => boolean): boolean {
  if (!Array.isArray(st?.messages)) return false;
  let changed = false;
  for (const m of st.messages) {
    if (!m || !Array.isArray(m.segments)) continue;
    for (const seg of m.segments) {
      if (!seg || typeof seg !== 'object') continue;
      try { if (fn(seg)) changed = true; } catch { /* 单段异常不影响整体 */ }
    }
  }
  return changed;
}

function keepLast(st: any, n: number): boolean {
  if (!Array.isArray(st?.messages) || st.messages.length <= n) return false;
  st.messages = st.messages.slice(-n);
  return true;
}

/** 节流 2s + 配额安全: 流式输出期间不频繁阻塞主线程, 且永不抛异常 */
const quotaSafeChatStorage = createQuotaSafeStorage({
  label: 'agentai-chat-messages',
  budgetChars: 900_000,
  throttleMs: 2000,
  pruner: chatPruner.pruner,
});

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
      storage: createJSONStorage(() => quotaSafeChatStorage),
      partialize: (s) => ({ messages: s.messages.slice(-200), injectedFiles: s.injectedFiles }),
    },
  ),
);
