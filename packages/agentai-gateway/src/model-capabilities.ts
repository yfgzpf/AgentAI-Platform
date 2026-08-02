/**
 * 模型能力中心 (Model Capabilities Registry)
 * ------------------------------------------------
 * 单一数据源：所有模型的能力参数集中在此定义。
 * 后端 (llm-router.ts) 和前端 (设置页) 都从这读取，避免不一致。
 *
 * 更新原则:
 *   - 模型名称变更 / 窗口更新 → 改这里，其他文件自动生效
 *   - 新增模型 → 加一行 entry，填 modelId + provider + 能力
 *   - 不要在其他文件里重复定义上下文窗口 / 速率限制
 */

export interface ModelCapability {
  /** 模型唯一 ID (前端选择时的 id，如 'agnes-2.5-flash', 'zhipu') */
  id: string;
  /** 显示的标签 */
  label: string;
  /** 所属 provider (llm-router 用) */
  provider: string;
  /** 传给 API 的 subModel 名 (为空则等于 id) */
  subModel?: string;
  /** 上下文窗口 (tokens) */
  contextWindow: number;
  /** 是否免费 */
  isFree: boolean;
  /** 速率限制 (RPM = requests/min，为空则无硬性限制) */
  rateLimitRPM?: number;
  /** 速率限制 (TPM = tokens/min) */
  rateLimitTPM?: number;
  /** 成本 (每 1K tokens 美元，0 = 免费) */
  costPer1K?: number;
}

/**
 * 所有已知模型的能力定义（单源，更新此表即可）
 */
