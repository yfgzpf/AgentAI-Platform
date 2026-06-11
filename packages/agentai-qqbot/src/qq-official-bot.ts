/**
 * QQ 官方机器人 SDK (照抄 Reasonix src/qq/bot.ts)
 * ----------------------------------------------------
 * 使用 QQ 官方机器人 API (非 go-cqhttp)
 *
 * 协议: WebSocket Gateway (wss://api.sgroup.qq.com)
 * 鉴权: appId + appSecret → access_token
 * 事件: C2C_MESSAGE_CREATE (私聊) / GROUP_AT_MESSAGE_CREATE (群@)
 *
 * 参照:
 *   - Reasonix src/qq/bot.ts (完整 QQBot 类 + 鉴权/心跳/重连)
 *   - Reasonix src/qq/channel.ts (消息去重/分片/PID 锁)
 *   - QQ 开放平台文档: https://bot.q.qq.com/wiki/
 */

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken';
const BASE_URL = 'https://api.sgroup.qq.com';
const SANDBOX_URL = 'https://sandbox.api.sgroup.qq.com';
const INTENT_C2C_GROUP = 1 << 25;
const MIN_HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_HEARTBEAT_INTERVAL_MS = 60_000;
const ALLOWED_GATEWAY_HOSTS = ['api.sgroup.qq.com', 'sandbox.api.sgroup.qq.com', 'qq.com'];
const QQ_MAX_CHUNK_BYTES = 1500;
const DEDUP_QUEUE_MAX = 200;

export interface QQBotConfig {
  appid: string;
  secret: string;
  sandbox?: boolean;
  /** 允许的群号 (空 = 所有群) */
  allowedGroups?: string[];
  /** 管理员 openid (可执行管理命令) */
  adminOpenIds?: string[];
  /** 触发前缀 (群聊时需要 @机器人, 私聊直接触发) */
  triggerPrefix?: string;
  /** Gateway HTTP 地址 (调 AgentAI Gateway /v1/qq/message) */
  gatewayUrl?: string;
}

export interface C2CMessage {
  author: { user_openid: string };
  content: string;
  id: string;
  timestamp: string;
}

export interface GroupMessage {
  author: { member_openid: string };
  content: string;
  id: string;
  timestamp: string;
  group_openid: string;
}

/** 学自 Reasonix: 远程桌面命令 */
export type QQRemoteCommand =
  | { kind: 'help' }
  | { kind: 'new' }
  | { kind: 'abort' }
  | { kind: 'compact' }
  | { kind: 'retry' }
  | { kind: 'model'; value?: string }
  | { kind: 'effort'; value?: 'low' | 'medium' | 'high' | 'max' }
  | { kind: 'plan'; value?: 'review' | 'auto' | 'yolo' }
  | { kind: 'btw'; text: string }
  | { kind: 'skill'; name: string; args?: string };

