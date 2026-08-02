/**
 * 商用模型预配置模板
 * ----------------------------------------------------
 * 预配置国内及常用 OpenAI 兼容 API 端点,
 * 用户只需填入 API Key 即可连接使用。
 */

export interface CommercialModelTemplate {
  id: string;
  label: string;
  baseURL: string;
  models: string[];
  docsUrl: string;
  color: string;
  /** 上下文窗口建议值 */
  contextWindow: number;
}

export const COMMERCIAL_MODEL_TEMPLATES: CommercialModelTemplate[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    docsUrl: 'https://platform.deepseek.com/api-keys',
    color: '#10B981',
    contextWindow: 1_000_000,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    docsUrl: 'https://platform.openai.com/api-keys',
    color: '#F59E0B',
    contextWindow: 128_000,
  },
  {
    id: 'qwen',
    label: '通义千问 (阿里云)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    docsUrl: 'https://help.aliyun.com/zh/dashscope',
    color: '#FF6A00',
    contextWindow: 128_000,
  },
  {
    id: 'moonshot',
    label: '月之暗面 Moonshot',
    baseURL: 'https://api.moonshot.cn/v1',
    models: ['kimi-k2.5', 'kimi-k2.6', 'kimi-k3'],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    color: '#6466F1',
    contextWindow: 128_000,
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    baseURL: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-lightning', 'yi-medium', 'yi-large'],
    docsUrl: 'https://platform.lingyiwanwu.com',
    color: '#8B5CF6',
    contextWindow: 128_000,
  },
  {
    id: 'baichuan',
    label: '百川智能',
    baseURL: 'https://api.baichuan-ai.com/v1',
    models: ['Baichuan4', 'Baichuan3-Turbo'],
    docsUrl: 'https://platform.baichuan-ai.com',
    color: '#EC4899',
    contextWindow: 128_000,
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    models: ['MiniMax-M3'],
    docsUrl: 'https://platform.minimaxi.com',
    color: '#06B6D4',
    contextWindow: 128_000,
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805', 'claude-haiku-3-5-20241022'],
    docsUrl: 'https://console.anthropic.com/',
    color: '#D97706',
    contextWindow: 200_000,
  },
  {
    id: 'sensenova',
    label: '商汤 SenseNova (免费额度)',
    baseURL: 'https://token.sensenova.cn/v1',
    models: ['sensenova-6.7-flash-lite', 'sensenova-u1-fast', 'deepseek-v4-flash', 'glm-5.2'],
    docsUrl: 'https://token.sensenova.cn/',
    color: '#2563EB',
    contextWindow: 1_000_000,
  },
  {
    id: 'longcat',
    label: '美团 LongCat (免费额度)',
    baseURL: 'https://api.longcat.chat/openai',
    models: ['LongCat-2.0'],
    docsUrl: 'https://longcat.chat',
    color: '#FFD700',
    contextWindow: 1_000_000,
  },
  // NVIDIA NIM 已移除 (2026-07-25): 需自建 GPU Docker + 端点不稳定 + 中国大陆不可达
];

/** 获取商用模型模板 by id */
export function getCommercialTemplate(id: string): CommercialModelTemplate | undefined {
  return COMMERCIAL_MODEL_TEMPLATES.find(t => t.id === id);
}

/** 获取所有商用模型模板，按 label 排序 */
export function getAllCommercialTemplates(): CommercialModelTemplate[] {
  return [...COMMERCIAL_MODEL_TEMPLATES].sort((a, b) => a.label.localeCompare(b.label, 'zh'));
}
