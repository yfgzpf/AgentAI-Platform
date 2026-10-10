/**
 * /v1/video — 视频生成路由 (供 VideoGen 前端面板调用)
 * 引擎优先级:
 *   1. Agnes Video 2.5 正式版 (AGNES_VIDEO_API_KEY, apihub.agnes-ai.cn)
 *   2. Agnes Video 2.5 Flash (AGENTAI_API_KEY, api.agnes-ai.cn)
 *   3. Seedance 2.5 (VOLCANO_API_KEY, 火山引擎)
 *   4. CogVideoX-Flash (ZHIPU_API_KEY, 智谱免费)
 *
 * Agnes Video 2.5 官方文档: https://agnes-ai.cn/en/docs/agnes-video-25
 *   - POST /v1/videos  (创建任务)
 *   - GET  /agnesapi?video_id=xxx&model_name=agnes-video-2.5  (查询结果)
 *   - mode: "text" | "keyframe" | "reference"
 *   - seconds: 字符串 "4"~"12"
 *   - size: "720P" | "1080P" | "1K" | "2K"
 *   - aspect_ratio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9"
 *   - 图生视频: mode="reference", images=["url"]
 *   - 首尾帧: mode="keyframe", first_frame="url", last_frame="url"
 */
import { Router } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
// 2026-10-06: ffmpeg 调用全部改走 runFfmpeg(参数数组)。
// 原实现 execSync(`ffmpeg ... "${videoPath}"`) 把路径插进 shell 字符串 ——
// Windows cmd.exe 下 `&` `|` `%VAR%` 都是分隔符，双引号挡不住（命令注入面）。
// 同时缺失 ffmpeg 时给出可执行的提示，而不是笼统的'请手动截图'。
import { runFfmpeg, hasFfmpeg, explainFfmpegError, FFMPEG_MISSING } from '../ffmpeg.js';
import { promisify } from 'util';
import multer from 'multer';

const execAsync = promisify(exec);

// ===== 视频任务持久化 =====
const TASKS_FILE = path.join(process.cwd(), '.agentai', 'video-tasks.json');
interface StoredVideoTask {
  taskId: string;
  provider: string;
  prompt: string;
  status: string;
  videoUrl: string | null;
  coverUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

function loadStoredTasks(): StoredVideoTask[] {
  try {
    if (!fs.existsSync(TASKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
  } catch { return []; }
}

function saveStoredTask(task: StoredVideoTask) {
  try {
    const tasks = loadStoredTasks();
    const idx = tasks.findIndex(t => t.taskId === task.taskId);
    if (idx >= 0) tasks[idx] = task;
    else tasks.unshift(task);
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks.slice(0, 100)));
  } catch {}
}

function updateStoredTask(taskId: string, updates: Partial<StoredVideoTask>) {
  try {
    const tasks = loadStoredTasks();
    const idx = tasks.findIndex(t => t.taskId === taskId);
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], ...updates, updatedAt: Date.now() };
      fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks.slice(0, 100)));
    }
  } catch {}
}

