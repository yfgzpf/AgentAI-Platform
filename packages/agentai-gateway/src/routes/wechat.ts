/**
 * 微信绑定路由 (/api/wechat)
 * 供前端调用：获取二维码、轮询扫码状态、查询绑定状态
 */
import { Router, Request, Response } from 'express';
import { startQrLogin, waitForQrScan } from '../wechat/login.js';
import { saveAccount, loadLatestAccount, listAccounts } from '../wechat/account.js';
import { logger } from '../wechat/logger.js';

const router = Router();

/**
 * GET /api/wechat/qrcode
 * 请求一个新的微信登录二维码
 * 返回: { qrcodeUrl, qrcodeId, expiresAt }
 */
router.get('/qrcode', async (_req: Request, res: Response) => {
  try {
    const { qrcodeUrl, qrcodeId } = await startQrLogin();
    logger.info('[wechat] new QR code generated', { qrcodeId });
    res.json({
      success: true,
      qrcodeUrl,
      qrcodeId,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min
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

  try {
    const account = await waitForQrScan(qrcodeId);
    // 扫码成功后立即保存
    saveAccount(account);
    logger.info('[wechat] QR scan confirmed & account saved', {
      accountId: account.accountId,
    });
    res.json({
      success: true,
      status: 'confirmed',
      account,
    });
  } catch (err: any) {
    if (err.message?.includes('expired')) {
      return res.json({
        success: false,
        status: 'expired',
        error: '二维码已过期，请刷新',
      });
    }
    logger.warn('[wechat] QR check error', { error: err.message });
    // 非关键错误继续轮询
    res.json({
      success: false,
      status: 'wait',
      error: err.message,
    });
  }
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
    });
  } else {
    res.json({
      success: true,
      bound: false,
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
  res.json({
    success: true,
    message: `Account ${accountId} deleted (placeholder)`,
  });
});

export { router as wechatRouter };
