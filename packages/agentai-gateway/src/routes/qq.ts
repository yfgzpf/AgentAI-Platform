/**
 * QQ Bot Routes - API v2 接入 (对齐 reasonix + socket.io 桥接)
 * ==================================================================
 * 使用 reasonix QQBot 类 (正确的 WebSocket Gateway 协议)
 *
 * 新功能 (2026-06-15):
 *   - socket.io 实时桥接: QQ 消息推送到前端对话窗口
 *   - 凭证持久化: ~/.agentai/qq-config.json, 启动自动重连
 *   - AI 工具接口: /v1/qq/auto-connect (AI 可自主连接)
 *   - 状态实时推送: io.emit('qq:status') 通知前端
 *
 * 协议流程:
 *   getAppAccessToken → GET /gateway → wss://... →
 *   Op 10 (Hello) → Op 2 (Identify) → Op 0 (READY) → 心跳
 */

import { Router, Request, Response } from 'express';
import type { Server as IOServer } from 'socket.io';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import WebSocket from 'ws';
import { resolve as resolveChannel, setWebActiveSession, getMapping, type ChannelType } from '../channel-session-bridge.js';
import * as customerStore from '../customer-store.js';
import { userModel } from '../user-model.js';

// ===== reasonix 对齐: QQBot 核心类 =====

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const BASE_URL = 'https://api.sgroup.qq.com';
const SANDBOX_URL = 'https://sandbox.api.sgroup.qq.com';
const INTENT_C2C_GROUP = 1 << 25;
const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
const ALLOWED_GATEWAY_HOSTS = ['api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com', 'qq.com'];

interface C2CMessage {
  author: { user_openid: string };
  content: string;
  id: string;
  timestamp: string;
}

class QQBot extends EventEmitter {
  private appid: string;
  private secret: string;
  private sandbox: boolean;
  private token = '';
  private tokenExpiresAt = 0;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private sessionId = '';
  private closed = false;
  private readyReceived = false;

  constructor(config: { appid: string; secret: string; sandbox?: boolean }) {
    super();
    this.appid = config.appid;
    this.secret = config.secret;
    this.sandbox = config.sandbox ?? false;
  }

  private get baseUrl(): string {
    return this.sandbox ? SANDBOX_URL : BASE_URL;
  }

  private sanitizeHeartbeatInterval(interval: unknown): number | null {
    if (typeof interval !== 'number' || !Number.isFinite(interval)) return null;
    if (interval < MIN_HEARTBEAT_INTERVAL_MS) return MIN_HEARTBEAT_INTERVAL_MS;
    if (interval > MAX_HEARTBEAT_INTERVAL_MS) return MAX_HEARTBEAT_INTERVAL_MS;
    return Math.trunc(interval);
  }

