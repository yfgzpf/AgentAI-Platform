/**
 * 订阅管理路由
 * ----------------------------------------------------
 * 后端注入 ALRC 内置密钥，前端只传递订阅状态
 * GET  /v1/subscription/status  — 查询订阅状态（需登录）
 * POST /v1/subscription/activate — 激活订阅（需登录）
 * POST /v1/subscription/cancel   — 取消订阅（需登录）
 */
import { Router } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const SUBSCRIPTION_PLANS = {
    starter: { name: '入门版', priceMonth: 29, priceYear: 299, monthlyTokenLimit: 5_000_000, imageQuota: 20, chatModels: ['alrc-gpt-5.4-mini', 'alrc-claude-haiku-4-5', 'alrc-grok-4.5', 'alrc-doubao-seed-2-0-pro'] },
    pro: { name: '专业版', priceMonth: 99, priceYear: 999, monthlyTokenLimit: 200_000_000, imageQuota: 100, chatModels: ['alrc-gpt-5.4', 'alrc-gpt-5.4-mini', 'alrc-gpt-5.5', 'alrc-gpt-5.5-compact', 'alrc-gpt-5.6-luna', 'alrc-gpt-5.6-sol', 'alrc-gpt-5.6-terra', 'alrc-claude-fable-5', 'alrc-claude-haiku-4-5', 'alrc-grok-4.5', 'alrc-grok-composer-2.5', 'alrc-lingyan-3.5', 'alrc-doubao-seed-2-0-pro'] },
    ultimate: { name: '旗舰版', priceMonth: 299, priceYear: 2999, monthlyTokenLimit: 0, imageQuota: 500, chatModels: ['alrc-gpt-5.4', 'alrc-gpt-5.4-mini', 'alrc-gpt-5.5', 'alrc-gpt-5.5-compact', 'alrc-gpt-5.6-luna', 'alrc-gpt-5.6-sol', 'alrc-gpt-5.6-terra', 'alrc-claude-fable-5', 'alrc-claude-haiku-4-5', 'alrc-claude-opus-4-6', 'alrc-grok-4.5', 'alrc-grok-composer-2.5', 'alrc-lingyan-3.5', 'alrc-doubao-seed-2-0-pro'] },
};
function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
    }
    catch { }
    return {};
}
function writeConfig(config) {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    }
    catch (e) {
        console.error('[subscription] failed to write config:', e);
    }
}
/** 验证 JWT token */
function verifyToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
        return null;
    const token = authHeader.slice(7);
    try {
        const [payload, signature] = token.split('.');
        const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'agentai-default-secret')
            .update(payload)
            .digest('hex');
        if (signature !== expected)
            return null;
        const { userId } = JSON.parse(Buffer.from(payload, 'base64').toString());
        return userId;
    }
    catch {
        return null;
    }
}
export function createSubscriptionRouter() {
    const router = Router();
    // GET /v1/subscription/status
    router.get('/status', (req, res) => {
        try {
            const userId = verifyToken(req);
            if (!userId) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            const config = readConfig();
            const users = config.users || {};
            const user = users[userId];
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            const planId = user.planId || 'free';
            const expiresAt = user.expiresAt || 0;
            const tokensUsed = user.tokensUsed || 0;
            const imagesUsed = user.imagesUsed || 0;
            const isActive = planId !== 'free' && expiresAt > Date.now();
            const plan = isActive ? SUBSCRIPTION_PLANS[planId] : null;
            res.json({
                ok: true,
                userId,
                planId,
                isActive,
                expiresAt,
                tokensUsed,
                imagesUsed,
                plan,
                canUseModel: (modelId) => {
                    if (!modelId.startsWith('alrc-'))
                        return true;
                    if (!isActive)
                        return false;
                    return plan?.chatModels.includes(modelId) || false;
                },
                canUseImage: () => isActive && (!plan || plan.imageQuota === 0 || imagesUsed < plan.imageQuota),
            });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // POST /v1/subscription/activate
    router.post('/activate', (req, res) => {
        try {
            const userId = verifyToken(req);
            if (!userId) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            const { planId, isYearly } = req.body;
            if (!planId || !SUBSCRIPTION_PLANS[planId]) {
                return res.status(400).json({ ok: false, error: '无效订阅计划' });
            }
            const config = readConfig();
            const users = config.users || {};
            if (!users[userId]) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            const expiresAt = isYearly
                ? Date.now() + 365 * 24 * 60 * 60 * 1000
                : Date.now() + 30 * 24 * 60 * 60 * 1000;
            users[userId] = {
                ...users[userId],
                planId,
                expiresAt,
                tokensUsed: 0,
                imagesUsed: 0,
            };
            config.users = users;
            writeConfig(config);
            res.json({ ok: true, planId, expiresAt });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // POST /v1/subscription/cancel
    router.post('/cancel', (req, res) => {
        try {
            const userId = verifyToken(req);
            if (!userId) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            const config = readConfig();
            const users = config.users || {};
            if (!users[userId]) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            users[userId] = {
                ...users[userId],
                planId: 'free',
                expiresAt: 0,
                tokensUsed: 0,
                imagesUsed: 0,
            };
            config.users = users;
            writeConfig(config);
            res.json({ ok: true });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // GET /v1/subscription/plans — 获取可用订阅计划（无需登录）
    router.get('/plans', (req, res) => {
        res.json({
            ok: true,
            plans: Object.values(SUBSCRIPTION_PLANS).map(p => ({
                id: Object.keys(SUBSCRIPTION_PLANS).find(k => SUBSCRIPTION_PLANS[k] === p),
                name: p.name,
                priceMonth: p.priceMonth,
                priceYear: p.priceYear,
                monthlyTokenLimit: p.monthlyTokenLimit,
                imageQuota: p.imageQuota,
                chatModels: p.chatModels,
            })),
        });
    });
    return router;
}
