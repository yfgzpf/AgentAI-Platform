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
import { userModel } from '../user-model.js';
import { resolve as resolveChannel, type ChannelType } from '../channel-session-bridge.js';
import * as customerStore from '../customer-store.js';

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

  // 自动绑定 gatewaySessionId (首次消息时) — A3: 通过 bridge 解析统一 sessionId
  const channel: ChannelType = 'wechat';
  const unifiedUserId = resolveChannel(channel, msg.from_user_id, {
    label: `微信:${msg.from_user_id.slice(0, 8)}`,
  });
  if (!session.gatewaySessionId) {
    session.gatewaySessionId = unifiedUserId;
    saveSession(handle.sessionId, session);
  }

  // ── 自动录入客户 + 注入跟进上下文 ──
  // 客户发消息时: 1) 自动创建/更新客户档案 2) 记录旅程 3) 注入跟进提醒
  let enrichedMessage = userText;
  try {
    customerStore.recordMessage(channel, msg.from_user_id, userText);
    const ctx = customerStore.getCustomerContext(channel, msg.from_user_id);
    if (ctx) {
      enrichedMessage = `${ctx}\n用户消息: ${userText}`;
      // 客户主动联系了, 清除跟进标记 (已自然完成跟进)
      customerStore.clearFollowUp(channel, msg.from_user_id);
    }
  } catch (e: any) {
    logger.warn('Customer context injection failed', { error: e?.message });
  }

  session.state = 'processing';
  saveSession(handle.sessionId, session);
  addChatMessage(session, 'user', userText);

  try {
    // Call AgentAI Gateway API (使用 /v1/chat 端点) — A3: 使用统一 userId
    const gatewayUrl = `${ctx.gatewayUrl}/v1/chat`;
    
    // 解析可靠的 workspace 路径 (优先使用环境变量, 避免 process.cwd() 在 Windows 上的问题)
    const workspacePath = process.env.AGENTAI_WORKSPACE || process.env.PROJECT_ROOT || process.cwd();
    
    logger.info('Calling Gateway chat API', { 
      url: gatewayUrl, 
      userId: unifiedUserId,
      workspace: workspacePath,
      msgLen: enrichedMessage.length,
    });

    const resp = await fetch(gatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: enrichedMessage,  // 注入客户上下文后的消息
        stream: false,
        userId: unifiedUserId,  // A3: 使用统一 userId 而非 msg.from_user_id
        workspace: workspacePath,
        model: userModel.get(unifiedUserId).preferences.preferredModel || 'agentai',  // 同步用户在页面上选择的模型
        _internal: true,  // 标记为内部调用, 绕过速率限制
      }),
      signal: AbortSignal.timeout(1800000), // 30 min timeout
    });

    if (!resp.ok) {
      const text = await resp.text();
      logger.error('Gateway API error', {
        status: resp.status,
        body: text.substring(0, 500),
      });
      await sendReply(
        msg.from_user_id,
        msg.context_token || '',
        'Gateway 处理请求时出错，请稍后重试。'
      );
    } else {
      const data = (await resp.json()) as any;
      
      // 检查返回数据中是否包含错误信息
      if (data.error && !data.content) {
        logger.error('Gateway returned error in response body', {
          error: data.error,
          hint: data.hint,
        });
        await sendReply(
          msg.from_user_id,
          msg.context_token || '',
          `AI 处理出错: ${String(data.error).slice(0, 100)}`
        );
        session.state = 'idle';
        saveSession(handle.sessionId, session);
        return;
      }
      
      const replyText =
        (data.content || data.answer || '无返回内容') as string;
      
      logger.info('Gateway reply received', {
        len: replyText.length,
        preview: replyText.slice(0, 80),
      });
      
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
