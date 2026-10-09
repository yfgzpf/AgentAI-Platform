/**
 * 用户认证路由
 * ----------------------------------------------------
 * POST /v1/auth/register  — 注册新用户
 * POST /v1/auth/login     — 登录获取 token
 * GET  /v1/auth/me        — 获取当前用户信息
 * POST /v1/auth/logout    — 清除本地 token
 *
 * 数据存储：config.json 持久化
 * 密码存储：SHA-256 哈希（生产环境请改用 bcrypt）
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
/** 从 config.json 读取用户数据 */
function readUserData() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            return (config.users || {});
        }
    }
    catch { }
    return {};
}
/** 写入用户数据到 config.json */
function writeUserData(data) {
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
        }
        config.users = data;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    }
    catch (e) {
        console.error('[auth] failed to write users:', e);
    }
}
/** 简单密码哈希 */
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}
/** 生成简单 JWT（生产环境请改用 jose/njwt） */
function generateToken(userId) {
    const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64');
    const signature = crypto.createHmac('sha256', process.env.JWT_SECRET || 'agentai-default-secret')
        .update(payload)
        .digest('hex');
    return `${payload}.${signature}`;
}
/** 验证 token 并返回 userId */
function verifyToken(token) {
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
export function createAuthRouter() {
    const router = Router();
    // POST /v1/auth/register
    router.post('/register', (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
            }
            if (username.length < 2 || username.length > 30) {
                return res.status(400).json({ ok: false, error: '用户名长度 2-30 个字符' });
            }
            if (password.length < 6) {
                return res.status(400).json({ ok: false, error: '密码长度至少 6 位' });
            }
            const users = readUserData();
            if (users[username]) {
                return res.status(409).json({ ok: false, error: '用户名已存在' });
            }
            users[username] = {
                password: hashPassword(password),
                planId: 'free',
                expiresAt: 0,
                tokensUsed: 0,
                imagesUsed: 0,
                createdAt: Date.now(),
            };
            writeUserData(users);
            const token = generateToken(username);
            res.json({ ok: true, token, userId: username });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // POST /v1/auth/login
    router.post('/login', (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ ok: false, error: '用户名和密码不能为空' });
            }
            const users = readUserData();
            const user = users[username];
            if (!user || user.password !== hashPassword(password)) {
                return res.status(401).json({ ok: false, error: '用户名或密码错误' });
            }
            // 检查订阅是否过期
            if (user.planId !== 'free' && user.expiresAt > 0 && Date.now() > user.expiresAt) {
                user.planId = 'free';
                user.expiresAt = 0;
                user.tokensUsed = 0;
                user.imagesUsed = 0;
                writeUserData(users);
            }
            const token = generateToken(username);
            res.json({
                ok: true,
                token,
                userId: username,
                planId: user.planId,
                expiresAt: user.expiresAt,
                tokensUsed: user.tokensUsed,
                imagesUsed: user.imagesUsed,
            });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // GET /v1/auth/me
    router.get('/me', (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({ ok: false, error: '未登录' });
            }
            const token = authHeader.slice(7);
            const userId = verifyToken(token);
            if (!userId) {
                return res.status(401).json({ ok: false, error: '无效 token' });
            }
            const users = readUserData();
            const user = users[userId];
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            // 检查订阅过期
            if (user.planId !== 'free' && user.expiresAt > 0 && Date.now() > user.expiresAt) {
                user.planId = 'free';
                user.expiresAt = 0;
                user.tokensUsed = 0;
                user.imagesUsed = 0;
                writeUserData(users);
            }
            res.json({
                ok: true,
                userId,
                planId: user.planId,
                expiresAt: user.expiresAt,
                tokensUsed: user.tokensUsed,
                imagesUsed: user.imagesUsed,
                createdAt: user.createdAt,
            });
        }
        catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });
    // POST /v1/auth/logout
    router.post('/logout', (req, res) => {
        res.json({ ok: true, message: '已登出' });
    });
    return router;
}