export const MODEL_CAPABILITIES: ModelCapability[] = [
  // ─── Agnes AI (同一套 API, 但 2.5 和 2.0 窗口不同) ───
  {
    id: 'agnes-2.5-flash',
    label: 'Agnes 2.5 Flash (512K)',
    provider: 'agnes',
    subModel: 'agnes-2.5-flash',
    contextWindow: 524_288,    // 512K
    isFree: true,
    rateLimitRPM: 20,
    rateLimitTPM: 20_000,
    costPer1K: 0,
  },
  {
    id: 'agnes-2.0',
    label: 'Agnes 2.0 (256K)',
    provider: 'agnes',
    subModel: 'agnes-2.0',
    contextWindow: 262_144,    // 256K
    isFree: true,
    rateLimitRPM: 20,
    rateLimitTPM: 20_000,
    costPer1K: 0,
  },
  {
    id: 'agentai',
    label: 'Agnes AI (默认 2.5)',
    provider: 'agnes',
    subModel: 'agnes-2.5-flash',
    contextWindow: 524_288,
    isFree: true,
    rateLimitRPM: 20,
    rateLimitTPM: 20_000,
    costPer1K: 0,
  },

  // ─── 智谱 GLM ───
  {
    id: 'zhipu',
    label: '智谱 GLM-4.7 Flash (1M)',
    provider: 'zhipu',
    subModel: 'glm-4.7-flash',
    contextWindow: 1_048_576,  // 1M
    isFree: true,
    rateLimitRPM: 60,
    rateLimitTPM: 60_000,
    costPer1K: 0,
  },

  // ─── DeepSeek ───
  {
    id: 'deepseek',
    label: 'DeepSeek V4 Flash (128K)',
    provider: 'deepseek',
    subModel: 'deepseek-v4-flash',
    contextWindow: 131_072,    // 128K
    isFree: false,
    rateLimitRPM: 100,
    rateLimitTPM: 100_000,
    costPer1K: 0.00014,
  },
  {
    id: 'deepseek-pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    subModel: 'deepseek-v4-pro',
    contextWindow: 131_072,
    isFree: false,
    rateLimitRPM: 50,
    rateLimitTPM: 50_000,
    costPer1K: 0.001,
  },

  // ─── SuperAPI (DeepSeek 兼容) ───
  {
    id: 'superapi',
    label: 'SuperAPI · DeepSeek V4 Flash',
    provider: 'superapi',
    subModel: 'deepseek-v4-flash',
    contextWindow: 131_072,
    isFree: false,
    rateLimitRPM: 60,
    rateLimitTPM: 60_000,
    costPer1K: 0.0002,
  },

  // ─── OpenAI ───
  {
    id: 'openai',
    label: 'OpenAI GPT-4o Mini (128K)',
    provider: 'openai',
    subModel: 'gpt-4o-mini',
    contextWindow: 131_072,
    isFree: false,
    rateLimitRPM: 500,
    rateLimitTPM: 200_000,
    costPer1K: 0.00015,
  },

  // ─── 通义千问 ───
  {
    id: 'qwen',
    label: '通义千问 Qwen-Max (128K)',
    provider: 'qwen',
    subModel: 'qwen-max',
    contextWindow: 131_072,
    isFree: false,
    rateLimitRPM: 60,
    rateLimitTPM: 60_000,
    costPer1K: 0.004,
  },

  // ─── 月之暗面 ───
  {
    id: 'moonshot',
    label: 'Moonshot Kimi K2.5 (128K)',
    provider: 'moonshot',
    subModel: 'kimi-k2.5',
    contextWindow: 131_072,
    isFree: false,
    rateLimitRPM: 30,
    rateLimitTPM: 30_000,
    costPer1K: 0.002,
  },

  // ─── 商汤 SenseNova (免费额度) ───
  {
    id: 'sensenova',
    label: 'SenseNova Flash Lite (1M)',
    provider: 'sensenova',
    subModel: 'sensenova-6.7-flash-lite',
    contextWindow: 1_048_576,
    isFree: true,
    rateLimitRPM: 30,
    rateLimitTPM: 30_000,
    costPer1K: 0,
  },

  // ─── LongCat (美团, 免费额度) ───
  {
    id: 'longcat',
    label: 'LongCat 2.0 (256K)',
    provider: 'longcat',
    subModel: 'LongCat-2.0',
    contextWindow: 262_144,
    isFree: true,
    rateLimitRPM: 30,
    rateLimitTPM: 30_000,
    costPer1K: 0,
  },

  // ─── DXNT (免费额度) ───
  {
    id: 'dxnt',
    label: 'DXNT Free',
    provider: 'dxnt',
    subModel: 'dxnt.com/free',
    contextWindow: 131_072,
    isFree: true,
    rateLimitRPM: 20,
    rateLimitTPM: 20_000,
    costPer1K: 0,
  },

  // ─── Anthropic Claude ───
  {
    id: 'anthropic',
    label: 'Anthropic Claude Sonnet 4.5 (200K)',
    provider: 'anthropic',
    subModel: 'claude-sonnet-4-5-20250929',
    contextWindow: 200_000,
    isFree: false,
    rateLimitRPM: 50,
    rateLimitTPM: 50_000,
    costPer1K: 0.003,
  },
];

/** 按 id 查找 */
export function getCapability(id: string): ModelCapability | undefined {
  return MODEL_CAPABILITIES.find(m => m.id === id);
}

/** 按 provider 列出所有能力 (用于 fallback 链) */
export function getCapabilitiesByProvider(provider: string): ModelCapability[] {
  return MODEL_CAPABILITIES.filter(m => m.provider === provider);
}

/** 所有免费模型 (用于路由排序) */
export const FREE_MODEL_IDS = MODEL_CAPABILITIES
  .filter(m => m.isFree)
  .map(m => m.id);

/** provider 级默认 contextWindow (取该 provider 最大窗口的模型) */
export function getDefaultContextWindow(provider: string): number {
  const models = getCapabilitiesByProvider(provider);
  return models.length > 0 ? Math.max(...models.map(m => m.contextWindow)) : 131_072;
}

/** model 名 → contextWindow (与 llm-router.ts PROVIDER_CONTEXT_WINDOW 等价，但按 model 粒度) */
export function getModelContextWindow(modelId: string): number | undefined {
  const m = getCapability(modelId);
  return m?.contextWindow;
}
