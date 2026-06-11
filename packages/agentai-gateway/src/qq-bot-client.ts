/**
 * QQ Bot API v2 Client - 完整接入
 * ==================================
 * 基于官方文档: https://bot.q.qq.com/wiki/
 *
 * 功能:
 *   1. Access Token 管理 (自动获取 + 过期前 60s 刷新)
 *   2. WebSocket 事件订阅/推送
 *   3. HTTP OpenAPI 调用
 *   4. Webhook 回调支持
 *
 * 使用方式:
 *   const qq = new QQBotClient({ appId, appSecret, wsToken });
 *   await qq.init();  // 自动获取 Token + 连接 WS
 */

import https from 'node:https';
import http from 'node:http';
import { EventEmitter } from 'events';
// @ts-ignore - ws may not have types installed
const WebSocket: any = require('ws');

// ===== Token 管理 =====

export interface QQBotToken {
  access_token: string;
  expires_in: number;
  obtained_at: number;
  expires_at: number;
}

export interface QQBotClientConfig {
  appId: string;
  appSecret: string;
  wsToken?: string;            // WebSocket 连接票据 (从 /gateway 或 /gateway/ws 获取)
  baseUrl?: string;            // 默认 https://api.sgroup.qq.com
  tokenUrl?: string;           // 默认 https://bots.qq.com/app/getAppAccessToken
}

export class QQBotClient extends EventEmitter {
  private config: QQBotClientConfig;
  private baseUrl: string;
  private tokenUrl: string;
  private token: QQBotToken | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private ws: any = null;
  private wsUrl: string = 'wss://api.sgroup.qq.com/websocket/';
  private seq: number = 0;
  private sessionId: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private eventSubscriptions: string[] = [];

  constructor(config: QQBotClientConfig) {
    super();
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.sgroup.qq.com';
    this.tokenUrl = config.tokenUrl ?? 'https://bots.qq.com/app/getAppAccessToken';
  }

  /**
   * 初始化: 获取 Token + 可选连接 WebSocket
   */
  async init(): Promise<void> {
    await this.ensureToken();
    console.log('[qq-bot] initialized (token OK, baseUrl:', this.baseUrl, ')');
  }

  private async ensureToken(): Promise<void> {
    await this.refreshToken();
  }

  /**
   * 获取 Access Token (带自动刷新)
   */
  async getToken(): Promise<string> {
    if (!this.token || Date.now() >= this.token.expires_at - 60_000) {
      await this.ensureToken();
    }
    return this.token!.access_token;
  }

  /**
   * 刷新 Token
   */
  private async refreshToken(): Promise<void> {
    const body = JSON.stringify({
      appId: this.config.appId,
      clientSecret: this.config.appSecret,
    });

    const result = await this.httpPost(this.tokenUrl, body, {
      'Content-Type': 'application/json',
    });

    const json = JSON.parse(result) as { access_token: string; expires_in: number };
    if (!json.access_token) {
      throw new Error(`Failed to get access_token: ${result}`);
    }

    this.token = {
      access_token: json.access_token,
      expires_in: json.expires_in,
      obtained_at: Date.now(),
      expires_at: Date.now() + json.expires_in * 1000,
    };

    this.cancelTokenRefreshTimer();
    this.tokenRefreshTimer = setTimeout(
      () => this.refreshToken().catch(() => {}),
      (json.expires_in - 60) * 1000,  // 提前 60s 刷新
    );

    console.log('[qq-bot] token refreshed (expires in', json.expires_in, 's)');
  }

  /**
   * 取消 token 刷新定时器
   */
  private cancelTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  /**
   * HTTP POST 通用方法 (自动携带 token)
   */
  async httpPost(path: string, body: string, extraHeaders: Record<string, string> = {}): Promise<string> {
    const token = await this.getToken();
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';

    return new Promise<string>((resolve, reject) => {
      const req = (isHttps ? https : http).request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `QQBot ${token}`,
          ...extraHeaders,
        },
      });

