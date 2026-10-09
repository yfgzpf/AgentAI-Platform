/**
 * AgentAI 自研主框架适配器
 * ----------------------------------------------------
 * AgentAILoop 的框架适配实现: 消息累加 + 工具 XML 注入 + 统一 LLM Router
 *
 * 能力特征:
 *   - 并行工具 dispatch
 *   - 技能热加载
 *   - 多智能体编排
 */

import { EventEmitter } from 'events';
import type { ChatMessage, ChatResponse } from '../llm-router.js';
import { AgentAIRouter } from '../llm-router.js';
import { computeUsage } from './agentai-helpers.js';
import type { FrameworkAdapter, FrameworkContext, FrameworkCapabilities } from './types.js';

/** 共享 router (单例) */
const router = new AgentAIRouter();

export class AgentaiAdapter extends EventEmitter implements FrameworkAdapter {
  readonly id = 'agentai' as const;
  readonly displayName = 'AgentAI 自研框架';
  readonly version = '1.0.0';
  readonly capabilities: FrameworkCapabilities = {
    parallelTools: true,         // 支持并发 dispatch
    hotReloadSkills: true,       // chokidar 热加载
    multiAgent: true,            // 多智能体编排
    fts5Session: true,
    chineseInjectionScan: false, // 深度中文扫描委托给 pulseflow 适配器
    defaultProvider: 'agentai',  // Agnes API 主选
  };

  private currentContext?: FrameworkContext;
  /** 消息累加器 */
  private sessionMessages: ChatMessage[] = [];
  private sessions = new Map<string, ChatMessage[]>();

  async init(ctx: FrameworkContext): Promise<void> {
    this.currentContext = ctx;
    this.emit('framework:initialized', { id: this.id, ctx });
  }

  async chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse> {
    // === 1. 会话消息累加 ===
    const sessionKey = `${ctx.userId}:${ctx.workspace}`;
    let acc = this.sessions.get(sessionKey);
    if (!acc) {
      acc = [];
      this.sessions.set(sessionKey, acc);
    }
    acc.push(...messages);
    this.sessionMessages = acc;

    // === 2. 构造 system + tools 注入 ===
    const systemWithTools = this.injectTools(acc);

    // === 3. 调真 LLM Router ===
    const startedAt = Date.now();
    const res = await router.chat({
      messages: systemWithTools,
      model: this.capabilities.defaultProvider,
      maxTokens: 2048,
      temperature: 0.7,
    });
    res.durationMs = Date.now() - startedAt;
    return res;
  }

  /**
   * 系统提示注入工具 XML
   */
  private injectTools(messages: ChatMessage[]): ChatMessage[] {
    const systemMsgs = messages.filter(m => m.role === 'system');
    const skillsXml = this.currentContext?.tools
      ? `<agentai_skills>${this.currentContext.tools.map(t =>
          `<tool name="${t.name}">${t.description}</tool>`,
        ).join('')}</agentai_skills>`
      : '';

    if (skillsXml && !systemMsgs.some(m => (m.content as string).includes('<agentai_skills>'))) {  // content 是 MessageContent
      systemMsgs.push({
        role: 'system',
        content: `# AgentAI Session\n${skillsXml}\n\nUse the above tools. Reply with tool_calls in JSON.`,
      });
    }
    return [...systemMsgs, ...messages.filter(m => m.role !== 'system')];
  }

  async shutdown(): Promise<void> {
    this.sessionMessages = [];
    this.sessions.clear();
    this.emit('framework:shutdown', { id: this.id });
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    return { ok: true, detail: `AgentAI 1.0 (sessions=${this.sessions.size})` };
  }

  /**
   * 多智能体编排: 给不同角色注入不同 system 提示, 走统一 router
   */
  async dispatchToAgent(agentRole: 'general' | 'copywriter' | 'designer' | 'marketing', task: string): Promise<ChatResponse> {
    const roleSystem = `# [ROLE - AgentAI 多智能体]
你扮演 "${agentRole}" 角色。

可用角色:
- general: 全能助手, 默认
- copywriter: 文案撰写, 创意发散
- designer: 设计思路, UI/UX 建议
- marketing: 营销策略, 用户增长

请用 "${agentRole}" 视角完成任务: ${task}`;

    this.emit('agentai:dispatch', { agentRole, task });
    const res = await router.chat({
      messages: [{ role: 'system', content: roleSystem }, { role: 'user', content: task }],
      model: this.capabilities.defaultProvider,
      maxTokens: 1024,
      temperature: 0.8,
    });
    return res;
  }
}
