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
    const { provider, prompt, imageUrl, imageBase64, apiKey, secretId, secretKey, model, format, enablePBR } = req.body;

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
        const data = await resp.json();
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
        const date = new Date(timestamp * 1000).toISOString().split('T')[0];
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
        const kDate = crypto.createHmac('sha256', Buffer.from(`TC3${secretKey}`)).update(date).digest();
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
        const data = await resp.json();
        if (data.Response?.Error) {
          return res.json({ error: `${data.Response.Error.Code}: ${data.Response.Error.Message}` });
        }
        return res.json({ taskId: data.Response?.JobId, provider: 'hunyuan' });

      } else {
        return res.json({ error: '未知 provider, 支持: doubao, hunyuan' });
      }
    } catch (e: any) {
      return res.json({ error: e.message });
    }
  });

  // GET /v1/3d-generate/:taskId — 查询任务状态
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
        const data = await resp.json();
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
        const date = new Date(timestamp * 1000).toISOString().split('T')[0];
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

        const kDate = crypto.createHmac('sha256', Buffer.from(`TC3${secretKey}`)).update(date).digest();
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
        const data = await resp.json();
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
      }

      return res.json({ error: '未知 provider' });
    } catch (e: any) {
      return res.json({ error: e.message });
    }
  });
}