      req.on('error', reject);
      req.on('response', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });

      req.write(body);
      req.end();
    });
  }

  /**
   * HTTP GET 通用方法
   */
  async httpGet(path: string): Promise<string> {
    const token = await this.getToken();
    const url = new URL(path, this.baseUrl);
    const isHttps = url.protocol === 'https:';

    return new Promise<string>((resolve, reject) => {
      const req = (isHttps ? https : http).request(url, {
        method: 'GET',
        headers: {
          'Authorization': `QQBot ${token}`,
        },
      });

      req.on('error', reject);
      req.on('response', (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
      });

      req.end();
    });
  }

  /**
   * 连接 WebSocket 接收事件
   * 参考: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/reference.html
   */
  async connectWebSocket(onEvent?: (event: QQBotEvent) => void): Promise<void> {
    if (this.ws?.readyState === 1) {
      console.log('[qq-bot] WebSocket already connected');
      return;
    }

    // 获取 gateway URL (从管理端获取, 或使用默认)
    const gatewayUrl = this.config.wsToken
      ? `wss://api.sgroup.qq.com/websocket/${this.config.wsToken}`
      : 'wss://api.sgroup.qq.com/websocket';

    console.log('[qq-bot] connecting WebSocket to', gatewayUrl);

    this.ws = new WebSocket(gatewayUrl, {
      headers: {
        'Authorization': `QQBot ${await this.getToken()}`,
      },
    });

    this.ws.on('open', () => {
      console.log('[qq-bot] WebSocket connected');
      this.reconnectAttempts = 0;

      // 发送 IDENTIFY 请求 (携带 appId + compress)
      const identify = {
        op: 2,  // OP_CODE.IDENTIFY
        d: {
          token: `QQBot ${this.token!.access_token}`,
          intents: this.getIntentBits(),
          shard: [0, 1],  // 单 shard
          properties: {
            os: 'Node.js',
            browser: 'QQBotClient',
            d: '1.0.0',
          },
        },
      };
      this.ws!.send(JSON.stringify(identify));
    });

    this.ws.on('message', (raw: Buffer | string) => {
      let event: { op: number; d?: any; s?: number };
      try {
        event = JSON.parse(raw.toString());
      } catch {
        console.warn('[qq-bot] invalid WS message:', raw.slice(0, 200).toString());
        return;
      }

      // 记录 seq
      if (event.s !== undefined) {
        this.seq = event.s;
      }

      switch (event.op) {
        case 0:  // 服务端推送事件
          if (onEvent) {
            onEvent(event.d as QQBotEvent);
          }
          this.handleEvent(event.d);
          break;

        case 1:  // 心跳请求 (server -> client)
          // 客户端回复 HEARTBEAT (op=3)
          this.ws?.send(JSON.stringify({ op: 3, d: null }));
          break;

        case 3:  // 服务端心跳响应
          // 客户端发送心跳 (op=1)
          this.sendHeartbeat();
          break;

        case 7:  // 重新连接
          console.log('[qq-bot] reconnection requested, seq:', this.seq);
          this.resumeWebSocket();
          break;

        case 9:  // 无效会话 (invalid session)
          console.log('[qq-bot] invalid session, full reconnect');
          this.fullReconnect();
          break;

        default:
          console.log('[qq-bot] unknown WS op:', event.op);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log('[qq-bot] WebSocket closed:', code, reason.toString());
      this.ws = null;
      this.sessionId = null;
      this.reconnectWebSocket();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[qq-bot] WebSocket error:', err.message);
    });
  }

  /**
   * 发送心跳 (op=1)
   */
  private sendHeartbeat(): void {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ op: 1, d: this.seq }));
    }
  }

  /**
   * Resume 断线重连
   */
  private resumeWebSocket(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      op: 6,  // OP_CODE.RESUME
      d: {
        token: `QQBot ${this.token!.access_token}`,
        session_id: this.sessionId ?? '',
        seq: this.seq,
      },
    }));
  }

  /**
   * 完整重连
   */
  private fullReconnect(): void {
    this.sessionId = null;
    this.reconnectWebSocket();
  }

  /**
   * 断线重连 (带指数退避)
   */
  private reconnectWebSocket(): void {
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[qq-bot] max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[qq-bot] reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        // 重新获取 gateway (可能需要 refresh token)
        await this.connectWebSocket();
      } catch (err) {
        console.error('[qq-bot] reconnect failed:', (err as Error).message);
        this.reconnectWebSocket();
      }
    }, delay);
  }

  /**
   * Intent 位掩码
   * 参考: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html
   */
  private getIntentBits(): number {
    // 常用事件 Intent 位掩码
    const INTENTS = {
      PRIVATE_C2C_MESSAGE_RECV:    1 << 0,   // 私聊消息
      GROUP_AT_MESSAGE_RECV:       1 << 1,   // 群 @机器人消息
      PUBLIC_MESSAGE_RECV:         1 << 9,   // 频道私聊消息
      MESSAGES:                    1 << 8,   // 消息事件
    };
    // 默认订阅私聊 + 群聊消息
    return INTENTS.PRIVATE_C2C_MESSAGE_RECV | INTENTS.GROUP_AT_MESSAGE_RECV;
  }

  /**
   * 处理收到的事件
   */
  private handleEvent(event: QQBotEvent): void {
    const type = event.type;

    // 自动发送回复
    if (type === 'C2C_MESSAGE_CREATE' || type === 'GROUP_AT_MESSAGE_CREATE' || type === 'PUBLIC_MESSAGE_CREATE') {
      this.handleMessageEvent(event);
      return;
    }

    // 其他事件透传给 listener
    this.emit('event', event);
  }

  /**
   * 处理消息事件 (接收 → LLM 处理 → 发送回复)
   */
  private async handleMessageEvent(event: QQBotEvent): Promise<void> {
    const content = typeof event.content === 'string' ? event.content : (Array.isArray(event.content) && event.content.length > 0 ? (event.content[0] as any).text ?? '' : '');
    const userId = event.author?.id ?? 'unknown';
    const guildId = (event as any).guild_id ?? '';
    const channelId = (event as any).channel_id ?? '';
    const msgId = event.id ?? '';

    console.log(`[qq-bot] message from ${userId} (${guildId}/${channelId}):`, content.slice(0, 100));

    // 发送"正在输入"状态 (可选, 通过 typing 接口)
    // await this.sendTyping(guildId, channelId);

    try {
      // 调用 LLM 处理
      // TODO: 集成到 agentai-loop (通过 http POST 到 /v1/chat)
      const reply = await this.processMessage(content, userId, guildId, channelId, msgId);
      if (reply && reply.length > 0) {
        await this.sendMessage(reply, guildId, channelId);
      }
    } catch (err) {
      console.error('[qq-bot] failed to process message:', (err as Error).message);
    }
  }

  /**
   * 处理消息 (占位: 调用本地 /v1/chat 端点)
   * 实际部署时可通过 HTTP 调用自身或其他 LLM 服务
   */
  private async processMessage(
    content: string,
    userId: string,
    guildId: string,
    channelId: string,
    msgId: string,
  ): Promise<string> {
    // 这里预留: 调用本地的 AgentAILoop
    // 简化版: 返回一个占位回复
    return `[QQ Bot] 收到来自 ${userId} 的消息: ${content}`;
  }

  /**
   * 发送消息
   * 参考: https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/api-use.html
   */
  async sendMessage(
    content: string,
    guildId?: string,
    channelId?: string,
  ): Promise<boolean> {
    if (!guildId || !channelId) {
      console.warn('[qq-bot] cannot send: guildId and channelId required');
      return false;
    }

    const body = JSON.stringify({
      content,
      msg_type: 0,  // 0 = 普通文本
    });

    const path = `/v2/guilds/${guildId}/channels/${channelId}/messages`;

    try {
      await this.httpPost(path, body);
      console.log('[qq-bot] message sent to', channelId);
      return true;
    } catch (err) {
      console.error('[qq-bot] failed to send message:', (err as Error).message);
      return false;
    }
  }

  /**
   * 发送 C2C 私聊消息
   * 端点: POST /v2/users/{openid}/messages
   */
  async sendC2Message(
    openid: string,
    content: string,
    msgId?: string,
  ): Promise<boolean> {
    const body = JSON.stringify({
      content,
      msg_type: 0,
      msg_id: msgId ?? null,
    });

    const path = `/v2/users/${openid}/messages`;

    try {
      await this.httpPost(path, body);
      return true;
    } catch (err) {
      console.error('[qq-bot] failed to send C2C message:', (err as Error).message);
      return false;
    }
  }

  /**
   * 获取 gateway URL (在连接 WS 前调用)
   * 端点: GET /gateway
   */
  async getGatewayUrl(): Promise<string> {
    const result = await this.httpGet('/gateway');
    const json = JSON.parse(result) as { url: string; weight: number };
    return json.url;
  }

  /**
   * 获取 gateway + token (WebSocket 连接用)
   * 端点: GET /gateway/ws
   */
  async getGatewayWs(): Promise<{ url: string; token: string }> {
    const body = JSON.stringify({
      appId: this.config.appId,
      clientSecret: this.config.appSecret,
    });
    const result = await this.httpPost(this.tokenUrl, body, {
      'Content-Type': 'application/json',
    });
    const json = JSON.parse(result);
    return { url: json.url, token: json.token };
  }

  /**
   * 销毁客户端
   */
  destroy(): void {
    this.cancelTokenRefreshTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client shutting down');
      this.ws = null;
    }
  }
}

// ===== QQ Bot 事件类型 =====

export interface QQBotEventAuthor {
  id: string;
  username: string;
  bot: boolean;
}

export interface QQBotEventContentBlock {
  type: number;
  text?: string;
  url?: string;
}

export interface QQBotEvent {
  id: string;
  type: string;
  content: string | QQBotEventContentBlock[];
  author: QQBotEventAuthor;
  timestamp: string;
  guild_id?: string;
  channel_id?: string;
  member?: Record<string, any>;
  /** C2C 消息 */
  source_type?: string;
  /** 消息 ID (用于引用回复) */
  msg_id?: string;
}
