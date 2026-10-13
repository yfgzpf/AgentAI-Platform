/**
 * 统一模型选择模块 (灰度测试版本)
 * --------------------------------------------------
 * 与 chat.ts 原有逻辑保持一致，仅做代码结构优化
 * 通过 FEATURE_FLAGS.useNewModelSelector 控制启用
 */

import { userModel } from './user-model.js';
import type { AgentAIRouter } from './llm-router.js';
// [模型工厂] 单一真源 — 与 chat.ts 共用, 避免两份 alrc-* 清单零重叠
import { ALRC_MODELS, FACTORY_MODEL_ENTRIES } from './factory-registry.js';

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
  // 2026-10-12: agnes-2.0 官方已下架 (实测 503) → 保留 id 做别名, 指向活的 2.5-flash
  'agnes-2.0': { provider: 'agnes', subModel: 'agnes-2.5-flash', label: 'Agnes 2.5 Flash (原 2.0 别名)' },
  // 兼容旧版
  'agentai': { provider: 'agnes', subModel: 'agnes-2.5-flash', label: 'Agnes AI' },
  'zhipu': { provider: 'zhipu', subModel: 'glm-4.7-flash', label: '智谱 GLM-4.7 Flash' },
  // DeepSeek (前端 id + 旧兼容 id)
  // 2026-10-11: 官方 V4.1-Flash 起, flash 档模型名改为 `deepseek-flash`
  // (旧名 deepseek-v4-flash 官方仅"暂时"兼容路由 → 保留为别名, 指向同一 subModel)
  'deepseek': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
  // 2026-10-11: V4 Pro 官方已下线 (2026-09-14 12:00 起请求全部路由到 V4.1 Flash)。
  // 两个 pro id 保留为**别名**指向 deepseek-flash —— 旧配置/旧会话里残留的 pro 引用
  // 走这里静默降级, 与官方行为一致, 不报错。
  'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)' },
  'deepseek-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
  'deepseek-v4-flash': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1)' },
  'deepseek-v4-pro': { provider: 'deepseek', subModel: 'deepseek-flash', label: 'DeepSeek Flash (V4.1, 原 Pro 别名)' },
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
  // ===== ALRC / 模型工厂模型 =====
  // 原先此处有 20 行手写 alrc-* 条目, 已全部移到 factory-registry.ts (与 chat.ts 共用单一真源)。
  // 见下方 Object.assign(BUILTIN_MODELS, FACTORY_MODEL_ENTRIES)。
  // 商汤 SenseNova (免费额度)
  'sensenova-6.7-flash-lite': { provider: 'sensenova', subModel: 'sensenova-6.7-flash-lite', label: 'SenseNova 6.7 Flash-Lite' },
  'sensenova-u1-fast': { provider: 'sensenova', subModel: 'sensenova-u1-fast', label: 'SenseNova U1 Fast' },
  'sensenova-deepseek-v4-flash': { provider: 'sensenova', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (SenseNova)' },
  'sensenova-glm-5.2': { provider: 'sensenova', subModel: 'glm-5.2', label: 'GLM-5.2 (SenseNova)' },
  // 美团 LongCat (免费额度)
  'longcat-2.0': { provider: 'longcat', subModel: 'LongCat-2.0', label: 'LongCat-2.0' },
  // NVIDIA NIM 模型已移除 (2026-07-25)
};

// ===== 模型工厂条目注入 (2026-10-13) =====
// 原有 20 行手写 alrc-* (gpt/claude/grok/nano-banana 系), 与 chat.ts MODEL_MAP 里的
// alrc-* (glm/kimi/minimax/deepseek 系) **零重叠** —— 走老逻辑/灰度逻辑看到的工厂模型不一样。
// 现在两边都从 factory-registry.ts 的单一真源派生, 含 alrc-* / alrc:* / factory-* 三种 id。
Object.assign(BUILTIN_MODELS, FACTORY_MODEL_ENTRIES);

/**
 * 模型工厂分组密钥 (2026-10-13)
 * ------------------------------------------------------------
 * 设置页 6 个分组各自写入 FACTORY_*_KEY, 而 ALRC_API_KEY 可能始终为空。
 * 原实现只认 ALRC_API_KEY ⇒ 只配了分组密钥时 hasKey=false ⇒ 无声降级免费档。
 */
const FACTORY_GROUP_ENV_KEYS = Object.values(
  Object.fromEntries(Object.values(ALRC_MODELS).map((e) => [e.groupEnv, e.groupEnv])),
);

/** provider 是否具备可用密钥 (含模型工厂分组密钥) */
function providerHasKey(provider: string): boolean {
  if (provider === 'alrc' || provider === 'factory') {
    if (process.env['ALRC_API_KEY']) return true;
    return FACTORY_GROUP_ENV_KEYS.some((k) => !!process.env[k]);
  }
  const envKey = PROVIDER_ENV_KEY[provider] || `${provider.toUpperCase()}_API_KEY`;
  return !!process.env[envKey];
}

/** Provider → 环境变量 Key 映射 */
const PROVIDER_ENV_KEY: Record<string, string> = {
  agnes: 'AGENTAI_API_KEY',  // Agnes AI 使用 AGENTAI_API_KEY
  agentai: 'AGENTAI_API_KEY', // 兼容旧版
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  superapi: 'SUPERAPI_API_KEY',
  alrc: 'ALRC_API_KEY',
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
    // 2026-10-13: 用 providerHasKey 而非只看主 envVar —— 模型工厂可能只配了分组密钥
    //   (FACTORY_*_KEY), ALRC_API_KEY 为空, 旧逻辑会让 alrc 的模型全部不被自动注册。
    if (!providerHasKey(provider)) continue; // 没有密钥，跳过
    
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
  
  const hasKey = providerHasKey(config.provider);
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
    
    const fbHasKey = providerHasKey(fbConfig.provider);
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
    // 2026-10-11: 删除「复杂任务自动升级到 deepseek-v4-pro」的覆盖。
    // 两条理由: ① pro 官方已下线, 升级目标不存在; ② 用户显式选定的模型不再被自动换成别的
    // (用户报「选 4.1 却跑到 pro 频繁中断」的直接来源之一)。
    // deepseek 现在只有 deepseek-flash 一档, 它就是该 provider 的强模型, 无需再升。
    return { ...config, fallback: false, requested: preferred };
  }
  
  return { ...BUILTIN_MODELS['agentai']!, fallback: true, requested: preferred };
}
