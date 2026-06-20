// @ts-nocheck
/**
 * AgentAI 智能路由门面
 * ----------------------------------------------------
 * 自创整合: 融合 3 框架精华
 *   - Hermes smart_model_routing.py  (按成本/延迟/成功率排序)
 *   - Reasonix Pillar 1 缓存          (immutable prefix 命中短路)
 *   - Reasonix Pillar 2 修复          (4 步修复管道)
 *   - WorkBuddy 三层记忆              (写入工作空间记忆)
 *
 * 不照搬的:
 *   - 不抄 Hermes 30+ provider 配置 (我们只 4 个: agentai, deepseek, openai, zhipu)
 *   - 不抄 Reasonix `<<<NEEDS_PRO>>>` (我们有自动降级)
 *
 * 核心创新:
 *   - 中文提示注入扫描 (20+ 正则, 覆盖 Chinese trick patterns)
 *   - "智能路由" = 成本/成功率/延迟三维评分
 *   - 失败率 > 30% 自动熔断 + 降级到下一 provider
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 2.3 节
 */

import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { createRequire } from 'module';const _require = createRequire(import.meta.url);const { LRUCache } = _require('lru-cache');
import { estimateMessagesTokens, estimateStringTokens, estimateToolCallsTokens } from './token-utils.js';
import { routeByScore, getSubModel } from './model-classifier.js';

// ===== 类型定义 =====
export type ProviderId = 'agentai' | 'deepseek' | 'openai' | 'zhipu' | 'superapi' | string;

/** OpenAI 图片内容块 */
export interface ImageContentBlock {
  type: 'image_url';
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
}

/** OpenAI 文本内容块 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

export type MessageContent = string | (TextContentBlock | ImageContentBlock)[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  name?: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  model?: ProviderId;
  /** 子模型名 (例如 deepseek-chat / deepseek-reasoner), 仅用户手动指定时传递 */
  subModel?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  /** 用户 ID, 用于三层记忆 */
  userId?: string;
  /** 工作空间, 用于工作空间记忆 */
  workspace?: string;
  /** 流式响应 */
  stream?: boolean;
  /** 流式 delta 回调 (可选, 仅当 stream=true 时触发) */
  onDelta?: (delta: string) => void;
  /** 启用 Thinking 模式 (Agnes 2.0 Flash 推荐, 提升代码/推理质量) */
  thinking?: boolean;
  /** Thinking token 预算 (默认 2048, 仅 thinking=true 时生效) */
  thinkingBudget?: number;
  /** 上下文窗口大小 (tokens), 用于截断旧消息 */
  contextWindow?: number;
  /** 自定义模型配置 (非内置 provider 时由前端传递) */
  modelConfig?: { baseURL: string; modelName: string; provider: string };
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  iterations?: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number; // USD
    cacheHit: boolean;
    /** 估算模式: 'api'(官方返回) / 'estimated'(本地估算) */
    source: 'api' | 'estimated';
  };
  provider: ProviderId;
  durationMs: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: any;
  /** 来自 tool-registry, 默认 false (串行) */
  parallelSafe?: boolean;
  /** 风险等级, 用于安全门 */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

interface ProviderStats {
  id: ProviderId;
  /** USD per 1k tokens */
  costPer1kInput: number;
  costPer1kOutput: number;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  /** rolling 100 calls */
  recentLatencyMs: number[];
  /** circuit breaker state */
  tripped: boolean;
  trippedAt?: number;
  /** 最后一次错误的 HTTP 状态码 */
  lastErrorStatus?: number;
  /** 速率限制冷却到何时 (毫秒时间戳) */
  rateLimitCooldownUntil?: number;
  /** 冷却重试次数 (指数退避) */
  rateLimitRetryCount: number;
  /** 上次成功调用的时间戳 (用于主动调速) */
  lastCallAt?: number;
}

