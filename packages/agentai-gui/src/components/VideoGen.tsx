/**
 * VideoGen - AI 视频生成面板
 * 引擎: CogVideoX-Flash (智谱免费) 优先 / Agnes Video V2.0 降级
 * 共用: ZHIPU_API_KEY (文本/生图/生视频同一 key)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Card, Space, Tag, Alert, Spin, message, Progress, Select, Modal, Checkbox, Tooltip } from 'antd';
import { VideoCameraOutlined, DownloadOutlined, HistoryOutlined, DeleteOutlined, PlusOutlined, BulbOutlined, UploadOutlined, PlayCircleOutlined, RedoOutlined, CopyOutlined, EditOutlined, CloseOutlined, ForwardOutlined, CheckCircleOutlined, VideoCameraAddOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { StoryboardPanel } from './StoryboardPanel';
import { useModelStore } from '../store/modelStore';
import { videoTaskManager, type VideoTask } from '../services/videoTaskManager';
import { apiPost } from '../services/api';
import { useResizable } from '../hooks/useResizable';
import { PaneGrip } from './PaneGrip';

const PRESETS = [
  { label: '风景', prompt: 'A cinematic sunset over a misty mountain valley, soft golden light', category: '自然' },
  { label: '动物', prompt: 'A cute orange cat playing in a cozy living room, natural lighting', category: '自然' },
  { label: '海洋', prompt: 'Aerial view of ocean waves crashing on a sandy beach at golden hour', category: '自然' },
  { label: '植物', prompt: 'Cherry blossom tree blooming, soft pink petals falling in the wind', category: '自然' },
  { label: '烟花', prompt: 'fireworks display, night sky, colorful explosions, slow motion, festive', category: '自然' },
  { label: '极光', prompt: 'aurora borealis, northern lights, green purple sky, arctic landscape, smooth motion', category: '自然' },
  { label: '水下', prompt: 'underwater scene, coral reef, fish swimming, sunlight rays through water', category: '自然' },
  { label: '星空', prompt: 'time-lapse of starry night sky, milky way, rotating stars, astrophotography', category: '自然' },
  { label: '城市', prompt: 'Cyberpunk city street at night, rain-soaked neon reflections', category: '人文' },
  { label: '科幻', prompt: 'A spaceship flying through colorful nebula in deep space', category: '人文' },
  { label: '电影感', prompt: 'Cinematic shot, shallow depth of field, anamorphic lens, film grain', category: '人文' },
  { label: '建筑漫游', prompt: 'Architectural visualization, modern building, smooth walkthrough', category: '人文' },
  { label: '美食', prompt: 'delicious food cooking, close-up, steam rising, cinematic food photography, slow motion', category: '人文' },
  { label: '时尚', prompt: 'fashion runway, elegant model, dynamic lighting, high-end fashion photography', category: '人文' },
  { label: '运动', prompt: 'sports action, dynamic motion, slow motion, athletic performance, dramatic lighting', category: '人文' },
];

const DURATIONS = [
  { value: '4s', label: '4秒' },
  { value: '5s', label: '5秒' },
  { value: '6s', label: '6秒' },
  { value: '8s', label: '8秒' },
  { value: '10s', label: '10秒' },
  { value: '12s', label: '12秒 (最长)' },
];

const SIZES = [
  { value: '720P', label: '720P' },
  { value: '1080P', label: '1080P' },
];

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
];

/** 模型能力配置表 — 切换模型时自动调整 UI */
interface ModelCapabilities {
  maxSeconds: number;        // 最大时长 (秒)
  sizes: string[];           // 支持的分辨率
  fixedSize?: string;        // 固定分辨率 (Flash)
  maxRefImages: number;      // 最大参考图数量
  maxRefAudios: number;      // 最大参考音频数量
  supportsKeyframe: boolean; // 是否支持首尾帧
  supportsFirstFrame: boolean; // 是否支持首帧图生视频
  seedSupported?: boolean;   // 是否支持 seed 参数
  /** 后端根本不发送 分辨率/宽高比/时长 三个参数 (2026-10-11)
   *  实测 `routes/video.ts:1281 submitCogVideo(res, key, prompt, image, endFrame)` —
   *  函数签名里没有 seconds/size/aspectRatio, body 只有 { model, prompt, [image_url], [end_image_url] }。
   *  即 cogvideo 引擎下 UI 上的「时长 / 宽高比」是**假的**: 点哪个值结果都一样。
   *  必须锁死控件并写明原因, 否则用户会以为是自己选错 → 反复重试同一个不生效的参数。 */
  ignoresParams?: boolean;
}

const MODEL_CAPS: Record<string, ModelCapabilities> = {
  'agnes-video-2.5': {
    maxSeconds: 12,
    sizes: ['720P', '1080P'],
    maxRefImages: 50,
    maxRefAudios: 10,
    supportsKeyframe: true,
    supportsFirstFrame: true,
  },
  'agnes': {
    maxSeconds: 12,
    sizes: ['720P'],
    fixedSize: '720P',
    maxRefImages: 5,
    maxRefAudios: 3,
    supportsKeyframe: true,
    supportsFirstFrame: true,
  },
  'seedance-2.5': {
    maxSeconds: 30,
    sizes: ['720P', '1080P'],
    maxRefImages: 50,
    maxRefAudios: 50,
    supportsKeyframe: false,
    supportsFirstFrame: true,
  },
  'cogvideo': {
    maxSeconds: 10,
    sizes: ['720P'],
    maxRefImages: 0,
    maxRefAudios: 0,
    supportsKeyframe: true,
    supportsFirstFrame: true,
    // 后端 submitCogVideo 不接收 seconds/size/aspectRatio —— 控件必须锁定
    ignoresParams: true,
  },
};

/** 获取当前模型能力, 未知模型用默认值 */
const getModelCaps = (model: string): ModelCapabilities => {
  if (MODEL_CAPS[model]) return MODEL_CAPS[model];
  // 自定义模型默认配置
  return {
    maxSeconds: 12,
    sizes: ['720P', '1080P'],
    maxRefImages: 5,
    maxRefAudios: 3,
    supportsKeyframe: true,
    supportsFirstFrame: true,
  };
};

