/**
 * Model Classifier — 任务复杂度 + 5 维评分路由
 * ----------------------------------------------------
 * 安全设计:
 *   1. 无 eval / no dynamic code - 所有评分是纯数学公式
 *   2. 无用户输入直接控制路由 - 分类结果不可被注入覆盖
 *   3. 成本上限是硬锁, 不是软阈值
 *   4. 所有正则匹配结果仅用于分类, 不用于执行
 *
 * 评分模型:
 *   score = w1*complexityMatch + w2*contextFit + w3*costScore + w4*successRate + w5*latencyScore
 *
 * @see docs/MIGRATION.md 第 3 节
 */

// ===== 复杂度级别 =====
export type ComplexityLevel = 'ultraSimple' | 'simple' | 'medium' | 'complex' | 'hard';

export interface ModelMeta {
  /** providerId:subModel (e.g. cline:deepseek-v4-flash) */
  id: string;
  /** 面向用户的名称 */
  label: string;
  /** Provider ID */
  provider: string;
  /** 子模型名 (传给 provider 的 model 参数) */
  subModel?: string;
  /** 适合的复杂度区间 */
  complexityRange: [ComplexityLevel, ComplexityLevel];
  /** 最大上下文 (token) */
  maxContext: number;
  /** 成本 / 1k tokens input */
  costPer1kInput: number;
  /** 成本 / 1k tokens output */
  costPer1kOutput: number;
  /** 是否免费 (用于 UI 标注) */
  isFree: boolean;
  /** 是否支持工具调用 */
  supportsTools: boolean;
  /** 是否支持图片输入 */
  supportsImages: boolean;
  /** 推荐优先级 (同 provider 内排序) */
  priority: number;
}

// ===== 安全: 路由结果不可被用户消息注入覆盖 =====
// `classify()` 的输出是纯计算, 消息内容只用于正则匹配, 不用于控制流

// ===== 已知模型注册表 =====
export const MODELS: ModelMeta[] = [
  // --- Cline 免费 (3 个, 零成本) ---
  {
    id: 'cline:deepseek-v4-flash',
    label: 'DS Flash (免费)',
    provider: 'cline',
    subModel: 'deepseek/deepseek-v4-flash',
    complexityRange: ['ultraSimple', 'medium'],
    maxContext: 64_000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    isFree: true,
    supportsTools: true,
    supportsImages: false,
    priority: 0,
  },
  {
    id: 'cline:minimax-m3',
    label: 'MiniMax M3 (免费)',
    provider: 'cline',
    subModel: 'minimax/minimax-m3',
    complexityRange: ['ultraSimple', 'simple'],
    maxContext: 128_000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    isFree: true,
    supportsTools: false,
    supportsImages: false,
    priority: 1,
  },
  {
    id: 'cline:xiaomi-mimo-v2.5',
    label: '小米 MiMo (免费)',
    provider: 'cline',
    subModel: 'xiaomi/mimo-v2.5',
    complexityRange: ['simple', 'complex'],
    maxContext: 1_000_000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    isFree: true,
    supportsTools: true,
    supportsImages: true,
    priority: 2,
  },

  // --- AgentAI (主模型, 免费+付费混合) ---
  {
    id: 'agentai:agnes-v4',
    label: 'Agnes AI',
    provider: 'agentai',
    subModel: undefined,
    complexityRange: ['simple', 'complex'],
    maxContext: 1_000_000,
    costPer1kInput: 0,
    costPer1kOutput: 0,
    isFree: true,
    supportsTools: true,
    supportsImages: true,
    priority: 3,
  },

  // --- DeepSeek (付费, 强力推理) ---
  {
    id: 'deepseek:v4-pro',
    label: 'DS Pro',
    provider: 'deepseek',
    subModel: 'deepseek-v4-pro',
    complexityRange: ['complex', 'hard'],
    maxContext: 1_000_000,
    costPer1kInput: 0.00014,
    costPer1kOutput: 0.00028,
    isFree: false,
    supportsTools: true,
    supportsImages: true,
    priority: 4,
  },

  // --- OpenAI (付费兜底) ---
  {
    id: 'openai:gpt-4o-mini',
    label: 'GPT-4o mini',
    provider: 'openai',
    subModel: 'gpt-4o-mini',
    complexityRange: ['medium', 'hard'],
    maxContext: 128_000,
    costPer1kInput: 0.0025,
    costPer1kOutput: 0.01,
    isFree: false,
    supportsTools: true,
    supportsImages: true,
    priority: 5,
  },
];