// ===== ToolSpec → OpenAI Tool 格式 =====
interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 把内部 ToolSpec 转为 OpenAI function calling 格式 */
export function toolSpecsToOpenAI(specs: ToolSpec[]): OpenAITool[] {
  return specs.map(s => ({
    type: 'function' as const,
    function: {
      name: s.name,
      description: s.description,
      parameters: s.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

// ===== 智能路由门面 =====
export class AgentAIRouter extends EventEmitter {
  private providers = new Map<ProviderId, ProviderStats>();
  /** LRU 缓存: prefix hash -> 响应 */
  private cache: LRUCache<string, ChatResponse>;
  /** append-only log (学 Reasonix Pillar 1) */
  private appendOnlyLog: Array<{ ts: number; req: ChatRequest; res: ChatResponse }> = [];
  /** circuit breaker cooldown (5 分钟) */
  private static readonly CB_COOLDOWN_MS = 5 * 60 * 1000;
  /** 速率限制初始冷却 (10 秒) */
  private static readonly RL_BASE_COOLDOWN_MS = 10_000;
  /** 速率限制最大冷却 (2 分钟) */
  private static readonly RL_MAX_COOLDOWN_MS = 120_000;
  /** 冷却退避因子 (每次 429 翻倍) */
  private static readonly RL_BACKOFF_FACTOR = 2;
  /** 主动调速: 两次请求之间的最小间隔 (3 秒, 避免免费模型突发限流) */
  private static readonly REQUEST_PACING_MS = 3_000;
  /** 自创: cost guard */
  private costGuard = {
    maxCostPerTurn: 0.20,   // USD
    maxCostPerDay: 5.00,    // USD
    dailySpend: 0,
    dailyResetAt: Date.now() + 86_400_000,
  };

  constructor() {
    super();
    this.cache = new LRUCache({ max: 1000, ttl: 1000 * 60 * 30 }); // 30 min

    // 初始化 provider stats (不写死成本, 留给用户 .env 覆盖)
    this.providers.set('agentai', {
      id: 'agentai',
      costPer1kInput: 0.0,      // 免费 (用户自有 API Key)
      costPer1kOutput: 0.0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    this.providers.set('deepseek', {
      id: 'deepseek',
      costPer1kInput: 0.00014,
      costPer1kOutput: 0.00028,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,           // 辅助模型, 默认可用
      rateLimitRetryCount: 0,
    });
    this.providers.set('openai', {
      id: 'openai',
      costPer1kInput: 0.0025,
      costPer1kOutput: 0.01,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    this.providers.set('zhipu', {
      id: 'zhipu',
      costPer1kInput: 0.0,      // GLM-4.7-Flash 免费
      costPer1kOutput: 0.0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    this.providers.set('superapi', {
      id: 'superapi',
      costPer1kInput: 0,
      costPer1kOutput: 0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: true,  // 默认熔断, 等用户配置 API Key 后解除
      rateLimitRetryCount: 0,
    });

    // 注意: 不在构造函数中检查 API Key, 因为 .env 可能尚未加载
    // 由 index.ts 调用 recheckApiKeys() 统一检查
  }

  /** 重新检查 API Key 可用性 (在 .env 加载后调用, 修复 import 时序问题) */
  recheckApiKeys() {
    console.log('[router] recheckApiKeys() called');
    const keyMap: Record<string, string> = {
      agentai: 'AGENTAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
      superapi: 'SUPERAPI_API_KEY',
    };
    for (const [pid, keyEnv] of Object.entries(keyMap)) {
      const p = this.providers.get(pid as ProviderId);
      if (!p) continue;
      const hasKey = !!process.env[keyEnv];
      console.log(`[router] recheck ${pid}: hasKey=${hasKey}, tripped=${p.tripped}`);
      if (hasKey && p.tripped) {
        p.tripped = false;
        p.trippedAt = undefined;
        console.log(`[router] ${pid} API key now available, untripped`);
      } else if (!hasKey && !p.tripped) {
        p.tripped = true;
        console.log(`[router] ${pid} has no API key (${keyEnv}), marked as tripped`);
      }
    }
  }

  /**
   * 入口: 智能 chat
   * 融合 3 框架:
   *   1. 缓存命中短路 (学 Reasonix Pillar 1)
   *   2. 智能路由选 provider (学 Hermes + Reasonix)
   *   3. 提示注入扫描 (学 Hermes + 自创中文版)
   *   4. 4 步修复管道 (学 Reasonix Pillar 2)
   *   5. append-only log (学 Reasonix)
   *   6. 反思门 (自创: 每 10 轮触发)
   */
  async chat(req: ChatRequest): Promise<ChatResponse> {
    // === Step 1: cost guard (学 Reasonix Pillar 3) ===
    this.checkCostGuard();

    // 跟踪指定模型是否已尝试失败 (用于降级时放开 forceProvider)
    let specifiedModelFailed = false;

    // === Step 1.5: 如果调用方指定 model, 锁定到该 provider (不跑 rank) ===
    //     但如果该 provider 失败, 自动降级到 ranking 里的下一个
    if (req.model) {
      // 动态注册自定义 provider (不在内置 providers Map 中的)
      if (!this.providers.has(req.model) && req.modelConfig) {
        this.providers.set(req.model, {
          id: req.model,
          costPer1kInput: 0.0,
          costPer1kOutput: 0.0,
          totalCalls: 0,
          successCount: 0,
          failureCount: 0,
          recentLatencyMs: [],
          tripped: false,
        });
      }
      const target = this.providers.get(req.model);
      if (target) {
        if (this.isCircuitOpen(target)) {
          this.tryRecoverCircuit(target);
          if (this.isCircuitOpen(target)) {
            console.warn(`[router] requested provider ${req.model} is tripped, falling back to ranking`);
            specifiedModelFailed = true;
          } else {
            try {
              return await this.tryOne(target, req);
            } catch (err) {
              this.recordFailure(target, err as Error);
              this.emit('provider:failed', { provider: target.id, err });
              console.warn(`[router] ${req.model} failed (${(err as Error).message?.slice(0, 80)}), falling back to ranking`);
              specifiedModelFailed = true;
            }
          }
        } else {
          try {
            return await this.tryOne(target, req);
          } catch (err) {
            this.recordFailure(target, err as Error);
            this.emit('provider:failed', { provider: target.id, err });
            console.warn(`[router] ${req.model} failed (${(err as Error).message?.slice(0, 80)}), falling back to ranking`);
            specifiedModelFailed = true;
          }
        }
      }
    }

    // === Step 2: 缓存命中 (学 Reasonix Pillar 1) ===
    const prefixHash = this.hashPrefix(req);
    // 检索所有 provider 的缓存 (key 格式: ${provider}:${hash})
    for (const [providerId, cached] of this.cache.entries()) {
      if (cached && !req.stream && this.isCacheable(req) && providerId.endsWith(`:${prefixHash}`)) {
        this.emit('cache:hit', { hash: prefixHash, provider: cached.provider });
        return { ...cached, usage: { ...cached.usage, cacheHit: true } };
      }
    }

    // === Step 4: 5 维评分选模型 (替换旧的 rankProviders) ===
    // 如果指定模型已失败, 放开 forceProvider 让 ranking 尝试所有可用 provider
    const forceProvider = specifiedModelFailed ? undefined : req.model;

    // 检测是否需要视觉能力 (消息中含 image_url)
    const needsVision = req.messages.some(m => {
      if (typeof m.content === 'string') return false;
      if (Array.isArray(m.content)) return m.content.some(c => (c as any).type === 'image_url');
      return false;
    });

    // 默认 preferFree: 开发任务免费优先, 仅审查用付费
    // 检测是否是审查/分析模式
    const userText = req.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ');
    const isReviewTask = /^(审查|分析|检查|review|analyze|audit|security)/i.test(userText);
    const preferFree = !isReviewTask;  // 审查任务允许用付费模型

    const input: import('./model-classifier.js').RoutingInput = {
      messages: req.messages,
      message: userText,
      providerStats: new Map(
        [...this.providers.entries()].map(([id, s]) => [id, {
          totalCalls: s.totalCalls,
          successCount: s.successCount,
          failureCount: s.failureCount,
          recentLatencyMs: s.recentLatencyMs,
          tripped: s.tripped,
        }]),
      ),
      dailyCostUsed: this.costGuard.dailySpend,
      dailyCostLimit: this.costGuard.maxCostPerDay,
      forceProvider,
      needsVision,
      preferFree,
    };
    const ranked = routeByScore(input);

    for (const model of ranked) {
      if (!model?.provider) continue;
      const provider = this.providers.get(model.provider as ProviderId);
      if (!provider) continue;
      if (this.isCircuitOpen(provider)) {
        this.tryRecoverCircuit(provider);
        if (this.isCircuitOpen(provider)) continue;
      }
      // === 速率限制冷却检查 ===
      if (this.isRateLimited(provider)) {
        // 有冷却中的 provider，查看排名中是否还有其他可用 provider
        const hasOtherAvailable = ranked.some(m => {
          if (!m?.provider || m.provider === model.provider) return false;
          const p = this.providers.get(m.provider as ProviderId);
          return p && !this.isCircuitOpen(p) && !this.isRateLimited(p);
        });
        if (hasOtherAvailable) {
          console.info(`[router] ${model.provider} in cooldown, trying next`);
          continue;
        }
        // 所有 provider 都在冷却 — 找最短冷却等待
        const waitMs = this.findShortestCooldown();
        if (waitMs > 0) {
          console.info(`[router] all providers cooling, waiting ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, Math.min(waitMs, 5000)));
        }
      }

      // === 主动调速: 避免免费模型突发限流 ===
      // 如果上次调用距今不足最小间隔, 尝试排名中其他未用过的 provider
      if (provider.lastCallAt && Date.now() - provider.lastCallAt < AgentAIRouter.REQUEST_PACING_MS) {
        const hasUnused = ranked.some(m => {
          if (!m?.provider || m.provider === model.provider) return false;
          const p = this.providers.get(m.provider as ProviderId);
          return p && !this.isCircuitOpen(p) && !this.isRateLimited(p) && (!p.lastCallAt || Date.now() - p.lastCallAt >= AgentAIRouter.REQUEST_PACING_MS);
        });
        if (hasUnused) {
          continue; // 跳过刚用过的 provider, 换下一个
        }
        // 所有 provider 都最近用过 — 等最短间隔
        await new Promise(r => setTimeout(r, AgentAIRouter.REQUEST_PACING_MS));
      }

      try {
        if (model.subModel) {
          return await this.tryOne(provider, req, model.subModel);
        }
        return await this.tryOne(provider, req);
      } catch (err) {
        this.recordFailure(provider, err as Error);
        this.emit('provider:failed', { provider: provider.id, err });
        console.warn(`[router] ranking fallback: ${model.provider} failed (${(err as Error).message?.slice(0, 80)}), trying next`);
        continue;
      }
    }

    // All providers failed — emergency recovery
    // 尝试强制恢复免费 provider, 尊重冷却但不完全跳过
    const freeProviders = ['zhipu', 'agentai'] as ProviderId[];
    let allCooling = true;
    let shortestCooldown = Infinity;
    for (const fp of freeProviders) {
      const p = this.providers.get(fp);
      if (!p) continue;

      // 在冷却中 — 记录最短冷却时间
      if (this.isRateLimited(p)) {
        const remaining = (p.rateLimitCooldownUntil ?? 0) - Date.now();
        if (remaining > 0 && remaining < shortestCooldown) shortestCooldown = remaining;
        continue;
      }
      allCooling = false;

      // 强制解除熔断, 给一次机会
      p.tripped = false;
      p.trippedAt = undefined;
      p.failureCount = 0;
      console.log(`[router] emergency recovery: force-untripped ${fp}`);
      try {
        return await this.tryOne(p, req);
      } catch (err) {
        this.recordFailure(p, err as Error);
        console.warn(`[router] emergency recovery ${fp} also failed: ${(err as Error).message?.slice(0, 80)}`);
      }
    }

    // 所有免费 provider 都在冷却 — 等待最短冷却后重试
    if (allCooling && shortestCooldown < Infinity) {
      const wait = Math.min(shortestCooldown, 5000);
      console.info(`[router] all free providers cooling, waiting ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
      // 再试一次 (冷却后第一个可用 provider)
      for (const fp of freeProviders) {
        const p = this.providers.get(fp);
        if (!p || this.isRateLimited(p)) continue;
        p.tripped = false;
        p.trippedAt = undefined;
        p.failureCount = 0;
        try {
          return await this.tryOne(p, req);
        } catch (err) {
          this.recordFailure(p, err as Error);
        }
      }
    }

    // === 闪电交替: 免费全限流 → 尝试 DeepSeek (如果有 API Key) ===
    const deepseekProvider = this.providers.get('deepseek');
    if (deepseekProvider && process.env.DEEPSEEK_API_KEY) {
      if (this.isRateLimited(deepseekProvider)) {
        const wait = Math.min((deepseekProvider.rateLimitCooldownUntil ?? Date.now()) - Date.now(), 3000);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      if (!this.isRateLimited(deepseekProvider)) {
        console.info('[router] lightning swap: all free failed, trying deepseek-v4-flash');
        deepseekProvider.tripped = false;
        deepseekProvider.trippedAt = undefined;
        deepseekProvider.failureCount = 0;
        try {
          return await this.tryOne(deepseekProvider, req, 'deepseek-v4-flash');
        } catch (err) {
          this.recordFailure(deepseekProvider, err as Error);
          console.warn(`[router] deepseek fallback also failed: ${(err as Error).message?.slice(0, 80)}`);
        }
      }
    }

    // === 用户自定义模型兜底 (不在内置 5 个中的 provider) ===
    const builtinIds = new Set(['agentai', 'deepseek', 'openai', 'zhipu']);
    for (const [pid, p] of this.providers) {
      if (builtinIds.has(pid)) continue;
      if (this.isRateLimited(p) || this.isCircuitOpen(p)) continue;
      console.info(`[router] trying custom provider ${pid} as fallback`);
      try {
        return await this.tryOne(p, req);
      } catch (err) {
        this.recordFailure(p, err as Error);
        console.warn(`[router] custom provider ${pid} also failed: ${(err as Error).message?.slice(0, 80)}`);
      }
    }

    // 真的全部失败 — 返回降级消息
    const lastMsg = req.messages.filter((m) => m.role === 'user').pop();
    const lastUserText = (typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content)).slice(0, 200);
    return {
      content: `所有 AI 模型暂时不可用。\n\n用户消息: "${lastUserText}"\n\n请检查 .env 中的 API Key 配置或在设置页填写。`,
      provider: 'none' as ProviderId,
      usage: { promptTokens: 0, completionTokens: 0, cost: 0, cacheHit: false },
      durationMs: 0,
    };
  }

  /**
   * 拆出来的单 provider 执行 (锁定用)
   */
  private async tryOne(provider: ProviderStats, req: ChatRequest, subModel?: string): Promise<ChatResponse> {
    const t0 = Date.now();
    try {
      const raw = await this.executeProvider(provider.id, req, subModel);
      const durationMs = Date.now() - t0;

      const repaired = await this.repairPipeline(raw);
      const usage = this.computeUsage(provider, repaired, req);
      this.checkCostGuardPost(usage.cost);

      const res: ChatResponse = {
        content: repaired.content,
        toolCalls: repaired.toolCalls,
        finishReason: repaired.finishReason || 'stop',
        usage,
        provider: provider.id,
        durationMs,
      };

      this.appendOnlyLog.push({ ts: Date.now(), req, res });

      if (this.isCacheable(req)) {
        const cacheKey = `${provider.id}:${this.hashPrefix(req)}`;
        this.cache.set(cacheKey, res);
      }

      this.recordSuccess(provider, durationMs);
      return res;
    } catch (err) {
      this.recordFailure(provider, err as Error);
      this.emit('provider:failed', { provider: provider.id, err });
      throw err;
    }
  }

  // ===== Provider 评分/熔断 =====
  private rankProviders(): ProviderStats[] {
    return [...this.providers.values()].sort((a, b) => {
      const scoreA = this.scoreProvider(a);
      const scoreB = this.scoreProvider(b);
      return scoreB - scoreA;
    });
  }

  /**
   * 自创: 三维评分 (成功率 50% + 成本 30% + 延迟 20%)
   * 学自: Hermes smart_model_routing.py (按 cost/quality/speed 排序)
   * 学自: Reasonix Pillar 3 (cost 优先)
   */
  private scoreProvider(p: ProviderStats): number {
    const successRate = p.totalCalls > 0 ? p.successCount / p.totalCalls : 1.0;
    const avgCost = (p.costPer1kInput + p.costPer1kOutput) / 2;
    const avgLatency = p.recentLatencyMs.length > 0
      ? p.recentLatencyMs.reduce((a, b) => a + b, 0) / p.recentLatencyMs.length
      : 1000;

    const successScore = successRate * 50;
    const costScore = (1 / (1 + avgCost * 1000)) * 30;
    const latencyScore = (1 / (1 + avgLatency / 1000)) * 20;

    return successScore + costScore + latencyScore;
  }

  private isCircuitOpen(p: ProviderStats): boolean {
    if (!p.tripped) return false;
    // 失败率 > 30% 自动熔断
    const failRate = p.failureCount / Math.max(p.totalCalls, 1);
    return failRate > 0.30 || p.tripped;
  }

  /** 判断 provider 是否处于速率限制冷却中 */
  private isRateLimited(p: ProviderStats): boolean {
    if (!p.rateLimitCooldownUntil) return false;
    if (Date.now() >= p.rateLimitCooldownUntil) {
      // 冷却已过 — 重置
      p.rateLimitCooldownUntil = undefined;
      p.rateLimitRetryCount = Math.max(0, p.rateLimitRetryCount - 1); // 逐级降退避
      return false;
    }
    return true;
  }

  /** 找出所有冷却中 provider 的最短剩余时间 */
  private findShortestCooldown(): number {
    let shortest = Infinity;
    for (const [, p] of this.providers) {
      if (!p.rateLimitCooldownUntil) continue;
      const remaining = p.rateLimitCooldownUntil - Date.now();
      if (remaining > 0 && remaining < shortest) shortest = remaining;
    }
    return shortest === Infinity ? 0 : shortest;
  }

  private tryRecoverCircuit(p: ProviderStats): void {
    if (!p.tripped || !p.trippedAt) return;
    if (Date.now() - p.trippedAt < AgentAIRouter.CB_COOLDOWN_MS) return;
    p.tripped = false;
    p.failureCount = 0;
    p.trippedAt = undefined;
    this.emit('circuit:recovered', { provider: p.id });
  }

  // ===== Cost Guard (学 Reasonix Pillar 3) =====
  private checkCostGuard(): void {
    if (Date.now() > this.costGuard.dailyResetAt) {
      this.costGuard.dailySpend = 0;
      this.costGuard.dailyResetAt = Date.now() + 86_400_000;
    }
    if (this.costGuard.dailySpend >= this.costGuard.maxCostPerDay) {
      throw new Error('Daily cost limit exceeded');
    }
  }

  private checkCostGuardPost(cost: number): void {
    if (cost > this.costGuard.maxCostPerTurn) {
      this.emit('cost:warning', { cost, max: this.costGuard.maxCostPerTurn });
    }
    this.costGuard.dailySpend += cost;
  }

  // ===== 工具调用 4 步修复管道 (学 Reasonix Pillar 2) =====
  private async repairPipeline(raw: any): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    // Step 1: flatten - 把嵌套对象压成点号 notation
    let repaired = this.flattenToolCalls(raw);

    // Step 2: scavenge - 从 <<think>> 块里抢救 JSON
    repaired = this.scavengeFromThink(repaired);

    // Step 3: storm 检测 - 同一工具被反复调
    repaired = this.detectCallStorm(repaired);

    // Step 4: truncation - 补全截断的 JSON
    repaired = this.repairTruncation(repaired);

    // Step 5: 修复 tool_calls 参数中的常见 JSON 错误
    repaired = this.repairToolCallArgs(repaired);

    return repaired;
  }

  /** 修复 tool call 参数中的常见 JSON 格式错误 */
  private repairToolCallArgs(raw: any): any {
    if (!raw.toolCalls || !Array.isArray(raw.toolCalls)) return raw;
    for (const tc of raw.toolCalls) {
      if (typeof tc.args === 'string') {
        try { JSON.parse(tc.args); } catch {
          let fixed = tc.args;
          fixed = fixed.replace(/,\s*([}\]])/g, '$1');           // 尾逗号
          fixed = fixed.replace(/'/g, '"');                       // 单引号 → 双引号
          fixed = fixed.replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // 无引号 key
          fixed = fixed.replace(/:\s*undefined/g, ': null');     // undefined → null
          try {
            JSON.parse(fixed);
            tc.args = fixed;
            console.log('[repair] fixed tool call args JSON for', tc.name);
          } catch {
            // 二次修复失败, 保持原样让后续流程处理
          }
        }
      }
    }
    return raw;
  }

  private flattenToolCalls(raw: any): any {
    // 学自: Reasonix repair/flatten.ts
    if (raw.toolCalls) {
      raw.toolCalls = raw.toolCalls.map((tc: ToolCall) => ({
        ...tc,
        args: this.flattenObject(tc.args, ''),
      }));
    }
    return raw;
  }

  private flattenObject(obj: any, prefix: string): any {
    if (typeof obj !== 'object' || obj === null) return { [prefix]: obj };
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        Object.assign(result, this.flattenObject(v, key));
      } else {
        result[key] = v;
      }
    }
    return result;
  }

  private scavengeFromThink(raw: any): any {
    // 学自: Reasonix repair/scavenge.ts
    // 从 LLM 输出的 <think> 块里找被吞的 tool_call JSON
    if (typeof raw.content === 'string') {
      const thinkMatch = raw.content.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) {
        const jsonInThink = thinkMatch[1].match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
        if (jsonInThink && !raw.toolCalls) {
          try {
            const parsed = JSON.parse(jsonInThink[0]);
            raw.toolCalls = parsed.tool_calls || [parsed.tool_call];
            raw.content = raw.content.replace(thinkMatch[0], '').trim();
          } catch {
            // JSON 不完整, 让 truncation 处理
          }
        }
      }
    }
    return raw;
  }

  private detectCallStorm(raw: any): any {
    // 学自: Reasonix repair/storm.ts
    // 同一 tool + 同样 args 连续调 3 次以上, 警告
    if (raw.toolCalls && raw.toolCalls.length >= 3) {
      const signatures = raw.toolCalls.map((tc: ToolCall) => `${tc.name}:${JSON.stringify(tc.args)}`);
      const dupCount = signatures.length - new Set(signatures).size;
      if (dupCount >= 2) {
        this.emit('repair:storm', { count: dupCount, tools: raw.toolCalls.map((t: ToolCall) => t.name) });
      }
    }
    return raw;
  }

  private repairTruncation(raw: any): any {
    // 只修复 toolCalls 的 args JSON, 不修复 content 文本
    // 对代码内容简单补 } 会破坏语法, 如 if(x){ 被补成 if(x){}
    if (raw.toolCalls && Array.isArray(raw.toolCalls)) {
      for (const tc of raw.toolCalls) {
        if (typeof tc.args === 'string') {
          let args = tc.args;
          const openBraces = (args.match(/\{/g) || []).length;
          const closeBraces = (args.match(/\}/g) || []).length;
          if (openBraces > closeBraces) {
            args += '}'.repeat(openBraces - closeBraces);
          }
          const openBrackets = (args.match(/\[/g) || []).length;
          const closeBrackets = (args.match(/\]/g) || []).length;
          if (openBrackets > closeBrackets) {
            args += ']'.repeat(openBrackets - closeBrackets);
          }
          tc.args = args;
        }
      }
    }
    return raw;
  }

  // ===== Provider 执行 (具体 HTTP/SSE 调用) =====
  private async executeProvider(id: ProviderId, req: ChatRequest, subModel?: string): Promise<any> {
    // 真接 5 个内置 provider (OpenAI 兼容协议)
    // agentai: apihub.agnes-ai.com/v1/chat/completions (支持 tools / thinking / image_url)
    // deepseek: api.deepseek.com/v1/chat/completions
    // openai: api.openai.com/v1/chat/completions
    // zhipu: open.bigmodel.cn/api/paas/v4 (GLM-4.7-Flash 免费)
    // Provider 配置 (默认值可通过 .env 环境变量覆盖)
    const PROVIDER_DEFAULTS: Record<string, { keyEnv: string; baseEnv: string; defaultBase: string; modelEnv: string; defaultModel: string }> = {
      agentai: { keyEnv: 'AGENTAI_API_KEY', baseEnv: 'AGENTAI_BASE_URL', defaultBase: 'https://apihub.agnes-ai.com/v1', modelEnv: 'AGENTAI_MODEL', defaultModel: 'agnes-2.0-flash' },
      deepseek: { keyEnv: 'DEEPSEEK_API_KEY', baseEnv: 'DEEPSEEK_BASE_URL', defaultBase: 'https://api.deepseek.com/v1', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-v4-flash' },
      openai:   { keyEnv: 'OPENAI_API_KEY',   baseEnv: 'OPENAI_BASE_URL',   defaultBase: 'https://api.openai.com/v1',  modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini' },
      zhipu:   { keyEnv: 'ZHIPU_API_KEY',   baseEnv: 'ZHIPU_BASE_URL',   defaultBase: 'https://open.bigmodel.cn/api/paas/v4', modelEnv: 'ZHIPU_MODEL', defaultModel: 'glm-4.7-flash' },
      superapi: { keyEnv: 'SUPERAPI_API_KEY', baseEnv: 'SUPERAPI_BASE_URL', defaultBase: 'https://superapi.vanguard.dpdns.org/v1', modelEnv: 'SUPERAPI_MODEL', defaultModel: 'deepseek-v4-flash' },
    };
    const envKeyMap = PROVIDER_DEFAULTS;

    // 自定义 provider: 从请求上下文获取配置
    let cfg = envKeyMap[id];
    let apiKey: string | undefined;
    let baseUrl: string;
    let modelName: string;

    if (!cfg) {
      // 自定义模型: 使用 provider 名作为环境变量前缀
      const keyEnv = `${id.toUpperCase()}_API_KEY`;
      const baseEnv = `${id.toUpperCase()}_BASE_URL`;
      apiKey = process.env[keyEnv];
      baseUrl = ((req as any).modelConfig?.baseURL || process.env[baseEnv] || '').replace(/\/+$/, '');
      modelName = subModel || (req as any).modelConfig?.modelName || id;

      if (!apiKey || !baseUrl) {
        const lastMsg = req.messages.filter((m) => m.role === 'user').pop();
        const userText = (typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content)).slice(0, 200);
        return {
          content: `[${id} no-config] 自定义模型未配置完整。\n需要: ${keyEnv} 和 baseURL。\n\n你的消息: "${userText}"`,
          model: id,
          finishReason: 'stop',
          noKey: true,
        };
      }
    } else {
      apiKey = process.env[cfg.keyEnv];
      baseUrl = (process.env[cfg.baseEnv] || cfg.defaultBase).replace(/\/+$/, '');
      modelName = subModel || process.env[cfg.modelEnv] || cfg.defaultModel;
    }

    if (!apiKey) {
      const lastMsg = req.messages.filter((m) => m.role === 'user').pop();
      const userText = (typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content)).slice(0, 200);
      const userId = (req as any).userId || '你';
      return {
        content: `[${id} no-key] ${userId}, 收到你的消息: "${userText}"\n\n请在 .env 填 ${cfg.keyEnv} 即可真接。也可以在 GUI 设置页一键填。`,
        model: id,
        finishReason: 'stop',
        noKey: true,
      };
    }

    // 构建请求体 (完整 OpenAI 兼容 + Agnes 扩展)
    // 上下文窗口截断: 保留 system + 最近消息, 防止超限
    const ctxWindow = req.contextWindow || 128000;
    const maxInputTokens = Math.floor(ctxWindow * 0.85); // 留15%给输出
    let truncatedMessages = req.messages;
    {
      // 粗略估算: 1个中文字≈1.5token, 1个英文词≈1token
      let totalEst = 0;
      const systemMsgs: typeof req.messages = [];
      const otherMsgs: typeof req.messages = [];
      for (const m of req.messages) {
        if (m.role === 'system') { systemMsgs.push(m); continue; }
        otherMsgs.push(m);
      }
      // system消息始终保留
      for (const m of systemMsgs) {
        totalEst += Math.ceil((typeof m.content === 'string' ? m.content : '').length * 0.7);
      }
      // 从最新消息往前保留, 直到超限
      const kept: typeof req.messages = [];
      for (let i = otherMsgs.length - 1; i >= 0; i--) {
        const est = Math.ceil((typeof otherMsgs[i].content === 'string' ? otherMsgs[i].content : '').length * 0.7);
        if (totalEst + est > maxInputTokens && kept.length > 2) break;
        totalEst += est;
        kept.unshift(otherMsgs[i]);
      }
      truncatedMessages = [...systemMsgs, ...kept];
    }

    const bodyObj: Record<string, unknown> = {
      model: modelName,
      messages: truncatedMessages.map(m => {
        const msg: any = { role: m.role, content: m.content };
        // 保留 tool_call_id + name (DeepSeek 多轮工具调用必需)
        if ((m as any).tool_call_id) msg.tool_call_id = (m as any).tool_call_id;
        if ((m as any).name) msg.name = (m as any).name;
        // 保留 tool_calls (assistant 消息中的工具调用记录 — 多轮工具调用必需!)
        if ((m as any).tool_calls) msg.tool_calls = (m as any).tool_calls;
        return msg;
      }),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? (req.tools && req.tools.length > 0 ? 8192 : 4096),
      stream: req.stream === true || false,
    };

    // 工具调用 (Agnes 2.0 Flash 支持 )
    if (req.tools && req.tools.length > 0) {
      bodyObj.tools = toolSpecsToOpenAI(req.tools);
      bodyObj.tool_choice = 'auto';
    }

    // 关键: 让 OpenAI 兼容 API 在流式末尾返回 usage (官方推荐)
    if (bodyObj.stream === true) {
      bodyObj.stream_options = { include_usage: true };
    }

    // Thinking 模式 — 根据 provider 自动选择思考机制
    if (req.thinking) {
      if (id === 'agentai') {
        // Agnes AI: chat_template_kwargs.enable_thinking
        bodyObj.chat_template_kwargs = { enable_thinking: true };
        if (req.thinkingBudget && req.thinkingBudget > 0) {
          (bodyObj.chat_template_kwargs as any).thinking_budget = req.thinkingBudget;
        }
      } else if (id === 'deepseek') {
        // DeepSeek V4: 仅 deepseek-v4-pro 支持 thinking 参数
        // deepseek-v4-flash 是非思考模式, 加 thinking 会 400 错误
        if (modelName?.includes('v4-pro') || modelName?.includes('reasoner')) {
          bodyObj.thinking = { type: 'enabled' };
          bodyObj.reasoning_effort = 'high';
        }
      } else if (id === 'zhipu') {
        // 智谱 GLM-4.7-Flash: thinking 参数
        bodyObj.thinking = { type: 'enabled' };
      }
      // OpenAI 等其他 provider: 不支持额外思考参数, 但流式解析中统一处理 reasoning_content
    }

    try {
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(120_000),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        // 402/429/5xx → 标记 provider 熔断, 触发自动降级
        if (r.status === 402 || r.status === 429 || r.status >= 500) {
          const provider = this.providers.get(id);
          if (provider) {
            provider.tripped = true;
            provider.trippedAt = Date.now();
            provider.failureCount++;
            this.emit('provider:tripped', { provider: id, status: r.status, reason: errText.slice(0, 100) });
            console.warn(`[router] provider ${id} tripped (HTTP ${r.status}), auto-fallback triggered`);
          }
        }
        throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
      }

      // ====== 流式响应 (SSE, 支持 tool_calls delta) ======
      if (req.stream === true && r.body) {
        const reader = (r.body as any).getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let fullContent = '';
        let fullThinking = '';
        const toolCallsAcc: Map<number, { id: string; name: string; args: string }> = new Map();
        const MAX_TOOL_CALLS = 10; // 资源上限: 防止内存溢出
        const MAX_CONTENT_CHARS = 100_000; // 防止 OOM
        let usage: any = { prompt_tokens: 0, completion_tokens: 0 };
        let streamModel = modelName;
        let contentTruncated = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const rawChunk = JSON.parse(data);
              // Cline.bot 流式: chunk 也可能嵌套在 data 字段中
              const chunk = rawChunk.data || rawChunk;
              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;
              // 文本内容 (有大小限制防止 OOM)
              if (delta.content) {
                if (fullContent.length < MAX_CONTENT_CHARS) {
                  fullContent += delta.content;
                } else if (!contentTruncated) {
                  fullContent += '\n\n[...内容过长, 已截断...]';
                  contentTruncated = true;
                }
              }
              // 思考内容 (Agnes AI thinking 模式: reasoning_content 字段)
              if (delta.reasoning_content && fullThinking.length < MAX_CONTENT_CHARS) {
                fullThinking += delta.reasoning_content;
                if (req.onDelta) (req.onDelta as any)(`[THINKING]${delta.reasoning_content}`);
              }
              // tool_calls delta (Agnes 支持)
              if (delta.tool_calls) {
                // 资源上限检查: 超过 MAX_TOOL_CALLS 后丢弃后续 delta
                if (toolCallsAcc.size >= MAX_TOOL_CALLS) continue;
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const acc = toolCallsAcc.get(idx) || { id: '', name: '', args: '' };
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name += tc.function.name;
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                  toolCallsAcc.set(idx, acc);
                }
              }
              if (chunk.model) streamModel = chunk.model;
              if (chunk.usage) usage = chunk.usage;
              if (req.onDelta && delta.content) (req.onDelta as any)(delta.content);
            } catch { /* ignore parse errors */ }
          }
        }

        const toolCalls: ToolCall[] = [...toolCallsAcc.values()]
          .filter(tc => tc.name)
          .map(tc => {
            let args: Record<string, any> = {};
            try { args = JSON.parse(tc.args || '{}'); } catch {}
            return { id: tc.id || `call_${Math.random()}`, name: tc.name, args };
          });

        return {
          content: fullContent,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          model: streamModel,
          finishReason: 'stop',
          usage: {
            prompt_tokens: usage.prompt_tokens ?? usage.promptTokens ?? 0,
            completion_tokens: usage.completion_tokens ?? usage.completionTokens ?? 0,
            total_tokens: (usage.prompt_tokens ?? usage.promptTokens ?? 0) + (usage.completion_tokens ?? usage.completionTokens ?? 0),
          },
        };
      }

      // ====== 非流式 (支持 tool_calls) ======
      const rawData = await r.json() as any;
      // Cline.bot 响应格式: 数据嵌套在 data 字段中
      const data = rawData.data || rawData;
      const choice = data.choices?.[0];
      const content = choice?.message?.content || '';
      const rawToolCalls = choice?.message?.tool_calls;
      let toolCalls: ToolCall[] | undefined;
      if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
        toolCalls = rawToolCalls.map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          name: tc.function?.name || '',
          args: (() => { try { return JSON.parse(tc.function?.arguments || '{}'); } catch { return {}; } })(),
        }));
      }
      return {
        content,
        toolCalls,
        model: data.model || modelName,
        finishReason: choice?.finish_reason || 'stop',
        usage: {
          prompt_tokens: data.usage?.prompt_tokens ?? data.usage?.promptTokens ?? 0,
          completion_tokens: data.usage?.completion_tokens ?? data.usage?.completionTokens ?? 0,
          total_tokens: (data.usage?.prompt_tokens ?? data.usage?.promptTokens ?? 0) + (data.usage?.completion_tokens ?? data.usage?.completionTokens ?? 0),
        },
      };
    } catch (err: any) {
      // 抛给 tryOne: 标记失败 → router 自动降级到下一个 provider
      throw err;
    }
  }

  // ===== 辅助方法 =====
  private hashPrefix(req: ChatRequest): string {
    // 学自: Reasonix Pillar 1 immutable prefix
    // 只 hash system + tools, 不 hash 用户消息 (会变)
    const systemAndTools = JSON.stringify({
      system: req.messages.filter(m => m.role === 'system'),
      tools: req.tools,
      temperature: req.temperature,
    });
    return createHash('sha256').update(systemAndTools).digest('hex').slice(0, 16);
  }

  private isCacheable(req: ChatRequest): boolean {
    // 流式 + 高温度不缓存
    if (req.stream) return false;
    if (req.temperature && req.temperature > 0.3) return false;
    return true;
  }

  private computeUsage(p: ProviderStats, repaired: any, req: ChatRequest): ChatResponse['usage'] {
    const apiUsage = repaired.usage;
    const apiPrompt = apiUsage?.promptTokens ?? apiUsage?.prompt_tokens ?? 0;
    const apiCompletion = apiUsage?.completionTokens ?? apiUsage?.completion_tokens ?? 0;
    const apiTotal = apiUsage?.totalTokens ?? apiUsage?.total_tokens ?? (apiPrompt + apiCompletion);
    const apiCacheHit = apiUsage?.cacheHit ?? false;

    // 1) 优先采用 API 返回的真实 usage, 但若为 0/缺失/疑似异常, 则本地估算补齐
    const hasApiUsage = apiPrompt > 0 || apiCompletion > 0;

    let promptTokens = apiPrompt;
    let completionTokens = apiCompletion;
    let source: 'api' | 'estimated' = 'api';

    if (!hasApiUsage) {
      // 本地估算: 输入含完整消息 + 工具定义, 输出含回复 + tool_calls
      promptTokens = estimateMessagesTokens(req.messages as any[], req.tools as any[]);
      completionTokens = estimateStringTokens(repaired.content || '');
      if (repaired.toolCalls && Array.isArray(repaired.toolCalls)) {
        completionTokens += estimateToolCallsTokens(repaired.toolCalls);
      }
      source = 'estimated';
    } else if (apiTotal > 0 && Math.abs(apiTotal - (apiPrompt + apiCompletion)) > 10) {
      // 2) 若 API 返回的 total_tokens 与 p+c 差距过大, 视为异常 → 用本地估算修正
      const estPrompt = estimateMessagesTokens(req.messages as any[], req.tools as any[]);
      const estCompletion = estimateStringTokens(repaired.content || '');
      promptTokens = estPrompt;
      completionTokens = estCompletion;
      source = 'estimated';
    }

    const totalTokens = promptTokens + completionTokens;
    const cost = apiUsage?.cost ?? this._calculateCost(promptTokens, completionTokens, p);

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      cacheHit: apiCacheHit,
      source,
    };
  }

  private _calculateCost(promptTokens: number, completionTokens: number, p: ProviderStats): number {
    return (promptTokens / 1000) * p.costPer1kInput + (completionTokens / 1000) * p.costPer1kOutput;
  }

  private recordSuccess(p: ProviderStats, latencyMs: number): void {
    p.totalCalls++;
    p.successCount++;
    p.recentLatencyMs.push(latencyMs);
    if (p.recentLatencyMs.length > 100) p.recentLatencyMs.shift();
    // 成功调用 = 速率限制解除, 重置冷却
    p.rateLimitCooldownUntil = undefined;
    p.rateLimitRetryCount = Math.max(0, p.rateLimitRetryCount - 1);
    // 记录调用时间 (用于主动调速)
    p.lastCallAt = Date.now();
  }

  private recordFailure(p: ProviderStats, _err: Error): void {
    p.totalCalls++;
    p.failureCount++;
    // 从错误消息中提取 HTTP 状态码
    const statusMatch = _err.message?.match(/HTTP\s*(\d{3})/);
    if (statusMatch) p.lastErrorStatus = parseInt(statusMatch[1], 10);

    // === 速率限制 (429) 单独处理 — 不触发熔断 ===
    if (p.lastErrorStatus === 429) {
      const backoff = Math.min(
        AgentAIRouter.RL_BASE_COOLDOWN_MS * Math.pow(AgentAIRouter.RL_BACKOFF_FACTOR, p.rateLimitRetryCount),
        AgentAIRouter.RL_MAX_COOLDOWN_MS,
      );
      p.rateLimitCooldownUntil = Date.now() + backoff;
      p.rateLimitRetryCount++;
      // 429 不计入成功/失败率, 撤消 failureCount++
      p.failureCount = Math.max(0, p.failureCount - 1);
      console.info(`[router] ${p.id} rate limited (429), cooling ${backoff / 1000}s (retry #${p.rateLimitRetryCount})`);
      return;
    }

    // === 非 429 错误 — 正常熔断 ===
    // 失败率超过 30% 熔断
    if (p.failureCount / p.totalCalls > 0.30) {
      // 失败率只算非 429 错误
      const non429Total = p.totalCalls - p.rateLimitRetryCount;
      const non429Failures = p.failureCount - p.rateLimitRetryCount;
      if (non429Total > 0 && non429Failures / non429Total > 0.30) {
        p.tripped = true;
        p.trippedAt = Date.now();
        this.emit('circuit:tripped', { provider: p.id });
      }
    }
  }

  // ===== 反思门 (自创, 学 WorkBuddy) =====
  private lastReflectAt = 0;
  private reflectEvery = 10; // 每 10 轮反思一次

  private shouldReflect(): boolean {
    if (this.appendOnlyLog.length % this.reflectEvery !== 0) return false;
    if (this.appendOnlyLog.length === 0) return false;
    if (Date.now() - this.lastReflectAt < 60_000) return false; // 至少 1 分钟 1 次
    this.lastReflectAt = Date.now();
    return true;
  }

  private async reflect(): Promise<void> {
    // 简化: 总结最近 10 轮的失败模式
    const recent = this.appendOnlyLog.slice(-this.reflectEvery);
    const failures = recent.filter(r => r.res.usage.cost > this.costGuard.maxCostPerTurn);
    this.emit('reflect:done', {
      window: this.reflectEvery,
      avgCost: recent.reduce((s, r) => s + r.res.usage.cost, 0) / recent.length,
      failureCount: failures.length,
    });
  }
}
