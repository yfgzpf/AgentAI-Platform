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
export type ProviderId = 'agentai' | 'deepseek' | 'openai' | 'zhipu' | 'superapi' | 'dxnt' | string;

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
/** 流式思考内容回调 (可选, reasoning_content 的流式 delta) */
onThinking?: (delta: string) => void;
  /** 启用 Thinking 模式 (Agnes 2.0 Flash 推荐, 提升代码/推理质量) */
  thinking?: boolean;
  /** Thinking token 预算 (默认 2048, 仅 thinking=true 时生效) */
  thinkingBudget?: number;
  /** 上下文窗口大小 (tokens), 用于截断旧消息 */
  contextWindow?: number;
  /** 自定义模型配置 (非内置 provider 时由前端传递) */
  modelConfig?: { baseURL: string; modelName: string; provider: string };
  /** 用户中断信号 (与 fetch 超时信号合并, 实现用户点中断时取消 in-flight 请求) */
  abortSignal?: AbortSignal;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  finishReason?: string;
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
export function toolSpecsToOpenAI(specs: ToolSpec[], stripParams = false): OpenAITool[] {
  return specs.map(s => ({
    type: 'function' as const,
    function: {
      name: s.name,
      description: s.description,
      // deepseek flash 节省 token: 不发送完整 JSON Schema (~834 tokens saved for 25 tools)
      // LLM 靠 description 足以判断是否调用, 参数由 runner 在执行时验证
      parameters: stripParams ? { type: 'object', properties: {} } : (s.parameters ?? { type: 'object', properties: {} }),
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
  /** circuit breaker cooldown (2 分钟, 商业模型更快恢复) */
  private static readonly CB_COOLDOWN_MS = 2 * 60 * 1000;
  /** 速率限制初始冷却 (10 秒) */
  private static readonly RL_BASE_COOLDOWN_MS = 10_000;
  /** 速率限制最大冷却 (2 分钟) */
  private static readonly RL_MAX_COOLDOWN_MS = 120_000;
  /** 冷却退避因子 (每次 429 翻倍) */
  private static readonly RL_BACKOFF_FACTOR = 2;
  /** 主动调速: 两次请求之间的最小间隔 (3 秒, 避免免费模型突发限流) */
  private static readonly REQUEST_PACING_MS = 3_000;
  /** 成本守卫 - PulseFlow 默认启用 (免费模型不累积成本, 商业模型受预算保护) */
  private costGuard = {
    maxCostPerTurn: 5.00,     // USD - 单次调用上限
    maxCostPerDay: 50.00,     // USD - 每日预算上限
    dailySpend: 0,
    dailyResetAt: Date.now() + 86_400_000,
    exceeded: false,
    disabled: false,
  };

  /** 每个 provider 是否支持 reasoning_content (流式响应急时检测, 不写死) */
  private _hasReasoningSupport = new Map<ProviderId, boolean>();
  /** 已知不支持 stream_options 的 provider (响应 400 后自动加入) */
  private _noStreamOptions = new Set<ProviderId>();
  /** 当前正在调用的 provider (流式解析时用) */
  // private _currentProviderId: ProviderId | null = null; // DEAD CODE: never read/written

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
    this.providers.set('dxnt', {
      id: 'dxnt',
      costPer1kInput: 0,      // 免费 (用户自有 API Key)
      costPer1kOutput: 0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    // 商汤 SenseNova (免费额度, OpenAI 兼容: token.sensenova.cn/v1)
    this.providers.set('sensenova', {
      id: 'sensenova',
      costPer1kInput: 0,
      costPer1kOutput: 0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    // 美团 LongCat (免费额度, OpenAI 兼容: api.longcat.chat/openai)
    this.providers.set('longcat', {
      id: 'longcat',
      costPer1kInput: 0,
      costPer1kOutput: 0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
      rateLimitRetryCount: 0,
    });
    // NVIDIA NIM (免费额度, OpenAI 兼容: integrate.api.nvidia.com/v1)
    this.providers.set('nvidia', {
      id: 'nvidia',
      costPer1kInput: 0,
      costPer1kOutput: 0,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      recentLatencyMs: [],
      tripped: false,
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
      dxnt: 'DXNT_API_KEY',
      sensenova: 'SENSENOVA_API_KEY',
      longcat: 'LONGCAT_API_KEY',
      nvidia: 'NVIDIA_API_KEY',
    };
    
    const availableProviders: string[] = [];
    const unavailableProviders: string[] = [];
    
    for (const [pid, keyEnv] of Object.entries(keyMap)) {
      const p = this.providers.get(pid as ProviderId);
      if (!p) continue;
      const hasKey = !!process.env[keyEnv];
      console.log(`[router] recheck ${pid}: hasKey=${hasKey}, tripped=${p.tripped}`);
      if (hasKey && p.tripped) {
        p.tripped = false;
        p.trippedAt = undefined;
        console.log(`[router] ${pid} API key now available, untripped`);
        availableProviders.push(pid);
      } else if (!hasKey && !p.tripped) {
        p.tripped = true;
        console.log(`[router] ${pid} has no API key (${keyEnv}), marked as tripped`);
        unavailableProviders.push(pid);
      } else if (hasKey && !p.tripped) {
        availableProviders.push(pid);
      } else {
        unavailableProviders.push(pid);
      }
    }
    
    console.log(`[router] ✅ 可用模型: ${availableProviders.join(', ') || '无'}`);
    console.log(`[router] ❌ 不可用模型: ${unavailableProviders.join(', ') || '无'}`);
    
    // 如果免费池中的模型不可用，发出警告
    const FREE_POOL = ['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia'];
    const unavailableFree = unavailableProviders.filter(p => FREE_POOL.includes(p));
    if (unavailableFree.length > 0) {
      console.warn(`[router] ⚠️ 以下免费模型不可用: ${unavailableFree.join(', ')}`);
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
    // 不再 throw, 仅标记超限, 免费模型继续可用
    const budgetOk = this.checkCostGuard();
    if (!budgetOk) {
      console.info('[cost-guard] 日预算已超限, 仅允许免费模型');
    }

    // 跟踪指定模型是否已尝试失败 (用于降级时放开 forceProvider)
    let specifiedModelFailed = false;

// 免费模型池: 这些可以互相切换 (sensenova/longcat 有免费额度, 也加入)
const FREE_POOL = new Set(['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia']);
    const isFreeModel = (id: string) => FREE_POOL.has(id);
    // 用户选了付费模型 → 只锁该 provider, 不 fallback 到免费池
    const isPremiumModel = req.model && !isFreeModel(req.model);

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
        // 付费模型不在 ranking 中兜底 — circuit open 时返回空内容让 loop 救场链处理
        const premiumEmpty = (): ChatResponse => ({
          content: '',
          provider: req.model as ProviderId,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
          durationMs: 0,
        });
        if (this.isCircuitOpen(target)) {
          this.tryRecoverCircuit(target);
          if (this.isCircuitOpen(target)) {
            console.warn(`[router] requested provider ${req.model} is tripped`);
            if (isPremiumModel) return premiumEmpty();
            specifiedModelFailed = true;
          } else {
            try {
              return await this.tryOne(target, req, req.subModel);
            } catch (err) {
              console.warn(`[router] ${req.model} failed (${(err as Error).message?.slice(0, 80)}`);
              if (isPremiumModel) return premiumEmpty();
              specifiedModelFailed = true;
            }
          }
        } else {
          try {
            return await this.tryOne(target, req, req.subModel);
          } catch (err) {
            console.warn(`[router] ${req.model} failed (${(err as Error).message?.slice(0, 80)}`);
            if (isPremiumModel) return premiumEmpty();
            specifiedModelFailed = true;
          }
        }
      }
    }

    // === Step 2: 缓存命中 (学 Reasonix Pillar 1) ===
    const requestHash = this.hashRequest(req);
    // 检索所有 provider 的缓存 (key 格式: ${provider}:${hash})
    for (const [providerId, cached] of this.cache.entries()) {
      if (cached && !req.stream && this.isCacheable(req) && providerId.endsWith(`:${requestHash}`)) {
        this.emit('cache:hit', { hash: requestHash, provider: cached.provider });
        return { ...cached, usage: { ...cached.usage, cacheHit: true } };
      }
    }

    // === Step 4: 5 维评分选模型 (替换旧的 rankProviders + scoreProvider) ===
  // --- DEPRECATED: 以下两个函数已被上面的 step 4 取代 ---
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

    // ═══ 系统管控员: 动态能力矩阵调整路由排序 ═══
    // 根据运行时表现 (成功率/工具调用/质量分) 对静态排序做动态调整
    try {
      const { getTracker } = await import('./governor/runtime-capability-tracker.js');
      const tracker = getTracker();
      if (tracker.getTrackedModels().length > 0) {
        // 为每个模型计算动态调整分
        const adjustments = new Map<string, number>();
        for (const model of ranked) {
          const dynCap = tracker.getDynamicCapabilities(model.id, 'general');
          if (dynCap.hasRuntimeData && dynCap.runtimeWeight > 0) {
            // 动态分与静态分的差异 → 调整分
            const diff = dynCap.runtimeOverall - dynCap.staticOverall;
            adjustments.set(model.id, diff * dynCap.runtimeWeight);
          }
        }
        // 如果有调整, 重新排序
        if (adjustments.size > 0) {
          ranked.sort((a, b) => {
            const adjA = adjustments.get(a.id) || 0;
            const adjB = adjustments.get(b.id) || 0;
            // 原始排序分数 + 动态调整
            const scoreA = (ranked.indexOf(a) + 1) - adjA * 10; // 放大调整因子
            const scoreB = (ranked.indexOf(b) + 1) - adjB * 10;
            return scoreA - scoreB;
          });
          console.log(`[router] 🧠 动态能力矩阵调整了 ${adjustments.size} 个模型的排序`);
        }
      }
    } catch { /* dynamic adjustment 容错 */ }

    const isFreeProvider = (id: string) => ['agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat', 'nvidia'].includes(id);

    for (const model of ranked) {
      if (!model?.provider) continue;
      const provider = this.providers.get(model.provider as ProviderId);
      if (!provider) continue;
      // === 成本守卫: 预算超限时跳过付费模型, 只允许免费 ===
      if (!budgetOk && !isFreeProvider(model.provider)) {
        continue;
      }
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
          // 降级时关闭 thinking 模式 (避免 reasoning_content 兼容性问题)
          const fallbackReq = { ...req, thinking: false };
          return await this.tryOne(deepseekProvider, fallbackReq, 'deepseek-v4-flash');
        } catch (err) {
          this.recordFailure(deepseekProvider, err as Error);
          console.warn(`[router] deepseek fallback also failed: ${(err as Error).message?.slice(0, 80)}`);
        }
      }
    }

    // === DXNT 紧急兜底 (免费100次/天) ===
    const dxntProvider = this.providers.get('dxnt');
    if (dxntProvider && process.env.DXNT_API_KEY) {
      if (this.isRateLimited(dxntProvider)) {
        const wait = Math.min((dxntProvider.rateLimitCooldownUntil ?? Date.now()) - Date.now(), 3000);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
      }
      if (!this.isRateLimited(dxntProvider)) {
        console.info('[router] emergency fallback: trying dxnt free-route');
        dxntProvider.tripped = false;
        dxntProvider.trippedAt = undefined;
        dxntProvider.failureCount = 0;
        try {
          return await this.tryOne(dxntProvider, req, 'free-route');
        } catch (err) {
          this.recordFailure(dxntProvider, err as Error);
          console.warn(`[router] dxnt fallback also failed: ${(err as Error).message?.slice(0, 80)}`);
        }
      }
    }

    // === 用户自定义模型兜底 (不在内置 6 个中的 provider) ===
    const builtinIds = new Set(['agentai', 'deepseek', 'openai', 'zhipu', 'superapi', 'dxnt', 'sensenova', 'longcat', 'nvidia']);
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
        const cacheKey = `${provider.id}:${this.hashRequest(req)}`;
        this.cache.set(cacheKey, res);
      }

      this.recordSuccess(provider, durationMs);
      return res;
    } catch (err) {
      const errorMsg = (err as Error).message || String(err);
      console.error(`[router] ❌ Provider ${provider.id} failed: ${errorMsg.slice(0, 200)}`);
      this.recordFailure(provider, err as Error);
      this.emit('provider:failed', { provider: provider.id, err });
      throw err;
    }
  }

  /** 判断 circuit breaker 是否开启 (熔断) */
  private isCircuitOpen(p: ProviderStats): boolean {
    if (!p.tripped) return false;
    // tripped = true 时先尝试恢复
    this.tryRecoverCircuit(p);
    if (!p.tripped) return false; // 已恢复
    // 仍在冷却期 → circuit open
    return true;
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
    // 冷却期已过 — 恢复
    p.tripped = false;
    p.totalCalls = 0; // 重置调用计数, 避免旧失败率阻止恢复
    p.failureCount = 0;
    p.trippedAt = undefined;
    p.lastErrorStatus = undefined;
    this.emit('circuit:recovered', { provider: p.id });
    console.info(`[router] circuit recovered: ${p.id} (cooldown elapsed)`);
  }

  // ===== Cost Guard =====
  private checkCostGuard(): boolean {
    if (this.costGuard.disabled) {
      return true;
    }
    if (Date.now() > this.costGuard.dailyResetAt) {
      this.costGuard.dailySpend = 0;
      this.costGuard.dailyResetAt = Date.now() + 86_400_000;
      this.costGuard.exceeded = false;
    }
    if (this.costGuard.exceeded) {
      return false;
    }
    return true;
  }

  private checkCostGuardPost(cost: number): void {
    this.costGuard.dailySpend += cost;
    if (cost > this.costGuard.maxCostPerTurn) {
      this.emit('cost:warning', { cost, max: this.costGuard.maxCostPerTurn });
    }
    if (this.costGuard.dailySpend > this.costGuard.maxCostPerDay) {
      this.costGuard.exceeded = true;
      this.emit('cost:exceeded', {
        spend: this.costGuard.dailySpend,
        max: this.costGuard.maxCostPerDay,
      });
      console.warn(`[cost-guard] 日预算超限: $${this.costGuard.dailySpend.toFixed(2)} / $${this.costGuard.maxCostPerDay}`);
    }
  }

  /** 重置成本守卫 (充值后调用) */
  public resetCostGuard(): void {
    this.costGuard.dailySpend = 0;
    this.costGuard.exceeded = false;
    this.costGuard.dailyResetAt = Date.now() + 86_400_000;
    console.log('[cost-guard] 已手动重置, 日预算清零');
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

    // Step 6: 文本→工具调用 fallback — 当 LLM 输出文本而非调用工具时, 解析文本中的工具调用
    repaired = this.parseTextToolCalls(repaired);

    return repaired;
  }

  /**
   * 文本→工具调用 fallback 解析器
   * 当 LLM 不支持 function calling 或参数被剥离时, 它可能在文本中输出:
   *   list_directory(path="F:\")
   *   read_file(offset=1, limit=100, target_file="src/index.ts")
   *   ```tool
   *   {"name": "read_file", "args": {"path": "src/index.ts"}}
   *   ```
   * 此方法检测这些模式并转换为正式的 toolCalls
   */
  private parseTextToolCalls(raw: any): any {
    // 如果已有 toolCalls, 不需要解析
    if (raw.toolCalls && Array.isArray(raw.toolCalls) && raw.toolCalls.length > 0) return raw;
    if (typeof raw.content !== 'string' || !raw.content) return raw;

    const content = raw.content;
    const toolCalls: ToolCall[] = [];

    // 模式 1: tool_name(param=value, param2=value2)
    // 匹配: list_directory(path="F:\") 或 read_file(target_file="src/index.ts")
    const funcCallPattern = /([a-z_][a-z0-9_]*)\s*\(\s*([^)]+)\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = funcCallPattern.exec(content)) !== null) {
      const name = match[1];
      const argsStr = match[2];
      const args = this.parseToolCallArgs(argsStr);
      if (args && Object.keys(args).length > 0) {
        toolCalls.push({
          id: `text-fallback-${Date.now()}-${toolCalls.length}`,
          name,
          args,
        });
      }
    }

    // 模式 2: ```tool ... ``` 代码块中的 JSON
    const toolBlockPattern = /```(?:tool|json)?\s*\n\s*(\{[\s\S]*?"name"[\s\S]*?"args"[\s\S]*?\})\s*\n```/gi;
    while ((match = toolBlockPattern.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.name && parsed.args) {
          toolCalls.push({
            id: `text-fallback-${Date.now()}-${toolCalls.length}`,
            name: parsed.name,
            args: typeof parsed.args === 'string' ? JSON.parse(parsed.args) : parsed.args,
          });
        }
      } catch {}
    }

    // 模式 3: XML 风格 <tool_call name="xxx">{"path": "..."}</tool_call>
    const xmlPattern = /<tool_call\s+name="([a-z_][a-z0-9_]*)"\s*>([\s\S]*?)<\/tool_call>/gi;
    while ((match = xmlPattern.exec(content)) !== null) {
      const name = match[1];
      try {
        const args = JSON.parse(match[2].trim());
        toolCalls.push({
          id: `text-fallback-${Date.now()}-${toolCalls.length}`,
          name,
          args,
        });
      } catch {}
    }

    // 模式 4: DSML 伪 XML 格式 <｜DSML｜invoke name="xxx">...<｜DSML｜/invoke>
    const dsmlPattern = /<｜DSML｜invoke\s+name="([a-z_][a-z0-9_]*)"\s*>([\s\S]*?)<｜DSML｜\/invoke>/gi;
    while ((match = dsmlPattern.exec(content)) !== null) {
      const name = match[1];
      try {
        // 解析参数
        const paramPattern = /<｜DSML｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<｜DSML｜\/parameter>/gi;
        const args: any = {};
        let paramMatch;
        while ((paramMatch = paramPattern.exec(match[2])) !== null) {
          const paramName = paramMatch[1];
          const paramValue = paramMatch[2].trim();
          // 尝试解析JSON，失败则作为字符串
          try {
            args[paramName] = JSON.parse(paramValue);
          } catch {
            args[paramName] = paramValue;
          }
        }
        toolCalls.push({
          id: `dsml-fallback-${Date.now()}-${toolCalls.length}`,
          name,
          args,
        });
      } catch (e) {
        console.warn('[repair] DSML parse error:', e);
      }
    }

    if (toolCalls.length > 0) {
      console.log(`[repair] text→tool_call fallback: parsed ${toolCalls.length} tool calls from text`);
      raw.toolCalls = toolCalls;
      // 从 content 中移除已解析的工具调用文本, 保留剩余内容
      let cleanedContent = content;
      for (const tc of toolCalls) {
        // 移除匹配的文本
        cleanedContent = cleanedContent.replace(
          new RegExp(`${tc.name}\s*\([^)]*\)`, 'gi'),
          ''
        );
      }
      // 移除空的 tool 代码块和 XML 标签
      cleanedContent = cleanedContent
        .replace(/```(?:tool|json)?\s*\n\s*\{[\s\S]*?\}\s*\n```/gi, '')
        .replace(/<tool_call\s+name="[^"]*"\s*>[\s\S]*?<\/tool_call>/gi, '')
        .trim();
      raw.content = cleanedContent || '';
    }

    return raw;
  }

  /** 解析工具调用参数字符串: path="F:\", limit=100 → {path: "F:\", limit: 100} */
  private parseToolCallArgs(argsStr: string): Record<string, any> | null {
    const args: Record<string, any> = {};
    // 匹配 key=value, value 可以是: "string", 'string', number, true/false, null
    const argPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^,\s]+))/g;
    let m: RegExpExecArray | null;
    while ((m = argPattern.exec(argsStr)) !== null) {
      const key = m[1];
      const val = m[2] ?? m[3] ?? m[4];
      if (val === 'true') args[key] = true;
      else if (val === 'false') args[key] = false;
      else if (val === 'null') args[key] = null;
      else if (/^-?\d+(\.\d+)?$/.test(val)) args[key] = Number(val);
      else args[key] = val;
    }
    return Object.keys(args).length > 0 ? args : null;
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
    console.log(`[router] executeProvider entry: id=${id}, subModel=${subModel || 'undefined'}, req.subModel=${req.subModel || 'undefined'}`);
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
      dxnt: { keyEnv: 'DXNT_API_KEY', baseEnv: 'DXNT_BASE_URL', defaultBase: 'https://www.dxnt.com', modelEnv: 'DXNT_MODEL', defaultModel: 'dxnt.com/free' },
      sensenova: { keyEnv: 'SENSENOVA_API_KEY', baseEnv: 'SENSENOVA_BASE_URL', defaultBase: 'https://token.sensenova.cn/v1', modelEnv: 'SENSENOVA_MODEL', defaultModel: 'sensenova-6.7-flash-lite' },
      longcat: { keyEnv: 'LONGCAT_API_KEY', baseEnv: 'LONGCAT_BASE_URL', defaultBase: 'https://api.longcat.chat/openai', modelEnv: 'LONGCAT_MODEL', defaultModel: 'LongCat-2.0' },
      nvidia: { keyEnv: 'NVIDIA_API_KEY', baseEnv: 'NVIDIA_BASE_URL', defaultBase: 'https://integrate.api.nvidia.com/v1', modelEnv: 'NVIDIA_MODEL', defaultModel: 'deepseek-ai/deepseek-v4-flash' },
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
      
      // 调试日志：显示配置详情（隐藏密钥）
      if (id === 'nvidia' || id === 'sensenova') {
        console.log(`[router] 🔍 ${id} 配置详情:`);
        console.log(`  - keyEnv: ${cfg.keyEnv}`);
        console.log(`  - hasKey: ${!!apiKey}`);
        console.log(`  - keyPrefix: ${apiKey ? apiKey.substring(0, 10) + '...' : 'N/A'}`);
        console.log(`  - baseEnv: ${cfg.baseEnv}`);
        console.log(`  - baseUrl: ${baseUrl}`);
        console.log(`  - modelEnv: ${cfg.modelEnv}`);
        console.log(`  - modelName: ${modelName}`);
      }
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
        // 特殊标记: 标记这条消息的索引位置, 用于后续的完整性检查
        const est = Math.ceil((typeof otherMsgs[i].content === 'string' ? otherMsgs[i].content : '').length * 0.7);
        if (totalEst + est > maxInputTokens && kept.length > 2) break;
        totalEst += est;
        kept.unshift(otherMsgs[i]);
      }
      truncatedMessages = [...systemMsgs, ...kept];

      // ═══ 完整性修复: 确保 tool 消息有前置 assistant(tool_calls) ═══
      // DeepSeek/OpenAI 要求: tool 消息前面必须有 assistant 消息包含 tool_calls
      // 截断可能导致 assistant(tool_calls) 被丢弃但 tool 消息保留 → 400 错误
      // 同时也需要去掉 result 被丢弃的 assistant(tool_calls) → 否则 AI 看到孤立的 tool_calls 无回复 → 空内容
      const fixed: typeof truncatedMessages = [];
      let pendingToolIds = new Set<string>(); // 期待哪些 tool_call_id 的 tool 回复
      let lastAssistantIdx = -1; // 上一个 assistant(tool_calls) 在 fixed 中的索引 (追踪是否有 tool 回复)
      const matchedSet = new Set<string>(); // 哪些 tool_call_id 已经收到回复

      for (let i = 0; i < truncatedMessages.length; i++) {
        const m = truncatedMessages[i];
        if (m.role === 'assistant' && (m as any).tool_calls) {
          // assistant 发了工具调用 → 记录期待的 tool_call_id, 标记位置
          const ids = (m as any).tool_calls.map((tc: any) => tc.id || tc);
          pendingToolIds = new Set(ids);
          lastAssistantIdx = fixed.length; // 记录这个 assistant 插入后的位置
          fixed.push(m);
        } else if (m.role === 'tool') {
          // tool 消息: 只有 tool_call_id 在期望列表中才保留
          const tcId = (m as any).tool_call_id;
          if (tcId && pendingToolIds.has(tcId)) {
            fixed.push(m);
            matchedSet.add(tcId);
          } else {
            // 孤立的 tool 消息 → 丢弃
            console.warn(`[truncate] dropped orphaned tool msg (tool_call_id=${tcId || 'unknown'})`);
          }
        } else if (m.role === 'user') {
          // 用户消息到达时: 检查上一个 assistant(tool_calls) 是否收到了任何 tool 回复
          // 如果没有 → 回退删除那个 assistant(tool_calls), 因为它会因为缺回复导致 LLM 空响应
          if (lastAssistantIdx >= 0 && matchedSet.size === 0) {
            console.warn(`[truncate] removed assistant(tool_calls) with no tool results (idx=${lastAssistantIdx})`);
            fixed.splice(lastAssistantIdx); // 删除上个 assistant 及其之后的空内容
          }
          // 重置状态
          pendingToolIds = new Set();
          matchedSet.clear();
          lastAssistantIdx = -1;
          fixed.push(m);
        } else {
          // assistant(纯文本) / system / 其他
          // 到达非 tool 消息之前, 如果 assistant(tool_calls) 没有收到回复 → 也清理
          if (lastAssistantIdx >= 0 && matchedSet.size === 0 && m.role !== 'tool') {
            console.warn(`[truncate] removed assistant(tool_calls) with no tool results (idx=${lastAssistantIdx})`);
            fixed.splice(lastAssistantIdx);
            lastAssistantIdx = -1;
            matchedSet.clear();
          }
          fixed.push(m);
        }
      }
      // 末尾检查: 最后一个 assistant(tool_calls) 如果没有收到任何 tool 回复 → 删除
      if (lastAssistantIdx >= 0 && matchedSet.size === 0) {
        console.warn(`[truncate] removed trailing assistant(tool_calls) with no tool results (idx=${lastAssistantIdx})`);
        fixed.splice(lastAssistantIdx);
      }
      truncatedMessages = fixed;
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
        // ═══ Provider 通用适配 (不写死 provider 名, 自动检测) ═══
        // 1. 所有 provider 都不接受 assistant content 为 null
        if (m.role === 'assistant' && (msg.content === null || msg.content === undefined)) {
          msg.content = '';
        }
        // ═══ 自动检测: reasoning_content 根据流式响应是否出现过决定 ═══
        // 如果该 provider 的流式响应中从未返回过 reasoning_content → 清理历史残留
        // 如果返回过 → 保留 (例如 DeepSeek thinking 模式)
        if (!this._hasReasoningSupport.get(id)) {
          delete msg.reasoning_content;
        }
        // 3. tool 消息 content 统一转为 string (所有 provider 兼容)
        if (m.role === 'tool' && Array.isArray(msg.content)) {
          msg.content = JSON.stringify(msg.content);
        }
        // 4. tool 消息删除 name (非 OpenAI 标准字段, 所有 provider 兼容)
        if (m.role === 'tool') {
          delete msg.name;
        }
        return msg;
      }),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? (req.tools && req.tools.length > 0 ? 8192 : 4096),
      stream: req.stream === true || false,
    };

    // 工具调用 (Agnes 2.0 Flash 支持 )
    if (req.tools && req.tools.length > 0) {
      // 始终发送完整 JSON Schema — 剥离参数会导致 LLM 不知道参数名, 输出文本而非调用工具
      bodyObj.tools = toolSpecsToOpenAI(req.tools, false);
      bodyObj.tool_choice = 'auto';
    }

    // stream_options: 让 OpenAI 兼容 API 在流式末尾返回 usage (官方推荐)
    // 已知不支持的 provider 已被加入 _noStreamOptions, 跳过
    if (bodyObj.stream === true && !this._noStreamOptions.has(id)) {
      bodyObj.stream_options = { include_usage: true };
    }

    // Thinking 模式 — 根据 provider/模型自动选择思考机制
    // ═══ 不再写死 if(id==='agentai'), 用子模型名自动判断 ═══
    if (req.thinking) {
      if (id === 'nvidia') {
        // NVIDIA NIM: 不支持 thinking 参数, 跳过 (模型自带推理能力)
      } else if (id === 'agentai') {
        // Agnes AI: chat_template_kwargs.enable_thinking
        bodyObj.chat_template_kwargs = { enable_thinking: true };
        if (req.thinkingBudget && req.thinkingBudget > 0) {
          (bodyObj.chat_template_kwargs as any).thinking_budget = req.thinkingBudget;
        }
      } else if (id === 'sensenova') {
        // ═══ 商汤 SenseNova 适配 ═══
        // SenseNova 原生模型 (sensenova-6.7-flash-lite, sensenova-u1-fast): 不支持 thinking 参数
        // SenseNova 代理的 DeepSeek V4 Flash: 用 reasoning_effort (不是 thinking:{type:'enabled'})
        //   reasoning_effort: "low" / "medium" / "high" / "none", 默认 "medium"
        if (modelName?.includes('deepseek') || modelName?.includes('ds-')) {
          bodyObj.reasoning_effort = modelName?.includes('pro') ? 'max' : 'high';
        }
        // sensenova 原生模型: 不发送任何 thinking 参数
      } else if (id === 'longcat') {
        // 美团 LongCat: 不支持 thinking 参数, 跳过
      } else if (modelName?.includes('deepseek') || modelName?.includes('ds-') || id === 'deepseek') {
        // DeepSeek 直连 API: 用 reasoning_effort (不发送 thinking:{type:'enabled'}, 避免冲突)
        // DeepSeek V4 默认启用思考模式, reasoning_effort 控制深度
        if (modelName?.includes('pro')) {
          bodyObj.reasoning_effort = 'max'; // Pro 用 max
        } else {
          bodyObj.reasoning_effort = 'high'; // Flash 用 high
        }
      } else if (modelName?.includes('glm') || id === 'zhipu') {
        // ═══ 智谱 GLM thinking 适配 ═══
        // 智谱不支持 { type: 'enabled' } 格式
        // glm-4.7-flash 不支持 thinking 参数, 降级时不要带 thinking
        // 由 flow 报错后自动标记为不支持 thinking
      }
    }

    try {
      console.log(`[router] executeProvider: id=${id}, model=${modelName}, baseUrl=${baseUrl}, hasKey=${!!apiKey}`);
      const r = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity', // SSE 禁用压缩: 避免客户端缓冲解压导致延迟
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(bodyObj),
        signal: req.abortSignal
          ? AbortSignal.any([AbortSignal.timeout(300_000), req.abortSignal])
          : AbortSignal.timeout(300_000), // 5 分钟超时 + 用户 abort 联动
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        // ═══ 自动检测: stream_options 被拒 → 标记并重试 ═══
        if (r.status === 400 && !this._noStreamOptions.has(id) && bodyObj.stream_options) {
          this._noStreamOptions.add(id);
          console.warn(`[router] auto-detect: ${id} 不支持 stream_options, 标记后重试`);
          return await this.executeProvider(id, req, modelName);
        }
        // 402/5xx → 标记 provider 熔断, 触发自动降级
        // 429 由 recordFailure() 统一处理为指数退避冷却, 不在此处熔断
        if (r.status === 402 || r.status >= 500) {
          const provider = this.providers.get(id);
          if (provider) {
            provider.tripped = true;
            provider.trippedAt = Date.now();
            provider.failureCount++;
            this.emit('provider:tripped', { provider: id, status: r.status, reason: errText.slice(0, 100) });
            console.warn(`[router] provider ${id} tripped (HTTP ${r.status}), auto-fallback triggered`);
          }
        }
        // ═══ 修复: 401 密钥无效 → 临时标记不可用 (60秒), 触发降级到其他 provider ═══
        // 不永久熔断 (用户可能中途换 key), 但当前会话内跳过此 provider
        if (r.status === 401) {
          const provider = this.providers.get(id);
          if (provider) {
            provider.tripped = true;
            provider.trippedAt = Date.now();
            // 60 秒后自动恢复 (比正常熔断的 30 秒长, 避免频繁重试无效 key)
            this.emit('provider:tripped', { provider: id, status: 401, reason: 'API key invalid or expired' });
            console.warn(`[router] provider ${id} tripped (HTTP 401 - key invalid), will retry in 60s`);
          }
        }
        // 针对 NVIDIA 和商汤的详细错误日志
        if (id === 'nvidia' || id === 'sensenova') {
          console.error(`[router] ❌ ${id} 请求失败:`);
          console.error(`  - HTTP状态: ${r.status}`);
          console.error(`  - 错误详情: ${errText.slice(0, 300)}`);
          console.error(`  - 请求URL: ${baseUrl}/chat/completions`);
          console.error(`  - 模型名称: ${modelName}`);
          console.error(`  - 请求体: ${JSON.stringify({...bodyObj, messages: `[${bodyObj.messages.length} messages]`}).slice(0, 500)}`);
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
              // ═══ 自动检测: 该 provider 是否返回推理内容 ═══
              if (delta.reasoning_content) {
                // 流式响应中发现 reasoning_content → 标记此 provider 支持推理
                if (!this._hasReasoningSupport.get(id)) {
                  this._hasReasoningSupport.set(id, true);
                  console.info(`[router] auto-detect: ${id} 支持 reasoning_content (推理内容)`);
                }
                if (fullThinking.length < MAX_CONTENT_CHARS) {
                  fullThinking += delta.reasoning_content;
                  // 使用专用 onThinking 回调, 不再用 [THINKING] 前缀污染 onDelta
                  if (req.onThinking) req.onThinking(delta.reasoning_content);
                }
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
  private hashRequest(req: ChatRequest): string {
    // 缓存必须绑定完整请求上下文, 否则不同用户消息会串用旧答案
    const requestFingerprint = JSON.stringify({
      model: req.model,
      subModel: req.subModel,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      thinking: req.thinking,
      thinkingBudget: req.thinkingBudget,
    });
    return createHash('sha256').update(requestFingerprint).digest('hex').slice(0, 16);
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

    // === 客户端错误 (400) 不触发熔断 — 这是请求格式问题不是服务故障 ===
    if (p.lastErrorStatus === 400) {
      console.warn(`[router] ${p.id} client error (400), not tripping`);
      return;
    }
    // === 401 已在 executeProvider 中临时 tripped, 这里不再重复处理 ===

    // === 超时/网络中断 不触发熔断 — 长任务正常超时, 不是模型故障 ===
    const errMsg = _err.message?.toLowerCase() || '';
    if (errMsg.includes('timeout') || errMsg.includes('abort') || errMsg.includes('econnreset') || errMsg.includes('econnrefused')) {
      // 撤销 failureCount++ — 超时不算模型失败
      p.failureCount = Math.max(0, p.failureCount - 1);
      console.warn(`[router] ${p.id} timeout/network error (not tripping): ${_err.message?.slice(0, 80)}`);
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

  // ===== 反思门 (已废弃 - P2-2 清理) =====
  // _lastReflectAt, _reflectEvery, shouldReflect(), reflect() 已在 P2-2 删除
  // isCircuitOpen() 保留在第 736 行
  // 类在此关闭
}