  private validateGatewayUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const trustedHost = ALLOWED_GATEWAY_HOSTS.some(
      host => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol !== 'wss:' || !trustedHost || url.username || url.password || url.search || url.hash) {
      throw new Error(`Unexpected QQ gateway URL: ${rawUrl}`);
    }
    return url.toString();
  }

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: this.appid, clientSecret: this.secret }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get access token (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    if (!data.access_token) {
      throw new Error(`Token response missing access_token: ${JSON.stringify(data).slice(0, 200)}`);
    }
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  private async getGateway(): Promise<string> {
    const token = await this.ensureToken();
    const res = await fetch(`${this.baseUrl}/gateway`, {
      headers: { Authorization: `QQBot ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get gateway (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { url: string };
    return this.validateGatewayUrl(data.url);
  }

  private sendOp(op: number, data?: unknown) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ op, d: data ?? {} }));
  }

  private async handlePayload(payload: { op: number; d?: Record<string, unknown>; s?: number; t?: string }) {
    switch (payload.op) {
      case 10: {
        const d = payload.d as { heartbeat_interval: number } | undefined;
        this.sendOp(2, {
          token: `QQBot ${await this.ensureToken()}`,
          intents: INTENT_C2C_GROUP,
          shard: [0, 1],
        });
        const heartbeatInterval = this.sanitizeHeartbeatInterval(d?.heartbeat_interval);
        if (heartbeatInterval) {
          this.heartbeatTimer = setInterval(() => {
            this.sendOp(1, this.seq || null);
          }, heartbeatInterval);
        }
        break;
      }
      case 0: {
        if (payload.s) this.seq = payload.s;
        if (payload.t === 'READY') {
          const d = payload.d as { session_id: string; user?: { id: string } };
          this.sessionId = d.session_id;
          this.readyReceived = true;
          this.emit('online');
        } else if (payload.t === 'C2C_MESSAGE_CREATE') {
          this.emit('message.private', payload.d as unknown as C2CMessage);
        } else if (payload.t === 'GROUP_AT_MESSAGE_CREATE') {
          this.emit('message.group', payload.d);
        }
        break;
      }
      case 7: {
        this.reconnect();
        break;
      }
      case 9: {
        this.sessionId = '';
        this.sendOp(2, {
          token: `QQBot ${await this.ensureToken()}`,
          intents: INTENT_C2C_GROUP,
          shard: [0, 1],
        });
        break;
      }
    }
  }

  private async reconnect() {
    this.cleanup();
    await this.connect();
  }

  private cleanup() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect() {
    const gatewayUrl = await this.getGateway();
    const token = await this.ensureToken();

    this.ws = new WebSocket(gatewayUrl, {
      headers: {
        Authorization: `QQBot ${token}`,
        'X-Union-Appid': this.appid,
      },
    });

    this.ws.on('open', () => {
      if (this.sessionId) {
        this.sendOp(6, {
          token: `QQBot ${this.token}`,
          session_id: this.sessionId,
          seq: this.seq,
        });
      }
    });

    this.ws.on('message', (raw: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(raw.toString());
        this.handlePayload(payload).catch(() => {});
      } catch {
        // ignore parse errors
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || '(no reason)';
      console.error(`[QQ] WebSocket closed: code=${code}, reason=${reasonStr}`);

      if (!this.closed) {
        if (this.readyReceived) {
          console.error('[QQ] WebSocket reconnecting...');
          this.cleanup();
          setTimeout(() => this.reconnect(), 3000);
        } else {
          const msg = `QQ WebSocket closed before READY (code=${code}, reason=${reasonStr})`;
          console.error(`[QQ] ${msg}`);
          this.emit('bot_error', msg);
          this.closed = true;
        }
      }
    });

    this.ws.on('error', (err: Error) => {
      const msg = `QQ WebSocket error: ${err.message}`;
      console.error(`[QQ] ${msg}`);
      this.emit('bot_error', msg);
    });
  }

  async start(): Promise<void> {
    this.closed = false;
    this.readyReceived = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.cleanup();
  }

  isOnline(): boolean {
    return this.readyReceived && !this.closed;
  }

  async sendPrivateMessage(openid: string, content: string, msgId?: string): Promise<void> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = { content, msg_type: 0 };
    if (msgId) body.msg_id = msgId;
    const res = await fetch(`${this.baseUrl}/v2/users/${encodeURIComponent(openid)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.appid,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QQ sendPrivateMessage failed (${res.status}): ${text}`);
    }
  }

  async sendGroupMessage(groupOpenid: string, content: string, msgId?: string): Promise<void> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = { content, msg_type: 0 };
    if (msgId) body.msg_id = msgId;
    const res = await fetch(`${this.baseUrl}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.appid,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`QQ sendGroupMessage failed (${res.status}): ${text}`);
    }
  }
}

// ===== 凭证持久化 =====
// 安全守护: H2 修复 — 用 base64 编码 + 0o600 权限文件防止偶然的 cat 窥视
// 彻底方案: 用 OS keychain (macOS Keychain / Windows DPAPI / Linux libsecret)
//   待跟进: 集成 keytar (https://www.npmjs.com/package/keytar)

interface QQStoredConfig {
  appId: string;
  /** base64 编码的 secret — 阻止 grep/cat 偶然暴露 */
  appSecret: string;
  sandbox?: boolean;
  savedAt: number;
}

function getConfigPath(): string {
  const dir = path.join(os.homedir(), '.agentai');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, 'qq-config.json');
}

function encodeSecret(plain: string): string {
  // 简化: base64 让偶然 cat 看不到明文。彻底方案: keytar。
  return Buffer.from(plain, 'utf-8').toString('base64');
}

function decodeSecret(encoded: string): string {
  return Buffer.from(encoded, 'base64').toString('utf-8');
}

function loadStoredConfig(): QQStoredConfig | null {
  try {
    const p = getConfigPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf-8');
    const obj = JSON.parse(raw) as QQStoredConfig;
    if (obj.appSecret) {
      // 检测是否明文（旧版没编码）— 自动迁移到 base64
      const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(obj.appSecret);
      if (!looksBase64) {
        // 明文，重新编码保存
        saveStoredConfig(obj.appId, obj.appSecret, obj.sandbox);
      } else {
        // base64 编码，解码用
        const decoded = decodeSecret(obj.appSecret);
        if (decoded) obj.appSecret = decoded;
      }
    }
    return obj;
  } catch {
    return null;
  }
}

function saveStoredConfig(appId: string, appSecret: string, sandbox = false) {
  try {
    const p = getConfigPath();
    const content = JSON.stringify({
      appId,
      appSecret: encodeSecret(appSecret),
      sandbox,
      savedAt: Date.now(),
    }, null, 2);
    // 安全: 文件权限 0o600 (仅 owner 读写)
    fs.writeFileSync(p, content, { encoding: 'utf-8', mode: 0o600 });
    try { fs.chmodSync(p, 0o600); } catch {}
  } catch { /* best-effort */ }
}

function clearStoredConfig() {
  try { fs.unlinkSync(getConfigPath()); } catch { /* best-effort */ }
}

// ===== 模块级单例 =====

let bot: QQBot | null = null;
let io: IOServer | null = null;
let qqBotHeartbeat = { online: false, lastSeen: 0, messageCount: 0, sessionId: '' };

const QQ_COOLDOWN_MS = 30_000;
const qqUserCooldowns = new Map<string, number>();
const QQ_MAX_REPLY_CHARS = 1800;

function gatewayBaseUrl(): string {
  const host = process.env.AGENTAI_HOST || '127.0.0.1';
  const port = process.env.AGENTAI_PORT || '18789';
  return `http://${host}:${port}`;
}

/** 推送状态到所有前端 */
function emitStatus() {
  if (!io) return;
  const online = bot?.isOnline() ?? false;
  io.emit('qq:status', {
    online,
    lastSeen: qqBotHeartbeat.lastSeen,
    messageCount: qqBotHeartbeat.messageCount,
  });
}

/** 推送 QQ 消息到前端对话 */
function emitToGUI(event: string, data: any) {
  if (!io) return;
  io.emit(event, data);
}

/** 内部连接 QQ (被前端 connect 和 AI 工具复用) */
async function connectInternal(appId: string, appSecret: string, sandbox = false): Promise<{ ok: boolean; error?: string; timeout?: boolean }> {
  if (bot) {
    try { await bot.stop(); } catch { /* best-effort */ }
    bot = null;
  }

  bot = new QQBot({ appid: appId, secret: appSecret, sandbox });

  // 消息事件 → 调用 LLM + 推送到 GUI
  bot.on('message.private', async (msg: C2CMessage) => {
    const text = msg.content?.trim();
    if (!text) return;
    const openid = msg.author.user_openid;
    console.log(`[QQ] 私聊 ${openid}: ${text.slice(0, 80)}`);

    // 推送到前端对话窗口
    emitToGUI('qq:message', {
      source: 'qq-private',
      userId: openid,
      content: text,
      id: msg.id,
      ts: Date.now(),
    });

    try {
      const reply = await processQQMessage(text, `qq-${openid}`, false);
      emitToGUI('qq:reply', {
        source: 'qq-private',
        userId: openid,
        content: reply,
        ts: Date.now(),
      });
      const chunks = splitQQMessage(reply);
      for (const chunk of chunks) {
        await bot!.sendPrivateMessage(openid, chunk, msg.id);
      }
    } catch (err: any) {
      console.error(`[QQ] 回复私聊失败: ${err.message}`);
      try { await bot!.sendPrivateMessage(openid, `❌ ${err.message.slice(0, 100)}`, msg.id); } catch { /* best-effort */ }
    }
    emitStatus();
  });

  bot.on('message.group', async (msg: any) => {
    const text = msg.content?.trim();
    if (!text) return;
    const groupOpenid = msg.group_openid;
    const memberOpenid = msg.author?.member_openid;
    console.log(`[QQ] 群 ${groupOpenid} ${memberOpenid}: ${text.slice(0, 80)}`);

    emitToGUI('qq:message', {
      source: 'qq-group',
      userId: memberOpenid,
      groupOpenid,
      content: text,
      id: msg.id,
      ts: Date.now(),
    });

    try {
      const reply = await processQQMessage(text, `qq-${memberOpenid}`, true);
      emitToGUI('qq:reply', {
        source: 'qq-group',
        userId: memberOpenid,
        groupOpenid,
        content: reply,
        ts: Date.now(),
      });
      const chunks = splitQQMessage(reply);
      for (const chunk of chunks) {
        await bot!.sendGroupMessage(groupOpenid, chunk, msg.id);
      }
    } catch (err: any) {
      console.error(`[QQ] 回复群消息失败: ${err.message}`);
    }
    emitStatus();
  });

  bot.on('online', () => {
    qqBotHeartbeat.online = true;
    qqBotHeartbeat.lastSeen = Date.now();
    emitStatus();
    console.log('[QQ] Bot 已上线');
  });

  bot.on('bot_error', (msg: string) => {
    qqBotHeartbeat.online = false;
    emitStatus();
    console.error(`[QQ] Bot 错误: ${msg}`);
  });

  await bot.start();

  const readyOrError = await Promise.race([
    new Promise<'ready'>((resolve) => bot!.once('online', () => resolve('ready'))),
    new Promise<'error'>((resolve) => bot!.once('bot_error', () => resolve('error'))),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 15_000)),
  ]);

  if (readyOrError === 'ready') {
    saveStoredConfig(appId, appSecret, sandbox);
    emitStatus();
    return { ok: true };
  } else if (readyOrError === 'error') {
    try { await bot.stop(); } catch { /* best-effort */ }
    bot = null;
    emitStatus();
    return { ok: false, error: '连接失败: 请检查 AppID 和 AppSecret 是否正确 (WebSocket 已关闭)' };
  } else {
    emitStatus();
    return { ok: true, timeout: true };
  }
}

