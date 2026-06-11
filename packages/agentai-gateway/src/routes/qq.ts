/**
 * QQ Bot Routes - 接收来自 agentai-qqbot 包的消息
 * 提取自 index.ts
 */
import { Router, Request, Response } from 'express';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tools.js';
import { AgentAILoop } from '../agentai-loop.js';

export interface QQRouterDeps {
  router: AgentAIRouter;
  registry: ToolRegistry;
  sessions: Map<string, AgentAILoop>;
}

let qqBotHeartbeat = { online: false, lastSeen: 0, messageCount: 0, sessionId: '' };

export function createQQRouter(deps: QQRouterDeps): Router {
  const r = Router();
  const { router, registry, sessions } = deps;

  r.post('/v1/qq/message', async (req: Request, res: Response) => {
    try {
      const { userId, groupId, message } = req.body || {};
      if (!message) return res.status(400).json({ error: 'message required' });
      const sessionKey = `qq:${groupId || 'private'}:${userId || 'anonymous'}`;
      let loop = sessions.get(sessionKey);
      if (!loop) {
        loop = new AgentAILoop(router, registry, [], {
          maxIterations: 10,
          userId: `qq-${userId}`,
          workspace: `qq-group-${groupId}`,
        });
        sessions.set(sessionKey, loop);
      }
      const response = await loop.run(message);
      res.json({ reply: response.content, provider: response.provider, usage: response.usage });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  r.post('/v1/qq/heartbeat', (req, res) => {
    qqBotHeartbeat = {
      online: true,
      lastSeen: Date.now(),
      messageCount: req.body?.messageCount ?? qqBotHeartbeat.messageCount,
      sessionId: req.body?.sessionId ?? qqBotHeartbeat.sessionId,
    };
    res.json({ ok: true });
  });

  r.post('/v1/qq/offline', (_req, res) => {
    qqBotHeartbeat.online = false;
    res.json({ ok: true });
  });

  r.get('/v1/qq/status', (_req, res) => {
    const stale = !qqBotHeartbeat.online || (Date.now() - qqBotHeartbeat.lastSeen > 45_000);
    res.json({
      online: qqBotHeartbeat.online && !stale,
      lastSeen: qqBotHeartbeat.lastSeen,
      messageCount: qqBotHeartbeat.messageCount,
      sessionId: qqBotHeartbeat.sessionId.slice(0, 8),
    });
  });

  return r;
}