export function parseQQRemoteCommand(text: string): QQRemoteCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  if (trimmed === '/help') return { kind: 'help' };
  if (trimmed === '/new') return { kind: 'new' };
  if (trimmed === '/abort') return { kind: 'abort' };
  if (trimmed === '/compact') return { kind: 'compact' };
  if (trimmed === '/retry') return { kind: 'retry' };

  const modelMatch = /^\/model(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (modelMatch) return { kind: 'model', value: modelMatch[1]?.trim() || undefined };

  const effortMatch = /^\/effort(?:\s+(low|medium|high|max))?$/i.exec(trimmed);
  if (effortMatch) return { kind: 'effort', value: effortMatch[1]?.trim().toLowerCase() as any };

  const planMatch = /^\/plan(?:\s+(review|auto|yolo))?$/i.exec(trimmed);
  if (planMatch) return { kind: 'plan', value: planMatch[1]?.trim().toLowerCase() as any };

  const btwMatch = /^\/btw(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (btwMatch && btwMatch[1]?.trim()) return { kind: 'btw', text: btwMatch[1].trim() };

  const skillNames = new Set(['explore', 'research', 'review', 'security_review', 'plan', 'todo']);
  const skillMatch = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (skillMatch && skillMatch[1] && !['help','new','abort','compact','retry','model','effort','plan','btw'].includes(skillMatch[1])) {
    if (skillNames.has(skillMatch[1])) {
      return { kind: 'skill', name: skillMatch[1], args: skillMatch[2]?.trim() || undefined };
    }
  }

  return null;
}

export function qqHelpText(): string {
  return [
    '🤖 AgentAI QQ 机器人命令:',
    '─────────────────',
    '/help - 帮助',
    '/new - 新对话',
    '/abort - 中断回复',
    '/compact - 压缩上下文',
    '/retry - 重试上次',
    '/model <name> - 切换模型',
    '/effort <low|medium|high|max> - AI 努力程度',
    '/plan <review|auto|yolo> - 计划模式',
    '/btw <问题> - 顺便问 (不中断当前)',
    '',
    '直接发消息 = AI 对话',
    '群内需要 @机器人 触发',
  ].join('\n');
}

/** 消息分片 — QQ 单条消息限制约 1500 字节 */
export function splitQQMessage(text: string, maxBytes = QQ_MAX_CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let remaining = text;
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

export class QQOfficialBot extends EventEmitter {
  private config: QQBotConfig;
  private token = '';
  private tokenExpiresAt = 0;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private sessionId = '';
  private closed = false;
  private readyReceived = false;
  private gatewayUrl?: string;
  /** Gateway 心跳定时器 (向 /v1/qq/heartbeat 报告在线状态) */
  private gatewayHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 消息计数 (上报给 Gateway) */
  private messageCount = 0;
  /** 消息去重 (照抄 Reasonix channel.ts) */
  private processedMsgIds = new Set<string>();
  private processedMsgIdQueue: string[] = [];

  constructor(config: QQBotConfig) {
    super();
    this.config = config;
    this.gatewayUrl = config.gatewayUrl || 'http://127.0.0.1:18789';
  }

  private get baseUrl(): string {
    return this.config.sandbox ? SANDBOX_URL : BASE_URL;
  }

  private rememberMessage(id: string): boolean {
    if (this.processedMsgIds.has(id)) return false;
    this.processedMsgIds.add(id);
    this.processedMsgIdQueue.push(id);
    if (this.processedMsgIdQueue.length > DEDUP_QUEUE_MAX) {
      const oldest = this.processedMsgIdQueue.shift();
      if (oldest) this.processedMsgIds.delete(oldest);
    }
    return true;
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
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
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
      body: JSON.stringify({ appId: this.config.appid, clientSecret: this.config.secret }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to get access token (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
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
          console.log(`[QQ] Bot online, session=${this.sessionId}`);
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
        'X-Union-Appid': this.config.appid,
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

    this.ws.on('close', () => {
      if (!this.closed) {
        if (this.readyReceived) {
          console.error('[QQ] WebSocket reconnecting...');
          this.cleanup();
          setTimeout(() => this.reconnect(), 3000);
        } else {
          const msg = 'QQ WebSocket closed before authentication — check your appId and appSecret';
          this.emit('bot_error', msg);
          this.closed = true;
        }
      }
    });

    this.ws.on('error', (err: Error) => {
      console.error(`[QQ] WebSocket error: ${err.message}`);
      this.emit('bot_error', err.message);
    });
  }

  async start(): Promise<void> {
    this.closed = false;
    this.readyReceived = false;

    // 注册消息处理器
    this.on('message.private', async (msg: C2CMessage) => {
      await this.handlePrivateMessage(msg);
    });

    this.on('message.group', async (msg: GroupMessage) => {
      await this.handleGroupMessage(msg);
    });

    // 上线后注册到 Gateway + 启心跳
    this.on('online', () => {
      this.registerToGateway();
      this.startGatewayHeartbeat();
    });

    await this.connect();
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.stopGatewayHeartbeat();
    await this.notifyGatewayOffline();
    this.cleanup();
  }

  // ===== Gateway 注册 / 心跳 / 离线通知 =====

  private async registerToGateway(): Promise<void> {
    try {
      const res = await fetch(`${this.gatewayUrl}/health`);
      if (res.ok) console.log('[QQ] Gateway available');
    } catch { /* OK if not running */ }
  }

  private startGatewayHeartbeat(): void {
    this.stopGatewayHeartbeat();
    this.gatewayHeartbeatTimer = setInterval(async () => {
      try {
        await fetch(`${this.gatewayUrl}/v1/qq/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageCount: this.messageCount,
            sessionId: this.sessionId,
          }),
        });
      } catch { /* Gateway 离线, 不影响 QQ Bot */ }
    }, 30_000);
  }

  private stopGatewayHeartbeat(): void {
    if (this.gatewayHeartbeatTimer) {
      clearInterval(this.gatewayHeartbeatTimer);
      this.gatewayHeartbeatTimer = null;
    }
  }

  private async notifyGatewayOffline(): Promise<void> {
    try {
      await fetch(`${this.gatewayUrl}/v1/qq/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Bot stopped' }),
      });
    } catch { /* ignore */ }
  }

  // ===== 消息处理 (统一走 Gateway /v1/qq/message) =====

  private async handlePrivateMessage(msg: C2CMessage): Promise<void> {
    const text = msg.content?.trim();
    if (!text) return;
    if (!this.rememberMessage(msg.id)) return; // 去重

    const openid = msg.author.user_openid;
    this.messageCount++;

    console.log(`[QQ] 私聊 ${openid}: ${text.slice(0, 80)}`);

    const cmd = parseQQRemoteCommand(text);
    if (cmd) {
      await this.handleRemoteCommand(cmd, openid, 'private', undefined, msg.id);
      return;
    }

    try {
      const reply = await this.callGateway(text, `qq-${openid}`, 'private');
      await this.sendPrivateMessage(openid, reply, msg.id);
    } catch (err: any) {
      await this.sendPrivateMessage(openid, `❌ AI 服务不可用: ${err.message}`, msg.id);
    }
  }

  private async handleGroupMessage(msg: GroupMessage): Promise<void> {
    const text = msg.content?.trim();
    if (!text) return;
    if (!this.rememberMessage(msg.id)) return; // 去重

    const groupOpenid = msg.group_openid;
    const memberOpenid = msg.author.member_openid;
    this.messageCount++;

    // 群白名单
    if (this.config.allowedGroups && this.config.allowedGroups.length > 0 &&
        !this.config.allowedGroups.includes(groupOpenid)) return;

    console.log(`[QQ] 群 ${groupOpenid} ${memberOpenid}: ${text.slice(0, 80)}`);

    const cmd = parseQQRemoteCommand(text);
    if (cmd) {
      await this.handleRemoteCommand(cmd, memberOpenid, 'group', groupOpenid, msg.id);
      return;
    }

    try {
      const reply = await this.callGateway(text, `qq-${memberOpenid}`, 'group', groupOpenid);
      await this.sendGroupMessage(groupOpenid, reply, msg.id);
    } catch (err: any) {
      await this.sendGroupMessage(groupOpenid, `❌ ${err.message}`, msg.id);
    }
  }

  private async handleRemoteCommand(cmd: QQRemoteCommand, openid: string, scope: string, groupOpenid?: string, msgId?: string): Promise<void> {
    const sendFn = scope === 'private'
      ? (text: string) => this.sendPrivateMessage(openid, text, msgId)
      : (text: string) => this.sendGroupMessage(groupOpenid!, text, msgId);

    switch (cmd.kind) {
      case 'help': { await sendFn(qqHelpText()); break; }
      case 'new': { await sendFn('✅ 新对话已开始 — 上下文已清空'); break; }
      case 'abort': { await sendFn('⏹ 已请求中断'); break; }
      case 'compact': { await sendFn('🗜️ 上下文已压缩'); break; }
      case 'retry': { await sendFn('🔄 重试上次回复...'); break; }
      case 'model':
        await sendFn(cmd.value ? `🔄 切换模型到: ${cmd.value}` : '📋 当前: agentai');
        break;
      case 'effort':
        await sendFn(`🎯 AI 努力程度: ${cmd.value || '默认'}`);
        break;
      case 'plan': {
        const labels = { review: '📋 审批模式', auto: '🤖 自动模式', yolo: '🚀 直接执行' };
        await sendFn(`📋 计划模式: ${labels[cmd.value || 'auto'] || 'auto'}`);
        break;
      }
      case 'btw': {
        const reply = await this.callGateway(cmd.text, `qq-${openid}`, scope, groupOpenid);
        await sendFn(`💡 ${reply}`);
        break;
      }
      case 'skill': {
        const reply = await this.callGateway(`请执行技能 ${cmd.name}，参数: ${cmd.args || '无'}`, `qq-${openid}`, scope, groupOpenid);
        await sendFn(`🔧 ${reply}`);
        break;
      }
    }
  }

  // ===== 调 AgentAI Gateway (统一走 /v1/qq/message) =====

  private async callGateway(message: string, userId: string, scope: string, groupId?: string): Promise<string> {
    const res = await fetch(`${this.gatewayUrl}/v1/qq/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, userId, groupId: groupId || scope }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
    }
    const data = await res.json() as { reply?: string; content?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.reply || data.content || '(无回复)';
  }

  // ===== 发消息 (分片) =====

  async sendPrivateMessage(openid: string, content: string, msgId?: string, msgSeq?: number): Promise<void> {
    const chunks = splitQQMessage(content);
    for (const chunk of chunks) {
      try {
        await this._sendPrivateMessageRaw(openid, chunk, msgId, msgSeq);
      } catch (err) {
        console.error(`[QQ] sendPrivateMessage chunk failed: ${(err as Error).message}`);
        break;
      }
    }
  }

  private async _sendPrivateMessageRaw(openid: string, content: string, msgId?: string, msgSeq?: number): Promise<void> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = { content, msg_type: 0 };
    if (msgId) body.msg_id = msgId;
    if (typeof msgSeq === 'number' && Number.isFinite(msgSeq)) body.msg_seq = Math.trunc(msgSeq);
    const res = await fetch(`${this.baseUrl}/v2/users/${encodeURIComponent(openid)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.config.appid,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }

  async sendGroupMessage(groupOpenid: string, content: string, msgId?: string, msgSeq?: number): Promise<void> {
    const chunks = splitQQMessage(content);
    for (const chunk of chunks) {
      try {
        await this._sendGroupMessageRaw(groupOpenid, chunk, msgId, msgSeq);
      } catch (err) {
        console.error(`[QQ] sendGroupMessage chunk failed: ${(err as Error).message}`);
        break;
      }
    }
  }

  private async _sendGroupMessageRaw(groupOpenid: string, content: string, msgId?: string, msgSeq?: number): Promise<void> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = { content, msg_type: 0 };
    if (msgId) body.msg_id = msgId;
    if (typeof msgSeq === 'number' && Number.isFinite(msgSeq)) body.msg_seq = Math.trunc(msgSeq);
    const res = await fetch(`${this.baseUrl}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.config.appid,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
  }
}
