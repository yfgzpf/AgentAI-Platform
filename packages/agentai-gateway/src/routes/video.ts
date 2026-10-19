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
import { SUBMODEL_TO_GROUP_ENV } from '../factory-registry.js';
// 2026-10-13: 剧本生成改为「跟随所选对话模型」—— 走 llm-router (它知道每个 provider
// 的 baseURL / keyEnv / 模型名, 且自带重试/熔断)。原实现写死 agnes-2.5-flash 直连。
import { getAgentAIRouter } from '../llm-router.js';
// 2026-10-17: 剧本审核门 + 服装随剧情 —— 剧本 JSON 归一化与镜头级服装标注
// 的纯函数都在 video-script.ts (可单测, 不依赖 express/LLM)。
import {
  normalizeScript,
  normalizeStoryboardCostumes,
  mergeScriptCharacters,
  buildScriptForPrompt,
  buildScriptSystemPrompt,
  buildStoryboardFromScriptSystemPrompt,
  type ScriptDraft,
} from '../video-script.js';
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

// ===== 视频引擎目录 (单一真源) =====
// 供 POST /v1/video 的"未指定模型时自动选择"与 GET /v1/video/engines 共用。
//
// 2026-10-11: 新增 engines 自检端点的原因 —— 在它之前, 前端**没有任何途径**知道
// 哪个引擎配了 Key。用户选了「Agnes Video 2.5 正式版」或「Seedance 2.5」后必然
// 拿到 400, 观感就是"生成不成功", 却无从判断是自己选错还是系统坏了。
// 实测 (2026-10-11): AGNES_VIDEO_API_KEY / VOLCANO_API_KEY 均未配置 ——
// 4 个引擎里 2 个恒 400, 只有 cogvideo 与 agnes(免费档, 受 429 限流)可用。
const VIDEO_ENGINES: Array<{ name: string; label: string; env: string[]; priority: number }> = [
  // priority 越小越优先 —— 用于"未指定模型时"的自动选择 (2026-10-13)
  //
  // 为什么排这个顺序 (依据 2026-10-11 实测):
  //   cogvideo (智谱免费) 最稳 —— 实测 4 个引擎里只有它不带限流问题, 且复用已有的 ZHIPU_API_KEY。
  //   seedance 2.5 画质最好 (1080p), 但要独立的 VOLCANO_API_KEY。
  //   agnes 免费档易 429 (免费用户速率限制), 重试也救不回来 ⇒ 排在能用付费引擎之后。
  //   agnes-video-2.5 正式版功能最全 (图生视频/首尾帧/参考), 但同样限流, 排最后。
  { name: 'cogvideo', label: 'CogVideoX-Flash (智谱免费)', env: ['ZHIPU_API_KEY'], priority: 10 },
  { name: 'seedance-2.5', label: 'Seedance 2.5 (火山引擎)', env: ['VOLCANO_API_KEY'], priority: 20 },
  // ✅ 批次9.1 (2026-10-13) + 2026-10-20 修正: 工厂 Seedance 4 个变体入 engines 目录。
  // 之前 engines 只列 4 个内置引擎, 前端 VideoGen allModelOptions 查 engineStatus[m.value]
  // 永远 undefined → 工厂条目永不禁用 → 没配 FACTORY_VIDEO_KEY 也能点, 点了才 400。
  // ⚠️ 2026-10-20: name 必须与 modelStore.ts 工厂视频条目的 **id** 一致 (factory-seedance-*)!
  //   批次9.1 当时把 name 写成 doubao-seedance-*, 而前端 m.value = m.id = factory-seedance-*,
  //   查询键依然对不上 —— 那个"修复"实际没生效, 灰显逻辑到现在都是坏的。
  //   priority 21-24 排在火山 seedance (20) 之后、agnes (30) 之前 —— 工厂 = 火山同族但走中转,
  //   只有单独配了 FACTORY_VIDEO_KEY 时才可用, 不抢火山直连的顺序。
  { name: 'factory-seedance-2.5', label: 'Seedance 2.5 (工厂)', env: ['FACTORY_VIDEO_KEY'], priority: 21 },
  { name: 'factory-seedance-2', label: 'Seedance 2 (工厂)', env: ['FACTORY_VIDEO_KEY'], priority: 22 },
  { name: 'factory-seedance-2-fast', label: 'Seedance 2 Fast (工厂)', env: ['FACTORY_VIDEO_KEY'], priority: 23 },
  { name: 'factory-seedance-2-mini', label: 'Seedance 2 Mini (工厂)', env: ['FACTORY_VIDEO_KEY'], priority: 24 },
  { name: 'agnes', label: 'Agnes Video 2.5 Flash (免费)', env: ['AGENTAI_API_KEY', 'AGNES_API_KEY'], priority: 30 },
  { name: 'agnes-video-2.5', label: 'Agnes Video 2.5 正式版', env: ['AGNES_VIDEO_API_KEY'], priority: 40 },
];

/** 已配置 Key 的引擎, 按 priority 升序 (即"当前最该用的那个") */
function availableEnginesByPriority(): typeof VIDEO_ENGINES {
  return VIDEO_ENGINES.filter(engineAvailable).sort((a, b) => a.priority - b.priority);
}

/** 引擎是否已具备可用 Key (env 列表中任一为真即可) */
function engineAvailable(e: { env: string[] }): boolean {
  return e.env.some((k) => !!process.env[k]);
}

/**
 * Seedance 模型名归一化 (2026-10-20 P0 修复)
 * ==================================================================
 * 三套命名现实 (修复前互相对不上, 用户选工厂 seed 模型恒报"未知的视频模型"):
 *   ① 前端下拉 value  = modelStore 工厂条目 id      → factory-seedance-2.5
 *   ② engines 目录 name / modelStore models[0]      → doubao-seedance-2.5
 *   ③ 官方直连条目 id                                → seedance-2.5
 * 原提交端只认 ③ (startsWith('seedance')), ①②全掉 400。
 *
 * 统一归一成上游真实模型名 doubao-seedance-<variant>; 不是 seedance 返回 null。
 * variant 白名单与 factory-registry 的 Seedance 分组一致 (ALRO 只开放这 4 个)。
 */
export const SEEDANCE_VARIANTS = ['2.5', '2', '2-fast', '2-mini'] as const;

export function normalizeSeedanceModel(requested: string): string | null {
  const m = /^(?:factory-)?(?:doubao-)?seedance-(.+)$/.exec(String(requested || '').trim());
  if (!m) return null;
  const variant = m[1]!;
  if (!(SEEDANCE_VARIANTS as readonly string[]).includes(variant)) return null;
  return `doubao-seedance-${variant}`;
}

