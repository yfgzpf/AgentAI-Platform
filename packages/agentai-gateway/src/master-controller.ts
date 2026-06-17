/**
 * MasterController — 主控AI系统
 * ----------------------------------------------------
 * 学自: Reasonix subagent.ts + Hermes dynamic subagent + DeerFlow Plan Mode
 * 核心: DeepSeek V4 Flash 作为主控"大脑"
 *   1. 意图理解 → 2. 任务规划 → 3. 子Agent分派 → 4. 结果汇总
 *
 * 调用链:
 *   ChatView → AgentAILoop.run() → MasterController.orchestrate()
 *     → 意图分类 → 生成执行计划
 *     → 复杂任务: 拆分子任务 → 并行分派子Agent
 *     → 简单任务: 直接交给 AgentAILoop 主循环
 */

import { EventEmitter } from 'events';
import type { AgentAIRouter, ChatRequest, ChatResponse, ProviderId } from './llm-router.js';
import type { ToolRegistry } from './tool-registry.js';

export interface IntentResult {
  /** 用户意图分类 */
  category: 'code' | 'chat' | 'create' | 'analyze' | 'search' | 'data' | 'media' | 'refactor' | 'review' | 'deploy' | 'unknown';
  /** 置信度 0-1 */
  confidence: number;
  /** 复杂度: simple | medium | complex | multi-step */
  complexity: 'simple' | 'medium' | 'complex' | 'multi-step';
  /** 是否需要子Agent */
  needsSubAgents: boolean;
  /** 提取的实体关键词 */
  entities: string[];
  /** 隐含需求 */
  impliedNeeds: string[];
  /** 缺失信息 */
  missingInfo: string[];
  /** 原始意图描述 */
  summary: string;
}

export interface SubTask {
  id: string;
  title: string;
  description: string;
  /** 需要的Agent类型: explore/verify/code/write/search/data/media */
  agentType: string;
  /** 依赖的子任务ID */
  dependsOn: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: string;
}

export interface ExecPlan {
  id: string;
  goal: string;
  intent: IntentResult;
  subtasks: SubTask[];
  /** 并行组 (同一组内可并行) */
  parallelGroups: string[][];
  /** 动态阶段 — 由意图决定, 不再硬编码 */
  stages: Array<{ key: string; label: string }>;
}

export interface MasterControllerOptions {
  router: AgentAIRouter;
  registry: ToolRegistry;
  /** 主控模型: 默认 deepseek Flash (便宜, 速度快) */
  masterModel?: string;
  /** 推理升级模型: deepseek Pro (复杂推理自动切换) */
  proModel?: string;
  /** 多模态模型: agentai/agnes (免费, 多模态) */
  multimodalModel?: string;
  /** 子Agent模型: 默认 agentai (多模态能力) */
  subagentModel?: string;
  userId: string;
  workspace: string;
}

/**
 * 意图分类 System Prompt
 */
const INTENT_CLASSIFIER_PROMPT = `You are an intent classifier. Analyze the user message and output JSON only.

Categories: code(写代码), chat(闲聊), create(创建文件/项目), analyze(分析/审查), search(搜索/查找), data(数据处理), media(生图/视频), refactor(重构), review(代码审查), deploy(部署), unknown

Complexity levels:
- simple: 单步回答, 无需工具
- medium: 需要查文件或搜索
- complex: 需要多步操作
- multi-step: 需要拆分为多个子任务

Entities: 提取的关键词 (文件路径, 技术栈, 项目名等)
ImpliedNeeds: 用户没明确说但可能需要的东西
MissingInfo: 缺失的关键信息 (追问候选)

Output JSON:
{
  "category": "...",
  "confidence": 0.9,
  "complexity": "...",
  "needsSubAgents": true/false,
  "entities": [...],
  "impliedNeeds": [...],
  "missingInfo": [...],
  "summary": "一句话描述用户要什么"
}`;

/**
 * 任务规划 System Prompt
 */
const TASK_PLANNER_PROMPT = `You are a task planner. Given user intent and context, decompose into subtasks.

Rules:
1. Each subtask should be a focused unit of work
2. Mark dependencies (dependsOn) for sequential tasks
3. Tasks without dependencies can run in parallel (same parallelGroup)
4. agentType must be one of: explore(read-only search), verify(check correctness), code(write/edit code), write(create files), search(web search), data(process data), media(generate image/video)

Output JSON:
{
  "subtasks": [
    {
      "id": "t1",
      "title": "任务标题",
      "description": "详细描述 (子Agent会收到这个作为task)",
      "agentType": "explore",
      "dependsOn": []
    }
  ],
  "parallelGroups": [["t1","t2"], ["t3"]]
}`;

