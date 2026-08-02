/**
 * AgentAI Platform - QQ Bot 独立包 (重写: 对齐 reasonix)
 * -----------------------------------------------------------
 * 架构:
 *   QQBot → wss://api.sgroup.qq.com → 消息处理 → Gateway /v1/qq/message
 *
 * 消息处理继承 reasonix channel.ts:
 *   - 消息去重 (200条环形队列)
 *   - 分片发送 (1500字节/条)
 *   - 远程命令 (/help /new /abort 等)
 *   - 私聊/群@ 消息路由
 *   - 调用 gateway /v1/qq/message 完成 LLM 对话
 *
 * 启动方式:
 *   AGENTAI_QQ_APPID=xxx AGENTAI_QQ_SECRET=xxx pnpm --filter agentai-qqbot dev
 *
 * 环境变量:
 *   AGENTAI_QQ_APPID / AGENTAI_QQ_SECRET / AGENTAI_QQ_SANDBOX
 *   AGENTAI_QQ_GROUPS / AGENTAI_QQ_ADMINS / AGENTAI_QQ_TRIGGER
 *   AGENTAI_GATEWAY_URL (默认 http://127.0.0.1:18789)
 */

import chalk from 'chalk';
import { QQBot, splitQQMessage } from './qq-official-bot.js';
import type { C2CMessage, GroupMessage } from './qq-official-bot.js';

const QQ_MAX_CHUNK_BYTES = 1500;
const DEDUP_QUEUE_MAX = 200;
const QQ_GATEWAY_TIMEOUT_MS = 120_000;

// ===== 消息去重 (reasonix channel.ts) =====
const processedMsgIds = new Set<string>();
const processedMsgIdQueue: string[] = [];

function rememberMessage(id: string): boolean {
  if (processedMsgIds.has(id)) return false;
  processedMsgIds.add(id);
  processedMsgIdQueue.push(id);
  if (processedMsgIdQueue.length > DEDUP_QUEUE_MAX) {
    const oldest = processedMsgIdQueue.shift();
    if (oldest) processedMsgIds.delete(oldest);
  }
  return true;
}

// ===== 远程命令 (学自 reasonix) =====
type QQRemoteCommand =
  | { kind: 'help' | 'new' | 'abort' | 'compact' | 'retry' }
  | { kind: 'model'; value?: string }
  | { kind: 'effort'; value?: 'low' | 'medium' | 'high' | 'max' }
  | { kind: 'plan'; value?: 'review' | 'auto' | 'yolo' }
  | { kind: 'btw'; text: string }
  | { kind: 'skill'; name: string; args?: string };

