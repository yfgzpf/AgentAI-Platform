/**
 * 统一模型选择模块 (灰度测试版本)
 * --------------------------------------------------
 * 与 chat.ts 原有逻辑保持一致，仅做代码结构优化
 * 通过 FEATURE_FLAGS.useNewModelSelector 控制启用
 */

import { userModel } from './user-model.js';
import type { AgentAIRouter } from './llm-router.js';

/** 模型配置项 */
export interface ModelConfig {
  provider: string;
  subModel?: string;
  label: string;
  baseURL?: string;
}

/** 内置模型映射 - 与 chat.ts 原有 MODEL_MAP 保持一致 */
export const BUILTIN_MODELS: Record<string, ModelConfig> = {
  // Agnes AI 模型 (首选)
  'agnes-2.5-flash': { provider: 'agnes', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash' },
  'agnes-2.0': { provider: 'agnes', subModel: 'agnes-2.0', label: 'Agnes 2.0' },
  // 兼容旧版
  'agentai': { provider: 'agnes', subModel: 'agnes-2.5-flash', label: 'Agnes AI' },
  'zhipu': { provider: 'zhipu', subModel: 'glm-4.7-flash', label: '智谱 GLM-4.7 Flash' },
  // DeepSeek (前端 id + 旧兼容 id)
  'deepseek': { provider: 'deepseek', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  'deepseek-v4-flash': { provider: 'deepseek', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
  'deepseek-v4-pro': { provider: 'deepseek', subModel: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
  // OpenAI
  'openai': { provider: 'openai', label: 'OpenAI GPT-4o' },
  'openai-gpt4o': { provider: 'openai', label: 'OpenAI GPT-4o' },
  // 传统独立商业模型 (前端 id + 旧兼容 id)
  'qwen': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 (阿里云)' },
  'qwen-max': { provider: 'qwen', subModel: 'qwen-max', label: '通义千问 Qwen-Max' },
  'moonshot': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Moonshot' },
  'moonshot-kimi': { provider: 'moonshot', subModel: 'kimi-k2.5', label: '月之暗面 Kimi' },
  'anthropic': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude' },
  'anthropic-claude': { provider: 'anthropic', subModel: 'claude-sonnet-4-5-20250929', label: 'Anthropic Claude' },
  'minimax': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax' },
  'minimax-hailuo': { provider: 'minimax', subModel: 'MiniMax-M3', label: 'MiniMax 海螺' },
  'doubao-seed-2.0-pro': { provider: 'doubao', subModel: 'doubao-seed-2.0-pro-250728', label: '豆包 Seed-2.0 Pro' },
  'doubao-1.5-thinking': { provider: 'doubao', subModel: 'doubao-1.5-thinking-vision-pro', label: '豆包 1.5 视觉深度思考' },
  'yi': { provider: 'yi', label: '零一万物 Yi' },
  'baichuan': { provider: 'baichuan', label: '百川智能' },
  'superapi-deepseek-v4-flash': { provider: 'superapi', subModel: 'deepseek-v4-flash', label: 'SuperAPI · DeepSeek V4 Flash' },
  'superapi-deepseek-v4-pro':  { provider: 'superapi', subModel: 'deepseek-v4-pro',  label: 'SuperAPI · DeepSeek V4 Pro' },
  'superapi-glm-5.2':          { provider: 'superapi', subModel: 'glm-5.2',           label: 'SuperAPI · GLM-5.2' },
  'superapi-qwen3.7-plus':     { provider: 'superapi', subModel: 'qwen3.7-plus',      label: 'SuperAPI · Qwen3.7 Plus' },
  'superapi-qwen3.7-max':      { provider: 'superapi', subModel: 'qwen3.7-max',       label: 'SuperAPI · Qwen3.7 Max' },
  'superapi-qwen3.6-plus':     { provider: 'superapi', subModel: 'qwen3.6-plus',      label: 'SuperAPI · Qwen3.6 Plus' },
  'superapi-kimi-k2.7-code':   { provider: 'superapi', subModel: 'kimi-k2.7-code',    label: 'SuperAPI · Kimi K2.7 Code' },
  'superapi-grok-4.3':         { provider: 'superapi', subModel: 'grok-4.3',          label: 'SuperAPI · Grok 4.3' },
  'superapi-doubao-seed-2.0-pro': { provider: 'superapi', subModel: 'doubao-seed-2.0-pro', label: 'SuperAPI · 豆包 Seed 2.0 Pro' },
  'superapi-step-3.7-flash':   { provider: 'superapi', subModel: 'step-3.7-flash',    label: 'SuperAPI · Step 3.7 Flash' },
  'superapi-mimo-v2.5-pro':    { provider: 'superapi', subModel: 'mimo-v2.5-pro',     label: 'SuperAPI · Mimo V2.5 Pro' },
  'superapi-minimax-m3':       { provider: 'superapi', subModel: 'MiniMax-M3',        label: 'SuperAPI · MiniMax M3' },
  // 商汤 SenseNova (免费额度)
  'sensenova-6.7-flash-lite': { provider: 'sensenova', subModel: 'sensenova-6.7-flash-lite', label: 'SenseNova 6.7 Flash-Lite' },
  'sensenova-u1-fast': { provider: 'sensenova', subModel: 'sensenova-u1-fast', label: 'SenseNova U1 Fast' },
  'sensenova-deepseek-v4-flash': { provider: 'sensenova', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (SenseNova)' },
  'sensenova-glm-5.2': { provider: 'sensenova', subModel: 'glm-5.2', label: 'GLM-5.2 (SenseNova)' },
  // 美团 LongCat (免费额度)
  'longcat-2.0': { provider: 'longcat', subModel: 'LongCat-2.0', label: 'LongCat-2.0' },
  // NVIDIA NIM 模型已移除 (2026-07-25)
};

/** Provider → 环境变量 Key 映射 */
const PROVIDER_ENV_KEY: Record<string, string> = {
  agnes: 'AGENTAI_API_KEY',  // Agnes AI 使用 AGENTAI_API_KEY
  agentai: 'AGENTAI_API_KEY', // 兼容旧版
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  superapi: 'SUPERAPI_API_KEY',
  sensenova: 'SENSENOVA_API_KEY',
  longcat: 'LONGCAT_API_KEY',
  // nvidia: 'NVIDIA_API_KEY', 已移除
  qwen: 'DASHSCOPE_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  doubao: 'VOLCANO_API_KEY',
};

/** 动态注册的自定义模型 */
const customModels: Map<string, ModelConfig> = new Map();

/** 注册自定义模型 */
export function registerCustomModel(id: string, config: ModelConfig): void {
  customModels.set(id, config);
  console.log(`[model-selector] registered custom model: ${id} -> ${config.provider}`);
}

/**
 * 自动注册有密钥的模型
 * 扫描 PROVIDER_ENV_KEY，如果有密钥但未在 BUILTIN_MODELS 中定义，自动注册
 */
export function autoRegisterModels(): void {
  for (const [provider, envKey] of Object.entries(PROVIDER_ENV_KEY)) {
    if (!process.env[envKey]) continue; // 没有密钥，跳过
    
    // 检查是否已定义
    const alreadyDefined = Object.entries(BUILTIN_MODELS).some(
      ([, config]) => config.provider === provider
    );
    
    if (!alreadyDefined) {
      // 自动注册为 provider-default
      const autoId = `${provider}-default`;
      customModels.set(autoId, {
        provider,
        label: `${provider} (auto-registered)`,
      });
      console.log(`[model-selector] auto-registered: ${autoId} (found ${envKey})`);
    }
  }
}

// 初始化时自动注册
autoRegisterModels();

/** 获取模型配置 */
export function getModelConfig(id: string): ModelConfig | undefined {
  return BUILTIN_MODELS[id] || customModels.get(id);
}

/** 检查模型是否有效 */
export function isValidModel(id: string): boolean {
  return id in BUILTIN_MODELS || customModels.has(id);
}

/** 模型选择结果 */
export interface ModelSelection {
  provider: string;
  subModel?: string;
  label: string;
  baseURL?: string;
  fallback: boolean;
  requested: string;
}

/**
 * 智能模型选择 - 与 chat.ts 原有 selectAvailableModel 逻辑一致
 */
export function selectAvailableModel(
  requestedModel: string | undefined,
  router?: AgentAIRouter
): ModelSelection {
  const id = requestedModel || 'agentai';
  const config = getModelConfig(id) || BUILTIN_MODELS['agentai']!;
  
  const envKey = PROVIDER_ENV_KEY[config.provider] || `${config.provider.toUpperCase()}_API_KEY`;
  const hasKey = !!process.env[envKey];
  const providerStats = (router as any)?.['providers']?.get(config.provider);
  const isTripped = providerStats?.tripped === true;
  
  if (hasKey && !isTripped) {
    return { ...config, fallback: false, requested: id };
  }
  
  console.warn(`[model-selector] ${config.provider} unavailable (key=${hasKey}, tripped=${isTripped}), falling back...`);
  
  const fallbackOrder = ['agentai', 'zhipu', 'deepseek'];
  for (const fbId of fallbackOrder) {
    const fbConfig = BUILTIN_MODELS[fbId];
    if (!fbConfig || fbId === id) continue;
    
    const fbEnvKey = PROVIDER_ENV_KEY[fbConfig.provider] || `${fbConfig.provider.toUpperCase()}_API_KEY`;
    const fbHasKey = !!process.env[fbEnvKey];
    const fbTripped = (router as any)?.['providers']?.get(fbConfig.provider)?.tripped === true;
    
    if (fbHasKey && !fbTripped) {
      console.log(`[model-selector] fallback to ${fbId}`);
      return { ...fbConfig, fallback: true, baseURL: undefined, requested: id };
    }
  }
  
  return { ...BUILTIN_MODELS['agentai']!, fallback: id !== 'agentai', requested: id };
}

/**
 * 根据用户偏好选择模型 - 与 chat.ts 非流式路径逻辑一致
 */
export function selectModelByPreference(
  userId: string,
  message?: string
): ModelSelection {
  const preferred = userModel.get(userId)?.preferences?.preferredModel || 'agentai';
  
  if (isValidModel(preferred)) {
    const config = getModelConfig(preferred)!;
    const msg = (message || '').toLowerCase();
    const isDeepReason = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock/i.test(msg);
    
    let subModel = config.subModel;
    if (preferred === 'deepseek' && isDeepReason) {
      subModel = 'deepseek-v4-pro';
    }
    
    return { ...config, subModel, fallback: false, requested: preferred };
  }
  
  return { ...BUILTIN_MODELS['agentai']!, fallback: true, requested: preferred };
}
