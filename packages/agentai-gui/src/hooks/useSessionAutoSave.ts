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
  // ★ 修复: 记录已持久化的消息 key, 防止每 30 秒把同一批消息重复 append 到 localStorage,
  // 旧逻辑导致 localStorage 单会话内堆积大量重复内容, 恢复出的"历史"全是重复消息。
  const savedKeysRef = useRef<Set<string>>(new Set());

  /** 去重持久化单条消息到 sessionStore */
  const persistMessage = (msg: ChatMessage) => {
    const key = `${msg.role}|${msg.ts}|${msg.segments?.filter(s => s.kind === 'text').map(s => s.text).join('')}`;
    if (savedKeysRef.current.has(key)) return; // 已保存过, 跳过
    const textSegs = msg.segments.filter(s => s.kind === 'text');
    const text = textSegs[0]?.text || '';
    if (!text) return;
    savedKeysRef.current.add(key);
    addMessage(activeId!, { role: msg.role, content: text, ts: msg.ts });
  };

  /* ---- 会话切换: 从 localStorage 加载历史消息 ---- */
  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const session = getMySessions().find(s => s.id === activeId);

    // 切换会话 → 重置去重集合
    savedKeysRef.current = new Set();

    // 同步清空
    clearMessages();
    prevActiveIdRef.current = activeId;

    if (session && session.messages.length > 0) {
      const restored = session.messages.map((msg: any, i: number) => ({
        // ★ 修复: 附带序号避免并发同 ts 的消息 id 冲突
        id: `restored-${msg.ts}-${i}`,
        role: msg.role as 'user' | 'assistant',
        segments: [{ kind: 'text' as const, text: msg.content }],
        ts: msg.ts,
        status: 'done' as const,
      }));
      setChatMessages(restored);
    }
  }, [activeId, clearMessages, getMySessions, setChatMessages]);

  /* ---- Auto-save: 每30秒推送消息到 gateway (持久化备份, 已去重) ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const timer = setInterval(() => {
      for (const msg of messages) persistMessage(msg);
    }, 30000);
    autoSaveTimerRef.current = timer;
    return () => { clearInterval(timer); autoSaveTimerRef.current = null; };
  }, [activeId, messages, persistMessage]);

  /* ---- 保存最后一条非流式消息到 localStorage (即时持久化) ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last.streaming) persistMessage(last);
  }, [messages, activeId, persistMessage]);
}
