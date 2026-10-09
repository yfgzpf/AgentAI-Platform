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
  // 支持档位式直接传入: 1K / 2K / 3K / 4K
  if (/^[1234]K$/i.test(size)) return { tier: size.toUpperCase(), ratio: '1:1' };
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
    // 4K 档位
    '4096x4096': { tier: '4K', ratio: '1:1' },
    '3072x4096': { tier: '4K', ratio: '3:4' },
    '4096x3072': { tier: '4K', ratio: '4:3' },
    '4096x2160': { tier: '4K', ratio: '16:9' },
    '2160x4096': { tier: '4K', ratio: '9:16' },
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
      // 图生图/风格迁移/编辑模式: ALRC 模型 (gpt-image-2, nano-banana 等) 原生支持, 不强制覆盖
      // 只有非 ALRC 模型才回退到 agnes
      const isAlrcRequested = effectiveModel?.startsWith('alrc-') || effectiveModel?.startsWith('factory-');
      if (image && mode === 'img2img') {
        extraTags.push('img2img');
        if (!isAlrcRequested) effectiveModel = 'agnes'; // 非 ALRC 回退到 agnes
      }
      // 风格迁移
      if (mode === 'style_transfer') {
        extraTags.push('style_transfer');
        if (!isAlrcRequested) effectiveModel = 'agnes';
      }
      // 编辑模式 — ALRC 模型 (gpt-image-2/nano-banana) 指令邏辑性最强, 不覆盖
      if (mode === 'edit') {
        extraTags.push('edit');
        if (!isAlrcRequested) effectiveModel = 'agnes';
      }

      // ---- 引擎 1.5: ALRC 图像模型 (gpt-image-2 / nano-banana) ----
      // 注意：如果用户明确选择了付费模型，但调用失败，应该报错而不是静默降级
      const isAlrcModel = effectiveModel?.startsWith('alrc-') || effectiveModel?.startsWith('factory-');
      const alrcKey = process.env['ALRC_API_KEY'] || process.env['FACTORY_IMAGE_KEY'];
      
      if (isAlrcModel) {
        if (!alrcKey) {
          return res.status(400).json({ 
            error: `模型 ${effectiveModel} 需要 ALRC_API_KEY，请联系管理员配置`, 
            code: 'MISSING_API_KEY',
            requestedModel: effectiveModel 
          });
        }
        
        try {
          // ALRC 模型支持图生图/编辑 — 传入 image 参数
          const alrcBody: any = {
            model: effectiveModel.replace(/^(alrc-|factory-)/, ''),
            prompt: finalPrompt,
            size,
          };
          // 图生图/编辑模式: 传入参考图
          if (image && (mode === 'img2img' || mode === 'edit' || mode === 'style_transfer')) {
            const images = Array.isArray(image) ? image : [image];
            // ALRC API 接受 image 数组 (公共 URL 或 base64)
            alrcBody.image = images.map((img: string) => {
              if (img.startsWith('data:')) return img; // Data URI
              if (img.startsWith('http')) return img;  // 公共 URL
              return `data:image/png;base64,${img}`;   // 纯 base64
            });
            if (strength !== undefined) alrcBody.strength = strength;
          }
          const resp = await fetch('https://alro.huazhiweilai.com/v1/images/generations', {
            method: 'POST',
            headers: { Authorization: `Bearer ${alrcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(alrcBody),
            signal: AbortSignal.timeout(60000),
          });
          
          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            console.error('[alrc-image] failed:', resp.status, errText);
            return res.status(resp.status).json({ 
              error: `${effectiveModel} 生成失败: ${errText.slice(0, 200)}`, 
              code: 'MODEL_FAILED',
              requestedModel: effectiveModel,
              status: resp.status
            });
          }
          
          const data: any = await resp.json();
          const imageUrl = data.data?.[0]?.url || data.url;
          if (imageUrl) {
            const localPath = await downloadToTempFile(imageUrl);
            if (localPath) {
              return res.json({ 
                url: `/api/files/download?path=${encodeURIComponent(localPath)}`, 
                localPath, 
                originalUrl: imageUrl, 
                prompt, 
                size, 
                provider: effectiveModel,
                requestedModel: effectiveModel,
                actualModel: effectiveModel
              });
            }
            return res.json({ 
              url: imageUrl, 
              prompt, 
              size, 
              provider: effectiveModel,
              requestedModel: effectiveModel,
              actualModel: effectiveModel
            });
          }
          
          return res.status(500).json({ 
            error: `${effectiveModel} 返回数据异常`, 
            code: 'INVALID_RESPONSE',
            requestedModel: effectiveModel 
          });
          
        } catch (e: any) {
          console.error('[alrc-image] error:', e.message);
          return res.status(500).json({ 
            error: `${effectiveModel} 调用异常: ${e.message}`, 
            code: 'REQUEST_FAILED',
            requestedModel: effectiveModel 
          });
        }
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
        // 图生图/风格迁移/改图: 使用 agnes-image-2.5-flash + extra_body
        const images = Array.isArray(image) ? image : [image];
        // Agnes Image API 支持: 公共 URL 或 Data URI Base64
        // localhost/内网 URL → 下载转 Data URI (Agnes 无法访问 localhost)
        const cleanImages: string[] = [];
        for (const img of images) {
          if (img.startsWith('data:')) {
            cleanImages.push(img); // 已经是 Data URI, 保留
          } else if (img.startsWith('http://') || img.startsWith('https://')) {
            // 检测 localhost/内网 IP — 用 URL.hostname 精确检测, 不误伤公网 /api/ 路径
            let isLocal = false;
            try {
              const urlObj = new URL(img);
              const hostname = urlObj.hostname;
              isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
            } catch { isLocal = false; }
            if (isLocal) {
              // localhost URL → 下载转 Data URI
              try {
                const resp = await fetch(img, { signal: AbortSignal.timeout(10000) });
                if (resp.ok) {
                  const buf = Buffer.from(await resp.arrayBuffer());
                  const contentType = resp.headers.get('content-type') || 'image/png';
                  cleanImages.push(`data:${contentType};base64,${buf.toString('base64')}`);
                } else {
                  console.warn(`[agnes-image] 下载本地图片失败: HTTP ${resp.status}`);
                }
              } catch (e: any) {
                console.warn(`[agnes-image] 下载本地图片失败: ${e.message}`);
              }
            } else {
              cleanImages.push(img); // 公共 URL, Agnes 可以访问
            }
          } else {
            cleanImages.push(`data:image/png;base64,${img}`); // 纯 base64 → 补成 Data URI
          }
        }
        const body: any = {
          model: 'agnes-image-2.5-flash',
          prompt: finalPrompt,
          size: tier,
          ratio: finalRatio,
          extra_body: {
            tags: extraTags.length > 0 ? extraTags : ['img2img'],
            image: cleanImages,
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
          // 错误分类: 429 限流 / 402 余额不足 → 明确提示; 其他 → 降级到文生图
          if (resp.status === 429) return res.status(429).json({ error: 'API 限流, 请稍后重试', code: 'RATE_LIMITED' });
          if (resp.status === 402) return res.status(402).json({ error: '余额不足, 请充值', code: 'INSUFFICIENT_BALANCE' });
          console.warn('[agnes-image] img2img failed, falling back to text2img:', resp.status);
          // 降级: 去掉参考图, 用文生图继续
        } else {
        const data: any = await resp.json();
        const imageUrl = data.data?.[0]?.url || data.url || data.image_url;
        if (imageUrl) {
          const localPath = await downloadToTempFile(imageUrl);
          if (localPath) {
            return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, originalUrl: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.5 (图生图)' });
          }
          return res.json({ url: imageUrl, prompt, size: tier, ratio: finalRatio, provider: 'agnes-image-2.5 (图生图)' });
        }
        return res.json({ url: '', provider: 'none', ...(data || {}) });
        } // end else (img2img resp.ok)
      } else {
        // 纯文生图: 使用 agnes-image-2.5-flash
        const body: any = {
          model: 'agnes-image-2.5-flash',
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
          // 错误分类: 429 限流 / 402 余额不足 → 明确提示; 其他 → 降级到智谱 CogView
          if (resp.status === 429) return res.status(429).json({ error: 'API 限流, 请稍后重试', code: 'RATE_LIMITED' });
          if (resp.status === 402) return res.status(402).json({ error: '余额不足, 请充值', code: 'INSUFFICIENT_BALANCE' });
          console.warn('[agnes-image] text2img failed, falling back to zhipu cogview:', resp.status);
          // 降级到智谱
          const zhipuKey2 = process.env['ZHIPU_API_KEY'];
          if (zhipuKey2) {
            try {
              const cogSize = ['1024x1024','768x1344','864x1152','1344x768','1152x864','1440x720','720x1440'].includes(size) ? size : '1024x1024';
              const zr = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
                method: 'POST', headers: { Authorization: `Bearer ${zhipuKey2}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'cogview-3-flash', prompt: finalPrompt, size: cogSize }),
                signal: AbortSignal.timeout(60000),
              });
              if (zr.ok) {
                const zd: any = await zr.json();
                const zu = zd.data?.[0]?.url;
                if (zu) {
                  const lp = await downloadToTempFile(zu);
                  if (lp) return res.json({ url: `/api/files/download?path=${encodeURIComponent(lp)}`, localPath: lp, originalUrl: zu, prompt, size, provider: 'cogview-3-flash (降级)' });
                  return res.json({ url: zu, prompt, size, provider: 'cogview-3-flash (降级)' });
                }
              }
            } catch (e: any) { console.warn('[cogview] fallback error:', e.message); }
          }
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

  // ════════════════════════════════════════════════════════════════════════
  // POST /v1/image/remove-bg — 抠图 (去背景)
  // 输入: { image: string (URL 或 Data URI) }
  // 输出: { url: string (透明背景 PNG 的 Data URI 或本地文件 URL) }
  // 方案: 使用 Agnes Image API edit 模式, prompt="remove background, make transparent"
  // ════════════════════════════════════════════════════════════════════════
  router.post('/v1/image/remove-bg', async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: 'image required' });

      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) return res.status(500).json({ error: '需要 AGENTAI_API_KEY' });

      // 准备图片: localhost URL → 下载转 Data URI
      let imageDataUri = image;
      if (image.startsWith('http://') || image.startsWith('https://')) {
        let isLocal = false;
        try {
          const urlObj = new URL(image);
          const hostname = urlObj.hostname;
          isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
        } catch { isLocal = false; }
        if (isLocal) {
          const resp = await fetch(image, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            const ct = resp.headers.get('content-type') || 'image/png';
            imageDataUri = `data:${ct};base64,${buf.toString('base64')}`;
          }
        }
      } else if (!image.startsWith('data:')) {
        // 纯 base64 → 补成 Data URI
        imageDataUri = `data:image/png;base64,${image}`;
      }

      // 调用 Agnes Image API — edit 模式, 去背景
      const body: any = {
        model: 'agnes-image-2.5-flash',
        prompt: 'Remove the background completely, make it fully transparent. Keep only the person/character with clean edges. Preserve all hair details, clothing edges, and shadows on the subject. Output as PNG with transparency.',
        size: '2K',
        ratio: '1:1',
        extra_body: {
          tags: ['edit', 'remove-bg'],
          image: [imageDataUri],
          response_format: 'b64_json',
        },
      };

      const resp = await fetch('https://api.agnes-ai.cn/v1/images/generations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: `Agnes API HTTP ${resp.status}: ${errText.slice(0, 300)}` });
      }

      const data: any = await resp.json();
      // 优先取 b64_json, 其次取 URL
      let b64Data = data.data?.[0]?.b64_json || data.b64_json || null;
      let imageUrl = data.data?.[0]?.url || data.url || null;

      if (b64Data) {
        // 返回 Data URI 给前端
        return res.json({ url: `data:image/png;base64,${b64Data}`, provider: 'agnes-remove-bg' });
      }

      if (imageUrl) {
        // 下载到本地, 返回本地 URL
        const localPath = await downloadToTempFile(imageUrl);
        if (localPath) {
          return res.json({ url: `/api/files/download?path=${encodeURIComponent(localPath)}`, localPath, provider: 'agnes-remove-bg' });
        }
        return res.json({ url: imageUrl, provider: 'agnes-remove-bg' });
      }

      return res.json({ error: '抠图失败: API 未返回图片', raw: JSON.stringify(data).slice(0, 500) });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
