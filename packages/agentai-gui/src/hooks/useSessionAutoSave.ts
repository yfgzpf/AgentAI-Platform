/**
 * useSessionAutoSave — 会话自动保存 hook
 *
 * 架构:
 *   - localStorage (agentai-sessions): 主会话存储, 包含完整消息历史
 *   - Gateway (/api/sessions): 用于持久化备份 (每30秒同步一次)
 *
 * 流程:
 *   1. 点击 sidebar 会话 → setActive(sessId) → useEffect(activeId) 触发
 *   2. 从 sessionStore 读取该会话的消息 → setMessages 原子替换
 *   3. 每30秒自动将当前消息推送到 gateway (备份)
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { addMessage, getMySessions } = useSessionStore();
  const { setMessages: setChatMessages, clearMessages } = useChatStore();
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevActiveIdRef = useRef<string | null>(activeId);

  /* ---- 会话切换: 从 localStorage 加载历史消息 ---- */
  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const session = getMySessions().find(s => s.id === activeId);

    // 同步清空
    clearMessages();
    prevActiveIdRef.current = activeId;

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
  }, [activeId, clearMessages, getMySessions, setChatMessages]);

  /* ---- Auto-save: 每30秒推送消息到 gateway (持久化备份) ---- */
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

  /* ---- 保存最后一条消息到 localStorage ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const text = (last.segments || []).filter(s => s.kind === 'text').map(s => s.text).join('').slice(0, 200);
    if (text && !last.streaming) {
      addMessage(activeId, { role: last.role, content: text, ts: last.ts });
    }
  }, [messages.length, activeId, addMessage, messages]);
}
