import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 0. 用户档案 (首次启动收集, 持久化)
export interface UserProfile {
  name: string;
  onboardedAt: number;
  workspace?: string;
  language: 'zh' | 'en';
}
interface ProfileState {
  profile: UserProfile | null;
  setProfile: (p: UserProfile) => void;
  clearProfile: () => void;
}
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      profile: null,
      setProfile: (p) => set({ profile: p }),
      clearProfile: () => set({ profile: null }),
    }),
    { name: 'agentai-user-profile' },
  ),
);

/** 工具: 拿当前用户名 (给 Chat / Editor / ImageGen / VideoGen 用) */
export const useUserName = (): string => {
  return useProfileStore.getState().profile?.name || '你';
};

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
  provider: string; // "cline:deepseek-v4-flash" | "agentai:agnes-v4" | "deepseek:v4-pro" | "openai:gpt-4o-mini" | ...
  hasKey: boolean;
  setProvider: (p: string) => void;
  setHasKey: (b: boolean) => void;
}

const DEFAULT_PROVIDER = 'agentai:agnes-v4';
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      provider: DEFAULT_PROVIDER,
      hasKey: false,
      setProvider: (p) => set({ provider: p }),
      setHasKey: (b) => set({ hasKey: b }),
    }),
    { name: 'agentai-settings' },
  ),
);