/**
 * 自定义模型 (BYOK) 凭证解析 —— 2026-10-13
 * ==================================================================
 * 修复前的断裂 (用户实机反馈"自定义模型填了 Key 却从不生效"):
 *   VideoGen.tsx 收集 apiKey → 存 localStorage → 唯一用它是浏览器内"测试连接";
 *   真实生成请求 videoTaskManager.ts 构造的 body 里**没有任何 key 字段**;
 *   后端把 `custom:` 前缀并入 agnes 分支, 只读 process.env.AGNES_VIDEO_API_KEY。
 *   ⇒ 收集了、验证通过了, 真正生成时用户的自定义 Key 从未参与过。
 *
 * 设计约束 (刻意为之, 别"优化"掉):
 *   ① Key **只存在于请求生命周期内**: 不写 .env、不进 config.json、不落任务存储文件。
 *      写盘就等于把用户自己的付费凭证复制到另一个文件, 且删除自定义模型时容易漏清。
 *   ② 响应与日志里一律不回显 Key。日志只打"用哪个 baseUrl / 有没有 key"。
 *   ③ baseUrl 必须显式校验协议与形态 —— 这是个由用户输入驱动的出网请求,
 *      不校验等于给本地服务开了任意 URL 探测的口子。
 *   ④ 回退到服务端 env: 用户没传 key 时行为与修复前完全一致 (读 AGNES_VIDEO_API_KEY),
 *      不因为新增分支而让原有可用路径失效。
 */
interface ByokCredentials {
  apiKey: string;
  /** 去掉末尾斜杠后的 baseUrl, 形如 https://host/v1 */
  baseUrl: string;
}

/** 允许的协议: 只放行 http/https, 挡掉 file:/gopher:/data: 等本地文件读取协议 */
function isAllowedUpstreamUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

/**
 * 从请求体解析 BYOK 凭证。
 * @returns 解析成功返回凭证; 未提供 key 时返回 null (调用方回退到 env);
 *          提供了但非法则抛错, 由上层转 400。
 */
function parseByokCredentials(body: any): ByokCredentials | null {
  const rawKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!rawKey) return null;
  if (rawKey.length > 512) {
    throw new Error('API Key 长度异常');
  }
  // baseUrl 缺省时沿用前端测试连接时的同一默认端点 (VideoGen.tsx:340)
  const rawBase = typeof body?.baseUrl === 'string' && body.baseUrl.trim()
    ? body.baseUrl.trim()
    : 'https://apihub.agnes-ai.cn/v1';
  if (!isAllowedUpstreamUrl(rawBase)) {
    throw new Error(`自定义模型的 baseUrl 非法 (只允许 http/https): ${rawBase.slice(0, 80)}`);
  }
  return { apiKey: rawKey, baseUrl: rawBase.replace(/\/+$/, '') };
}

/** 日志脱敏: 只说"用了自定义凭证", 绝不打 Key */
function logByokUse(baseUrl: string, hasKey: boolean) {
  console.log(`[video] ${hasKey ? '使用请求内自定义凭证' : '未收到自定义凭证, 回退服务端 env'} (baseUrl=${baseUrl})`);
}

/**
 * 剧本生成的 LLM 调用 —— 2026-10-13 新增「跟随所选模型」。
 *
 * 背景: /v1/video/storyboard 与 /v1/video/next-episode 原来写死 `agnes-2.5-flash`
 * + AGENTAI_API_KEY 直连 (见 git 历史), 用户无法用自己选的强模型生成剧本/对白。
 *
 * 现在: 前端把 GUI modelStore 里选中的对话模型以 `scriptProvider`(provider 名,
 * 如 agnes/deepseek/alrc) + `scriptModel`(子模型名, 如 agnes-3.0-flash) 传过来,
 * 交给 llm-router —— 它负责解析 baseURL / keyEnv / 模型名, 并带重试与熔断。
 * `modelLocked: true` 保证失败**不跨 provider 换模型**(用户选什么就用什么)。
 *
 * 未指定 scriptProvider(或旧客户端) → **保留原有 agnes-2.5-flash 直连** 作回落, 行为不变。
 *
 * @returns ok=true 时 content 是模型原始文本 (可能含 markdown 包裹), 由调用方清理/解析
 */