const MODELS = [
    // 2026-10-13 顺序调整: 与 gateway VIDEO_ENGINES 的 priority 保持一致。
    // 原顺序把「Agnes Video 2.5 正式版」排第一并设为默认, 但实测 agnes 免费档易 429,
    // 正式版同样限流 ⇒ 默认值一进来就大概率失败。现默认改为 cogvideo (智谱免费, 实测最稳)。
    { value: 'cogvideo', label: 'CogVideoX-Flash (智谱免费)', desc: '实测最稳, 免费, 需 ZHIPU_API_KEY', priority: 10 },
    { value: 'seedance-2.5', label: 'Seedance 2.5 (火山引擎)', desc: '1080p 画质最好, 需 VOLCANO_API_KEY', priority: 20 },
    // ✅ 批次9 (2026-10-13): Alrc 工厂 Seedance 系列 4 个变体 (走 FACTORY_VIDEO_KEY)。
    // modelStore.ts 的 FACTORY_VIDEO_MODELS 已注册同 4 条; 这里加到 MODELS 是为了
    // "按引擎"选的入口也能直接看到 (videoModels filter 只挑 enabled 的, 默认全关)。
    { value: 'doubao-seedance-2.5', label: 'Seedance 2.5 (工厂)', desc: 'Alrc 中转 · 按秒计费, 需 FACTORY_VIDEO_KEY', priority: 21 },
    { value: 'doubao-seedance-2', label: 'Seedance 2 (工厂)', desc: 'Alrc 中转 · 1080p×5.1, 需 FACTORY_VIDEO_KEY', priority: 22 },
    { value: 'doubao-seedance-2-fast', label: 'Seedance 2 Fast (工厂)', desc: 'Alrc 中转 · 720p 快速, 需 FACTORY_VIDEO_KEY', priority: 23 },
    { value: 'doubao-seedance-2-mini', label: 'Seedance 2 Mini (工厂)', desc: 'Alrc 中转 · 480p 最省, 需 FACTORY_VIDEO_KEY', priority: 24 },
    { value: 'agnes', label: 'Agnes Video 2.5 Flash (免费)', desc: '免费档, 易 429 限流', priority: 30 },
    { value: 'agnes-video-2.5', label: 'Agnes Video 2.5 正式版', desc: '支持图生视频/首尾帧/参考, 需 AGNES_VIDEO_API_KEY', priority: 40 },
];

/** 默认引擎 (2026-10-13): 智谱 cogvideo —— 免费且实测无 429 */
const DEFAULT_VIDEO_MODEL = 'cogvideo';

/** 自定义模型配置 —— 定义与存取已抽到 services/customVideoModels (2026-10-13)
 *  抽出来的原因见该文件头: VideoGen 与 StoryboardPanel 各写一份提交逻辑,
 *  只改一处会导致分镜模式下 BYOK 静默失效。 */
import {
  type CustomVideoModel,
  getCustomModels,
  saveCustomModels,
  resolveByokCredential,
} from '../services/customVideoModels';

/**
 * 2026-10-05: 删除本地 `HistoryItem` 接口，统一使用 `VideoTask`
 * ==================================================================
 * 原来本文件同时存在两套类型:
 *   - 本地 `HistoryItem`: status = 'queued' | 'in_progress' | 'completed' | 'failed'
 *   - `videoTaskManager.VideoTask`: status = 'queued' | 'submitting' | 'polling' | 'completed' | 'failed'
 *                            且taskId: string | null（提交前为 null），另有 model/params
 *
 * 但 `history` / `current` 两个 state 实际声明的是 `VideoTask[]`，
 * 而 `pollTask()` 的参数与内部对象却是 `HistoryItem` →
 * tsc 报 TS2345 "HistoryItem is not assignable to VideoTask" × 6
 * 且 UI 层还在判`status === 'in_progress'`（VideoTask 里根本没这个值）→
 * 并行改动 VideoTask 定义时漏改了这里，渲染逻辑实际永不命中。
 *
 * 现在统一到 VideoTask，并把 UI 状态名对齐为 submitting / polling。
 */

//const HistoryItem 已移除 —— 统一用 VideoTask（见上方说明）

const STORAGE_KEY = 'agentai-video-history';

/** 控制面板的可拖拽范围 (2026-10-11) — 原为写死 420 */
const CTRL_PANE_MIN = 260;
const CTRL_PANE_MAX = 620;