function parseRemoteCommand(text: string): QQRemoteCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  if (trimmed === '/help') return { kind: 'help' };
  if (trimmed === '/new') return { kind: 'new' };
  if (trimmed === '/abort') return { kind: 'abort' };
  if (trimmed === '/compact') return { kind: 'compact' };
  if (trimmed === '/retry') return { kind: 'retry' };
  const mm = /^\/model(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (mm) return { kind: 'model', value: mm[1]?.trim() };
  const em = /^\/effort(?:\s+(low|medium|high|max))?$/i.exec(trimmed);
  if (em) return { kind: 'effort', value: em[1]?.toLowerCase() as any };
  const pm = /^\/plan(?:\s+(review|auto|yolo))?$/i.exec(trimmed);
  if (pm) return { kind: 'plan', value: pm[1]?.toLowerCase() as any };
  const bm = /^\/btw(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (bm && bm[1]?.trim()) return { kind: 'btw', text: bm[1].trim() };
  return null;
}

function remoteCommandReply(cmd: QQRemoteCommand): string | null {
  switch (cmd.kind) {
    case 'help': return [
      '🤖 AgentAI QQ 命令:',
      '/help  - 帮助  /new   - 新对话',
      '/abort - 中断  /compact - 压缩上下文',
      '/retry - 重试  /model <name> - 切换模型',
      '/effort <low|medium|high|max> - AI 努力程度',
      '/plan <review|auto|yolo> - 计划模式',
      '/btw <问题> - 顺便问',
    ].join('\n');
    case 'new': return '✅ 新对话已开始';
    case 'abort': return '⏹ 已请求中断';
    case 'compact': return '🗜️ 上下文已压缩';
    case 'retry': return '🔄 重试上次回复...';
    case 'model': return cmd.value ? `🔄 切换模型: ${cmd.value}` : '📋 当前: agentai';
    case 'effort': return `🎯 AI 努力程度: ${cmd.value || '默认'}`;
    case 'plan': {
      const labels: Record<string, string> = { review: '📋 审批', auto: '🤖 自动', yolo: '🚀 直接执行' };
      return `📋 计划模式: ${labels[cmd.value || 'auto'] || 'auto'}`;
    }
    case 'btw': return null; // 需要调 gateway
    case 'skill': return null; // 需要调 gateway
  }
}

// ===== Gateway 调用 =====
async function callGateway(message: string, userId: string): Promise<string> {
  const gatewayUrl = process.env.AGENTAI_GATEWAY_URL || 'http://127.0.0.1:18789';
  const res = await fetch(`${gatewayUrl}/v1/qq/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, userId, groupId: 'qq' }),
    signal: AbortSignal.timeout(QQ_GATEWAY_TIMEOUT_MS),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gateway ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json() as { reply?: string; content?: string; error?: string };
  if (data.error) throw new Error(data.error);
  return data.reply || data.content || '(无回复)';
}

// ===== 发送（分片） =====
async function sendReply(
  bot: QQBot,
  chunks: string[],
  sendFn: (chunk: string, index: number) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    try {
      await sendFn(chunks[i], i);
    } catch (err: any) {
      console.error(`[QQ] send chunk ${i + 1}/${chunks.length} failed: ${err.message}`);
      break;
    }
  }
}

// ===== 主启动 =====
async function startOfficialMode() {
  const appid = process.env.AGENTAI_QQ_APPID;
  const secret = process.env.AGENTAI_QQ_SECRET;

  if (!appid || !secret) {
    console.error(chalk.red('❌ 请设置环境变量:'));
    console.error(chalk.gray('   AGENTAI_QQ_APPID=你的appId'));
    console.error(chalk.gray('   AGENTAI_QQ_SECRET=你的appSecret'));
    console.error(chalk.gray('   获取: https://q.qq.com/ -> 创建机器人'));
    process.exit(1);
  }

  const gatewayUrl = process.env.AGENTAI_GATEWAY_URL || 'http://127.0.0.1:18789';

  console.log(chalk.cyan('🚀 AgentAI QQ Bot 启动中...'));
  console.log(chalk.gray(`   AppID: ${appid}`));
  console.log(chalk.gray(`   Gateway: ${gatewayUrl}`));
  console.log(chalk.gray(`   沙箱: ${process.env.AGENTAI_QQ_SANDBOX === 'true' ? '是' : '否'}`));

  const bot = new QQBot({
    appid,
    secret,
    sandbox: process.env.AGENTAI_QQ_SANDBOX === 'true',
  });

  let online = false;

  // ===== 私聊消息 =====
  bot.on('message.private', async (msg: C2CMessage) => {
    const text = msg.content?.trim();
    if (!text) return;
    if (!rememberMessage(msg.id)) return; // 去重

    const openid = msg.author.user_openid;
    console.log(`[QQ] 私聊 ${openid}: ${text.slice(0, 80)}`);

    const cmd = parseRemoteCommand(text);
    if (cmd) {
      const reply = remoteCommandReply(cmd);
      if (reply) {
        await sendReply(bot, splitQQMessage(reply, QQ_MAX_CHUNK_BYTES),
          (chunk) => bot.sendPrivateMessage(openid, chunk, msg.id));
        return;
      }
      if (cmd.kind === 'btw') {
        try {
          const r = await callGateway(cmd.text, `qq-${openid}`);
          await sendReply(bot, splitQQMessage(r, QQ_MAX_CHUNK_BYTES),
            (chunk) => bot.sendPrivateMessage(openid, chunk, msg.id));
        } catch (err: any) {
          await bot.sendPrivateMessage(openid, `❌ ${err.message}`, msg.id);
        }
        return;
      }
    }

    try {
      const reply = await callGateway(text, `qq-${openid}`);
      await sendReply(bot, splitQQMessage(reply, QQ_MAX_CHUNK_BYTES),
        (chunk) => bot.sendPrivateMessage(openid, chunk, msg.id));
    } catch (err: any) {
      await bot.sendPrivateMessage(openid, `❌ AI 服务不可用: ${err.message}`, msg.id);
    }
  });

  // ===== 群@消息 =====
  bot.on('message.group', async (msg: GroupMessage) => {
    const text = msg.content?.trim();
    if (!text) return;
    if (!rememberMessage(msg.id)) return;

    const groupOpenid = msg.group_openid;
    const memberOpenid = msg.author.member_openid;

    // 群白名单
    const allowedGroups = process.env.AGENTAI_QQ_GROUPS?.split(',').filter(Boolean);
    if (allowedGroups && allowedGroups.length > 0 && !allowedGroups.includes(groupOpenid)) return;

    console.log(`[QQ] 群 ${groupOpenid} ${memberOpenid}: ${text.slice(0, 80)}`);

    const cmd = parseRemoteCommand(text);
    if (cmd) {
      const reply = remoteCommandReply(cmd);
      if (reply) {
        await sendReply(bot, splitQQMessage(reply, QQ_MAX_CHUNK_BYTES),
          (chunk) => bot.sendGroupMessage(groupOpenid, chunk, msg.id));
        return;
      }
      if (cmd.kind === 'btw') {
        try {
          const r = await callGateway(cmd.text, `qq-${memberOpenid}`);
          await sendReply(bot, splitQQMessage(r, QQ_MAX_CHUNK_BYTES),
            (chunk) => bot.sendGroupMessage(groupOpenid, chunk, msg.id));
        } catch (err: any) {
          await bot.sendGroupMessage(groupOpenid, `❌ ${err.message}`, msg.id);
        }
        return;
      }
    }

    try {
      const reply = await callGateway(text, `qq-${memberOpenid}`);
      await sendReply(bot, splitQQMessage(reply, QQ_MAX_CHUNK_BYTES),
        (chunk) => bot.sendGroupMessage(groupOpenid, chunk, msg.id));
    } catch (err: any) {
      await bot.sendGroupMessage(groupOpenid, `❌ ${err.message}`, msg.id);
    }
  });

  // ===== 上线通知 =====
  bot.on('online', () => {
    online = true;
    console.log(chalk.green('✅ QQ Bot 已上线'));
  });

  // ===== 错误通知 =====
  bot.on('bot_error', (msg: string) => {
    console.error(chalk.red(`❌ ${msg}`));
  });

  // ===== 启动 + 超时 race (reasonix 方式) =====
  await bot.start();

  const readyOrError = await Promise.race([
    new Promise<'ready'>((resolve) => bot.once('online', () => resolve('ready'))),
    new Promise<'error'>((resolve) => bot.once('bot_error', () => resolve('error'))),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
  ]);

  if (readyOrError === 'error') {
    console.error(chalk.red('❌ QQ WebSocket 鉴权失败 — 请检查 AppID/AppSecret'));
    console.error(chalk.gray('   详见上方日志中的错误码'));
    console.error(chalk.gray('   如果是首次连接, 也请确认:'));
    console.error(chalk.gray('     1. 在 q.qq.com 开启 "C2C消息" 和 "群聊@消息" 权限'));
    console.error(chalk.gray('     2. 机器人类型为 "QQ群机器人" (非 QQ频道)'));
    console.error(chalk.gray('     3. 沙箱环境需设置 AGENTAI_QQ_SANDBOX=true'));
    // reasonix 不 exit, 继续重试
  } else if (readyOrError === 'timeout') {
    console.error(chalk.yellow('⚠️   连接超时 (20s), 后台继续重试中...'));
  }

  // ===== 优雅关闭 =====
  const shutdown = async () => {
    console.log(chalk.yellow('\n🛑 关闭中...'));
    await bot.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// 旧版 go-cqhttp 兼容
async function startGoCqHttpMode() {
  const { QQBotService } = await import('./service-legacy.js');
  const { QQConfig } = await import('./config.js');
  const config = QQConfig.load();
  const service = new QQBotService(config);
  await service.start();
}

export async function startDefault(): Promise<void> {
  const mode = process.env.AGENTAI_QQ_MODE || 'official';
  if (mode === 'go-cqhttp') {
    await startGoCqHttpMode();
  } else {
    await startOfficialMode();
  }
}

// 直接运行
startDefault().catch(err => {
  console.error(chalk.red('❌ 启动失败:'), err);
  process.exit(1);
});
