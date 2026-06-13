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
  sessionManager: any;  // SessionManager
  frameworkSwitcher?: any; // FrameworkSwitcher
  persistentMemory?: any; // PersistentMemory
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const r = Router();
  const { router, registry, sessionManager, frameworkSwitcher, persistentMemory } = deps;

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
        let loop;
        let sessionId: string;
        const sessionData = sessionManager.get(sessionKey);
        if (!sessionData) {
          loop = new AgentAILoop(router, registry, [], { maxIterations: 30, userId, workspace });
          sessionManager['map'].set(sessionKey, {
            loop,
            userId,
            workspace,
            lastAccessedAt: Date.now(),
            createdAt: Date.now(),
            callCount: 1,
          });
          sessionId = loop.getContext().sessionId;
          // 创建持久化 checkpoint
          if (persistentMemory) {
            persistentMemory.createCheckpoint(sessionId, userId, workspace);
            persistentMemory.addMessage(sessionId, { role: 'user', content: message });
          }
        } else {
          loop = sessionData.loop;
          sessionId = loop.getContext().sessionId;
        }
        const resSessionId = sessionId;

        // 监听 AgentAILoop 事件，转发为 SSE 事件
        loop.on('tool:start', (info: any) => {
          sendEvent('tool_start', { callId: info.callId, name: info.name, args: info.args });
        });
        loop.on('tool:result', (info: any) => {
          sendEvent('tool_result', { callId: info.callId, name: info.name, result: info.result, ok: info.ok, durationMs: info.durationMs });
        });
        loop.on('loop:iteration', (info: any) => {
          sendEvent('iteration', { n: info.n });
        });
        loop.on('reflect:start', () => {
          sendEvent('reflect', { status: 'start' });
        });
        loop.on('reflect:done', (info: any) => {
          sendEvent('reflect', { status: 'done', summary: info.summary });
        });

        // 通过 AgentAILoop.run() 执行对话（完整工具调用 + 反思 + 记忆闭环）
        const response = await loop.run(message);

        // 流式发送最终结果
        sendEvent('delta', { delta: response.content });
        sendEvent('done', {
          provider: response.provider,
          usage: response.usage,
          content: response.content,
          toolCalls: response.toolCalls,
          sessionId: resSessionId,
          iterations: response.iterations,
        });

        // 持久化 assistant 回复
        if (persistentMemory) {
          persistentMemory.addMessage(resSessionId, { role: 'assistant', content: response.content });
        }
        await writeMemory({
          userId, workspace, role: 'assistant', content: response.content,
          metadata: { provider: response.provider, durationMs: response.durationMs }, source: 'session',
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

      // 创建或获取 session (使用 SessionManager LRU)
      const sessionKey = `${userId}:${workspace}`;
      let loop: any;
      let isNewSession = false;
      let sessionData = sessionManager.get(sessionKey);
      if (!sessionData) {
        const mode = req.body?.mode || 'auto';
        const userModel = req.body?.model;
        if (userModel && userModel !== 'agentai' && ['agentai', 'deepseek', 'openai'].includes(userModel)) {
          loop = new AgentAILoop(router, registry, [], { maxIterations: 10, userId, workspace, mode, model: userModel });
        } else {
          const msg = (message || '').toLowerCase();
          const isSimple = msg.length < 15 && !/代码|审查|分析|重构|改|修|建|查|找|debug|review|refactor|implement|analyze|create|fix/.test(msg);
          const isDeepReason = /架构|设计模式|性能优化|并发|安全|漏洞|内存泄漏|重构|复杂|体系|设计|security|vulnerability|memory leak|race|deadlock/i.test(msg);
          const usePro = (mode === 'auto' || mode === 'planning') && isDeepReason;
          const useFlash = (mode === "auto" || mode === 'planning') && !isSimple && !isDeepReason;
          let chatModel = 'agentai';
          let modelName = '';
          if (usePro) { chatModel = 'deepseek'; modelName = 'deepseek-v4-pro'; }
          else if (useFlash) { chatModel = 'deepseek'; modelName = 'deepseek-v4-flash'; }
          loop = new AgentAILoop(router, registry, [], { maxIterations: 10, userId, workspace, mode, model: chatModel, modelName });
        }
        sessionManager['map'].set(sessionKey, {
          loop,
          userId,
          workspace,
          lastAccessedAt: Date.now(),
          createdAt: Date.now(),
          callCount: 1,
        });
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

      const response = await loop.run(message);

      // 持久化 assistant 回复
      if (persistentMemory) {
        const sid = loop.getContext().sessionId;
        persistentMemory.addMessage(sid, { role: 'assistant', content: response.content });
      }

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
