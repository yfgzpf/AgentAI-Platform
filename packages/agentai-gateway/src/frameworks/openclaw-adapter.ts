/**
 * OpenClaw 框架适配器
 * ----------------------------------------------------
 * 包裹 ZhiY.AI 的 zhiy-agent-core.ts / multi-agent-orchestrator.ts / skills-system.ts
 *
 * 不照搬: OpenClaw 内部有自己一套, 我们通过 adapter 抹平差异
 *
 * 真实数据:
 *   - zhiy-agent-core.ts:2 原话 "完全照抄 OpenClaw 源码实现"
 *   - 多智能体角色: general / copywriter / designer / marketing / industry
 *   - 技能: XML 嵌入系统提示
 *
 * @see references/openclaw-zhiy/zhiy-backend-src/services/zhiy-agent-core.ts
 */

import { EventEmitter } from 'events';
import type { ChatMessage, ChatResponse } from '../llm-router.js';
import { scanPromptInjection, computeUsage } from './openclaw-helpers.js';
import type { FrameworkAdapter, FrameworkContext, FrameworkCapabilities } from './types.js';

export class OpenClawAdapter extends EventEmitter implements FrameworkAdapter {
  readonly id = 'openclaw' as const;
  readonly displayName = 'OpenClaw (ZhiY.AI 内部署版)';
  readonly version = '1.0.0';
  readonly capabilities: FrameworkCapabilities = {
    parallelTools: true,         // OpenClaw AgentSession 支持并发 dispatch
    hotReloadSkills: true,       // skills-system.ts 用 chokidar
    multiAgent: true,            // multi-agent-orchestrator.ts
    fts5Session: true,           // 后续阶段集成
    chineseInjectionScan: false, // OpenClaw 不做深度中文扫描, 委托给 Hermes
    defaultProvider: 'agentai',  // Agnes API 主选
  };

  private currentContext?: FrameworkContext;
  /** OpenClaw AgentSession.messages 累加器 (学 ZhiY zhiy-agent-core.ts:33) */
  private sessionMessages: ChatMessage[] = [];
  private sessions = new Map<string, ChatMessage[]>();

  async init(ctx: FrameworkContext): Promise<void> {
    this.currentContext = ctx;
    this.emit('framework:initialized', { id: this.id, ctx });
  }

  async chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse> {
    // === 1. 中文注入扫描 (学 Hermes + 自创) ===
    const joined = messages.map(m => m.content).join('\n');
    const scan = scanPromptInjection(joined);
    if (!scan.safe) {
      this.emit('security:threat', scan.threats);
      throw new Error(`OpenClaw 拦截: 检测到 ${scan.threats.length} 个提示注入`);
    }

    // === 2. OpenClaw AgentSession 风格累加 (学 zhiy-agent-core.ts) ===
    const sessionKey = `${ctx.userId}:${ctx.workspace}`;
    let acc = this.sessions.get(sessionKey);
    if (!acc) {
      acc = [];
      this.sessions.set(sessionKey, acc);
    }
    acc.push(...messages);
    this.sessionMessages = acc;

    // === 3. 构造 OpenClaw 风格的 system + tools 注入 (学 zhiy-agent-core.ts BUILTIN_TOOLS) ===
    const systemWithTools = this.injectOpenClawTools(acc);

    // === 4. 调真实 LLM (走 LLM Router) ===
    // 这里只是 stub, 实际由 router.chat() 调度
    // 派生类 OpenClawRealAdapter 会注入真 provider
    return this.executeStub(systemWithTools, ctx);
  }

  /**
   * 学 ZhiY zhiy-agent-core.ts: 系统提示注入工具 + skills XML
   * 自创: 加中文注入扫描提示
   */
  private injectOpenClawTools(messages: ChatMessage[]): ChatMessage[] {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const skillsXml = this.currentContext?.tools
      ? `<openclaw_skills>${this.currentContext.tools.map(t =>
          `<tool name="${t.name}">${t.description}</tool>`,
        ).join('')}</openclaw_skills>`
      : '';

    if (skillsXml && !systemMsgs.some(m => m.content.includes('<openclaw_skills>'))) {
      systemMsgs.push({
        role: 'system',
        content: `# OpenClaw AgentSession\n${skillsXml}\n\nUse the above tools. Reply with tool_calls in JSON.`,
      });
    }
    return [...systemMsgs, ...messages.filter(m => m.role !== 'system')];
  }

  private async executeStub(messages: ChatMessage[], _ctx: FrameworkContext): Promise<ChatResponse> {
    // stub, 真实 provider 由 OpenClawRealAdapter 注入
    return {
      content: `[OpenClaw stub] received ${messages.length} messages`,
      usage: { promptTokens: 0, completionTokens: 0, cost: 0, cacheHit: false },
      provider: 'agentai',
      durationMs: 0,
    };
  }

  async shutdown(): Promise<void> {
    this.sessionMessages = [];
    this.sessions.clear();
    this.emit('framework:shutdown', { id: this.id });
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `OpenClaw 1.0 (sessions=${this.sessions.size})` };
  }

  /**
   * OpenClaw 特有: 多智能体编排
   * 学 ZhiY multi-agent-orchestrator.ts
   */
  async dispatchToAgent(agentRole: 'general' | 'copywriter' | 'designer' | 'marketing', task: string): Promise<ChatResponse> {
    this.emit('openclaw:dispatch', { agentRole, task });
    return {
      content: `[OpenClaw ${agentRole}] ${task}`,
      usage: { promptTokens: 0, completionTokens: 0, cost: 0, cacheHit: false },
      provider: 'agentai',
      durationMs: 0,
    };
  }
}
