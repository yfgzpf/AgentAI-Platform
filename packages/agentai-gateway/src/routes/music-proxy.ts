/**
 * 音乐代理路由
 * ----------------------------------------------------
 * 浏览器跨域限制导致在线音乐源无法直接播放。
 * 此路由将远程 MP3 通过 Gateway 中转，浏览器请求同源地址不受 CORS 限制。
 *
 * 用法: GET /v1/music/proxy?url=<encoded-url>
 * 返回: audio/mpeg 流
 */

import { Router } from 'express';

export const musicProxyRouter = Router();

musicProxyRouter.get('/v1/music/proxy', async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) {
    res.status(400).json({ error: 'Missing ?url= parameter' });
    return;
  }

  // 安全校验: 只允许常用音频域名
  const allowedHosts = [
    'soundhelix.com', 'www.soundhelix.com',
    'incompetech.com', 'www.incompetech.com',
    'bensound.com', 'www.bensound.com',
  ];
  try {
    const parsed = new URL(url);
    if (!allowedHosts.includes(parsed.hostname)) {
      res.status(403).json({ error: `Domain not allowed: ${parsed.hostname}` });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  // 设置超时 (15 秒)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AgentAI-MusicProxy/1.0',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      res.status(response.status).json({ error: `Remote server returned ${response.status}` });
      return;
    }

    // 透传 Content-Type
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');

    // 流式传输音频数据
    const reader = response.body?.getReader();
    if (!reader) {
      res.status(502).json({ error: 'No response body' });
      return;
    }

    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      } catch (e: any) {
        if (!res.headersSent) {
          res.status(502).json({ error: `Stream error: ${e.message}` });
        } else {
          res.end();
        }
      }
    };
    pump();
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      res.status(504).json({ error: 'Music source timeout' });
    } else {
      console.error(`[music-proxy] fetch error: ${err.message}`);
      res.status(502).json({ error: `Failed to fetch music: ${err.message}` });
    }
  }
});
