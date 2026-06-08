import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  type?: 'text' | 'question' | 'confirmation' | 'result';
  fields?: any[];
  summary?: Record<string, any>;
  actions?: any[];
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: Message[];
  industry?: string;
  taskType?: string;
  guidanceContext?: any;
}

interface AppState {
  sessions: Session[];
  currentSessionId: string | null;
  currentIndustry: string;
  isConnected: boolean;
  isLoading: boolean;

  setCurrentSessionId: (id: string | null) => void;
  setCurrentIndustry: (industry: string) => void;
  setIsConnected: (connected: boolean) => void;
  setIsLoading: (loading: boolean) => void;

  createSession: (title?: string) => Session;
  deleteSession: (id: string) => void;
  getCurrentSession: () => Session | null;

  addMessage: (sessionId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  clearMessages: (sessionId: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentIndustry: 'construction',
  isConnected: false,
  isLoading: false,

  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  setCurrentIndustry: (industry) => set({ currentIndustry: industry }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  setIsLoading: (loading) => set({ isLoading: loading }),

  createSession: (title = '新对话') => {
    const session: Session = {
      id: uuidv4(),
      title,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      currentSessionId: session.id,
    }));
    return session;
  },

  deleteSession: (id) => {
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      currentSessionId: state.currentSessionId === id ? null : state.currentSessionId,
    }));
  },

  getCurrentSession: () => {
    const { sessions, currentSessionId } = get();
    return sessions.find((s) => s.id === currentSessionId) || null;
  },

  addMessage: (sessionId, message) => {
    const newMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date(),
    };
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id === sessionId) {
          return {
            ...session,
            messages: [...session.messages, newMessage],
            updatedAt: new Date(),
          };
        }
        return session;
      }),
    }));
  },

  updateMessage: (sessionId, messageId, updates) => {
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id === sessionId) {
          return {
            ...session,
            messages: session.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
            updatedAt: new Date(),
          };
        }
        return session;
      }),
    }));
  },

  clearMessages: (sessionId) => {
    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.id === sessionId) {
          return {
            ...session,
            messages: [],
            updatedAt: new Date(),
          };
        }
        return session;
      }),
    }));
  },
}));
