/**
 * 微信绑定路由 (/api/wechat)
 * 供前端调用：获取二维码、轮询扫码状态、查询绑定状态
 *
 * 关键认知 (来自 Hermes weixin.py):
 *   qrcode_img_content 是**需要编码进二维码的文本内容** (URL字符串),
 *   不是图片 URL! 必须用 QR 生成服务把它转成真正的二维码图片。
 */
import { Router, Request, Response } from 'express';
import { startQrLogin, checkQrStatusOnce } from '../wechat/login.js';
import { saveAccount, loadLatestAccount, listAccounts, deleteAccount } from '../wechat/account.js';
import { logger } from '../wechat/logger.js';
import { WeChatApi } from '../wechat/api.js';
import { createMonitor, type MonitorCallbacks } from '../wechat/monitor.js';
import { handleMessage } from '../wechat/handler.js';
import { createSession, loadSession, saveSession, type SessionHandle } from '../wechat/session.js';
import type { AccountData } from '../wechat/types.js';
import type { Server as IOServer } from 'socket.io';
import https from 'node:https';
import http from 'node:http';

const router = Router();

/** QR 生成 API (免费, 可靠) */
const QR_API_BASE = 'https://api.qrserver.com/v1/create-qr-code';

/**
 * 从 qrserver API 下载生成的二维码图片转 base64
 */
