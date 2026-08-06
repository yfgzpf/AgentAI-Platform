/**
 * useSessionAutoSave — 会话自动保存 hook (P2-1: 从 ChatView 抽取)
 *
 * 功能:
 * 1. 每 30 秒自动保存所有消息到 sessionStore
 * 2. 每次消息变化时保存最后一条消息
 * 3. 会话切换时从 sessionStore 加载历史消息 (替代 Sidebar 手动加载)
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { addMessage, getMySessions, getActive } = useSessionStore();
  const { setMessages: setChatMessages, clearMessages } = useChatStore();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);
  const prevSessionTitleRef = useRef<string>('');

  /* ---- 会话切换: 从 sessionStore 加载历史消息 ---- */
  useEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      const isNewSession = prevActiveIdRef.current === null;
      const prevSession = prevActiveIdRef.current
        ? getMySessions().find(s => s.id === prevActiveIdRef.current)
        : undefined;
      const newSession = activeId ? getMySessions().find(s => s.id === activeId) : undefined;

      // 如果新会话已有持久化消息，原子替换；否则清空
      if (newSession && newSession.messages.length > 0) {
        const restored = newSession.messages.map(msg => ({
          id: `restored-${msg.ts}`,
          role: msg.role as 'user' | 'assistant',
          segments: [{ kind: 'text' as const, text: msg.content }],
          ts: msg.ts,
          status: 'done' as const,
        }));
        setChatMessages(restored);
      } else {
        // 新会话或无历史消息 → 清空
        clearMessages();
      }

      prevActiveIdRef.current = activeId;
      prevSessionTitleRef.current = newSession?.title || '';
    }
  }, [activeId, getMySessions, setChatMessages, clearMessages]);

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
