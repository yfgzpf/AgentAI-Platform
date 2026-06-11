import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ModelConfig {
  id: string;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  color: string;
  enabled: boolean;
  isDefault?: boolean;
  isBuiltIn?: boolean;
  provider?: string;
  models?: string[];
}

interface ModelState {
  models: ModelConfig[];
  activeModelId: string;
  setActive: (id: string) => void;
  addModel: (c: Omit<ModelConfig, 'id' | 'isBuiltIn'>) => string;
  removeModel: (id: string) => void;
  toggleModel: (id: string, enabled?: boolean) => void;
}

const DEFAULT_MODELS: ModelConfig[] = [
  { id: 'agentai', label: 'Agnes AI', baseURL: 'https://apihub.agnes-ai.com', apiKeyEnv: 'AGENTAI_API_KEY', color: '#4F46E5', enabled: true, isDefault: true, isBuiltIn: true },
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', color: '#10B981', enabled: true, isBuiltIn: true },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', color: '#F59E0B', enabled: false, isBuiltIn: true },
];

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: DEFAULT_MODELS,
      activeModelId: DEFAULT_MODELS.find(m => m.isDefault)?.id || 'agentai',
      setActive: (id) => set({ activeModelId: id }),
      addModel: (c) => {
        const id = `custom-${Date.now()}`;
        set((s) => ({ models: [...s.models, { ...c, id, isBuiltIn: false }] }));
        return id;
      },
      removeModel: (id) => set((s) => ({ models: s.models.filter(m => m.id !== id), activeModelId: s.activeModelId === id ? 'agentai' : s.activeModelId })),
      toggleModel: (id, enabled) => set((s) => ({ models: s.models.map(m => m.id === id ? { ...m, enabled: enabled ?? !m.enabled } : m) })),
    }),
    { name: 'agentai-models' },
  ),
);
