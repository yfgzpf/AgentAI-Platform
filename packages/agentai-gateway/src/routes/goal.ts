/**
 * Goal Routes — 目标驱动执行 HTTP 入口
 * ----------------------------------------------------
 * 提供 /v1/goal SSE 流式端点, 对接 goal-runner.runWithGoal()
 *
 * 事件流:
 *   goal:plan     →   目标分解计划
 *   goal:stage    →   阶段开始
 *   goal:stage:done → 阶段完成
 *   goal:stage:attempt → 阶段重试
 *   goal:stage:failed  → 阶段失败
 *   goal:stage:awaiting_approval → 等待人工审批
 *   goal:timeout   →   超时
 *   goal:done     →   全部完成
 *   delta         →   LLM 流式输出
 *   subagent_*    →   子智能体进度
 *   tool_*        →   工具调用
 */
import { Router, Request, Response } from 'express';
import { AgentAILoop } from '../agentai-loop.js';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import { WorkspaceManager } from '../workspace-manager.js';

export interface GoalRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessionManager?: any;
  persistentMemory?: any;
}

/**
 * 简化的模型选择 (仅挑选可用的 provider)
 */
function pickAvailableProvider(router: AgentAIRouter, preferred?: string): { provider: string; modelName: string } {
  const providers = (router as any).providers;
  if (!providers || providers.size === 0) return { provider: 'agentai', modelName: '' };

  // 优先用 preferred
  if (preferred) {
    const p = providers.get(preferred);
    if (p && !p.tripped) return { provider: preferred, modelName: p.modelName || '' };
  }

  // 找第一个未熔断的
  for (const [name, p] of providers) {
    if (!p.tripped) return { provider: name, modelName: p.modelName || '' };
  }

  return { provider: 'agentai', modelName: '' };
}

export function createGoalRouter(deps: GoalRouterDeps): Router {
  const r = Router();

  r.post('/v1/goal', async (req: Request, res: Response) => {
    const { goal, userId = 'default', workspace: rawWorkspace, model: preferredModel } = req.body;

    if (!goal || typeof goal !== 'string' || !goal.trim()) {
      return res.status(400).json({ error: 'goal required' });
    }

    // 设置项目目录
    const wm = WorkspaceManager.getInstance();
    if (rawWorkspace) {
      try {
        wm.setProjectDir(rawWorkspace);
      } catch {}
    }
    const workspace = wm.projectDir;

    // ====== SSE 流式 ======
    req.socket?.setNoDelay?.();
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: any) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    try {
      const selected = pickAvailableProvider(deps.router, preferredModel);
      const loop = new AgentAILoop(deps.router, deps.registry, [], {
        maxIterations: 30,
        userId,
        workspace,
        model: selected.provider,
        modelName: selected.modelName,
        persistentMemory: deps.persistentMemory,
      });

      // ====== 注册事件转发 ======

      // Goal 事件
      loop.on('goal:plan', (info: any) => sendEvent('goal_plan', info));
      loop.on('goal:stage', (info: any) => sendEvent('goal_stage', info));
      loop.on('goal:stage:done', (info: any) => sendEvent('goal_stage_done', info));
      loop.on('goal:stage:attempt', (info: any) => sendEvent('goal_stage_attempt', info));
      loop.on('goal:stage:failed', (info: any) => sendEvent('goal_stage_failed', info));
      loop.on('goal:stage:awaiting_approval', (info: any) => sendEvent('goal_stage_awaiting_approval', info));
      loop.on('goal:timeout', (info: any) => sendEvent('goal_timeout', info));
      loop.on('goal:done', (info: any) => sendEvent('goal_done', info));

      // LLM 流式输出 (阶段执行时的实时文本)
      loop.on('llm:delta', (info: { delta: string }) => {
        sendEvent('delta', { delta: info.delta });
      });
      loop.on('llm:thinking', (info: { text: string }) => {
        sendEvent('thinking', { text: info.text });
      });

      // 子智能体进度
      loop.on('subagent:start', (info: any) => sendEvent('subagent_start', info));
      loop.on('subagent:done', (info: any) => sendEvent('subagent_done', info));
      loop.on('subagent:error', (info: any) => sendEvent('subagent_error', info));

      // 工具调用
      loop.on('tool:start', (info: any) => sendEvent('tool_start', info));
      loop.on('tool:result', (info: any) => sendEvent('tool_result', info));
      loop.on('tool:stuck', (info: any) => sendEvent('tool_stuck', info));

      // 推理过程
      loop.on('reasoning', (info: any) => sendEvent('reasoning', info));

      // 自动修复
      loop.on('auto:fix', (info: any) => sendEvent('auto_fix', info));

      // ====== 执行 ======
      const result = await loop.runWithGoal(goal.trim());

      sendEvent('done', {
        success: result.success,
        goal: result.goal,
        content: result.content,
        stages: result.stages,
        durationMs: result.durationMs,
        totalIterations: result.totalIterations,
        checkpoint: result.checkpoint || null,
      });

      res.end();
    } catch (err: any) {
      console.error('[goal] error:', err?.message);
      sendEvent('error', { message: err?.message || 'Unknown error' });
      sendEvent('done', { success: false, content: `执行失败: ${err?.message}` });
      res.end();
    }
  });

  return r;
}
