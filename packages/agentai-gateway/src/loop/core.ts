/**
 * AgentAI Loop Core
 * 重构后的核心循环类，整合所有子模块
 */

import { EventEmitter } from 'events';
import { AgentAIRouter, ChatMessage, ChatResponse, MessageContent, ProviderId } from '../llm-router.js';
import { ToolRegistry, ToolContext, ToolResult } from '../tool-registry.js';
import {
  LoopOptions,
  AgentContext,
  CapabilityTier,
  TaskType,
  LoopRunResult,
  GoalResult
} from './types.js';
import { SystemDirectiveManager } from './directive-manager.js';
import { isTrustedCommand } from './trust-commands.js';
import { filterToolsByIntent } from './tool-filter.js';
import { buildImmutablePrefix, getDirectivesContent } from './context-builder.js';
import { reflectSession, recordSessionSummary, extractModifiedFiles } from './reflection.js';

/**
 * AgentAI Loop 核心类
 * 替代原 agentai-loop.ts 中的 AgentAILoop 类
 */
export class AgentAILoopCore extends EventEmitter {
  private router: AgentAIRouter;
  private registry: ToolRegistry;
  readonly context: AgentContext;
  readonly opts: Required<LoopOptions>;
  private iteration = 0;
  private initialMessages: ChatMessage[];
  private contextReady = false;

  private _aborted = false;
  private _runGeneration = 0;
  private _abortedGeneration = 0;

  private _emotionHistory: Array<{ emotion: string; intensity: number; ts: number }> = [];
  private metaLoop: any = null;
  private directives = new SystemDirectiveManager();

  private _taskType: TaskType = 'general';
  private _userIndustry: string = 'general';
  private _forceSkill: string | null = null;
  private _capabilityTier: CapabilityTier = 'supervised';
  private _capabilities: any = null;

