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
}

interface SessionState {
  sessions: Session[];
  activeId: string | null;
  /** 当前用户ID，用于会话隔离 */
  currentUserId: string;
  setCurrentUserId: (userId: string) => void;
  createSession: (title?: string, userId?: string) => string;
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
      createSession: (title, userId) => {
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
        };
        set((s) => ({ sessions: [...s.sessions, session].slice(-50), activeId: id }));
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
      // 迁移旧数据：为没有 userId 的会话添加 userId
      migrate: (persistedState: any) => {
        if (persistedState?.sessions) {
          persistedState.sessions = persistedState.sessions.map((s: any) => ({
            ...s,
            userId: s.userId || 'default',
          }));
        }
        return persistedState;
      },
    },
  ),
);