export const VideoGen: React.FC = () => {
  const httpUrl = GATEWAY_HTTP;
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5s');
  const [videoSize, setVideoSize] = useState('720P');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [model, setModel] = useState(DEFAULT_VIDEO_MODEL); // 2026-10-13: 默认改 cogvideo (实测最稳), 原为 agnes 免费档 (易 429)
  const [busy, setBusy] = useState(false);
const [viewMode, setViewMode] = useState<'single' | 'storyboard'>('single');
  // ★ 四维润色
  const [dimensions, setDimensions] = useState<string[]>(['action', 'atmosphere', 'quality']);
  const [optimizing, setOptimizing] = useState(false);
  // P0: 历史记录从全局 taskManager 订阅 — 退出再进入不丢失
  const [history, setHistory] = useState<VideoTask[]>([]);
  const [current, setCurrent] = useState<VideoTask | null>(null);
  const [firstFrame, setFirstFrame] = useState<string>(''); // 首帧 base64
  const [lastFrame, setLastFrame] = useState<string>('');  // 尾帧 base64
  // P0 新增: 多图参考上传 (Agnes Video 2.5 Flash 支持最多5张参考图)
  const [refImages, setRefImages] = useState<string[]>([]); // 参考图 base64 数组
  const [refAudios, setRefAudios] = useState<string[]>([]); // 参考音频 base64 数组
  // 视频原型上传: 上传一段视频 → 自动提取首尾帧 → 作为 firstFrame/lastFrame
  const [uploadedVideoPath, setUploadedVideoPath] = useState<string>(''); // 后端保存的视频路径
  const [extractingFrames, setExtractingFrames] = useState(false); // 提取帧中
  const pollRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);
  const multiImgRef = useRef<HTMLInputElement>(null); // P0: 多图参考上传
  const audioRef = useRef<HTMLInputElement>(null);     // P0: 音频参考上传
  const videoUploadRef = useRef<HTMLInputElement>(null); // 视频原型上传

  // 自定义模型状态
  const [customModels, setCustomModels] = useState<CustomVideoModel[]>(getCustomModels());
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModel, setNewModel] = useState<Partial<CustomVideoModel>>({});
  const [editingModelId, setEditingModelId] = useState<string | null>(null); // P1: 编辑模式
  const [testingModel, setTestingModel] = useState<string | null>(null); // P1: 测试中

  // 引擎可用性自检 (GET /v1/video/engines) — 2026-10-11
  // 此前前端**无从知道**哪个引擎配了 Key: 用户选中 agnes-video-2.5 / seedance-2.5
  // 提交后必然 400「生成不成功」, 却无法判断是自己选错还是系统坏了。
  // 未拉到状态时(后端未启动)一律视为可用 —— 保持旧行为, 真实错误由提交阶段给出。
  const [engineStatus, setEngineStatus] = useState<Record<string, { available: boolean; requiredEnv: string[] }>>({});
  useEffect(() => {
    fetch(`${httpUrl}/v1/video/engines`)
      .then(r => r.json())
      .then((d: any) => {
        const m: Record<string, { available: boolean; requiredEnv: string[] }> = {};
        for (const e of d?.engines || []) m[e.name] = { available: !!e.available, requiredEnv: e.requiredEnv || [] };
        setEngineStatus(m);
      })
      .catch(() => { /* 后端不可达: 不拦截, 交给提交阶段报真实错误 */ });
  }, [httpUrl]);

  /** 引擎是否可用 (状态未加载时不阻止, 保持旧行为) */
  const isEngineAvailable = (name: string) => !engineStatus[name] || engineStatus[name].available;

  /** 该引擎忽略参数时的 Tag 样式 — 变暗 + 不可点 (CheckableTag 无 disabled prop) */
  const lockedTagStyle: React.CSSProperties = getModelCaps(model).ignoresParams
    ? { fontSize: 'var(--fs-micro)', opacity: 0.45, cursor: 'not-allowed', pointerEvents: 'none' }
    : { fontSize: 'var(--fs-micro)' };

  // 控制面板宽度 (2026-10-11): 原为写死 420, 用户无法调整
  const ctrlPane = useResizable({
    storageKey: 'agentai.videoGen.ctrlW',
    defaultWidth: 420,
    minWidth: CTRL_PANE_MIN,
    maxWidth: CTRL_PANE_MAX,
    side: 'right',
  });

  // 合并内置模型和自定义模型
  const videoModels = useModelStore.getState().models.filter(m => m.modelType === 'video' && m.enabled);
  const allModelOptions = [
    // 未配置 Key 的引擎直接禁用 —— 让用户在**选之前**就知道, 而不是提交后收 400
    ...MODELS.map(m => {
      const unavailable = !!engineStatus[m.value] && !engineStatus[m.value].available;
      return {
        value: m.value,
        label: unavailable ? `${m.label} — 未配置 Key` : m.label,
        disabled: unavailable,
      };
    }),
    ...videoModels.map(m => ({ value: m.id, label: `${m.label}${m.freeQuotaNote ? ' ' + m.freeQuotaNote : ''}` })),
    ...customModels.map(m => ({ value: `custom:${m.id}`, label: `🔑 ${m.name}`, isCustom: true })),
  ];

  /** 切换模型时自动调整参数 */
  const handleModelChange = (val: string) => {
    setModel(val);
    const caps = getModelCaps(val);
    // 固定分辨率
    if (caps.fixedSize) {
      setVideoSize(caps.fixedSize);
    }
    // 时长超出上限 → 截断
    const curSec = parseInt(duration.replace('s', ''), 10);
    if (curSec > caps.maxSeconds) {
      setDuration(caps.maxSeconds + 's');
    }
    // 分辨率不在支持列表 → 降级
    if (!caps.sizes.includes(videoSize)) {
      setVideoSize(caps.sizes[0]);
    }
    // 参考图超出上限 → 截断
    if (refImages.length > caps.maxRefImages) {
      setRefImages(prev => prev.slice(0, caps.maxRefImages));
    }
    if (refAudios.length > caps.maxRefAudios) {
      setRefAudios(prev => prev.slice(0, caps.maxRefAudios));
    }
  };

  /** 添加/编辑自定义模型 */
  const handleAddModel = () => {
    if (!newModel.name || !newModel.apiKey) {
      message.error('请填写模型名称和 API Key');
      return;
    }
    if (editingModelId) {
      // 编辑模式
      const updated = customModels.map(m =>
        m.id === editingModelId
          ? { ...m, name: newModel.name!, apiKey: newModel.apiKey!, baseUrl: newModel.baseUrl || '' }
          : m
      );
      setCustomModels(updated);
      saveCustomModels(updated);
      setEditingModelId(null);
      setNewModel({});
      setShowAddModel(false);
      message.success(`已更新模型: ${newModel.name}`);
    } else {
      // 新增模式
      const model: CustomVideoModel = {
        id: `custom-${Date.now()}`,
        name: newModel.name!,
        apiKey: newModel.apiKey!,
        baseUrl: newModel.baseUrl || '',
      };
      const updated = [...customModels, model];
      setCustomModels(updated);
      saveCustomModels(updated);
      setModel(`custom:${model.id}`);
      setNewModel({});
      setShowAddModel(false);
      message.success(`已添加视频模型: ${model.name}`);
    }
  };

  /** 编辑自定义模型 */
  const handleEditModel = (id: string) => {
    const m = customModels.find(m => m.id === id);
    if (!m) return;
    setNewModel({ name: m.name, apiKey: m.apiKey, baseUrl: m.baseUrl });
    setEditingModelId(id);
    setShowAddModel(true);
  };

  /** 测试自定义模型 */
  const handleTestModel = async (id: string) => {
    const m = customModels.find(m => m.id === id);
    if (!m) return;
    setTestingModel(id);
    try {
      const baseUrl = m.baseUrl || 'https://apihub.agnes-ai.cn/v1';
      const resp = await fetch(`${baseUrl}/videos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${m.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'agnes-video-2.5',
          prompt: 'test',
          seconds: '4',
          mode: 'text',
          size: '720P',
          aspect_ratio: '16:9',
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok || resp.status === 202) {
        message.success(`✅ ${m.name} 连接成功`);
      } else {
        const errText = await resp.text().catch(() => '');
        message.warning(`${m.name} 返回 ${resp.status}: ${errText.slice(0, 100)}`);
      }
    } catch (e: any) {
      message.error(`${m.name} 连接失败: ${e.message}`);
    } finally {
      setTestingModel(null);
    }
  };

  /** 删除自定义模型 */
  const handleDeleteModel = (id: string) => {
    const updated = customModels.filter(m => m.id !== id);
    setCustomModels(updated);
    saveCustomModels(updated);
    if (model.startsWith('custom:') && model === `custom:${id}`) {
      setModel('cogvideo');
    }
  };

  useEffect(() => {
    // 设置 httpUrl
    videoTaskManager.setHttpUrl(httpUrl);
    // 请求浏览器通知权限
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // P0: 订阅全局 taskManager — 退出再进入历史不丢失, 后台继续轮询
    const unsub = videoTaskManager.subscribe((tasks, active) => {
      setHistory(tasks);
      setCurrent(active);
      setBusy(!!active);
    });
    // ★ 读取跨页图片 (从 ImageStudio / 3D建模页 发送过来) — 作为参考图/首帧输入
    try {
      const crossImg = localStorage.getItem('agentai-video-refimg') || localStorage.getItem('agentai-video-firstframe');
      if (crossImg) {
        // 添加到参考图列表 (用户可自行决定是否设为首帧)
        setRefImages(prev => prev.includes(crossImg) ? prev : [...prev, crossImg]);
        localStorage.removeItem('agentai-video-refimg');
        localStorage.removeItem('agentai-video-firstframe');
        message.info('📸 已从图像工作室接收图片, 已添加为参考图');
      }
      // 2026-10-17: 3D 场景图链路 — 3D建模页 (Tripo 高斯场景) 发来的场景图,
      //   直接设首帧 (图生视频, 场景透视/光照锁定), 而不是堆进参考图列表。
      const sceneFrame = localStorage.getItem('agentai-video-sceneframe');
      if (sceneFrame) {
        setFirstFrame(sceneFrame);
        localStorage.removeItem('agentai-video-sceneframe');
        message.info('🧊 已接收 3D 场景图, 已设为视频首帧 (场景图生视频)');
      }
    } catch {}
    return () => { unsub(); };
  }, []);

  // P0 修复: history 变化时自动保存到 localStorage
  // 关键: 不要用 null URL 覆盖已有的有效 URL
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as VideoTask[];
      const savedMap = new Map(saved.map((s) => [s.id, s]));
      // 合并: 当前 history 优先, 但如果当前项 videoUrl 为 null 且 saved 有有效 URL, 保留 saved 的
      const merged = history.map(h => {
        const prev = savedMap.get(h.id);
        if (!h.videoUrl && prev?.videoUrl) {
          return { ...h, videoUrl: prev.videoUrl };
        }
        return h;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged.slice(0, 50)));
    } catch (e) {
      // localStorage 可能溢出 (视频URL很长), 尝试只保存前20条
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history.filter(h => h.videoUrl).slice(0, 20)));
      } catch { /* give up */ }
    }
  }, [history]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  /** ★ LLM 提示词优化 (接入真实 AI) */
  const optimizePrompt = async () => {
    if (!prompt.trim()) { message.warning('请先输入描述'); return; }
    setOptimizing(true);
    try {
      // 构建上下文: 四维润色选项
      const ctxParts: string[] = [];
      if (dimensions.includes('action')) ctxParts.push('动作增强');
      if (dimensions.includes('atmosphere')) ctxParts.push('氛围渲染');
      if (dimensions.includes('quality')) ctxParts.push('质量提升');
      if (dimensions.includes('style')) ctxParts.push('风格化');

      const data = await apiPost('/v1/prompt/optimize', {
        text: prompt,
        type: 'video',
        context: ctxParts.length > 0 ? `用户选择的增强维度: ${ctxParts.join(', ')}` : undefined,
      });

      if (data.ok && data.enhanced) {
        // 2026-10-06防"润色重复叠加"
        // 症状: 反复点「一键润色」，或 AI 生成过一轮后又点润色，
        //   setPrompt(enhanced) 把上一版结果当输入再润色一遍 → 层层叠加。
        //   用户看到的是同一段内容被复述 2~3 遍。
        //
        // 判定"输出只是把输入复述了一遍"：如果 enhanced 包含原 prompt，
        // 且新增内容不足原文的 30% → 视为无效润色，保留原文。
        const before = prompt.trim();
        const after = String(data.enhanced).trim();
        const grew = after.length - before.length;
        const merelyEchoes = after.includes(before) && grew < before.length * 0.3;
        if (merelyEchoes) {
          message.info('提示词已经比较完整, 未做改动（避免重复叠加润色）');
          return;
        }
        setPrompt(after);
        message.success(`✨ AI 已优化提示词（${before.length} → ${after.length} 字）`);
      } else {
        // 降级: 本地增强
        // 同样要防叠加：本地增强是纯字符串追加，重复点会无限增长
        const enhancers: string[] = [];
        let enhanced = prompt;
        // 先剥掉可能已追加过的英文增强片段，再重新加 —— 保证幂等
        enhanced = enhanced.replace(/,\s*(smooth natural motion[^\n]*|cinematic lighting[^\n]*|8k, ultra detailed[^\n]*|cinematic style[^\n]*)/gi, '');
        if (dimensions.includes('action')) { enhanced += ', smooth natural motion, dynamic movement, fluid animation'; enhancers.push('动作增强'); }
        if (dimensions.includes('atmosphere')) { enhanced += ', cinematic lighting, atmospheric depth, soft bokeh background'; enhancers.push('氛围渲染'); }
        if (dimensions.includes('quality')) { enhanced += ', 8k, ultra detailed, professional, high quality'; enhancers.push('质量提升'); }
        if (dimensions.includes('style')) { enhanced += ', cinematic style, film grain, anamorphic lens'; enhancers.push('风格化'); }
        setPrompt(enhanced);
        message.warning(`AI 优化失败, 已本地增强: ${enhancers.join(' · ')}`);
      }
    } catch (e: any) {
      console.error('[VideoGen] 优化失败:', e);
      message.error('优化失败: ' + (e?.message || '未知错误'));
    } finally {
      setOptimizing(false);
    }
  };

  /** ★ 重置全部 */
  const resetAll = () => {
    setPrompt('');
    setFirstFrame('');
    setLastFrame('');
    setUploadedVideoPath('');
    setCurrent(null);
    setBusy(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  /* 2026-10-11: 删除本地 `pollTask()` (86 行死代码)
   * ------------------------------------------------------------------
   * 它自引入起就没有任何调用点 —— 全文件仅剩上方 152 行的注释提到它。
   * 真正的轮询在 `services/videoTaskManager.ts`: 后台串行排队 + 持久化 +
   * 限流退避, 且**退出页面也不中断**; 本地 setInterval 版本全部不具备这些。
   * 保留它只会诱使后来者在这条死路径上改 bug (改完不生效)。
   * `pollRef` 仍被 unmount 清理与 resetAll 使用, 故保留。 */

  const submit = async (imageUrl?: string) => {
    if (!prompt.trim()) {
      message.warning('写个视频描述吧~');
      return;
    }
    // P0: 使用全局 taskManager — 后台轮询+排队+持久化
    const img = imageUrl || firstFrame;
    const modeLabel = lastFrame ? '[首尾帧]' : img ? '[图生视频]' : '';
    const fullPrompt = modeLabel ? `${modeLabel} ${prompt}` : prompt;
    // 2026-10-13 BYOK 真打通: 自定义模型的 Key 在这里随任务提交。
    // 原实现只在"测试连接"时用到 apiKey, 真实生成请求里根本没有它 ——
    // 于是用户在下面填的 Key 收集了、验证通过了, 生成时却从未参与。
    // 凭证解析走 services/customVideoModels (与 StoryboardPanel 共用同一份定义,
    // 避免只修一条提交路径、另一条静默失效)。
    const byok = resolveByokCredential(model);
    videoTaskManager.submitTask({
      prompt: fullPrompt,
      image: img || undefined,
      end_frame: lastFrame || undefined, // 尾帧传给后端
      images: refImages.length > 0 ? refImages : undefined,
      audios: refAudios.length > 0 ? refAudios : undefined,
      duration,
      model,
      size: videoSize,
      aspect_ratio: aspectRatio,
      ...(byok ? { byok } : {}),
    });
    message.info(`📨 任务已提交, 可继续操作其他内容, 完成后会通知`);
    // 清空输入 (保留提示词方便用户编辑)
    // setPrompt(''); // 不清空, 方便用户二次编辑
  };

  /** 上传视频做原型 — 自动保存 + 提取首尾帧 */
  const handleVideoUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      message.error('请上传视频文件');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      message.error('视频不能超过 100MB');
      return;
    }
    setExtractingFrames(true);
    message.loading({ content: '正在上传视频并提取帧...', key: 'vid-upload', duration: 0 });
    try {
      // 1. 上传文件到后端
      const formData = new FormData();
      formData.append('file', file);
      const uploadResp = await fetch(`${httpUrl}/v1/video/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!uploadResp.ok) {
        message.error({ content: '上传失败: HTTP ' + uploadResp.status, key: 'vid-upload' });
        setExtractingFrames(false);
        return;
      }
      const uploadData = await uploadResp.json();
      const videoPath = uploadData.path || uploadData.filePath || '';
      if (!videoPath) {
        message.error({ content: '上传成功但未返回路径', key: 'vid-upload' });
        setExtractingFrames(false);
        return;
      }
      setUploadedVideoPath(videoPath);

      // 2. 调用 extract-frames 提取首尾帧
      const frameResp = await fetch(`${httpUrl}/v1/video/extract-frames`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath }),
      });
      if (frameResp.ok) {
        const frameData = await frameResp.json();
        if (frameData.firstFrame) {
          setFirstFrame(frameData.firstFrame);
          message.success({ content: `✅ 视频已上传, 首帧已提取${frameData.lastFrame ? ' (尾帧也提取了)' : ''}`, key: 'vid-upload' });
          // 如果提取到尾帧, 自动设上
          if (frameData.lastFrame) {
            setLastFrame(frameData.lastFrame);
          }
          // 自动切换到支持首尾帧的模型
          // ⚠️ 必须检查引擎可用性: 原先无条件切到 agnes-video-2.5, 而该引擎要独立的
          //    AGNES_VIDEO_API_KEY —— 未配置时后端直接 400, 用户看到的"生成不成功"
          //    正是这次自动切换造成的。未配置就保持当前引擎: agnes/cogvideo 同样
          //    支持 keyframe 首尾帧, 只是参考图/音频上限更小。
          if ((model === 'cogvideo' || model === 'agnes') && isEngineAvailable('agnes-video-2.5')) {
            setModel('agnes-video-2.5');
          }
        } else {
          message.warning({ content: '首帧提取失败, 请手动上传图片', key: 'vid-upload' });
        }
      } else {
        message.warning({ content: '帧提取失败, 请手动上传图片作为首帧', key: 'vid-upload', duration: 5 });
      }
    } catch (e: any) {
      message.error({ content: '上传失败: ' + e.message, key: 'vid-upload' });
    } finally {
      setExtractingFrames(false);
    }
  };