  /**
   * 待审批队列
   */
  private _pendingApprovals = new Map<string, {
    resolve: (value: boolean) => void;
    reject: (reason: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  constructor(
    router: AgentAIRouter,
    registry: ToolRegistry,
    initialMessages: ChatMessage[] = [],
    opts: LoopOptions
  ) {
    super();
    this.router = router;
    this.registry = registry;
    this.initialMessages = initialMessages;

    // 设置默认值
    this.opts = {
      maxIterations: opts.maxIterations ?? 30,
      userId: opts.userId ?? 'default',
      workspace: opts.workspace ?? process.cwd(),
      sessionId: opts.sessionId ?? `session-${Date.now()}`,
      abortSignal: opts.abortSignal ?? new AbortController().signal,
      parallelMax: opts.parallelMax ?? 3,
      reflectEvery: opts.reflectEvery ?? 10,
      includeSkillsIndex: opts.includeSkillsIndex ?? true,
      model: opts.model ?? 'agentai',
      modelName: opts.modelName ?? '',
      displayModelLabel: opts.displayModelLabel ?? '',
      persistentMemory: opts.persistentMemory ?? null,
      userPickedModel: opts.userPickedModel ?? false,
      mode: opts.mode ?? 'auto',
      emotion: opts.emotion ?? { emotion: 'neutral', intensity: 0, label: '中性' },
      _autoResumed: opts._autoResumed ?? false,
      thinking: opts.thinking ?? false,
      thinkingBudget: opts.thinkingBudget ?? 0,
      modelConfig: opts.modelConfig ?? { baseURL: '', modelName: '', provider: '' },
      activeFile: opts.activeFile ?? '',
      taskId: opts.taskId ?? '',
    };

    // 初始化上下文
    this.context = {
      sessionId: this.opts.sessionId,
      immutablePrefix: [],
      appendOnlyLog: [],
      volatileScratch: '',
    };
  }

  /**
   * 确保上下文已准备好
   */
  private async ensureContext(): Promise<void> {
    if (this.contextReady) return;

    const buildOptions = {
      opts: this.opts,
      messages: this.initialMessages,
      taskType: this._taskType,
      userIndustry: this._userIndustry,
      directives: this.directives,
      emotionHistory: this._emotionHistory,
      forceSkill: this._forceSkill,
      capabilityTier: this._capabilityTier,
    };

    this.context.immutablePrefix = await buildImmutablePrefix(this.initialMessages, buildOptions);

    // 保留已存在的 appendOnlyLog 内容
    const initialLog = this.initialMessages.filter(m => m.role !== 'system');
    this.context.appendOnlyLog = [...initialLog, ...this.context.appendOnlyLog];

    this.contextReady = true;
  }

  /**
   * 主运行方法
   */
  async run(userMessage: string | { content: MessageContent }): Promise<LoopRunResult> {
    await this.ensureContext();
    this.iteration = 0;
    this.context.volatileScratch = '';
    this.metaLoop = null;

    const startedAt = Date.now();
    const myGeneration = ++this._runGeneration;
    this._aborted = false;

    // 记录情绪历史
    if (this.opts.emotion && this.opts.emotion.emotion !== 'neutral') {
      this._emotionHistory.push({
        emotion: this.opts.emotion.emotion,
        intensity: this.opts.emotion.intensity,
        ts: Date.now(),
      });
      if (this._emotionHistory.length > 5) this._emotionHistory.shift();
    }

    // 添加用户消息到日志
    const userMsg: ChatMessage = typeof userMessage === 'string'
      ? { role: 'user', content: userMessage }
      : { role: 'user', content: userMessage.content };
    this.context.appendOnlyLog.push(userMsg);

    try {
      // 主循环
      while (this.iteration < this.opts.maxIterations) {
        // 检查是否被中断
        if (this._aborted || this._abortedGeneration >= myGeneration) {
          throw new Error('Loop aborted');
        }

        // 检查 abortSignal
        if (this.opts.abortSignal?.aborted) {
          throw new Error('AbortSignal triggered');
        }

        this.iteration++;
        const response = await this.runOneIteration();

        // 如果没有工具调用，任务完成
        if (!response.toolCalls || response.toolCalls.length === 0) {
          // 执行反思
          if (this.iteration >= this.opts.reflectEvery) {
            await this.performReflection(true);
          }

          return {
            content: response.content,
            provider: response.provider,
            usage: response.usage,
            iterations: this.iteration,
            durationMs: Date.now() - startedAt,
          };
        }

        // 执行工具调用
        await this.executeToolCalls(response.toolCalls);
      }

      // 达到最大迭代次数
      return {
        content: '达到最大迭代次数限制',
        provider: 'none' as ProviderId,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' },
        iterations: this.iteration,
        durationMs: Date.now() - startedAt,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        content: `[ERROR] ${errorMsg}`,
        provider: 'none' as ProviderId,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, cacheHit: false, source: 'estimated' },
        iterations: this.iteration,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * 单次迭代
   */
  private async runOneIteration(): Promise<{
    content: string;
    provider: ProviderId;
    usage: any;
    toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
  }> {
    // 构建消息列表
    const messages = [
      ...this.context.immutablePrefix,
      ...this.context.appendOnlyLog,
    ];

    // 添加指令
    const directivesContent = getDirectivesContent({
      opts: this.opts,
      messages: this.context.appendOnlyLog,
      taskType: this._taskType,
      userIndustry: this._userIndustry,
      directives: this.directives,
      emotionHistory: this._emotionHistory,
      forceSkill: this._forceSkill,
      capabilityTier: this._capabilityTier,
    });

    if (directivesContent) {
      messages.push({ role: 'user', content: directivesContent });
    }

    // 过滤工具
    const lastUserMsg = this.context.appendOnlyLog.filter(m => m.role === 'user').pop();
    const userText = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '';

    const allTools = this.registry.toLLMTools();
    const requestTools = filterToolsByIntent(userText, allTools, {
      mode: this.opts.mode,
      capabilityTier: this._capabilityTier,
      taskType: this._taskType,
      message: userText,
    });

    // 调用 LLM
    const response = await this.router.chat({
      model: this.opts.model as ProviderId,
      subModel: this.opts.modelName || undefined,
      messages,
      tools: requestTools,
      stream: false,
      thinking: this.opts.thinking,
      thinkingBudget: this.opts.thinkingBudget,
    });

    // 解析工具调用
    const toolCalls = response.toolCalls?.map((tc: any) => ({
      id: tc.id || `call-${Date.now()}`,
      name: tc.function?.name || tc.name || '',
      args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : tc.args || {},
    })) || [];

    // 添加 assistant 回复到日志
    this.context.appendOnlyLog.push({
      role: 'assistant',
      content: response.content,
    });

    return {
      content: response.content || '',
      provider: response.provider,
      usage: response.usage,
      toolCalls,
    };
  }

  /**
   * 执行工具调用
   */
  private async executeToolCalls(
    toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>
  ): Promise<void> {
    for (const call of toolCalls) {
      // 检查是否被中断
      if (this._aborted) break;

      // 检查信任命令
      const filePath = call.args.file_path || call.args.path || '';
      if (['write_file', 'multi_edit', 'delete_file'].includes(call.name)) {
        if (!isTrustedCommand(call.name, filePath)) {
          // 需要审批
          const approved = await this.requestApproval(call.id, call.name, filePath);
          if (!approved) {
            this.context.appendOnlyLog.push({
              role: 'tool',
              content: `[DECLINED] 用户拒绝了 ${call.name} 操作`,
              name: call.name,
              tool_call_id: call.id,
            });
            continue;
          }
        }
      }

      // 执行工具
      const ctx: ToolContext = {
        userId: this.opts.userId,
        workspace: this.opts.workspace,
        abortSignal: this.opts.abortSignal ?? new AbortController().signal,
      };

      const result = await this.registry.executeOne({
        id: call.id,
        name: call.name,
        args: call.args,
      }, ctx);

      // 添加工具结果到日志
      this.context.appendOnlyLog.push({
        role: 'tool',
        content: this.formatToolResult(result, call),
        name: call.name,
        tool_call_id: call.id,
      });

      this.emit('tool:result', { call, result });
    }
  }

  /**
   * 请求用户审批
   */
  private async requestApproval(callId: string, toolName: string, filePath: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingApprovals.delete(callId);
        resolve(false); // 超时默认拒绝
      }, 5 * 60 * 1000); // 5分钟超时

      this._pendingApprovals.set(callId, { resolve, reject, timer });

      this.emit('approval:required', {
        approvalId: callId,
        toolName,
        filePath,
      });
    });
  }

