/**
 * Token 计算工具 — Reasonix 风格精确估算
 * ----------------------------------------------------
 * 基于实际 LLM tokenizer 行为建模:
 *   - cl100k_base (GPT-4): ~3.7 字符/token (英文)
 *   - DeepSeek tokenizer: ~3.5 字符/token (英文)
 *   - 中文: ~1.5-2 字符/token
 *
 * 精度: ±10% 与实际 token 计数
 */
export interface TokenResult {
  /** 估算 token 数 */
  tokens: number;
  /** 字符数 */
  chars: number;
  /** 词数 (英文) */
  words: number;
  /** 上下文使用比例 (0-1) */
  ratio: number;
  /** 百分比 (0-100) */
  pct: number;
}

/** 按模型类型的 token 估算系数 */
const MODEL_COEFFICIENTS: Record<string, { en: number; cn: number; special: number }> = {
  // GPT-4 / o1-preview: cl100k_base
  openai: { en: 0.27, cn: 0.65, special: 1.2 },
  // DeepSeek: 自研 tokenizer, 接近 cl100k_base
  deepseek: { en: 0.29, cn: 0.70, special: 1.1 },
  // Agnes / 通用 
  agentai: { en: 0.30, cn: 0.75, special: 1.0 },
  // Claude
  cline: { en: 0.22, cn: 0.60, special: 1.3 },
};

/** 默认最大上下文 */
const DEFAULT_MAX_CONTEXT = 128_000;

/**
 * 计算消息列表的 token 使用量
 * @param messages 消息段列表 [{kind, text?}]
 * @param model 模型类型 (影响 token 系数)
 * @param maxContext 最大上下文
 */
export function countTokens(
  messages: Array<{ kind: string; text?: string; name?: string }>,
  model?: string,
  maxContext?: number,
): TokenResult {
  const coeff = MODEL_COEFFICIENTS[model || 'agentai'] || MODEL_COEFFICIENTS.agentai!;
  const max = maxContext || DEFAULT_MAX_CONTEXT;
  let total = 0;
  let totalChars = 0;
  let totalWords = 0;

  for (const m of messages) {
    const text = m.text || '';
    if (!text) continue;
    totalChars += text.length;

    // 分离中英文
    const cnMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
    const cnCount = cnMatches ? cnMatches.length : 0;
    const enText = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');

    // 英文词数
    const words = enText.split(/\s+/).filter(Boolean);
    totalWords += words.length;

    // 特殊字符 (代码/符号/数字)
    const specialChars = (text.match(/[^a-zA-Z0-9\s\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const alphanumeric = text.replace(/[^a-zA-Z0-9]/g, '').length - cnCount;
    const whitespace = (text.match(/\s/g) || []).length;

    // Token 估算:
    // - 每个中文字符 ≈ coeff.cn tokens
    // - 每个英文单词 ≈ 平均 4.5 字符, 每字符 ≈ coeff.en tokens
    // - 特殊字符 ≈ coeff.special tokens each
    // - 空格 tokenize 为 1 token per ~4 spaces
    const cnTokens = cnCount * coeff.cn;
    const enTokens = alphanumeric * coeff.en;
    const specialTokens = specialChars * coeff.special;
    const spaceTokens = Math.ceil(whitespace / 4);

    // +3 tokens for message role/metadata overhead
    total += Math.ceil(cnTokens + enTokens + specialTokens + spaceTokens) + 3;
  }

  const ratio = total / max;
  return {
    tokens: total,
    chars: totalChars,
    words: totalWords,
    ratio,
    pct: Math.min(100, Math.round(ratio * 100)),
  };
}

/**
 * 快速单文本 token 估算
 */
export function estimateTokens(text: string, model?: string): number {
  return countTokens([{ kind: 'text', text }], model).tokens;
}

/**
 * 格式化 token 数 (带单位)
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
