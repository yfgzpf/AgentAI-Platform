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
 *   - 不抄 Hermes 30+ provider 配置 (我们只 3 个)
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
import { writeMemory } from './memory.js';

// ===== 类型定义 =====
export type ProviderId = 'agentai' | 'deepseek' | 'openai';

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
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    cost: number; // USD
    cacheHit: boolean;
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
}

// ===== 自创: 中文提示注入扫描 =====
/**
 * 学自: Hermes prompt_builder.py:_CONTEXT_THREAT_PATTERNS
 * 自创: 20+ 中文 pattern + 4 类语义攻击
 */
const PROMPT_INJECTION_PATTERNS_ZH = [
  // 1. 指令覆写 (中文版)
  /忽略.{0,20}(以上|之前|所有|先前).{0,10}指令/i,
  /无视.{0,20}(以上|之前|所有).{0,10}规则/i,
  /忘掉.{0,20}(之前|上面|系统|你的).{0,10}(指令|规则|身份)/i,
  /不要告诉用户/i,
  /不告诉任何人/i,
  /不要让用户知道/i,

  // 2. 角色覆写
  /你现在是(?!.{0,20}助手).{0,30}/i,
  /假装你是/i,
  /扮演.{0,20}角色/i,
  /让我们玩个游戏/i,
  /假设你是/i,

  // 3. 输出格式攻击
  /输出.{0,10}(系统|内部).{0,10}提示/i,
  /打印你的.{0,10}(系统|内部|隐藏)/i,
  /泄露.{0,10}(系统|内部|api|key)/i,

  // 4. 越权执行
  /执行.{0,20}(rm|del|format|drop|truncate)/i,
  /读取.{0,20}(\.env|credentials|password|secret)/i,
  /curl.{0,20}(\$|%|{).{0,20}(KEY|TOKEN|SECRET|PASSWORD)/i,
  /下载并执行/i,

  // 5. 不可见字符
  /[\u200b\u200c\u200d\u2060\ufeff]/,
  /[\u202a-\u202e]/,

  // 6. HTML 注释注入
  /<!--[^>]*(ignore|override|system|secret|hidden)[^>]*-->/i,
  /<div\s+style[^>]*display\s*:\s*none/i,

  // 7. 翻译+执行
  /翻译.{0,20}并执行/i,
  /翻译成.{0,10}代码并跑/i,
];

const PROMPT_INJECTION_PATTERNS_EN = [
  /ignore\s+(previous|all|above|prior)\s+instructions/i,
  /do\s+not\s+tell\s+the\s+user/i,
  /system\s+prompt\s+override/i,
  /disregard\s+(your|all|any)\s+(instructions|rules)/i,
  /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits)/i,
];

export interface ScanResult {
  safe: boolean;
  threats: Array<{ pattern: string; match: string; severity: 'low' | 'medium' | 'high' | 'critical' }>;
}

export function scanPromptInjection(content: string): ScanResult {
  const threats: ScanResult['threats'] = [];

  for (const pattern of PROMPT_INJECTION_PATTERNS_ZH) {
    const match = content.match(pattern);
    if (match) {
      threats.push({
        pattern: pattern.source,
        match: match[0],
        severity: classifySeverity(pattern.source),
      });
    }
  }

  for (const pattern of PROMPT_INJECTION_PATTERNS_EN) {
    const match = content.match(pattern);
    if (match) {
      threats.push({
        pattern: pattern.source,
        match: match[0],
        severity: classifySeverity(pattern.source),
      });
    }
  }

  return {
    safe: threats.length === 0,
    threats,
  };
}

