/**
 * /v1/video — 视频生成路由 (供 VideoGen 前端面板调用)
 * 引擎: CogVideoX-Flash (ZHIPU_API_KEY) 优先 / Agnes Video V2.0 (AGENTAI_API_KEY) 降级
 * 共用: ZHIPU_API_KEY (文本/生图/生视频同一 key)
 */
import { Router } from 'express';

export function createVideoRouter() {
  const router = Router();

  // POST /v1/video — 提交视频任务
  router.post('/v1/video', async (req, res) => {
    try {
      const { prompt, model: reqModel, num_frames, frame_rate, image, end_frame } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      const preferCogVideo = reqModel !== 'agnes';

      // ---- 引擎 1: CogVideoX-Flash (ZHIPU_API_KEY) ----
      if (preferCogVideo) {
        const zhipuKey = process.env['ZHIPU_API_KEY'];
        if (zhipuKey) {
          try {
            const body: any = { model: 'cogvideox-flash', prompt };
            if (image) body.image_url = image;
            if (end_frame) body.end_image_url = end_frame;
            const resp = await fetch('https://open.bigmodel.cn/api/paas/v4/videos/generations', {
              method: 'POST',
              headers: { Authorization: `Bearer ${zhipuKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(30000),
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const taskId = data.id || data.taskId;
              if (taskId) {
                return res.json({
                  taskId,
                  status: 'queued',
                  provider: 'cogvideox-flash',
                  prompt,
                });
              }
            }
            console.warn('[cogvideo] failed with status', resp.status, 'falling back to agnes');
          } catch (e: any) {
            console.warn('[cogvideo] error:', e.message, 'falling back to agnes');
          }
        }
      }

      // ---- 引擎 2: Agnes Video V2.0 ----
      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) {
        return res.status(400).json({
          error: preferCogVideo
            ? 'CogVideoX-Flash 失败且无 AGENTAI_API_KEY 降级'
            : '需要 AGENTAI_API_KEY (Agnes) 或 ZHIPU_API_KEY (CogVideoX 免费)',
        });
      }
      const dims = (req.body.size || '720x1280').split('x');
      const body: any = {
        model: 'agnes-video-v2.0',
        prompt,
        size: { width: parseInt(dims[0]) || 720, height: parseInt(dims[1]) || 1280 },
        duration: req.body.duration || 5,
      };
      if (num_frames) body.num_frames = num_frames;
      if (frame_rate) body.frame_rate = frame_rate;
      if (image) body.image = image;
      if (end_frame) body.end_frame = end_frame;
      const resp = await fetch('https://apihub.agnes-ai.cn/v1/videos', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return res.status(resp.status).json({ error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` });
      }
      const data: any = await resp.json();
      return res.json({
        taskId: data.taskId || data.id,
        status: 'queued',
        provider: 'agnes-video',
        prompt,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /v1/video/:taskId — 查询任务状态
  router.get('/v1/video/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;

      // 先试 CogVideoX
      const zhipuKey = process.env['ZHIPU_API_KEY'];
      if (zhipuKey) {
        try {
          const resp = await fetch(`https://open.bigmodel.cn/api/paas/v4/videos/generations/${taskId}`, {
            headers: { Authorization: `Bearer ${zhipuKey}` },
          });
          if (resp.ok) {
            const data: any = await resp.json();
            const status = data.task_status?.[0] || data.task_status || data.status;
            const videoUrl = data.video_result?.[0]?.url || data.video_result?.url || data.url;
            const coverUrl = data.video_result?.[0]?.cover_image_url;
            return res.json({
              status,
              videoUrl,
              coverUrl,
              raw: JSON.stringify(data),
            });
          }
        } catch {}
      }

      // 降级 Agnes
      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) return res.status(400).json({ error: 'No API Key' });
      const resp = await fetch(`https://apihub.agnes-ai.cn/v1/videos/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
      const data: any = await resp.json();
      return res.json({ raw: JSON.stringify(data) });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}
