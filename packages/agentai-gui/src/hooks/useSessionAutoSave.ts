/**
 * useSessionAutoSave — 会话自动保存 hook
 *
 * 架构:
 *   - IndexedDB (agentai-sessions, 2026-10-22 起; 此前是 localStorage): 主会话存储, 包含完整消息历史
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
import { useStoreHydrated } from './useStoreHydrated';

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
  const didHydrateRef = useRef(false);

  /** 把 sessionStore 里的消息映射成 chatStore 结构 (切会话与首屏恢复共用) */
  const restoreFromSession = (session: any): any[] =>
    (session?.messages || []).map((msg: any, i: number) => {
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

  /**
   * ★ 2026-10-21 P0 (富哥实锤: "关掉页面再进, 很多消息没了, 也不在当前对话")
   * 根因两层:
   *   ① 首屏不恢复 — 本 hook 的恢复 effect 只在 activeId **变化**时执行, 首次挂载
   *      prevActiveIdRef 已等于 activeId → 直接 return。于是只剩 chatStore 自己
   *      persist 的那份: partialize 只留最近 200 条, 启动体检配额紧张时 pruner
   *      L3 还会压到 80 条 → "消息凭空少了一大截"。
   *   ② activeId 悬空 — 该会话被 cleanupSessionsList (每区 30 / 全局 200) 清掉后,
   *      activeId 仍指向它 → 界面打开一个空对话。
   * 现在: 首屏一次性以 **sessionStore(按会话分桶, IndexedDB 无 300 条硬上限)** 为基线恢复, 再把
   *   chatStore 里 session 没有的新消息 (最近 30s 未落盘的) 合并进来, 不丢两端。
   */
  /**
   * ★ 2026-10-22 复审修复 (IndexedDB 异步水合打回首屏恢复)
   * ------------------------------------------------------------------
   * 旧后端是 localStorage(**同步**): zustand persist 在模块加载期就完成水合,
   *   首帧 activeId 已有值 → 首屏恢复 effect 能正常跑。
   * 现在会话存储后端是 IndexedDB(**异步**): 水合推迟到 IDB 回调, 首帧 activeId 仍是 null,
   *   而下面守卫的 `if (!activeId) { didHydrateRef.current = true; return; }` 会把
   *   didHydrateRef **永久**标记成 true → 首屏恢复(基线 + chatStore 未落盘消息的合并)被整段跳过,
   *   只剩"切换会话"effect 兜底, 而它是 clearMessages() + 整体替换 → 丢掉 chatStore 里
   *   还没落进 sessionStore 的最近消息 (流式期间最多 30s 的量)。
   *
   * 修法: 显式等待 persist 水合完成再做判断, 并把"首帧还没水合"与"确实没有会话"区分开。
   */
  const storeHydrated = useStoreHydrated(useSessionStore);

  useEffect(() => {
    // ★ 等水合完成: 否则首帧 activeId 为空会被误判成"没有会话"
    if (!storeHydrated) return;
    if (didHydrateRef.current) return;
    if (!activeId) { didHydrateRef.current = true; return; }
    didHydrateRef.current = true;

    const store = useSessionStore.getState();
    const session = store.getMySessions().find((s: any) => s.id === activeId);
    if (!session) {
      // ② activeId 悬空 → 切到最近更新的会话 (没有就置空, 别再指向不存在的会话)
      const latest = store.getMySessions()[0];
      console.warn('[session] activeId 指向的会话已不存在, 切到最近会话:', latest?.id || '(none)');
      if (latest) store.setActive(latest.id);
      else useSessionStore.setState({ activeId: null } as any);
      return;
    }

    const fromSession = restoreFromSession(session);
    // 合并 chatStore 里 session 尚未包含的新消息 (id 去重, 按时间排序, 流式态收敛)
    const byId = new Map<string, any>(fromSession.map((m: any) => [m.id, m]));
    for (const m of useChatStore.getState().messages) {
      if (!m?.id || byId.has(m.id)) continue;
      byId.set(m.id, { ...m, streaming: false, status: m.status === 'processing' ? 'done' : m.status });
    }
    const merged = [...byId.values()].sort((a: any, b: any) => (a.ts || 0) - (b.ts || 0));
    if (merged.length > 0) {
      console.log(`[session] 首屏恢复 ${session.id}: session=${fromSession.length} 条 + 新消息=${merged.length - fromSession.length} 条`);
      setChatMessages(merged);
    }
    // ★ 同步"切换会话"游标: 否则下面那个 effect 会认为这是一次会话切换,
    //   用 clearMessages()+替换 把上面刚合并出来的结果整个冲掉 (等于白恢复)。
    prevActiveIdRef.current = activeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, setChatMessages, storeHydrated]);

  useEffect(() => {
    if (!activeId || prevActiveIdRef.current === activeId) return;
    const session = useSessionStore.getState().getMySessions().find(s => s.id === activeId);

    // 切换会话 → 重置去重游标
    prevActiveIdRef.current = activeId;

    // 同步清空
    clearMessages();

    if (session && session.messages.length > 0) {
      setChatMessages(restoreFromSession(session));
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
