// @ts-nocheck
/**
 * Chat Routes - 主对话 API (含 SSE 流式)
 * 提取自 index.ts, 包含 /v1/chat 端点
 */
import { Router, Request, Response } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tools.js';
import { AgentAILoop } from '../agentai-loop.js';
import { writeMemory } from '../memory.js';

export interface ChatRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessions: Map<string, AgentAILoop>;
  frameworkSwitcher?: any; // FrameworkSwitcher
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const r = Router();
  const { router, registry, sessions, frameworkSwitcher } = deps;

  r.post('/v1/chat', async (req: Request, res: Response) => {
    try {
      const { message, userId = 'default', workspace = process.cwd(), framework, stream = false } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }

      await writeMemory({ userId, workspace, role: 'user', content: message, source: 'session' });

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

        try {
          const sessionKey = `${userId}:${workspace}`;
          let loop = sessions.get(sessionKey);
          if (!loop) {
            loop = new AgentAILoop(router, registry, [], { maxIterations: 30, userId, workspace });
            sessions.set(sessionKey, loop);
          }

          const resp = await router.chat({
            model: 'agentai',
            messages: [{ role: 'user', content: message }],
            stream: true,
            userId,
            workspace,
            onDelta: (delta: string) => sendEvent('delta', { delta }),
          });

          sendEvent('done', { provider: resp.provider, usage: resp.usage, content: resp.content });
          await writeMemory({
            userId, workspace, role: 'assistant', content: resp.content,
            metadata: { provider: resp.provider, durationMs: resp.durationMs }, source: 'session',
          });
          res.end();
        } catch (e: any) {
          sendEvent('error', { error: String(e?.message || e) });
          res.end();
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

      // 创建或获取 session
      const sessionKey = `${userId}:${workspace}`;
      let loop = sessions.get(sessionKey);
      if (!loop) {
        const mode = req.body?.mode || 'auto';
        const userModel = req.body?.model;
        if (userModel && userModel !== 'agentai' && ['agentai', 'deepseek', 'openai'].includes(userModel)) {
          loop = new AgentAILoop(router, registry, [], { maxIterations: 10, userId, workspace, mode, model: userModel });
        } else {
          const msg = (message || '').toLowerCase();
          const isSimple = msg.length < 15 && !/代码|审查|分析|重构|改|修|建|查|找|debug|review|refactor|implement|analyze|create|fix/.test(msg);
          const isDeepReason = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock/i.test(msg);
          const usePro = (mode === 'auto' || mode === 'planning') && isDeepReason;
          const useFlash = (mode === 'auto' || mode === 'planning') && !isSimple && !isDeepReason;
          let chatModel = 'agentai';
          let modelName = '';
          if (usePro) { chatModel = 'deepseek'; modelName = 'deepseek-v4-pro'; }
          else if (useFlash) { chatModel = 'deepseek'; modelName = 'deepseek-v4-flash'; }
          loop = new AgentAILoop(router, registry, [], { maxIterations: 10, userId, workspace, mode, model: chatModel, modelName });
        }
        sessions.set(sessionKey, loop);
      }

      // 收集工具事件
      const toolEvents: any[] = [];
      const onToolStart = (info: any) => toolEvents.push({ type: 'tool_start', callId: info.callId, name: info.name, args: info.args });
      const onToolResult = (info: any) => toolEvents.push({ type: 'tool_result', callId: info.callId, name: info.name, result: info.result, ok: info.ok, durationMs: info.durationMs });
      loop.on('tool:start' as any, onToolStart);
      loop.on('tool:result' as any, onToolResult);

      const response = await loop.run(message);

      loop.off('tool:start' as any, onToolStart);
      loop.off('tool:result' as any, onToolResult);

      await writeMemory({
        userId, workspace, role: 'assistant', content: response.content,
        metadata: { provider: response.provider, cost: response.usage.cost, durationMs: response.durationMs },
        source: 'session',
      });

      res.json({
        content: response.content,
        toolCalls: response.toolCalls,
        provider: response.provider,
        usage: response.usage,
        toolEvents,
        sessionId: loop.getContext().sessionId,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return r;
}
