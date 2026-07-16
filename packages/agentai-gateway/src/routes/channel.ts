/**
 * Channel Routes — 渠道映射管理
 * ==================================================================
 * 注意: QQ/微信 Bot 只能被动回复, 不能主动推送消息
 * 因此本模块不提供 "reply" 接口
 *
 * 提供:
 * GET    /v1/channel/mappings  — 列出所有渠道映射
 * POST   /v1/channel/bridge    — 设置桥接模式
 * POST   /v1/channel/web-session — 设置 Web 活跃 session
 * DELETE /v1/channel/mapping   — 删除渠道映射
 */
import { Router, Request, Response } from 'express';
import * as bridge from '../channel-session-bridge.js';

export function createChannelRouter(): Router {
  const r = Router();

  // ===== 列出所有渠道映射 =====
  r.get('/v1/channel/mappings', (_req: Request, res: Response) => {
    const mappings = bridge.listMappings();
    res.json({
      mappings,
      mode: bridge.getMode(),
      count: mappings.length,
    });
  });

  // ===== 设置桥接模式 =====
  r.post('/v1/channel/bridge', (req: Request, res: Response) => {
    const { mode } = req.body || {};
    if (!['bridge', 'standalone', 'auto'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be bridge/standalone/auto' });
    }
    bridge.setMode(mode);
    res.json({ ok: true, mode });
  });

  // ===== 设置 Web 活跃 session (供 bridge 模式使用) =====
  r.post('/v1/channel/web-session', (req: Request, res: Response) => {
    const { sessionId } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }
    bridge.setWebActiveSession(sessionId);
    res.json({ ok: true });
  });

  // ===== 删除渠道映射 =====
  r.delete('/v1/channel/mapping', (req: Request, res: Response) => {
    const { channel, channelId } = req.body || {};
    if (!channel || !channelId) {
      return res.status(400).json({ error: 'channel, channelId required' });
    }
    const removed = bridge.removeMapping(channel, channelId);
    res.json({ ok: removed });
  });

  return r;
}