  /**
   * 解决审批
   */
  resolveApproval(approvalId: string, approved: boolean): boolean {
    const pending = this._pendingApprovals.get(approvalId);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this._pendingApprovals.delete(approvalId);
    pending.resolve(approved);
    return true;
  }

  /**
   * 格式化工具结果
   */
  private formatToolResult(r: ToolResult, call?: { id: string; name: string; args: Record<string, any> }): string {
    if (r.success) {
      return r.output || '[OK]';
    } else {
      return `[ERROR] ${r.error || 'Unknown error'}`;
    }
  }

  /**
   * 执行反思
   */
  private async performReflection(success: boolean): Promise<void> {
    const lastUserMsg = this.context.appendOnlyLog.filter(m => m.role === 'user').pop();
    const lastAssistantMsg = this.context.appendOnlyLog.filter(m => m.role === 'assistant').pop();

    const toolCalls = this.context.appendOnlyLog
      .filter(m => m.role === 'tool')
      .map(m => ({
        name: (m as any).name || 'unknown',
        args: (m as any).args || {},
        result: typeof m.content === 'string' ? m.content : '',
        success: (m as any).success ?? true,
        durationMs: (m as any).durationMs || 0,
      }));

    await reflectSession(this.router, {
      userMessage: typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '',
      finalResponse: typeof lastAssistantMsg?.content === 'string' ? lastAssistantMsg.content : '',
      toolCalls,
      iterations: this.iteration,
      success,
      reflectEvery: this.opts.reflectEvery,
      userId: this.opts.userId,
      workspace: this.opts.workspace,
      taskType: this._taskType,
      industry: this._userIndustry,
      keywords: [],
    });

    // 记录会话摘要
    const toolMessages = this.context.appendOnlyLog.filter(m => m.role === 'tool');
    const modifiedFiles = extractModifiedFiles(toolMessages.map(m => ({ content: typeof m.content === 'string' ? m.content : '' })));
    recordSessionSummary(this.opts.userId, this.opts.workspace, {
      userGoal: typeof lastUserMsg?.content === 'string' ? lastUserMsg.content.slice(0, 100) : '',
      files: modifiedFiles,
      toolsUsed: [...new Set(toolCalls.map(t => t.name))],
      iterations: this.iteration,
      success,
    });
  }

  /**
   * 中断循环
   */
  abort(): void {
    this._aborted = true;
    this._abortedGeneration = this._runGeneration;
  }

  /**
   * 获取上下文
   */
  getContext(): Readonly<AgentContext> {
    return this.context;
  }

  /**
   * 运行目标（简化版）
   */
  async runWithGoal(goal: string): Promise<GoalResult> {
    const result = await this.run(goal);
    return {
      success: !result.content.startsWith('[ERROR]'),
      output: result.content,
      iterations: result.iterations,
      durationMs: result.durationMs,
    };
  }
}

// 导出类型
export * from './types.js';
export { SystemDirectiveManager } from './directive-manager.js';
export { isTrustedCommand, addTrustedPattern, removeTrustedPattern, getTrustedPatterns } from './trust-commands.js';
export { filterToolsByIntent, CORE_TOOLS, READONLY_TOOLS } from './tool-filter.js';
export { buildImmutablePrefix } from './context-builder.js';
export { reflectSession } from './reflection.js';
