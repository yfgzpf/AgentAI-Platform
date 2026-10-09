import { logger } from './logger.js';
import crypto from 'crypto';
const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
function generateUin() {
    const buf = new Uint8Array(4);
    crypto.randomFillSync(buf);
    return Buffer.from(buf).toString('base64');
}
export class WeChatApi {
    token;
    baseUrl;
    uin;
    constructor(token, baseUrl = DEFAULT_BASE_URL) {
        // Security: validate baseUrl is from trusted domains
        if (baseUrl) {
            try {
                const url = new URL(baseUrl);
                const allowedHosts = ['weixin.qq.com', 'wechat.com'];
                const isAllowed = allowedHosts.some((h) => url.hostname === h || url.hostname.endsWith('.' + h));
                if (url.protocol !== 'https:' || !isAllowed) {
                    logger.warn('Untrusted baseUrl, using default', { baseUrl });
                    baseUrl = DEFAULT_BASE_URL;
                }
            }
            catch {
                logger.warn('Invalid baseUrl, using default', { baseUrl });
                baseUrl = DEFAULT_BASE_URL;
            }
        }
        this.token = token;
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.uin = generateUin();
    }
    headers() {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.token}`,
            AuthorizationType: 'ilink_bot_token',
            'X-WECHAT-UIN': this.uin,
        };
    }
    async request(path, body, timeoutMs = 15_000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const url = `${this.baseUrl}/${path}`;
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: this.headers(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`HTTP ${res.status}: ${text}`);
            }
            const json = (await res.json());
            return json;
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
            }
            throw err;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async getUpdates(buf) {
        logger.debug('Polling for messages', { hasBuf: !!buf });
        return this.request('ilink/bot/getupdates', buf ? { get_updates_buf: buf } : {}, 35_000);
    }
    async sendMessage(req) {
        const resp = await this.request('ilink/bot/sendmessage', req);
        logger.info('Response sent', { ret: resp.ret, errcode: resp.errcode });
        if (resp.ret !== undefined && resp.ret !== 0) {
            throw new Error(`sendMessage failed: ret=${resp.ret}, errcode=${resp.errcode}, errmsg=${resp.errmsg}`);
        }
        return resp;
    }
    async getConfig(ilinkUserId, contextToken) {
        return this.request('ilink/bot/getconfig', { ilink_user_id: ilinkUserId, context_token: contextToken }, 10_000);
    }
    async sendTyping(toUserId, typingTicket, status) {
        await this.request('ilink/bot/sendtyping', { ilink_user_id: toUserId, typing_ticket: typingTicket, status }, 5_000);
    }
}
