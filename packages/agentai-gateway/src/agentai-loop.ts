/**
 * AgentAI 主循环 (Cache-First Loop)
 * ----------------------------------------------------
 * 自创整合: 融合 3 框架精华
 *   - Reasonix Pillar 1 三段式 (immutable prefix / append-only log / volatile scratch)
 *   - Hermes SessionDB (FTS5 会话存储)
 *   - ZhiY.AI zhiy-agent-core (多智能体编排)
 *
 * 自创:
 *   - **每 10 轮反思门** (写三层记忆, 学 WorkBuddy)
 *   - **中文 Skills 索引注入** (学 ZhiY.AI skills-system)
 *   - **abort 信号传递** (学 Reasonix ToolCallContext)
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 3.1 节
 */

import { EventEmitter } from 'events';
import { AgentAIRouter, ChatRequest, ChatResponse, ChatMessage } from './llm-router.js';
import { ToolRegistry, ToolContext, ToolResult } from './tool-registry.js';

export interface LoopOptions {
  maxIterations: number;        // 学 Reasonix: 默认 90
  userId: string;
  workspace: string;
  abortSignal?: AbortSignal;
  /** 学 Reasonix: parallel 工具最大并发 */
  parallelMax?: number;
  /** 反思门间隔 */
  reflectEvery?: number;
  /** 学 Hermes: system prompt 注入 skills 索引 */
  includeSkillsIndex?: boolean;
}

/**
 * Reasonix Pillar 1 三段式上下文
 * - immutable prefix: 系统提示 + 工具描述, 一旦 session 创建就固定
 * - append-only log:  对话历史, 只增不删
 * - volatile scratch: 当前轮思考, 不发上游
 */
export interface AgentContext {
  sessionId: string;
  immutablePrefix: ChatMessage[];   // 系统 + 工具, pinned
  appendOnlyLog: ChatMessage[];     // 历史对话
  volatileScratch: string;          // 当前轮思考, 不发 LLM
}

export class AgentAILoop extends EventEmitter {
  private router: AgentAIRouter;
  private registry: ToolRegistry;
  private context: AgentContext;
  private opts: Required<LoopOptions>;
  private iteration = 0;

  constructor(
    router: AgentAIRouter,
    registry: ToolRegistry,
    initialMessages: ChatMessage[],
    opts: LoopOptions,
  ) {
    super();
    this.router = router;
    this.registry = registry;
    this.opts = {
      maxIterations: opts.maxIterations ?? 90,
      userId: opts.userId,
      workspace: opts.workspace,
      abortSignal: opts.abortSignal ?? new AbortController().signal,
      parallelMax: opts.parallelMax ?? 3,
      reflectEvery: opts.reflectEvery ?? 10,
      includeSkillsIndex: opts.includeSkillsIndex ?? true,
    };

    // 初始化 AgentContext (学 Reasonix 三段式)
    this.context = {
      sessionId: `agentai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      immutablePrefix: this.buildImmutablePrefix(initialMessages),
      appendOnlyLog: initialMessages.filter(m => m.role !== 'system'),
      volatileScratch: '',
    };
  }

  /**
   * 学自: Reasonix Pillar 1 + Addy Osmani agent-skills
   * 系统提示 + 工具描述 + 反合理化规则, 整个 session 不变
   */
  private buildImmutablePrefix(messages: ChatMessage[]): ChatMessage[] {
    const systemMsgs = messages.filter(m => m.role === 'system');

    // 注入反合理化规则 (学自 agent-skills Anti-Rationalization Table)
    systemMsgs.push({
      role: 'system',
      content: `# Engineering Discipline (Anti-Skip Rules)
These are NOT suggestions. You MUST follow them. If you are about to rationalize skipping one, STOP.

| If you think...                                | Reality                                                      |
|------------------------------------------------|--------------------------------------------------------------|
| "This is too simple, no need to test"          | Simple bugs break production. Run tests, paste output.       |
| "I'll add tests later"                         | Later never comes. No tests = not done.                      |
| "I already checked, it's fine"                 | Verify. Read the file. Run the command. Paste the evidence.  |
| "This edge case is unlikely"                   | Edge cases are where bugs live. Handle it or document it.    |
| "The user can figure this out"                 | If it needs explaining, it's broken.                         |
| "I'll refactor later"                          | Code ships as-is. Refactor now or mark with // TODO(urgency).|
| "Just a quick prototype"                       | Prototypes become production. Write production code from line 1.|

# Exit Criteria (MUST provide verifying evidence)
- After ANY file change: run tests and paste output
- After creating a file: confirm it exists with \`list_directory\`
- Before marking done: list ALL changed files with \`get_file_info\`
- If you say "done": the tests MUST have passed and you MUST show the output`,
    });