function fetchQrImageAsBase64(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      headers: { 'User-Agent': 'AgentAI/1.0', 'Accept': 'image/png' },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * GET /api/wechat/qrcode
 * 请求一个新的微信登录二维码
 * 流程:
 *   1. 调用微信 API 获取 qrcodeContent (需要被编码的文本)
 *   2. 调用 qrserver API 将文本生成真正的二维码图片
 *   3. 下载生成的二维码图片转 base64 返回前端
 * 返回: { qrcodeImage (base64 png), qrcodeId, qrImageUrl (直接URL备用) }
 */
router.get('/qrcode', async (_req: Request, res: Response) => {
  try {
    const { qrcodeUrl: qrcodeContent, qrcodeId } = await startQrLogin();
    logger.info('[wechat] QR code text obtained', { qrcodeId, contentLen: qrcodeContent.length });

    // 用 qrserver API 生成真正的二维码图片
    const qrImageUrl = `${QR_API_BASE}/?size=250x250&data=${encodeURIComponent(qrcodeContent)}`;

    let qrcodeImage = '';
    try {
      qrcodeImage = await fetchQrImageAsBase64(qrImageUrl);
      logger.info('[wechat] QR code image generated via qrserver');
    } catch (err: any) {
      logger.warn('[wechat] qrserver failed, returning raw URL for frontend fallback', { error: err.message });
    }

    res.json({
      success: true,
      qrImageUrl,     // QR 图片直接 URL (前端备用, 浏览器可直接加载)
      qrcodeImage,    // base64 图片数据 (优先使用)
      qrcodeContent,  // 原始文本内容 (调试用)
      qrcodeId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
  } catch (err: any) {
    logger.error('[wechat] failed to get QR code', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/wechat/check/:qrcodeId
 * 轮询查询二维码扫码状态
 * 返回: { status: 'wait' | 'scaned' | 'confirmed' | 'expired', account?: AccountData }
 */
router.get('/check/:qrcodeId', async (req: Request, res: Response) => {
  const { qrcodeId } = req.params;
  if (!qrcodeId) {
    return res.status(400).json({ success: false, error: 'Missing qrcodeId' });
  }

  // 使用单次轮询 (不阻塞), 前端 setInterval 每 3s 调用一次
  const result = await checkQrStatusOnce(qrcodeId);

  if (result.status === 'confirmed' && result.account) {
    saveAccount(result.account);
    logger.info('[wechat] QR scan confirmed & account saved', {
      accountId: result.account.accountId,
    });
    // 自动启动消息监听 daemon
    startWechatDaemon(result.account).catch((err: any) => {
      logger.error('[wechat] daemon start failed', { error: err.message });
    });
    return res.json({ success: true, status: 'confirmed', account: result.account });
  }

  if (result.status === 'expired') {
    return res.json({ success: false, status: 'expired', error: result.error || '二维码已过期' });
  }

  if (result.status === 'scaned') {
    return res.json({ success: true, status: 'scaned' });
  }

  // wait 或 error → 继续轮询
  res.json({ success: true, status: result.status === 'error' ? 'wait' : result.status, error: result.error });
});

/**
 * GET /api/wechat/status
 * 查询当前已绑定的微信账号状态
 */
router.get('/status', (_req: Request, res: Response) => {
  const account = loadLatestAccount();
  if (account) {
    res.json({
      success: true,
      bound: true,
      accountId: account.accountId,
      createdAt: account.createdAt,
      daemonRunning: isDaemonRunning,
    });
  } else {
    res.json({
      success: true,
      bound: false,
      daemonRunning: false,
    });
  }
});

/**
 * GET /api/wechat/accounts
 * 列出所有已绑定的账号 (管理用途)
 */
router.get('/accounts', (_req: Request, res: Response) => {
  const accounts = listAccounts();
  res.json({
    success: true,
    accounts: accounts.map(a => ({
      accountId: a.accountId,
      createdAt: a.createdAt,
    })),
  });
});

/**
 * DELETE /api/wechat/account/:accountId
 * 删除一个已绑定的账号
 */
router.delete('/account/:accountId', (req: Request, res: Response) => {
  const { accountId } = req.params;
  try {
    const deleted = deleteAccount(accountId ?? '');
    if (deleted) {
      res.json({ success: true, message: `Account ${accountId} deleted` });
    } else {
      res.status(404).json({ success: false, error: `Account ${accountId} not found` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== WeChat 消息监听 Daemon (自动启动) =====

let monitorController: AbortController | null = null;
let isDaemonRunning = false;
let wechatIO: IOServer | null = null;

/** 后置注入 socket.io 实例 (与 QQ 一致) */
export function setWechatIO(io: IOServer) {
  wechatIO = io;
}

/** 推送事件到前端 GUI */
function emitToGUI(event: string, data: any) {
  if (wechatIO) {
    wechatIO.emit(event, data);
  }
}

function gatewayEndpoint(): string {
  const host = process.env.AGENTAI_HOST || '127.0.0.1';
  const port = process.env.AGENTAI_PORT || '18789';
  return `http://${host}:${port}`;
}

async function handleWeChatMessage(msg: any, account: AccountData, sessionHandle: SessionHandle) {
  try {
    // 提取用户消息文本, 推送到前端
    const userText = msg.item_list?.map((i: any) => i.text_item?.text).filter(Boolean).join('\n') || '';
    if (userText && msg.from_user_id) {
      emitToGUI('wechat:message', {
        source: 'wechat',
        userId: msg.from_user_id,
        content: userText,
        ts: Date.now(),
      });
    }

    await handleMessage(msg, {
      account,
      gatewayUrl: gatewayEndpoint(),
      sessionId: sessionHandle.sessionId,
      session: sessionHandle.session,
    }, async (toUserId, contextToken, text) => {
      const api = new WeChatApi(account.botToken, account.baseUrl);
      const clientId = `wac-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        await api.sendMessage({
          msg: {
            from_user_id: '',
            to_user_id: toUserId,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }],
          },
        });
        logger.info('[wechat-daemon] reply sent', { to: toUserId, len: text.length });

        // 推送 AI 回复到前端
        emitToGUI('wechat:reply', {
          source: 'wechat',
          userId: toUserId,
          content: text,
          ts: Date.now(),
        });
      } catch (err: any) {
        logger.error('[wechat-daemon] send reply failed', { error: err.message });
      }
    });
  } catch (err: any) {
    logger.error('[wechat-daemon] handle message error', { error: err.message });
  }
}

async function startWechatDaemon(account: AccountData) {
  if (isDaemonRunning) {
    // 停旧监控
    if (monitorController) {
      monitorController.abort();
      monitorController = null;
    }
    isDaemonRunning = false;
  }

  monitorController = new AbortController();
  const sessionHandle = createSession(account.accountId);
  saveSession(sessionHandle.sessionId, sessionHandle.session);
  const api = new WeChatApi(account.botToken, account.baseUrl);

  const callbacks: MonitorCallbacks = {
    onMessage: async (msg: any) => {
      if (!sessionHandle.session.gatewaySessionId) {
        sessionHandle.session.gatewaySessionId = `${account.accountId}:${account.userId}`;
        saveSession(sessionHandle.sessionId, sessionHandle.session);
      }
      await handleWeChatMessage(msg, account, sessionHandle);
    },
    onSessionExpired: () => {
      logger.warn('[wechat-daemon] session expired, stopping daemon');
      if (monitorController) { monitorController.abort(); monitorController = null; }
      isDaemonRunning = false;
    },
  };

  isDaemonRunning = true;
  const monitor = createMonitor(api, callbacks);

  logger.info('[wechat-daemon] started', { accountId: account.accountId });

  // 后台运行 monitor
  monitor.run().catch((err: any) => {
    if (err.name !== 'AbortError') {
      logger.error('[wechat-daemon] monitor error', { error: err.message });
    }
    isDaemonRunning = false;
  });
}

export { router as wechatRouter };

// ===== 启动时自动恢复 daemon (延迟3秒异步启动) =====
setTimeout(() => {
  try {
  const savedAccount = loadLatestAccount();
  if (savedAccount) {
    logger.info('[wechat] found saved account, auto-starting daemon', { accountId: savedAccount.accountId });
    startWechatDaemon(savedAccount).catch((err: any) => {
      logger.error('[wechat] auto-start daemon failed', { error: err.message });
    });
  }
} catch { /* best-effort */ }
}, 3000);