// ===== 复杂度权重 =====
const COMPLEXITY_WEIGHTS: Record<ComplexityLevel, number[]> = {
  ultraSimple: [1.0, 0.8, 0.4, 0.2, 0.0],
  simple:      [0.8, 1.0, 0.8, 0.4, 0.2],
  medium:      [0.4, 0.8, 1.0, 0.8, 0.4],
  complex:     [0.2, 0.4, 0.8, 1.0, 0.8],
  hard:        [0.0, 0.2, 0.4, 0.8, 1.0],
};
const LEVEL_ORDER: ComplexityLevel[] = ['ultraSimple', 'simple', 'medium', 'complex', 'hard'];

// ===== 任务复杂度分类器 (纯静态规则, 无状态) =====

/**
 * 分析消息文本, 输出复杂度级别
 * 安全设计:
 *   - 只读操作, 无副作用
 *   - 输入仅用于正则匹配, 结果不可被注入覆盖
 */
export function classifyComplexity(message: string, contextLength: number): ComplexityLevel {
  const msg = message.slice(0, 500); // 安全截断, 只用前 500 字

  // Hard: 1M 上下文 or 关键架构/安全词汇
  if (contextLength > 500_000) return 'hard';
  const hardKeywords = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock|分布式|微服务/i;
  if (hardKeywords.test(msg)) return 'hard';

  // Complex: 分析/审查/修改代码
  const complexKeywords = /分析|审查|重构|改|修|实现|implement|refactor|review|analyze|优化|优化|测试|debug/i;
  if (complexKeywords.test(msg) && msg.length > 50) return 'complex';

  // medium: 中等长度 + 代码相关
  const mediumKeywords = /代码|写|创建|生成|create|generate|函数|类|组件|page|路由配置/i;
  if (mediumKeywords.test(msg) || msg.length > 100) return 'medium';

  // simple: 短问题
  if (msg.length > 20) return 'simple';

  // ultraSimple: 闲聊/翻译/简单计算
  return 'ultraSimple';
}

/**
 * 预估上下文长度 (token 数, 粗略估计)
 */
export function estimateContextLength(messages: Array<{ content: string | any; role: string }>): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') total += part.text.length;
        else if (part.type === 'image_url') total += 1000; // 一张图 ≈ 1000 token
      }
    }
    // system prompt ≈ 200 token
    if (m.role === 'system') total += 200;
  }
  return Math.ceil(total * 1.3); // 中文字符: 1.3x
}

// ===== 5 维评分路由器 =====

export interface RoutingScore {
  model: ModelMeta;
  score: number;
  /** 各维度分解 (用于调试 / 前端展示) */
  breakdown: {
    complexityMatch: number;
    contextFit: number;
    costScore: number;
    successRate: number;
    latencyScore: number;
  };
}

export interface RoutingInput {
  messages: Array<{ content: string | any; role: string }>;
  message: string;
  providerStats: Map<string, ProviderStatsInput>;
  dailyCostUsed: number;
  dailyCostLimit: number;
  /** 用户强制指定 (从 Settings 传) */
  forceProvider?: string;
}

export interface ProviderStatsInput {
  totalCalls: number;
  successCount: number;
  failureCount: number;
  recentLatencyMs: number[];
  tripped: boolean;
}

// ===== 评分权重 =====
const W_COMPLEXITY = 0.30;
const W_CONTEXT   = 0.15;
const W_COST      = 0.20;
const W_SUCCESS   = 0.25;
const W_LATENCY   = 0.10;

/**
 * 路由主入口: 对已知模型排序
 * 安全护栏:
 *   1. `forceProvider` 绕过评分, 但受 cost guard 约束
 *   2. 免费模型不受 cost guard 影响
 *   3. 所有评分是纯数学公式, 不受消息内容直接控制
 */