async function callScriptLLM(
  scriptProvider: string | undefined,
  scriptModel: string | undefined,
  systemPrompt: string,
  userContent: any,
  maxTokens: number,
  temperature: number,
): Promise<{ ok: boolean; content?: string; model?: string; status?: number; error?: string }> {
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // ---- 分支 A: 前端指定了模型 → 走 llm-router ----
  if (scriptProvider) {
    try {
      const router = getAgentAIRouter();
      const resp: any = await router.chat({
        model: scriptProvider,
        subModel: scriptModel,
        messages,
        maxTokens,
        temperature,
        modelLocked: true,
      } as any);
      const content = resp?.content;
      if (!content || typeof content !== 'string') {
        return { ok: false, status: 502, error: `剧本模型 ${scriptProvider}${scriptModel ? ':' + scriptModel : ''} 返回空内容` };
      }
      console.log(`[storyboard] 使用所选模型生成剧本: ${scriptProvider}${scriptModel ? ':' + scriptModel : ''}`);
      return { ok: true, content, model: `${scriptProvider}${scriptModel ? ':' + scriptModel : ''}` };
    } catch (e: any) {
      return { ok: false, status: 500, error: `剧本模型调用失败: ${e.message}` };
    }
  }

  // ---- 分支 B: 未指定模型 → 原 agnes-2.5-flash 直连 (向后兼容) ----
  const apiKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
  if (!apiKey) {
    return { ok: false, status: 400, error: '需要 AGENTAI_API_KEY 才能生成剧本 (或在前端指定 scriptProvider)' };
  }
  const postStoryboard = () => fetch('https://api.agnes-ai.cn/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'agnes-2.5-flash', messages, max_tokens: maxTokens, temperature }),
    signal: AbortSignal.timeout(60000),
  });
  // 429/503 = 速率限制/队列满: 指数退避重试 (2s/4s/8s), 最多 3 次
  let resp = await postStoryboard();
  for (let attempt = 0; (resp.status === 503 || resp.status === 429) && attempt < 3; attempt++) {
    const waitMs = Math.min(2000 * Math.pow(2, attempt), 8000);
    console.warn(`[storyboard] LLM ${resp.status} (429=速率限制/503=队列满), 第${attempt + 1}次重试, 等待 ${waitMs / 1000}s`);
    await new Promise((r) => setTimeout(r, waitMs));
    resp = await postStoryboard();
  }
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, error: `LLM 生成剧本失败: HTTP ${resp.status}: ${errText.slice(0, 200)}` };
  }
  const data: any = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  return { ok: true, content, model: 'agnes-2.5-flash' };
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
      // 2026-10-13: `custom:` 自定义模型分支拆出来, 真正使用请求内下发的 BYOK 凭证。
      //   原实现把 custom: 并入本分支, 无条件读 process.env.AGNES_VIDEO_API_KEY ——
      //   于是用户在 VideoGen 填的 Key 永远不参与生成 (前端也从未把它发过来, 见 parseByokCredentials 注释)。
      if (requested.startsWith('custom:')) {
        let byok: ByokCredentials | null = null;
        try {
          byok = parseByokCredentials(req.body);
        } catch (e: any) {
          return res.status(400).json({
            error: `自定义模型配置无效: ${e.message}`,
            requestedModel: requested,
          });
        }
        logByokUse(byok?.baseUrl || '(未提供)', !!byok);
        // 优先级: 请求内凭证 → 服务端 AGNES_VIDEO_API_KEY (行为与修复前一致)
        const key = byok?.apiKey || process.env['AGNES_VIDEO_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: '自定义模型未提供 API Key, 且服务端也未配置 AGNES_VIDEO_API_KEY 作为回退。'
              + '请在生视频页的「自定义模型」里填写 Key。',
            requiredEnv: 'AGNES_VIDEO_API_KEY',
            requestedModel: requested,
          });
        }
        const baseUrl = byok?.baseUrl || 'https://apihub.agnes-ai.cn/v1';
        return await submitAgnesVideo25(
          res, key, prompt, seconds, agnesSize, aspectRatio,
          image, end_frame, reqImages, reqAudios, baseUrl, !!byok,
        );
      }

      if (requested === 'agnes-video-2.5') {
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

      // ---- Seedance (火山引擎 / Alrc 工厂 二选一) ----
      // ✅ 2026-10-20 P0 修复: 原门槛 `requested.startsWith('seedance')` 只认官方条目 id
      //   (seedance-2.5), 而前端下拉实际传的是 modelStore 工厂条目 **id** (factory-seedance-2.5)
      //   或 engines 目录 name / models[0] (doubao-seedance-2.5) —— 两种都进不来,
      //   直接掉到 400「未知的视频模型」(用户实锤: 生视频选工厂 seed 模型即报错)。
      //   421-423 行旧注释声称"models[0] 与 requested 完全一致"是写错的: models[0] 是
      //   doubao-seedance-*, 同样过不了 startsWith('seedance')。
      //   现在三种前缀统一归一成 doubao-seedance-<variant>。
      const seedanceSubModel = normalizeSeedanceModel(requested);
      if (seedanceSubModel) {
        // ✅ 4 个 seedance 变体都支持走 Alrc 工厂 (FACTORY_VIDEO_KEY)。
        // 命中 SUBMODEL_TO_GROUP_ENV 且配了 FACTORY_VIDEO_KEY = 用户选了工厂视频密钥 → 走工厂;
        // 否则回退火山直连 (VOLCANO_API_KEY)。
        const isFactoryVideo = !!process.env['FACTORY_VIDEO_KEY'] && !!SUBMODEL_TO_GROUP_ENV[seedanceSubModel];
        if (isFactoryVideo) {
          const fKey = process.env['FACTORY_VIDEO_KEY']!.trim();
          console.log(`[video] 走 Alrc 工厂 seedance (${seedanceSubModel}) — FACTORY_VIDEO_KEY`);
          return await submitSeedanceViaFactory(res, fKey, seedanceSubModel, prompt, image);
        }
        const key = process.env['VOLCANO_API_KEY'];
        if (!key) {
          return res.status(400).json({
            error: `所选模型「${seedanceSubModel}」需要 FACTORY_VIDEO_KEY (Alrc 工厂) 或 VOLCANO_API_KEY (火山直连)，但未配置。`,
            requiredEnv: ['FACTORY_VIDEO_KEY', 'VOLCANO_API_KEY'],
            requestedModel: requested,
          });
        }
        return await submitSeedance(res, key, prompt, image);
      }

      // ---- 未指定 model: 按优先级自动选, 并如实告知用了哪个 ----
      if (!requested) {
        // 复用模块级 VIDEO_ENGINES —— 与 GET /v1/video/engines 同源, 避免两处漂移
        //
        // 2026-10-13 行为变更: 原实现是"只有唯一可用引擎才自动选, 否则报 400 让用户去选"。
        // 那样只要配了 2 个以上 Key 就永远拿不到 taskId, 而前端默认走 agnes 免费档又常撞 429,
        // 于是"不选模型"这个入口基本不可用。现在改成按优先级选最稳的那个, 并在响应头
        // 回传实际引擎名 —— "不静默换引擎"是底线, 但也不能因为选择困难就不给结果。
        const ranked = availableEnginesByPriority();
        const only = ranked[0];
        if (only) {
          console.log(`[video] 未指定模型 → 自动选择「${only.name}」(共 ${ranked.length} 个可用, 按优先级)`);
          res.setHeader('X-Video-Engine', only.name);
          if (only.name === 'agnes-video-2.5') {
            return await submitAgnesVideo25(res, process.env['AGNES_VIDEO_API_KEY']!, prompt, seconds, agnesSize, aspectRatio, image, end_frame, reqImages, reqAudios);
          }
          if (only.name === 'agnes') {
            return await submitAgnesFlash(res, process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY']!, prompt, seconds, aspectRatio, image, end_frame, reqImages, reqAudios);
          }
          if (only.name === 'cogvideo') {
            return await submitCogVideo(res, process.env['ZHIPU_API_KEY']!, prompt, image, end_frame);
          }
          if (only.name === 'seedance-2.5') {
            return await submitSeedance(res, process.env['VOLCANO_API_KEY']!, prompt, image);
          }
          // ✅ 2026-10-20: 工厂 seedance 自动选中 — engines name 与 modelStore 工厂条目 id
          // 一致 (factory-seedance-*), 经 normalizeSeedanceModel 归一成上游真实名提交。
          // 只有配了 FACTORY_VIDEO_KEY 才会被 engineAvailable 选到这里 (env 判定), 所以 ! 断言安全。
          const autoSubModel = normalizeSeedanceModel(only.name);
          if (autoSubModel) {
            const fKey = process.env['FACTORY_VIDEO_KEY']!.trim();
            return await submitSeedanceViaFactory(res, fKey, autoSubModel, prompt, image);
          }
        }
        return res.status(400).json({
          error: '未指定视频模型，且未检测到任何已配置 Key 的引擎。'
            + '请在设置页配置 ZHIPU_API_KEY(推荐, 免费稳定) / VOLCANO_API_KEY / AGENTAI_API_KEY 之一，'
            + '或在生视频页选用自定义模型并填写 Key。',
          requiredEnv: VIDEO_ENGINES.map((e) => e.env[0]),
          available: [],
        });
      }

      return res.status(400).json({
        error: `未知的视频模型: ${requested}。可用: agnes-video-2.5 / agnes / cogvideo / seedance-2.5`
          + ' / factory-seedance-2.5 / factory-seedance-2 / factory-seedance-2-fast / factory-seedance-2-mini',
        requestedModel: requested,
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // GET /v1/video/engines — 视频引擎可用性自检 (2026-10-11)
  //
  // 前端 VideoGen 据此**禁用**未配置 Key 的引擎, 从源头消除
  // "选了 agnes-video-2.5 才知道要另外配 Key → 生成不成功" 这一体验。
  //
  // ⚠️ 必须注册在 GET /v1/video/:taskId **之前**: 否则 Express 会把
  //    /v1/video/engines 匹配成 taskId='engines' 而吞掉本路由
  //    —— 与 /v1/video/query 被吞是同一类 bug。
  router.get('/v1/video/engines', (_req, res) => {
    return res.json({
      engines: VIDEO_ENGINES.map((e) => ({
        name: e.name,
        label: e.label,
        available: engineAvailable(e),
        requiredEnv: e.env,
      })),
    });
  });

  // GET /v1/video/:taskId — 查询任务状态
  router.get('/v1/video/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;
      const provider = req.query.provider as string || '';

      // ---- 自定义模型 (BYOK) 查询 ----
      // 2026-10-13: 提交时用的 Key 必须同样能用于查询, 否则任务提交成功却永远查不到结果。
      // Key 走 **请求头** 而非 query: query 会进浏览器历史 / 网关访问日志 / Referer 泄漏。
      // 同样只在本次请求内存活, 不落盘。
      if (provider.startsWith('custom:')) {
        const headerKey = (req.headers['x-video-api-key'] as string | undefined)?.trim() || '';
        const headerBase = (req.headers['x-video-base-url'] as string | undefined)?.trim() || '';
        const fallbackKey = process.env['AGNES_VIDEO_API_KEY'] || '';
        const key = headerKey || fallbackKey;
        if (!key) {
          return res.status(400).json({
            error: '自定义模型查询缺少 API Key (请通过 X-Video-Api-Key 请求头下发)。',
            requestedModel: provider,
          });
        }
        const baseUrl = (headerBase || 'https://apihub.agnes-ai.cn/v1').replace(/\/+$/, '');
        logByokUse(baseUrl, !!headerKey);
        return await queryAgnesVideo25(res, key, taskId, baseUrl);
      }

      // Agnes Video 2.5 正式版查询
      if (provider.startsWith('agnes-video-2.5') && !provider.includes('flash')) {
        const agnesVideoKey = process.env['AGNES_VIDEO_API_KEY'];
        if (agnesVideoKey) {
          return await queryAgnesVideo25(res, agnesVideoKey, taskId);
        }
      }

      // ✅ 批次9.1 (2026-10-13): Alrc 工厂 Seedance 任务查询 — 双端点兜底。
      // 提交走 {ALRC_BASE_URL}/chat/completions (batch9 已确认), 但 Alrc 官方未公开
      // "视频任务查询"的准确端点契约。源码推演两个候选:
      //   ① {base}/contents/generations/tasks/:id — 火山原生路径, 若 Alrc 做透明代理最可能命中;
      //   ② {base}/videos/:id — OpenAI 风格视频任务路径, 若 Alrc 走独立视频命名空间则在此。
      // 两个都查, 哪个先返回 200 且能解出 videoUrl 用哪个; 都失败才回落火山直连 (历史任务兼容)。
      // 不静默: 两个候选都 4xx/5xx 时打日志, 方便日后人工核对 Alrc 真实契约。
      if ((provider.startsWith('doubao-seedance') || provider.startsWith('factory-seedance') || provider.startsWith('seedance'))
        && process.env['FACTORY_VIDEO_KEY']) {
        const base = (process.env['ALRC_BASE_URL'] || 'https://alro.huazhiweilai.com/v1').replace(/\/+$/, '');
        const fKey = process.env['FACTORY_VIDEO_KEY'].trim();
        const candidates = [
          `${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
          `${base}/videos/${encodeURIComponent(taskId)}`,
        ];
        for (const url of candidates) {
          try {
            const resp = await fetch(url, {
              headers: { Authorization: `Bearer ${fKey}` },
              signal: AbortSignal.timeout(15000),
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const status = data.status || data.state || 'processing';
              const videoUrl = data.content?.video?.url || data.content?.video_url || data.video_url || data.url || data.data?.url || data.output?.url || null;
              const coverUrl = data.content?.video?.cover_image_url || data.cover_url || null;
              // 2026-10-14: 尾帧 — 之前这里完全不解析, 导致工厂 Seedance 任务的尾帧恒为空,
              // 分镜「尾帧衔接」每次都掉到 ffmpeg 兜底 (本机无 ffmpeg → 空转)。
              const lastFrameUrl = pickLastFrameUrl(data);
              // 能解出 url 或明确任务状态 → 命中, 直接返回
              if (videoUrl || status !== 'processing') {
                if (videoUrl && !lastFrameUrl) {
                  console.warn(`[video] seedance(工厂) 已出视频但未解析到尾帧, 响应顶层字段: ${Object.keys(data).join(',')}`);
                }
                return res.json({ status, videoUrl, coverUrl, lastFrameUrl, raw: JSON.stringify(data) });
              }
            }
          } catch {}
        }
        // 工厂两端点都没查到 → 不拦截, 继续走下面的火山直连兜底
      }

      // Seedance/火山引擎任务查询 (兼容 factory- 前缀形态)
      if (provider.startsWith('doubao-seedance') || provider.startsWith('factory-seedance') || provider.startsWith('seedance')) {
        const volcanoKey = process.env['VOLCANO_API_KEY'];
        if (volcanoKey) {
          try {
            const resp = await fetch(`https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`, {
              headers: { Authorization: `Bearer ${volcanoKey}` },
            });
            if (resp.ok) {
              const data: any = await resp.json();
              const status = data.status || data.state || 'processing';
              const videoUrl = data.content?.video?.url || data.content?.video_url || data.video_url || data.url || null;
              const coverUrl = data.content?.video?.cover_image_url || data.cover_url || null;
              // 2026-10-14: 同上 — 火山直连也补上尾帧解析 (提交时已带 return_last_frame: true)
              const lastFrameUrl = pickLastFrameUrl(data);
              if (videoUrl && !lastFrameUrl) {
                console.warn(`[video] seedance(火山) 已出视频但未解析到尾帧, 响应顶层字段: ${Object.keys(data).join(',')}`);
              }
              return res.json({ status, videoUrl, coverUrl, lastFrameUrl, raw: JSON.stringify(data) });
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
      const { videoUrl, originalPrompt, episodeIndex = 2, characters, storyContext, apiLastFrame, scriptProvider, scriptModel } = req.body;
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
      if (!apiKey && !scriptProvider) {
        // 无 API key 且未指定模型 — 降级: 简单续集提示词
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
7. 每镜标注 type(WS/MS/CU)、camera_motion、mood、characters、dialogue、monologue

【对白要求 — 必须充分输出】
- dialogue 字段填角色说出口的台词, 用双引号包裹 (如: 角色名: "台词")
- 有角色的镜头默认都要写对白 (纯环境空镜除外); 无对白填空字符串
- monologue 字段填内心独白/旁白 (不出声的心声), 用双引号包裹; 无则空字符串

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
        "dialogue": "角色名: \"台词内容\"",
        "monologue": "\"内心独白/旁白, 无则空字符串\""
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

      // 2026-10-13: 续集剧本同样「跟随所选模型」。callScriptLLM 内部:
      //   scriptProvider 有值 → 走 llm-router; 否则回落 agnes-2.5-flash 直连
      //   (后者已内含 429/503 指数退避重试, 与原来 callLlm 的行为一致)。
      const callEpisodeLlm = (frame: string | null) =>
        callScriptLLM(
          scriptProvider, scriptModel, systemPrompt,
          frame
            ? [{ type: 'text', text: framePrompt }, { type: 'image_url', image_url: { url: frame } }]
            : textPrompt,
          800, 0.8,
        );

      let effectiveFrame = tailFrameDataUri;
      let llmResult = await callEpisodeLlm(effectiveFrame);
      if (!llmResult.ok && (llmResult.status === 503 || llmResult.status === 429) && effectiveFrame) {
        // 429/503 重试耗尽 → 降级为纯文本模式(跳过尾帧), 不阻断流程
        console.warn(`[next-episode] ${llmResult.status} 重试耗尽, 降级为纯文本模式(跳过尾帧)`);
        effectiveFrame = null;
        llmResult = await callEpisodeLlm(null);
      }

      let episodeData: any = null;
      if (llmResult.ok) {
        let content = llmResult.content || '';
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

      // 兼容 VideoGen 前端契约: newPrompt 取第一镜 prompt (从尾帧自然过渡的一镜)
      const firstShotPrompt: string =
        (episodeData.episode?.shots?.[0]?.prompt as string | undefined) ||
        `续集 第${episodeIndex}集: ${originalPrompt.slice(0, 80)}...\n请延续上一段视频的内容和风格, 生成后续画面。`;

      return res.json({
        tailFrameUrl: tailFrameDataUri,
        episodeData,
        episodeIndex,
        newPrompt: firstShotPrompt,
        storySummary: (episodeData.episode?.title as string | undefined) || '',
        characters: episodeData.characters || characters || [],
        warning: effectiveFrame ? undefined : '未获取到尾帧 (ffmpeg 不可用或 503 降级)。AI 已基于剧情描述生成续集剧本。',
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /v1/video/script — 剧本生成 (审核门的第一步)
  // 输入: { prompt, episodeCount?, refImages?, scriptProvider?, scriptModel?,
  //         refine? } — refine = { instruction, script } 用于「继续优化」
  // 输出: { ok, script } — 逐集可读剧本 + 角色服装库 (outfits/defaultOutfitId)
  //
  // 为什么单独一步: 原实现一次 LLM 调用直接产出整部分镜, 用户没有可读、可改的
  // 剧本; 且服装只在角色 description 里写一次, 全剧一套。现在剧本先落成文本
  // 让用户审/改, 确认后 /v1/video/storyboard 只做镜头拆分 (见该路由)。
  // ════════════════════════════════════════════════════════════════════════
  router.post('/v1/video/script', async (req, res) => {
    try {
      const {
        prompt, episodeCount = 1, refImages = [], scriptProvider, scriptModel, refine,
      } = req.body;
      const refineInstruction = typeof refine?.instruction === 'string' ? refine.instruction.trim() : '';
      const isRefine = !!(refineInstruction && refine?.script && typeof refine.script === 'object');
      if (!isRefine && !prompt) return res.status(400).json({ error: 'prompt required' });

      const episodeTotal = Math.max(1, Math.min(20, parseInt(String(episodeCount), 10) || 1));
      const systemPrompt = buildScriptSystemPrompt({ episodeCount: episodeTotal });

      // 优化模式: 把当前剧本 + 用户要求一起发下去, 要求返回完整修订版
      let textPart: string;
      if (isRefine) {
        textPart = [
          '这是当前剧本 JSON:',
          JSON.stringify(refine.script).slice(0, 20000),
          '',
          `用户的优化要求: ${refineInstruction}`,
          '',
          '请按要求修改并返回**完整**剧本 JSON (不要只返回改动部分), 保持原有 schema。',
        ].join('\n');
      } else {
        textPart = String(prompt);
      }

      let userContent: any = textPart;
      if (!isRefine && Array.isArray(refImages) && refImages.length > 0) {
        userContent = [{ type: 'text', text: textPart }];
        for (const img of refImages.slice(0, 5)) {
          try {
            const url = await urlToBase64(String(img));
            userContent.push({ type: 'image_url', image_url: { url } });
          } catch (imgErr: any) {
            console.warn(`[script] 参考图解析失败, 跳过: ${imgErr.message?.slice(0, 100)}`);
          }
        }
      }

      const llmResult = await callScriptLLM(scriptProvider, scriptModel, systemPrompt, userContent, 6000, 0.8);
      if (!llmResult.ok) {
        return res.status(llmResult.status || 500).json({ error: llmResult.error });
      }

      let content = llmResult.content || '';
      content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return res.status(500).json({ error: 'LLM 返回的不是有效JSON', raw: content.slice(0, 500) });
        }
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return res.status(500).json({ error: 'LLM 返回的JSON无法解析', raw: content.slice(0, 500) });
        }
      }

      const script = normalizeScript(parsed);
      if (script.episodes.length === 0) {
        return res.status(502).json({ error: '剧本为空 — 模型没有产出台词/场景, 请重试或换更强的剧本模型' });
      }
      return res.json({ ok: true, script, model: llmResult.model });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // POST /v1/video/storyboard — 剧本分镜生成
  // 输入: { prompt, episodeCount, durationPerShot, refImages?,
  //         scriptProvider?, scriptModel?, script? } — 后两者=跟随 GUI 所选对话模型
  //         script = 已确认剧本 (有它时只做镜头拆分, 不得改剧情)
  // 输出: { title, episodes: [{ index, title, shots: [{ id, duration, prompt, ... }] }] }
  // ════════════════════════════════════════════════════════════════════════
  router.post('/v1/video/storyboard', async (req, res) => {
    try {
      const {
        prompt, episodeCount = 1, durationPerShot = '5', refImages = [],
        scriptProvider, scriptModel, script,
      } = req.body;
      // 已确认剧本 = 归一化后的只读快照; 缺它就是旧客户端/旧剧本, 走原有 prompt
      const approvedScript: ScriptDraft | null =
        script && typeof script === 'object' ? normalizeScript(script) : null;
      if (!prompt && !approvedScript) return res.status(400).json({ error: 'prompt required' });

      // 计算每集镜数: 总时长 / 单镜时长
      const shotDuration = parseInt(String(durationPerShot), 10) || 5;
      const targetMinutesPerEpisode = 0.5; // 每集约30秒
      const shotsPerEpisode = Math.max(2, Math.min(8, Math.ceil((targetMinutesPerEpisode * 60) / shotDuration)));
      const episodeTotal = approvedScript?.episodes.length
        ? approvedScript.episodes.length
        : Math.max(1, Math.min(20, parseInt(String(episodeCount), 10) || 1));

      // 构建多模态 LLM 消息 — 分析参考图 + 生成结构化剧本
      // 参考漫剧系统 FrameOS 的剧本生成规范: 视觉优先 + 角色一致 + 剧情连贯 + 对白精炼
      const systemPrompt = approvedScript
        // 已确认剧本 → 只拆分镜 (prompt 在 video-script.ts, 便于单测)
        ? buildStoryboardFromScriptSystemPrompt({
          shotDuration, shotsPerEpisode, episodeCount: episodeTotal,
        })
        : `你是一位专业的AI视频编剧导演。你需要根据用户的创意生成分集分镜剧本。

【剧本铁律 — 参考漫剧系统验证过的规范】
1. 视觉优先: 每镜描述具体的可拍摄动作 (如"走向窗边"而非"感到悲伤"); 内心活动**必须**写进 monologue 字段, 不要混进 prompt
2. 角色限制: 单镜最多3个角色同时出现
3. 动作可执行: 角色动作必须具体、可被视频模型理解 (如"走向窗边"而非"感到悲伤")
4. 对白精炼: 每句台词控制在15字以内, 对白要推动剧情而非闲聊
5. 环境具体化: 明确描述光线方向、色温、空间布局、关键道具
6. 情绪外化: 用表情和肢体动作传达情绪; 需要"内心戏"时写进 monologue 字段 (旁白/独白), 不要在 prompt 里写"内心感到..."
7. 每镜时长固定 ${shotDuration} 秒, 每集 ${shotsPerEpisode} 镜, 共 ${episodeTotal} 集
8. 每镜 prompt 必须是可直接发给视频模型的描述 (80-120字中文)
9. 跨集剧情要连贯: 上一集结尾自然过渡到下一集开头, 每集有起承转合

【角色一致性 — 跨集复用】
- 为每个主要角色创建角色卡: name(名字), description(外貌描述), refImageIndex(参考图索引)
- description 只写外貌: 年龄/性别/发型(颜色+长度+样式)/体型/标志特征, **不要**把服装写进 description
- 跨镜头跨集复用同一角色描述, 保证角色视觉一致
- 角色出现在哪镜, 就在 characters 数组中列出其名字

【服装随剧情 — 每个角色一个服装库】
- 每个角色输出 outfits 数组 (2-4 套): { "id": "o1", "name": "日常装", "description": "颜色+款式+材质等可拍摄细节" }
- defaultOutfitId = 该角色**第一次出场**时穿的服装 id
- 只在换场(如从公司回家)/换日/身份职业变化/重要事件时新增服装; 同一场连续戏内不得换装
- 镜头级标注: 只有某角色本镜服装与上一镜**不同**时, 才写 "costume": { "角色名": "outfit_id" }
- 未换装的镜头**不要**写 costume 字段 (= 自动沿用上一镜); 集内第一镜不写 (= 用 defaultOutfitId)

【场景一致性 — 每集固定场景】
- 为每集创建场景卡: scene: { name: "场景名", description: "场景描述" }
- 场景描述要具体: 地点类型(室内/室外)+时间(白天/夜晚)+光线(柔和/强烈)+关键道具
- 同一场景跨集保持一致 (如"主角的卧室"在多集中描述相同)

【剧情发展 — 起承转合】
- 第1集: 介绍角色和背景, 设置冲突种子
- 中间集: 发展冲突, 角色关系变化, 新事件发生
- 最后集: 冲突解决或升级, 结局留有余味
- 每集内部也要有起承转合, 不是平铺直叙

【对白要求 — 必须充分输出, 这是音画同步的关键】
- dialogue 字段填入该镜中角色说出口的台词, **用双引号包裹内容** (如: 锦衣卫: "站住！")
- **凡是镜头里有角色的 (characters 非空), 默认就要写对白** —— 只有纯环境空镜 (无角色) 才允许留空
- 对白要自然、口语化, 符合角色性格, 推动剧情而非闲聊
- 每句不超过15字, 一镜最多2-3句对白; 多句用换行分隔
- 无对白的镜头填空字符串

【内心独白 / 旁白】
- monologue 字段填入该镜的内心独白或旁白 (角色未出声的心声, 或第三人称旁白)
- 用于表达人物的心理活动、悬念铺垫; **不要**与 dialogue 重复同一句话
- 同样用双引号包裹; 没有则填空字符串

【镜头语言】
- type: WS(远景/全景)/MS(中景)/CU(特写)/ECU(大特写)
- camera_motion: 推(push in)/拉(pull out)/摇(pan)/移(tracking)/跟(follow)/固定(static)/航拍(aerial)
- mood: 情绪氛围 (mysterious/tense/warm/sad/exciting/peaceful等)

【输出JSON格式】
{
  "title": "剧集标题",
  "characters": [
    { "name": "角色名", "description": "极其具体的外貌描述(不含服装)", "refImageIndex": 0,
      "outfits": [
        { "id": "o1", "name": "日常装", "description": "深蓝牛仔裤 + 白色宽松衬衫" },
        { "id": "o2", "name": "正装", "description": "黑色修身西装 + 白衬衫" }
      ],
      "defaultOutfitId": "o1" }
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
          "dialogue": "角色名: \"台词内容\"",
          "monologue": "\"内心独白或旁白, 无则空字符串\"",
          "costume": { "角色名1": "o2" }
        }
      ]
    }
  ]
}

只输出JSON, 不要加任何说明文字或markdown标记。`;

      // 构建用户消息 — 有参考图用多模态
      // 已确认剧本: 把剧本原文塞进去, 明确"只拆分镜"; 否则沿用原始创意描述
      const userText = approvedScript
        ? `下面是一份已确认的剧本, 请按规则拆分镜 (不得改动剧情 / 人名 / 对白 / 服装表):\n\n${buildScriptForPrompt(approvedScript)}`
        : String(prompt);
      const userContent: any[] = [{ type: 'text', text: userText }];
      for (const img of refImages.slice(0, 5)) {
        // 已是 Data URI 或 http URL → 直接使用; 纯 base64 → 补全前缀
        // 修复: 之前漏判 data: 前缀, 导致 data:image/png;base64,data:image/png;base64,... 非法格式 ("图送形式错误")
        try {
          const url = await urlToBase64(String(img));
          userContent.push({ type: 'image_url', image_url: { url } });
        } catch (imgErr: any) {
          // 单张图解析失败 → 跳过该图并警告, 不让整个 storyboard 请求 500
          console.warn(`[storyboard] 参考图解析失败, 跳过: ${imgErr.message?.slice(0, 100)}`);
        }
      }

      // 2026-10-13: 剧本生成改为「跟随所选模型」——见 callScriptLLM 注释。
      // 未传 scriptProvider 时行为与原实现完全一致 (agnes-2.5-flash 直连 + 429/503 重试)。
      const llmResult = await callScriptLLM(scriptProvider, scriptModel, systemPrompt, userContent, 4000, 0.8);
      if (!llmResult.ok) {
        return res.status(llmResult.status || 500).json({ error: llmResult.error });
      }

      let content = llmResult.content || '';
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

      // 2026-10-17: 服装随剧情归一化 ——
      // ① 角色表以已确认剧本为准 (服装库/外貌), 分镜自己多出来的角色保留;
      // ② 镜头级 costume 值统一映射成 outfit id, 认不出的丢弃 = 继承上一镜。
      if (storyboard) {
        storyboard.characters = mergeScriptCharacters(storyboard.characters, approvedScript);
        if (approvedScript && !storyboard.title) storyboard.title = approvedScript.title;
        normalizeStoryboardCostumes(storyboard, approvedScript);
      }

      res.json({ ok: true, storyboard, script: approvedScript || undefined });
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

/**
 * Seedance 2.5 (火山引擎直连) — 历史行为, 保持向后兼容。
 * ✅ 批次9 (2026-10-13): 新增 submitSeedanceViaFactory, 走 Alrc 工厂 (FACTORY_VIDEO_KEY),
 * 支持 4 个 subModel 变体 (doubao-seedance-2 / -fast / -mini / 2.5)。
 * 用户在中转平台用哪种 subModel, 就发哪个; 不再硬编码 2.5。
 */
async function submitSeedance(
  res: any,
  key: string,
  prompt: string,
  image?: string,
) {
  return submitSeedanceVariant(res, key, 'doubao-seedance-2.5', prompt, image,
    'https://ark.cn-beijing.volces.com/api/v3', 'VOLCANO_API_KEY');
}

/** 走 Alrc 工厂的中转 (FACTORY_VIDEO_KEY) — 批次9。
 *  2026-10-13 三次修正: 用户实测报错 model_not_found 暴露两点:
 *   1. Alrc 视频**和文本模型走同一个 /chat/completions 端点** (Base URL =
 *      ALRC_BASE_URL, 缺省 https://alro.huazhiweilai.com/v1), 不是独立 /videos。
 *      之前 POST {base}/videos 命不中 → 改为发 {base}/chat/completions,
 *      body 用火山 Seedance 的 content:[{type:'text'},{type:'image_url'}] 结构,
 *      模型名直接发工厂模型名 (doubao-seedance-2 / -fast / -mini / 2.5)。
 *   2. Alrc 的 Seedance 分组只开放了 4 个 (2 / -fast / -mini / 2.5),
 *      旧的 1.0-lite / 1.0-pro / 2.0 不在组里 → factory-registry 已删这 3 条。
 *  提交后任务式轮询: 用同一 key+base 查 {base}/contents/generations/tasks/:id
 *  (Alrc 对火山视频任务做了透明代理, 任务 id 由火山返回)。 */
async function submitSeedanceViaFactory(
  res: any,
  key: string,
  subModel: string,
  prompt: string,
  image?: string,
) {
  const base = (process.env['ALRC_BASE_URL'] || 'https://alro.huazhiweilai.com/v1').replace(/\/+$/, '');
  // 火山 Seedance 内容结构 (与直连火山 submitSeedance 完全一致), 只换上游 base+key。
  const volBody: any = {
    model: subModel,
    content: [{ type: 'text', text: prompt }],
    // 2026-10-14: 主动索要尾帧 — 火山 Seedance 的文档参数 (默认 false)。
    // 工厂是 OpenAI 兼容中转, 多余字段通常被忽略/透传; 若上游本就默认返回尾帧, 此参数无副作用。
    return_last_frame: true,
  };
  if (image) {
    const imgData = await urlToBase64(image);
    volBody.content.push({ type: 'image_url', image_url: { url: imgData } });
  }
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(volBody),
      signal: AbortSignal.timeout(30000),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (resp.ok) {
      // 火山视频任务响应可能直接给 taskId / video_url, 两种都接
      const taskId = data.id || data.task_id || data.video_id;
      const videoUrl = data.data?.url || data.output?.url || data.video_url || data.url || null;
      if (taskId && !videoUrl) {
        res.json({ taskId, status: 'queued', provider: subModel, prompt, factory: true });
        return;
      }
      res.json({ taskId: taskId || null, status: videoUrl ? 'completed' : 'queued', videoUrl, provider: subModel, prompt, factory: true });
      return;
    }
    const errText = await resp.text().catch(() => '');
    // 2026-10-20: ALRO 分组 403 透传可操作指引 (与 llm-router 的 chat 链路同款)。
    // 旧令牌只挂部分分组时, 工厂视频调用静默 403, 用户只看到一句英文原文, 无从下手。
    if (resp.status === 403) {
      const gm = errText.match(/无权访问[：:\s]*([\s\S]*?)\s*分组/);
      if (gm) {
        const groupName = gm[1]!.replace(/\s+/g, '');
        return res.status(403).json({
          error: `ALRO 令牌无权访问「${groupName}」分组 (model=${subModel})。`
            + '这不是代码问题 —— 请到 ALRO 令牌管理重新生成「全权限」令牌 (勾选全部分组), '
            + '填入 .env 的 ALRC_API_KEY 即可 (网关自动回退主令牌), 或补齐 FACTORY_VIDEO_KEY。',
        });
      }
    }
    res.status(resp.status || 502).json({
      error: `Alrc 工厂视频返回 HTTP ${resp.status}: ${errText.slice(0, 200)}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: `Alrc 工厂视频请求失败: ${e.message}` });
  }
}

