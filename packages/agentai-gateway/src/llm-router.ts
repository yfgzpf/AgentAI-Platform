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
import { getModelContextWindow, getDefaultContextWindow, getCapability } from './model-capabilities.js';
import { modelMetrics } from './model-metrics-service.js';

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
  /** DeepSeek thinking 模式下返回的推理内容, 多轮工具调用必须保留 */
  reasoningContent?: string;
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
  /** 是否为临时 fallback (原模型不可用时用免费模型接管) */
  tempFallback?: boolean;
  /** 原始用户选择的 provider (仅 tempFallback=true 时有值) */
  originalProvider?: string;
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
  return specs.map(s => {
    // DeepSeek 兼容: 确保 parameters 是有效的 JSON Schema
    let params = s.parameters;
    if (!params || typeof params !== 'object') {
      params = { type: 'object', properties: {} };
    }
    if (params.type !== 'object') {
      console.warn(`[toolSpecsToOpenAI] 修复工具 "${s.name}" schema: type "${params.type}" → "object"`);
      params = { ...params, type: 'object' };
    }
    if (!params.properties) {
      params = { ...params, properties: {} };
    }
    
    return {
      type: 'function' as const,
      function: {
        name: s.name,
        description: s.description,
        // deepseek flash 节省 token: 不发送完整 JSON Schema (~834 tokens saved for 25 tools)
        // LLM 靠 description 足以判断是否调用, 参数由 runner 在执行时验证
        parameters: stripParams ? { type: 'object', properties: {} } : params,
      },
    };
  });
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
  /** 不稳定提供者的超时 (15 秒, 避免免费模型阻塞整个轮询) */
  private static readonly FLAKY_TIMEOUT_MS = 15_000;
  /** 不稳定提供者集合 — 连接不稳定, 设短超时 + 快速熔断 */
  private static readonly FLAKY_PROVIDERS = new Set(['sensenova', 'longcat']);
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
    // NVIDIA NIM 已移除 (2026-07-25): 需自建 GPU Docker + 端点不稳定 + 中国大陆不可达

    // 🔧 agnes 别名: MODEL_MAP 中 agnes-2.5-flash/agnes-2.0 可能映射到 'agnes' provider,
    //    但 providers Map 中注册的是 'agentai', 所以做个别名指向同一 stats 对象
    const agentaiStats = this.providers.get('agentai');
    if (agentaiStats) {
      this.providers.set('agnes', agentaiStats);
    }

    // 注意: 不在构造函数中检查 API Key, 因为 .env 可能尚未加载
    // 由 index.ts 调用 recheckApiKeys() 统一检查
  }

  /** 重新检查 API Key 可用性 (在 .env 加载后调用, 修复 import 时序问题) */
  recheckApiKeys() {
    console.log('[router] recheckApiKeys() called');
    const keyMap: Record<string, string> = {
      agnes: 'AGENTAI_API_KEY',      // Agnes AI 使用 AGENTAI_API_KEY
      agentai: 'AGENTAI_API_KEY',    // 兼容旧版
      deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
      superapi: 'SUPERAPI_API_KEY',
      dxnt: 'DXNT_API_KEY',
      sensenova: 'SENSENOVA_API_KEY',
      longcat: 'LONGCAT_API_KEY',
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
    const FREE_POOL = ['agnes', 'agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat'];
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
const FREE_POOL = new Set(['agnes', 'agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat']);
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

    // === Step 4: 单模型优先 + 重试机制 (2026-07-26 重构) ===
    // 新策略:
    //   1. 用户指定模型 → 只用该模型, 不轮换
    //   2. 错误时 → 同一模型重试 (最多 MAX_RETRY 次)
    //   3. 多次失败 → 才切换到备用模型
    //   参考 ZCode: Agnes AI 运行稳定, 不需要频繁切换
    const MAX_RETRY = 3;  // 同一模型最大重试次数
    let forceProvider: string | undefined = req.model;  // 始终锁定用户选择的模型

    // 检测是否需要视觉能力 (消息中含 image_url)
    const needsVision = req.messages.some(m => {
      if (typeof m.content === 'string') return false;
      if (Array.isArray(m.content)) return m.content.some(c => (c as any).type === 'image_url');
      return false;
    });

    // 2026-07-26: 移除 preferFree 限制, 所有模型同等对待
    // 不再默认优先使用免费模型, 让评分路由器根据能力自动选择最佳模型
    const userText = req.messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ');
    const preferFree = false;  // 所有用途都开放全部模型, 由评分决定

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

    const isFreeProvider = (id: string) => ['agnes', 'agentai', 'zhipu', 'dxnt', 'sensenova', 'longcat'].includes(id);

    // ✅ 2026-08-03 P0: 同厂整组排除 (Agnes2.5失败切同厂2.0也必然失败; 用户明确反馈)
    //   注意: req.model 可能是 provider 名 (agentai/zhipu/deepseek) 或 model 名 (agnes-2.5-flash)
    //   必须同时覆盖两种情况, 否则 findVendorGroupId fallback 返回自身字符串 → 同厂排除完全失效
    const VENDOR_GROUPS: Record<string, string[]> = {
      agnes:     ['agnes', 'agentai'],
      zhipu:     ['zhipu'],
      sensenova: ['sensenova'],
      longcat:   ['longcat'],
      dxnt:      ['dxnt'],
      deepseek:  ['deepseek'],
      superapi:  ['superapi'],
      qwen:      ['qwen'],
      moonshot:  ['moonshot'],
      doubao:    ['doubao'],
      minimax:   ['minimax'],
      anthropic: ['anthropic'],
      openai:    ['openai'],
    };
    // model 名 → vendor group (与 model-selector.ts BUILTIN_MODELS 保持一致)
    const MODEL_MAP: Record<string, string> = {
      'agnes-2.5-flash': 'agnes',
      'agnes-2.0':       'agnes',
      'agnes':           'agnes',
      'agentai':         'agnes',
      // 显式版本别名 (避免 findVendorGroupId fallback 问题)
      'agnes_2_5':       'agnes',
      'agnes_2_0':       'agnes',
      'glm-4.7-flash':   'zhipu',
      'deepseek-v4-flash': 'deepseek',
      'deepseek-v4-pro':   'deepseek',
    };
    const findVendorGroupId = (modelOrProvider: string): string => {
      // 1. 直接查 VENDOR_GROUPS（provider 名或 model 名直接命中）
      const direct = Object.entries(VENDOR_GROUPS).find(([, arr]) => arr.includes(modelOrProvider));
      if (direct) return direct[0];
      // 2. 查 MODEL_MAP（model 名 → provider 名）
      const provider = MODEL_MAP[modelOrProvider];
      if (provider) return provider;
      // 3. 兜底：未知模型/自定义 provider → 不归组，不做同厂排除
      console.debug(`[router] 📌 未知 provider/model: ${modelOrProvider}, 不做同厂排除`);
      return ''; // 空字符串 = 不匹配任何组，sameVendorAsFailed 永远 false
    };
    const excludedVendorGroup = req.model ? findVendorGroupId(req.model) : null;
    const sameVendorAsFailed = (p: string) => !!excludedVendorGroup && findVendorGroupId(p) === excludedVendorGroup;

    // ═══ 单模型优先策略: 用户选择的模型优先, 失败后才尝试其他模型 ═══
    // 2026-07-26 重构: 参考 ZCode, Agnes AI 运行稳定不需要频繁切换

    // 如果用户指定了模型, 先尝试该模型 (带重试)
    if (req.model) {
      const targetProvider = this.providers.get(req.model as ProviderId);
      if (targetProvider && !this.isCircuitOpen(targetProvider)) {
        // 对用户指定的模型进行最多 MAX_RETRY 次重试
        for (let retry = 0; retry < MAX_RETRY; retry++) {
          try {
            // 速率限制检查
            if (this.isRateLimited(targetProvider)) {
              const waitMs = this.findShortestCooldown();
              if (waitMs > 0) {
                await new Promise(r => setTimeout(r, Math.min(waitMs, 3000)));
              }
            }
            const res = await this.tryOne(targetProvider, req, req.subModel);
            return res;
          } catch (err) {
            console.warn(`[router] ${req.model} attempt ${retry + 1}/${MAX_RETRY} failed: ${(err as Error).message?.slice(0, 80)}`);
            if (retry < MAX_RETRY - 1) {
              // 重试前等待一小段时间
              await new Promise(r => setTimeout(r, 500 * (retry + 1)));
            }
          }
        }
        // 所有重试都失败, 记录并继续尝试备用模型
        console.warn(`[router] ${req.model} failed after ${MAX_RETRY} retries, trying fallback`);
        this.recordFailure(targetProvider, new Error(`${MAX_RETRY} retries exhausted`));
      }
    }

    // ═══ 备用模型轮换 (仅当主模型完全失败时) ═══
    for (const model of ranked) {
      if (!model?.provider) continue;
      // 跳过用户指定的模型 (已经尝试过了)
      if (req.model && model.provider === req.model) continue;
      // ✅ P0 修复: 同厂商整组排除 (e.g. agnes失败后不能切 agentai alias, 因为API其实同一套)
      if (sameVendorAsFailed(model.provider)) {
        console.debug(`[router] 🚫 跳过同厂 ${model.provider} (失败组: ${excludedVendorGroup})`);
        continue;
      }

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

      try {
        if (model.subModel) {
          return await this.tryOne(provider, req, model.subModel);
        }
        const res = await this.tryOne(provider, req);
        // 标记这是备用模型的响应
        if (req.model) {
          return { ...res, fallbackFrom: req.model };
        }
        return res;
      } catch (err) {
        console.warn(`[router] fallback ${model.provider} failed (${(err as Error).message?.slice(0, 80)}), trying next`);
        continue;
      }
    }

    // All providers failed — emergency recovery
    // 尝试强制恢复免费 provider, 尊重冷却但不完全跳过
    const freeProviders = ['agnes', 'zhipu', 'agentai'] as ProviderId[];
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
    const builtinIds = new Set(['agnes', 'agentai', 'deepseek', 'openai', 'zhipu', 'superapi', 'dxnt', 'sensenova', 'longcat']);
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
    const lastUserText = (typeof lastMsg?.content === 'string' ? lastMsg.content : (lastMsg?.content != null ? JSON.stringify(lastMsg.content) : '')).slice(0, 200);
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
    
    // ===== Phase 2: 模型性能指标收集（零侵入）=====
    // 在 tryOne 中收集指标，确保所有 provider 调用都被记录
    let metricsContext: any = null;
    try {
      const { modelMetrics } = await import('./model-metrics-service.js');
      metricsContext = modelMetrics.startCall(subModel || provider.id, provider.id, (req as any).sessionId);
    } catch (e) {
      // 静默失败
    }
    // ================================================
    
    try {
      const raw = await this.executeProvider(provider.id, req, subModel);
      const durationMs = Date.now() - t0;

      const repaired = await this.repairPipeline(raw);
      const usage = this.computeUsage(provider, repaired, req);
      this.checkCostGuardPost(usage.cost);

      const res: ChatResponse = {
        content: repaired.content,
        toolCalls: repaired.toolCalls,
        reasoningContent: (raw as any).reasoningContent || repaired.reasoningContent,
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
      
      // ===== Phase 2: 记录成功指标 =====
      try {
        if (metricsContext) {
          metricsContext.finish({
            inputTokens: usage.promptTokens || 0,
            outputTokens: usage.completionTokens || 0,
            cost: usage.cost || 0,
            success: true,
            cacheHit: usage.cacheHit,
          });
        }
      } catch (e) { /* 静默失败 */ }
      // ===================================
      
      return res;
    } catch (err) {
      const errorMsg = (err as Error).message || String(err);
      console.error(`[router] ❌ Provider ${provider.id} failed: ${errorMsg.slice(0, 200)}`);
      this.recordFailure(provider, err as Error);
      this.emit('provider:failed', { provider: provider.id, err });
      
      // ===== Phase 2: 记录失败指标 =====
      try {
        if (metricsContext) {
          metricsContext.finish({
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            success: false,
            errorType: (err as Error).name || 'unknown',
          });
        }
      } catch (e) { /* 静默失败 */ }
      // ===================================
      
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
    const KNOWN_TOOL_NAMES = new Set([
      "list_directory", "read_file", "write_file", "edit_file", "create_file", "delete_file",
      "move_file", "copy_file", "search_content", "glob", "get_file_info", "get_symbols",
      "run_command", "run_code", "run_background", "job_output", "wait_for_job", "stop_job", "list_jobs",
      "npm_install", "npm_run", "pnpm_install", "pnpm_run", "yarn_install", "yarn_run",
      "docker_build", "docker_run", "docker_ps", "docker_logs",
      "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_checkout",
      "typecheck", "diff_preview", "undo_edit", "create_directory",
      "directory_tree", "search_codebase", "find_references", "analyze_code",
      "generate_image", "generate_video", "query_video", "generate_diagram",
      "web_search", "web_fetch", "browser_navigate", "browser_click", "browser_type",
      "capture_screen", "capture_and_read", "ocr_image", "list_windows", "window_control",
      "desktop_automate", "officecli", "open_application", "send_notification",
      "schedule_task", "list_schedules", "workflow_run", "workflow_list_templates",
      "activate_expert", "activate_expert_team", "discover_or_create_skill", "skill_forge",
      "create_tool", "spawn_subagent", "explore_project", "plan_task", "update_plan",
      "remember", "recall_memory", "forget", "evolve_prompt", "ask_user",
      "control_music", "knowledge_import", "industry_insight",
      "cad_control", "render_widget", "validate_and_fix", "git_smart_commit",
      "preview_edit", "apply_edit", "worktree_create", "worktree_list", "worktree_remove",
      "spec_generate", "chain_create", "self_diagnose", "code_review",
      "list_processes", "kill_process", "notify", "launch_app", "system_info",
      "lock_screen", "set_volume", "toggle_mute", "wait_for_window",
      "clipboard_read", "clipboard_write", "mouse_move", "mouse_click", "mouse_drag", "mouse_scroll",
      "keyboard_type", "press_hotkey", "click_text", "wait_for_text", "find_text_on_screen",
      "click_image", "wait_for_image", "find_image_on_screen", "type_into_text",
      "browser_submit", "browser_upload", "browser_tabs", "browser_set_cookies",
      "browser_wait_for", "browser_select", "browser_hover", "browser_press_key",
      "browser_scroll_to", "browser_get_attribute", "browser_scan", "browser_snapshot",
      "browser_record", "browser_replay",
      "notification_history", "workflow_history", "workflow_generate", "workflow_export", "workflow_import",
    ]);
    const funcCallPattern = /([a-z_][a-z0-9_]*)\s*\(\s*([^)]+)\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = funcCallPattern.exec(content)) !== null) {
      const name = match[1];
      const argsStr = match[2];
      // Whitelist: only match known tool names to avoid false positives
      if (!KNOWN_TOOL_NAMES.has(name)) continue;
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
          fixed = this.smartQuoteFix(fixed);                      // 智能修复单引号
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

  /**
   * 智能修复单引号：只修复 JSON 边界符的单引号，不修复字符串内的单引号
   * 修复问题3: 避免 {"code": "console.log('hello')"} 被错误修复
   */
  private smartQuoteFix(str: string): string {
    let result = '';
    let inString = false;
    let stringChar = '';
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const prevChar = i > 0 ? str[i - 1] : '';
      
      if (!inString) {
        // 不在字符串内：单引号作为 JSON 边界符，替换为双引号
        if (char === "'" || char === '"') {
          inString = true;
          stringChar = char;
          result += '"';
        } else {
          result += char;
        }
      } else {
        // 在字符串内
        if (char === stringChar && prevChar !== '\\') {
          inString = false;
          stringChar = '';
          result += '"';
        } else if (char === '"' && stringChar === "'") {
          result += '\\"';  // 转义内部双引号
        } else {
          result += char;
        }
      }
    }
    
    return result;
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

    // ═══ 前置防护: 如果请求中没有任何真实 user 消息, 注入兜底请求 ═══
    // 原因: agentai-loop 的多条消息构建路径 (超时降级/L4 rescue/history-compress)
    //       可能在 sanitizeToolMessages 或 consolidateSystemInjections 后丢失 user 消息,
    //       导致 agnes 返回 "No user query found" (400), zhipu 返回 1214 "messages 参数非法"
    const userMsgCount = req.messages.filter(m => m.role === 'user').length;
    if (userMsgCount === 0) {
      console.warn(`[guard] executeProvider: req.messages has 0 user msgs (total=${req.messages.length}), injecting fallback`);
      req = { ...req, messages: [...req.messages, { role: 'user', content: '请继续完成之前的任务。' }] };
    }

    // ===== Phase 2: 模型性能指标收集（零侵入）=====
    // 初始化指标收集上下文，失败不影响主流程
    let metricsContext: any = null;
    let modelNameForMetrics = subModel || id;
    try {
      // 延迟初始化，避免循环依赖问题
      const { modelMetrics } = await import('./model-metrics-service.js');
      metricsContext = modelMetrics.startCall(modelNameForMetrics, id, (req as any).sessionId);
    } catch (e) {
      // 静默失败，绝不阻塞主流程
      console.error('[metrics] init error:', e);
    }
    // 辅助函数：在返回前记录指标
    const recordMetrics = (result: any, success: boolean = true) => {
      try {
        if (metricsContext && typeof metricsContext.finish === 'function') {
          const usage = result?.usage || {};
          metricsContext.finish({
            inputTokens: usage.prompt_tokens || usage.inputTokens || 0,
            outputTokens: usage.completion_tokens || usage.outputTokens || 0,
            cost: usage.cost || 0,
            success,
            cacheHit: usage.cacheHit,
            errorType: success ? undefined : result?.error?.type || 'unknown',
          });
        }
      } catch (e) {
        console.error('[metrics] record error:', e);
      }
    };
    // ================================================
    
    // 真接 5 个内置 provider (OpenAI 兼容协议)
    // agentai: apihub.agnes-ai.com/v1/chat/completions (支持 tools / thinking / image_url)
    // deepseek: api.deepseek.com/v1/chat/completions
    // openai: api.openai.com/v1/chat/completions
    // zhipu: open.bigmodel.cn/api/paas/v4 (GLM-4.7-Flash 免费)
    // Provider 配置 (默认值可通过 .env 环境变量覆盖)
    const PROVIDER_DEFAULTS: Record<string, { keyEnv: string; baseEnv: string; defaultBase: string; modelEnv: string; defaultModel: string }> = {
      // Agnes AI (agnes-2.5-flash 首选, agnes-2.0 备用)
      agnes: { keyEnv: 'AGENTAI_API_KEY', baseEnv: 'AGENTAI_BASE_URL', defaultBase: 'https://api.agnes-ai.cn/v1', modelEnv: 'AGENTAI_MODEL', defaultModel: 'agnes-2.5-flash' },
      // 兼容旧版 agentai provider
      agentai: { keyEnv: 'AGENTAI_API_KEY', baseEnv: 'AGENTAI_BASE_URL', defaultBase: 'https://api.agnes-ai.cn/v1', modelEnv: 'AGENTAI_MODEL', defaultModel: 'agnes-2.5-flash' },
      deepseek: { keyEnv: 'DEEPSEEK_API_KEY', baseEnv: 'DEEPSEEK_BASE_URL', defaultBase: 'https://api.deepseek.com/v1', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-v4-flash' },
      openai:   { keyEnv: 'OPENAI_API_KEY',   baseEnv: 'OPENAI_BASE_URL',   defaultBase: 'https://api.openai.com/v1',  modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini' },
      zhipu:   { keyEnv: 'ZHIPU_API_KEY',   baseEnv: 'ZHIPU_BASE_URL',   defaultBase: 'https://open.bigmodel.cn/api/paas/v4', modelEnv: 'ZHIPU_MODEL', defaultModel: 'glm-4.7-flash' },
      superapi: { keyEnv: 'SUPERAPI_API_KEY', baseEnv: 'SUPERAPI_BASE_URL', defaultBase: 'https://superapi.vanguard.dpdns.org/v1', modelEnv: 'SUPERAPI_MODEL', defaultModel: 'deepseek-v4-flash' },
      dxnt: { keyEnv: 'DXNT_API_KEY', baseEnv: 'DXNT_BASE_URL', defaultBase: 'https://www.dxnt.com', modelEnv: 'DXNT_MODEL', defaultModel: 'dxnt.com/free' },
      sensenova: { keyEnv: 'SENSENOVA_API_KEY', baseEnv: 'SENSENOVA_BASE_URL', defaultBase: 'https://token.sensenova.cn/v1', modelEnv: 'SENSENOVA_MODEL', defaultModel: 'sensenova-6.7-flash-lite' },
      longcat: { keyEnv: 'LONGCAT_API_KEY', baseEnv: 'LONGCAT_BASE_URL', defaultBase: 'https://api.longcat.chat/openai', modelEnv: 'LONGCAT_MODEL', defaultModel: 'LongCat-2.0' },
      // nvidia provider config 已移除
      // 新增: 传统独立商业模型 — 统一映射, 避免降级到自定义路径
      qwen:     { keyEnv: 'DASHSCOPE_API_KEY',  baseEnv: 'DASHSCOPE_BASE_URL',  defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelEnv: 'QWEN_MODEL',     defaultModel: 'qwen-max' },
      moonshot: { keyEnv: 'MOONSHOT_API_KEY',   baseEnv: 'MOONSHOT_BASE_URL',   defaultBase: 'https://api.moonshot.cn/v1',                         modelEnv: 'MOONSHOT_MODEL', defaultModel: 'kimi-k2.5' },
      anthropic:{ keyEnv: 'ANTHROPIC_API_KEY',  baseEnv: 'ANTHROPIC_BASE_URL',  defaultBase: 'https://api.anthropic.com/v1',                       modelEnv: 'ANTHROPIC_MODEL',defaultModel: 'claude-sonnet-4-5-20250929' },
      minimax:  { keyEnv: 'MINIMAX_API_KEY',    baseEnv: 'MINIMAX_BASE_URL',    defaultBase: 'https://api.minimax.chat/v1',                        modelEnv: 'MINIMAX_MODEL',  defaultModel: 'MiniMax-M3' },
      doubao:   { keyEnv: 'VOLCANO_API_KEY',    baseEnv: 'VOLCANO_BASE_URL',    defaultBase: 'https://ark.cn-beijing.volces.com/api/v3',           modelEnv: 'DOUBAO_MODEL',   defaultModel: 'doubao-seed-2.0-pro-250728' },
    };
    const envKeyMap = PROVIDER_DEFAULTS;

    const defaultCtx = getDefaultContextWindow(id);

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
        const userText = (typeof lastMsg?.content === 'string' ? lastMsg.content : (lastMsg?.content != null ? JSON.stringify(lastMsg.content) : '')).slice(0, 200);
        return {
          content: `[${id} no-config] 自定义模型未配置完整。\n需要: ${keyEnv} 和 baseURL。\n\n你的消息: "${userText}"`,
          model: id,
          finishReason: 'stop',
          noKey: true,
        };
      }
    } else {
      apiKey = process.env[cfg.keyEnv];
      // 🔧 清洗 API Key: 去除首尾空白、逗号、分号、引号等污染字符
      if (apiKey) {
        apiKey = apiKey.trim().replace(/^[,;\s"'`]+|[,;\s"'`]+$/g, '');
      }
      // 智能 Base URL: 自动检测用户是否填了完整路径(含 /chat/completions)
      let rawUrl = process.env[cfg.baseEnv] || cfg.defaultBase;
      // 🔧 清洗 URL: 去除首尾空白、逗号、分号、引号等污染字符 (用户从配置文件复制时常带这些)
      rawUrl = rawUrl.trim().replace(/^[,;\s"'`]+|[,;\s"'`]+$/g, '').replace(/\/+$/, '');
      // 🔧 智能补全: agnes/agentai 域名缺少 /v1 时自动补全 (用户常漏写)
      if ((id === 'agnes' || id === 'agentai') && rawUrl === 'https://api.agnes-ai.cn') {
        rawUrl = 'https://api.agnes-ai.cn/v1';
        console.log(`[router] 🔧 ${id} Base URL 自动补全 /v1: ${rawUrl}`);
      }
      // 如果用户填了完整路径 /chat/completions，直接使用，不再拼接
      if (rawUrl.includes('/chat/completions')) {
        baseUrl = rawUrl;
        console.log(`[router] ⚠️ ${id} Base URL 包含完整路径，已直接使用: ${rawUrl}`);
      } else {
        baseUrl = rawUrl;
      }
      modelName = subModel || process.env[cfg.modelEnv] || cfg.defaultModel;
      
      // 调试日志：显示配置详情（隐藏密钥）
if (id === 'sensenova') {
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
      const userText = (typeof lastMsg?.content === 'string' ? lastMsg.content : (lastMsg?.content != null ? JSON.stringify(lastMsg.content) : '')).slice(0, 200);
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
    // ✅ 单源读取: model-capabilities.ts 优先, fallback 到 provider 默认, 再 fallback 到 req 自定义
    const ctxWindow = Math.max(4096,
      req.contextWindow                          // ① 最高: 用户手动填的"上下文扩展"值
        || getModelContextWindow(modelName)     // ② model 名精确匹配 (agnes-2.5-flash → 512K, agnes-2.0 → 256K)
        || defaultCtx                           // ③ provider 级默认 (agnes → 512K)
    );
    const maxInputTokens = Math.floor(ctxWindow * 0.85); // 留15%给输出
    let truncatedMessages = req.messages;
    // 定义 systemMsgs 在块外，供后续日志使用
    const systemMsgs: ChatMessage[] = [];
    const otherMsgs: ChatMessage[] = [];
    {
      // 粗略估算: 1个中文字≈1.5token, 1个英文词≈1token
      let totalEst = 0;
      // otherMsgs 已在块外定义，这里清空使用
      otherMsgs.length = 0;
      for (const m of req.messages) {
        if (m.role === 'system') { systemMsgs.push(m); continue; }
        otherMsgs.push(m);
      }
      // ═══ 2026-08-03: system 消息预算上限 = 80K tokens ═══
      // 原因: buildImmutablePrefix 拼接 30+ 个 system 块 (工具描述+规则+记忆+项目文档),
      //       容易吃光 token 预算, 导致对话历史的 user 消息被截断 → API 返回 "No user query found"
      // 策略: 从旧到新裁剪 system 消息, 保留最近追加的 (演化规则/最新记忆)
      const SYSTEM_BUDGET = 80_000; // system 消息最多 80K tokens
      let sysTotal = 0;
      const trimmedSystem: ChatMessage[] = [];
      for (const m of systemMsgs) {
        const est = Math.ceil((typeof m.content === 'string' ? m.content : '').length * 0.7);
        if (sysTotal + est > SYSTEM_BUDGET && trimmedSystem.length > 0) {
          console.warn(`[truncate] system budget ${sysTotal} > ${SYSTEM_BUDGET}, dropping ${trimmedSystem.length} system msgs`);
          break;
        }
        sysTotal += est;
        trimmedSystem.push(m);
      }
      systemMsgs.length = 0;
      systemMsgs.push(...trimmedSystem);
      totalEst = sysTotal;
      // 从最新消息往前保留, 直到超限
      // ═══ 关键修复: 必须确保至少保留一条 user 消息, 否则 API 返回 "No user query found" ═══
      const kept: ChatMessage[] = [];
      const dropped: ChatMessage[] = [];
      let hasUserMsg = false;
      for (let i = otherMsgs.length - 1; i >= 0; i--) {
        const est = Math.ceil((typeof otherMsgs[i].content === 'string' ? otherMsgs[i].content : '').length * 0.7);
        // 条件: 超出 token 限制 && 已保留至少2条消息 && (已有user消息 || 当前是最后一条消息)
        const canDrop = totalEst + est > maxInputTokens && kept.length > 2 && (hasUserMsg || i === 0);
        if (canDrop) {
          // 收集被丢弃的旧消息，后续生成摘要注入
          for (let j = i; j >= 0; j--) dropped.push(otherMsgs[j]);
          break;
        }
        totalEst += est;
        kept.unshift(otherMsgs[i]);
        if (otherMsgs[i].role === 'user') hasUserMsg = true;
      }
      // ═══ 2026-08-03: 丢弃的消息生成结构化摘要, 避免 AI 丢失历史上下文 ═══
      if (dropped.length > 0) {
        const userReqs: string[] = [];
        const aiActions: string[] = [];
        const filesModified = new Set<string>();
        const errorsHit: string[] = [];
        for (const m of dropped.reverse()) {
          const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
          if (m.role === 'user') {
            userReqs.push(text.slice(0, 120));
          } else if (m.role === 'assistant') {
            const brief = text.slice(0, 80).replace(/\n+/g, ' ').trim();
            if (brief) aiActions.push(brief);
          } else if (m.role === 'tool') {
            const toolName = (m as any).name || 'tool';
            if (text.startsWith('[ERROR]')) errorsHit.push(`${toolName}: ${text.slice(8, 60)}`);
            const pathMatch = text.match(/(?:file_path|path)['":\s]*([^\s'")\],]+\.\w{1,5})/);
            if (pathMatch?.[1]) filesModified.add(pathMatch[1]);
          }
        }
        const summaryParts: string[] = [];
        if (userReqs.length > 0) summaryParts.push(`用户请求: ${userReqs.join(' | ')}`);
        if (filesModified.size > 0) summaryParts.push(`修改文件: ${[...filesModified].join(', ')}`);
        if (errorsHit.length > 0) summaryParts.push(`历史错误: ${errorsHit.slice(-3).join('; ')}`);
        const summaryText = summaryParts.join('\n') || `旧对话 (${dropped.length} 条消息已压缩)`;
        const summaryMsg: ChatMessage = { role: 'system', content: `[历史摘要 · ${dropped.length} 条旧消息] ${summaryText}` };
        truncatedMessages = [summaryMsg, ...systemMsgs, ...kept];
        console.log(`[truncate] dropped ${dropped.length} msgs → injected summary, kept ${kept.length}, sys=${systemMsgs.length}`);
      } else {
        truncatedMessages = [...systemMsgs, ...kept];
      }

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
            fixed.splice(lastAssistantIdx, 1); // 删除上个 assistant 及其之后的空内容
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
            fixed.splice(lastAssistantIdx, 1);
            lastAssistantIdx = -1;
            matchedSet.clear();
          }
          fixed.push(m);
        }
      }
      // 末尾检查: 最后一个 assistant(tool_calls) 如果没有收到任何 tool 回复 → 删除
      if (lastAssistantIdx >= 0 && matchedSet.size === 0) {
        console.warn(`[truncate] removed trailing assistant(tool_calls) with no tool results (idx=${lastAssistantIdx})`);
        fixed.splice(lastAssistantIdx, 1);
      }
      truncatedMessages = fixed;

      // ═══ 终极防护: 确保 truncatedMessages 中至少有一条真实的 user 消息 ═══
      // 场景: 当所有已丢弃的消息包含 user 消息, 而 kept 中没有真实 user 消息时,
      //       历史摘要以 role='system' 注入, 导致 API 返回 "No user query found" (400)
      //       zhipu GLM 同样会返回 "messages 参数非法" (1214)
      //       修复: 如果没有真实 user 消息, 注入一个最小兜底 user 请求
      const realUserMsgs = truncatedMessages.filter(m => m.role === 'user');
      if (realUserMsgs.length === 0) {
        // 尝试从 dropped 中恢复用户请求摘要作为 user 消息
        const lastUserReq = dropped.find(m => m.role === 'user');
        const fallbackContent = lastUserReq
          ? `[历史用户请求] ${typeof lastUserReq.content === 'string' ? lastUserReq.content.slice(0, 200) : JSON.stringify(lastUserReq.content).slice(0, 200)}`
          : '请继续完成之前的任务。';
        truncatedMessages.push({ role: 'user', content: fallbackContent });
        console.warn(`[truncate] 防护: truncatedMessages 无 user 消息, 已注入兜底请求`);
      }
    }

    // ═══ DeepSeek 判定 (提前, 用于 bodyObj 中的 reasoning_content 保留决策) ═══
    const isDeepSeekModel = modelName?.includes('deepseek') || modelName?.includes('ds-') || id === 'deepseek';
    // 预检测: 避免第一轮请求中 _hasReasoningSupport 为 false 导致 reasoning_content 被删
    if (isDeepSeekModel && !this._hasReasoningSupport.get(id)) {
      this._hasReasoningSupport.set(id, true);
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
        // ═══ DeepSeek reasoning_content 必须保留: 有工具调用的轮次没有它 API 返回 400 ═══
        // 无条件保留 reasoning_content, 由各 provider 自己决定是否忽略
        if ((m as any).reasoning_content !== undefined) {
          msg.reasoning_content = (m as any).reasoning_content;
        }
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

    const hasToolRequest = req.tools && req.tools.length > 0;
    // ═══ DeepSeek V4: 思考模式 + 工具调用的正确参数 ═══
    // DeepSeek 从 V3.2 开始支持 thinking 模式下调用工具
    // 必须同时发送 extra_body.thinking.type + reasoning_effort，缺一不可
    // 文档: https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    if (isDeepSeekModel) {
      // 根据是否有工具请求 + req.thinking 标志来决定 thinking 策略
      if (hasToolRequest && req.thinking) {
        // 有工具 + 启用了 thinking → 同时发 thinking=enabled + reasoning_effort
        // DeepSeek V4 Flash/Pro 均支持在 thinking 模式下输出 tool_calls
        bodyObj.extra_body = { thinking: { type: 'enabled' } };
        bodyObj.reasoning_effort = modelName?.includes('pro') ? 'high' : 'medium';
      } else if (hasToolRequest && !req.thinking) {
        // 有工具但未启用 thinking → 非思考模式的 tool calling
        // 按官方文档: model 使用 deepseek-v4-flash (非思考模式) 或 deepseek-v4-pro
        bodyObj.extra_body = { thinking: { type: 'disabled' } };
        bodyObj.reasoning_effort = 'low';  // 最低推理努力度，等同于非思考模式
      } else if (req.thinking) {
        // 无工具 + 纯思考模式
        bodyObj.extra_body = { thinking: { type: 'enabled' } };
        bodyObj.reasoning_effort = modelName?.includes('pro') ? 'max' : 'high';
      }
    }

    // Thinking 模式 — 根据 provider/模型自动选择思考机制
    // ═══ 不再写死 if(id==='agentai'), 用子模型名自动判断 ═══
    if (req.thinking && !isDeepSeekModel) {
if (id === 'agentai') {
        // Agnes AI: chat_template_kwargs.enable_thinking
        bodyObj.chat_template_kwargs = { enable_thinking: true };
        if (req.thinkingBudget && req.thinkingBudget > 0) {
          (bodyObj.chat_template_kwargs as any).thinking_budget = req.thinkingBudget;
        }
      } else if (id === 'sensenova') {
        // ═══ 商汤 SenseNova 适配 ═══
        // SenseNova 原生模型 (sensenova-6.7-flash-lite, sensenova-u1-fast): 不支持 thinking 参数
        // SenseNova 代理的 DeepSeek V4 Flash: 由上面统一逻辑处理
        if (modelName?.includes('deepseek') || modelName?.includes('ds-')) {
          bodyObj.extra_body = { thinking: { type: 'enabled' } };
          bodyObj.reasoning_effort = modelName?.includes('pro') ? 'high' : 'medium';
        }
      } else if (id === 'longcat') {
        // 美团 LongCat: 不支持 thinking 参数, 跳过
      } else if (modelName?.includes('glm') || id === 'zhipu') {
        // ═══ 智谱 GLM thinking 适配 ═══
        // 智谱不支持 { type: 'enabled' } 格式
        // glm-4.7-flash 不支持 thinking 参数, 降级时不要带 thinking
        // 由 flow 报错后自动标记为不支持 thinking
      }
    }

    // eslint-disable-next-line no-useless-catch -- try/catch 是方法级兜底, 错误抛给 tryOne 触发降级
    try {
      // 强制清理 baseUrl 末尾逗号/分号 (用户从配置复制时常带这些)
      baseUrl = baseUrl.replace(/[,\;]+$/, '').replace(/\s+$/, '');
      const fetchUrl = baseUrl.includes('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
      console.log(`[router] executeProvider: id=${id}, model=${modelName}, baseUrl=${baseUrl}, url=${fetchUrl}, hasKey=${!!apiKey}, msgs=${truncatedMessages.length}(user=${truncatedMessages.filter(m=>m.role==='user').length},asst=${truncatedMessages.filter(m=>m.role==='assistant').length},tool=${truncatedMessages.filter(m=>m.role==='tool').length})`);
      const flakyTimeout = AgentAIRouter.FLAKY_PROVIDERS.has(id)
        ? AgentAIRouter.FLAKY_TIMEOUT_MS
        : 300_000;
      const r = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Accept-Encoding': 'identity', // SSE 禁用压缩: 避免客户端缓冲解压导致延迟
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(bodyObj),
        signal: req.abortSignal
          ? AbortSignal.any([AbortSignal.timeout(flakyTimeout), req.abortSignal])
          : AbortSignal.timeout(flakyTimeout), // 不稳定提供者 15s, 其他人 5 分钟
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
// 针对商汤的详细错误日志
if (id === 'sensenova') {
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
          reasoningContent: fullThinking || undefined,
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
        reasoningContent: choice?.message?.reasoning_content || undefined,
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
      // eslint-disable-next-line no-useless-catch
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
      if (AgentAIRouter.FLAKY_PROVIDERS.has(p.id)) {
        // 不稳定提供者: 超时即熔断 (避免串行轮询每个模型等 5 分钟)
        p.tripped = true;
        p.trippedAt = Date.now();
        p.failureCount = Math.max(0, p.failureCount - 1);
        console.warn(`[router] ${p.id} flaky provider timeout — tripped immediately: ${_err.message?.slice(0, 80)}`);
        this.emit('circuit:tripped', { provider: p.id });
        return;
      }
      // 稳定提供者: 超时不算模型故障
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

// 单例实例
let agentAIRouterInstance: AgentAIRouter | null = null;

/**
 * 获取AgentAIRouter单例
 */
export function getAgentAIRouter(): AgentAIRouter {
  if (!agentAIRouterInstance) {
    agentAIRouterInstance = new AgentAIRouter();
  }
  return agentAIRouterInstance;
}
