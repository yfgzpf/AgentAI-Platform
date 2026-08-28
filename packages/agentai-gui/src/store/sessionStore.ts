import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionMessage {
  role: string;
  content: string;
  ts: number;
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
  clearSessionMessages: (sessionId: string) => void;
  getActive: () => Session | undefined;
  exportSession: (id: string) => string;
  /** 获取当前用户的会话列表 */
  getMySessions: () => Session[];
  /** 获取所有用户的会话（管理用） */
  getAllSessions: () => Session[];
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      currentUserId: 'default',
      setCurrentUserId: (userId) => set({ currentUserId: userId }),
      createSession: (title, userId, type = 'chat', workspace?: string) => {
        // 使用传入的 userId，如果没有则用 currentUserId
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
        // P1 修复: 同 workspace 只保留最新 session, 旧的全部删除
        // 原因: 旧 session 的身份/任务背景过时, 沿用会导致 AI 引用几十天前的上下文
        set((s) => {
          const filtered = workspace
            ? s.sessions.filter(x => x.workspace !== workspace)
            : s.sessions;
          return { sessions: [...filtered, session].slice(-50), activeId: id };
        });
        return id;
      },
      deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter(x => x.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      updateTitle: (id, title) => set((s) => ({
        sessions: s.sessions.map(x => x.id === id ? { ...x, title: title.slice(0, 60), updatedAt: Date.now() } : x),
      })),
      setActive: (id) => set({ activeId: id }),
      addMessage: (sessionId, msg) => set((s) => ({
        sessions: s.sessions.map(x => x.id === sessionId ? { ...x, messages: [...x.messages, msg].slice(-50), updatedAt: Date.now() } : x),
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
    }),
    { 
      name: 'agentai-sessions', 
      partialize: (s) => ({ sessions: s.sessions, activeId: s.activeId, currentUserId: s.currentUserId }),
      // 迁移旧数据：为没有 userId/workspace 的会话添加默认值
      migrate: (persistedState: any) => {
        if (persistedState?.sessions) {
          persistedState.sessions = persistedState.sessions.map((s: any) => ({
            ...s,
            userId: s.userId || 'default',
            workspace: s.workspace || '未指定工作区',
          }));
        }
        return persistedState;
      },
    },
  ),
);