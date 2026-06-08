import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 1. Framework 状态 (openclaw / hermes + A/B 灰度)
interface FrameworkState {
  active: 'openclaw' | 'hermes';
  abRatio: number;
  setActive: (f: 'openclaw' | 'hermes') => void;
  setAbRatio: (r: number) => void;
}
export const useFrameworkStore = create<FrameworkState>()(
  persist(
    (set) => ({
      active: 'openclaw',
      abRatio: 1,
      setActive: (f) => set({ active: f }),
      setAbRatio: (r) => set({ abRatio: r }),
    }),
    { name: 'agentai-framework' },
  ),
);

// 2. Chat 状态 (消息流)
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  framework?: 'openclaw' | 'hermes';
  streaming?: boolean;
  tokens?: { prompt: number; completion: number };
}
interface ChatState {
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, fn: (m: ChatMessage) => ChatMessage) => void;
  clearMessages: () => void;
}
export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  appendMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  updateMessage: (id, fn) => set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? fn(m) : m)),
  })),
  clearMessages: () => set({ messages: [] }),
}));

// 3. Settings 状态 (LLM provider / API key 状态)
interface SettingsState {
  provider: 'agentai' | 'deepseek' | 'openai';
  hasKey: boolean;
  setProvider: (p: 'agentai' | 'deepseek' | 'openai') => void;
  setHasKey: (b: boolean) => void;
}
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: 'agentai',
      hasKey: false,
      setProvider: (p) => set({ provider: p }),
      setHasKey: (b) => set({ hasKey: b }),
    }),
    { name: 'agentai-settings' },
  ),
);
