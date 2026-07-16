/**
 * /v1/image — 图片生成路由 (供 ImageGen 前端面板调用)
 * 使用 Cogview-3-Flash (ZHIPU_API_KEY) 优先, 降级到 agnes-image (AGENTAI_API_KEY)
 *
 * 修复: 生成后下载到本地, 返回 gateway 可访问的 URL, 避免 CORS/URL过期
 */
import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** 下载图片 URL 到本地临时文件, 返回文件路径 */
async function downloadToTempFile(url: string): Promise<string | null> {
  try {
    const imgResp = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!imgResp.ok) return null;
    const buf = Buffer.from(await imgResp.arrayBuffer());
    const tempDir = path.join(os.homedir(), '.agentai', 'temp-images');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
    const filePath = path.join(tempDir, fileName);
    fs.writeFileSync(filePath, buf);
    return filePath;
  } catch { return null; }
}

export function createImageRouter() {
  const router = Router();

  router.post('/v1/image', async (req, res) => {
    try {
      const { prompt, size = '1024x1024', model: reqModel, image, negative_prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      const preferCogview = reqModel !== 'agnes';

      // ---- 引擎 0: NVIDIA NIM (qwen-image, 免费, 支持文生图) ----
      if (preferCogview && !image) {
        const nvidiaKey = process.env['NVIDIA_API_KEY'];
        if (nvidiaKey) {
          try {
            const body: any = {
              model: 'qwen/qwen-image',
              prompt,
              n: 1,
              response_format: 'b64_json',
            };
            const resp = await fetch('https://integrate.api.nvidia.com/v1/images/generations', {
              method: 'POST',
              headers: { Authorization: `Bearer ${nvidiaKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60000),
            });
            if (resp.ok) {
              const data: any = await resp.json();
              // NVIDIA 返回 b64_json, 保存到本地文件
              const b64 = data.data?.[0]?.b64_json;
              if (b64) {
                const buf = Buffer.from(b64, 'base64');
                const tempDir = path.join(os.homedir(), '.agentai', 'temp-images');
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                const fileName = `nvidia-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
                const filePath = path.join(tempDir, fileName);
                fs.writeFileSync(filePath, buf);
                return res.json({ url: `/api/files/download?path=${encodeURIComponent(filePath)}`, localPath: filePath, prompt, size, provider: 'NVIDIA qwen-image' });
              }
              // 有些模型返回 url 而非 b64
              const imageUrl = data.data?.[0]?.url;
              if (imageUrl) {
                const localPath = await downloadToTempFile(imageUrl);
                if (localPath) {
                  return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size, provider: 'NVIDIA qwen-image' });
                }
                return res.json({ url: imageUrl, prompt, size, provider: 'NVIDIA qwen-image' });
              }
            }
          } catch (e: any) {
            console.warn('[nvidia-image] error:', e.message);
          }
        }
      }

      // ---- 引擎 1: Cogview-3-Flash (仅文生图, 不支持图生图) ----
      if (preferCogview && !image) {
        const zhipuKey = process.env['ZHIPU_API_KEY'];
        if (zhipuKey) {
          try {
            const cogSize = ['1024x1024','768x1344','864x1152','1344x768','1152x864','1440x720','720x1440'].includes(size) ? size : '1024x1024';
            const body: any = { model: 'cogview-3-flash', prompt, size: cogSize };
            const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
              method: 'POST',
              headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(60000),
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const imageUrl = data.data?.[0]?.url || data.data?.[0]?.image_url || data.url;
              if (imageUrl) {
                // 下载到本地, 返回 gateway 可访问的 URL
                const localPath = await downloadToTempFile(imageUrl);
                if (localPath) {
                  return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size, provider: 'cogview-3-flash' });
                }
                return res.json({ url: imageUrl, prompt, size, provider: 'cogview-3-flash' });
              }
            }
          } catch (e: any) {
            console.warn('[cogview] error:', e.message);
          }
        }
      }

      // ---- 引擎 2: Agnes Image ----
      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) {
        return res.status(400).json({ error: 'No API Key. Set ZHIPU_API_KEY (免费) or AGENTAI_API_KEY in .env' });
      }
      const agnesSize = ['1024x1024','720x1280','1280x720','1024x768','768x1024'].includes(size) ? size : '1024x1024';

      if (image) {
        // 图生图/多图: 使用 agnes-image-2.0-flash + extra_body
        const images = Array.isArray(image) ? image : [image];
        const body: any = {
          model: 'agnes-image-2.0-flash',
          prompt,
          size: agnesSize,
          extra_body: {
            tags: ['img2img'],
            image: images,
            response_format: 'url',
          },
        };
        if (negative_prompt) body.negative_prompt = negative_prompt;
        const resp = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return res.status(resp.status).json({ error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
        }
        const data: any = await resp.json();
        const imageUrl = data.data?.[0]?.url || data.url || data.image_url;
        if (imageUrl) {
          const localPath = await downloadToTempFile(imageUrl);
          if (localPath) {
            return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size, provider: 'agnes-image-2.0 (图生图)' });
          }
          return res.json({ url: imageUrl, prompt, size, provider: 'agnes-image-2.0 (图生图)' });
        }
        return res.json({ url: '', provider: 'none', ...(data || {}) });
      } else {
        // 纯文生图: 使用 agnes-image-2.1-flash
        const body: any = { model: 'agnes-image-2.1-flash', prompt, size: agnesSize };
        if (negative_prompt) body.negative_prompt = negative_prompt;
        const resp = await fetch('https://apihub.agnes-ai.com/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          return res.status(resp.status).json({ error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
        }
        const data: any = await resp.json();
        const imageUrl = data.data?.[0]?.url || data.url || data.image_url;
        if (imageUrl) {
          const localPath = await downloadToTempFile(imageUrl);
          if (localPath) {
            return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size, provider: 'agnes-image-2.1' });
          }
          return res.json({ url: imageUrl, prompt, size, provider: 'agnes-image-2.1' });
        }
        return res.json({ url: '', provider: 'none', ...(data || {}) });
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