/**
 * 创建 QQ Bot Router
 * 注意: io 通过 setQQIO() 后置注入 (因为 createServerHandle 在 createApp 之后)
 */
export function createQQRouter() {
  const r = Router();

  // ===== 连接接口 (前端 / AI 工具调用) =====
  r.post('/v1/qq/connect', async (req, res) => {
    const { appId, appSecret, sandbox } = req.body || {};
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'appId and appSecret required' });
    }
    try {
      const result = await connectInternal(appId, appSecret, sandbox === true);
      if (result.timeout) {
        res.json({ ok: true, message: '连接中, 请稍后查看状态', timeout: true });
      } else if (result.ok) {
        res.json({ ok: true, message: 'QQ Bot 已连接' });
      } else {
        res.status(400).json({ ok: false, error: result.error });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: `连接失败: ${err.message}` });
    }
  });

  // ===== AI 工具用自动连接接口 =====
  r.post('/v1/qq/auto-connect', async (req, res) => {
    const { appId, appSecret, sandbox } = req.body || {};
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'appId and appSecret required' });
    }
    try {
      const result = await connectInternal(appId, appSecret, sandbox === true);
      res.json({
        ok: result.ok && !result.timeout,
        timeout: !!result.timeout,
        error: result.error,
        message: result.ok ? 'QQ Bot 已连接并开始监听消息' : `连接失败: ${result.error}`,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // 兼容旧路由
  r.post('/v1/qq/init', async (req, res) => {
    const { appId, appSecret, sandbox } = req.body || {};
    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'appId and appSecret required' });
    }
    req.url = '/v1/qq/connect';
    return (r as any).handle(req, res);
  });

  // ===== 消息接口 =====
  r.post('/v1/qq/message', async (req: Request, res: Response) => {
    try {
      const { userId, message } = req.body || {};
      if (!message) return res.status(400).json({ error: 'message required' });
      qqBotHeartbeat.online = true;
      qqBotHeartbeat.lastSeen = Date.now();
      qqBotHeartbeat.messageCount++;

      // 推送到前端对话窗口
      emitToGUI('qq:message', {
        source: 'qq',
        userId: userId || 'unknown',
        content: message,
        ts: Date.now(),
      });

      const reply = await processQQMessage(message, userId);

      emitToGUI('qq:reply', {
        source: 'qq',
        userId: userId || 'unknown',
        content: reply,
        ts: Date.now(),
      });
      emitStatus();

      res.json({ reply, provider: 'qq-bot' });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ===== 状态 =====
  r.get('/v1/qq/status', (_req, res) => {
    const online = bot?.isOnline() ?? false;
    const cfg = loadStoredConfig();
    res.json({
      online,
      lastSeen: qqBotHeartbeat.lastSeen,
      messageCount: qqBotHeartbeat.messageCount,
      clientConnected: bot !== null,
      hasStoredConfig: !!cfg,
    });
  });

  // ===== 销毁 =====
  r.post('/v1/qq/destroy', async (_req, res) => {
    if (bot) {
      try { await bot.stop(); } catch { /* best-effort */ }
      bot = null;
      qqBotHeartbeat.online = false;
      clearStoredConfig();
      emitStatus();
    }
    res.json({ ok: true });
  });

  // ===== Webhook =====
  r.post('/v1/qq/webhook', async (req: Request, res: Response) => {
    const verify = (req.body as any)?.verify_type;
    if (verify === 'welcome' || verify === 'guild') {
      return res.json({ message: (req.body as any)?.token ?? 'verify' });
    }
    res.json({ code: 0, msg: 'ok' });
  });

  return r;
}

/** 后置注入 socket.io 实例 */
/** A5: 暴露 bot 实例供 channel reply API 使用 */
export function getQQBotInstance(): QQBot | null {
  return bot;
}

export function setQQIO(_io: IOServer) {
  io = _io;
  // 自动重连: io 注入后检查存储的配置
  const stored = loadStoredConfig();
  if (stored) {
    console.log(`[QQ] 发现已存储的配置, 自动重连 (appId=${stored.appId.slice(0, 6)}...)`);
    connectInternal(stored.appId, stored.appSecret, stored.sandbox).catch((err: any) => {
      console.warn('[QQ] 自动重连失败:', err?.message);
    });
  }
}

/**
 * 处理 QQ 消息 (接收 → Gateway /v1/chat → 回复)
 * A2: 通过 channel-session-bridge 查找统一 sessionId, 实现上下文同步
 */
async function processQQMessage(content: string, userId: string, isGroup = false): Promise<string> {
  let text = typeof content === 'string' ? content : String(content ?? '');
  text = text.replace(/<@!?\d+>/g, '').replace(/@\S+\s?/g, '').trim();
  if (!text) return '';

  const now = Date.now();
  const lastReply = qqUserCooldowns.get(userId);
  if (lastReply && now - lastReply < QQ_COOLDOWN_MS) {
    const wait = Math.ceil((QQ_COOLDOWN_MS - (now - lastReply)) / 1000);
    return `(请求过于频繁, 请 ${wait}s 后再试)`;
  }

  // A2: 通过 bridge 解析统一 sessionId (QQ 消息复用已有对话上下文)
  const channel: ChannelType = 'qq';
  const unifiedUserId = resolveChannel(channel, userId, {
    label: isGroup ? `QQ群:${userId.slice(0, 8)}` : `QQ:${userId.slice(0, 8)}`,
  });

  // ── 自动录入客户 + 注入跟进上下文 ──
  // 客户发消息时: 1) 自动创建/更新客户档案 2) 记录旅程 3) 注入跟进提醒
  let enrichedMessage = text;
  try {
    customerStore.recordMessage(channel, userId, text);
    const ctx = customerStore.getCustomerContext(channel, userId);
    if (ctx) {
      enrichedMessage = `${ctx}\n用户消息: ${text}`;
      // 客户主动联系了, 清除跟进标记 (已自然完成跟进)
      customerStore.clearFollowUp(channel, userId);
    }
  } catch (e: any) {
    console.warn('[QQ] customer context injection failed:', e?.message);
  }

  try {
    const resp = await fetch(`${gatewayBaseUrl()}/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: enrichedMessage,  // 注入客户上下文后的消息
        userId: unifiedUserId,  // A2: 使用统一 userId 而非 `qq:${userId}`
        workspace: '',
        stream: false,
        model: userModel.get(unifiedUserId).preferences.preferredModel || 'agentai',  // 同步用户在页面上选择的模型
      }),
    });
    qqUserCooldowns.set(userId, Date.now());

    if (!resp.ok) {
      return `(服务暂时不可用: HTTP ${resp.status})`;
    }
    const data = await resp.json() as { content?: string; error?: string };
    const reply = (data.content || '').trim() || '(无回复)';
    return reply.length > QQ_MAX_REPLY_CHARS
      ? reply.slice(0, QQ_MAX_REPLY_CHARS) + '\n…(已截断)'
      : reply;
  } catch (err: any) {
    console.error('[QQ] gateway call failed:', err?.message || err);
    return '(处理失败, 请稍后重试)';
  }
}

/** QQ 消息分片
 * 安全守护: H14 修复 — 过滤 @全体成员 / @here 防止 AI 输出触发群发
 */
const QQ_DANGEROUS_MENTIONS = [
  /@全体成员\b/g,
  /@here\b/gi,
  /@all\b/gi,
];

function sanitizeQQContent(text: string): string {
  let safe = text;
  for (const re of QQ_DANGEROUS_MENTIONS) {
    safe = safe.replace(re, '[@全体]');
  }
  return safe;
}

function splitQQMessage(text: string, maxBytes = 1500): string[] {
  const safe = sanitizeQQContent(text);
  const chunks: string[] = [];
  let remaining = safe;
  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, 'utf8') <= maxBytes) {
      chunks.push(remaining);
      break;
    }
    let end = 0;
    let bytes = 0;
    for (const char of remaining) {
      const nextBytes = Buffer.byteLength(char, 'utf8');
      if (bytes > 0 && bytes + nextBytes > maxBytes) break;
      end += char.length;
      bytes += nextBytes;
    }
    const candidate = end > 0 ? remaining.slice(0, end) : remaining.slice(0, 1);
    const minSplit = Math.floor(candidate.length * 0.6);
    const splitters = ['\n\n', '\n', ' '];
    let splitAt = candidate.length;
    for (const splitter of splitters) {
      const at = candidate.lastIndexOf(splitter);
      if (at >= minSplit) { splitAt = at + splitter.length; break; }
    }
    chunks.push(candidate.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