// 2026-10-11: 高度从 `calc(100vh - 50px)` 改为 `100%`。
//  实测 (1280×720 活体 DOM): .app-titlebar=36px, .app-statusbar=24px
//  → 外壳实际吃掉 60px, 而这里只减 50px → 页面比 .app-content 高 10px,
//  永久多出一条滚动条。
//  更糟的是未激活时外面套了 FeatureGuide: 它有一条 ~41px 提示条 +
//  `flex:1` 内容区, 于是可用高度只剩 619px, 而页面仍按 670px 画 →
//  溢出 51px, 底部控件被裁掉。`100%` 在两个分支下都由 flex 给出确定高度
//  (直接父级是 .app-content 或 FeatureGuide 的 flex:1 体), 无需再猜 chrome 高度。
return (
<div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: 'var(--fg)' }}>
{/* 顶部 Tab 切换 — 2026-10-12 布局简化: 原为两个完全重复的内联 button
    (200 字符样式抄两遍 + 硬编码 #6366f1)。改为 map + .media-tab class。 */}
<div style={{ display: 'flex', gap: 0, flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
  {([
    { key: 'single', label: '单次生成', icon: <VideoCameraOutlined /> },
    { key: 'storyboard', label: '剧本分镜', icon: <BulbOutlined /> },
  ] as const).map(t => (
    <button key={t.key} onClick={() => setViewMode(t.key)}
      className={`media-tab${viewMode === t.key ? ' active' : ''}`}>
      {t.icon} {t.label}
    </button>
  ))}
</div>

{viewMode === 'storyboard' ? (
  /* 剧本分镜模式 — 全宽布局
     2026-10-12 修双层滚动容器: 外层原为 overflow:auto, 而 StoryboardPanel
     自身 height:100% + 内部 overflow:auto → 一屏两条滚动条。
     改为 hidden, 滚动完全交给 Panel 内部。
     2026-10-12 B-3: 补模型切换入口 — 原来该模式下左栏不可见, model 是 prop,
     用户想换模型必须切回 single tab 再切回来, 分镜状态虽在但操作断裂。 */
  <div style={{ flex: 1, overflow: 'hidden', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>生成模型</span>
      <Select size="small" value={model} onChange={handleModelChange} style={{ width: 220 }}
        popupMatchSelectWidth={false} getPopupContainer={() => document.body} options={allModelOptions} />
      <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>分镜的所有镜头都用这个模型生成</span>
    </div>
    <StoryboardPanel httpUrl={httpUrl} refImages={refImages} model={model} />
  </div>
) : (
  /* 单次生成模式 — 原有左右分栏 */
<div style={{ display: 'flex', gap: 12, flex: 1, overflow: 'hidden' }}>
{/* 左侧: 控制面板 — 宽度可拖拽 (2026-10-11)
 *  原为 `width: 420, flexShrink: 0` 写死; .app-content 在 1280 宽下只有 700px,
 *  于是预览区被挤到 ~268px 且用户无从调整。改走 useResizable (与外壳三栏同一套)。 */}
<div ref={ctrlPane.paneRef} className="page-pane page-pane--left" style={{ width: ctrlPane.width, gap: 8 }}>
      <PaneGrip resizable={ctrlPane} min={CTRL_PANE_MIN} max={CTRL_PANE_MAX} label="调整控制面板宽度" />
      {/* 内层滚动: 把手留在不滚动外层, 否则拖动时把手会随内容滚走 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
      <Card size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
        title={<Space><VideoCameraOutlined /> AI 生视频</Space>}
extra={<Select size="small" value={model} onChange={handleModelChange} style={{ width: 180 }} popupMatchSelectWidth={false} getPopupContainer={() => document.body} options={allModelOptions}
dropdownRender={(menu) => (<>{menu}<div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
<Button size="small" type="link" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setShowAddModel(true); setEditingModelId(null); setNewModel({}); }}>添加自定义</Button>
{customModels.length > 0 && <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4 }}>
<div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', padding: '2px 4px' }}>已添加的自定义模型:</div>
{customModels.map(m => (
<div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px' }}>
<span style={{ flex: 1, fontSize: 'var(--fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
<Button size="small" type="text" icon={<EditOutlined />} onClick={(e) => { e.stopPropagation(); handleEditModel(m.id); }} style={{ fontSize: 'var(--fs-micro)' }} />
<Button size="small" type="text" loading={testingModel === m.id} icon={<CheckCircleOutlined />} onClick={(e) => { e.stopPropagation(); handleTestModel(m.id); }} style={{ fontSize: 'var(--fs-micro)' }} />
<Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); handleDeleteModel(m.id); }} style={{ fontSize: 'var(--fs-micro)' }} />
</div>
))}
</div>}
</div></>)} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {/* 提示词输入 */}
<Input.TextArea value={prompt} onChange={(e) => setPrompt(e.target.value)}
placeholder="描述视频内容, 例: a cat walking on the beach at sunset, cinematic"
autoSize={{ minRows: 4, maxRows: 20 }} disabled={busy} style={{ flex: 1 }} />

          {/* 场景预设 */}
          <Select size="small" value={prompt && PRESETS.find(p => p.prompt === prompt)?.label || undefined}
            onChange={(val) => setPrompt(PRESETS.find(p => p.label === val)?.prompt || '')}
            placeholder="选择场景预设..." style={{ width: '100%' }} allowClear disabled={busy}
            options={PRESETS.map(p => ({ value: p.label, label: `${p.label} · ${p.category}` }))} />

          {/* 四维润色 */}
          <div style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg-2)' }}>提示词润色</span>
              <Button size="small" icon={<BulbOutlined />} loading={optimizing} onClick={optimizePrompt} disabled={!prompt.trim() || busy} style={{ borderRadius: 'var(--radius-md)' }}>{optimizing ? '润色中...' : '一键润色'}</Button>
            </div>
            <Checkbox.Group value={dimensions} onChange={(vals) => setDimensions(vals as string[])} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <Checkbox value="action" style={{ fontSize: 'var(--fs-micro)' }}>动作增强</Checkbox>
              <Checkbox value="atmosphere" style={{ fontSize: 'var(--fs-micro)' }}>氛围渲染</Checkbox>
              <Checkbox value="quality" style={{ fontSize: 'var(--fs-micro)' }}>质量提升</Checkbox>
              <Checkbox value="style" style={{ fontSize: 'var(--fs-micro)' }}>风格化</Checkbox>
            </Checkbox.Group>
          </div>

          {/* 时长选择 */}
          <div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>
              时长 {getModelCaps(model).maxSeconds > 12 && `(最长 ${getModelCaps(model).maxSeconds}秒)`}
              {/* cogvideo 后端不接收秒数 → 标出真实情况, 不要让用户以为能调 */}
              {getModelCaps(model).ignoresParams && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginLeft: 6 }}>由引擎决定 · 不可调</span>}
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {DURATIONS.filter(d => parseInt(d.value.replace('s', ''), 10) <= getModelCaps(model).maxSeconds).map(d => (
                <Tag.CheckableTag key={d.value} checked={duration === d.value} onChange={() => setDuration(d.value)} style={lockedTagStyle}>{d.label}</Tag.CheckableTag>
              ))}
              {/* Seedance 30秒选项 */}
              {getModelCaps(model).maxSeconds >= 15 &&
                [15, 20, 25, 30].filter(s => s <= getModelCaps(model).maxSeconds).map(s => (
                  <Tag.CheckableTag key={s + 's'} checked={duration === s + 's'} onChange={() => setDuration(s + 's')} style={lockedTagStyle}>{s}秒</Tag.CheckableTag>
                ))
              }
            </div>
          </div>

          {/* 尺寸 + 宽高比 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>分辨率</div>
              <Select size="small" value={videoSize} onChange={setVideoSize} style={{ width: '100%' }}
                disabled={!!getModelCaps(model).fixedSize || !!getModelCaps(model).ignoresParams}
                options={getModelCaps(model).sizes.map(s => ({ value: s, label: s }))} />
              {getModelCaps(model).fixedSize && <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>固定 {getModelCaps(model).fixedSize}</div>}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 4 }}>宽高比</div>
              <Select size="small" value={aspectRatio} onChange={setAspectRatio} style={{ width: '100%' }}
                disabled={!!getModelCaps(model).ignoresParams} options={ASPECT_RATIOS} />
            </div>
          </div>

          {/* 视频做原型: 上传一段视频 → 自动提取首尾帧 */}
          <div style={{ padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg-2)' }}><VideoCameraAddOutlined /> 视频做原型</span>
              {uploadedVideoPath && <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => { setUploadedVideoPath(''); setFirstFrame(''); setLastFrame(''); }} />}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="small"
                icon={<UploadOutlined />}
                loading={extractingFrames}
                onClick={() => videoUploadRef.current?.click()}
                disabled={busy || extractingFrames}
                style={{ flex: 1 }}
              >
                {uploadedVideoPath ? '换视频' : '上传视频做原型'}
              </Button>
            </div>
            {uploadedVideoPath && (
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4 }}>
                ✅ 已提取首尾帧, 将以视频画面为原型生成新视频
              </div>
            )}
            <input ref={videoUploadRef} type="file" accept="video/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (!f) return; handleVideoUpload(f); e.target.value = ''; }} />
          </div>

          {/* 首尾帧上传 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="small" icon={<UploadOutlined />} onClick={() => imgRef.current?.click()} disabled={busy}>{firstFrame ? '换首帧' : '上传首帧'}</Button>
            <Button size="small" icon={<UploadOutlined />} onClick={() => lastFrameRef.current?.click()} disabled={busy || !firstFrame}>{lastFrame ? '换尾帧' : '上传尾帧'}</Button>
            {(firstFrame || lastFrame) && <Button size="small" danger onClick={() => { setFirstFrame(''); setLastFrame(''); }}>清除</Button>}
            <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setFirstFrame(r.result as string); r.readAsDataURL(f); e.target.value = ''; }} />
            <input ref={lastFrameRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setLastFrame(r.result as string); r.readAsDataURL(f); e.target.value = ''; }} />
          </div>

          {/* 首尾帧预览 */}
          {firstFrame && (
            <div style={{ display: 'flex', gap: 8, padding: 6, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 2 }}>首帧</div>
                <img src={firstFrame} alt="首帧" style={{ width: 80, height: 48, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
              </div>
              {lastFrame && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginBottom: 2 }}>尾帧</div>
                  <img src={lastFrame} alt="尾帧" style={{ width: 80, height: 48, objectFit: 'cover', borderRadius: 'var(--radius-sm)' }} />
                </div>
              )}
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', flex: 1, display: 'flex', alignItems: 'center' }}>
                {lastFrame ? '首尾帧模式: 生成过渡视频' : '图生视频模式'}
              </div>
            </div>
          )}

          {/* 参考图/音频 — 根据模型能力显示 */}
          {(() => {
            const caps = getModelCaps(model);
            const showRef = caps.maxRefImages > 0 || caps.maxRefAudios > 0;
            if (!showRef && !model.startsWith('custom:')) return null;
            const maxImg = model.startsWith('custom:') ? 5 : caps.maxRefImages;
            const maxAud = model.startsWith('custom:') ? 3 : caps.maxRefAudios;
            return (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {maxImg > 0 && <Button size="small" icon={<UploadOutlined />} onClick={() => multiImgRef.current?.click()} disabled={busy || refImages.length >= maxImg}>参考图 ({refImages.length}/{maxImg})</Button>}
              {maxAud > 0 && <Button size="small" icon={<UploadOutlined />} onClick={() => audioRef.current?.click()} disabled={busy || refAudios.length >= maxAud}>参考音频 ({refAudios.length}/{maxAud})</Button>}
              {(refImages.length > 0 || refAudios.length > 0) && <Button size="small" danger onClick={() => { setRefImages([]); setRefAudios([]); }}>清除</Button>}
              {maxImg > 0 && <input ref={multiImgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files || []).slice(0, maxImg - refImages.length); files.forEach(f => { const r = new FileReader(); r.onload = () => setRefImages(prev => [...prev, r.result as string].slice(0, maxImg)); r.readAsDataURL(f); }); e.target.value = ''; }} />}
              {maxAud > 0 && <input ref={audioRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files || []).slice(0, maxAud - refAudios.length); files.forEach(f => { const r = new FileReader(); r.onload = () => setRefAudios(prev => [...prev, r.result as string].slice(0, maxAud)); r.readAsDataURL(f); }); e.target.value = ''; }} />}
            </div>
            );
          })()}

          {/* 参考图预览 */}
          {refImages.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {refImages.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img} alt={`ref${i}`} style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
                  <span onClick={() => setRefImages(prev => prev.filter((_, j) => j !== i))} style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--danger)', color: 'var(--fg-on-accent)', fontSize: 'var(--fs-micro)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>
              ))}
            </div>
          )}

          {/* 生成按钮 */}
          <div>
            <Space>
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} loading={busy} onClick={() => submit()} disabled={!prompt.trim() || busy}
                style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 'var(--radius-md)', padding: '0 28px', boxShadow: '0 4px 16px rgba(99,102,241,0.3)' }}>
                {busy ? '提交中...' : '生成视频'}
              </Button>
              <Button size="large" icon={<RedoOutlined />} onClick={resetAll} disabled={busy}>重置</Button>
            </Space>
          </div>

          {/* 填充: 模型信息 */}
          <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg-2)', marginBottom: 4 }}>当前引擎</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
              {model === 'agnes-video-2.5' && `Agnes Video 2.5 正式版 | ${videoSize} | ${aspectRatio} | ${duration} | 文生/图生/首尾帧/参考`}
              {model === 'agnes' && `Agnes Video 2.5 Flash | 720P (固定) | ${aspectRatio} | ${duration} | 文生/图生/首尾帧/参考 (图≤5/音≤3)`}
              {model === 'cogvideo' && 'CogVideoX-Flash — 智谱免费, 支持文生/图生/首尾帧'}
              {model === 'seedance-2.5' && `Seedance 2.5 | 火山引擎 | ${videoSize} | ${aspectRatio} | ${duration} | 文/图/音/视频 四模态 (素材≤50)`}
              {model.startsWith('custom:') && `自定义模型: ${customModels.find(m => 'custom:' + m.id === model)?.name || ''}`}
            </div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4 }}>
              {/* 时长参数对 cogvideo 无效, 不能拿它算预计耗时 — 那是假精度 */}
              {getModelCaps(model).ignoresParams
                ? '预计 2-4 分钟'
                : `预计 ${duration === '3s' ? '1-2 分钟' : duration === '5s' ? '2-3 分钟' : '3-5 分钟'}`}
            </div>
          </div>
        </div>
