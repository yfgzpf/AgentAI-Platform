import { create } from 'zustand';

interface AnalysisResult {
  isComplex: boolean;
  score: number;
  suggestedTier?: { label: string; apiProvider: string; model: string; strength: number };
  prompt?: string;
}

interface AutoModelState {
  enabled: boolean;
  currentModel: string;
  lastAnalysis: AnalysisResult | null;
  toggle: () => void;
  setAnalysis: (a: AnalysisResult) => void;
  reset: () => void;
}

export const MODEL_TIERS = [
  { label: 'Free (Agnes)', apiProvider: 'agentai', model: 'agnes-2.0-flash', strength: 3, keywords: [] },
  { label: 'DeepSeek Flash', apiProvider: 'deepseek', model: 'deepseek-v4-flash', strength: 4, keywords: ['review', 'analyze', 'refactor', 'implement'] },
  { label: 'DeepSeek Pro', apiProvider: 'deepseek', model: 'deepseek-v4-pro', strength: 8, keywords: ['architecture', 'security', 'optimization'] },
];

export function analyzeComplexity(text: string): AnalysisResult {
  const msg = text.toLowerCase();
  const length = msg.length;
  let score = 0;
  if (length > 100) score += 2;
  if (length > 500) score += 2;
  if (/debug|refactor|implement|重构|实现|开发/.test(msg)) score += 2;
  if (/架构|安全|并发|性能|architect|security|performance/.test(msg)) score += 3;
  if (msg.includes('```') || msg.includes('代码')) score += 1;
  if (/审查|分析|review|analyze|explain/.test(msg)) score += 1;

  const isComplex = score >= 4;
  const tier = score >= 7 ? MODEL_TIERS[2] : score >= 4 ? MODEL_TIERS[1] : MODEL_TIERS[0];

  return {
    isComplex,
    score,
    suggestedTier: isComplex ? tier : undefined,
    prompt: isComplex ? `检测到复杂问题（评分 ${score}），建议使用 ${tier.label}` : undefined,
  };
}

export const useAutoModelStore = create<AutoModelState>((set) => ({
  enabled: true,
  currentModel: 'agentai',
  lastAnalysis: null,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setAnalysis: (a) => set({ lastAnalysis: a }),
  reset: () => set({ currentModel: 'agentai', lastAnalysis: null }),
}));
