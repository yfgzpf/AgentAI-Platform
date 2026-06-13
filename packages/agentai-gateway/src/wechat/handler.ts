/**
 * 消息路由处理 - 将微信消息桥接到 AgentAI Gateway API
 */
import type { WeixinMessage } from './types.js';
import { logger } from './logger.js';
import type {
  LocalSession,
  SessionHandle,
} from './session.js';
import {
  createSession,
  loadSession,
  saveSession,
  addChatMessage,
  clearSession,
  deleteSessionFile,
  getChatHistoryText,
  findSessionByGatewayId,
  listLocalSessions,
} from './session.js';

const MAX_MESSAGE_LENGTH = 2048;
let clientCounter = 0;

function generateClientId(): string {
  return `wac-${Date.now()}-${++clientCounter}`;
}

function extractTextFromItems(
  items: NonNullable<WeixinMessage['item_list']>
): string {
  return items
    .map((item) => item.text_item?.text)
    .filter(Boolean)
    .join('\n');
}

function splitMessage(
  text: string,
  maxLen: number = MAX_MESSAGE_LENGTH
): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining
      .slice(splitIdx)
      .replace(/^\n+/, '');
  }
  return chunks;
}

export interface MessageHandlerContext {
  account: { botToken: string; accountId: string; baseUrl: string };
  gatewayUrl: string; // e.g., http://127.0.0.1:18789
  sessionId: string;
  session: LocalSession;
}

// 处理去重
const processingMsgIds = new Set<string>();

export async function handleMessage(
  msg: WeixinMessage,
  ctx: MessageHandlerContext,
  sendReply: (
    toUserId: string,
    contextToken: string,
    text: string
  ) => Promise<void>
): Promise<void> {
  if (msg.message_type !== 1) return; // Only user messages
  if (!msg.from_user_id || !msg.item_list) return;

  const msgId = `${msg.from_user_id}-${msg.context_token}`;
  if (processingMsgIds.has(msgId)) {
    logger.warn('Duplicate message, skipping', { msgId });
    return;
  }
  processingMsgIds.add(msgId);
  setTimeout(() => processingMsgIds.delete(msgId), 60000);

  const userText = extractTextFromItems(msg.item_list);
  if (!userText) return;

  logger.info('Received message', {
    from: msg.from_user_id,
    text: userText.substring(0, 80),
  });

  const handle = ctx;
  const session = handle.session;

  // Handle slash commands
  if (userText.startsWith('/')) {
    const result = handleCommand(userText, session, ctx.gatewayUrl);
    if (result) {
      await sendReply(
        msg.from_user_id,
        msg.context_token || '',
        result
      );
      return;
    }
  }

  // Check if session is valid
  if (!session.gatewaySessionId) {
    await sendReply(
      msg.from_user_id,
      msg.context_token || '',
      '当前会话未绑定到 Gateway 会话\n请使用 /new 创建新会话'
    );
    return;
  }

  session.state = 'processing';
  saveSession(handle.sessionId, session);
  addChatMessage(session, 'user', userText);

  try {
    // Call AgentAI Gateway API
    const gatewayUrl = `${ctx.gatewayUrl}/api/chat`;
    const resp = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userText,
        sessionKey: session.gatewaySessionId,
      }),
      signal: AbortSignal.timeout(1800000), // 30 min timeout
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Gateway API error', {
        status: resp.status,
        body: text.substring(0, 200),
      });
      await sendReply(
        msg.from_user_id,
        msg.context_token || '',
        'Gateway 处理请求时出错，请稍后重试。'
      );
    } else {
      const data = (await resp.json()) as any;
      const replyText =
        (data.content || data.answer || '无返回内容') as string;
      addChatMessage(session, 'assistant', replyText);

      // Split long messages
      const chunks = splitMessage(replyText);
      for (const chunk of chunks) {
        await sendReply(
          msg.from_user_id,
          msg.context_token || '',
          chunk
        );
      }
    }

    session.state = 'idle';
    saveSession(handle.sessionId, session);
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : String(err);
    logger.error('Message processing error', {
      error: errorMsg,
    });
    await sendReply(
      msg.from_user_id,
      msg.context_token || '',
      '处理消息时出错，请稍后重试。'
    );
    session.state = 'idle';
    saveSession(handle.sessionId, session);
  }
}

function handleCommand(
  text: string,
  session: LocalSession,
  gatewayUrl: string
): string | null {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] || '').slice(1).toLowerCase();
  const args = parts.slice(1).join(' ');

  switch (cmd) {
    case 'help':
      return `微信 AgentAI 助手命令：
/help     - 显示帮助信息
/new      - 创建新会话 (首次使用必选)
/history  - 查看最近20条聊天记录
/sessions - 列出所有会话
/switch   - 切换会话 (需 Gateway 支持多会话)
/status   - 查看当前会话状态`;

    case 'new':
      return '✅ 已创建新会话 (请设置 gatewaySessionId)';

    case 'history':
      return getChatHistoryText(session, 20) || '暂无聊天记录';

    case 'sessions':
      return '📋 当前仅支持单会话模式';

    case 'status':
      return `当前会话状态: ${session.state}
已处理消息: ${session.chatHistory.length} 条`;

    default:
      return `❌ 未知指令: ${cmd}\n发送 /help 查看可用命令`;
  }
}