</Card>
      </div>{/* /内层滚动 */}
</div>

{/* 右侧: 结果展示 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minWidth: 0 }}>
      {/* 当前结果 */}
      {current && (
        <Card
          size="small"
          title={
            <Space>
              {current.status === 'completed' ? '已生成' : current.status === 'failed' ? '失败' : '生成中'}
              <Tag color={current.status === 'completed' ? 'green' : current.status === 'failed' ? 'red' : 'blue'}>
                {current.status}
              </Tag>
              {current.provider && <Tag>{current.provider}</Tag>}
            </Space>
          }
          extra={
            current.videoUrl && (
              <Button size="small" icon={<DownloadOutlined />} onClick={() => {
                const a = document.createElement('a');
                a.href = current.videoUrl!;
                a.download = `agentai-video-${current.id}.mp4`;
                a.click();
              }}>
                下载
              </Button>
            )
          }
        >
          {current.videoUrl ? (
            <div style={{ textAlign: 'center', background: 'var(--panel)', padding: 12, borderRadius: 'var(--radius-md)', animation: 'videoResultIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
              <video
                src={current.videoUrl}
                controls
                autoPlay
                loop
                style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 'var(--radius-sm)' }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <Progress percent={current.progress} status="active" style={{ maxWidth: 400, margin: '16px auto' }} />
              <div style={{ color: 'var(--muted)' }}>
                {current.status === 'queued' && '排队中...'}
                {current.status === 'polling' && 'AI 渲染中...'}
                {current.status === 'submitting' && '提交中...'}
              </div>
              {/* ★ 预估时间提示 */}
              {current.status === 'polling' && current.progress > 0 && current.progress < 100 && (
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4 }}>
                  预计还需约 {Math.max(5, Math.ceil((100 - current.progress) * 0.8))} 秒
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 'var(--fs-sm)' }}>
            {current.prompt} · {(current.taskId || 'pending').slice(0, 24)}...
          </div>
        </Card>
      )}

      {/* 历史 */}
      {history.length > 0 && (
        <Card
          size="small"
          style={{ marginTop: 0 }}
          title={<Space><HistoryOutlined />历史记录 ({history.length}) {videoTaskManager.getQueue().length > 0 && <Tag color="orange">排队 {videoTaskManager.getQueue().length}</Tag>}</Space>}
          extra={
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { videoTaskManager.clearAll(); }}>
              清空
            </Button>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {history.map(item => (
              <div
                key={item.id}
                style={{
                  position: 'relative',
                  border: current?.id === item.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: 'var(--bg)',
                }}
              >
                <div style={{ aspectRatio: '16/9', position: 'relative' }} onClick={() => setCurrent(item)}>
                  {item.videoUrl ? (
                    // 2026-10-12 性能修复: 历史缩略图加 preload="metadata"
                    // 此前默认 preload="auto", 一屏 30 个 <video> 会并发解码 → 浏览器卡死
                    <video src={item.videoUrl} controls muted preload="metadata"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', flexDirection: 'column', gap: 4 }}>
                      {item.status === 'queued' ? <Tag color="orange">排队中</Tag> : <Spin size="small" />}
                      <span style={{ fontSize: 'var(--fs-micro)' }}>{item.status === 'polling' ? '生成中...' : item.status === 'submitting' ? '提交中...' : '等待中'}</span>
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 4, right: 4 }}>
                    <Tag color={item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'blue'}>
                      {item.status === 'completed' ? '完成' : item.status === 'failed' ? '失败' : item.status === 'queued' ? '排队' : '生成中'}
                    </Tag>
                  </div>
                </div>
                {/* 操作栏 */}
                <div style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--fs-micro)', color: 'var(--fg-2)' }}>{item.prompt}</div>
                  <Tooltip title="复制提示词">
                    <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(item.params?.prompt || item.prompt); message.success('已复制提示词'); }} />
                  </Tooltip>
                  <Tooltip title="编辑提示词">
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setPrompt(item.params?.prompt || item.prompt); }} />
                  </Tooltip>
                  <Tooltip title="重新生成">
                    <Button size="small" type="text" icon={<RedoOutlined />} onClick={() => { videoTaskManager.regenerate(item.id); message.info('已重新提交'); }} />
                  </Tooltip>
                  {item.videoUrl && item.status === 'completed' && (
                    <Tooltip title="智能续集 — AI 分析尾帧, 生成下一集剧本">
                      <Button size="small" type="text" icon={<ForwardOutlined />} onClick={async () => {
                          // 智能续集: 提取尾帧 → 多模态 LLM 分析画面 → 生成新剧本
                          message.loading({ content: '🎬 正在分析尾帧并生成续集剧本...', key: 'seq-extract', duration: 0 });
                          try {
                            // P3: 从 episodeChain 获取故事上下文和角色
                            const chainContext = videoTaskManager.getChainContext(item.id);
                            const episodeIndex = chainContext.episodeIndex;
                            const knownCharacters = chainContext.characters;
                            const storyContext = chainContext.storyContext;

                            // P0: 优先使用 API 返回的尾帧 URL, 不需要 ffmpeg
                            const apiLastFrame = (item as any).lastFrameUrl || null;

                            const resp = await fetch(`${httpUrl}/v1/video/next-episode`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                videoUrl: item.videoUrl,
                                originalPrompt: item.params?.prompt || item.prompt,
                                episodeIndex,
                                characters: knownCharacters,
                                storyContext,
                                apiLastFrame, // 传给后端, 跳过 ffmpeg 提取
                              }),
                            });
                          if (resp.ok) {
                            const data = await resp.json();
                            if (data.newPrompt) {
                              // 自动填入新剧本
                              setPrompt(data.newPrompt);
                              setRefImages([]);
                              // 如果有尾帧, 自动设为首帧; 没有则提示用户手动上传
                              if (data.tailFrameUrl) {
                                setFirstFrame(data.tailFrameUrl);
                              } else {
                                setFirstFrame('');
                              }
                              // 保存角色信息到当前任务 (供下一集续集使用)
                              (item as any).characters = data.characters;
                              (item as any).storySummary = data.storySummary || '';
                              const warnMsg = data.warning ? ' ⚠️ ' + data.warning : '';
                              message.success({ content: `✅ 第${episodeIndex}集剧本已生成, 可编辑后点击生成${warnMsg}`, key: 'seq-extract', duration: 6 });
                            } else {
                              message.error({ content: '续集生成失败: 返回数据不完整', key: 'seq-extract' });
                            }
                          } else {
                            // 降级: 调用旧的 extract-tail 接口
                            message.loading({ content: '正在提取视频尾帧...', key: 'seq-extract', duration: 0 });
                            const fallbackResp = await fetch(`${httpUrl}/v1/video/extract-tail`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ videoUrl: item.videoUrl }),
                            });
                            if (fallbackResp.ok) {
                              const fallbackData = await fallbackResp.json();
                              if (fallbackData.tailFrameUrl) {
                                setPrompt('续集: ' + (item.params?.prompt || item.prompt).slice(0, 60) + '...\n请延续上一段视频的内容和风格, 生成后续画面。');
                                setFirstFrame(fallbackData.tailFrameUrl);
                                setRefImages([]);
                                // 同 extract-frames: 缺 AGNES_VIDEO_API_KEY 时不要切到正式版
                                if (isEngineAvailable('agnes-video-2.5')) setModel('agnes-video-2.5');
                                message.success({ content: '✅ 尾帧已提取 (降级模式), 请手动编辑提示词', key: 'seq-extract', duration: 4 });
                              } else {
                                // 2026-10-06: 不再只说"尾帧提取失败"。
                                // 后端现在返回可执行的原因（最常见是服务器缺 ffmpeg），
                                // 直接透出给用户，否则用户只能干瞪眼。
                                const reason = await fallbackResp.json()
                                  .then((d: any) => d.error || '')
                                  .catch(() => '');
                                message.error({
                                  content: `尾帧提取失败${reason ? '：' + reason : ''}`,
                                  key: 'seq-extract',
                                  duration: 8,
                                });
                              }
                            } else {
                              // 同上：把后端原因透出，而不是笼统提示"请手动截图"
                              let reason = '';
                              try {
                                const j = await resp.json();
                                reason = j.error || j.hint || '';
                              } catch { /* 解析失败用默认文案 */ }
                              message.warning({
                                content: reason
                                  ? `续集生成失败：${reason}`
                                  : '续集生成失败, 请手动截图视频最后一帧上传',
                                key: 'seq-extract',
                                duration: 10,
                              });
                            }
                          }
                        } catch (e: any) {
                          message.error({ content: '续集生成失败: ' + e.message, key: 'seq-extract' });
                        }
                      }} />
                    </Tooltip>
                  )}
                  {(item.status === 'queued' || item.status === 'polling' || item.status === 'submitting') && (
                    <Tooltip title="取消">
                      <Button size="small" type="text" danger icon={<CloseOutlined />} onClick={() => videoTaskManager.cancelTask(item.id)} />
                    </Tooltip>
                  )}
                  <Tooltip title="删除">
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => videoTaskManager.deleteTask(item.id)} />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!current && history.length === 0 && !busy && (
        <div style={{ textAlign: 'center', marginTop: 60 }}>
          <div style={{ marginBottom: 12, color: 'var(--muted)' }}><VideoCameraOutlined style={{ fontSize: 40 }} /></div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--fg)', marginBottom: 6 }}>
            AI 视频生成
          </div>
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--muted-2)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
            输入视频描述，选择场景预设，点击生成即可创建 AI 视频。支持文生视频 / 图生视频 / 首尾帧过渡
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxWidth: 500, margin: '0 auto' }}>
            {PRESETS.slice(0, 6).map(p => (
              <button key={p.label} onClick={() => setPrompt(p.prompt)}
                style={{ padding: '14px 8px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--border)', transition: 'all 0.2s', textAlign: 'center' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, display: 'block' }}>{p.label}</span>
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>{p.category}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ★ 结果动画 CSS */}
      <style>{`
        @keyframes videoResultIn {
          0% { opacity: 0; transform: scale(0.92) translateY(20px); }
          60% { transform: scale(1.02) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* 自定义模型配置弹窗 */}
      <Modal
        open={showAddModel}
        title={editingModelId ? '编辑自定义视频生成模型' : '添加自定义视频生成模型'}
        onCancel={() => { setShowAddModel(false); setNewModel({}); setEditingModelId(null); }}
        onOk={handleAddModel}
        okText={editingModelId ? '保存' : '添加'}
        width={480}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ fontSize: 'var(--fs-md)', fontWeight: 500, marginBottom: 4 }}>模型名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <Input
              placeholder="例如: Runway Gen-3、Pika Labs、Seedance"
              value={newModel.name}
              onChange={e => setNewModel(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-md)', fontWeight: 500, marginBottom: 4 }}>API Key <span style={{ color: 'var(--danger)' }}>*</span></label>
            <Input.Password
              placeholder="sk-... 或 api-..."
              value={newModel.apiKey}
              onChange={e => setNewModel(prev => ({ ...prev, apiKey: e.target.value }))}
            />
          </div>
          <div>
            <label style={{ fontSize: 'var(--fs-md)', fontWeight: 500, marginBottom: 4 }}>Base URL（可选）</label>
            <Input
              placeholder="https://api.runwayml.com/v1 (留空使用默认)"
              value={newModel.baseUrl}
              onChange={e => setNewModel(prev => ({ ...prev, baseUrl: e.target.value }))}
            />
          </div>
          {/* 2026-10-13: 原文案"不会上传到服务器"在 BYOK 真打通后已不准确 ——
              Key 现在会随请求发给本地 gateway (否则无法调用你自己的上游)。
              仍然成立的部分要说清楚: 不写入 .env、不进服务端配置、不随任务历史落盘。 */}
          <Alert
            type="info"
            message="API Key 保存在本地浏览器，并随生成请求发送给你本机的 gateway（仅用于调用你填写的上游地址，不写入服务端 .env、不随任务历史落盘）。"
            showIcon
            style={{ fontSize: 'var(--fs-micro)' }}
          />
        </Space>
      </Modal>
      </div>
    </div>
    )}
    </div>
  );
};
