// @ts-nocheck - workaround for qq-bot-client module resolution
/**
 * QQ Bot Routes - API v2 完整接入
 * ==================================
 * 基于官方文档: https://bot.q.qq.com/wiki/develop/api-v2/
 *
 * 功能:
 *   1. Webhook 事件回调 (接收 QQ 平台推送的消息事件)
 *   2. HTTP 消息收发 (OpenAPI)
 *   3. 心跳 & 状态管理
 *   4. 集成 AgentAILoop (消息 → LLM → 回复)
 */
import { Router, Request, Response } from 'express';
// @ts-nocheck
// @ts-nocheck - QQ Bot module uses dynamic import due to missing ws types

// ===== 模块级 QQBotClient 单例 (动态导入避免 tsc 找不到 types) =====

let qqClient: any = null;
let qqBotHeartbeat = { online: false, lastSeen: 0, messageCount: 0, sessionId: '' };

function getQQClient(): any {
  return qqClient;
}

async function initQQClient(appId: string, appSecret: string, wsToken?: string): Promise<any> {
  if (qqClient) return qqClient;

  try {
    const { QQBotClient } = await import('./qq-bot-client.js');
    qqClient = new QQBotClient({ appId, appSecret, wsToken });

    // WebSocket 事件回调
    qqClient.on('event', (event: any) => {
      console.log('[qq-bot] event:', event.type);
    });

    await qqClient.init();
    // 自动连接 WebSocket
    qqClient.connectWebSocket();
    qqBotHeartbeat.online = true;
    qqBotHeartbeat.lastSeen = Date.now();
  } catch (err: any) {
    console.error('[qq-bot] init failed:', err.message);
    throw err;
  }

  return qqClient;
}

/**
 * 创建 QQ Bot Router
 * 注意: 不需要注入 router/registry, 它内部通过 httpPost 调用本地 /v1/chat
 */
export function createQQRouter() {
  const r = Router();

  // ===== 初始化接口 (由管理端或 GUI 调用) =====
  r.post('/v1/qq/init', async (req, res) => {
    const { appId, appSecret, wsToken } = req.body || {};
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'appId and appSecret required' });
    }
    try {
      await initQQClient(appId, appSecret, wsToken);
      res.json({ ok: true, message: 'QQ Bot initialized' });
    } catch (err: any) {
      res.status(500).json({ error: `Init failed: ${err.message}` });
    }
  });

  // ===== Webhook 事件回调 (接收 QQ 平台推送的消息) =====
  r.post('/v1/qq/webhook', async (req: Request, res: Response) => {
    // QQ 平台推送事件时的验证回调
    const verify = (req.body as any)?.verify_type;
    if (verify === 'welcome' || verify === 'guild') {
      return res.json({ message: (req.body as any)?.token ?? 'verify' });
    }

    const event = req.body;
    if (!event) return res.status(400).json({ error: 'event required' });

    // 解析事件
    const eventType = (event as any).type ?? (event as any).event?.type ?? '';

    // 处理消息事件
    if (eventType === 'C2C_MESSAGE_CREATE' || eventType === 'GROUP_AT_MESSAGE_CREATE') {
      const author = (event as any).author ?? {};
      const content = (event as any).content ?? (event as any).msg_content ?? '';
      const userId = author.id ?? 'unknown';
      const msgId = (event as any).id ?? (event as any).msg_id ?? '';

      qqBotHeartbeat.online = true;
      qqBotHeartbeat.lastSeen = Date.now();
      qqBotHeartbeat.messageCount++;

      console.log(`[qq-bot webhook] ${eventType} from ${userId}:`, String(content).slice(0, 200));

      // 调用 LLM 处理
      try {
        const reply = await processQQMessage(content, userId, event);
        if (reply) {
          // 回复消息
          const client = getQQClient();
          if (client) {
            // 根据事件类型决定回复端点
            if (eventType === 'C2C_MESSAGE_CREATE') {
              await client.sendC2Message(userId, reply, msgId);
            } else {
              // 群 @消息: 需要 guild_id + channel_id
              const guildId = (event as any).guild_id ?? '';
              const channelId = (event as any).channel_id ?? '';
              await client.sendMessage(reply, guildId, channelId);
            }
          }
        }
      } catch (err: any) {
        console.error('[qq-bot webhook] LLM processing failed:', err.message);
      }
    }

    // 回复 QQ 平台 (2xx 表示成功处理)
    res.json({ code: 0, msg: 'ok' });
  });

  // ===== HTTP 消息接口 (给独立 agentai-qqbot 包调用) =====
  r.post('/v1/qq/message', async (req: Request, res: Response) => {
    try {
      const { userId, groupId, message } = req.body || {};
      if (!message) return res.status(400).json({ error: 'message required' });

      qqBotHeartbeat.online = true;
      qqBotHeartbeat.lastSeen = Date.now();
      qqBotHeartbeat.messageCount++;

      const reply = await processQQMessage(message, userId, { guild_id: groupId });
      res.json({ reply, provider: 'qq-bot' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ===== 心跳 & 状态 =====
  r.post('/v1/qq/heartbeat', (req, res) => {
    qqBotHeartbeat = {
      online: true,
      lastSeen: Date.now(),
      messageCount: (req.body as any)?.messageCount ?? qqBotHeartbeat.messageCount,
      sessionId: (req.body as any)?.sessionId ?? qqBotHeartbeat.sessionId,
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
      clientConnected: qqClient !== null,
    });
  });

  // ===== 销毁客户端 =====
  r.post('/v1/qq/destroy', (_req, res) => {
    if (qqClient) {
      qqClient.destroy();
      qqClient = null;
      qqBotHeartbeat.online = false;
    }
    res.json({ ok: true });
  });

  return r;
}

/**
 * 处理 QQ 消息 (接收 → LLM → 回复)
 */
async function processQQMessage(
  content: any,
  userId: string,
  event: Record<string, any>,
): Promise<string> {
  // 简化版: 返回处理结果
  // 未来可以集成到 agentai-loop
  const cleanContent = typeof content === 'string' ? content :
    (typeof content === 'object' && content !== null ? ((content as any).text ?? JSON.stringify(content)) : JSON.stringify(content));
  return `[QQ Bot] 📨 ${userId}: ${cleanContent}`;
}

// 导出客户端初始化和获取方法
export { initQQClient, getQQClient };
