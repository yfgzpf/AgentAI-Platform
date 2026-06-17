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
  /** 上下文窗口大小 (tokens), 如 256000, 1000000 */
  contextWindow?: number;
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
  { id: 'agentai', label: 'Agnes AI (Flash)', baseURL: 'https://apihub.agnes-ai.com', apiKeyEnv: 'AGENTAI_API_KEY', color: '#4F46E5', enabled: true, isDefault: true, isBuiltIn: true, provider: 'agentai', contextWindow: 256000 },
  { id: 'deepseek', label: 'DeepSeek V4 Flash', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', color: '#10B981', enabled: true, isBuiltIn: true, provider: 'deepseek', contextWindow: 1000000 },
  { id: 'deepseek-pro', label: 'DeepSeek V4 Pro', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', color: '#059669', enabled: true, isBuiltIn: true, provider: 'deepseek', contextWindow: 1000000 },
  { id: 'openai', label: 'OpenAI (GPT-4o)', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', color: '#F59E0B', enabled: false, isBuiltIn: true, provider: 'openai', contextWindow: 128000 },
  { id: 'cline', label: 'Cline (DS Flash 免费)', baseURL: 'https://api.cline.bot/api/v1', apiKeyEnv: 'CLINE_API_KEY', color: '#EC4899', enabled: true, isBuiltIn: true, provider: 'cline', contextWindow: 128000 },
  { id: 'zhipu', label: '智谱 GLM-4.7 Flash (免费)', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZHIPU_API_KEY', color: '#3B82F6', enabled: true, isBuiltIn: true, provider: 'zhipu', contextWindow: 128000 },
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
    { name: 'agentai-models', version: 1, migrate: (persisted: any) => {
      // 清理旧数据中可能错误的 provider 值
      if (persisted?.models) {
        persisted.models = persisted.models.map((m: any) => {
          if (m.id === 'deepseek-pro' && m.provider === 'deepseek-pro') m.provider = 'deepseek';
          return m;
        });
      }
      // partialize: 只持久化 activeModelId, models 从代码中取 (始终最新)
      return { ...persisted, models: DEFAULT_MODELS };
    } },
  ),
);
