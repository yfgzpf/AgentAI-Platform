import { logger } from './logger.js';
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const QR_CODE_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
const QR_STATUS_URL = `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status`;
const POLL_INTERVAL_MS = 3000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function displayQrInTerminal(qrcodeUrl) {
    console.log('请用微信扫描下方二维码：');
    console.log(qrcodeUrl);
    console.log();
    // Note: For better QR display in terminal, install qrcode-terminal npm package
    // npm install qrcode-terminal
}
export async function startQrLogin() {
    logger.info('Requesting QR code');
    try {
        const res = await fetch(QR_CODE_URL, {
            method: 'GET',
        });
        if (!res.ok) {
            throw new Error(`Failed to get QR code: HTTP ${res.status}`);
        }
        const data = (await res.json());
        if (data.ret !== 0 || !data.qrcode_img_content || !data.qrcode) {
            throw new Error(`Failed to get QR code (ret=${data.ret})`);
        }
        logger.info('QR code obtained', { qrcodeId: data.qrcode });
        return {
            qrcodeUrl: data.qrcode_img_content,
            qrcodeId: data.qrcode,
        };
    }
    catch (err) {
        logger.error('Failed to request QR code', { error: String(err) });
        throw err;
    }
}
export async function checkQrStatusOnce(qrcodeId) {
    const url = `${QR_STATUS_URL}?qrcode=${encodeURIComponent(qrcodeId)}`;
    try {
        const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const data = (await res.json());
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
    }
    catch (err) {
        return { status: 'error', error: err.message };
    }
}
export async function waitForQrScan(qrcodeId) {
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
            const data = (await res.json());
            logger.debug('QR status response', { status: data.status });
            switch (data.status) {
                case 'wait':
                case 'scaned':
                    break;
                case 'confirmed': {
                    if (!data.bot_token ||
                        !data.ilink_bot_id ||
                        !data.ilink_user_id) {
                        throw new Error('QR confirmed but missing required fields');
                    }
                    const accountData = {
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
                    if (status &&
                        (status.includes('not_support') ||
                            status.includes('version') ||
                            status.includes('forbid') ||
                            status.includes('reject') ||
                            status.includes('cancel'))) {
                        throw new Error(`QR scan failed: ${data.retmsg || status}`);
                    }
                    break;
                }
            }
            await sleep(POLL_INTERVAL_MS);
        }
        catch (err) {
            if (err instanceof Error &&
                (err.message.includes('expired') ||
                    err.message.includes('失败'))) {
                throw err;
            }
            logger.warn('Error polling QR status, retrying...', {
                error: String(err),
            });
            await sleep(POLL_INTERVAL_MS);
        }
    }
}
