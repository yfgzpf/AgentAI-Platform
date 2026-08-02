import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** 模型类型: 决定出现在哪个选择器中 */
export type ModelType = 'chat' | 'image' | 'video';

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
  contextWindow?: number;
  isCommercial?: boolean;
  groupLabel?: string;
  freeQuotaNote?: string;
  /** 模型类型: chat(文本对话) / image(生图) / video(生视频) */
  modelType?: ModelType;
  /** 兼容旧字段, 自动从 modelType 推导 */
  capabilities?: string[];
}

interface ModelState {
  models: ModelConfig[];
  activeModelId: string;
  /** 对话模式: 'chat' | 'image_edit' */
  chatMode: 'chat' | 'image_edit';
  setChatMode: (mode: 'chat' | 'image_edit') => void;
  setActive: (id: string) => void;
  addModel: (c: Omit<ModelConfig, 'id' | 'isBuiltIn'>) => string;
  removeModel: (id: string) => void;
  toggleModel: (id: string, enabled?: boolean) => void;
  commercialKeys: Record<string, string>;
  setCommercialKey: (apiKeyEnv: string, apiKey: string) => void;
  removeCommercialKey: (apiKeyEnv: string) => void;
  /** 从后端动态加载模型列表 */
  loadDynamicModels: () => Promise<void>;
  /** 后端返回的可用 provider 列表缓存 (用于动态显示) */
  backendProviders: Array<{name:string; hasKey:boolean; tripped:boolean; modelCount:number; isPaid:boolean; bestAvailableModel:string|null}>;
  /** 是否已初始化动态加载 */
  _dynamicLoaded: boolean;
  /** 查询 provider 在后端的 key 状态 */
  providerHasKey: (providerName: string) => boolean;
  /** AI上下文注入开关 */
  contextInject: { readme: boolean; packageJson: boolean; activeFile: boolean };
  setContextInject: (key: 'readme' | 'packageJson' | 'activeFile', value: boolean) => void;
}

