import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SessionMessage {
  role: string;
  content: string;
  ts: number;
}

interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
  provider?: string;
}

interface SessionState {
  sessions: Session[];
  activeId: string | null;
  createSession: (title?: string) => string;
  deleteSession: (id: string) => void;
  setActive: (id: string) => void;
  addMessage: (sessionId: string, msg: SessionMessage) => void;
  getActive: () => Session | undefined;
  exportSession: (id: string) => string;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      createSession: (title) => {
        const id = `sess-${Date.now()}`;
        const session: Session = { id, title: title || '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        set((s) => ({ sessions: [...s.sessions, session].slice(-50), activeId: id }));
        return id;
      },
      deleteSession: (id) => set((s) => ({ sessions: s.sessions.filter(x => x.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActive: (id) => set({ activeId: id }),
      addMessage: (sessionId, msg) => set((s) => ({
        sessions: s.sessions.map(x => x.id === sessionId ? { ...x, messages: [...x.messages, msg].slice(-50), updatedAt: Date.now() } : x),
      })),
      getActive: () => get().sessions.find(x => x.id === get().activeId),
      exportSession: (id) => {
        const s = get().sessions.find(x => x.id === id);
        if (!s) return '';
        return `# ${s.title}\n\n${s.messages.map(m => `**${m.role}**: ${m.content}`).join('\n\n')}`;
      },
    }),
    { name: 'agentai-sessions', partialize: (s) => ({ sessions: s.sessions, activeId: s.activeId }) },
  ),
);
