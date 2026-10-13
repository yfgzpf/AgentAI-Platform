/**
 * 生视频 BYOK (自带 Key) 链路测试 —— 2026-10-13
 * ==================================================================
 * 锁住一个真实断裂的修复: 用户在生视频页「自定义模型」填了 API Key,
 * 界面显示保存成功、"测试连接"也是绿的, 但**真实生成时那个 Key 从未参与过**。
 *
 * 断裂点 (修复前):
 *   前端 VideoGen.tsx 收集 apiKey → localStorage
 *     → 唯一使用处是浏览器内handleTestModel (直连上游做连通性测试)
 *     → videoTaskManager 构造的请求 body 里没有任何 key 字段
 *   后端 routes/video.ts 把 `custom:` 并入 agnes 分支, 只读 process.env.AGNES_VIDEO_API_KEY
 *   ⇒ 收集了、验证了、从不生效。
 *
 * 这里测的是**行为契约**:
 *   1. 带 key 时用请求内的 key (而不是服务端 env)
 *   2. 不带 key 时回退服务端 env (向后兼容, 新分支不能让老路径失效)
 *   3. baseUrl 协议校验 (用户输入驱动的出网请求, 不能给本地服务开任意 URL 探测)
 *   4. BYOK 失败不降级到服务端引擎 (否则"Key 无效"会被伪装成"生成了别的东西")
 *   5. Key 不回显在响应、不入URL
 *
 * 用真实 HTTP 打真实路由 (Node 内置 http, 不引supertest —— 项目原本零 HTTP 层测试依赖,
 * 为这几条断言引入一个新依赖不划算; 但也**不能只测纯函数** —— 那测不到
 * "路由有没有把 req.body 里的 key 真的用上" 这个正是坏掉的地方)。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// mock 全局 fetch: 我们要断言"发往上游的请求到底带了什么"
const fetchMock = vi.fn();
// ⚠️ 必须先留住真实 fetch: 本文件自己的测试客户端也用 fetch 打本地 app,
 // 若一并被 mock 掉, 测的就不是真实路由而是自己 (之前的 8 条全红就是这个原因)。
const realFetch = globalThis.fetch;
vi.stubGlobal('fetch', fetchMock);

const { createVideoRouter } = await import('./video.js');

const savedEnv = { ...process.env };
let server: http.Server | null = null;
let baseUrl = '';

beforeEach(async () => {
  fetchMock.mockReset();
  process.env.AGNES_VIDEO_API_KEY = 'SERVER-SIDE-KEY';

  const app = express();
  app.use(express.json());
  app.use(createVideoRouter());
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterEach(async () => {
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  process.env = { ...savedEnv };
});

/** 上游"受理任务" */
function upstreamAccepts() {
  fetchMock.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ video_id: 'upstream-123' }),
    text: async () => '',
  });
}

async function post(path: string, body: any) {
  const resp = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json().catch(() => ({})) };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const resp = await realFetch(`${baseUrl}${path}`, { headers });
  return { status: resp.status, body: await resp.json().catch(() => ({})) };
}

describe('BYOK: 自定义模型 Key 随请求下发', () => {
  it('model=custom:* 且带 apiKey 时, 应使用请求内的 key 而非服务端 env', async () => {
    upstreamAccepts();
    const res = await post('/v1/video', {
      prompt: 'a cat', model: 'custom:my-model', apiKey: 'USER-OWN-KEY', duration: '5s',
    });

    expect(res.status).toBe(200);
    expect(res.body.taskId).toBe('upstream-123');

    // 核心断言: 发往上游的 Authorization 必须是用户自己的 Key
const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer USER-OWN-KEY');
    expect(String(init.headers.Authorization)).not.toContain('SERVER-SIDE-KEY');
  });

  it('不带 key 时回退服务端 AGNES_VIDEO_API_KEY (向后兼容)', async () => {
    upstreamAccepts();
    const res = await post('/v1/video', { prompt: 'a cat', model: 'custom:my-model', duration: '5s' });

    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer SERVER-SIDE-KEY');
  });

  it('自定义 baseUrl 应被实际使用 (而非写死默认端点)', async () => {
    upstreamAccepts();
    await post('/v1/video', {
      prompt: 'x', model: 'custom:m', apiKey: 'K', baseUrl: 'https://my-provider.example.com/v1/',
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://my-provider.example.com/v1/videos');
  });

  it('响应中不应回显 Key', async () => {
    upstreamAccepts();
    const res = await post('/v1/video', {
      prompt: 'x', model: 'custom:m', apiKey: 'SUPER-SECRET-KEY', baseUrl: 'https://p.example.com/v1',
    });
    expect(JSON.stringify(res.body)).not.toContain('SUPER-SECRET-KEY');
  });
});

describe('BYOK: 安全边界', () => {
  it('应拒绝非 http/https 的 baseUrl (防本地文件读取协议探测)', async () => {
    for (const bad of ['file:///etc/passwd', 'gopher://evil.example.com', 'not-a-url']) {
      const res = await post('/v1/video', {
        prompt: 'x', model: 'custom:m', apiKey: 'K', baseUrl: bad,
      });
      expect(res.status, `baseUrl=${bad} 应被拒绝`).toBe(400);
      expect(String(res.body.error)).toContain('baseUrl');
    }
    // 一次出网都不该发生
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('BYOK 上游返回 401 时不应降级到服务端引擎', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'invalid api key' });
    const res = await post('/v1/video', {
      prompt: 'x', model: 'custom:m', apiKey: 'BAD-KEY', baseUrl: 'https://p.example.com/v1',
    });

    expect(res.status).toBe(401);
    // 关键: 只打上游一次。若降级到服务端 Flash 会打第二次
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(res.body)).not.toContain('SERVER-SIDE-KEY');
  });

  it('BYOK 网络异常应如实上报, 不静默降级', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await post('/v1/video', {
      prompt: 'x', model: 'custom:m', apiKey: 'K', baseUrl: 'https://down.example.com/v1',
    });

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('BYOK: 轮询也必须带同一份凭证', () => {
  it('查询应从 X-Video-Api-Key 头取 key, 且 Key 不入 URL', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ status: 'processing' }), text: async () => '',
 });
    const res = await get(
      '/v1/video/vid-1?provider=custom%3Amy-model',
   { 'X-Video-Api-Key': 'USER-OWN-KEY', 'X-Video-Base-Url': 'https://my-provider.example.com/v1' },
    );

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer USER-OWN-KEY');
    expect(url).toContain('https://my-provider.example.com/v1/agnesapi');
    // Key 不该出现在 URL 里 (会进访问日志 / 浏览器历史)
    expect(url).not.toContain('USER-OWN-KEY');
  });

  it('无任何可用凭证时明确报错, 而不是拿错 key 去查', async () => {
    delete process.env.AGNES_VIDEO_API_KEY;
const res = await get('/v1/video/vid-1?provider=custom%3Amy-model');

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});