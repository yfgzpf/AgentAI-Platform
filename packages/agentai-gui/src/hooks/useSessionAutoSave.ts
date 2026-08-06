/**
 * useSessionAutoSave — 会话自动保存 hook (P2-1: 从 ChatView 抽取)
 *
 * 功能:
 * 1. 每 30 秒自动保存所有消息到 sessionStore
 * 2. 每次消息变化时保存最后一条消息
 * 3. 会话切换时从 gateway API 加载历史消息 (异步, 比本地 persist 更全)
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';

const GATEWAY_BASE = `http://${typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'}:18789`;

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { addMessage, getMySessions } = useSessionStore();
  const { setMessages: setChatMessages, clearMessages } = useChatStore();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);
  const loadingRef = useRef<Record<string, boolean>>({});

  /* ---- 会话切换: 从 gateway 异步加载历史消息 ---- */
  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const id = activeId;
    // 防重复加载
    if (loadingRef.current[id]) return;
    loadingRef.current[id] = true;

    // 先同步清空，再异步加载（保证 UI 立即响应）
    clearMessages();
    prevActiveIdRef.current = id;

    fetch(`${GATEWAY_BASE}/api/sessions/${id}/messages`)
      .then(r => r.json())
      .then(data => {
        loadingRef.current[id] = false;
        if (data?.success && data?.messages?.length > 0) {
          // 使用 setMessages 原子替换，避免逐个 addMessage 触发多次重渲染
          const restored = data.messages.map((msg: any) => ({
            id: `restored-${msg.ts || Date.now()}`,
            role: msg.role as 'user' | 'assistant',
            segments: [{ kind: 'text' as const, text: msg.content }],
            ts: msg.ts || Date.now(),
            status: 'done' as const,
          }));
          setChatMessages(restored);
        }
      })
      .catch(() => {
        loadingRef.current[id] = false;
        // 加载失败 → 回退到本地 persist 数据
        const session = getMySessions().find(s => s.id === id);
        if (session && session.messages.length > 0) {
          const restored = session.messages.map((msg: any) => ({
            id: `restored-${msg.ts}`,
            role: msg.role as 'user' | 'assistant',
            segments: [{ kind: 'text' as const, text: msg.content }],
            ts: msg.ts,
            status: 'done' as const,
          }));
          setChatMessages(restored);
        }
      });
  }, [activeId, clearMessages, getMySessions, setChatMessages]);

  /* ---- Auto-save: 每30秒保存到 sessionStore ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const timer = setInterval(() => {
      for (const msg of messages) {
        const textSegs = msg.segments.filter(s => s.kind === 'text');
        const text = textSegs[0]?.text || '';
        if (!text) continue;
        addMessage(activeId!, { role: msg.role, content: text, ts: msg.ts });
      }
    }, 30000);
    autoSaveTimerRef.current = timer;
    return () => { clearInterval(timer); autoSaveTimerRef.current = null; };
  }, [activeId, messages.length, addMessage, messages]);

  /* ---- 保存最后一条消息到 sessionStore ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const text = (last.segments || []).filter(s => s.kind === 'text').map(s => s.text).join('').slice(0, 200);
    if (text && !last.streaming) {
      addMessage(activeId, { role: last.role, content: text, ts: last.ts });
    }
  }, [messages.length, activeId, addMessage, messages]);
}
