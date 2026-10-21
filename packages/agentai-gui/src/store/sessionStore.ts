import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createQuotaSafeStorage, createSessionPruner } from '../utils/quota-safe-storage';

/**
 * 2026-10-18 P0 (实机事故): `agentai-sessions` 写爆 localStorage 配额 →
 *   `Failed to execute 'setItem' on 'Storage': ... exceeded the quota` 冒泡到
 *   ErrorBoundary → 整页显示"页面加载中断", 应用不可用。
 *
 * 根因: 该 store 用的是 zustand persist **默认** storage(裸 localStorage, 无 try/catch),
 *   而载荷是**全部会话的完整消息** —— 单条消息常带整段工具日志(一次渗透 100+ 步),
 *   几个会话就能顶破 5MB; 同源还有 chat-messages / write-draft / 视频截图帧在抢配额。
 *
 * 修复: 换成配额安全存储 ——
 *   ① 超预算先分级瘦身再写 (先动"非当前会话", 最后才动用户正在看的这段);
 *   ② 配额真满时先清可牺牲的临时键 (截图帧/草稿);
 *   ③ 彻底塞不下就降级为**内存态** —— 页面照常用, 只是刷新后少一次持久化;
 *   ④ 任何情况都**不抛异常**, 不会再让 ErrorBoundary 接管整页。
 */
const sessionPruner = createSessionPruner(1_400_000);

/** 导出供测试直接注入 (不要与 DOM 的 sessionStorage 混淆, 故用 quotaSafe 前缀) */
export const quotaSafeSessionStorage = createQuotaSafeStorage({
  label: 'agentai-sessions',
  budgetChars: 1_400_000,   // ≈2.8MB (UTF-16), 给同源其它 key 留出余量
  throttleMs: 0,            // 保持原语义: 消息写入即时落盘
  pruner: sessionPruner.pruner,
});

interface SessionMessage {
  /**
   * 消息唯一 ID
   * ─────────────────────────────────────────────
   * 2026-10-05 P0 修复: 此前 SessionMessage **没有 id 字段**，
   * 而 ChatView 在会话隔离逻辑里用 `findIndex(m => m.id === id)` 查找
   * →恒为 -1 → 走 `return` 把更新丢弃
   * → 用户在生成过程中切换会话，这次生成的消息**根本没写进任何会话**
   * → 切回来发现内容没了 → 重新发送 → AI 又"从头开始"。
   *
   * 保持 optional 以兼容历史数据（migrate 会补齐）。
   */
  id?: string;
  role: string;
  content: string;
  ts: number;
  /**
   * 2026-10-21 修复: 此前只存 `content`(第一段纯文本), 工具段/图片段/widget/
   * 思考过程(reasoning/thinking) 全丢 —— 切会话回来看见"空白容器"或残句。
   * 现在存完整 segments, 恢复时不丢结构与推理链路。容量由 quota-safe pruner
   * 对 segments 的同源瘦身兜底 (reasoning 保留宽松上限)。
   */
  segments?: any[];
}