    // 注入 skills 索引 (学 Hermes + ZhiY.AI)
    if (this.opts.includeSkillsIndex) {
      const skillsXml = this.registry.toSkillsXML();
      systemMsgs.push({
        role: 'system',
        content: `\n\n# Available Skills\n${skillsXml}\n\nYou can invoke these skills via tool calls.`,
      });
    }

    return systemMsgs;
  }

  /**
   * 主入口: 跑一轮对话
   * 学自: Reasonix loop.ts CacheFirstLoop
   * 学自: Hermes AIAgent.chat()
   * 学自: ZhiY.AI zhiy-agent-core.ts 主循环
   */
  async run(userMessage: string): Promise<ChatResponse> {
    this.iteration = 0;
    this.context.volatileScratch = '';

    // 1. 用户消息进 append-only log
    this.context.appendOnlyLog.push({ role: 'user', content: userMessage });
    this.emit('log:appended', { role: 'user', content: userMessage });

    // 2. 反思门 (学 WorkBuddy, 自创触发点)
    if (this.context.appendOnlyLog.length % this.opts.reflectEvery === 0) {
      await this.reflect();
    }

    // 3. 主循环 (学 Reasonix loop + Hermes AIAgent.chat)
    let lastResponse: ChatResponse | null = null;
    while (this.iteration < this.opts.maxIterations) {
      if (this.opts.abortSignal.aborted) {
        throw new Error('Aborted by user');
      }
      this.iteration++;
      this.emit('loop:iteration', { n: this.iteration });

      // 3.0 规则前置: 仅对 Agnes (无工具能力)生效, DeepSeek 原生调工具不干预
      if (this.iteration === 1 && this.opts.model !== 'deepseek') {
        const lastMsg = this.context.appendOnlyLog[this.context.appendOnlyLog.length - 1];
        const userText = lastMsg?.role === 'user' ? (typeof lastMsg.content === 'string' ? lastMsg.content : '') : '';
        const ctx: any = { userId: this.opts.userId, workspace: this.opts.workspace, abortSignal: this.opts.abortSignal };
        if (/^(审查|分析|检查|探索|review|analyze|explore)/i.test(userText) && userText.length < 50) {
          try {
            const r = await this.registry.executeOne({ id: 'pre_list', name: 'list_directory', args: { path: this.opts.workspace || '.' } }, ctx);
            if (r?.success) {
              this.context.appendOnlyLog.splice(-1, 0, { role: 'tool', name: 'list_directory', content: `📁 目录结构:\n${r.output}` });
            }
          } catch {}
        }
        const readMatch = userText.match(/^(读|查看|读取|cat|read)\s+(.+)/i);
        if (readMatch) {
          try {
            const r = await this.registry.executeOne({ id: 'pre_read', name: 'read_file', args: { file_path: readMatch[2].trim() } }, ctx);
            if (r?.success) {
              this.context.appendOnlyLog.splice(-1, 0, { role: 'tool', name: 'read_file', content: `📄 文件内容:\n${r.output}` });
            }
          } catch {}
        }
      }

      // 3.1 构造 LLM 请求 (immutable prefix + append-only log)
      const messages: ChatMessage[] = [
        ...this.context.immutablePrefix,
        ...this.context.appendOnlyLog,
      ];

      const req: ChatRequest = {
        model: 'agentai',
        messages,
        tools: this.registry.toLLMTools(),
        userId: this.opts.userId,
        workspace: this.opts.workspace,
      };

      // 3.2 调 LLM
      const res = await this.router.chat(req);
      lastResponse = res;

      // 3.3 写 append-only log (assistant 消息)
      this.context.appendOnlyLog.push({ role: 'assistant', content: res.content });
      this.emit('log:appended', { role: 'assistant', content: res.content });

      // 3.4 处理 tool calls
      if (res.toolCalls && res.toolCalls.length > 0) {
        const toolResults = await this.dispatchToolCalls(res.toolCalls);
        // 3.5 工具结果进 append-only log
        for (const r of toolResults) {
          this.context.appendOnlyLog.push({
            role: 'tool',
            name: r.name,
            tool_call_id: r.id,
            content: r.output,
          });
          this.emit('log:appended', { role: 'tool', content: r.output });
        }
        // 3.6 继续循环 (让 LLM 看工具结果决定下一步)
        continue;
      }

      // 3.7 无 tool call: 检测空谈模式 (说要做什么但不做)
      const text = (res.content || '').trim();
      const isTalk = /^(Let me|I will|I'll|I'm going|让我|我来|我先|现在|接下来)/i.test(text) && text.length < 100;
      if (isTalk && this.iteration < this.opts.maxIterations - 1) {
        this.context.appendOnlyLog.push({ role: 'user', content: 'CALL A TOOL NOW. Use list_directory, read_file, or web_search directly. Do NOT explain. Just call the tool.' });
        continue;
      }
      // 3.7 无 tool call, 结束
      break;
    }

    // 上下文折叠 (学 Reasonix ContextManager)
    if (this.opts.workspace && this.iteration >= 3) {
      import('./context-manager.js').then(({ maybeFold }) => maybeFold(
        this.context.appendOnlyLog,
        this.context.immutablePrefix.map(m => m.content).join('\n'),
        this.router,
        this.opts.workspace,
        this.opts.userId,
      ).catch((e: any) => console.warn('[fold] failed:', e?.message)));
    }

    if (!lastResponse) {
      throw new Error('No response from LLM after max iterations');
    }

    this.emit('loop:done', { iterations: this.iteration, response: lastResponse });

    // ============== 反思门 (Reflector) 闭环 ==============
    // 异步触发, 不阻塞返回
    if (this.opts.reflectEvery && this.opts.reflectEvery > 0) {
      this.runReflector(lastResponse, userText).catch((e) => {
        console.warn('[reflector] failed:', (e as Error).message);
      });
    }

    return { ...lastResponse, iterations: this.iteration };
  }

  /**
   * 收集本轮所有 tool calls + 调 Reflector 反思
   */
  private async runReflector(lastResponse: any, userText: string): Promise<void> {
    // 收集本轮 tool calls (从 appendOnlyLog 中提取)
    const toolCalls: Array<{ name: string; args: any; result: any; success: boolean; durationMs: number }> = [];
    for (const msg of this.context.appendOnlyLog) {
      if (msg.role === 'tool' && msg.name && (msg as any).tool_call_id) {
        const tc = lastResponse.toolCalls?.find((c: any) => c.id === (msg as any).tool_call_id);
        toolCalls.push({
          name: msg.name,
          args: tc?.args,
          result: typeof msg.content === 'string' ? msg.content.slice(0, 200) : '',
          success: true, // 已写入 log 视为成功
          durationMs: 0,
        });
      }
    }

    try {
      const { reflect } = await import('./reflector.js');
      await reflect(this.router, {
        userMessage: userText,
        finalResponse: lastResponse.content || '',
        toolCalls,
        iterations: this.iteration,
        success: !!lastResponse.content,
      }, {
        reflectEvery: this.opts.reflectEvery,
        userId: this.opts.userId,
        workspace: this.opts.workspace,
      });
    } catch (e) {
      console.warn('[reflector] import/exec failed:', (e as Error).message);
    }
  }

  /**
   * 分发 tool calls (学自 tool-registry.dispatch, 加 abort 支持)
   */
  private async dispatchToolCalls(
    calls: Array<{ id: string; name: string; args: Record<string, any> }>,
  ): Promise<Array<{ id: string; name: string; output: string }>> {
    const ctx: any = {
      userId: this.opts.userId,
      workspace: this.opts.workspace,
      abortSignal: this.opts.abortSignal,
      priorMessages: this.context.appendOnlyLog,
      _router: this.router,
      _registry: this.registry,
    };
    // 发射 tool:start 事件
    for (const c of calls) this.emit('tool:start', { callId: c.id, name: c.name, args: c.args });
    const results = await this.registry.dispatch(calls, ctx);
    // 发射 tool:result 事件
    for (const c of calls) {
      const r = results.find(x => x.id === c.id);
      this.emit('tool:result', { callId: c.id, name: c.name, result: r?.result?.output || '', ok: r?.result?.success !== false, durationMs: r?.result?.durationMs || 0 });
    }
    return calls.map(c => {
      const r = results.find(x => x.id === c.id);
      return {
        id: c.id,
        name: c.name,
        output: r ? this.formatToolResult(r.result) : '[no result]',
      };
    });
  }

  private formatToolResult(r: ToolResult): string {
    if (r.success) {
      return typeof r.output === 'string' ? r.output : JSON.stringify(r.output);
    }
    return `[ERROR] ${r.error || 'unknown error'}\n${r.output}`;
  }

  /**
   * 反思门 (学 WorkBuddy auto_reflect + Reasonix telemetry)
   * 自创: 把反思写进三层记忆
   */
  private async reflect(): Promise<void> {
    this.emit('reflect:start', { sessionId: this.context.sessionId });

    // 简化: 统计最近 N 轮的失败/成本
    const recent = this.context.appendOnlyLog.slice(-this.opts.reflectEvery);
    const userTurns = recent.filter(m => m.role === 'user').length;
    const toolErrors = recent.filter(m => m.role === 'tool' && m.content.startsWith('[ERROR]')).length;

    const summary = `[reflect ${new Date().toISOString()}] session=${this.context.sessionId} turns=${userTurns} tool_errors=${toolErrors}`;

    this.emit('reflect:done', { summary, userTurns, toolErrors });

    // 写 volatile scratch (不发 LLM)
    this.context.volatileScratch += summary + '\n';
  }

  getContext(): Readonly<AgentContext> {
    return this.context;
  }
}
