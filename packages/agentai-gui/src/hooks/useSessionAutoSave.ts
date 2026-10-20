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
 *   3. 每30秒自动将当前消息推送到 localStorage (含完整 segments, 一次写盘)
 *
 * 2026-10-21 修复: 此前只存第一段纯文本(`content`), 工具段/图片/widget/思考过程
 *   全部丢失 → 切会话回来看见空白容器或残句。现改为存完整 segments(经瘦身),
 *   按 msg.id 去重 upsert(流式期间同一条消息反复写是覆盖而非重复 append)。
 */
import { useEffect, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';
import { shrinkSessionSegments } from '../utils/quota-safe-storage';

export function useSessionAutoSave(
  messages: ChatMessage[],
  activeId: string | null,
) {
  const { upsertMessages } = useSessionStore();
  const { setMessages: setChatMessages, clearMessages } = useChatStore();
  // 用 ref 持有最新值, 避免 30s 定时器/卸载回调捕获到过期闭包
  const messagesRef = useRef<ChatMessage[]>(messages);
  const activeIdRef = useRef<string | null>(activeId);
  messagesRef.current = messages;
  activeIdRef.current = activeId;

  /** 把一条 ChatMessage 压成可持久化结构(含完整 segments, 经瘦身) */
  const buildPayload = (msg: ChatMessage): any | null => {
    if (!msg.id) return null;
    const segs: any[] = Array.isArray(msg.segments) ? msg.segments : [];
    if (segs.length === 0) return null; // 空消息不存
    const textSegs = segs.filter(s => s.kind === 'text');
    const content = textSegs[0]?.text || '';
    // 完整 segments 入库(去 base64/截工具输出; reasoning/thinking 保留宽松上限)
    const shrunk = shrinkSessionSegments(segs);
    const p: any = { id: msg.id, role: msg.role, content, ts: msg.ts };
    if (shrunk) p.segments = shrunk;
    return p;
  };

  /** 批量持久化当前会话的全部消息(一次 setState, 避免逐条写盘) */
  const persistAll = () => {
    const aid = activeIdRef.current;
    const msgs = messagesRef.current;
    if (!aid || msgs.length === 0) return;
    const payloads = msgs.map(buildPayload).filter(Boolean) as any[];
    if (payloads.length) upsertMessages(aid, payloads);
  };

  /* ---- 会话切换: 从 localStorage 加载历史消息 (优先用 segments 完整还原) ---- */
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const session = useSessionStore.getState().getMySessions().find(s => s.id === activeId);

    // 切换会话 → 重置去重游标
    prevActiveIdRef.current = activeId;

    // 同步清空
    clearMessages();

    if (session && session.messages.length > 0) {
      const restored = session.messages.map((msg: any, i: number) => {
        const segs = Array.isArray(msg.segments) && msg.segments.length > 0
          ? msg.segments
          // 兼容历史数据: 老会话只有 content, 退化为单文本段
          : [{ kind: 'text' as const, text: msg.content || '' }];
        return {
          // ★ 复用原始 id, 切回后再次持久化时按 id 覆盖, 不会造成重复
          id: msg.id || `restored-${msg.ts}-${i}`,
          role: msg.role as 'user' | 'assistant',
          segments: segs,
          ts: msg.ts,
          status: 'done' as const,
        };
      });
      setChatMessages(restored);
    }
  }, [activeId, clearMessages, setChatMessages]);

  /* ---- Auto-save: 每30秒推送消息到 localStorage (含完整 segments, 一次写盘) ---- */
  useEffect(() => {
    const timer = setInterval(() => persistAll(), 30000);
    return () => clearInterval(timer);
  }, []);

  /* ---- 即时持久化: 当前会话无流式消息时, 落盘全部(一次 setState) ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    if (messages.some(m => m.streaming)) return; // 流式期间由 30s/卸载兜底, 避免每 token 写盘
    persistAll();
  }, [messages, activeId]);

  /* ---- P0 修复: beforeunload 强制刷盘 — 防止 F5 丢最后2秒消息 ---- */
  useEffect(() => {
    const handleBeforeUnload = () => { persistAll(); };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return { persistAll };
}
