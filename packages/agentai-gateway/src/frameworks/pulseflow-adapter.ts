/**
 * PulseFlow 框架适配器
 * ----------------------------------------------------
 * 强表达力中文助手配置: 4 段式系统提示 (ROLE/ENV/CONTEXT/TASK) + 中文注入扫描
 *
 * 与 agentai 适配器的差异定位:
 *   - 默认串行工具调用
 *   - 更严格的中文提示注入扫描 (10 类常见 pattern)
 *   - 不内置 LLM, 统一走 AgentAIRouter
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
 * 4 段式系统提示: 严格分离 ROLE / ENV / CONTEXT / TASK, 强化模型角色代入
 */
function buildPulseflowSystemPrompt(ctx: FrameworkContext): string {
  const toolList = (ctx.tools ?? [])
    .slice(0, 12)
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `# [ROLE]
你是 PulseFlow 智能体, 一个有强表达力的中文 AI 助手。
你的风格: 直接、简洁、有立场。不堆砌客套话。
你的能力: 调用工具、读记忆、按指令执行。

# [ENV]
- 用户: ${ctx.userId}
- 工作空间: ${ctx.workspace}
- 当前时间: ${new Date().toISOString()}
- 框架: PulseFlow

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
 * 中文注入扫描: 聚焦最常见的 10 个中文 pattern
 */
const PULSEFLOW_INJECTION_PATTERNS: RegExp[] = [
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

function pulseflowInjectionScan(text: string): { clean: boolean; reason?: string } {
  for (const p of PULSEFLOW_INJECTION_PATTERNS) {
    if (p.test(text)) {
      return { clean: false, reason: `检测到注入 pattern: ${p.source.slice(0, 30)}` };
    }
  }
  return { clean: true };
}

const PULSEFLOW_CAPABILITIES: FrameworkCapabilities = {
  parallelTools: false,        // 默认串行
  hotReloadSkills: true,
  multiAgent: false,
  fts5Session: true,
  chineseInjectionScan: true, // 强项: 中文注入扫描
  defaultProvider: 'agentai',
};

export class PulseflowAdapter implements FrameworkAdapter {
  readonly id = 'pulseflow' as const;
  readonly displayName = 'PulseFlow (脉冲流)';
  readonly version = '0.1.0-self';
  readonly capabilities = PULSEFLOW_CAPABILITIES;

  private systemPrompt = '';
  private _healthy = false;

  async init(ctx: FrameworkContext): Promise<void> {
    this.systemPrompt = buildPulseflowSystemPrompt(ctx);
    this._healthy = true;
    console.log(`[pulseflow] initialized for user=${ctx.userId} workspace=${ctx.workspace}`);
  }

  async chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse> {
    // 注入扫描 (比 agentai 适配器更严格)
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUser) {
      const scan = pulseflowInjectionScan(lastUser.content as string);  // MessageContent 强转 string
      if (!scan.clean) {
        console.warn(`[pulseflow] injection blocked: ${scan.reason}`);
        return {
          content: `⚠️ 检测到潜在的提示注入, 已拦截 (PulseFlow 防御模式)。\n原因: ${scan.reason}`,
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' as const },
          provider: 'agentai', // 拦截后不再走 LLM
          durationMs: 5,
        };
      }
    }

    // 调底层 LLM Router (统一 router)
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
    console.log(`[pulseflow] shutdown`);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return this._healthy
      ? { ok: true, detail: 'PulseFlow adapter ready' }
      : { ok: false, detail: 'PulseFlow adapter not initialized' };
  }
}
