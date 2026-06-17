// @ts-nocheck
/**
 * Chat Routes - 主对话 API (含 SSE 流式 + MasterController 编排)
 * 提取自 index.ts, 包含 /v1/chat 端点
 * v2: MasterController 前置 → 意图理解→规划→分派子Agent
 */
import { Router, Request, Response } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import { AgentAILoop, addTrustedPattern, getTrustedPatterns, removeTrustedPattern } from '../agentai-loop.js';
import { MasterController } from '../master-controller.js';
import { writeMemory, readMemory } from '../memory.js';
import fs from 'fs';
import path from 'path';
import { WorkspaceManager } from '../workspace-manager.js';
import { RateLimiter } from '../rate-limit.js';

// 速率限制器: 动态区分内部/外部调用
const limiter = new RateLimiter();

/** monorepo 根目录 (gateway 在 packages/agentai-gateway, 向上两级) */
const PROJECT_ROOT = path.resolve(process.cwd(), '..', '..');

export interface ChatRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessionManager: any;  // SessionManager
  frameworkSwitcher?: any; // FrameworkSwitcher
  persistentMemory?: any; // PersistentMemory
  fts5Memory?: any;  // FTS5Memory
  userModel?: any;   // UserModel
  industryEngine?: any; // IndustryEngine
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const r = Router();
  const { router, registry, sessionManager, frameworkSwitcher, persistentMemory, fts5Memory, userModel, industryEngine } = deps;

  // 定期同步可用 provider 数量到 limiter (每 30 秒)
  setInterval(() => {
    const available = Array.from((router as any).providers?.values() || [])
      .filter((p: any) => !p.tripped).length;
    limiter.setAvailableProviders(Math.max(1, available));
  }, 30_000);

  // 活跃loop追踪 — 用于中断正在运行的任务
  const activeLoops = new Map<string, { loop: AgentAILoop; abort: () => void }>();

  // 待审批计划存储 — 规划模式审批后等待用户确认
  const pendingPlans = new Map<string, { execPlan: any; message: string; userId: string; workspace: string; sessionId: string; profile?: any; model?: string; displayModel: string }>();

  // 中断当前任务端点
  r.post('/v1/chat/abort', (req: Request, res: Response) => {
    const { sessionId } = req.body || {};
    const key = sessionId || 'default';
    const entry = activeLoops.get(key);
    if (entry) {
      entry.abort();
      activeLoops.delete(key);
      res.json({ ok: true, message: '任务已中断' });
    } else {
      res.json({ ok: true, message: '无活跃任务' });
    }
  });

  /**
   * 审批端点 — 处理两种审批:
   * 1. 文件修改审批 (approvalId 非空): 通知 loop 继续/拒绝
   * 2. 规划模式审批 (approvalId 为空, pendingPlans 有数据): 确认执行计划
   */
  r.post('/v1/chat/approve', async (req: Request, res: Response) => {
    try {
      const { sessionId, approvalId, decision } = req.body || {};
      const key = sessionId || 'default';

      // Case 1: 文件修改审批 → 通过 loop.resolveApproval 解决等待
      if (approvalId) {
        const entry = activeLoops.get(key);
        if (entry?.loop) {
          const ok = entry.loop.resolveApproval(approvalId, decision === 'approve');
          if (ok) {
            res.json({ ok: true, message: decision === 'approve' ? '已批准' : '已拒绝' });
          } else {
            res.status(404).json({ ok: false, error: '审批ID不存在或已过期' });
          }
          return;
        }
        // loop 可能已结束但审批还没来，尝试所有 activeLoops
        for (const [, e] of activeLoops) {
          if (e.loop.resolveApproval(approvalId, decision === 'approve')) {
            res.json({ ok: true, message: decision === 'approve' ? '已批准' : '已拒绝' });
            return;
          }
        }
        res.status(404).json({ ok: false, error: '未找到对应的活跃任务' });
        return;
      }

      // Case 2: 规划模式审批 → 从 pendingPlans 取出并执行
      const plan = pendingPlans.get(key);
      if (plan) {
        pendingPlans.delete(key);
        if (decision === 'approve') {
          // 异步执行已批准的计划
          executePlan(plan, deps).then(
            () => res.json({ ok: true, message: '计划已开始执行' }),
            (err: any) => res.status(500).json({ ok: false, error: err?.message || '执行失败' }),
          );
        } else {
          res.json({ ok: true, message: '计划已取消', rejected: true });
        }
        return;
      }

      res.status(404).json({ ok: false, error: '无待审批项' });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || '审批处理失败' });
    }
  });

  // ═══ 审批白名单路由 ═══
  /** GET /v1/trusted-commands — 获取已信任的命令模式 */
  r.get('/v1/trusted-commands', (_req: Request, res: Response) => {
    res.json({ patterns: getTrustedPatterns() });
  });

  /** POST /v1/trusted-commands — 添加信任模式 */
  r.post('/v1/trusted-commands', (req: Request, res: Response) => {
    const { toolName, pathPattern } = req.body || {};
    if (!toolName || !pathPattern) {
      res.status(400).json({ error: 'toolName and pathPattern required' });
      return;
    }
    addTrustedPattern(toolName, pathPattern);
    res.json({ ok: true, patterns: getTrustedPatterns() });
  });

  /** DELETE /v1/trusted-commands — 移除信任模式 */
  r.delete('/v1/trusted-commands', (req: Request, res: Response) => {
    const { toolName, pathPattern } = req.body || {};
    if (!toolName || !pathPattern) {
      res.status(400).json({ error: 'toolName and pathPattern required' });
      return;
    }
    removeTrustedPattern(toolName, pathPattern);
    res.json({ ok: true, patterns: getTrustedPatterns() });
  });

  // 行业激活 (支持动态切换)
  let currentIndustryId = '';
  const tryActivateIndustry = (reqBody: any) => {
    if (!industryEngine) return;
    const profile = reqBody?.profile;
    const newIndustry = profile?.industry || 'general';
    // 行业变化时重新激活
    if (newIndustry !== currentIndustryId) {
      const config = industryEngine.activate(newIndustry);
      if (config) {
        // 注册行业技能到 ToolRegistry
        for (const skill of config.skills) {
          registry.register({
            name: skill.name,
            description: skill.description,
            parameters: { type: 'object', properties: { filePath: { type: 'string' } }, additionalProperties: true },
            parallelSafe: true,
            riskLevel: 'low',
            handler: skill.handler,
          });
        }
        currentIndustryId = newIndustry;
        console.log(`[industry] activated: ${newIndustry}, +${config.skills.length} tools`);
      } else if (newIndustry === 'general') {
        // 切回通用: 清除行业状态
        currentIndustryId = 'general';
        console.log(`[industry] switched to general (no industry)`);
      }
    }
  };

  // 健康检查端点
  r.get('/v1/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      tools: registry.list().length,
      cwd: PROJECT_ROOT,
    });
  });

  r.post('/v1/chat', async (req: Request, res: Response) => {
    const { message, userId = 'default', workspace: rawWorkspace, projectDir: rawProjectDir, framework, stream = false, profile, model: requestModel, emotion, contextWindow, _internal, attachments, thinking, systemRules, modelConfig } = req.body;

    // 速率限制检查 (内部调用使用更高限制)
    const isInternal = !!_internal;
    const rl = limiter.check(userId, isInternal);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfter || 60));
      return res.status(429).json({ error: rl.reason, retryAfter: rl.retryAfter });
    }

    try {
      // 允许纯图片消息: 有附件时 message 可以为空
      if (!message && (!attachments || attachments.length === 0)) {
        return res.status(400).json({ error: 'message required' });
      }

      // 内部请求 (如情绪分析) 不写入记忆, 不走编排
      const isInternal = !!_internal;

      // 动态设置项目目录: projectDir > workspace > PROJECT_ROOT
      const wm = WorkspaceManager.getInstance();
      if (rawProjectDir && fs.existsSync(rawProjectDir)) {
        try {
          wm.setProjectDir(rawProjectDir);
        } catch {}
      } else if (rawWorkspace && fs.existsSync(rawWorkspace)) {
        try {
          wm.setProjectDir(rawWorkspace);
        } catch {}
      }
      const workspace = wm.projectDir;
      if (!fs.existsSync(workspace)) {
        console.warn(`[chat] project dir "${workspace}" not found, falling back to cwd`);
      }

      // 行业激活 (从用户传入的 profile 读取)
      tryActivateIndustry(req.body);

      // 更新用户身份 (从 profile 读取完整数据: 姓名/行业/用例/技能)
      if (userModel && profile) {
        if (profile.name) {
          userModel.setIdentity({
            name: profile.name,
            industry: profile.industry,
            role: profile.useCase,
            industrySkills: profile.industrySkills,
            onboardedAt: profile.onboardedAt,
          });
        }
        // 持久化问卷答案到 ~/.agentai/questionnaire.json
        if (profile.questionnaire && typeof profile.questionnaire === 'object' && Object.keys(profile.questionnaire).length > 0) {
          try {
            const qPath = path.join(require('os').homedir(), '.agentai', 'questionnaire.json');
            const qDir = path.dirname(qPath);
            if (!fs.existsSync(qDir)) fs.mkdirSync(qDir, { recursive: true });
            fs.writeFileSync(qPath, JSON.stringify({
              industry: profile.industry || '',
              answers: profile.questionnaire,
              updatedAt: Date.now(),
            }, null, 2), 'utf-8');
            // 同步问卷到 UserModel identity (用于 system prompt)
            userModel.setIdentity({ questionnaire: profile.questionnaire });
          } catch (e: any) {
            console.warn('[chat] questionnaire persist failed:', e?.message);
          }
        }
      }

      await writeMemory({ userId, workspace, role: 'user', content: message, source: 'session' });

      // FTS5: 记录用户消息
      if (fts5Memory) {
        fts5Memory.recordMessage({ sessionId: userId, userId, workspace, role: 'user', content: message }).catch(() => {});
      }

      // ====== SSE 流式 ======
      if (stream === true) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const sendEvent = (event: string, data: any) => {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // ====== 请求队列: 同 session 串行, 防止并发覆盖 ======
        const queueKey = `queue:${userId}:${workspace}`;
        if (!(global as any).__msgQueues) (global as any).__msgQueues = new Map<string, Promise<any>>();
        const queues = (global as any).__msgQueues;
        const prev = queues.get(queueKey) || Promise.resolve();
        let queueResolve: () => void;
        const next = new Promise<void>(r => { queueResolve = r; });
        queues.set(queueKey, prev.then(() => next));
        await prev; // 等前面的消息处理完

        // ====== 模型映射: 前端 ID → provider + subModel ======
        const MODEL_MAP: Record<string, { provider: string; subModel?: string; label: string; baseURL?: string }> = {
          'agentai': { provider: 'agentai', label: 'Agnes AI Flash' },
          'deepseek': { provider: 'deepseek', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
          'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
          'openai': { provider: 'openai', label: 'OpenAI GPT-4o' },
          'cline': { provider: 'cline', label: 'Cline DS Flash' },
          'zhipu': { provider: 'zhipu', subModel: 'glm-4-flash', label: '智谱 GLM-4 Flash' },
        };

        // 动态注册自定义模型 (前端通过 modelConfig 传递)
        if (modelConfig && requestModel && !MODEL_MAP[requestModel]) {
          MODEL_MAP[requestModel] = {
            provider: modelConfig.provider || requestModel,
            subModel: modelConfig.modelName,
            label: modelConfig.modelName || requestModel,
            baseURL: modelConfig.baseURL,
          };
        }

        // ====== 智能模型选择: 检查 provider 是否可用 (欠费/无Key → 自动降级) ======
        function selectAvailableModel(requestedModel?: string): { provider: string; subModel?: string; label: string; fallback?: boolean; baseURL?: string } {
          const mapped = MODEL_MAP[requestedModel || ''] || MODEL_MAP['agentai'];
          // 检查请求的 provider 是否有 API Key
          const keyMap: Record<string, string> = {
            agentai: 'AGENTAI_API_KEY',
            deepseek: 'DEEPSEEK_API_KEY',
            openai: 'OPENAI_API_KEY',
            cline: 'CLINE_API_KEY',
            zhipu: 'ZHIPU_API_KEY',
          };
          const envKey = keyMap[mapped.provider] || `${mapped.provider.toUpperCase()}_API_KEY`;
          const hasKey = !!process.env[envKey];
          // 检查 provider 是否被熔断
          const providerStats = router['providers']?.get(mapped.provider);
          const isTripped = providerStats?.tripped === true;

          if (hasKey && !isTripped) {
            return { ...mapped, fallback: false };
          }

          // 降级: 按优先级尝试免费模型 (agentai > cline)
          const fallbackOrder = ['agentai', 'cline'];
          for (const fb of fallbackOrder) {
            if (fb !== mapped.provider && process.env[keyMap[fb]] && !router['providers']?.get(fb)?.tripped) {
              const fbMapped = MODEL_MAP[fb];
              console.warn(`[chat] model ${mapped.provider} unavailable (key=${hasKey}, tripped=${isTripped}), falling back to ${fb}`);
              return { ...fbMapped, fallback: true };
            }
          }
          // 最终回退到 agentai (即使没key也会返回no-key消息)
          return { ...MODEL_MAP['agentai'], fallback: mapped.provider !== 'agentai' };
        }

      try {
        const sessionKey = `${userId}:${workspace}`;
        let loop: any;
        let sessionId: string;
        const sessionData = sessionManager.getWithExtra?.(sessionKey) ?? sessionManager.get(sessionKey);
        if (!sessionData) {
          const selected = selectAvailableModel(requestModel);
          const userPickedModel = !!requestModel && requestModel in MODEL_MAP;
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: 30, userId, workspace, persistentMemory,
            model: selected.provider,
            modelName: selected.subModel || '',
            displayModelLabel: selected.label,
            userPickedModel,
            emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
            modelConfig: selected.baseURL ? { baseURL: selected.baseURL, modelName: selected.subModel || '', provider: selected.provider } : modelConfig,
          });
          const master = new MasterController({
            router, registry, userId, workspace,
            masterModel: selected.provider === 'deepseek' ? 'deepseek' : 'agentai',
            proModel: 'deepseek',
            multimodalModel: 'agentai', subagentModel: 'agentai',
          });
          // 如果发生了降级, 通知前端
          if (selected.fallback) {
            sendEvent('model_fallback', { from: requestModel, to: selected.label, reason: '原模型不可用，已自动切换' });
          }
          sessionManager.set(sessionKey, { loop, master, userId, workspace, callCount: 1 });
          sessionId = loop.getContext().sessionId;
          if (persistentMemory) {
            persistentMemory.createCheckpoint(sessionId, userId, workspace);
            persistentMemory.addMessage(sessionId, { role: 'user', content: message });
          }
        } else {
          loop = sessionData.loop;
          sessionId = loop.getContext().sessionId;
          // 只在用户手动选择时覆盖模型（保护智能切换结果）
          if (requestModel && loop.opts?.userPickedModel) {
            const mapped = MODEL_MAP[requestModel];
            if (mapped && mapped.provider !== loop.opts?.model) {
              loop.opts.model = mapped.provider;
              loop.opts.modelName = mapped.subModel || '';
              loop.opts.displayModelLabel = mapped.label;
              loop.opts.modelConfig = mapped.baseURL ? { baseURL: mapped.baseURL, modelName: mapped.subModel || '', provider: mapped.provider } : modelConfig;
            }
          }
        }
        const resSessionId = sessionId;
        // 使用的模型显示名
        const displayModel = MODEL_MAP[requestModel]?.label || (requestModel || 'Agnes AI');

        // 立即发送 thinking 事件 (消除空白等待感)
        sendEvent('thinking', { msg: '正在思考...' });

        // ====== 跨会话记忆注入: 每次对话都加载历史上下文 ======
        if (persistentMemory && sessionId) {
          try {
            const lastMsgs = persistentMemory.getMessages(sessionId);
            if (lastMsgs?.length) {
              const recent = lastMsgs.slice(-10); // 最近 10 条(5 轮对话)
              const summary = recent
                .filter((m:any) => m.role === 'user' || m.role === 'assistant')
                .map((m:any) => `[${m.role}]: ${(typeof m.content === 'string' ? m.content : '').slice(0, 200)}`)
                .join('\n');
              if (summary) {
                const isContinuation = /^(继续|接着|接着做|上次|之前|刚才|那个|go on|continue)/i.test(message.trim());
                loop.context?.appendOnlyLog?.push({
                  role: 'system',
                  content: `[会话历史 — 最近对话]\n${summary}\n\n${isContinuation ? '用户说"继续"，请基于以上上下文继续执行未完成的任务。' : '以上是本会话的最近对话记录，请保持上下文连贯。'}`,
                });
              }
            }
          } catch {}
        }

        // 注册流式 delta 监听 (提前注册, loop.run 内触发)
        loop.on('llm:delta', (info: { delta: string }) => {
          sendEvent('delta', { delta: info.delta });
        });
        // 深度思考过程: Agnes AI thinking 模式的思考内容
        loop.on('llm:thinking', (info: { text: string }) => {
          sendEvent('thinking', { text: info.text });
        });
        // 子Agent 进度监听 → 前端可见
        loop.on('subagent:start', (info: any) => {
          sendEvent('subagent_start', { id: info.id, type: info.type, task: info.task });
        });
        loop.on('subagent:done', (info: any) => {
          sendEvent('subagent_done', { id: info.id, result: info.result });
        });
        loop.on('subagent:error', (info: any) => {
          sendEvent('subagent_error', { id: info.id, error: info.error });
        });
        loop.on('tool:stuck', (info: any) => {
          sendEvent('tool_stuck', { tool: info.tool, count: info.count });
        });
        // 关键修复: 转发工具调用事件到前端 (之前缺失!)
        loop.on('tool:start', (info: any) => {
          sendEvent('tool_start', { callId: info.callId, name: info.name, args: info.args });
        });
        loop.on('tool:result', (info: any) => {
          sendEvent('tool_result', { callId: info.callId, name: info.name, result: info.result, ok: info.ok, durationMs: info.durationMs });
        });
        // 推理过程: LLM调工具前的思考内容 → 前端展示为可折叠卡片
        loop.on('reasoning', (info: any) => {
          sendEvent('reasoning', { text: info.text });
        });
        // 自主修复: 系统检测到错误并自动修复 → 前端展示修复过程
        loop.on('auto:fix', (info: any) => {
          sendEvent('auto_fix', { type: info.type, module: info.module, tool: info.tool, error: info.error });
        });
        // 关键修复: 转发追问事件到前端 (之前缺失!)
        loop.on('ask_user', (info: any) => {
          sendEvent('ask_user', { question: info.question, options: info.options, sessionId: info.sessionId });
        });
        // 关键修复: 转发审批事件到前端 (之前缺失!)
        loop.on('approval:required', (info: any) => {
          sendEvent('approval_required', { id: info.id, type: info.type, filePath: info.filePath, summary: info.summary, riskLevel: info.riskLevel, diff: info.diff });
        });
        // 关键修复: 转发智能模型切换事件到前端
        loop.on('model:auto-switched', (info: any) => {
          sendEvent('model_fallback', { from: info.from, to: info.to, reason: info.reason || '连续熔断自动切换' });
        });
        loop.on('model:need-api-key', (info: any) => {
          // 根据 provider 匹配获取地址
          const keyUrlMap: Record<string, string> = {
            agentai: 'https://platform.agnes-ai.com/',
            deepseek: 'https://platform.deepseek.com/api_keys',
            openai: 'https://platform.openai.com/api-keys',
            zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
            cline: 'https://cline.bot',
          };
          const keyUrl = keyUrlMap[info.provider] || '';
          sendEvent('ask_user', {
            question: `当前免费模型不可用，建议使用 ${info.provider || '商用API'} 获得更好体验。预估成本: ¥${(info.estimatedCost || 0).toFixed(4)}/千token`,
            options: [
              { id: 'get_key', title: '前往获取密钥', description: keyUrl || '请在对应平台官网获取 API Key' },
              { id: 'provide_key', title: '我已有密钥', description: '在设置页面配置或在此输入' },
              { id: 'continue_free', title: '继续使用免费模型', description: '可能会慢或失败' },
            ],
          });
        });

        // ====== 统一注入附件到上下文 (MasterController/loop.run 都能收到) ======
        let runMessage: string | { content: any[] } = message;
        if (attachments && Array.isArray(attachments) && attachments.length > 0) {
          const attachmentParts: string[] = [];
          const imageBlocks: any[] = [];
          for (const att of attachments) {
            if (att.kind === 'image' && att.dataUrl) {
              imageBlocks.push({ type: 'image_url', image_url: { url: att.dataUrl } });
            } else if (att.content) {
              attachmentParts.push(`--- 附件: ${att.name} ---\n${att.content}\n--- 附件结束 ---`);
            }
          }
          if (imageBlocks.length > 0) {
            const textContent = message || '请查看上传的图片';
            runMessage = { content: [{ type: 'text', text: textContent }, ...imageBlocks] } as any;
          }
          if (attachmentParts.length > 0) {
            loop.context?.appendOnlyLog?.push({
              role: 'user',
              content: `[用户上传了以下文件, 请仔细阅读并分析]\n\n${attachmentParts.join('\n\n')}`,
            });
          }
        }

        // ====== 意图分类 (只用启发式, 不调 LLM) ======
        const master = sessionData?.master || new MasterController({
          router, registry, userId, workspace,
          masterModel: 'deepseek', proModel: 'deepseek',
          multimodalModel: 'agentai', subagentModel: 'agentai',
        });
        const { execPlan, shouldAutoRun } = await master.orchestrate(message);

        // ====== 执行分支 ======
        let finalContent: string = '';
        let finalProvider: string = '';
        let finalUsage: any = {};
        let finalToolCalls: any;
        let finalIterations: any;

        // 规划模式: 非简单任务只规划不执行, 等用户确认
        const reqMode = req.body?.mode || 'auto';
        const isPlanningMode = reqMode === 'planning';
        // 规划模式下: simple直接回复, 其他一律先展示审核卡片
        const needPlanApproval = isPlanningMode && execPlan.intent.complexity !== 'simple';

        if (needPlanApproval) {
          // 存储计划到 pendingPlans, 等待用户通过 /v1/chat/approve 确认
          pendingPlans.set(sessionId || 'default', {
            execPlan, message, userId, workspace, sessionId: sessionId || 'default',
            profile: req.body?.profile, model: requestModel, displayModel,
          });
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: execPlan.stages, currentStage: execPlan.stages[0]?.key || 'plan',
            intent: execPlan.intent,
            subtasks: execPlan.subtasks.map(s => ({ id: s.id, title: s.title, description: s.description, status: s.status, agentType: s.agentType })),
            subtaskCount: execPlan.subtasks.length, autoRun: false,
            needsApproval: true, // 标记需要用户确认
          });
          // 发送规划结果, 不执行
          const planSummary = `📋 任务规划完成 (规划模式 — 需确认后执行)\n\n目标: ${execPlan.goal}\n复杂度: ${execPlan.intent.complexity}\n\n子任务:\n${execPlan.subtasks.map((s, i) => `${i + 1}. [${s.agentType}] ${s.title}\n   ${s.description.slice(0, 100)}`).join('\n')}\n\n请确认是否执行, 或修改任务后执行。`;
          sendEvent('delta', { delta: planSummary });
          sendEvent('done', { provider: 'master-controller', displayModel, content: planSummary, usage: {}, needsApproval: true });
          finalContent = planSummary;
          finalProvider = 'master-controller';
        } else if (!shouldAutoRun && execPlan.subtasks.length > 1) {
          // 复杂任务: 分派子Agent 并行执行
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: execPlan.stages, currentStage: execPlan.stages[0]?.key || 'plan',
            intent: execPlan.intent,
            subtasks: execPlan.subtasks.map(s => ({ id: s.id, title: s.title, status: s.status, agentType: s.agentType })),
            subtaskCount: execPlan.subtasks.length, autoRun: false });

          // 监听子任务事件并转发到前端
          const onSubtaskStart = (task: any) => {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'solve', status: 'running', taskId: task.id, taskTitle: task.title });
            sendEvent('delta', { delta: `\n🔄 子任务 [${task.title}] 开始执行...\n` });
          };
          const onSubtaskEnd = (task: any) => {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: task.status === 'done' ? 'verify' : 'solve', status: task.status, taskId: task.id, taskTitle: task.title });
            const icon = task.status === 'done' ? '✅' : '❌';
            sendEvent('delta', { delta: `\n${icon} 子任务 [${task.title}] ${task.status === 'done' ? '完成' : '失败'}: ${(task.result || '').slice(0, 200)}\n` });
          };
          const onSubtaskModel = (info: any) => {
            sendEvent('delta', { delta: `\n🤖 使用模型: ${info.model} (${info.agentType})\n` });
          };
          master.on('subtask:start', onSubtaskStart);
          master.on('subtask:end', onSubtaskEnd);
          master.on('subtask:model', onSubtaskModel);

          try {
            const subtaskResults = await master.executePlan(execPlan, loop.opts.model, loop.context?.appendOnlyLog);
            const synthesis = await master.synthesize(execPlan.goal, subtaskResults);
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
            sendEvent('delta', { delta: `\n\n---\n📋 任务汇总:\n${synthesis}` });
            sendEvent('done', { provider: 'master-controller', displayModel, content: synthesis, usage: {}, subtasks: subtaskResults.map(r => ({ id: r.id, title: r.title, status: r.status })) });
            finalContent = synthesis;
            finalProvider = 'master-controller';
          } finally {
            master.off('subtask:start', onSubtaskStart);
            master.off('subtask:end', onSubtaskEnd);
            master.off('subtask:model', onSubtaskModel);
          }
        } else if (!shouldAutoRun) {
          // 单子任务但非简单: 也由主控执行 (不通过 loop.run 多轮)
          const sub = execPlan.subtasks[0];
          sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
            stages: execPlan.stages, currentStage: execPlan.stages[0]?.key || 'solve',
            intent: execPlan.intent,
            subtasks: [{ id: sub.id, title: sub.title, status: sub.status, agentType: sub.agentType }],
            subtaskCount: 1, autoRun: false });

          // 监听子任务事件
          const onSubtaskStart = (task: any) => {
            sendEvent('delta', { delta: `\n🔄 执行: [${task.title}]...\n` });
          };
          const onSubtaskEnd = (task: any) => {
            const icon = task.status === 'done' ? '✅' : '❌';
            sendEvent('delta', { delta: `\n${icon} [${task.title}] ${task.status === 'done' ? '完成' : '失败'}\n` });
          };
          master.on('subtask:start', onSubtaskStart);
          master.on('subtask:end', onSubtaskEnd);

          try {
            const result = await master.executeSubTask(sub, loop.opts.model, loop.context?.appendOnlyLog);
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
            sendEvent('delta', { delta: result.result || '(empty)' });
            sendEvent('done', { provider: 'master-controller', displayModel, content: result.result, usage: {} });
            finalContent = result.result || '';
            finalProvider = 'master-controller';
          } finally {
            master.off('subtask:start', onSubtaskStart);
            master.off('subtask:end', onSubtaskEnd);
          }
        } else {
          // 简单/中等任务: AgentAILoop 直接执行 (含自动继续 + 工具调用)
          // 只有非simple任务才显示编排器面板
          if (execPlan.intent.complexity !== 'simple') {
            sendEvent('plan_created', { chainId: execPlan.id, goal: execPlan.goal,
              stages: execPlan.stages, currentStage: execPlan.stages[0]?.key || 'solve',
              intent: execPlan.intent, subtaskCount: 1, autoRun: true });
          }

          // 注入意图提示到 loop 上下文
          const alreadyHints = loop.context?.appendOnlyLog?.filter(
            (m: any) => m.role === 'system' && m.content?.startsWith('[意图评估]')
          );
          if (!alreadyHints?.length) {
            loop.context?.appendOnlyLog?.push({
              role: 'system',
              content: `[意图评估] ${execPlan.intent.summary} (类别: ${execPlan.intent.category})`,
            });
          }

          // 监听loop的工具调用事件, 推进编排器stage
          const onToolStart = () => {
            if (execPlan.intent.complexity !== 'simple') {
              sendEvent('plan_stage', { chainId: execPlan.id, stage: 'solve', status: 'running' });
            }
          };
          const onToolEnd = (info: any) => {
            // 不再每次工具调用都推进到verify, 只更新solve进度
            // verify和report在loop完成后统一推进
          };
          loop.on('tool:start', onToolStart);
          loop.on('tool:end', onToolEnd);

          // 注册loop到活跃追踪 (可被abort端点中断)
          let loopAborted = false;
          const abortHandler = () => { loopAborted = true; loop.abort(); };
          activeLoops.set(sessionId || 'default', { loop, abort: abortHandler });

          // 注入前端系统规则 (文件时间线/版本回退/浏览器元素识别等)
          if (systemRules && loop.context?.immutablePrefix) {
            loop.context.immutablePrefix.push({
              role: 'system',
              content: systemRules,
            });
          }

          const response = await loop.run(runMessage);

          // 注销loop追踪
          activeLoops.delete(sessionId || 'default');

          if (loopAborted) {
            sendEvent('done', { provider: 'aborted', displayModel, content: '[任务已中断]', usage: {} });
            res.end();
            return;
          }

          // loop完成 → 推进到report
          loop.off('tool:start', onToolStart);
          loop.off('tool:end', onToolEnd);
          if (execPlan.intent.complexity !== 'simple') {
            sendEvent('plan_stage', { chainId: execPlan.id, stage: 'report', status: 'done' });
          }

          sendEvent('done', {
            provider: response?.provider || 'unknown',
            displayModel,
            usage: response?.usage,
            content: response?.content,
            toolCalls: response?.toolCalls,
            sessionId: resSessionId,
            iterations: response?.iterations,
          });
          finalContent = response?.content;
          finalProvider = response?.provider;
          finalUsage = response?.usage;
          finalToolCalls = response?.toolCalls;
          finalIterations = response?.iterations;
        }

        // 持久化 assistant 回复
        if (persistentMemory && finalContent) {
          persistentMemory.addMessage(resSessionId, { role: 'assistant', content: finalContent });
        }
        await writeMemory({
          userId, workspace, role: 'assistant', content: finalContent || '',
          metadata: { provider: finalProvider, durationMs: 0 }, source: isInternal ? 'internal' : 'session',
        });

        // 任务完成自动记忆: 写入项目记忆文件 (.agentai/memory.jsonl)
        // 内部请求 (如情绪分析) 不写入记忆, 避免污染
        if (!isInternal && finalContent && finalContent.length > 50) {
          try {
            const summary = finalContent.slice(0, 300).replace(/\n+/g, ' ').trim();
            await writeMemory({
              userId, workspace, role: 'system',
              content: `[任务完成] ${summary}`,
              metadata: {
                type: 'session_memory',
                scope: 'project',
                name: `task-${Date.now()}`,
                description: '自动记录完成的任务',
                provider: finalProvider,
              },
              source: 'auto_reflect',
            });
          } catch {}
        }

        // FTS5 深层记忆 + 用户建模
        if (fts5Memory && finalContent) {
          fts5Memory.recordMessage({ sessionId: resSessionId, userId, workspace, role: 'assistant', content: finalContent }).catch(() => {});
        }
        if (userModel && finalContent) {
          const toolNames = (finalToolCalls || []).map((t: any) => t.name || t.function?.name).filter(Boolean);
          userModel.recordInteraction({ toolsUsed: toolNames, messageCount: 1, model: finalProvider || 'unknown' });
          userModel.addHistorySnapshot({ summary: finalContent.slice(0, 200), sessionId: resSessionId, keyOutcomes: toolNames.length > 0 ? [`Used: ${toolNames.join(', ')}`] : [] });
        }

        res.end();
        queueResolve!();
        } catch (e: any) {
          const errMsg = String(e?.message || e);
          console.error(`[chat-stream] error: ${errMsg}`);
          // 先发 content delta 让用户看到错误, 再发 error 事件
          sendEvent('delta', { delta: `\n\n\`\`\`error\n${errMsg}\n\`\`\`` });
          sendEvent('error', { error: errMsg });
          res.end();
          queueResolve!();
        }
        return;
      }

      // Framework adapter
      if ((framework === 'openclaw' || framework === 'hermes') && frameworkSwitcher) {
        try {
          const res2 = await frameworkSwitcher.chat(
            [{ role: 'user', content: message }],
            { userId, workspace, tools: [] },
          );
          await writeMemory({
            userId, workspace, role: 'assistant',
            content: res2.content,
            metadata: { framework, provider: res2.provider, durationMs: res2.durationMs },
            source: 'session',
          });
          return res.json({
            content: res2.content,
            toolCalls: res2.toolCalls,
            provider: res2.provider,
            framework,
            usage: res2.usage,
            sessionId: `framework-${Date.now()}`,
          });
        } catch (e: any) {
          return res.status(500).json({ error: String(e) });
        }
      }

      // ====== 模型映射 (非流式路径共用) ======
      const nss_MODEL_MAP: Record<string, { provider: string; subModel?: string; label: string }> = {
        'agentai': { provider: 'agentai', label: 'Agnes AI Flash' },
        'deepseek': { provider: 'deepseek', subModel: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
        'deepseek-pro': { provider: 'deepseek', subModel: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
        'openai': { provider: 'openai', label: 'OpenAI GPT-4o' },
        'cline': { provider: 'cline', label: 'Cline DS Flash' },
        'zhipu': { provider: 'zhipu', subModel: 'glm-4-flash', label: '智谱 GLM-4 Flash' },
      };

      // 创建或获取 session (使用 SessionManager LRU)
      const sessionKey = `${userId}:${workspace}`;
      let loop: any;
      let isNewSession = false;
      let sessionData = sessionManager.get(sessionKey);
      if (!sessionData) {
        const mode = req.body?.mode || 'auto';
        const userModel = req.body?.model;
        const mapped = nss_MODEL_MAP[userModel];
        const userPicked = !!(mapped && mapped.provider);
        if (userPicked) {
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: 30, userId, workspace, mode,
            model: mapped.provider,
            modelName: mapped.subModel || '',
            displayModelLabel: mapped.label,
            userPickedModel: true,
            persistentMemory,
            emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
          });
        } else {
          const msg = (message || '').toLowerCase();
          const isSimple = msg.length < 15 && !/代码|审查|分析|重构|改|修|建|查|找|debug|review|refactor|implement|analyze|create|fix/.test(msg);
          const isDeepReason = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock/i.test(msg);
          const usePro = (mode === 'auto' || mode === 'planning' || mode === 'review') && isDeepReason;
          const useFlash = (mode === "auto" || mode === 'planning' || mode === 'review') && !isSimple && !isDeepReason;
          let chatModel = 'agentai';
          let modelName = '';
          if (usePro) { chatModel = 'deepseek'; modelName = 'deepseek-v4-pro'; }
          else if (useFlash) { chatModel = 'deepseek'; modelName = 'deepseek-v4-flash'; }
          loop = new AgentAILoop(router, registry, [], {
            maxIterations: 10, userId, workspace, mode, model: chatModel, modelName, persistentMemory, emotion,
            thinking: !!thinking,
            thinkingBudget: thinking ? 4096 : undefined,
          });
        }
        sessionManager.set(sessionKey, { loop, userId, workspace, callCount: 1 });
        sessionData = { loop, userId, workspace };
        isNewSession = true;
        // 创建持久化 checkpoint
        if (persistentMemory) {
          const sid = loop.getContext().sessionId;
          persistentMemory.createCheckpoint(sid, userId, workspace);
          persistentMemory.addMessage(sid, { role: 'user', content: message });
        }
      } else {
        // Session 已存在，持久化用户消息（追加到旧 checkpoint）
        if (persistentMemory) {
          persistentMemory.addMessage(sessionData.loop.getContext().sessionId, { role: 'user', content: message });
        }
      }
      const resSessionId = isNewSession ? loop.getContext().sessionId : sessionData.loop.getContext().sessionId;
      loop = sessionData.loop;

      // 收集工具事件
      const toolEvents: any[] = [];
      const onToolStart = (info: any) => toolEvents.push({ type: 'tool_start', callId: info.callId, name: info.name, args: info.args });
      const onToolResult = (info: any) => toolEvents.push({ type: 'tool_result', callId: info.callId, name: info.name, result: info.result, ok: info.ok, durationMs: info.durationMs });
      loop.on('tool:start' as any, onToolStart);
      loop.on('tool:result' as any, onToolResult);

      console.log('[chat:non-stream] calling loop.run with model=', loop.opts?.model);
      const response = await loop.run(message);
      console.log('[chat:non-stream] loop.run returned type=', typeof response, 'isNull=', response === null, 'isUndefined=', response === undefined);

      if (!response) {
        return res.status(500).json({ error: 'AI 处理失败，请重试' });
      }

      // 持久化 assistant 回复
      if (persistentMemory) {
        const sid = loop.getContext().sessionId;
        persistentMemory.addMessage(sid, { role: 'assistant', content: response.content || '' });
      }

      loop.off('tool:start' as any, onToolStart);
      loop.off('tool:result' as any, onToolResult);

      await writeMemory({
        userId, workspace, role: 'assistant', content: response.content || '',
        metadata: { provider: response.provider, cost: response.usage?.cost ?? 0, durationMs: response.durationMs ?? 0 },
        source: 'session',
      });

      res.json({
        content: response.content || '',
        toolCalls: response.toolCalls,
        provider: response.provider || 'unknown',
        usage: response.usage || {},
        toolEvents,
        sessionId: loop.getContext().sessionId,
      });
    } catch (e: any) {
      // 非流式: 返回详细错误信息
      const errMsg = e?.message || String(e);
      const errStack = e?.stack?.slice(0, 300) || '';
      console.error(`[chat] 500: ${errMsg}\n${errStack}`);
      res.status(500).json({
        error: errMsg,
        detail: errStack,
        hint: '检查后端日志和 API Key 配置 (AGENTAI_API_KEY)',
      });
    } finally {
      limiter.release(userId, isInternal);
    }
  });

  // ===== 记忆 API =====
  // 读取记忆 (前端右侧面板使用)
  r.get('/v1/memory', async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || 'default';
      const workspace = req.query.workspace as string || process.cwd();
      const limit = parseInt(req.query.limit as string) || 30;
      const mems = await readMemory({ userId, workspace, limit });
      res.json({ ok: true, memories: mems });
    } catch (e: any) {
      res.json({ ok: false, memories: [], error: e.message });
    }
  });

  // 手动写入记忆
  r.post('/v1/memory', async (req: Request, res: Response) => {
    try {
      const { userId = 'default', workspace = process.cwd(), role = 'system', content, metadata, source = 'manual' } = req.body;
      if (!content) { res.json({ ok: false, error: 'content required' }); return; }
      const entry = await writeMemory({ userId, workspace, role, content, metadata, source });
      res.json({ ok: true, entry });
    } catch (e: any) {
      res.json({ ok: false, error: e.message });
    }
  });

  /**
   * 执行已批准的计划 (规划模式审批后调用)
   * 直接用 loop 执行, 不走 SSE 流 — 结果写入记忆后前端下一次请求可见
   * TODO: 后续可升级为通过 Socket.IO 推送实时进度
   */
  async function executePlan(plan: any, planDeps: ChatRouterDeps): Promise<void> {
    const { execPlan, message: planMessage, userId: planUserId, workspace: planWorkspace, sessionId: planSessionId } = plan;
    const { router: planRouter, registry: planRegistry, sessionManager: planSessionMgr, persistentMemory: planPM } = planDeps;

    try {
      const sessionKey = `${planUserId}:${planWorkspace}`;
      const sessionData = planSessionMgr.get(sessionKey);

      // 创建或获取 loop
      let loop: AgentAILoop;
      let master: MasterController;
      if (sessionData?.loop) {
        loop = sessionData.loop;
        master = sessionData.master || new MasterController({
          router: planRouter, registry: planRegistry,
          userId: planUserId, workspace: planWorkspace,
          masterModel: 'deepseek', proModel: 'deepseek',
          multimodalModel: 'agentai', subagentModel: 'agentai',
        });
      } else {
        loop = new AgentAILoop(planRouter, planRegistry, [], {
          maxIterations: 30, userId: planUserId, workspace: planWorkspace, mode: 'planning',
          model: 'agentai', persistentMemory: planPM,
        });
        master = new MasterController({
          router: planRouter, registry: planRegistry,
          userId: planUserId, workspace: planWorkspace,
          masterModel: 'deepseek', proModel: 'deepseek',
          multimodalModel: 'agentai', subagentModel: 'agentai',
        });
        planSessionMgr.set(sessionKey, { loop, master, userId: planUserId, workspace: planWorkspace, callCount: 1 });
      }

      // 注入意图提示
      loop.context?.appendOnlyLog?.push({
        role: 'system',
        content: `[用户已确认执行规划] 目标: ${execPlan.goal}`,
      });

      // 根据 subtasks 数量选择执行方式
      if (execPlan.subtasks.length > 1) {
        // 多子任务: 通过 MasterController 分派
        await master.executeAll(execPlan, loop.opts.model, loop.context?.appendOnlyLog);
      } else {
        // 单子任务: 直接 loop.run
        await loop.run(planMessage);
      }

      console.log(`[chat:approve] 计划执行完成: ${execPlan.id}`);
    } catch (err: any) {
      console.error(`[chat:approve] 计划执行失败: ${err?.message}`);
      throw err;
    }
  }

  return r;
}