export function createVideoRouter(io?: any) {
  const router = Router();

  // 视频文件上传 — 保存到 .agentai/uploads/videos/
  const videoUploadDir = path.join(process.cwd(), '.agentai', 'uploads', 'videos');
  fs.mkdirSync(videoUploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: videoUploadDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `upload_${Date.now()}${ext}`);
      },
    }),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  // POST /v1/video — 提交视频任务
  router.post('/v1/video', async (req, res) => {
    try {
      const { prompt, model: reqModel, image, end_frame, images: reqImages, audios: reqAudios } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      // ---- 时长处理: 统一转为 Agnes 的 seconds 字符串 ----
      // 前端可能传 duration ("5s") 或 seconds (数字/字符串)
      let seconds: string = '5';
      if (req.body.seconds) {
        seconds = String(req.body.seconds);
      } else if (req.body.duration) {
        const dur = String(req.body.duration).replace(/s$/i, '');
        const durNum = parseInt(dur, 10);
        // Agnes 2.5 支持 "4"~"12", 超出范围截断
        if (durNum >= 4 && durNum <= 12) {
          seconds = String(durNum);
        } else if (durNum < 4) {
          seconds = '4';
        } else {
          seconds = '12';
        }
      }

      // ---- 尺寸处理 ----
      const reqSize = req.body.size || '';
      let agnesSize = '720P';
      let aspectRatio = '16:9';
      if (reqSize === '1080P' || reqSize === '1K' || reqSize === '2K') {
        agnesSize = reqSize;
      } else if (reqSize.includes('x')) {
        // 兼容旧格式 "720x1280"
        const [w, h] = reqSize.split('x').map(Number);
        if (w && h) {
          aspectRatio = w > h ? '16:9' : '9:16';
        }
      }
      if (req.body.aspect_ratio) {
        aspectRatio = req.body.aspect_ratio;
      }

      // ══════ 引擎分发（2026-10-06 重写）══════
      //
      // 原实现是「按 key 是否存在依次尝试」:
      //   if (AGNES_VIDEO_API_KEY) → 正式版    ← 完全忽略 reqModel
      //   if (reqModel.startsWith('seedance')) → Seedance
      //   if (AGENTAI_API_KEY) → Flash       ← 同样忽略 reqModel
      //   if (ZHIPU_API_KEY) → 智谱
      //
      // 症状（用户实机反馈 2026-10-06）:
      //   状态选了「Agnes Video 2.5 Flash」，生成区却显示「智谱」，且必失败。
      //   原因: 引擎 1 只看 AGNES_VIDEO_API_KEY。若该 key 未配而AGENTAI_API_KEY
      //   也缺失，请求会一路落到引擎 4 智谱 —— 用户选的模型被静默替换。
      //   更糟的是前端的 provider 展示用的是**后端实际返回的 provider**，
      //   所以用户看到"智谱"才知道出错了，但已经无法判断是自己选错还是系统改的。
      //
      // 现在: 严格按 reqModel 分发；缺 key 时**明确报错**并列出该模型需要哪个变量，
      // 不再静默换引擎。无法识别的 model 返回 400 而不是随便找个引擎。
      const requested = String(reqModel || '').trim();

      // ---- Agnes Video 2.5 正式版 ----
      if (requested === 'agnes-video-2.5' || requested.startsWith('custom:')) {
        const key = process.env['AGNES_VIDEO_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: '所选模型「Agnes Video 2.5 正式版」需要 AGNES_VIDEO_API_KEY，但未配置。'
              + '请在设置页填入该Key，或改选「Agnes Video 2.5 Flash」(复用 AGENTAI_API_KEY)。',
            requiredEnv: 'AGNES_VIDEO_API_KEY',
            requestedModel: requested,
          });
        }
        return await submitAgnesVideo25(res, key, prompt, seconds, agnesSize, aspectRatio, image, end_frame, reqImages, reqAudios);
      }

      // ---- Agnes Video 2.5 Flash ----
      if (requested === 'agnes') {
        const key = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: '所选模型「Agnes Video 2.5 Flash」需要 AGENTAI_API_KEY（或 AGNES_API_KEY），但未配置。',
            requiredEnv: 'AGENTAI_API_KEY',
            requestedModel: requested,
          });
        }
        return await submitAgnesFlash(res, key, prompt, seconds, aspectRatio, image, end_frame, reqImages, reqAudios);
      }

      // ---- CogVideoX-Flash (智谱免费) ----
      if (requested === 'cogvideo') {
        const key = process.env['ZHIPU_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: '所选模型「CogVideoX-Flash」需要 ZHIPU_API_KEY，但未配置。',
            requiredEnv: 'ZHIPU_API_KEY',
            requestedModel: requested,
          });
        }
        return await submitCogVideo(res, key, prompt, image, end_frame);
      }

      // ---- Seedance (火山引擎) ----
      if (requested.startsWith('seedance')) {
        const key = process.env['VOLCANO_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: '所选模型「Seedance 2.5」需要 VOLCANO_API_KEY，但未配置。',
            requiredEnv: 'VOLCANO_API_KEY',
            requestedModel: requested,
          });
        }
        return await submitSeedance(res, key, prompt, image);
      }

      // ---- 未指定 model: 只在唯一可用引擎时自动选，避免多义----
      if (!requested) {
        const candidates: Array<{ name: string; env: string[] }> = [
          { name: 'agnes-video-2.5', env: ['AGNES_VIDEO_API_KEY'] },
          { name: 'agnes', env: ['AGENTAI_API_KEY', 'AGNES_API_KEY'] },
          { name: 'seedance-2.5', env: ['VOLCANO_API_KEY'] },
          { name: 'cogvideo', env: ['ZHIPU_API_KEY'] },
        ];
        const available = candidates.filter((c) => c.env.some((e) => process.env[e]));
        if (available.length === 1) {
          // 唯一可用引擎 → 直接按它分发（而不是"提醒"了事，否则用户永远拿不到 taskId）
          const only = available[0].name;
          if (only === 'agnes-video-2.5') {
            return await submitAgnesVideo25(res, process.env['AGNES_VIDEO_API_KEY']!, prompt, seconds, agnesSize, aspectRatio, image, end_frame, reqImages, reqAudios);
          }
          if (only === 'agnes') {
            return await submitAgnesFlash(res, process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY']!, prompt, seconds, aspectRatio, image, end_frame, reqImages, reqAudios);
          }
          if (only === 'cogvideo') {
            return await submitCogVideo(res, process.env['ZHIPU_API_KEY']!, prompt, image, end_frame);
          }
        }
        return res.status(400).json({
          error: '未指定视频模型，且检测到多个可用引擎，无法自动选择。'
            + '可用: ' + available.map((c) => c.name).join(' / '),
          available: available.map((c) => c.name),
        });
      }

      return res.status(400).json({
        error: `未知的视频模型: ${requested}。可用: agnes-video-2.5 / agnes / cogvideo / seedance-2.5`,
        requestedModel: requested,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /v1/video/:taskId — 查询任务状态
  router.get('/v1/video/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;
      const provider = req.query.provider as string || '';

      // Agnes Video 2.5 正式版查询
      if (provider.startsWith('agnes-video-2.5') && !provider.includes('flash')) {
        const agnesVideoKey = process.env['AGNES_VIDEO_API_KEY'];
        if (agnesVideoKey) {
          return await queryAgnesVideo25(res, agnesVideoKey, taskId);
        }
      }

      // Seedance/火山引擎任务查询
      if (provider.startsWith('doubao-seedance') || provider.startsWith('seedance')) {
        const volcanoKey = process.env['VOLCANO_API_KEY'];
        if (volcanoKey) {
          try {
            const resp = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
              headers: { Authorization: `Bearer ${volcanoKey}` },
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const status = data.status || data.state || 'processing';
              const videoUrl = data.content?.video?.url || data.video_url || data.url || null;
              const coverUrl = data.content?.video?.cover_image_url || data.cover_url || null;
              return res.json({ status, videoUrl, coverUrl, raw: JSON.stringify(data) });
            }
          } catch {}
        }
      }

      // Agnes Video 2.5 Flash 查询
      //
      // 2026-10-06 修复: 原判断 `provider.includes('flash')` 会把
      //   **cogvideox-flash**（智谱）也匹配上 —— 智谱的任务被拿到 Agnes 的
      //   查询接口去查，必然 404/报错，用户看到的就是"生成失败"。
      // 改为精确前缀匹配 + 显式排除 cogvideo。
      if (
        !provider.startsWith('cogvideo')
        && (provider.startsWith('agnes') || provider === 'flash' || provider === 'agnes-flash')
      ) {
        const flashKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
        if (flashKey) {
          return await queryAgnesFlash(res, flashKey, taskId);
        }
      }

      // CogVideoX 查询
      if (provider.startsWith('cogvideo')) {
        const zhipuKey = process.env['ZHIPU_API_KEY'];
        if (!zhipuKey) {
          return res.status(400).json({
            error: '查询 CogVideoX 任务需要 ZHIPU_API_KEY',
            requiredEnv: 'ZHIPU_API_KEY',
          });
        }
        try {
          const resp = await fetch(`https://open.bigmodel.cn/api/paas/v4/async-result/${taskId}`, {
            headers: { Authorization: `Bearer ${zhipuKey}` },
          });
          if (resp.ok) {
            const data: any = await resp.json();
            const status = data.task_status?.[0] || data.task_status || data.status;
            const videoUrl = data.video_result?.[0]?.url || data.video_result?.url || data.url;
            const coverUrl = data.video_result?.[0]?.cover_image_url;
            return res.json({ status, videoUrl, coverUrl, raw: JSON.stringify(data) });
          }
          const errText = await resp.text().catch(() => '');
          return res.status(resp.status).json({
            error: `智谱查询失败 HTTP ${resp.status}: ${errText.slice(0, 200)}`,
          });
        } catch (e: any) {
          return res.status(500).json({ error: `智谱查询异常: ${e.message}` });
        }
      }

      return res.status(400).json({
        error: `无法识别 provider: ${provider || '(空)'}。`
          + '请检查提交任务时的模型，或该任务对应的 API Key 是否已配置。',
        provider,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/video/upload — 上传视频文件, 返回本地路径 (供 extract-frames 使用)
  router.post('/v1/video/upload', upload.single('file'), (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'file required' });
      return res.json({
        path: req.file.path,
        filename: req.file.filename,
        size: req.file.size,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/video/extract-tail — 提取视频最后一帧为图片 (续集功能)
  // 漫剧系统方案: 下载视频 → ffmpeg -sseof -0.1 提取尾帧 → 返回 Data URI
  // 兼容: 也接受本地视频路径 (videoPath 字段)
  router.post('/v1/video/extract-tail', async (req, res) => {
    try {
      const { videoUrl, videoPath } = req.body;
      const tmpDir = path.join(process.cwd(), '.agentai', 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpVideo = path.join(tmpDir, `tail_src_${Date.now()}.mp4`);
      const tmpFrame = path.join(tmpDir, `tail_out_${Date.now()}.png`);

      if (videoPath) {
        // 本地文件路径 — 直接用
        if (!fs.existsSync(videoPath)) {
          return res.status(400).json({ error: `文件不存在: ${videoPath}` });
        }
        try {
          await runFfmpeg(['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', tmpFrame]);
        } catch (e: any) {
          return res.status(500).json({ error: explainFfmpegError(e) });
        }
      } else if (videoUrl) {
        // 远程 URL — 先下载
        const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
        if (!resp.ok) return res.status(400).json({ error: `下载视频失败: HTTP ${resp.status}` });
        const buf = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(tmpVideo, buf);
        try {
          await runFfmpeg(['-y', '-sseof', '-0.1', '-i', tmpVideo, '-frames:v', '1', '-q:v', '2', tmpFrame]);
        } catch (e: any) {
          try { fs.unlinkSync(tmpVideo); } catch { /* ignore */ }
          return res.status(500).json({ error: explainFfmpegError(e) });
        }
        try { fs.unlinkSync(tmpVideo); } catch {}
      } else {
        return res.status(400).json({ error: 'videoUrl 或 videoPath required' });
      }

      // 读取尾帧并转为 Data URI
      if (!fs.existsSync(tmpFrame)) {
        return res.status(500).json({ error: '尾帧文件未生成' });
      }
      const frameBuf = fs.readFileSync(tmpFrame);
      const base64 = frameBuf.toString('base64');
      const dataUri = `data:image/png;base64,${base64}`;
      try { fs.unlinkSync(tmpFrame); } catch {}

      return res.json({ tailFrameUrl: dataUri });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/video/extract-frames — 从视频中提取首帧+尾帧 (上传视频做原型)
  // body: { videoPath: string }  (本地路径)
  // 返回: { firstFrame: dataUri, lastFrame: dataUri, duration: number }
  router.post('/v1/video/extract-frames', async (req, res) => {
    try {
      const { videoPath } = req.body;
      if (!videoPath) return res.status(400).json({ error: 'videoPath required' });
      if (!fs.existsSync(videoPath)) {
        return res.status(400).json({ error: `文件不存在: ${videoPath}` });
      }

      const tmpDir = path.join(process.cwd(), '.agentai', 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ts = Date.now();
      const firstFramePath = path.join(tmpDir, `first_${ts}.png`);
      const lastFramePath = path.join(tmpDir, `last_${ts}.png`);

      // 提取首帧 (00:00:00)
      try {
        await runFfmpeg(['-y', '-i', videoPath, '-ss', '00:00:00', '-frames:v', '1', '-q:v', '2', firstFramePath]);
      } catch (e: any) {
        return res.status(500).json({ error: `ffmpeg 提取首帧失败: ${explainFfmpegError(e)}` });
      }

      // 提取尾帧 (倒数 0.1 秒)
      try {
        await runFfmpeg(['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', lastFramePath]);
      } catch {
        // 尾帧失败不致命, 只返回首帧
      }

      // 获取视频时长
      let duration = 0;
      try {
        const probe = hasFfmpeg();
        if (probe.ok) {
          const { execFile } = await import('child_process');
          const ffprobeBin = probe.bin.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
          const durOut = await new Promise<string>((resolve) => {
            execFile(
              ffprobeBin,
              ['-v', 'error', '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1', videoPath],
              { timeout: 10000, windowsHide: true },
              (_e: any, so: any) => resolve(String(so || '')),
            );
          });
          duration = parseFloat(durOut.trim()) || 0;
        }
      } catch { /* 时长拿不到不影响主流程 */ }

      // 转为 Data URI
      const toDataUri = (p: string): string | null => {
        if (!fs.existsSync(p)) return null;
        const b64 = fs.readFileSync(p).toString('base64');
        return `data:image/png;base64,${b64}`;
      };

      const firstFrame = toDataUri(firstFramePath);
      const lastFrame = toDataUri(lastFramePath);

      // 清理
      try { fs.unlinkSync(firstFramePath); } catch {}
      try { fs.unlinkSync(lastFramePath); } catch {}

      if (!firstFrame) {
        return res.status(500).json({ error: '首帧提取失败' });
      }

      return res.json({ firstFrame, lastFrame, duration });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // POST /v1/video/next-episode — 智能续集生成
  // 接收: videoUrl + originalPrompt + episodeIndex + characters(可选)
  // 流程: 提取尾帧 → 调用多模态 LLM 分析画面+生成新剧本 → 返回 tailFrameUrl + newPrompt
  router.post('/v1/video/next-episode', async (req, res) => {
    try {
      const { videoUrl, originalPrompt, episodeIndex = 2, characters, storyContext, apiLastFrame } = req.body;
      if (!videoUrl && !req.body.videoPath) {
        return res.status(400).json({ error: 'videoUrl or videoPath required' });
      }

      // Step 1: 获取尾帧 — 优先用 API 返回的尾帧 URL, 其次用 ffmpeg 提取
      let tailFrameDataUri: string | null = null;

      if (apiLastFrame) {
        // P0: Agnes API 在 return_last_frame: true 时返回的尾帧 URL, 直接使用
        tailFrameDataUri = apiLastFrame;
        console.log('[next-episode] 使用 API 返回的尾帧 URL, 跳过 ffmpeg');
      } else if (hasFfmpeg().ok) {
        const tmpDir = path.join(process.cwd(), '.agentai', 'tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpVideo = path.join(tmpDir, `ep_src_${Date.now()}.mp4`);
        const tmpFrame = path.join(tmpDir, `ep_tail_${Date.now()}.png`);
        const videoPath = req.body.videoPath;

        try {
          if (videoPath && fs.existsSync(videoPath)) {
            await runFfmpeg(['-y', '-sseof', '-0.1', '-i', videoPath, '-frames:v', '1', '-q:v', '2', tmpFrame]);
          } else if (videoUrl) {
            const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
            if (!resp.ok) throw new Error(`下载视频失败: HTTP ${resp.status}`);
            const buf = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(tmpVideo, buf);
            await runFfmpeg(['-y', '-sseof', '-0.1', '-i', tmpVideo, '-frames:v', '1', '-q:v', '2', tmpFrame]);
            try { fs.unlinkSync(tmpVideo); } catch {}
          }

          if (fs.existsSync(tmpFrame)) {
            const frameBuf = fs.readFileSync(tmpFrame);
            const base64 = frameBuf.toString('base64');
            tailFrameDataUri = `data:image/png;base64,${base64}`;
            try { fs.unlinkSync(tmpFrame); } catch {}
          }
        } catch (e: any) {
          console.warn('[next-episode] 尾帧提取失败 (将跳过画面分析):', e.message);
          // 不 return error — 继续走纯文本续集
        }
      } else {
        console.warn('[next-episode] ffmpeg 不可用, 跳过尾帧提取, 使用纯文本续集');
      }

      // Step 2: 调用 LLM 生成续集剧本
      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) {
        // 无 API key — 降级: 简单续集提示词
        return res.json({
          tailFrameUrl: tailFrameDataUri,
          newPrompt: `续集 第${episodeIndex}集: ${originalPrompt.slice(0, 80)}...\n请延续上一段视频的内容和风格, 生成后续画面。`,
          storySummary: '',
          characters: characters || [],
          warning: tailFrameDataUri ? undefined : 'ffmpeg 未安装, 未提取尾帧。请手动上传尾帧或安装 ffmpeg。',
        });
      }

      // 借鉴漫剧系统 FrameOS 的剧本生成 prompt 模板
      const characterInfo = characters && characters.length > 0
        ? `\n【已知角色】\n${characters.map((c: any) => `- ${c.name}: ${c.description}`).join('\n')}`
        : '';

      const storyInfo = storyContext
        ? `\n【前情摘要】\n${storyContext}`
        : '';

      // 智能续集: 返回完整分镜结构 (与 storyboard 格式一致), 不只是一个 prompt
      const shotDuration = 5; // 续集默认 5s/镜
      const shotsPerEpisode = 4; // 续集默认 4 镜
      const systemPrompt = `你是一位专业的AI视频编剧导演。你需要基于上一集的剧情和尾帧画面, 生成续集的分镜剧本。

【关键规则】
1. 每镜时长固定 ${shotDuration} 秒
2. 生成 ${shotsPerEpisode} 个镜头
3. 必须延续上一集的剧情, 发展新的转折和冲突
4. 跨集角色必须一致 — 复用已知角色的外貌描述
5. 每镜的 prompt 必须是可直接发给视频模型的描述 (80-120字中文)
6. 第一镜要从尾帧画面自然过渡
7. 每镜标注 type(WS/MS/CU)、camera_motion、mood、characters、dialogue

【角色一致性】
- 已知角色必须复用其外貌描述, 保证跨集一致
- 如有新角色, 需创建角色卡

【输出JSON格式】
{
  "title": "续集标题",
  "characters": [
    { "name": "角色名", "description": "外貌描述", "refImageIndex": 0 }
  ],
  "episode": {
    "index": ${episodeIndex},
    "title": "本集标题",
    "scene": { "name": "场景名", "description": "场景描述" },
    "shots": [
      {
        "id": 1,
        "type": "WS",
        "duration": "${shotDuration}",
        "camera_motion": "slow tracking shot",
        "mood": "mysterious",
        "prompt": "具体的视频生成提示词(80-120字中文)",
        "characters": ["角色名1"],
        "dialogue": ""
      }
    ]
  }
}

只输出JSON, 不要加任何说明文字或markdown标记。`;

      // 如果有尾帧 → 多模态分析; 没有 → 纯文本续集
      const framePrompt = `这是第${episodeIndex - 1}集视频的最后一帧画面。请分析画面内容, 并基于上一集剧情生成第${episodeIndex}集的分镜剧本。

【第${episodeIndex - 1}集剧情】
${originalPrompt}${storyInfo}${characterInfo}

【要求】
1. 仔细分析尾帧画面中的人物、场景、光线、情绪
2. 延续故事线, 发展新的剧情转折 (不要简单重复)
3. 生成 ${shotsPerEpisode} 镜的分镜剧本
4. 第一镜从尾帧画面自然过渡
5. 角色外貌必须与上一集一致

只输出JSON。`;
      const textPrompt = `请基于上一集的剧情描述, 生成第${episodeIndex}集的分镜剧本。

【第${episodeIndex - 1}集剧情】
${originalPrompt}${storyInfo}${characterInfo}

【要求】
1. 延续故事线, 发展新的剧情转折
2. 生成 ${shotsPerEpisode} 镜的分镜剧本
3. 角色外貌必须与上一集一致
4. 第一镜从上一集结尾自然过渡

只输出JSON。`;

      const buildMessages = (frame: string | null): any[] => {
        const msgs: any[] = [{ role: 'system', content: systemPrompt }];
        if (frame) {
          msgs.push({ role: 'user', content: [
            { type: 'text', text: framePrompt },
            { type: 'image_url', image_url: { url: frame } },
          ] });
        } else {
          msgs.push({ role: 'user', content: textPrompt });
        }
        return msgs;
      };

      // 503 队列满回退策略：等待 5s 重试, 最多 2 次
      const callLlm = async (messages: any[]): Promise<Response> => {
        const post = () => fetch('https://api.agnes-ai.cn/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'agnes-2.5-flash',
            messages,
            max_tokens: 800,
            temperature: 0.8,
          }),
          signal: AbortSignal.timeout(30000),
        });
        let resp = await post();
        for (let attempt = 0; resp.status === 503 && attempt < 2; attempt++) {
          console.warn(`[next-episode] LLM 503 队列满, 第${attempt + 1}次重试, 等待 5s`);
          await new Promise((r) => setTimeout(r, 5000));
          resp = await post();
        }
        return resp;
      };

      let effectiveFrame = tailFrameDataUri;
      let llmResp: Response | null = await callLlm(buildMessages(effectiveFrame));
      if (llmResp && !llmResp.ok && llmResp.status === 503 && effectiveFrame) {
        // 503 重试耗尽 → 降级为纯文本模式(跳过尾帧), 不阻断流程
        console.warn('[next-episode] 503 重试耗尽, 降级为纯文本模式(跳过尾帧)');
        effectiveFrame = null;
        llmResp = await callLlm(buildMessages(null));
      }

      let episodeData: any = null;
      if (llmResp && llmResp.ok) {
        const llmData: any = await llmResp.json();
        let content = llmData.choices?.[0]?.message?.content || '';
        content = content.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
        try {
          episodeData = JSON.parse(content);
        } catch {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try { episodeData = JSON.parse(jsonMatch[0]); } catch {}
          }
        }
      }

      if (!episodeData || !episodeData.episode) {
        episodeData = {
          title: `第${episodeIndex}集`,
          characters: characters || [],
          episode: {
            index: episodeIndex,
            title: `第${episodeIndex}集`,
            shots: [{
              id: 1, type: 'MS', duration: String(shotDuration),
              camera_motion: 'slow tracking', mood: 'neutral',
              prompt: `续集: ${originalPrompt.slice(0, 80)}... 延续上一集的内容和风格, 生成后续画面。`,
              characters: (characters || []).map((c: any) => c.name),
              dialogue: '',
            }],
          },
        };
      }

      // 确保 shots 有 selected 和 status
      if (episodeData.episode?.shots) {
        episodeData.episode.shots.forEach((s: any) => {
          s.selected = true;
          s.status = 'pending';
        });
      }

      return res.json({
        tailFrameUrl: tailFrameDataUri,
        episodeData,
        episodeIndex,
        warning: effectiveFrame ? undefined : '未获取到尾帧 (ffmpeg 不可用或 503 降级)。AI 已基于剧情描述生成续集剧本。',
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /v1/video/storyboard — 剧本分镜生成
  // 输入: { prompt, episodeCount, durationPerShot, refImages?, model? }
  // 输出: { title, episodes: [{ index, title, shots: [{ id, duration, prompt, ... }] }] }
  // ════════════════════════════════════════════════════════════════════════
  router.post('/v1/video/storyboard', async (req, res) => {
    try {
      const { prompt, episodeCount = 1, durationPerShot = '5', refImages = [] } = req.body;
      if (!prompt) return res.status(400).json({ error: 'prompt required' });

      const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (!apiKey) {
        return res.status(400).json({ error: '需要 AGENTAI_API_KEY 才能生成剧本' });
      }

      // 计算每集镜数: 总时长 / 单镜时长
      const shotDuration = parseInt(String(durationPerShot), 10) || 5;
      const targetMinutesPerEpisode = 0.5; // 每集约30秒
      const shotsPerEpisode = Math.max(2, Math.min(8, Math.ceil((targetMinutesPerEpisode * 60) / shotDuration)));

      // 构建多模态 LLM 消息 — 分析参考图 + 生成结构化剧本
      // 参考漫剧系统 FrameOS 的剧本生成规范: 视觉优先 + 角色一致 + 剧情连贯 + 对白精炼
      const systemPrompt = `你是一位专业的AI视频编剧导演。你需要根据用户的创意生成分集分镜剧本。

【剧本铁律 — 参考漫剧系统验证过的规范】
1. 视觉优先: 每镜描述具体的可拍摄动作, 避免抽象内心独白
2. 角色限制: 单镜最多3个角色同时出现
3. 动作可执行: 角色动作必须具体、可被视频模型理解 (如"走向窗边"而非"感到悲伤")
4. 对白精炼: 每句台词控制在15字以内, 对白要推动剧情而非闲聊
5. 环境具体化: 明确描述光线方向、色温、空间布局、关键道具
6. 情绪外化: 用表情和肢体动作传达情绪, 不要写"内心感到..."
7. 每镜时长固定 ${shotDuration} 秒, 每集 ${shotsPerEpisode} 镜, 共 ${episodeCount} 集
8. 每镜 prompt 必须是可直接发给视频模型的描述 (80-120字中文)
9. 跨集剧情要连贯: 上一集结尾自然过渡到下一集开头, 每集有起承转合

【角色一致性 — 跨集复用】
- 为每个主要角色创建角色卡: name(名字), description(外貌描述), refImageIndex(参考图索引)
- 角色描述要极其具体: 年龄/性别/发型(颜色+长度+样式)/服装(颜色+款式)/体型/标志特征
- 跨镜头跨集复用同一角色描述, 保证角色视觉一致
- 角色出现在哪镜, 就在 characters 数组中列出其名字

【场景一致性 — 每集固定场景】
- 为每集创建场景卡: scene: { name: "场景名", description: "场景描述" }
- 场景描述要具体: 地点类型(室内/室外)+时间(白天/夜晚)+光线(柔和/强烈)+关键道具
- 同一场景跨集保持一致 (如"主角的卧室"在多集中描述相同)

【剧情发展 — 起承转合】
- 第1集: 介绍角色和背景, 设置冲突种子
- 中间集: 发展冲突, 角色关系变化, 新事件发生
- 最后集: 冲突解决或升级, 结局留有余味
- 每集内部也要有起承转合, 不是平铺直叙

【对白要求】
- dialogue 字段填入该镜中的对白 (如有)
- 对白要自然、口语化, 符合角色性格
- 每句不超过15字, 一镜最多2-3句对白
- 无对白的镜头填空字符串

【镜头语言】
- type: WS(远景/全景)/MS(中景)/CU(特写)/ECU(大特写)
- camera_motion: 推(push in)/拉(pull out)/摇(pan)/移(tracking)/跟(follow)/固定(static)/航拍(aerial)
- mood: 情绪氛围 (mysterious/tense/warm/sad/exciting/peaceful等)

【输出JSON格式】
{
  "title": "剧集标题",
  "characters": [
    { "name": "角色名", "description": "极其具体的外貌描述", "refImageIndex": 0 }
  ],
  "episodes": [
    {
      "index": 1,
      "title": "本集标题",
      "scene": { "name": "场景名", "description": "场景环境描述" },
      "shots": [
        {
          "id": 1,
          "type": "WS",
          "duration": "${shotDuration}",
          "camera_motion": "slow tracking shot",
          "mood": "mysterious",
          "prompt": "具体的视频生成提示词(80-120字中文), 包含场景环境+角色动作+光线氛围+镜头运动",
          "characters": ["角色名1"],
          "dialogue": "角色名: 台词内容"
        }
      ]
    }
  ]
}

只输出JSON, 不要加任何说明文字或markdown标记。`;

      // 构建用户消息 — 有参考图用多模态
      const userContent: any[] = [{ type: 'text', text: prompt }];
      for (const img of refImages.slice(0, 5)) {
        // 已是 Data URI 或 http URL → 直接使用; 纯 base64 → 补全前缀
        // 修复: 之前漏判 data: 前缀, 导致 data:image/png;base64,data:image/png;base64,... 非法格式 ("图送形式错误")
        const url = await urlToBase64(String(img));
        userContent.push({ type: 'image_url', image_url: { url } });
      }

      const llmResp = await fetch('https://api.agnes-ai.cn/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'agnes-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          max_tokens: 4000,
          temperature: 0.8,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!llmResp.ok) {
        const errText = await llmResp.text().catch(() => '');
        return res.status(llmResp.status).json({ error: `LLM 生成剧本失败: HTTP ${llmResp.status}: ${errText.slice(0, 200)}` });
      }

      const llmData: any = await llmResp.json();
      let content = llmData.choices?.[0]?.message?.content || '';
      // 清理 markdown 标记
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let storyboard;
      try {
        storyboard = JSON.parse(content);
      } catch {
        // JSON 解析失败 — 尝试提取 JSON 块
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          storyboard = JSON.parse(jsonMatch[0]);
        } else {
          return res.status(500).json({ error: 'LLM 返回的不是有效JSON', raw: content.slice(0, 500) });
        }
      }

      // 后端保证每个 episode 都有 scene 字段 — AI 可能不输出
      if (storyboard?.episodes) {
        for (const ep of storyboard.episodes) {
          if (!ep.scene) {
            // 从该集 shots 的 prompt 中提取场景信息
            const firstPrompt = ep.shots?.[0]?.prompt || '';
            ep.scene = {
              name: `第${ep.index}集场景`,
              description: firstPrompt.slice(0, 100),
            };
          }
          if (!ep.scene.name) ep.scene.name = `第${ep.index}集场景`;
          if (!ep.scene.description) ep.scene.description = ep.shots?.[0]?.prompt?.slice(0, 100) || '';
        }
      }

      res.json({ ok: true, storyboard });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /v1/video/concat — 视频拼接 (多镜头合并为完整剧集)
  // 输入: { videoUrls: string[], title?: string }
  // 输出: { url: string, localPath: string }
  // 流程: 下载所有视频 → ffmpeg concat → 返回合并后的视频文件路径
  // ════════════════════════════════════════════════════════════════════════
  router.post('/v1/video/concat', async (req, res) => {
    try {
      const { videoUrls, title } = req.body;
      if (!videoUrls || !Array.isArray(videoUrls) || videoUrls.length === 0) {
        return res.status(400).json({ error: 'videoUrls array required' });
      }
      if (!hasFfmpeg().ok) {
        return res.status(500).json({ error: explainFfmpegError(new Error(FFMPEG_MISSING)) });
      }

      const tmpDir = path.join(process.cwd(), '.agentai', 'tmp');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ts = Date.now();
      const localFiles: string[] = [];

      // Step 1: 下载所有视频到本地
      for (let i = 0; i < videoUrls.length; i++) {
        const url = videoUrls[i];
        if (!url) continue;
        const localPath = path.join(tmpDir, `concat_${ts}_${i}.mp4`);
        try {
          if (url.startsWith('http')) {
            const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!resp.ok) { console.warn(`[concat] 跳过第${i}段: HTTP ${resp.status}`); continue; }
            const buf = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(localPath, buf);
          } else if (url.startsWith('/api/')) {
            // 本地已下载的视频 — 读路径
            const realPath = decodeURIComponent(url.split('path=')[1] || '');
            if (realPath && fs.existsSync(realPath)) {
              fs.copyFileSync(realPath, localPath);
            } else { continue; }
          } else {
            continue;
          }
          localFiles.push(localPath);
        } catch (e: any) {
          console.warn(`[concat] 下载第${i}段失败:`, e.message);
        }
      }

      if (localFiles.length === 0) {
        return res.status(500).json({ error: '没有可拼接的视频' });
      }
      if (localFiles.length === 1) {
        // 只有一段, 直接返回
        return res.json({ url: `/api/files/download?path=${encodeURIComponent(localFiles[0])}`, localPath: localFiles[0], provider: 'ffmpeg-concat' });
      }

      // Step 2: 生成 concat 列表文件
      const listFile = path.join(tmpDir, `concat_list_${ts}.txt`);
      const listContent = localFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
      fs.writeFileSync(listFile, listContent, 'utf-8');

      // Step 3: ffmpeg concat (重编码确保兼容性)
      const outputFile = path.join(tmpDir, `merged_${ts}.mp4`);
      try {
        await runFfmpeg([
          '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
          '-c:a', 'aac', '-movflags', '+faststart',
          outputFile,
        ], 120000); // 2min 超时
      } catch (e: any) {
        // concat demuxer 失败 → 降级到逐段拼接
        console.warn('[concat] concat demuxer 失败, 尝试逐段拼接:', e.message);
        try {
          let current = localFiles[0];
          for (let i = 1; i < localFiles.length; i++) {
            const merged = path.join(tmpDir, `merge_step_${ts}_${i}.mp4`);
            await runFfmpeg(['-y', '-i', current, '-i', localFiles[i], '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac', '-filter_complex', '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[outv][outa]', '-map', '[outv]', '-map', '[outa]', merged], 120000);
            try { if (current !== localFiles[0]) fs.unlinkSync(current); } catch {}
            current = merged;
          }
          fs.copyFileSync(current, outputFile);
        } catch (e2: any) {
          return res.status(500).json({ error: `视频拼接失败: ${e2.message}` });
        }
      }

      // 清理临时文件
      try { fs.unlinkSync(listFile); } catch {}
      localFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });

      if (!fs.existsSync(outputFile)) {
        return res.status(500).json({ error: '拼接后文件未生成' });
      }

      return res.json({
        url: `/api/files/download?path=${encodeURIComponent(outputFile)}`,
        localPath: outputFile,
        provider: 'ffmpeg-concat',
        segments: localFiles.length,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  return router;
}

// ════════════════════════════════════════════════════════════════════════
//引擎封装（2026-10-06 从 POST handler 里抽出）
// ════════════════════════════════════════════════════════════════════════

/** CogVideoX-Flash（智谱免费） */

/** Seedance 2.5（火山引擎） */
async function submitSeedance(
  res: any,
  key: string,
  prompt: string,
  image?: string,
): Promise<void> {
  const volModel = 'doubao-seedance-2.5';
  const volBody: any = {
    model: volModel,
    content: [{ type: 'text', text: prompt }],
  };
  if (image) {
    const imgData = await urlToBase64(image);
    volBody.content.push({ type: 'image_url', image_url: { url: imgData } });
  }
  try {
    const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(volBody),
      signal: AbortSignal.timeout(30000),
    });
    if (resp.ok) {
      const data: any = await resp.json();
      const taskId = data.id || data.task_id;
      if (taskId) {
        res.json({ taskId, status: 'queued', provider: volModel, prompt });
        return;
      }
    }
    const errText = await resp.text().catch(() => '');
    res.status(resp.status || 502).json({
      error: `火山引擎返回 HTTP ${resp.status}: ${errText.slice(0, 200)}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: `Seedance 请求失败: ${e.message}` });
  }
}

// ===== Agnes Video 2.5 正式版 =====
async function submitAgnesVideo25(
  res: any, apiKey: string, prompt: string, seconds: string, size: string, aspectRatio: string,
  image?: string, endFrame?: string, images?: string[], audios?: string[],
) {
  // 按官方文档构造请求体
  const body: any = {
    model: 'agnes-video-2.5',
    prompt,
    seconds,
size,
aspect_ratio: aspectRatio,
return_last_frame: true,
};

  // 判断模式
  if (image && endFrame) {
    // 首尾帧模式
    body.mode = 'keyframe';
    body.first_frame = await urlToBase64(image);
    body.last_frame = await urlToBase64(endFrame);
  } else if (image || (images && images.length > 0)) {
    // 图生视频/参考模式
    body.mode = 'reference';
    body.images = [];
    if (image) body.images.push(await urlToBase64(image));
    if (images) {
      for (const img of images) body.images.push(await urlToBase64(img));
    }
    if (audios && audios.length > 0) {
      body.audios = [];
      for (const a of audios) body.audios.push(await urlToBase64(a));
    }
  } else {
    // 纯文生视频
    body.mode = 'text';
  }

  try {
    const resp = await fetch('https://apihub.agnes-ai.cn/v1/videos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // 2.5 正式版失败 → 降级到 Flash
      console.warn('[agnes-video-2.5] failed:', resp.status, 'trying flash fallback');
      const flashKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
      if (flashKey) {
        return submitAgnesFlash(res, flashKey, prompt, seconds, aspectRatio, image, endFrame, images, audios);
      }
      return res.status(resp.status).json({ error: `HTTP ${resp.status}: ${errText.slice(0, 300)}` });
    }
    const data: any = await resp.json();
    const videoId = data.video_id || data.id || data.task_id;
    return res.json({
      taskId: videoId,
      videoId,
      status: 'queued',
      provider: 'agnes-video-2.5',
      prompt,
    });
  } catch (e: any) {
    // 网络错误 → 降级到 Flash
    const flashKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
    if (flashKey) {
      return submitAgnesFlash(res, flashKey, prompt, seconds, aspectRatio, image, endFrame, images, audios);
    }
    return res.status(500).json({ error: e.message });
  }
}

async function queryAgnesVideo25(res: any, apiKey: string, videoId: string) {
  try {
    const resp = await fetch(`https://apihub.agnes-ai.cn/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    const data: any = await resp.json();
    const status = data.status || data.state || 'processing';
    const videoUrl = data.video_url || data.url || data.video?.url || data.output?.[0]?.url || data.result?.video_url || null;
    const coverUrl = data.cover_url || data.poster || data.cover || data.video?.cover_url || null;
    // P0: 提取 API 返回的尾帧 URL (return_last_frame: true 时返回)
    const lastFrameUrl = data.last_frame || data.last_frame_url || data.content?.last_frame || null;
    return res.json({ status, videoUrl, coverUrl, lastFrameUrl, raw: JSON.stringify(data) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

// ===== Agnes Video 2.5 Flash (共享 AGENTAI_API_KEY, api.agnes-ai.cn) =====
// 官方文档: Flash 沿用 2.5 公共参数, 差异仅:
//   - size 固定 "720P"
//   - images 最多 5 张, audios 最多 3 段
//   - 不支持 videos 输入
//   - mode 仍支持 text / keyframe / reference (与正式版一致!)
async function submitAgnesFlash(
  res: any, apiKey: string, prompt: string, seconds: string, aspectRatio: string,
  image?: string, endFrame?: string, images?: string[], audios?: string[],
) {
  const body: any = {
    model: 'agnes-video-2.5-flash',
    prompt,
    seconds,
    size: '720P',          // Flash 固定 720P
    aspect_ratio: aspectRatio,
    // 注意: Flash 不支持 return_last_frame 字段, 只有正式版 agnes-video-2.5 支持
  };

  // 判断模式 — 与正式版逻辑一致
  if (image && endFrame) {
    // 首尾帧模式
    body.mode = 'keyframe';
    body.first_frame = await urlToBase64(image);
    body.last_frame = await urlToBase64(endFrame);
  } else if (image || (images && images.length > 0)) {
    // 图生视频/参考模式 (Flash: images 最多 5 张, audios 最多 3 段)
    body.mode = 'reference';
    body.images = [];
    if (image) body.images.push(await urlToBase64(image));
    if (images) {
      for (const img of images.slice(0, 5)) {
        body.images.push(await urlToBase64(img));
      }
    }
    if (audios && audios.length > 0) {
      body.audios = [];
      for (const a of audios.slice(0, 3)) {
        body.audios.push(await urlToBase64(a));
      }
    }
  } else {
    // 纯文生视频
    body.mode = 'text';
  }

  try {
    const resp = await fetch('https://api.agnes-ai.cn/v1/videos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error(`[Agnes Flash] HTTP ${resp.status}: ${errText.slice(0, 500)}`);
      // P0: 速率限制 (429) 或服务不可用 (503) 时明确告知用户
      const isRateLimit = resp.status === 429;
      const isServiceError = resp.status >= 500;
      const hint = isRateLimit
        ? 'Agnes Flash API 速率限制 (429), 请稍后重试或降低生成频率'
        : isServiceError
        ? 'Agnes Flash API 服务暂时不可用, 请稍后重试'
        : '';
      return res.status(resp.status).json({
        error: `Agnes Video 2.5 Flash 返回 HTTP ${resp.status}: ${errText.slice(0, 300)}`,
        hint,
        provider: 'agnes-flash',
      });
    }
    const data: any = await resp.json();
    const videoId = data.video_id || data.id || data.task_id;
    return res.json({
      taskId: videoId,
      videoId,
      status: 'queued',
      provider: 'agnes-video-2.5-flash',
      prompt,
    });
  } catch (e: any) {
    // P0 修复: 不再静默降级到智谱
    return res.status(500).json({ error: `Agnes Video 2.5 Flash 请求失败: ${e.message}` });
  }
}

async function queryAgnesFlash(res: any, apiKey: string, videoId: string) {
  try {
    const resp = await fetch(`https://api.agnes-ai.cn/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5-flash`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    const data: any = await resp.json();
    const status = data.status || data.state || 'processing';
    const videoUrl = data.video_url || data.url || data.video?.url || data.output?.[0]?.url || null;
    const coverUrl = data.cover_url || data.poster || data.cover || null;
    // P0: 提取 API 返回的尾帧 URL (return_last_frame: true 时返回)
    const lastFrameUrl = data.last_frame || data.last_frame_url || data.content?.last_frame || null;
    return res.json({ status, videoUrl, coverUrl, lastFrameUrl, raw: JSON.stringify(data) });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

// ===== CogVideoX-Flash (智谱免费) =====
async function submitCogVideo(res: any, zhipuKey: string, prompt: string, image?: string, endFrame?: string) {
  try {
    const body: any = { model: 'cogvideox-flash', prompt };
    if (image) body.image_url = image;
  if (endFrame) body.end_image_url = endFrame;   // 2026-10-06: 续集首尾帧需要
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
        return res.json({ taskId, status: 'queued', provider: 'cogvideox-flash', prompt });
      }
    }
    const errText = await resp.text().catch(() => '');
    return res.status(resp.status).json({ error: `CogVideoX HTTP ${resp.status}: ${errText.slice(0, 200)}` });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}

// ===== 辅助: URL/Data URI 标准化 =====
function normalizeUrl(url: string): string {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed; // 公网 URL 直接返回 (后端 submitAgnesFlash 中会异步下载转 base64)
  }
  if (trimmed.startsWith('data:')) {
    // Data URI → 提取纯 Base64 (Agnes Video API 要求"合法 Base64", 不接受 data: 前缀)
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx > 0) {
      return trimmed.substring(commaIdx + 1);
    }
    return trimmed;
  }
  // 纯 base64 → 直接返回 (不需要补 data: 前缀)
  return trimmed;
}

// 异步下载本地/远程 URL 的图片并转为 Agnes Video API 可用的格式
// Agnes Video API: "素材必须是公网 http(s) URL 或合法 Base64"
// - 公网 URL (非 localhost) → 直接返回 URL
// - localhost URL → 下载转纯 base64 (不带 data: 前缀)
// - data: URI → 提取纯 base64
// - 纯 base64 → 直接返回
const bigWarned = new Set<string>();
async function urlToBase64(url: string): Promise<string> {
if (!url || typeof url !== 'string') return url;
const trimmed = url.trim();
// data: URI → 直接返回完整 Data URI (Agnes API 接受 data:image/xxx;base64,... 格式)
    if (trimmed.startsWith('data:')) {
        // ★ 2026-10-10: 原来对每个 2MB 级 data URI 都打一行日志,
        //   分镜循环里同一批参考图会重复调用 → 日志被刷爆(用户反馈"长度: 2249942"刷屏),
        //   日志体积本身就是负担。改为: 超 64KB 只打长度不打印全文, 且同类重复调用降噪。
        if (trimmed.length > 64 * 1024) {
            const sig = `${trimmed.length}`; // 同长度视为同一张图, 只警告一次
            if (!bigWarned.has(sig)) {
                bigWarned.add(sig);
                console.log(
                    `[urlToBase64] data: URI 直接返回 (长度: ${trimmed.length}, ` +
                    `${(trimmed.length / 1024 / 1024).toFixed(2)}MB) — 后续同尺寸 data URI 不再重复打印`,
                );
            }
        } else {
            console.log(`[urlToBase64] data: URI 直接返回 (长度: ${trimmed.length})`);
        }
        return trimmed;
    }
// 纯 base64 (不以 http 开头) → 补全为 Data URI
// 相对路径 (/api/files/download?path=xxx): 前端持久化的场景图/角色图常是相对路径,
// 不处理会被误判为"纯 base64"拼出非法 Data URI, 导致 Agnes 400 (2026-10-10 修复)
if (trimmed.startsWith('/')) {
  const m = trimmed.match(/[?&]path=([^&]+)/);
  if (m) {
    const real = decodeURIComponent(m[1]);
    if (real && fs.existsSync(real)) {
      const buf = fs.readFileSync(real);
      const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
      console.log(`[urlToBase64] 相对路径 → 本地文件 → Data URI (长度: ${dataUri.length})`);
      return dataUri;
    }
    console.warn(`[urlToBase64] 相对路径对应文件不存在: ${real}`);
  }
  throw new Error(`无法解析相对图片 URL "${trimmed.slice(0, 80)}" — 素材必须是公网 http(s) URL、/api/files 本地路径、或合法 Base64/Data URI`);
}
if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
  // 校验是否真的像 base64, 不像则立即报错, 不再盲目补前缀
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed) || trimmed.length < 64) {
    throw new Error(`image 既不是合法 URL/Base64/Data URI: "${trimmed.slice(0, 80)}"`);
  }
  const mime = trimmed.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  const dataUri = `data:${mime};base64,${trimmed}`;
console.log(`[urlToBase64] 纯 base64 → 补全 Data URI (长度: ${dataUri.length})`);
return dataUri;
}
  // 公网 URL — 如果是 localhost/内网 IP, 需要下载转 base64
  // 注意: 只检测 hostname 部分, 不检测 URL path 中的 /api/
  let isLocalhost = false;
  try {
    const urlObj = new URL(trimmed);
    const hostname = urlObj.hostname;
    isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.');
  } catch {
    isLocalhost = false; // 不是合法 URL, 当作 base64 处理
  }
  if (!isLocalhost) {
    console.log(`[urlToBase64] 公网 URL 直接返回: ${trimmed.slice(0, 80)}`);
    return trimmed; // 公网 URL 直接返回, Agnes API 可以访问
  }
  // localhost URL → 下载并转为完整 Data URI (Agnes API 要求 data:image/xxx;base64,...)
  try {
    console.log(`[urlToBase64] 下载 localhost URL: ${trimmed}`);
    const resp = await fetch(trimmed, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const ct = resp.headers.get('content-type') || 'image/png';
    const dataUri = `data:${ct};base64,${buf.toString('base64')}`;
    console.log(`[urlToBase64] 下载成功 → Data URI (长度: ${dataUri.length})`);
    return dataUri;
  } catch (e: any) {
    console.warn(`[urlToBase64] 下载本地图片失败: ${trimmed} — ${e.message}`);
    throw new Error(`本地图片下载失败 (${trimmed.slice(0, 80)}): ${e.message} — 素材必须是公网 URL 或可本地解析的文件`);
  }
}