export function routeByScore(input: RoutingInput): ModelMeta[] {
  const complexity = classifyComplexity(input.message, estimateContextLength(input.messages));
  const levelIdx = LEVEL_ORDER.indexOf(complexity);

  const scored: Array<{ model: ModelMeta; score: number }> = [];

  for (const model of MODELS) {
    // 跳过用户强制指定之外的模型
    if (input.forceProvider && model.provider !== input.forceProvider) continue;

    // 跳过熔断的 provider
    const stats = input.providerStats.get(model.provider);
    if (stats?.tripped) continue;

    // 跳过付费模型 (如果每日成本已超过上限)
    if (!model.isFree && input.dailyCostUsed >= input.dailyCostLimit) continue;

    const breakdown = computeScore(model, complexity, levelIdx, stats || null);
    const total = breakdown.complexityMatch + breakdown.contextFit + breakdown.costScore + breakdown.successRate + breakdown.latencyScore;

    scored.push({ model, score: total });
  }

  // 按分数降序
  scored.sort((a, b) => b.score - a.score);

  return scored.map(s => s.model);
}

/**
 * 计算某个模型的 5 维得分
 * 纯数学: 无分支判断, 无副作用, 无 I/O
 */
function computeScore(
  model: ModelMeta,
  complexity: ComplexityLevel,
  levelIdx: number,
  stats: ProviderStatsInput | null,
): RoutingScore['breakdown'] {
  const rangeFrom = LEVEL_ORDER.indexOf(model.complexityRange[0]);
  const rangeTo = LEVEL_ORDER.indexOf(model.complexityRange[1]);

  // 1. 复杂度匹配: 如果复杂度在模型擅长范围内, 得分高
  const inRange = levelIdx >= rangeFrom && levelIdx <= rangeTo;
  const complexityMatch = inRange ? 1.0 * W_COMPLEXITY : 0.3 * W_COMPLEXITY;

  // 2. 上下文适配: 模型上下文越大, 对长上下文场景得分越高
  // 标准化: max 1M token → score 1.0
  const contextFit = Math.min(model.maxContext / 1_000_000, 1.0) * W_CONTEXT;

  // 3. 成本分数: 免费的 1.0, 付费的按比例
  const avgCost = (model.costPer1kInput + model.costPer1kOutput) / 2;
  const costScore = model.isFree ? 1.0 * W_COST : (1.0 - Math.min(avgCost * 200, 1.0)) * W_COST;

  // 4. 历史成功率
  let successRate = 0.5 * W_SUCCESS; // 默认 0.5
  if (stats && stats.totalCalls > 0) {
    const rate = stats.successCount / stats.totalCalls;
    successRate = rate * W_SUCCESS;
  }

  // 5. 延迟分数
  let latencyScore = 0.5 * W_LATENCY; // 默认 0.5
  if (stats && stats.recentLatencyMs.length > 0) {
    const avgLat = stats.recentLatencyMs.reduce((a, b) => a + b, 0) / stats.recentLatencyMs.length;
    // 延迟越低分数越高: 200ms → 1.0, 2000ms → 0.5, 10000ms → 0.1
    latencyScore = (1.0 - Math.min(avgLat / 10_000, 0.9)) * W_LATENCY;
  }

  return { complexityMatch, contextFit, costScore, successRate, latencyScore };
}

// ===== 工具函数 =====

/**
 * 根据 model id 获取子模型名 (传给 provider)
 */
export function getSubModel(modelId: string): string | undefined {
  const m = MODELS.find(x => x.id === modelId);
  return m?.subModel;
}

/**
 * 获取模型中选, 按 provider 分组
 */
export function getModelsByProvider(): Map<string, ModelMeta[]> {
  const map = new Map<string, ModelMeta[]>();
  for (const m of MODELS) {
    const list = map.get(m.provider) || [];
    list.push(m);
    map.set(m.provider, list);
  }
  return map;
}

/**
 * 获取所有免费模型
 */
export function getFreeModels(): ModelMeta[] {
  return MODELS.filter(m => m.isFree);
}

/**
 * 是否为免费模型
 */
export function isFreeModel(modelId: string): boolean {
  const m = MODELS.find(x => x.id === modelId);
  return m?.isFree ?? false;
}

/**
 * 获取 Cline 下最推荐的模型 (按优先级排序)
 */
export function getBestFreeModel(forTools: boolean, forImages: boolean): string | undefined {
  const candidates = MODELS.filter(m => {
    if (m.isFree !== true) return false;
    if (forTools && !m.supportsTools) return false;
    if (forImages && !m.supportsImages) return false;
    return true;
  });
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0].id;
}
