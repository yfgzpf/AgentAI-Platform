/**
 * Hermes Framework Adapter (爱马仕适配器)
 * ----------------------------------------------------
 * 把 Hermes 的核心概念封装到统一 FrameworkAdapter 接口里
 *
 * 学自 (从 references/hermes/agent/ 摘):
 *   - prompt_builder.py: 4 段式 (ROLE/ENV/CONTEXT/TASK) 系统提示
 *   - prompt_builder.py: 中文注入扫描正则 (10+ pattern)
 *   - hermes_agent.py: AIAgent + 工具分发
 *
 * 不照搬:
 *   - 不抄 30+ provider 路由 (我们用统一 LLM Router)
 *   - 不抄 FTS5 完整实现 (memory.ts 简化版)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 5.3 节
 */

import type {
  FrameworkAdapter,
  FrameworkContext,
  FrameworkCapabilities,
} from './types.js';
import type { ChatMessage, ChatResponse } from '../llm-router.js';
import { AgentAIRouter } from '../llm-router.js';

/** 共享 router 实例 (单例) */
const router = new AgentAIRouter();

/**
 * 4 段式系统提示 (学 Hermes prompt_builder.py 第 30-80 行)
 *
 * Hermes 的特点: 严格分离 ROLE / ENV / CONTEXT / TASK 4 段,
 * 让模型更容易"角色代入"。
 */
function buildHermesSystemPrompt(ctx: FrameworkContext): string {
  const toolList = (ctx.tools ?? [])
    .slice(0, 12)
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `# [ROLE]
你是 Hermes 智能体, 一个有强表达力的中文 AI 助手。
你的风格: 直接、简洁、有立场。不堆砌客套话。
你的能力: 调用工具、读记忆、按指令执行。

# [ENV]
- 用户: ${ctx.userId}
- 工作空间: ${ctx.workspace}
- 当前时间: ${new Date().toISOString()}
- 框架: Hermes (爱马仕)

# [CONTEXT]
${toolList ? `可用工具 (${(ctx.tools ?? []).length} 个):\n${toolList}` : '暂无可用工具'}

# [TASK]
完成用户的对话请求。
- 如果需要工具, 请明确指出要调用哪个
- 如果不确定, 诚实说明
- 始终使用中文回复, 除非用户用其他语言
`.trim();
}

/**
 * Hermes 风格中文注入扫描 (学 prompt_builder.py 第 95-130 行)
 *
 * Hermes 有 10+ 注入正则, 我们聚焦最常见的 8 个中文 pattern。
 */
const HERMES_INJECTION_PATTERNS: RegExp[] = [
  /忽略.{0,20}(之前|以上|前面|先前).{0,10}(指令|规则|设定|约束)/i,
  /你.{0,5}(现在|从此刻起|今后).{0,10}(是|变成|成为)/i,
  /system\s*prompt/i,
  /system\s*消息/i,
  /开发者.{0,5}模式/i,
  /DAN\s*模式/i,
  /jailbreak/i,
  /越狱/i,
  /无限制.{0,10}模式/i,
  /扮演.{0,10}(黑客|管理员|root)/i,
];

function hermesInjectionScan(text: string): { clean: boolean; reason?: string } {
  for (const p of HERMES_INJECTION_PATTERNS) {
    if (p.test(text)) {
      return { clean: false, reason: `检测到注入 pattern: ${p.source.slice(0, 30)}` };
    }
  }
  return { clean: true };
}

const HERMES_CAPABILITIES: FrameworkCapabilities = {
  parallelTools: false,        // Hermes 默认串行
  hotReloadSkills: true,        // 学 hermes_agent.py skill registry
  multiAgent: false,            // 我们单智能体, 不用 Hermes 多 agent
  fts5Session: true,            // Hermes 原生 FTS5
  chineseInjectionScan: true,   // Hermes 强项
  defaultProvider: 'agentai',
};

export class HermesAdapter implements FrameworkAdapter {
  readonly id = 'hermes' as const;
  readonly displayName = 'Hermes (爱马仕)';
  readonly version = '0.1.0-self-port';
  readonly capabilities = HERMES_CAPABILITIES;

  private systemPrompt = '';
  private _healthy = false;

  async init(ctx: FrameworkContext): Promise<void> {
    this.systemPrompt = buildHermesSystemPrompt(ctx);
    this._healthy = true;
    console.log(`[hermes] initialized for user=${ctx.userId} workspace=${ctx.workspace}`);
  }

  async chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse> {
    // 注入扫描 (Hermes 强项, 比 OpenClaw 严)
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const scan = hermesInjectionScan(lastUser.content);
      if (!scan.clean) {
        console.warn(`[hermes] injection blocked: ${scan.reason}`);
        return {
          content: `⚠️ 检测到潜在的提示注入, 已拦截 (Hermes 防御模式)。\n原因: ${scan.reason}`,
          usage: { promptTokens: 0, completionTokens: 0, cost: 0, cacheHit: false },
          provider: 'hermes-guard',
          durationMs: 5,
        };
      }
    }

    // 调底层 LLM Router (Hermes 不内置 LLM, 走统一 router)
    const startedAt = Date.now();
    const fullMessages: ChatMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...messages,
    ];

    const res = await router.chat({
      messages: fullMessages,
      model: this.capabilities.defaultProvider,
      maxTokens: 2048,
      temperature: 0.7,
    });
    res.durationMs = Date.now() - startedAt;
    return res;
  }

  async shutdown(): Promise<void> {
    this._healthy = false;
    console.log(`[hermes] shutdown`);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this._healthy
      ? { ok: true, detail: 'Hermes adapter ready' }
      : { ok: false, detail: 'Hermes adapter not initialized' };
  }
}
