/**
 * 二维码登录流程
 * 请求二维码 → 等待用户扫码 → 获取账号凭证
 */
import type { AccountData } from './types.js';
import { logger } from './logger.js';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const QR_CODE_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
const QR_STATUS_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status`;
const POLL_INTERVAL_MS = 3000;

interface QrCodeResponse {
  ret: number;
  qrcode?: string;             // 二维码唯一标识 (用于轮询)
  qrcode_img_content?: string; // 需要编码进二维码的文本内容 (URL), 不是图片!
}

interface QrStatusResponse {
  ret: number;
  status: string;
  retmsg?: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function displayQrInTerminal(
  qrcodeUrl: string
): Promise<void> {
  console.log(
    '请用微信扫描下方二维码：'
  );
  console.log(qrcodeUrl);
  console.log();
  // Note: For better QR display in terminal, install qrcode-terminal npm package
  // npm install qrcode-terminal
}

export async function startQrLogin(): Promise<{
  qrcodeUrl: string;
  qrcodeId: string;
}> {
  logger.info('Requesting QR code');

  try {
    const res = await fetch(QR_CODE_URL, {
      method: 'GET',
    });

    if (!res.ok) {
      throw new Error(`Failed to get QR code: HTTP ${res.status}`);
    }

    const data = (await res.json()) as QrCodeResponse;
    if (data.ret !== 0 || !data.qrcode_img_content || !data.qrcode) {
      throw new Error(`Failed to get QR code (ret=${data.ret})`);
    }

    logger.info('QR code obtained', { qrcodeId: data.qrcode });
    return {
      qrcodeUrl: data.qrcode_img_content,
      qrcodeId: data.qrcode,
    };
  } catch (err) {
    logger.error('Failed to request QR code', { error: String(err) });
    throw err;
  }
}

/**
 * 单次查询 QR 扫码状态 (不阻塞, 立即返回)
 * 由前端 setInterval 轮询, 每次只查一次
 */
export interface QrCheckResult {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'error';
  account?: AccountData;
  error?: string;
}

export async function checkQrStatusOnce(qrcodeId: string): Promise<QrCheckResult> {
  const url = `${QR_STATUS_URL}?qrcode=${encodeURIComponent(qrcodeId)}`;
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as QrStatusResponse;

    switch (data.status) {
      case 'wait':
        return { status: 'wait' };
      case 'scaned':
        return { status: 'scaned' };
      case 'confirmed': {
        if (!data.bot_token || !data.ilink_bot_id || !data.ilink_user_id) {
          return { status: 'error', error: 'QR confirmed but missing fields' };
        }
        return {
          status: 'confirmed',
          account: {
            botToken: data.bot_token,
            accountId: data.ilink_bot_id,
            baseUrl: data.baseurl || DEFAULT_BASE_URL,
            userId: data.ilink_user_id,
            createdAt: new Date().toISOString(),
          },
        };
      }
      case 'expired':
        return { status: 'expired', error: '二维码已过期' };
      default:
        return { status: 'error', error: `未知状态: ${data.status}` };
    }
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
}

export async function waitForQrScan(
  qrcodeId: string
): Promise<AccountData> {
  let currentQrcodeId = qrcodeId;

  while (true) {
    const url = `${QR_STATUS_URL}?qrcode=${encodeURIComponent(currentQrcodeId)}`;
    logger.debug('Polling QR status', { qrcodeId: currentQrcodeId });

    try {
      const res = await fetch(url, {
        method: 'GET',
      });

      if (!res.ok) {
        throw new Error(`Failed to check QR status: HTTP ${res.status}`);
      }

      const data = (await res.json()) as QrStatusResponse;
      logger.debug('QR status response', { status: data.status });

      switch (data.status) {
        case 'wait':
        case 'scaned':
          break;

        case 'confirmed': {
          if (
            !data.bot_token ||
            !data.ilink_bot_id ||
            !data.ilink_user_id
          ) {
            throw new Error(
              'QR confirmed but missing required fields'
            );
          }

          const accountData: AccountData = {
            botToken: data.bot_token,
            accountId: data.ilink_bot_id,
            baseUrl: data.baseurl || DEFAULT_BASE_URL,
            userId: data.ilink_user_id,
            createdAt: new Date().toISOString(),
          };

          logger.info('QR login successful', {
            accountId: accountData.accountId,
          });
          return accountData;
        }

        case 'expired': {
          throw new Error('QR code expired');
        }

        default: {
          const status = data.status ?? '';
          if (
            status &&
            (status.includes('not_support') ||
              status.includes('version') ||
              status.includes('forbid') ||
              status.includes('reject') ||
              status.includes('cancel'))
          ) {
            throw new Error(
              `QR scan failed: ${data.retmsg || status}`
            );
          }
          break;
        }
      }

      await sleep(POLL_INTERVAL_MS);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message.includes('expired') ||
          err.message.includes('失败'))
      ) {
        throw err;
      }
      logger.warn('Error polling QR status, retrying...', {
        error: String(err),
      });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
