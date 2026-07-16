/**
 * auth middleware — 全局 token 认证（可选）
 * ----------------------------------------------------
 * 默认关闭：通过 AGENTAI_AUTH_ENABLED=true 开启
 * 开启后：白名单路由（/health）外，全部需要 token
 * Token 来源：env AGENTAI_AUTH_TOKEN 或文件 .agentai/auth-token
 *
 * 安全守护：
 *  - 默认 disabled，零破坏
 *  - 开启后通过环境变量控制，不写死
 *  - 健康检查等白名单路由放行
 */
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const TOKEN_FILE = process.env.AGENTAI_TOKEN_FILE
  || path.resolve(process.cwd(), '.agentai', 'auth-token');

let cachedToken: string | null | undefined = undefined;

function loadToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  if (process.env.AGENTAI_AUTH_TOKEN) {
    cachedToken = process.env.AGENTAI_AUTH_TOKEN;
    return cachedToken;
  }
  // 测试时禁用文件加载，避免污染
  if (process.env.AGENTAI_AUTH_FILE_DISABLED === '1') {
    cachedToken = null;
    return cachedToken;
  }
  try {
    cachedToken = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

/** 生成新 token（仅在开启认证但无 token 时调用） */
export function generateToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 });
  } catch (e) {
    // 写失败时仍返回 token，调用方可记日志
  }
  cachedToken = token;
  return token;
}

/** 重置缓存（测试用） */
export function resetAuthCache(): void {
  cachedToken = undefined;
}

/** 测试用：禁用文件加载（仅 env） */
export function setFileLoadDisabled(disabled: boolean): void {
  // 通过 env 控制（更简单）
  if (disabled) process.env.AGENTAI_AUTH_FILE_DISABLED = '1';
  else delete process.env.AGENTAI_AUTH_FILE_DISABLED;
}

// 白名单路由（永远放行）
const WHITELIST_PATHS = new Set([
  '/health',
  '/v1/system/check-dep',
]);

function isWhitelisted(req: Request): boolean {
  if (WHITELIST_PATHS.has(req.path)) return true;
  // WebSocket 升级路径放行
  if (req.path.startsWith('/socket.io')) return true;
  return false;
}

/** 认证中间件 — 仅在 AGENTAI_AUTH_ENABLED=true 时生效 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (process.env.AGENTAI_AUTH_ENABLED !== 'true') {
    return next();
  }
  if (isWhitelisted(req)) {
    return next();
  }
  const expected = loadToken();
  if (!expected) {
    return res.status(503).json({
      error: 'Auth enabled but no token configured. Set AGENTAI_AUTH_TOKEN env var or generate via /v1/auth/init',
    });
  }
  const headerToken = req.headers['x-agentai-token'];
  const queryToken = req.query.token;
  const provided = (typeof headerToken === 'string' ? headerToken : null) ||
                   (typeof queryToken === 'string' ? queryToken : null);
  if (provided !== expected) {
    return res.status(401).json({ error: 'Invalid or missing token' });
  }
  next();
}