/** Seedance 提交/查询的共用实现 (参数化 subModel + 上游 base + 密钥来源, 避免 4 份重复) */
async function submitSeedanceVariant(
  res: any,
  key: string,
  volModel: string,
  prompt: string,
  image: string | undefined,
  upstreamBase: string,
  keyLabel: string,
): Promise<void> {
  const volBody: any = {
    model: volModel,
    content: [{ type: 'text', text: prompt }],
    // 2026-10-14: 火山 Seedance 文档参数 — 让它把生成视频的最后一帧一并返回
    // (查询结果的 content.last_frame_url)。不传则默认 false, 尾帧恒缺 → 分镜接戏空转。
    return_last_frame: true,
  };
  if (image) {
    const imgData = await urlToBase64(image);
    volBody.content.push({ type: 'image_url', image_url: { url: imgData } });
  }
  try {
    const resp = await fetch(`${upstreamBase}/contents/generations/tasks`, {
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
      error: `${keyLabel} 视频引擎返回 HTTP ${resp.status}: ${errText.slice(0, 200)}`,
    });
  } catch (e: any) {
    res.status(500).json({ error: `Seedance 请求失败: ${e.message}` });
  }
}

// ===== Agnes Video 2.5 正式版 =====
async function submitAgnesVideo25(
  res: any, apiKey: string, prompt: string, seconds: string, size: string, aspectRatio: string,
  image?: string, endFrame?: string, images?: string[], audios?: string[],
  baseUrl: string = 'https://apihub.agnes-ai.cn/v1',
  /** 自定义(BYOK)模型: 不允许降级到服务端 Flash —— 用户的 Key 只对自己的上游有效 */
  isByok: boolean = false,
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
    const resp = await fetch(`${baseUrl.replace(/\/+$/, '')}/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      // BYOK: 用户给的是他自己上游的 Key, 服务端 Flash 的 Key 对那个上游无效,
      //   降级只会把"Key 无效"变成"看起来生成了别的东西", 必须如实报错。
      if (isByok) {
        console.warn(`[video][byok] 上游返回 ${resp.status}, 不降级 (BYOK 凭证不属于服务端引擎)`);
        return res.status(resp.status).json({
          error: `自定义模型上游返回 HTTP ${resp.status}: ${errText.slice(0, 300)}`,
          hint: '请在生视频页「自定义模型」里确认 baseUrl 与 Key 是否匹配该供应商。',
          requestedModel: 'custom',
        });
      }
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
    if (isByok) {
      // 同上: BYOK 不降级, 网络错误如实上报
      return res.status(502).json({
        error: `自定义模型请求失败: ${e.message}`,
        hint: '请确认 baseUrl 可达、网络通畅。',
        requestedModel: 'custom',
      });
    }
    // 网络错误 → 降级到 Flash
    const flashKey = process.env['AGENTAI_API_KEY'] || process.env['AGNES_API_KEY'];
    if (flashKey) {
      return submitAgnesFlash(res, flashKey, prompt, seconds, aspectRatio, image, endFrame, images, audios);
    }
    return res.status(500).json({ error: e.message });
  }
}

async function queryAgnesVideo25(
  res: any, apiKey: string, videoId: string,
  baseUrl: string = 'https://apihub.agnes-ai.cn/v1',
) {
  try {
    const root = baseUrl.replace(/\/+$/, '');
    const resp = await fetch(`${root}/agnesapi?video_id=${videoId}&model_name=agnes-video-2.5`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return res.status(resp.status).json({ error: `HTTP ${resp.status}` });
    const data: any = await resp.json();
    const status = data.status || data.state || 'processing';
    const videoUrl = data.video_url || data.url || data.video?.url || data.output?.[0]?.url || data.result?.video_url || null;
    const coverUrl = data.cover_url || data.poster || data.cover || data.video?.cover_url || null;
    // P0: 提取 API 返回的尾帧 URL (统一走 pickLastFrameUrl — 兼容各上游字段名)
    const lastFrameUrl = pickLastFrameUrl(data);
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
    // P0: 提取 API 返回的尾帧 URL (统一走 pickLastFrameUrl — 兼容各上游字段名)
    const lastFrameUrl = pickLastFrameUrl(data);
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

// ===== 辅助: 从视频任务响应里取「尾帧」URL =====
//
// 2026-10-14: 各上游的尾帧字段名不统一 (Agnes 用 last_frame, 火山 Seedance 文档用
// content.last_frame_url, 中转可能原样透传也可能改名), 且无法在本机核实准确契约
// (火山文档是 JS 渲染, 抓不到正文)。故做"广撒网"式容错解析 —— 命中任一即返回。
// ⚠️ 这是容错, 不是已确认契约: 若长期取不到, 看查询分支里的自诊断 warn
//    (只打印响应**顶层字段名**, 不含值/凭据), 据此钉死真名。
function pickLastFrameUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  const cands = [
    data.content?.last_frame_url,
    data.content?.video?.last_frame_url,
    data.last_frame_url,
    data.last_frame,
    data.content?.last_frame,
    data.data?.last_frame_url,
    data.data?.last_frame,
    data.output?.last_frame_url,
    data.output?.last_frame,
    data.result?.last_frame_url,
    data.result?.last_frame,
  ];
  for (const c of cands) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
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
// 导出给 tools.ts 的 generate_video 复用 (P0: 之前 tools.ts 有独立的盲目拼 Data URI 逻辑,
// 分镜→视频走工具路径时相对路径/base64 校验缺失, 复现 400 错误; 2026-10-11 统一到这里)
export async function urlToBase64(url: string): Promise<string> {
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
