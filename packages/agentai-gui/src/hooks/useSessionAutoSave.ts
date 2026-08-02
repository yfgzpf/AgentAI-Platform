/**
 * useSessionAutoSave — 会话自动保存 hook (P2-1: 从 ChatView 抽取)
 *
 * 功能:
 * 1. 每 30 秒自动保存所有消息到 sessionStore
 * 2. 每次消息变化时保存最后一条消息
 * 3. 会话切换时原子清空 chatStore
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { addMessage } = useSessionStore();
  const { setMessages: setChatMessages } = useChatStore();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);

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

  /* ---- 会话切换: 原子清空消息 ---- */
  // 注意: 从 null → 新 session 时不清空 (首条消息刚被 append, 清空会丢失用户消息)
  useEffect(() => {
    if (prevActiveIdRef.current !== activeId) {
      // 仅在切换已有会话时清空, 首次创建会话 (null → sessionId) 不清空
      if (prevActiveIdRef.current !== null) {
        setChatMessages([]);
      }
      prevActiveIdRef.current = activeId;
    }
  }, [activeId, setChatMessages]);
}