export class MasterController extends EventEmitter {
  private router: AgentAIRouter;
  private registry: ToolRegistry;
  private masterModel: string;
  private proModel: string;
  private multimodalModel: string;
  private subagentModel: string;
  private userId: string;
  private workspace: string;

  constructor(opts: MasterControllerOptions) {
    super();
    this.router = opts.router;
    this.registry = opts.registry;
    // 主控: DeepSeek Flash (便宜, 推理能力够用)
    this.masterModel = opts.masterModel ?? 'deepseek';
    // 升级: DeepSeek Pro (复杂推理自动切换)
    this.proModel = opts.proModel ?? 'deepseek';
    // 多模态: Agnes (免费, 支持生图/视频/视觉)
    this.multimodalModel = opts.multimodalModel ?? 'agentai';
    // 子Agent: Agnes (多模态, 工具调用, 免费)
    this.subagentModel = opts.subagentModel ?? 'agentai';
    this.userId = opts.userId;
    this.workspace = opts.workspace;
  }

  /**
   * 主入口: 编排一次任务
   * 路由逻辑:
   *   - master (DeepSeek Flash) → 意图理解 + 任务规划
   *   - 复杂推理? → 切换 deepseek Pro
   *   - 多模态子任务? → 分派 agentai 子Agent
   */
  async orchestrate(userMessage: string): Promise<{
    execPlan: ExecPlan;
    shouldAutoRun: boolean;
  }> {
    this.emit('orchestrate:start', { message: userMessage.slice(0, 100) });

    // Phase 1: 意图理解
    const intent = await this.classifyIntent(userMessage);
    this.emit('orchestrate:intent', intent);

    // Phase 2: 缺失信息检查 — 信息不足则标记需追问
    if (intent.missingInfo.length > 0 && intent.confidence < 0.7) {
      this.emit('orchestrate:needClarify', intent.missingInfo);
    }

    // Phase 3: 生成执行计划
    const plan = await this.createPlan(userMessage, intent);
    this.emit('orchestrate:plan', { taskCount: plan.subtasks.length, parallelGroups: plan.parallelGroups.length });

    // Phase 4: 决定是否需要子Agent
    // simple → 直接主循环执行
    // medium + 单子任务 → 直接主循环执行 (不绕子Agent)
    // medium + 多子任务 → 分派子Agent
    // complex/multi-step → 分派子Agent
    const shouldAutoRun = intent.complexity === 'simple'
      || (intent.complexity === 'medium' && !intent.needsSubAgents && plan.subtasks.length <= 1);

    return { execPlan: plan, shouldAutoRun };
  }

