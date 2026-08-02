/**
 * Provider 协议配置 (白名单机制)
 * ----------------------------------------------------
 * 解决元模式 2 (协议字段泄漏):
 *   每个 provider 声明支持的扩展字段白名单
 *   请求体构建时自动过滤非白名单字段
 *
 * @see 第四层诊断: 架构预防 - 元模式 2
 */

import type { ProviderId } from './llm-router.js';

/** Provider 配置 */
export interface ProviderProtocolConfig {
  /** 支持的 OpenAI 标准字段 */
  standardFields: string[];
  /** 支持的扩展字段 (非标准) */
  extensionFields: string[];
  /** 是否支持 tool calling */
  supportsTools: boolean;
  /** 是否支持 thinking 模式 */
  supportsThinking: boolean;
  /** 是否支持图片输入 */
  supportsImages: boolean;
  /** 是否支持流式 tool_calls delta */
  supportsStreamToolCalls: boolean;
}

/**
 * 各 provider 的协议配置
 * agentai: 支持完整扩展 (thinking, chat_template_kwargs, image_url)
 * deepseek: 仅支持标准 OpenAI 字段
 * openai: 支持标准 + 部分扩展 (image_url, stream tool_calls)
 * cline: 支持标准 + reasoning 字段 (data 嵌套响应格式)
 */
export const PROVIDER_CONFIGS: Record<ProviderId, ProviderProtocolConfig> = {
  agentai: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['chat_template_kwargs', 'thinking_budget', 'enable_thinking'],
    supportsTools: true,
    supportsThinking: true,
    supportsImages: true,
    supportsStreamToolCalls: true,
  },
  deepseek: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools', 'reasoning_content'],
    extensionFields: ['thinking', 'reasoning_effort'],
    supportsTools: true,
    supportsThinking: true,  // DeepSeek V4: thinking + reasoning_effort 参数
    supportsImages: false,
    supportsStreamToolCalls: false,
  },
  openai: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools', 'modalities', 'prediction'],
    extensionFields: ['parallel_tool_calls', 'store', 'metadata', 'service_tier'],
    supportsTools: true,
    supportsThinking: true,  // o1/o3 系列自带推理
    supportsImages: true,
    supportsStreamToolCalls: true,
  },
  cline: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['reasoning', 'reasoning_details'],
    supportsTools: true,
    supportsThinking: true,  // cline 支持 reasoning 扩展字段
    supportsImages: false,
    supportsStreamToolCalls: true,
  },
  sensenova: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools', 'n', 'stop', 'frequency_penalty', 'presence_penalty'],
    extensionFields: ['reasoning_effort', 'response_format', 'stream_options', 'tool_choice', 'parallel_tool_calls', 'seed'],
    supportsTools: true,
    supportsThinking: true,  // 支持 reasoning_effort: low/medium/high/none
    supportsImages: true,    // sensenova-6.7-flash-lite 支持图像输入
    supportsStreamToolCalls: true,
  },
  longcat: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['tool_choice', 'parallel_tool_calls', 'response_format'],
    supportsTools: true,
    supportsThinking: false,
    supportsImages: true,    // LongCat-2.0 是多模态模型
    supportsStreamToolCalls: true,
  },
  // 智谱 GLM
  zhipu: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['thinking', 'tool_choice', 'response_format'],
    supportsTools: true,
    supportsThinking: true,  // GLM-4.5 支持思考模式
    supportsImages: true,    // GLM-4V 系列支持图像
    supportsStreamToolCalls: true,
  },
  // SuperAPI (聚合代理, 兼容 OpenAI 协议)
  superapi: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['tool_choice', 'parallel_tool_calls', 'response_format'],
    supportsTools: true,
    supportsThinking: false,
    supportsImages: true,
    supportsStreamToolCalls: true,
  },
  // DXNT (聚合代理, 兼容 OpenAI 协议)
  dxnt: {
    standardFields: ['model', 'messages', 'temperature', 'max_tokens', 'stream', 'tools'],
    extensionFields: ['tool_choice', 'parallel_tool_calls', 'response_format'],
    supportsTools: true,
    supportsThinking: false,
    supportsImages: true,
    supportsStreamToolCalls: true,
  },
  // nvidia provider config 已移除 (2026-07-25)
};

/**
 * 获取指定 provider 的完整扩展字段列表
 */
export function getAllowedExtensionFields(providerId: ProviderId): string[] {
  const config = PROVIDER_CONFIGS[providerId];
  if (!config) return [];
  return [...(config.extensionFields || [])];
}

/**
 * 过滤请求体: 只保留 provider 支持的字段
 * - 标准字段始终保留
 * - 扩展字段只在白名单中才保留
 */
export function filterRequestFields(
  body: Record<string, unknown>,
  providerId: ProviderId,
): Record<string, unknown> {
  const config = PROVIDER_CONFIGS[providerId];
  if (!config) return body; // 未知 provider 不过滤

  const allowed = new Set([...config.standardFields, ...config.extensionFields]);
  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    if (allowed.has(key)) {
      filtered[key] = value;
    }
    // 不在白名单中的字段静默丢弃
  }

  return filtered;
}

/**
 * 构建 thinking 扩展字段 (根据 provider 自动选择思考机制)
 */
export function buildThinkingExtension(
  providerId: ProviderId,
  enabled: boolean,
  budget?: number,
): Record<string, unknown> | null {
  const config = PROVIDER_CONFIGS[providerId];
  if (!config || !config.supportsThinking || !enabled) return null;

  if (providerId === 'agentai') {
    const ext: Record<string, unknown> = { enable_thinking: true };
    if (budget && budget > 0) {
      ext.thinking_budget = budget;
    }
    return { chat_template_kwargs: ext };
  }

  if (providerId === 'deepseek') {
    return { thinking: { type: 'enabled' }, reasoning_effort: 'high' };
  }

  // OpenAI: o1/o3 自带推理能力, 无需额外参数
  return null;
}
