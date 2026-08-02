/**
 * /v1/image — 图片生成路由 v2.1 (Agnes Image 2.1 Flash 优化版)
 *
 * 支持 5 种模式 (mode 参数):
 *   text2img      — 文生图 (默认)
 *   img2img       — 图生图/参考图生成
 *   style_transfer — 风格迁移 (原图 + 风格描述)
 *   edit          — AI 对话改图 (原图 + 修改指令)
 *   variations    — 变体生成 (同 prompt 出多张)
 *
 * Agnes Image 2.1 Flash 参数规范:
 *   - size: 1K, 2K, 3K, 4K (档位式)
 *   - ratio: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9
 *   - response_format: 放在 extra_body 中
 *   - API: https://api.agnes-ai.cn/v1/images/generations
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

/** 像素尺寸映射到档位尺寸 */
function mapSizeToTier(size: string): { tier: string; ratio: string } {
  const sizeMap: Record<string, { tier: string; ratio: string }> = {
    // 1K 档位
    '1024x1024': { tier: '1K', ratio: '1:1' },
    '768x1024': { tier: '1K', ratio: '3:4' },
    '1024x768': { tier: '1K', ratio: '4:3' },
    '1312x736': { tier: '1K', ratio: '16:9' },
    '736x1312': { tier: '1K', ratio: '9:16' },
    // 2K 档位
    '2048x2048': { tier: '2K', ratio: '1:1' },
    '1728x2304': { tier: '2K', ratio: '3:4' },
    '2304x1728': { tier: '2K', ratio: '4:3' },
    '2624x1472': { tier: '2K', ratio: '16:9' },
    '1472x2624': { tier: '2K', ratio: '9:16' },
    // 兼容旧版像素尺寸
    '512x512': { tier: '1K', ratio: '1:1' },
    '720x1280': { tier: '1K', ratio: '9:16' },
    '1280x720': { tier: '1K', ratio: '16:9' },
    '1920x1080': { tier: '2K', ratio: '16:9' },
    '1080x1920': { tier: '2K', ratio: '9:16' },
  };
  return sizeMap[size] || { tier: '1K', ratio: '1:1' };
}

export function createImageRouter() {
  const router = Router();

  router.post('/v1/image', async (req, res) => {
    try {
      const { prompt, size = '1024x1024', ratio, model: reqModel, image, negative_prompt,
              mode = 'text2img', strength, n = 1 } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      // === 模式适配: 构建最终 prompt 和 extra_body ===
      let finalPrompt = prompt;
      const extraTags: string[] = [];
      let effectiveModel = reqModel;

      // 图生图模式
      if (image && mode === 'img2img') {
        extraTags.push('img2img');
        effectiveModel = 'agnes'; // 图生图仅 Agnes 支持
      }
      // 风格迁移
      if (mode === 'style_transfer') {
        extraTags.push('style_transfer');
        effectiveModel = 'agnes';
      }
      // 编辑模式
      if (mode === 'edit') {
        extraTags.push('edit');
        effectiveModel = 'agnes';
      }

      // ---- 引擎 1: Cogview-3-Flash (智谱免费) ----
      if (effectiveModel === 'cogview' || effectiveModel === 'zhipu') {
        const zhipuKey = process.env['ZHIPU_API_KEY'];
        if (zhipuKey) {
          try {
            const cogviewSize = ['1024x1024','768x1344','864x1152','1344x768','1152x864','1440x720','720x1440'].includes(size) ? size : '1024x1024';
            const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
              method: 'POST',
              headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'cogview-3-flash',
                prompt: finalPrompt,
                size: cogviewSize,
              }),
              signal: AbortSignal.timeout(60000),
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const imageUrl = data.data?.[0]?.url;
              if (imageUrl) {
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

      // ---- 引擎 2: Agnes Image 2.1 Flash ----
      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) {
        return res.status(400).json({ error: 'No API Key. Set ZHIPU_API_KEY (免费) or AGENTAI_API_KEY in .env' });
      }

      // 映射尺寸到档位
      const { tier, ratio: defaultRatio } = mapSizeToTier(size);
      const finalRatio = ratio || defaultRatio;

      if (image) {
        // 图生图/风格迁移/改图: 使用 agnes-image-2.1-flash + extra_body
        const images = Array.isArray(image) ? image : [image];
        const body: any = {
          model: 'agnes-image-2.1-flash',
          prompt: finalPrompt,
          size: tier,
          ratio: finalRatio,
          extra_body: {
            tags: extraTags.length > 0 ? extraTags : ['img2img'],
            image: images,
            response_format: 'url',
          },
        };
        if (negative_prompt) body.negative_prompt = negative_prompt;
        if (strength !== undefined) body.extra_body.strength = strength; // 0.1-0.9, 参考图影响强度

        const resp = await fetch('https://api.agnes-ai.cn/v1/images/generations', {
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
            return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.1 (图生图)' });
          }
          return res.json({ url: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.1 (图生图)' });
        }
        return res.json({ url: '', provider: 'none', ...(data || {}) });
      } else {
        // 纯文生图: 使用 agnes-image-2.1-flash
        const body: any = {
          model: 'agnes-image-2.1-flash',
          prompt: finalPrompt,
          size: tier,
          ratio: finalRatio,
          extra_body: {
            response_format: 'url',
          },
        };
        if (negative_prompt) body.negative_prompt = negative_prompt;

        const resp = await fetch('https://api.agnes-ai.cn/v1/images/generations', {
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
            return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.1' });
          }
          return res.json({ url: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.1' });
        }
        return res.json({ url: '', provider: 'none', ...(data || {}) });
      }
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