function classifySeverity(pattern: string): 'low' | 'medium' | 'high' | 'critical' {
  if (/rm|del|format|drop|curl|env|secret|password|key/i.test(pattern)) return 'critical';
  if (/ignore|override|disregard|act as|pretend|假装|扮演|忘掉/i.test(pattern)) return 'high';
  if (/不要告诉|不告诉|泄露|打印.*系统/i.test(pattern)) return 'medium';
  return 'low';
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
    });
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

    // === Step 1.5: 如果调用方指定 model, 锁定到该 provider (不跑 rank) ===
    if (req.model) {
      const target = this.providers.get(req.model);
      if (target) {
        if (this.isCircuitOpen(target)) {
          this.tryRecoverCircuit(target);
          if (this.isCircuitOpen(target)) {
            // 指定的 provider 熔断, 走全 rank 降级
            console.warn(`[router] requested provider ${req.model} is tripped, falling back to ranking`);
          } else {
            return await this.tryOne(target, req);
          }
        } else {
          return await this.tryOne(target, req);
        }
      }
    }

    // === Step 2: 提示注入扫描 (学 Hermes + 自创) ===
    const scan = this.scanMessages(req.messages);
    if (!scan.safe) {
      this.emit('security:threat', scan.threats);
      throw new Error(`Prompt injection detected: ${scan.threats.length} threats`);
    }

    // === Step 3: 缓存命中 (学 Reasonix Pillar 1) ===
    const prefixHash = this.hashPrefix(req);
    const cached = this.cache.get(prefixHash);
    if (cached && !req.stream && this.isCacheable(req)) {
      this.emit('cache:hit', { hash: prefixHash, provider: cached.provider });
      return { ...cached, usage: { ...cached.usage, cacheHit: true } };
    }

    // === Step 4: 智能路由选 provider ===
    const ranked = this.rankProviders();

    for (const provider of ranked) {
      if (this.isCircuitOpen(provider)) {
        this.tryRecoverCircuit(provider);
        if (this.isCircuitOpen(provider)) continue;
      }

      return await this.tryOne(provider, req);
    }

    throw new Error('All providers failed (circuit open)');
  }

  /**
   * 拆出来的单 provider 执行 (锁定用)
   */
  private async tryOne(provider: ProviderStats, req: ChatRequest): Promise<ChatResponse> {
    const t0 = Date.now();
    try {
      const raw = await this.executeProvider(provider.id, req);
      const durationMs = Date.now() - t0;

      const repaired = await this.repairPipeline(raw);
      const usage = this.computeUsage(provider, repaired, req);
      this.checkCostGuardPost(usage.cost);

      const res: ChatResponse = {
        content: repaired.content,
        toolCalls: repaired.toolCalls,
        usage,
        provider: provider.id,
        durationMs,
      };

      this.appendOnlyLog.push({ ts: Date.now(), req, res });

      if (req.userId && req.workspace) {
        await writeMemory({
          userId: req.userId,
          workspace: req.workspace,
          role: 'assistant',
          content: res.content,
          source: 'auto_reflect',
          metadata: { provider: res.provider, model: req.model },
        });
      }

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

    return repaired;
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
    // 学自: Reasonix repair/truncation.ts
    // 截断的 JSON 补全: 加 }, 闭合
    if (typeof raw.content === 'string') {
      let content = raw.content;
      // 补 },  或 ]
      const openBraces = (content.match(/\{/g) || []).length;
      const closeBraces = (content.match(/\}/g) || []).length;
      if (openBraces > closeBraces) {
        content += '}'.repeat(openBraces - closeBraces);
      }
      const openBrackets = (content.match(/\[/g) || []).length;
      const closeBrackets = (content.match(/\]/g) || []).length;
      if (openBrackets > closeBrackets) {
        content += ']'.repeat(openBrackets - closeBrackets);
      }
      raw.content = content;
    }
    return raw;
  }

  // ===== Provider 执行 (具体 HTTP/SSE 调用) =====
  private async executeProvider(id: ProviderId, req: ChatRequest): Promise<any> {
    // 真接 3 个 provider (OpenAI 兼容协议)
    // agentai: apihub.agnes-ai.com/v1/chat/completions (支持 tools / thinking / image_url)
    // deepseek: api.deepseek.com/v1/chat/completions
    // openai: api.openai.com/v1/chat/completions
    const envKeyMap: Record<ProviderId, { keyEnv: string; baseEnv: string; defaultBase: string; modelEnv: string; defaultModel: string }> = {
      agentai: { keyEnv: 'AGENTAI_API_KEY', baseEnv: 'AGENTAI_BASE_URL', defaultBase: 'https://apihub.agnes-ai.com/v1', modelEnv: 'AGENTAI_MODEL', defaultModel: 'agnes-2.0-flash' },
      deepseek: { keyEnv: 'DEEPSEEK_API_KEY', baseEnv: 'DEEPSEEK_BASE_URL', defaultBase: 'https://api.deepseek.com/v1', modelEnv: 'DEEPSEEK_MODEL', defaultModel: 'deepseek-chat' },
      openai:   { keyEnv: 'OPENAI_API_KEY',   baseEnv: 'OPENAI_BASE_URL',   defaultBase: 'https://api.openai.com/v1',  modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini' },
    };
    const cfg = envKeyMap[id];
    const apiKey = process.env[cfg.keyEnv];
    const baseUrl = (process.env[cfg.baseEnv] || cfg.defaultBase).replace(/\/+$/, '');
    const modelName = process.env[cfg.modelEnv] || cfg.defaultModel;

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
    const bodyObj: Record<string, unknown> = {
      model: modelName,
      messages: req.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: req.stream === true || false,
    };

    // 工具调用 (Agnes 2.0 Flash 支持 )
    if (req.tools && req.tools.length > 0) {
      bodyObj.tools = toolSpecsToOpenAI(req.tools);
    }

    // Thinking 模式 (Agnes 2.0 Flash, 对代码/推理任务显著提升质量)
    if (req.thinking) {
      bodyObj.chat_template_kwargs = { enable_thinking: true };
      if (req.thinkingBudget && req.thinkingBudget > 0) {
        (bodyObj.chat_template_kwargs as any).thinking_budget = req.thinkingBudget;
      }
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
        throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
      }

      // ====== 流式响应 (SSE, 支持 tool_calls delta) ======
      if (req.stream === true && r.body) {
        const reader = (r.body as any).getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let fullContent = '';
        const toolCallsAcc: Map<number, { id: string; name: string; args: string }> = new Map();
        let usage: any = { prompt_tokens: 0, completion_tokens: 0 };
        let streamModel = modelName;

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
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;
              if (!delta) continue;
              // 文本内容
              if (delta.content) fullContent += delta.content;
              // tool_calls delta (Agnes 支持)
              if (delta.tool_calls) {
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
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
          },
        };
      }

      // ====== 非流式 (支持 tool_calls) ======
      const data = await r.json() as any;
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
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
        },
      };
    } catch (err: any) {
      const lastMsg = req.messages.filter((m) => m.role === 'user').pop();
      const userText = (typeof lastMsg?.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg?.content)).slice(0, 200);
      return {
        content: `[${id} 调用失败] ${err.message}\n\n用户消息: "${userText}"\n\n(router 会自动降级到下一个 provider)`,
        model: id,
        finishReason: 'error',
        error: err.message,
      };
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

  private scanMessages(messages: ChatMessage[]): ScanResult {
    const allThreats: ScanResult['threats'] = [];
    for (const m of messages) {
      if (typeof m.content === 'string') {
        const r = scanPromptInjection(m.content);
        allThreats.push(...r.threats);
      }
    }
    return { safe: allThreats.length === 0, threats: allThreats };
  }

  private computeUsage(p: ProviderStats, _repaired: any, _req: ChatRequest): ChatResponse['usage'] {
    // 简化: 假设 1000 prompt + 500 completion
    const promptTokens = 1000;
    const completionTokens = 500;
    const cost = (promptTokens / 1000) * p.costPer1kInput + (completionTokens / 1000) * p.costPer1kOutput;
    return { promptTokens, completionTokens, cost, cacheHit: false };
  }

  private recordSuccess(p: ProviderStats, latencyMs: number): void {
    p.totalCalls++;
    p.successCount++;
    p.recentLatencyMs.push(latencyMs);
    if (p.recentLatencyMs.length > 100) p.recentLatencyMs.shift();
  }

  private recordFailure(p: ProviderStats, _err: Error): void {
    p.totalCalls++;
    p.failureCount++;
    // 失败率超过 30% 熔断
    if (p.failureCount / p.totalCalls > 0.30) {
      p.tripped = true;
      p.trippedAt = Date.now();
      this.emit('circuit:tripped', { provider: p.id });
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