// ===== Agnes AI 模型 (首选) =====
// agnes-2.5-flash: 512K 长上下文, 免费但非最弱, 可作为首选/商用
// agnes-2.0: 256K 上下文, 备用模型
const AGNES_MODELS: ModelConfig[] = [
  { id: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (首选 · 512K)', baseURL: 'https://api.agnes-ai.cn/v1', apiKeyEnv: 'AGENTAI_API_KEY', color: '#4F46E5', enabled: true, isDefault: true, isBuiltIn: true, provider: 'agnes', models: ['agnes-2.5-flash'], contextWindow: 512000, groupLabel: 'Agnes AI', modelType: 'chat' },
  { id: 'agnes-2.0', label: 'Agnes 2.0 (备用 · 256K)', baseURL: 'https://api.agnes-ai.cn/v1', apiKeyEnv: 'AGENTAI_API_KEY', color: '#6366F1', enabled: true, isBuiltIn: true, provider: 'agnes', models: ['agnes-2.0'], contextWindow: 256000, groupLabel: 'Agnes AI', modelType: 'chat' },
  // 兼容旧版 agentai id
  { id: 'agentai', label: 'Agnes AI (兼容)', baseURL: 'https://api.agnes-ai.cn/v1', apiKeyEnv: 'AGENTAI_API_KEY', color: '#8B5CF6', enabled: false, isBuiltIn: true, provider: 'agnes', contextWindow: 256000, groupLabel: 'Agnes AI', modelType: 'chat' },
];

// ===== 免费文本模型 =====
const FREE_CHAT_MODELS: ModelConfig[] = [
  { id: 'zhipu', label: '智谱 GLM-4.7 Flash (免费)', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZHIPU_API_KEY', color: '#3B82F6', enabled: true, isBuiltIn: true, provider: 'zhipu', contextWindow: 128000, groupLabel: '免费模型', modelType: 'chat' },
];

// ===== 官方文本模型 (独立 API) =====
const OFFICIAL_CHAT_MODELS: ModelConfig[] = [
  // DeepSeek V4 (2026年最新)
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (284B)', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', color: '#10B981', enabled: false, isBuiltIn: true, provider: 'deepseek', contextWindow: 1000000, isCommercial: true, groupLabel: 'DeepSeek', modelType: 'chat' },
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (1.6T)', baseURL: 'https://api.deepseek.com/v1', apiKeyEnv: 'DEEPSEEK_API_KEY', color: '#059669', enabled: false, isBuiltIn: true, provider: 'deepseek', contextWindow: 1000000, isCommercial: true, groupLabel: 'DeepSeek', modelType: 'chat' },
  // OpenAI
  { id: 'openai-gpt4o', label: 'OpenAI GPT-4o / o1/o3-mini', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', color: '#F59E0B', enabled: false, isBuiltIn: true, provider: 'openai', contextWindow: 128000, isCommercial: true, groupLabel: 'OpenAI', modelType: 'chat' },
  // 通义千问 (阿里云)
  { id: 'qwen-max', label: '通义千问 Qwen-Max (阿里云)', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', color: '#FF6A00', enabled: false, isBuiltIn: true, provider: 'qwen', models: ['qwen-max'], contextWindow: 131072, isCommercial: true, groupLabel: '通义千问', modelType: 'chat', freeQuotaNote: '100万Token免费' },
  // 豆包/火山引擎 (文本)
  { id: 'doubao-seed-2.0-pro', label: '豆包 Seed-2.0 Pro (火山引擎)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#06B6D4', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['doubao-seed-2.0-pro-250728'], contextWindow: 128000, isCommercial: true, groupLabel: '豆包(火山引擎)', modelType: 'chat', freeQuotaNote: '50万Token免费' },
  { id: 'doubao-1.5-thinking', label: '豆包 1.5 视觉深度思考', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#0891b2', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['doubao-1.5-thinking-vision-pro'], contextWindow: 128000, isCommercial: true, groupLabel: '豆包(火山引擎)', modelType: 'chat' },
  // 月之暗面 Moonshot/Kimi (支持多模型选择)
  { id: 'moonshot-kimi', label: '月之暗面 Kimi (Moonshot)', baseURL: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY', color: '#6466F1', enabled: false, isBuiltIn: true, provider: 'moonshot', models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3'], contextWindow: 128000, isCommercial: true, groupLabel: '月之暗面', modelType: 'chat' },
  // Anthropic Claude
  { id: 'anthropic-claude', label: 'Anthropic Claude Sonnet/Opus/Haiku', baseURL: 'https://api.anthropic.com/v1', apiKeyEnv: 'ANTHROPIC_API_KEY', color: '#D97706', enabled: false, isBuiltIn: true, provider: 'anthropic', models: ['claude-sonnet-4-5-20250929'], contextWindow: 200000, isCommercial: true, groupLabel: 'Anthropic', modelType: 'chat' },
  // MiniMax
  { id: 'minimax-hailuo', label: 'MiniMax 海螺', baseURL: 'https://api.minimax.chat/v1', apiKeyEnv: 'MINIMAX_API_KEY', color: '#EC4899', enabled: false, isBuiltIn: true, provider: 'minimax', models: ['MiniMax-M3'], contextWindow: 128000, isCommercial: true, groupLabel: 'MiniMax', modelType: 'chat' },
];

// ===== 官方生图模型 =====
const OFFICIAL_IMAGE_MODELS: ModelConfig[] = [
  { id: 'cogview', label: 'CogView-3-Flash (智谱免费)', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZHIPU_API_KEY', color: '#3B82F6', enabled: false, isBuiltIn: true, provider: 'zhipu', modelType: 'image', isCommercial: true, groupLabel: '官方生图模型', freeQuotaNote: '免费' },
  { id: 'wanx-image', label: '通义万相 Wanx2.1 (阿里云)', baseURL: 'https://dashscope.aliyuncs.com/api/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', color: '#FF6A00', enabled: false, isBuiltIn: true, provider: 'dashscope', modelType: 'image', isCommercial: true, groupLabel: '官方生图模型', freeQuotaNote: '500张免费' },
  { id: 'seedream', label: 'Seedream 4.0 (火山引擎)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#06B6D4', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['doubao-seedream-4.0-250828'], modelType: 'image', isCommercial: true, groupLabel: '官方生图模型', freeQuotaNote: '50次/天免费' },
  { id: 'nvidia-qwen-image', label: 'NVIDIA Qwen Image (免费)', baseURL: 'https://integrate.api.nvidia.com/v1', apiKeyEnv: 'NVIDIA_API_KEY', color: '#76B900', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['qwen/qwen-image'], modelType: 'image', isCommercial: true, groupLabel: '官方生图模型', freeQuotaNote: '免费' },
];

// ===== 官方生视频模型 =====
const OFFICIAL_VIDEO_MODELS: ModelConfig[] = [
  // 智谱 CogVideoX (免费)
  { id: 'cogvideo', label: 'CogVideoX-Flash (智谱免费)', baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZHIPU_API_KEY', color: '#3B82F6', enabled: false, isBuiltIn: true, provider: 'zhipu', modelType: 'video', isCommercial: true, groupLabel: '智谱(生视频)', freeQuotaNote: '免费' },
  // 通义万相 Wanx (阿里云)
  { id: 'wanx-video', label: '通义万相 Wanx2.0 视频 (阿里云)', baseURL: 'https://dashscope.aliyuncs.com/api/v1', apiKeyEnv: 'DASHSCOPE_API_KEY', color: '#FF6A00', enabled: false, isBuiltIn: true, provider: 'dashscope', modelType: 'video', isCommercial: true, groupLabel: '通义千问(生视频)', freeQuotaNote: '50次/天免费' },
  // 豆包 Seedance 系列 (火山引擎) - 完整版
  { id: 'seedance-1.0-lite', label: '豆包 Seedance 1.0 Lite (轻量版)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#06B6D4', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['seedance-1.0-lite'], contextWindow: 128000, isCommercial: true, groupLabel: '豆包Seedance(视频)', modelType: 'video' },
  { id: 'seedance-1.0-pro', label: '豆包 Seedance 1.0 Pro (专业版)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#0891b2', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['seedance-1.0-pro'], contextWindow: 128000, isCommercial: true, groupLabel: '豆包Seedance(视频)', modelType: 'video' },
  { id: 'seedance-2.0', label: '豆包 Seedance 2.0 (即梦版)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'VOLCANO_API_KEY', color: '#7C3AED', enabled: false, isBuiltIn: true, provider: 'doubao', models: ['seedance-2.0'], contextWindow: 128000, isCommercial: true, groupLabel: '豆包Seedance(视频)', modelType: 'video' },
  // 第三方视频
  { id: 'runway-gen3', label: 'Runway Gen-3 (专业级)', baseURL: 'https://api.runwayml.com/v1', apiKeyEnv: 'RUNWAY_API_KEY', color: '#00D4FF', enabled: false, isBuiltIn: true, provider: 'runway', modelType: 'video', isCommercial: true, groupLabel: '第三方(视频)' },
  { id: 'pika-labs', label: 'Pika Labs (AI视频新秀)', baseURL: 'https://api.pika.art/v1', apiKeyEnv: 'PIKA_API_KEY', color: '#A855F7', enabled: false, isBuiltIn: true, provider: 'pika', modelType: 'video', isCommercial: true, groupLabel: '第三方(视频)' },
];

// ===== 第三方生图模型 =====
const THIRD_PARTY_IMAGE_MODELS: ModelConfig[] = [
  { id: 'stability-sdxl', label: 'Stable Diffusion XL', baseURL: 'https://api.stability.ai/v2beta', apiKeyEnv: 'STABILITY_API_KEY', color: '#9333EA', enabled: false, isBuiltIn: true, provider: 'stability', modelType: 'image', isCommercial: true, groupLabel: '第三方生图模型' },
  { id: 'dalle3', label: 'DALL·E 3 (OpenAI)', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', color: '#F59E0B', enabled: false, isBuiltIn: true, provider: 'openai', modelType: 'image', isCommercial: true, groupLabel: '第三方生图模型' },
];

// ===== SuperAPI 工厂模型 (单密钥多模型, 保留兼容) =====
const SUPERAPI_BASE = 'https://superapi.vanguard.dpdns.org/v1';
const SUPERAPI_MODELS: ModelConfig[] = [
  { id: 'superapi-deepseek-v4-flash', label: 'DeepSeek V4 Flash (SuperAPI)', baseURL: SUPERAPI_BASE, apiKeyEnv: 'SUPERAPI_API_KEY', color: '#10B981', enabled: false, isBuiltIn: true, provider: 'superapi', models: ['deepseek-v4-flash'], contextWindow: 128000, isCommercial: true, groupLabel: 'SuperAPI 聚合', modelType: 'chat' },
  { id: 'superapi-glm-5.2', label: 'GLM-5.2 (SuperAPI)', baseURL: SUPERAPI_BASE, apiKeyEnv: 'SUPERAPI_API_KEY', color: '#3B82F6', enabled: false, isBuiltIn: true, provider: 'superapi', models: ['glm-5.2'], contextWindow: 128000, isCommercial: true, groupLabel: 'SuperAPI 聚合', modelType: 'chat' },
  { id: 'superapi-qwen3.7-plus', label: 'Qwen3.7 Plus (SuperAPI)', baseURL: SUPERAPI_BASE, apiKeyEnv: 'SUPERAPI_API_KEY', color: '#FF6A00', enabled: false, isBuiltIn: true, provider: 'superapi', models: ['qwen3.7-plus'], contextWindow: 128000, isCommercial: true, groupLabel: 'SuperAPI 聚合', modelType: 'chat' },
  { id: 'superapi-doubao-seed-2.0-pro', label: '豆包 Seed 2.0 Pro (SuperAPI)', baseURL: SUPERAPI_BASE, apiKeyEnv: 'SUPERAPI_API_KEY', color: '#06B6D4', enabled: false, isBuiltIn: true, provider: 'superapi', models: ['doubao-seed-2.0-pro'], contextWindow: 128000, isCommercial: true, groupLabel: 'SuperAPI 聚合', modelType: 'chat' },
  { id: 'superapi-kimi-k2.7-code', label: 'Kimi K2.7 Code (SuperAPI)', baseURL: SUPERAPI_BASE, apiKeyEnv: 'SUPERAPI_API_KEY', color: '#6466F1', enabled: false, isBuiltIn: true, provider: 'superapi', models: ['kimi-k2.7-code'], contextWindow: 128000, isCommercial: true, groupLabel: 'SuperAPI 聚合', modelType: 'chat' },
];

// ===== 第三方免费聚合 (SenseNova/LongCat/NVIDIA) =====
const SENSENOVA_BASE = 'https://token.sensenova.cn/v1';
const SENSENOVA_MODELS: ModelConfig[] = [
  { id: 'sensenova-6.7-flash-lite', label: 'SenseNova 6.7 Flash-Lite', baseURL: SENSENOVA_BASE, apiKeyEnv: 'SENSENOVA_API_KEY', color: '#2563EB', enabled: false, isBuiltIn: true, provider: 'sensenova', models: ['sensenova-6.7-flash-lite'], contextWindow: 262144, isCommercial: true, groupLabel: '商汤 SenseNova', modelType: 'chat', freeQuotaNote: '每5小时1500次' },
  { id: 'sensenova-deepseek-v4-flash', label: 'DeepSeek V4 Flash (SenseNova)', baseURL: SENSENOVA_BASE, apiKeyEnv: 'SENSENOVA_API_KEY', color: '#1E40AF', enabled: false, isBuiltIn: true, provider: 'sensenova', models: ['deepseek-v4-flash'], contextWindow: 1000000, isCommercial: true, groupLabel: '商汤 SenseNova', modelType: 'chat', freeQuotaNote: '每5小时500次' },
];

const LONGCAT_BASE = 'https://api.longcat.chat/openai';
const LONGCAT_MODELS: ModelConfig[] = [
  { id: 'longcat-2.0', label: 'LongCat-2.0 (多模态)', baseURL: LONGCAT_BASE, apiKeyEnv: 'LONGCAT_API_KEY', color: '#FFD700', enabled: false, isBuiltIn: true, provider: 'longcat', models: ['LongCat-2.0'], contextWindow: 1000000, isCommercial: true, groupLabel: '美团 LongCat', modelType: 'chat', freeQuotaNote: '1M上下文' },
];

const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODELS: ModelConfig[] = [
  // Chat 模型
  { id: 'nvidia-glm-5.2', label: 'GLM-5.2 (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#3B82F6', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['z-ai/glm-5.2'], contextWindow: 128000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-deepseek-v4-flash', label: 'DeepSeek V4 Flash (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#10B981', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['deepseek-ai/deepseek-v4-flash'], contextWindow: 1000000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-deepseek-v4-pro', label: 'DeepSeek V4 Pro (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#059669', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['deepseek-ai/deepseek-v4-pro'], contextWindow: 1000000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-kimi-k2.6', label: 'Kimi K2.6 (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#6466F1', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['moonshotai/kimi-k2.6'], contextWindow: 128000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-nemotron-ultra', label: 'Nemotron 3 Ultra (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#7C3AED', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['nvidia/nemotron-3-ultra-550b-a55b'], contextWindow: 128000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-step-3.7-flash', label: 'Step 3.7 Flash (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#F59E0B', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['stepfun-ai/step-3.7-flash'], contextWindow: 128000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  { id: 'nvidia-minimax-m3', label: 'MiniMax M3 (NVIDIA)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#EC4899', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['minimaxai/minimax-m3'], contextWindow: 128000, isCommercial: true, groupLabel: 'NVIDIA NIM Chat', modelType: 'chat' },
  // Image 生成模型
  { id: 'nvidia-qwen-image', label: 'Qwen Image (NVIDIA 生图)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#76B900', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['qwen/qwen-image'], modelType: 'image', isCommercial: true, groupLabel: 'NVIDIA NIM Image', freeQuotaNote: '免费' },
  { id: 'nvidia-sdxl', label: 'SDXL (NVIDIA 生图)', baseURL: NVIDIA_BASE, apiKeyEnv: 'NVIDIA_API_KEY', color: '#9333EA', enabled: false, isBuiltIn: true, provider: 'nvidia', models: ['stabilityai/sdxl-turbo'], modelType: 'image', isCommercial: true, groupLabel: 'NVIDIA NIM Image', freeQuotaNote: '免费' },
];

// ===== 合并 =====
const DEFAULT_MODELS = [
  ...AGNES_MODELS,        // Agnes AI 模型 (首选)
  ...FREE_CHAT_MODELS,
  ...OFFICIAL_CHAT_MODELS,
  ...OFFICIAL_IMAGE_MODELS,
  ...OFFICIAL_VIDEO_MODELS,
  ...THIRD_PARTY_IMAGE_MODELS,
  ...SUPERAPI_MODELS,
  ...SENSENOVA_MODELS,
  ...LONGCAT_MODELS,
  ...NVIDIA_MODELS,
];

/** 辅助: 判断是否为免费模型 (by id) */
function isFreeModelById(id: string): boolean {
  return id === 'agentai' || id === 'zhipu';
}

/** 辅助: 获取某种类型的所有模型 ID */
export function getModelIdsByType(models: ModelConfig[], type: ModelType): string[] {
  return models.filter(m => m.modelType === type).map(m => m.id);
}

/** 对话改图模式可选模型: modelType === 'chat' 且支持多模态的模型, 或 modelType === 'image' */
export function getImageEditModelIds(models: ModelConfig[]): string[] {
  return models.filter(m => {
    if (m.modelType === 'image') return true; // 生图模型直接可用
    // 文本模型中支持图片理解的
    if (m.modelType === 'chat' && (m.id === 'zhipu' || m.id === 'doubao-chat' || m.id === 'qwen-chat' || m.id === 'longcat-2.0')) return true;
    return false;
  }).map(m => m.id);
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: DEFAULT_MODELS,
      activeModelId: DEFAULT_MODELS.find(m => m.isDefault)?.id || 'agentai',
      chatMode: 'chat',
      commercialKeys: {},
      backendProviders: [],
      _dynamicLoaded: false,
      contextInject: { readme: true, packageJson: true, activeFile: true },
      setContextInject: (key, value) => set((s) => ({ contextInject: { ...s.contextInject, [key]: value } })),
      setChatMode: (mode) => set({ chatMode: mode }),
      setActive: (id) => {
        set({ activeModelId: id });
        fetch('/v1/profile/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferredModel: id, syncAll: true }),
        }).catch(() => {});
      },
      addModel: (c) => {
        const id = `custom-${Date.now()}`;
        set((s) => ({ models: [...s.models, { ...c, id, isBuiltIn: false }] }));
        return id;
      },
      removeModel: (id) => set((s) => ({ models: s.models.filter(m => m.id !== id), activeModelId: s.activeModelId === id ? 'agentai' : s.activeModelId })),
      toggleModel: (id, enabled) => set((s) => ({ models: s.models.map(m => m.id === id ? { ...m, enabled: enabled ?? !m.enabled } : m) })),
      setCommercialKey: (apiKeyEnv, apiKey) => set((s) => ({ commercialKeys: { ...s.commercialKeys, [apiKeyEnv]: apiKey } })),
      removeCommercialKey: (apiKeyEnv) => {
        const keys = { ...get().commercialKeys };
        delete keys[apiKeyEnv];
        set({ commercialKeys: keys });
      },
      loadDynamicModels: async () => {
        try {
          // 同时请求两个端点: /v1/models/available 用于快速判断, /v1/models/providers 用于详情
          const res = await fetch('/v1/models/available');
          if (!res.ok) return;
          const data = await res.json();
          if (!data.ok || !data.providers) return;

          // 缓存后端可用 provider 列表
          const providers = data.providers as Array<{name:string; hasKey:boolean; tripped:boolean; modelCount:number; isPaid:boolean; bestAvailableModel:string|null}>;

          // 🔧 补充: 前端 localStorage/commercialKeys 有 key 但后端没检测到的 → 强制显示
          const PROVIDER_ENV_MAP: Record<string, string> = {
            agentai: 'AGENTAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', openai: 'OPENAI_API_KEY',
            zhipu: 'ZHIPU_API_KEY', superapi: 'SUPERAPI_API_KEY', sensenova: 'SENSENOVA_API_KEY',
            longcat: 'LONGCAT_API_KEY', nvidia: 'NVIDIA_API_KEY', qwen: 'DASHSCOPE_API_KEY',
            moonshot: 'MOONSHOT_API_KEY', anthropic: 'ANTHROPIC_API_KEY', minimax: 'MINIMAX_API_KEY',
            doubao: 'VOLCANO_API_KEY',
          };
          const enrichedProviders = providers.map((p: any) => {
            const envKey = PROVIDER_ENV_MAP[p.name] || `${p.name.toUpperCase()}_API_KEY`;
            // 🔧 修复: 同时检查 localStorage 和 sessionStorage（安全存储迁移后使用）
            const localHasKey = !!localStorage.getItem(envKey) ||
              !!localStorage.getItem(`__agentai_key_${p.name}`) ||
              !!sessionStorage.getItem('agentai.' + envKey) ||
              !!sessionStorage.getItem(`agentai.__agentai_key_${p.name}`);
            return { ...p, hasKey: p.hasKey || localHasKey };
          });

          set((s) => {
            // 收集用户手动启用的模型 (从 persist 水合后数据)
            const userEnabled = new Set(s.models.filter(m => m.enabled && !isFreeModelById(m.id)).map(m => m.id));
            const updated = s.models.map(m => {
              // 免费模型始终显示
              if (isFreeModelById(m.id)) return { ...m, enabled: true };

              // 用户手动启用的模型: 保留不覆盖
              if (userEnabled.has(m.id)) return m;

              // 查找 provider 在后端的状态
              const p = enrichedProviders.find((p: any) => p.name === m.provider);
              if (!p) return m; // 后端未知的 provider, 保持原状

              const backendAvailable = p.hasKey && !p.tripped;
              // enabled = 后端可用 或 localStorage 或 sessionStorage 有过记录
              const envKey = m.apiKeyEnv || `${m.id.toUpperCase()}_API_KEY`;
              const localStorageHasKey = !!localStorage.getItem(envKey);
              const sessionStorageHasKey = !!sessionStorage.getItem('agentai.' + envKey);  // 🔧 修复
              // 也检查 commercialKeys
              const storeHasKey = !!s.commercialKeys[envKey];
              const nowEnabled = backendAvailable || localStorageHasKey || sessionStorageHasKey || storeHasKey || m.enabled;
              return { ...m, enabled: nowEnabled };
            });
            return { models: updated, backendProviders: enrichedProviders, _dynamicLoaded: true };
          });
        } catch (e) {
          console.warn('[modelStore] failed to load dynamic models:', e);
        }
      },
      /** 辅助: provider 在后台是否有 key */
      providerHasKey: (providerName: string): boolean => {
        const p = get().backendProviders.find(p => p.name === providerName);
        return p ? (p.hasKey && !p.tripped) : false;
      },
    }),
    {
      name: 'agentai-models',
      version: 11,
      migrate: (persisted: any, version: number) => {
        // v11: 强制重建内置模型列表 — 引入 agnes-2.5-flash (512K 首选) 和 agnes-2.0 (256K 备用)
        // 旧版本 (≤10) 的内置列表不含 agnes-2.5-flash, 必须用新 DEFAULT_MODELS 替换
        if (version < 11 && persisted?.models) {
          const oldEnabled: string[] = (persisted.models || [])
            .filter((m: any) => m.enabled).map((m: any) => m.id);
          const userCustomModels = (persisted.models || []).filter((m: any) => !m.isBuiltIn);
          persisted.models = [
            ...DEFAULT_MODELS.map(m => ({ ...m, enabled: oldEnabled.includes(m.id) || m.enabled })),
            ...userCustomModels,
          ];
          if (!persisted.chatMode) persisted.chatMode = 'chat';
          // 旧 activeModelId 若不在新列表中, 回退到 agnes-2.5-flash (新首选)
          const newIds = new Set(DEFAULT_MODELS.map((m: any) => m.id));
          if (persisted.activeModelId && !newIds.has(persisted.activeModelId)) {
            persisted.activeModelId = 'agnes-2.5-flash';
          }
        }
        return {
          ...persisted,
          commercialKeys: persisted?.commercialKeys || {},
        };
      },
    },
  ),
);

// ===== 自动初始化: 从后端同步 provider 状态 =====
setTimeout(() => {
  useModelStore.getState().loadDynamicModels().catch(() => {});
}, 300);
