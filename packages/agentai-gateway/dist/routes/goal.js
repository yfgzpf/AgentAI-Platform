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
import { Router } from 'express';
import { AgentAILoop } from '../agentai-loop.js';
import { WorkspaceManager } from '../workspace-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * 简化的模型选择 (仅挑选可用的 provider)
 */
function pickAvailableProvider(router, preferred) {
    const providers = router.providers;
    if (!providers || providers.size === 0)
        return { provider: 'agentai', modelName: '' };
    // 优先用 preferred
    if (preferred) {
        const p = providers.get(preferred);
        if (p && !p.tripped)
            return { provider: preferred, modelName: p.modelName || '' };
    }
    // 找第一个未熔断的
    for (const [name, p] of providers) {
        if (!p.tripped)
            return { provider: name, modelName: p.modelName || '' };
    }
    return { provider: 'agentai', modelName: '' };
}
export function createGoalRouter(deps) {
    const r = Router();
    r.post('/v1/goal', async (req, res) => {
        const { goal, userId = 'default', workspace: rawWorkspace, model: preferredModel } = req.body;
        if (!goal || typeof goal !== 'string' || !goal.trim()) {
            return res.status(400).json({ error: 'goal required' });
        }
        // 确定工作区（2026-10-06: 与 chat.ts 同样的修复）
        // 原来这里调 wm.setProjectDir(rawWorkspace) 写**进程级**单例，
        // 而 tools.ts 有 48 处读 wm().projectDir 当路径基准
        // → goal 请求会把 chat 请求的工作区一起改掉（跨端点串扰）。
        // 现在只影响本次请求（request-scope ALS）；全局单例留给
        // files.ts 的 POST /v1/workspace（那是用户显式切换的语义）。
        const wm = WorkspaceManager.getInstance();
        let workspace = wm.projectDir;
        if (rawWorkspace && fs.existsSync(rawWorkspace)) {
            workspace = path.resolve(rawWorkspace);
        }
        // ====== SSE 流式 ======
        req.socket?.setNoDelay?.();
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        const sendEvent = (event, data) => {
            try {
                res.write(`event: ${event}\n`);
                res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
            catch { }
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
            loop.on('goal:plan', (info) => sendEvent('goal_plan', info));
            loop.on('goal:stage', (info) => sendEvent('goal_stage', info));
            loop.on('goal:stage:done', (info) => sendEvent('goal_stage_done', info));
            loop.on('goal:stage:attempt', (info) => sendEvent('goal_stage_attempt', info));
            loop.on('goal:stage:failed', (info) => sendEvent('goal_stage_failed', info));
            loop.on('goal:stage:awaiting_approval', (info) => sendEvent('goal_stage_awaiting_approval', info));
            loop.on('goal:timeout', (info) => sendEvent('goal_timeout', info));
            loop.on('goal:done', (info) => sendEvent('goal_done', info));
            // LLM 流式输出 (阶段执行时的实时文本)
            loop.on('llm:delta', (info) => {
                sendEvent('delta', { delta: info.delta });
            });
            loop.on('llm:thinking', (info) => {
                sendEvent('thinking', { text: info.text });
            });
            // 子智能体进度
            loop.on('subagent:start', (info) => sendEvent('subagent_start', info));
            loop.on('subagent:done', (info) => sendEvent('subagent_done', info));
            loop.on('subagent:error', (info) => sendEvent('subagent_error', info));
            // 工具调用
            loop.on('tool:start', (info) => sendEvent('tool_start', info));
            loop.on('tool:result', (info) => sendEvent('tool_result', info));
            loop.on('tool:stuck', (info) => sendEvent('tool_stuck', info));
            // 推理过程
            loop.on('reasoning', (info) => sendEvent('reasoning', info));
            // 自动修复
            loop.on('auto:fix', (info) => sendEvent('auto_fix', info));
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
        }
        catch (err) {
            console.error('[goal] error:', err?.message);
            sendEvent('error', { message: err?.message || 'Unknown error' });
            sendEvent('done', { success: false, content: `执行失败: ${err?.message}` });
            res.end();
        }
    });
    return r;
}
