/** 粗估 token 数 (中文 1.5 token/字, 英文 0.4 token/字) */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = text.length - cn;
  return Math.ceil(cn * 1.5 + en * 0.4);
}

export function estimateChatCost(text: string, cachedTokens: number = 0, provider: string = 'agentai'): { totalTokens: number; cachedTokens: number; cost: number; costFormatted: string } {
  const inputTokens = estimateTokens(text);
  const outputTokens = Math.ceil(inputTokens * 0.8);
  const totalTokens = inputTokens + outputTokens;

  const rates: Record<string, { input: number; output: number }> = {
    agentai: { input: 0.0001, output: 0.0003 },
    deepseek: { input: 0.00014, output: 0.00028 },
    openai: { input: 0.0025, output: 0.01 },
  };
  const rate = rates[provider] || rates.agentai;
  const cost = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;

  return {
    totalTokens,
    cachedTokens,
    cost,
    costFormatted: cost < 0.01 ? '<$0.01' : `$${cost.toFixed(4)}`,
  };
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${tokens}t`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}