/** 生成消息 ID（与 ChatView 的 botId/userId 格式兼容，便于按 id 定位） */
function genMsgId(role: string): string {
  return `${role === 'user' ? 'user' : 'bot'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  provider?: string;
  /** 关联的用户ID，用于多用户隔离 */
  userId?: string;
  /** 会话类型: chat(对话) / image(生图) / video(生视频) */
  type?: 'chat' | 'image' | 'video';
  /** 关联的工作目录，用于工作区隔离 */
  workspace?: string;
}

interface SessionState {
  sessions: Session[];
  activeId: string | null;
  /** 当前用户ID，用于会话隔离 */
  currentUserId: string;
  setCurrentUserId: (userId: string) => void;
  createSession: (title?: string, userId?: string, type?: 'chat' | 'image' | 'video', workspace?: string) => string;
  updateTitle: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  setActive: (id: string) => void;
  addMessage: (sessionId: string, msg: SessionMessage) => void;
  /** 2026-10-21: 批量 upsert, 一次 setState 写入多条(按 id 新增或覆盖), 避免逐条写盘 */
  upsertMessages: (sessionId: string, msgs: SessionMessage[]) => void;
  clearSessionMessages: (sessionId: string) => void;
  getActive: () => Session | undefined;
  exportSession: (id: string) => string;
  /** 获取当前用户的会话列表 */
  getMySessions: () => Session[];
  /** 获取所有用户的会话（管理用） */
  getAllSessions: () => Session[];
  /** 批次8: 按时间 + 每工作区上限清理旧会话 (幂等, 也可外部手动调用) */
  cleanupOldSessions: (maxPerWorkspace?: number, olderThanDays?: number) => void;
}

/**
 * 2026-10-21 (富哥: "关掉页面再进, 很多消息没了") :
 * 单会话消息上限仍是 300 (配额约束), 但**不能再纯 slice(-300)** — 那样丢掉的是
 * 会话最开头那条"任务原始要求", 恰恰是跨会话恢复最需要的东西 (长任务里几百条工具记录)。
 * 改为保留开头 keepHead 条 + 最近 (cap-keepHead) 条, 中间段由工具卡片折叠承担损失。
 */
export function capSessionMessages<T>(arr: T[], cap = 300, keepHead = 20): T[] {
  if (arr.length <= cap) return arr;
  return [...arr.slice(0, keepHead), ...arr.slice(-(cap - keepHead))];
}

/**
 * 批次8: 纯函数清理器 — 供测试直接调, 不依赖 store。
 * 规则 (用户拍板: 历史按时间清理, 但保留每工作区最近 N 条):
 *   ① 早于 olderThanDays 天的会话 → 删 (除非它在该工作区里排进最近 maxPerWorkspace 条)
 *   ② 每个工作区只保留最近 maxPerWorkspace 条
 *   ③ 全局上限 globalCap (默认 200), 超出按 updatedAt 最新保留
 */
export function cleanupSessionsList(
  sessions: Session[],
  opts: { maxPerWorkspace?: number; olderThanDays?: number; globalCap?: number; now?: number } = {},
): Session[] {
  const { maxPerWorkspace = 30, olderThanDays = 14, globalCap = 200 } = opts;
  const now = opts.now ?? Date.now();
  const cutoff = now - olderThanDays * 86_400_000;

  // 按 workspace 分组 (无 workspace 的归 '__none__')
  const byWs = new Map<string, Session[]>();
  for (const s of sessions) {
    const key = (s.workspace || '').trim() || '__none__';
    const arr = byWs.get(key) || [];
    arr.push(s);
    byWs.set(key, arr);
  }

  const kept: Session[] = [];
  for (const arr of byWs.values()) {
    // 组内按更新时间倒序
    const sorted = [...arr].sort((a, b) => b.updatedAt - a.updatedAt);
    const recent = sorted.slice(0, maxPerWorkspace);
    const recentIds = new Set(recent.map(s => s.id));
    for (const s of recent) {
      // 太旧且不在"每区最近 N"里 → 丢
      if (s.updatedAt < cutoff && !recentIds.has(s.id)) continue;
      kept.push(s);
    }
  }
  // 全局上限: 按更新时间倒序取前 globalCap
  kept.sort((a, b) => b.updatedAt - a.updatedAt);
  return kept.slice(0, globalCap);
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      currentUserId: 'default',
      setCurrentUserId: (userId) => set({ currentUserId: userId }),
      createSession: (title, userId, type = 'chat', workspace?: string) => {
        const uid = userId || get().currentUserId || 'default';
        const id = `sess-${Date.now()}`;
        const session: Session = {
          id,
          title: title || '新对话',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          userId: uid,
          type,
          workspace,
        };
        // ✅ 批次8 (2026-10-12): 保留同工作区历史会话, 不再每次删除。
        //   旧逻辑 `filter(x => x.workspace !== workspace)` 会导致"对话历史随工作区保留"
        //   永远做不到 — 每开新对话就把该工作区所有旧会话清掉了。
        //   现在改为: 追加 + 按时间清理 (cleanupSessionsList), 既保留历史又不无限膨胀。
        set((s) => ({
          sessions: cleanupSessionsList([...s.sessions, session]),
          activeId: id,
        }));
        return id;
      },
      deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter(x => x.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      updateTitle: (id, title) => set((s) => ({
        sessions: s.sessions.map(x => x.id === id ? { ...x, title: title.slice(0, 60), updatedAt: Date.now() } : x),
      })),
      setActive: (id) => set({ activeId: id }),
      addMessage: (sessionId, msg) => set((s) => ({
        sessions: s.sessions.map(x => {
          if (x.id !== sessionId) return x;
          // 2026-10-05 P0 修复: 补齐 id —— 否则 ChatView 的跨会话写入找不到目标消息
          const withId: SessionMessage = { id: msg.id || genMsgId(msg.role), ...msg };
          return { ...x, messages: capSessionMessages([...x.messages, withId]), updatedAt: Date.now() };
        }),
      })),
      upsertMessages: (sessionId, msgs) => set((s) => ({
        sessions: s.sessions.map(x => {
          if (x.id !== sessionId) return x;
          let arr = [...x.messages];
          for (const msg of msgs) {
            const idx = arr.findIndex(m => m.id === msg.id);
            const withId: SessionMessage = { id: msg.id || genMsgId(msg.role), ...msg };
            if (idx >= 0) arr[idx] = withId;
            else arr.push(withId);
          }
          return { ...x, messages: capSessionMessages(arr), updatedAt: Date.now() };
        }),
      })),
      clearSessionMessages: (sessionId) => set((s) => ({
        sessions: s.sessions.map(x => x.id === sessionId ? { ...x, messages: [], updatedAt: Date.now() } : x),
      })),
      getActive: () => get().sessions.find(x => x.id === get().activeId),
      exportSession: (id) => {
        const s = get().sessions.find(x => x.id === id);
        if (!s) return '';
        return `# ${s.title}\n\n${s.messages.map(m => `**${m.role}**: ${m.content}`).join('\n\n')}`;
      },
      getMySessions: () => {
        const uid = get().currentUserId || 'default';
        return get().sessions.filter(s => s.userId === uid).sort((a, b) => b.updatedAt - a.updatedAt);
      },
      getAllSessions: () => get().sessions,
      cleanupOldSessions: (maxPerWorkspace, olderThanDays) =>
        set((s) => ({
          sessions: cleanupSessionsList(s.sessions, { maxPerWorkspace, olderThanDays }),
        })),
    }),
    { 
      name: 'agentai-sessions', 
      storage: createJSONStorage(() => quotaSafeSessionStorage),   // 配额安全存储, 绝不抛异常
      partialize: (s) => ({ sessions: s.sessions, activeId: s.activeId, currentUserId: s.currentUserId }),
      // 迁移旧数据：为没有 userId/workspace 的会话添加默认值
      // 2026-10-05 P0 修复: 同时为没有 id 的历史消息补 id ——
      //   否则升级后旧会话里的消息仍无法被 ChatView 的findIndex(m => m.id === id) 定位
      migrate: (persistedState: any) => {
        if (persistedState?.sessions) {
          persistedState.sessions = persistedState.sessions.map((s: any) => ({
            ...s,
            userId: s.userId || 'default',
            // ✅ 批次8: 旧数据默认值统一为 '未指定工作区' → 与侧栏空桶判据保持一致
            //   (PulseFlowSidebar 把 空/'' / '未指定工作区' 都归进"未分类"桶)
            workspace: s.workspace || '未指定工作区',
            messages: Array.isArray(s.messages)
              ? s.messages.map((m: any) => (
                  m && typeof m === 'object' && !m.id
                    ? { ...m, id: genMsgId(m.role || 'bot') }
                    : m
                ))
              : [],
          }));
        }
        return persistedState;
      },
    },
  ),
);