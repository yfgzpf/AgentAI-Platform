/**
 * /v1/3d-generate — 3D 模型生成路由
 * 支持: 腾讯混元3D + 豆包 Seed3D
 * 密钥由用户前端传入, 不内置
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';

export function register3DRoutes(router: Router) {
  // POST /v1/3d-generate — 提交 3D 生成任务
  router.post('/v1/3d-generate', async (req: Request, res: Response) => {
    const { provider, prompt, imageUrl, imageBase64, apiKey, secretId, secretKey, model, format, enablePBR, modelSeed } = req.body;

    try {
      if (provider === 'doubao') {
        // ===== 豆包 Seed3D =====
        // API: POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks
        // Auth: Bearer ARK_API_KEY
        if (!apiKey) return res.json({ error: '请提供豆包 API Key (ARK_API_KEY)' });
        if (!imageUrl && !imageBase64) return res.json({ error: '豆包 Seed3D 需要输入图片' });

        const content: any[] = [];
        // 图片信息 (必需)
        content.push({
          type: 'image_url',
          image_url: { url: imageBase64 || imageUrl },
        });
        // 文本参数 (可选)
        const textParams: string[] = [];
        if (format) textParams.push(`--fileformat ${format}`);
        if (textParams.length > 0) {
          content.push({ type: 'text', text: textParams.join(' ') });
        }

        const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model || 'doubao-seed3d-2-0-260328',
            content,
          }),
        });
        const data: any = await resp.json();
        if (!resp.ok) return res.json({ error: data.error?.message || JSON.stringify(data) });
        return res.json({ taskId: data.id, provider: 'doubao' });

      } else if (provider === 'hunyuan') {
        // ===== 腾讯混元3D =====
        // API: ai3d.tencentcloudapi.com (TC3 HMAC 签名)
        if (!secretId || !secretKey) return res.json({ error: '请提供腾讯云 SecretId 和 SecretKey' });

        const action = 'SubmitHunyuanTo3DJob';
        const version = '2025-05-13';
        const region = 'ap-guangzhou';
        const service = 'ai3d';
        const host = 'ai3d.tencentcloudapi.com';

        // 构建请求体
        const payload: any = {
          Model: model || '3.0',
          GenerateType: 'Normal',
        };
        if (prompt) payload.Prompt = prompt;
        if (imageUrl) payload.ImageUrl = imageUrl;
        if (imageBase64) payload.ImageBase64 = imageBase64;
        if (enablePBR) payload.EnablePBR = true;
        if (format) payload.ResultFormat = format.toUpperCase();

        const payloadStr = JSON.stringify(payload);

        // TC3 签名
        const timestamp = Math.floor(Date.now() / 1000);
        const date = new Date(timestamp * 1000).toISOString().split('T')[0]!;
        const credentialScope = `${date}/${service}/tc3_request`;

        // CanonicalRequest
        const hashedPayload = crypto.createHash('sha256').update(payloadStr).digest('hex');
        const canonicalRequest = [
          'POST', '/', '',
          `content-type:application/json; charset=utf-8`,
          `host:${host}`,
          `x-tc-action:${action.toLowerCase()}`,
          '',
          'content-type;host;x-tc-action',
          hashedPayload,
        ].join('\n');

        // StringToSign
        const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
        const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonical}`;

        // Signature
        const kDate = crypto.createHmac('sha256', Buffer.from(`TC3${String(secretKey)}`)).update(date).digest();
        const kService = crypto.createHmac('sha256', kDate).update(service).digest();
        const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

        const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

        const resp = await fetch(`https://${host}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Host': host,
            'X-TC-Action': action,
            'X-TC-Version': version,
            'X-TC-Region': region,
            'X-TC-Timestamp': String(timestamp),
            'Authorization': authorization,
          },
          body: payloadStr,
        });
        const data: any = await resp.json();
        if (data.Response?.Error) {
          return res.json({ error: `${data.Response.Error.Code}: ${data.Response.Error.Message}` });
        }
        return res.json({ taskId: data.Response?.JobId, provider: 'hunyuan' });

      } else if (provider === 'tripo') {
        // ===== Tripo3D 图生 Gaussian Splat (.splat, 2026-10-17) =====
        // API: POST https://openapi.tripo3d.com/v3/generation/image-to-splat
        // Auth: Bearer API_KEY (国内站免费注册, 固定 30 积分/次, 约 4 分钟)
        // 用途: 一张场景图 → 高质量 3D 高斯场景; 产物是 2D 场景帧渲染源
        //       (配合前端「发送到生视频」作为首帧图生视频, 场景透视/光照锁定)。
        if (!apiKey) return res.json({ error: '请提供 Tripo API Key' });
        if (!imageBase64 && !imageUrl) return res.json({ error: 'Tripo 图生 Splat 需要输入图片' });

        // 输入: file_token (先上传) 或可公开访问的 URL, 二选一
        // 前端传 base64 时, 先经 Tripo /v3/files 上传拿 file_token
        let input: string;
        if (imageUrl) {
          input = imageUrl;
        } else {
          const b64 = String(imageBase64 || '').replace(/^data:[^,]+,/, '');
          const bin = Buffer.from(b64, 'base64');
          const form = new FormData();
          form.append('file', new Blob([bin], { type: 'image/png' }), 'scene.png');
          const up = await fetch('https://openapi.tripo3d.com/v3/files', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: form as any,
          });
          const upData: any = await up.json();
          if (!up.ok || !upData?.data?.file_token) {
            return res.json({ error: `Tripo 文件上传失败: ${up.status} ${upData?.message || JSON.stringify(upData).slice(0, 200)}` });
          }
          input = upData.data.file_token;
        }

        const resp = await fetch('https://openapi.tripo3d.com/v3/generation/image-to-splat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify({ input, ...(modelSeed ? { model_seed: Number(modelSeed) } : {}) }),
        });
        const data: any = await resp.json();
        if (!resp.ok || data.code) {
          return res.json({ error: `Tripo 提交失败: ${data.message || JSON.stringify(data).slice(0, 200)}` });
        }
        const taskId = data?.data?.task_id || data?.data?.id;
        if (!taskId) return res.json({ error: `Tripo 未返回 task_id: ${JSON.stringify(data).slice(0, 200)}` });
        return res.json({ taskId, provider: 'tripo' });

      } else {
        return res.json({ error: '未知 provider, 支持: doubao, hunyuan' });
      }
    } catch (e: any) {
      return res.json({ error: e.message });
    }
  });

  // GET /v1/3d-generate/:taskId — 查询任务状态
  // ⚠️ 已废弃 (2026-10-12): 密钥走 URL query 会进浏览器历史/网关日志/Referer,
  //   请改用 POST /v1/3d-generate/:taskId/query (密钥走 body)。此处仅保留兼容。
  router.get('/v1/3d-generate/:taskId', async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const provider = req.query.provider as string;
    const apiKey = req.query.apiKey as string;
    const secretId = req.query.secretId as string;
    const secretKey = req.query.secretKey as string;

    try {
      if (provider === 'doubao') {
        if (!apiKey) return res.json({ error: '缺少 apiKey' });
        const resp = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const data: any = await resp.json();
        return res.json({
          status: data.status, // queued/running/succeeded/failed
          fileUrl: data.content?.file_url,
          error: data.error?.message,
          raw: data,
        });

      } else if (provider === 'hunyuan') {
        if (!secretId || !secretKey) return res.json({ error: '缺少 secretId/secretKey' });

        const action = 'QueryHunyuanTo3DJob';
        const version = '2025-05-13';
        const region = 'ap-guangzhou';
        const service = 'ai3d';
        const host = 'ai3d.tencentcloudapi.com';

        const payload = JSON.stringify({ JobId: taskId });
        const timestamp = Math.floor(Date.now() / 1000);
        const date = new Date(timestamp * 1000).toISOString().split('T')[0]!;
        const credentialScope = `${date}/${service}/tc3_request`;

        const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
        const canonicalRequest = [
          'POST', '/', '',
          `content-type:application/json; charset=utf-8`,
          `host:${host}`,
          `x-tc-action:${action.toLowerCase()}`,
          '',
          'content-type;host;x-tc-action',
          hashedPayload,
        ].join('\n');

        const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
        const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonical}`;

        const kDate = crypto.createHmac('sha256', Buffer.from(`TC3${String(secretKey)}`)).update(date).digest();
        const kService = crypto.createHmac('sha256', kDate).update(service).digest();
        const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

        const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

        const resp = await fetch(`https://${host}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Host': host,
            'X-TC-Action': action,
            'X-TC-Version': version,
            'X-TC-Region': region,
            'X-TC-Timestamp': String(timestamp),
            'Authorization': authorization,
          },
          body: payload,
        });
        const data: any = await resp.json();
        const job = data.Response;
        if (job?.Error) return res.json({ error: `${job.Error.Code}: ${job.Error.Message}` });

        // 混元3D 状态: SUBMITTED/RUNNING/SUCCEED/FAILED
        const statusMap: Record<string, string> = { SUBMITTED: 'queued', RUNNING: 'running', SUCCEED: 'succeeded', FAILED: 'failed' };
        return res.json({
          status: statusMap[job?.Status] || job?.Status,
          fileUrl: job?.ResultFile?.Url || job?.ResultFiles?.[0]?.Url,
          thumbnailUrl: job?.ThumbnailUrl,
          error: job?.ErrorMsg,
          raw: job,
        });

      } else if (provider === 'tripo') {
        if (!apiKey) return res.json({ error: '缺少 apiKey' });
        const resp = await fetch(`https://openapi.tripo3d.com/v3/tasks/${taskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const data: any = await resp.json();
        const t = data?.data || {};
        // Tripo 状态: pending/processing/success/failed (轮询同 Seedance 同构)
        const statusMap2: Record<string, string> = { pending: 'queued', processing: 'running', success: 'succeeded', failed: 'failed', error: 'failed' };
        const out = t.output || t.result || {};
        const fileUrl = out.splat_url || out.model_url || out.url || '';
        return res.json({
          status: statusMap2[String(t.status).toLowerCase()] || t.status || 'unknown',
          fileUrl,
          error: t.error || data?.message,
          raw: t,
        });
      }

      return res.json({ error: '未知 provider' });
    } catch (e: any) {
      return res.json({ error: e.message });
    }
  });

  // POST /v1/3d-generate/:taskId/query — 查询任务状态 (密钥走 body)
  // 2026-10-12 安全修复: 原 GET 路由把 apiKey/secretKey 拼在 URL query 上,
  // 会进浏览器历史 / 网关 access log / Referer。新增 POST 变体, 与提交路由
  // 的密钥读取方式一致 (req.body)。旧 GET 保留兼容, 标记废弃。
  router.post('/v1/3d-generate/:taskId/query', async (req: Request, res: Response) => {
    const { taskId } = req.params;
    const { provider, apiKey, secretId, secretKey } = req.body || {};

    try {
      if (provider === 'doubao') {
        if (!apiKey) return res.json({ error: '缺少 apiKey' });
        const resp = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const data: any = await resp.json();
        return res.json({
          status: data.status, // queued/running/succeeded/failed
          fileUrl: data.content?.file_url,
          error: data.error?.message,
          raw: data,
        });

      } else if (provider === 'hunyuan') {
        if (!secretId || !secretKey) return res.json({ error: '缺少 secretId/secretKey' });

        const action = 'QueryHunyuanTo3DJob';
        const version = '2025-05-13';
        const region = 'ap-guangzhou';
        const service = 'ai3d';
        const host = 'ai3d.tencentcloudapi.com';

        const payload = JSON.stringify({ JobId: taskId });
        const timestamp = Math.floor(Date.now() / 1000);
        const date = new Date(timestamp * 1000).toISOString().split('T')[0]!;
        const credentialScope = `${date}/${service}/tc3_request`;

        const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
        const canonicalRequest = [
          'POST', '/', '',
          `content-type:application/json; charset=utf-8`,
          `host:${host}`,
          `x-tc-action:${action.toLowerCase()}`,
          '',
          'content-type;host;x-tc-action',
          hashedPayload,
        ].join('\n');

        const hashedCanonical = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
        const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonical}`;

        const kDate = crypto.createHmac('sha256', Buffer.from(`TC3${String(secretKey)}`)).update(date).digest();
        const kService = crypto.createHmac('sha256', kDate).update(service).digest();
        const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
        const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

        const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`;

        const resp = await fetch(`https://${host}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Host': host,
            'X-TC-Action': action,
            'X-TC-Version': version,
            'X-TC-Region': region,
            'Authorization': authorization,
          },
          body: payload,
        });
        const data: any = await resp.json();
        const job = data.Response;
        if (job?.Error) return res.json({ error: `${job.Error.Code}: ${job.Error.Message}` });

        const statusMap: Record<string, string> = { SUBMITTED: 'queued', RUNNING: 'running', SUCCEED: 'succeeded', FAILED: 'failed' };
        return res.json({
          status: statusMap[job?.Status] || job?.Status,
          fileUrl: job?.ResultFile?.Url || job?.ResultFiles?.[0]?.Url,
          thumbnailUrl: job?.ThumbnailUrl,
          error: job?.ErrorMsg,
          raw: job,
        });

      } else if (provider === 'tripo') {
        if (!apiKey) return res.json({ error: '缺少 apiKey' });
        const resp = await fetch(`https://openapi.tripo3d.com/v3/tasks/${taskId}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        const data: any = await resp.json();
        const t = data?.data || {};
        const statusMap2: Record<string, string> = { pending: 'queued', processing: 'running', success: 'succeeded', failed: 'failed', error: 'failed' };
        const out = t.output || t.result || {};
        const fileUrl = out.splat_url || out.model_url || out.url || '';
        return res.json({
          status: statusMap2[String(t.status).toLowerCase()] || t.status || 'unknown',
          fileUrl,
          error: t.error || data?.message,
          raw: t,
        });
      }

      return res.json({ error: '未知 provider' });
    } catch (e: any) {
      return res.json({ error: e.message });
    }
  });

  // GET /v1/3d-file?url=<encoded> — 3D 模型文件代理 (2026-10-12)
  // 背景: 两 provider 返回的 fileUrl 都是厂商预签名外链 (火山 TOS / 腾讯 COS),
  // 默认不带 CORS 头 → GUI iframe 里 fetch 会失败, 页面内画布无法加载 GLB。
  // 由 gateway 同源转发, 顺带解决 Tauri 桌面壳的跨域限制。
  //
  // ⚠️ 安全: 必须是**域名白名单**代理, 否则这是个开放代理 (可被用来打任意站点)。
  //    只放行 3D 厂商及其 CDN 域名。
  router.get('/v1/3d-file', async (req: Request, res: Response) => {
    const raw = req.query.url as string;
    if (!raw) { res.status(400).json({ error: '缺少 url 参数' }); return; }

    let target: URL;
    try { target = new URL(raw); } catch {
      res.status(400).json({ error: 'url 格式不正确' }); return;
    }
    if (target.protocol !== 'https:') {
      res.status(400).json({ error: '只允许 https' }); return;
    }

    // 白名单: 主机名必须以这些后缀结尾 (含子域名)
    const ALLOWED_HOST_SUFFIXES = [
      'volces.com',        // 豆包 Seed3D / 火山方舟 TOS
      'volccdn.com',
      'myqcloud.com',      // 腾讯云 COS
      'qcloudimg.com',
      'tencentcloudapi.com',
      'cloudfront.net',
      'amazonaws.com',
      'tripo3d.com',      // Tripo 国内站 (image-to-splat .splat / 模型产物 CDN)
    ];
    const host = target.hostname.toLowerCase();
    if (!ALLOWED_HOST_SUFFIXES.some(sfx => host === sfx || host.endsWith('.' + sfx))) {
      res.status(403).json({ error: `主机不在 3D 文件代理白名单内: ${host}` });
      return;
    }

    try {
      const upstream = await fetch(target.toString());
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `上游返回 ${upstream.status}` });
        return;
      }
      const ct = upstream.headers.get('content-type') || 'application/octet-stream';
      const cl = upstream.headers.get('content-length');
      res.setHeader('Content-Type', ct);
      if (cl) res.setHeader('Content-Length', cl);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      // 预签名 URL 通常带时效, 加个标记便于排查
      res.setHeader('X-AgentAI-3D-Proxy', 'true');
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (e: any) {
      res.status(502).json({ error: e.message || '代理拉取失败' });
    }
  });
}
