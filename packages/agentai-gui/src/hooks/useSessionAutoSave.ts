/**
 * useSessionAutoSave — 会话自动保存 hook (P2-1: 从 ChatView 抽取)
 *
 * 功能:
 * 1. 每 30 秒自动保存所有消息到 gateway
 * 2. 每次消息变化时保存最后一条消息
 * 3. 会话切换时从 gateway API 加载历史消息
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';

const GATEWAY_BASE = `http://${typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'}:18789`;

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { addMessage } = useSessionStore();
  const { setMessages: setChatMessages, clearMessages } = useChatStore();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);
  const loadingRef = useRef<Record<string, boolean>>({});

  /* ---- 会话切换: 从 gateway 异步加载历史消息 ---- */
  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const id = activeId;
    if (loadingRef.current[id]) return;
    loadingRef.current[id] = true;

    // 先同步清空，让 UI 立即响应
    clearMessages();
    prevActiveIdRef.current = id;

    fetch(`${GATEWAY_BASE}/api/sessions/${id}/messages`)
      .then(r => r.json())
      .then(data => {
        loadingRef.current[id] = false;
        if (data?.success && data?.messages?.length > 0) {
          // 原子替换：一次渲染完成
          setChatMessages(data.messages.map((msg: any) => ({
            id: `restored-${msg.timestamp || Date.now()}`,
            role: msg.role as 'user' | 'assistant',
            segments: [{ kind: 'text' as const, text: msg.content }],
            ts: msg.timestamp || Date.now(),
            status: 'done' as const,
          })));
        }
        // 空会话保持清空状态
      })
      .catch(() => {
        loadingRef.current[id] = false;
        // 加载失败保持清空（不显示旧数据）
      });
  }, [activeId, clearMessages, setChatMessages]);

  /* ---- Auto-save: 每30秒推送消息到 gateway ---- */
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

  /* ---- 保存最后一条消息到 gateway ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const text = (last.segments || []).filter(s => s.kind === 'text').map(s => s.text).join('').slice(0, 200);
    if (text && !last.streaming) {
      addMessage(activeId, { role: last.role, content: text, ts: last.ts });
    }
  }, [messages.length, activeId, addMessage, messages]);
}
