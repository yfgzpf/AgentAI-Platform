import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ChatSegment = { kind: 'text'; text: string } | { kind: 'tool'; callId: string; name: string; args?: any; state?: string; result?: string; ok?: boolean; durationMs?: number };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  segments: ChatSegment[];
  ts: number;
  provider?: string;
  framework?: string;
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
  updateMessage: (id, fn) => set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) })),
  clearMessages: () => set({ messages: [] }),
}));
