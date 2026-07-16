/**
 * auth middleware 单元测试
 * ----------------------------------------------------
 * 验证: 默认 disabled、白名单放行、env 开启后强制 token
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware, generateToken, resetAuthCache, setFileLoadDisabled } from './auth.js';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: '/v1/test',
    headers: {},
    query: {},
    ...overrides,
  } as Request;
}

function mockRes(): Response {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

import { vi } from 'vitest';

describe('authMiddleware', () => {
  const originalEnv = process.env.AGENTAI_AUTH_ENABLED;
  const originalToken = process.env.AGENTAI_AUTH_TOKEN;

  beforeEach(() => {
    delete process.env.AGENTAI_AUTH_TOKEN;
    delete process.env.AGENTAI_AUTH_ENABLED;
    setFileLoadDisabled(true);
    resetAuthCache();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.AGENTAI_AUTH_ENABLED;
    else process.env.AGENTAI_AUTH_ENABLED = originalEnv;
    if (originalToken === undefined) delete process.env.AGENTAI_AUTH_TOKEN;
    else process.env.AGENTAI_AUTH_TOKEN = originalToken;
    resetAuthCache();
  });

  it('默认 disabled 时全部放行', () => {
    delete process.env.AGENTAI_AUTH_ENABLED;
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ path: '/v1/any' }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('健康检查白名单永远放行', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ path: '/health' }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('check-dep 白名单永远放行', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ path: '/v1/system/check-dep' }), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('开启后无 token 配置返回 503', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    delete process.env.AGENTAI_AUTH_TOKEN;
    resetAuthCache();
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ path: '/v1/files' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('开启后无 token 头的请求返回 401', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(mockReq({ path: '/v1/files' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('开启后错 token 返回 401', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(
      mockReq({ path: '/v1/files', headers: { 'x-agentai-token': 'wrong' } as any }),
      res, next
    );
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('开启后正确 token 头放行', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(
      mockReq({ path: '/v1/files', headers: { 'x-agentai-token': 'secret123' } as any }),
      res, next
    );
    expect(next).toHaveBeenCalled();
  });

  it('开启后 query token 放行', () => {
    process.env.AGENTAI_AUTH_ENABLED = 'true';
    process.env.AGENTAI_AUTH_TOKEN = 'secret123';
    const next = vi.fn();
    const res = mockRes();
    authMiddleware(
      mockReq({ path: '/v1/files', query: { token: 'secret123' } as any }),
      res, next
    );
    expect(next).toHaveBeenCalled();
  });
});

describe('generateToken', () => {
  it('生成 64 字符 hex token', () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});