  /**
   * Phase 1: 意图分类 + 智能模型路由
   *   - 默认: DeepSeek Flash (快+便宜)
   *   - 推理升级: 检测到复杂推理 → 自动切换 Pro
   */
  private async classifyIntent(message: string): Promise<IntentResult> {
    // === 启发式快速分类: 避免 LLM 浪费 (覆盖 ~90% 消息) ===
    const trimmed = message.trim();
    const len = trimmed.length;

    // 1. 超短寒暄/确认 → 直接回复
    const shortPattern = /^(你好|hi|hello|谢谢|感谢|bye|再见|ok|好的|嗯|哦|是|不是|对|不对|yes|no|算了|没事|没什么|行|可以|就这样|先这样|收到|明白|知道了|懂了|了解)$/i;
    if (len < 20 && shortPattern.test(trimmed)) {
      return { category: 'chat', confidence: 0.98, complexity: 'simple', needsSubAgents: false,
        entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed };
    }

    // 1.5 上下文追问/反馈类 — 不需要编排器 (如 "你没有上面的上文吗", "继续", "不对")
    const contextFollowUp = /(你没有|上面|上文|上文吗|上文呢|之前|刚才|刚才说|继续|接着|不对|错了|不是这个|换个|换一种|再说一遍|重复|再说|还有呢|然后呢|接下来|还有吗|更多|其他)/i;
    if (len < 100 && contextFollowUp.test(trimmed)) {
      if (!/[代码审查分析重构改修建查找解]|debug|review|refactor|implement|create|fix/i.test(trimmed)) {
        return { category: 'chat', confidence: 0.85, complexity: 'simple', needsSubAgents: false,
          entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
      }
    }

    // 2. 简单知识问答 (不需要工具)
    const simpleQ = /^(什么是|怎么|如何|为什么|什么时候|谁|哪里|哪个|介绍一下|解释|说明|告诉我|有没有|会不会)/i;
    // 简单列举/展示类 (列出技能、显示状态等) — 不需要编排器
    const listShowQ = /^(列出|列表|显示|展示|有哪些|能不能|可以|是否会|是否支持|你(能|会|可以|是)|你是谁|你叫什么|你的技能|你的能力|你的功能|你好|hi|hello)/i;
    if ((len < 80 && simpleQ.test(trimmed)) || (len < 100 && listShowQ.test(trimmed))) {
      if (!/[代码审查分析重构改修建查找解]|debug|review|refactor|implement|create|fix/i.test(trimmed)) {
        return { category: 'chat', confidence: 0.90, complexity: 'simple', needsSubAgents: false,
          entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
      }
    }

    // 2.5 短消息 (< 60字) 且不含真正的代码/操作关键词 → 大概率是闲聊/追问
    // 注意: "目录"/"文件"/"项目" 等词在闲聊中也会出现, 不能仅凭这些词就认为是代码任务
    // 只有搭配操作动词才是真正的代码任务
    const hasCodeAction = /(写|创建|修改|删除|运行|执行|搜索|查找|测试|生成|重构|审查|分析|部署|安装|配置|调试|修复|开发|构建|编译|debug|review|refactor|implement|create|fix|write|delete|run|test|build|deploy)/i.test(trimmed);
    if (len < 60 && !hasCodeAction) {
      return { category: 'chat', confidence: 0.80, complexity: 'simple', needsSubAgents: false,
        entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
    }

    // 3. 文件/代码操作指令 → 直接进主循环 (不绕子Agent)
    const cmdPattern = /^(读|查看|打开|显示|展示|列出|list|创建|新建|删除|改|修改|运行|执行|审查|分析|搜索|查|找|测试|生成|帮我|请|让|给)/i;
    if (cmdPattern.test(trimmed)) {
      // 根据内容判断复杂度
      const isComplex = /同时|并且|以及|还有|之后|然后|重构|架构|部署|完整|全套|系统/i.test(trimmed) || len > 200;
      return { category: 'code', confidence: 0.85, complexity: isComplex ? 'medium' : 'simple', needsSubAgents: isComplex,
        entities: [trimmed.split(/\s+/).slice(1,3).join(' ') || trimmed.slice(0,30)],
        impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
    }

    // 4. 图片/视频生成 → media 类
    const mediaPattern = /图|效果图|海报|插画|视频|画|设计|logo|icon|封面|配图|生成图|生成视频/i;
    if (mediaPattern.test(trimmed)) {
      return { category: 'media', confidence: 0.90, complexity: 'simple', needsSubAgents: false,
        entities: [], impliedNeeds: ['需要使用 generate_image 或 generate_video 工具'], missingInfo: [], summary: trimmed.slice(0, 100) };
    }

    // 5. 搜索/查找 → search 类
    const searchPattern = /^(搜索|查找|找|search|find|查|帮我查)/i;
    if (searchPattern.test(trimmed)) {
      return { category: 'search', confidence: 0.85, complexity: 'simple', needsSubAgents: false,
        entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
    }

    // 6. 复杂任务关键词 → 直接标记为 complex, 跳过 LLM 分类
    const complexPattern = /开发|构建|重构|审查|部署|实现|设计|优化|配置|搭建|创建项目|完整|全套/i;
    if (complexPattern.test(trimmed) && len > 50) {
      // "审查系统" 类宽泛指令需要具体化, 否则AI会无限探索
      const isVague = /^(审查|分析|检查|review|analyze)\s*(系统|项目|代码|全部|整体)/i.test(trimmed) && trimmed.length < 30;
      return { category: 'code', confidence: 0.75, complexity: isVague ? 'medium' : 'complex',
        needsSubAgents: !isVague, // 宽泛指令不走子Agent, 直接主循环执行
        entities: [], impliedNeeds: isVague ? ['需要先确定审查范围和重点'] : [],
        missingInfo: isVague ? ['审查哪个模块/文件? 关注什么方面?'] : [],
        summary: trimmed.slice(0, 100) };
    }

    // 7. 中等长度消息 → medium, 直接进主循环 (不调 LLM)
    if (len < 200) {
      return { category: 'code', confidence: 0.60, complexity: 'medium', needsSubAgents: false,
        entities: [], impliedNeeds: [], missingInfo: [], summary: trimmed.slice(0, 100) };
    }

    // 8. 只有超长/模糊消息才调 LLM 分类 (节省 token)
    // 推理需求检测
    const needsReasoning = /算法|证明|推导|最小化|最大化|最优化|分析复杂度|安全|漏洞|架构|设计模式|数学|公式|证明题/i.test(message)
      && message.length > 40;

    try {
      const res = await this.router.chat({
        model: (needsReasoning ? this.proModel : this.masterModel) as ProviderId,
        messages: [
          { role: 'system', content: INTENT_CLASSIFIER_PROMPT },
          { role: 'user', content: message },
        ],
        tools: [],
        userId: this.userId,
        workspace: this.workspace,
      });

      // 尝试解析 JSON
      const json = this.extractJson(res.content);
      if (json) {
        return {
          category: json.category || 'unknown',
          confidence: json.confidence || 0.5,
          complexity: json.complexity || 'simple',
          needsSubAgents: json.needsSubAgents || false,
          entities: json.entities || [],
          impliedNeeds: json.impliedNeeds || [],
          missingInfo: json.missingInfo || [],
          summary: json.summary || message.slice(0, 100),
        };
      }
    } catch {}

    // 降级: 简单启发式
    return this.heuristicIntent(message);
  }

  /**
   * 根据意图动态生成工作流阶段
   * 不同任务类型有不同的自然流程, 不再硬编码5步
   */
  private inferStages(intent: IntentResult, message: string): Array<{ key: string; label: string }> {
    const cat = intent.category;
    const comp = intent.complexity;
    const msg = message.toLowerCase();

    // 闲聊/简单问答 — 不需要编排器
    if (comp === 'simple' || cat === 'chat') {
      return [];
    }

    // 审查/分析类 — 探索→分析→总结
    if (cat === 'review' || cat === 'analyze' || /^(审查|分析|检查|评估|review|analyze|inspect|audit|诊断)/i.test(msg)) {
      return [
        { key: 'explore', label: '探索' },
        { key: 'analyze', label: '分析' },
        { key: 'report', label: '总结' },
      ];
    }

    // 搜索/查找类 — 搜索→整理→呈现
    if (cat === 'search') {
      return [
        { key: 'search', label: '搜索' },
        { key: 'organize', label: '整理' },
        { key: 'report', label: '呈现' },
      ];
    }

    // 媒体生成类 — 规划→生成→确认
    if (cat === 'media') {
      return [
        { key: 'plan', label: '规划' },
        { key: 'generate', label: '生成' },
        { key: 'report', label: '确认' },
      ];
    }

    // 代码开发类 (create/code) — 规划→实现→测试→报告
    if (cat === 'create' || cat === 'code') {
      if (comp === 'complex' || comp === 'multi-step') {
        return [
          { key: 'plan', label: '规划' },
          { key: 'implement', label: '实现' },
          { key: 'test', label: '测试' },
          { key: 'report', label: '报告' },
        ];
      }
      return [
        { key: 'plan', label: '规划' },
        { key: 'implement', label: '实现' },
        { key: 'report', label: '报告' },
      ];
    }

    // 重构类 — 分析→重构→验证→报告
    if (cat === 'refactor') {
      return [
        { key: 'analyze', label: '分析' },
        { key: 'refactor', label: '重构' },
        { key: 'verify', label: '验证' },
        { key: 'report', label: '报告' },
      ];
    }

    // 部署类 — 准备→部署→验证→报告
    if (cat === 'deploy') {
      return [
        { key: 'prepare', label: '准备' },
        { key: 'deploy', label: '部署' },
        { key: 'verify', label: '验证' },
        { key: 'report', label: '报告' },
      ];
    }

    // 数据处理类 — 读取→处理→输出
    if (cat === 'data') {
      return [
        { key: 'read', label: '读取' },
        { key: 'process', label: '处理' },
        { key: 'output', label: '输出' },
      ];
    }

    // 默认: 理解→执行→报告
    return [
      { key: 'understand', label: '理解' },
      { key: 'execute', label: '执行' },
      { key: 'report', label: '报告' },
    ];
  }

  /**
   * Phase 3: 任务规划
   */
  private async createPlan(message: string, intent: IntentResult): Promise<ExecPlan> {
    const planId = `plan-${Date.now().toString(36)}`;

    // 简单任务: 单步执行, 不调LLM规划
    if (intent.complexity === 'simple') {
      return {
        id: planId,
        goal: intent.summary,
        intent,
        subtasks: [{
          id: 't1', title: '直接回复',
          description: message,
          agentType: 'explore',
          dependsOn: [],
          status: 'pending',
        }],
        parallelGroups: [['t1']],
        stages: this.inferStages(intent, message),
      };
    }

    // 中等任务: 单步执行, 不调LLM规划 (省token)
    // 只有真正需要多步骤时才拆分
    if (intent.complexity === 'medium' && !intent.needsSubAgents) {
      return {
        id: planId,
        goal: intent.summary,
        intent,
        subtasks: [{
          id: 't1', title: intent.category === 'code' ? '执行代码任务' : '执行任务',
          description: message,
          agentType: intent.category === 'code' ? 'code' : 'explore',
          dependsOn: [],
          status: 'pending',
        }],
        parallelGroups: [['t1']],
        stages: this.inferStages(intent, message),
      };
    }

    // 复杂任务: LLM 规划 (只有这里才调LLM)
    try {
      const res = await this.router.chat({
        model: this.masterModel as ProviderId,
        messages: [
          { role: 'system', content: TASK_PLANNER_PROMPT },
          { role: 'user', content: `用户意图: ${intent.summary}\n复杂度: ${intent.complexity}\n隐含需求: ${intent.impliedNeeds.join(', ')}\n原始消息: ${message}` },
        ],
        tools: [],
        userId: this.userId,
        workspace: this.workspace,
      });

      const json = this.extractJson(res.content);
      if (json?.subtasks) {
        return {
          id: planId,
          goal: intent.summary,
          intent,
          subtasks: json.subtasks.map((t: any, i: number) => ({
            id: t.id || `t${i + 1}`,
            title: t.title || `子任务 ${i + 1}`,
            description: t.description || '',
            agentType: t.agentType || 'explore',
            dependsOn: t.dependsOn || [],
            status: 'pending' as const,
          })),
          parallelGroups: json.parallelGroups || [json.subtasks.map((_: any, i: number) => `t${i + 1}`)],
          stages: this.inferStages(intent, message),
        };
      }
    } catch {}

    // 降级: 单步规划
    return {
      id: planId,
      goal: intent.summary,
      intent,
      subtasks: [{
        id: 't1', title: '执行任务',
        description: message,
        agentType: intent.category === 'code' ? 'code' : 'explore',
        dependsOn: [],
        status: 'pending',
      }],
      parallelGroups: [['t1']],
      stages: this.inferStages(intent, message),
    };
  }

  /**
   * 分派子Agent执行 (并行组)
   */
  async executePlan(plan: ExecPlan, parentModel?: string, parentContext?: any[]): Promise<SubTask[]> {
    const results: SubTask[] = [];

    for (const group of plan.parallelGroups) {
      const groupTasks = group
        .map(id => plan.subtasks.find(t => t.id === id))
        .filter(Boolean) as SubTask[];

      // 并行执行
      const groupResults = await Promise.all(
        groupTasks.map(task => this.executeSubTask(task, parentModel, parentContext))
      );
      results.push(...groupResults);
    }

    return results;
  }

  /**
   * 执行单个子任务 (创建独立 AgentAILoop)
   * 路由:
   *   - media → Agnes (免费, 多模态: 生图/视频)
   *   - explore/verify → Agnes (免费, 工具调用)
   *   - code/write/data → DeepSeek Flash (代码+推理)
   */
  async executeSubTask(task: SubTask, parentModel?: string, parentContext?: any[]): Promise<SubTask> {
    task.status = 'running';
    this.emit('subtask:start', task);

    // 智能模型选择 (优先使用父模型, 但检查可用性)
    let subModel: string;
    if (parentModel) {
      subModel = parentModel;  // 继承父 Agent 的模型
    } else if (task.agentType === 'media') {
      subModel = this.multimodalModel;
    } else if (['code', 'write', 'data', 'search'].includes(task.agentType)) {
      subModel = this.masterModel;
    } else {
      subModel = this.subagentModel;
    }

    // 检查模型可用性: 如果 provider 被熔断, 降级到免费模型
    const providerStats = (this.router as any)?.providers?.get(subModel);
    const keyMap: Record<string, string> = {
      agentai: 'AGENTAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY', cline: 'CLINE_API_KEY',
    };
    const envKey = keyMap[subModel];
    const hasKey = !!(envKey && process.env[envKey]);
    if (providerStats?.tripped || !hasKey) {
      const fallback = process.env.AGENTAI_API_KEY ? 'agentai' : (process.env.CLINE_API_KEY ? 'cline' : subModel);
      if (fallback !== subModel) {
        console.warn(`[master] subtask ${task.id}: model ${subModel} unavailable, falling back to ${fallback}`);
        subModel = fallback;
      }
    }

    this.emit('subtask:model', { taskId: task.id, model: subModel, agentType: task.agentType });

    try {
      const { AgentAILoop } = await import('./agentai-loop.js');

      // 注入父Agent上下文到子Agent
      const initialMessages: any[] = [];
      if (parentContext && parentContext.length > 0) {
        const recentContext = parentContext.slice(-6); // 最近3轮对话
        initialMessages.push({
          role: 'system',
          content: `[父Agent上下文]\n${recentContext
            .filter((m: any) => m.role === 'user' || m.role === 'assistant')
            .map((m: any) => `[${m.role}]: ${(typeof m.content === 'string' ? m.content : '').slice(0, 200)}`)
            .join('\n')}\n\n请基于以上上下文执行子任务。`,
        });
      }
      // 关键: 子Agent必须行动, 不能只分析
      initialMessages.push({
        role: 'system',
        content: `[子任务指令] 你是子Agent, 负责执行具体任务。规则:\n1. 必须调用工具执行操作, 不要只描述不行动\n2. 读文件 → 分析 → 修改/创建文件 → 验证\n3. 遇到错误 → 修复 → 重试\n4. 完成后在回复中明确说"任务已完成"`,
      });

      const subLoop = new AgentAILoop(this.router, this.registry, initialMessages, {
        maxIterations: 20,
        userId: this.userId,
        workspace: this.workspace,
        model: subModel,
      });

      const result = await subLoop.run(task.description);
      task.result = result.content;
      task.status = 'done';
    } catch (e: any) {
      task.result = `Error: ${e.message}`;
      task.status = 'failed';
    }

    this.emit('subtask:end', task);
    return task;
  }

  /**
   * 结果汇总
   */
  async synthesize(goal: string, subtasks: SubTask[]): Promise<string> {
    try {
      const summaries = subtasks
        .map(t => `[${t.status}] ${t.title}: ${t.result?.slice(0, 500) || ''}`)
        .join('\n\n');

      const res = await this.router.chat({
        model: this.masterModel as ProviderId,
        messages: [
          { role: 'system', content: '你是任务汇总助手。根据子任务结果，生成一份简洁的总结报告给用户。拟人口吻，先说结果。' },
          { role: 'user', content: `目标: ${goal}\n\n子任务结果:\n${summaries}\n\n请生成总结:` },
        ],
        tools: [],
        userId: this.userId,
        workspace: this.workspace,
      });

      return res.content || '任务完成';
    } catch {
      return subtasks.map(t => t.result).join('\n\n');
    }
  }

  // ========== helpers ==========

  private extractJson(text: string): any {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
  }

  private heuristicIntent(msg: string): IntentResult {
    const lower = msg.toLowerCase();
    const hasCode = /代码|coding|写|code|函数|类|组件|bug|修复|优化|重构|实现|开发/.test(msg);
    const hasCreate = /创建|新建|生成|做一个|帮我写/.test(msg);
    const hasMedia = /图片|视频|画像|生成图|生图|合成/.test(msg);
    const hasSearch = /搜索|查|找|search|find|在哪里/.test(msg);
    const hasReview = /审查|review|检查|审计/.test(msg);

    let category: IntentResult['category'] = 'chat';
    if (hasCode && hasReview) category = 'review';
    else if (hasCode) category = 'code';
    else if (hasCreate) category = 'create';
    else if (hasMedia) category = 'media';
    else if (hasSearch) category = 'search';

    const isComplex = msg.length > 50 || hasCode || hasCreate;
    const needsSubAgents = msg.length > 100 && (hasCode || hasCreate);

    return {
      category,
      confidence: 0.6,
      complexity: isComplex ? (needsSubAgents ? 'complex' : 'medium') : 'simple',
      needsSubAgents,
      entities: [],
      impliedNeeds: [],
      missingInfo: [],
      summary: msg.slice(0, 100),
    };
  }
}
