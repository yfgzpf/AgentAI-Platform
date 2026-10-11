/**
 * ImageStudio v3.0 — AI 图像工作室
 * =================================================================
 * 布局: 对话改图=全屏聊天窗口 / 其他模式=左右分栏
 * 右键菜单: 图片发送到其他模式/视频
 * 对话改图: 支持上传图片+快捷指令+多轮迭代
 */
import React, { useState, useEffect, useRef } from 'react';
import {
    Input, Button, Select, Card, Space, Tag, Alert, Spin, message,
    Tooltip, Modal, Progress, Slider, Dropdown, Tabs,
} from 'antd';
import {
    PictureOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined,
    DeleteOutlined, BulbOutlined, ThunderboltOutlined, SwapOutlined,
    BgColorsOutlined, MessageOutlined, SkinOutlined,
UploadOutlined, PlusOutlined, ArrowRightOutlined, VideoCameraOutlined,
CopyOutlined, StarOutlined, FullscreenOutlined, EditOutlined,
} from '@ant-design/icons';
import { promptLibrary, type PromptTemplate } from '../services/promptLibrary';
import { imageTaskManager, type ImageTask } from '../services/imageTaskManager';
import { RegionEditor } from './RegionEditor';

import { GATEWAY_HTTP } from '../services/config';
import { useModelStore } from '../store/modelStore';
import { apiPost } from '../services/api';

// ======================== 常量 ========================

type StudioMode = 'text2img' | 'img2img' | 'style_transfer' | 'edit' | 'tryon';

// 对话改图已包含图生图+风格迁移的全部能力 (上传图+自然语言描述修改)
// 图生图和风格迁移模式保留在类型中 (向后兼容), 但不在 UI 中显示
const MODES: { key: StudioMode; label: string; icon: React.ReactNode; desc: string }[] = [
{ key: 'text2img', label: '文生图', icon: <ThunderboltOutlined />, desc: '描述你想要的图片' },
{ key: 'edit', label: '对话改图', icon: <MessageOutlined />, desc: '上传图片+自然语言修改+区域标注+多轮迭代' },
{ key: 'tryon', label: 'AI 换装', icon: <SkinOutlined />, desc: '人物+服装自动换装' },
];

const TEXT2IMG_PRESETS = [
    { label: '写实摄影', prompt: 'cinematic photo, realistic, 8k, highly detailed, natural lighting' },
    { label: '动漫插画', prompt: 'anime illustration, vibrant colors, studio ghibli style' },
    { label: '油画', prompt: 'oil painting, impressionist, monet style' },
    { label: '3D 渲染', prompt: '3D render, octane, unreal engine, soft lighting' },
    { label: '水墨', prompt: 'chinese ink wash painting, traditional, minimalist' },
    { label: '像素', prompt: 'pixel art, 16-bit retro game style' },
    { label: '奇幻', prompt: 'fantasy art, magical, dragons, epic landscape' },
    { label: '赛博朋克', prompt: 'cyberpunk, neon lights, rain, futuristic city' },
    { label: '室内设计', prompt: 'interior design, modern living room, natural light, 8k render, minimalist' },
    { label: '电影海报', prompt: 'movie poster, cinematic, dramatic lighting, typography' },
    { label: '国风插画', prompt: 'chinese traditional painting, ink wash, elegant, silk texture' },
    { label: '产品摄影', prompt: 'product photography, white background, studio lighting' },
];

const STYLE_PRESETS = [
    { label: '梵高', prompt: 'Van Gogh style, thick brushstrokes, vibrant swirling colors, post-impressionist' },
    { label: '莫奈', prompt: 'Monet style, impressionist, soft light, water lilies palette, hazy atmosphere' },
    { label: '毕加索', prompt: 'Picasso cubist style, geometric shapes, fragmented perspective, bold colors' },
    { label: '浮世绘', prompt: 'Japanese ukiyo-e woodblock print, flat colors, bold outlines, Hokusai style' },
    { label: '赛博朋克', prompt: 'cyberpunk, neon lights, rain-slicked streets, futuristic noir, blade runner' },
    { label: '水墨画', prompt: 'traditional Chinese ink wash, black ink on rice paper, minimalist, zen' },
    { label: '像素艺术', prompt: 'pixel art, 16-bit retro, crisp edges, limited palette' },
    { label: '素描', prompt: 'pencil sketch, charcoal drawing, detailed line art, monochrome' },
    { label: '水彩', prompt: 'watercolor painting, soft washes, transparent layers, artistic' },
    { label: '卡通', prompt: 'cartoon style, bold outlines, flat colors, Pixar animation style' },
    { label: '哥特', prompt: 'gothic art, dark medieval, stained glass, dramatic shadows' },
    { label: '波普', prompt: 'pop art, Andy Warhol, bright colors, comic book dots, bold' },
];

// 质量档位 — 对应 Agnes API 的 1K/2K/3K/4K 档位
const QUALITY_TIERS = [
    { value: '1K', label: '1K 标准', desc: '1024px · 免费/快速' },
    { value: '2K', label: '2K 高清', desc: '2048px · 更清晰' },
    { value: '4K', label: '4K 超清', desc: '4096px · 最高质量' },
];

// 比例选项
const ASPECT_RATIOS = [
    { value: '1:1', label: '1:1 方形', size: '1024x1024' },
    { value: '4:3', label: '4:3 横版', size: '1024x768' },
    { value: '3:4', label: '3:4 竖版', size: '768x1024' },
    { value: '16:9', label: '16:9 宽屏', size: '1312x736' },
    { value: '9:16', label: '9:16 竖屏', size: '736x1312' },
];

// 兼容: 旧代码引用 SIZES 的地方 — 映射到 1K 档位
const SIZES = [
    { value: '1K', label: '1K 标准' },
    { value: '2K', label: '2K 高清' },
    { value: '4K', label: '4K 超清' },
];

const MODELS = [
    { value: 'agnes', label: 'Agnes Image 2.5 Flash ⭐', desc: '官方免费' },
    { value: 'cogview', label: 'Cogview-3-Flash (免费)', desc: '智谱免费' },
    { value: 'alrc-gpt-image-2', label: 'GPT Image 2 ¥0.32/次', desc: 'OpenAI · 支持编辑 ⭐' },
    { value: 'alrc-gpt-image-2-vip', label: 'GPT Image 2 VIP ¥1.03/次', desc: 'OpenAI · 高清编辑' },
    { value: 'alrc-gpt-image-2.5', label: 'GPT Image 2.5 ¥0.48/次', desc: 'OpenAI · 最新' },
    { value: 'alrc-nano-banana', label: 'Nano Banana ¥0.30/次', desc: 'Google · 基础版' },
    { value: 'alrc-nano-banana-2', label: 'Nano Banana 2 ¥0.40/次', desc: 'Google · 支持编辑 ⭐' },
    { value: 'alrc-nano-banana-pro', label: 'Nano Banana Pro ¥1.43/次', desc: 'Google · 旗舰' },
];

interface CustomModel { id: string; name: string; apiKey: string; baseUrl: string; }
const getCustomModels = (): CustomModel[] => { try { const raw = localStorage.getItem('agentai-custom-models'); return raw ? JSON.parse(raw) : []; } catch { return []; } };
const saveCustomModels = (models: CustomModel[]) => localStorage.setItem('agentai-custom-models', JSON.stringify(models));

interface HistoryItem { id: string; prompt: string; url: string; size: string; ts: number; provider?: string; mode: StudioMode; sourceUrl?: string; }
interface EditMessage { role: 'user' | 'ai'; content: string; imageUrl?: string; images?: string[]; error?: boolean; retryData?: { prompt: string; images: string[]; sourceImage: string; refImages: string[] }; }
const STORAGE_KEY = 'agentai-studio-history';

const EDIT_QUICK_ACTIONS = [
    { label: '🎨 换背景', prompt: 'Change the background to a beautiful natural landscape, keep the subject unchanged' },
    { label: '☀️ 加光影', prompt: 'Add dramatic cinematic lighting with golden hour rim light, enhance shadows and contrast' },
    { label: '❄️ 变季节', prompt: 'Change the season to winter with snow, keep the same composition and subject' },
    { label: '🖌️ 变风格', prompt: 'Transform into anime illustration style while preserving the composition and subject' },
    { label: '✨ 加细节', prompt: 'Enhance all details, increase sharpness and texture, improve to 8k quality' },
    { label: '🔍 去背景', prompt: 'Remove the background, make it pure white background, keep only the subject' },
    { label: '🎭 变色调', prompt: 'Apply warm orange and teal color grading, cinematic color correction' },
    { label: '📐 比例裁切', prompt: 'Crop and resize the image to 16:9 aspect ratio, keeping the subject centered' },
    { label: '🧹 去水印', prompt: 'Remove any watermark, logo, or text from the image cleanly' },
    { label: '🪞 镜像翻转', prompt: 'Flip the image horizontally, mirror the entire scene' },
    { label: '🦋 加滤镜', prompt: 'Apply a dreamy vintage film filter, soft pastel tones, light leak effect' },
    { label: '🌈 HDR增强', prompt: 'Apply HDR enhancement, increase dynamic range, reveal shadow and highlight details' },
];

// 对话改图预设模版 — 分类别展示, 点击直接填入输入框
const EDIT_TEMPLATES: { category: string; icon: string; items: { label: string; prompt: string }[] }[] = [
    {
        category: '风格转换', icon: '🎨',
        items: [
            { label: '转动漫风', prompt: 'Transform this photo into a high-quality anime illustration, studio ghibli style, vibrant colors, clean line art' },
            { label: '转油画风', prompt: 'Transform this photo into an oil painting, impressionist style, visible brushstrokes, rich textures, Monet inspired' },
            { label: '转水彩风', prompt: 'Transform this photo into a watercolor painting, soft washes, transparent layers, artistic and dreamy' },
            { label: '转像素风', prompt: 'Transform this image into 16-bit pixel art, retro game style, limited color palette, crisp edges' },
            { label: '转3D渲染', prompt: 'Transform this image into a 3D render, octane render style, soft lighting, subsurface scattering, ultra detailed' },
            { label: '转水墨风', prompt: 'Transform this image into traditional Chinese ink wash painting, minimalist, elegant, rice paper texture' },
        ],
    },
    {
        category: '人像美容', icon: '👤',
        items: [
            { label: '美颜增强', prompt: 'Enhance facial features, smooth skin, brighten eyes, natural beauty enhancement, keep realistic' },
            { label: '年龄变换', prompt: 'Make the person look 10 years younger, smooth wrinkles, tighten skin, natural and subtle' },
            { label: '发色更换', prompt: 'Change the hair color to platinum blonde, keep the hairstyle and texture the same' },
            { label: '服装更换', prompt: 'Change the clothing to an elegant black evening dress, keep the person and pose the same' },
            { label: '表情调整', prompt: 'Change the facial expression to a warm smile, keep all other features the same' },
        ],
    },
    {
        category: '场景编辑', icon: '🏞️',
        items: [
            { label: '换海边', prompt: 'Change the background to a tropical beach at sunset, palm trees, golden light, keep subject unchanged' },
            { label: '换雪山', prompt: 'Change the background to snow-capped mountains, clear blue sky, keep subject unchanged' },
            { label: '换城市', prompt: 'Change the background to a futuristic cyberpunk city at night, neon lights, rain, keep subject unchanged' },
            { label: '换工作室', prompt: 'Change the background to a professional photography studio, seamless paper backdrop, soft lighting' },
            { label: '加樱花', prompt: 'Add cherry blossom trees in the background, pink petals falling, dreamy spring atmosphere' },
        ],
    },
    {
        category: '后期增强', icon: '✨',
        items: [
            { label: '高清放大', prompt: 'Upscale this image to 2x resolution, enhance all details, sharpen, improve to ultra HD quality' },
            { label: '修复老照片', prompt: 'Restore this old damaged photo, remove scratches, fix color fading, enhance details, make it look new' },
            { label: '去模糊', prompt: 'Remove motion blur and camera shake, sharpen the image, recover lost details, make it crisp' },
            { label: '夜景增强', prompt: 'Enhance the night scene, reduce noise, brighten shadows, improve star visibility, add subtle glow' },
            { label: '色彩校正', prompt: 'Professional color correction, fix white balance, enhance saturation naturally, cinematic color grading' },
        ],
    },
];

// ======================== 组件 ========================

export const ImageStudio: React.FC = () => {
    const [mode, setMode] = useState<StudioMode>('text2img');
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [showNegative, setShowNegative] = useState(false);
    // 默认必须是 SIZES 里存在的档位: 原先写死 '1024x1024' (旧像素格式),
    // 与 SIZES 的 1K/2K/4K 对不上, 选择器一进页面就是空白。
    const [size, setSize] = useState('1K');
    // 画幅比例 — 后端 /v1/image 支持 ratio, 但此前前端从不发送, 于是每张图都被
    // mapSizeToTier 兜成 1:1。ASPECT_RATIOS 常量因此成了没人引用的死代码。
    const [ratio, setRatio] = useState('1:1');
    const [model, setModel] = useState('agnes');
    const [strength, setStrength] = useState(0.65);
    const [batchCount, setBatchCount] = useState(1);
    const [busy, setBusy] = useState(false);
  // P0 修复: 历史从全局 imageTaskManager 订阅 — 常驻不丢失, 不依赖 localStorage
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [imgTasks, setImgTasks] = useState<ImageTask[]>(imageTaskManager.getTasks());
  useEffect(() => {
    const unsub = imageTaskManager.subscribe((tasks) => {
      setImgTasks(tasks);
      // 同步到本地 history 格式
      const items: HistoryItem[] = tasks
        .filter(t => t.imageUrl && t.status === 'completed')
        .map(t => ({
          id: t.id,
          prompt: t.prompt,
          url: t.imageUrl!,
          size: t.size || '1024x1024',
          ts: t.ts,
          provider: t.model,
          mode: (t.mode as StudioMode) || 'text2img',
        }));
      setHistory(items);
    });
    imageTaskManager.setHttpUrl(GATEWAY_HTTP);
    return () => { unsub(); };
  }, []);
    const [zoomUrl, setZoomUrl] = useState<string | null>(null);
    const [refImages, setRefImages] = useState<string[]>([]);
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [personImage, setPersonImage] = useState<string | null>(null);
    const [clothingImage, setClothingImage] = useState<string | null>(null);
    const [fakeProgress, setFakeProgress] = useState(0);
    const [editMessages, setEditMessages] = useState<EditMessage[]>(() => {
      // P0: 对话改图消息持久化 — 退出再进入不丢失
      try { const raw = localStorage.getItem('agentai-edit-messages'); if (raw) return JSON.parse(raw); } catch {}
      return [];
    });
    // P0: editMessages 变化时持久化 (只保存有 imageUrl 或 content 较短的, 避免 data URI 溢出)
    useEffect(() => {
      try {
        const toSave = editMessages.filter(m => {
          // 只保存 HTTP URL 的图片 (data URI 太大, 不保存)
          if (m.imageUrl && m.imageUrl.startsWith('data:')) return false;
          return true;
        }).slice(-30);
        localStorage.setItem('agentai-edit-messages', JSON.stringify(toSave));
      } catch {}
    }, [editMessages]);
    const [editInput, setEditInput] = useState('');
    const [editInputImages, setEditInputImages] = useState<string[]>([]); // 输入框中的待发送图片
    const [promptLib, setPromptLib] = useState<PromptTemplate[]>([]);
    const [showPromptLib, setShowPromptLib] = useState(false);
    const [showSavePrompt, setShowSavePrompt] = useState(false);
const [showRegionEditor, setShowRegionEditor] = useState(false);
const [regionEditImage, setRegionEditImage] = useState<string>('');
    const [newPromptLabel, setNewPromptLabel] = useState('');
    const [newPromptCategory, setNewPromptCategory] = useState('生图');

    const fileRef = useRef<HTMLInputElement>(null);
    const sourceRef = useRef<HTMLInputElement>(null);
    const editInputRef = useRef<HTMLInputElement>(null);
    const personRef = useRef<HTMLInputElement>(null);
    const clothingRef = useRef<HTMLInputElement>(null);
    const editEndRef = useRef<HTMLDivElement>(null);

  // 旧的 localStorage 历史已废弃 — 改用 imageTaskManager 全局订阅
  useEffect(() => { editEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [editMessages]);
    useEffect(() => { const unsub = promptLibrary.subscribe(setPromptLib); return () => { unsub(); }; }, []);

    const [customModels, setCustomModels] = useState<CustomModel[]>(getCustomModels());
    const [showAddModel, setShowAddModel] = useState(false);
    const [newModel, setNewModel] = useState<Partial<CustomModel>>({});

    const imageModels = useModelStore.getState().models.filter(m => m.modelType === 'image' && m.enabled);
    // 去重: MODELS 常量 + modelStore enabled 模型 + 自定义模型, 按 value 去重
    const allModelOptions = (() => {
        const seen = new Set<string>();
        const result: { value: string; label: string }[] = [];
        // 1. MODELS 常量 (始终可用)
        for (const m of MODELS) {
            if (!seen.has(m.value)) { seen.add(m.value); result.push({ value: m.value, label: m.label }); }
        }
        // 2. modelStore 中 enabled 的 image 模型 (用户可能启用了通义万相/Seedream等)
        for (const m of imageModels) {
            if (!seen.has(m.id)) { seen.add(m.id); result.push({ value: m.id, label: `${m.label}${m.freeQuotaNote ? ' ' + m.freeQuotaNote : ''}` }); }
        }
        // 3. 自定义模型
        for (const m of customModels) {
            const v = `custom:${m.id}`;
            if (!seen.has(v)) { seen.add(v); result.push({ value: v, label: `🔑 ${m.name}` }); }
        }
        return result;
    })();

    const handleAddModel = () => {
        if (!newModel.name || !newModel.apiKey) { message.error('请填写模型名称和 API Key'); return; }
        const cm: CustomModel = { id: `custom-${Date.now()}`, name: newModel.name!, apiKey: newModel.apiKey!, baseUrl: newModel.baseUrl || '' };
        const updated = [...customModels, cm]; setCustomModels(updated); saveCustomModels(updated);
        setModel(`custom:${cm.id}`); setNewModel({}); setShowAddModel(false); message.success(`已添加: ${cm.name}`);
    };
    const handleDeleteModel = (id: string) => {
        const updated = customModels.filter(m => m.id !== id); setCustomModels(updated); saveCustomModels(updated);
        if (model.startsWith('custom:') && model === `custom:${id}`) setModel('cogview');
    };

    const httpUrl = GATEWAY_HTTP;

    const sendToMode = (targetMode: StudioMode, imageUrl: string) => {
        setMode(targetMode); setCurrent(null); setSourceImage(imageUrl); setRefImages([imageUrl]);
if (targetMode === 'style_transfer' || targetMode === 'tryon') setPrompt('');
// 不清空 editMessages — 用户切回来时对话历史保留
        message.success(`已发送到「${MODES.find(m => m.key === targetMode)?.label}」`);
    };

const sendToVideo = (imageUrl: string) => {
  try { localStorage.setItem('agentai-video-refimg', imageUrl); message.success('已发送到生视频区域, 请切换到「AI 生视频」页查看'); }
  catch { message.error('图片太大, 无法传递'); }
};

    // 「张数」原先是死控件: body 里带了 n, 后端 destructure 后从未使用, 选 2/4 张也只出 1 张。
    // 在后端 4 条返回分支上循环太侵入, 改为前端串行补足; 仅文生图生效 (改图/换装是多轮语义)。
    const gen = async (overridePrompt?: string) => {
        const times = mode === 'text2img' ? Math.max(1, Math.min(4, batchCount)) : 1;
        for (let i = 0; i < times; i++) await genOnce(overridePrompt);
    };

    const genOnce = async (overridePrompt?: string) => {
        const actualPrompt = overridePrompt || prompt;
        if (!actualPrompt.trim()) { message.warning('请输入描述'); return; }
        setBusy(true); setFakeProgress(0);
        const progressTimer = setInterval(() => setFakeProgress(p => p >= 95 ? p : p + Math.random() * 5 + 2), 500);
        try {
            let finalPrompt = actualPrompt;
            if (mode === 'style_transfer' && sourceImage) finalPrompt = `Transform the provided image into the following art style while preserving the original composition and subject: ${prompt}.`;
            const body: any = { prompt: finalPrompt, size, ratio, model, mode };
            if (negativePrompt.trim()) body.negative_prompt = negativePrompt;

            // P0 修复: 发送前压缩 data URI 图片 — 避免大图导致 Failed to fetch
            const compressImage = (dataUri: string, maxDim = 768, quality = 0.75): Promise<string> => {
              return new Promise((resolve) => {
                if (!dataUri.startsWith('data:')) { resolve(dataUri); return; }
                const img = new Image();
                img.onload = () => {
                  if (img.width <= maxDim && img.height <= maxDim) { resolve(dataUri); return; }
                  const scale = Math.min(maxDim / img.width, maxDim / img.height);
                  const canvas = document.createElement('canvas');
                  canvas.width = Math.round(img.width * scale);
                  canvas.height = Math.round(img.height * scale);
                  const ctx = canvas.getContext('2d')!;
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                  resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = () => resolve(dataUri); // 压缩失败用原图
                img.src = dataUri;
              });
            };

            const compressAll = async (imgs: string[]): Promise<string[]> => {
              return Promise.all(imgs.map(img => compressImage(img)));
            };

            if (mode !== 'text2img' && refImages.length > 0) body.image = await compressAll(refImages);
            if (mode === 'style_transfer' && sourceImage) body.image = [await compressImage(sourceImage)];
            // edit 模式: 传入所有图片 (底图+mask+额外参考图), 让 AI 参考原图+蒙版+参考图编辑
            if (mode === 'edit') {
              const allEditImages: string[] = [];
              if (sourceImage) allEditImages.push(sourceImage);
              // refImages 中可能包含 mask 图 (来自 RegionEditor), 优先使用
              for (const img of refImages) {
                if (img !== sourceImage && !allEditImages.includes(img)) allEditImages.push(img);
              }
              // editInputImages 中的额外参考图 (不重复)
              for (const img of editInputImages) {
                if (img !== sourceImage && !allEditImages.includes(img)) allEditImages.push(img);
              }
              if (allEditImages.length > 0) body.image = await compressAll(allEditImages);
            }
            if (mode === 'tryon' && personImage && clothingImage) {
              body.image = [await compressImage(personImage), await compressImage(clothingImage)];
              body.prompt = `virtual try-on: person wearing the clothing from the second image, photorealistic`;
            }
            if (strength !== 0.65) body.strength = strength;

            // 请求超时控制 — 60s 超时
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);
            const r = await fetch(httpUrl + '/v1/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
            clearTimeout(timeoutId);
            const data = await r.json();
            if (data.error) {
                message.error('生成失败: ' + data.error);
                // edit 模式: 在消息流中添加可重试的错误消息
                if (mode === 'edit') {
                    setEditMessages(prev => [...prev, {
                        role: 'ai', content: `生成失败: ${data.error}`,
                        error: true,
                        retryData: { prompt: actualPrompt, images: [...editInputImages], sourceImage: sourceImage || '', refImages: [...refImages] },
                    }]);
                }
                return;
            }
            const item: HistoryItem = { id: `${Date.now()}`, prompt: actualPrompt, mode, url: data.url?.startsWith('/') ? httpUrl + data.url : data.url, size, ts: Date.now(), provider: data.provider, sourceUrl: sourceImage || undefined };
            setCurrent(item); setHistory(prev => [item, ...prev]);
            // 注册到 imageTaskManager — 历史持久化, 退出再进入不丢失
            imageTaskManager.registerCompleted({
              prompt: actualPrompt,
              model,
              mode,
              size,
              imageUrl: item.url,
            });
            if (mode === 'edit') setEditMessages(prev => [...prev, { role: 'ai', content: `已修改: "${actualPrompt}"`, imageUrl: item.url }]);
            message.success(`生成成功! 引擎: ${data.provider || 'unknown'}`);
        } catch (e: any) {
          // 区分错误类型给出更有用的提示
          let errMsg = '网络错误: ' + e.message;
          if (e.name === 'AbortError') {
            errMsg = '请求超时 (60s), 请检查网络或稍后重试';
          } else if (e.message === 'Failed to fetch') {
            errMsg = '网络错误: 请求被拒绝。可能原因: ①图片过大 ②服务器未启动 ③CORS 限制。请尝试更小的图片或检查后端服务。';
          }
          message.error(errMsg);
          // edit 模式: 在消息流中添加可重试的错误消息
          if (mode === 'edit') {
              setEditMessages(prev => [...prev, {
                  role: 'ai', content: errMsg,
                  error: true,
                  retryData: { prompt: actualPrompt, images: [...editInputImages], sourceImage: sourceImage || '', refImages: [...refImages] },
              }]);
          }
        }
        finally { clearInterval(progressTimer); setFakeProgress(100); setBusy(false); }
    };

    const downloadImg = (url: string) => { const a = document.createElement('a'); a.href = url; a.download = `pulseflow-${Date.now()}.png`; a.click(); };

    // 重试失败的生成 — 恢复当时的参数重新调用 gen
    const retryFailed = (retryData: { prompt: string; images: string[]; sourceImage: string; refImages: string[] }) => {
        // 恢复参数
        setPrompt(retryData.prompt);
        setEditInput(retryData.prompt);
        setEditInputImages(retryData.images);
        setSourceImage(retryData.sourceImage);
        setRefImages(retryData.refImages);
        // 延迟一帧后重新生成 (等待 state 更新)
        setTimeout(() => gen(retryData.prompt), 100);
    };

    // 删除单条历史
    const deleteHistoryItem = (id: string) => {
        setHistory(prev => prev.filter(h => h.id !== id));
    };

    const readImages = (files: FileList, maxCount: number, callback: (images: string[]) => void) => {
        const imgs: string[] = []; let loaded = 0;
        for (let i = 0; i < Math.min(files.length, maxCount); i++) {
            const f = files[i];
            if (f.size > 6 * 1024 * 1024) { message.error(`${f.name} 超过 6MB`); continue; }
            const reader = new FileReader();
            reader.onload = () => { imgs.push(reader.result as string); loaded++; if (loaded >= Math.min(files.length, maxCount)) callback(imgs); };
            reader.readAsDataURL(f);
        }
    };

    const sendEditMessage = () => {
        if (!editInput.trim() && editInputImages.length === 0) return;
        if (!sourceImage && !current?.url && editInputImages.length === 0) { message.warning('请先上传一张图片'); return; }
        const userMsg = editInput;
        const userImages = [...editInputImages];
        setPrompt(userMsg);
        // 用户消息包含文字+图片缩略图
        setEditMessages(prev => [...prev, { role: 'user', content: userMsg, images: userImages.length > 0 ? userImages : undefined }]);
        // 将所有图片设为参考图 (底图+额外参考图都传给后端)
        if (userImages.length > 0) {
            setSourceImage(userImages[0]);
            setRefImages(userImages);
        } else if (!sourceImage && current?.url) {
            setSourceImage(current.url);
            setRefImages([current.url]);
        }
        setEditInput('');
        setEditInputImages([]);
        // gen() 读取的是 refImages / sourceImage / editInputImages state
        // 但由于 setState 异步, gen() 内部读取的是当前快照值
        // 将 userImages 保存到闭包中, gen 可以通过 refImages 访问
        gen(userMsg);
    };

    // ===== 洗图放大 (Upscale) — 用 AI 模型放大图片到 2x 分辨率 =====
    const [upscaling, setUpscaling] = useState<string | null>(null);
    const upscaleImage = async (imageUrl: string) => {
        setUpscaling(imageUrl);
        try {
            const body: any = {
                prompt: 'Upscale this image to 2x resolution, enhance details, sharpen, improve quality, ultra high definition',
                size: '2048x2048',
                model,
                mode: 'edit',
                image: [imageUrl],
                strength: 0.3, // 低 strength 保持原图不变, 只做放大增强
            };
            const r = await fetch(httpUrl + '/v1/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await r.json();
            if (data.error) { message.error('放大失败: ' + data.error); return; }
            const upscaledUrl = data.url?.startsWith('/') ? httpUrl + data.url : data.url;
            const item: HistoryItem = { id: `${Date.now()}`, prompt: '高清放大 2x', mode: 'edit', url: upscaledUrl, size: '2048x2048', ts: Date.now(), provider: data.provider, sourceUrl: imageUrl };
            setCurrent(item); setHistory(prev => [item, ...prev]);
            imageTaskManager.registerCompleted({ prompt: '高清放大 2x', model, mode: 'edit', size: '2048x2048', imageUrl: upscaledUrl });
            setEditMessages(prev => [...prev, { role: 'ai', content: '已高清放大到 2x 分辨率', imageUrl: upscaledUrl }]);
            message.success('高清放大完成!');
        } catch (e: any) { message.error('放大失败: ' + e.message); }
        finally { setUpscaling(null); }
    };

    // ===== 图片右键菜单 =====
    const imgContextMenu = (imageUrl: string) => ({
        items: [
            { key: 'zoom', label: '放大查看', icon: <FullscreenOutlined /> },
            { key: 'download', label: '下载', icon: <DownloadOutlined /> },
            { key: 'copy', label: '复制提示词', icon: <CopyOutlined /> },
            { type: 'divider' as const },
            { key: 'edit', label: '发送到对话改图', icon: <MessageOutlined /> },
            { key: 'tryon', label: 'AI 换装', icon: <SkinOutlined /> },
            { type: 'divider' as const },
            { key: 'region', label: '区域标注编辑', icon: <EditOutlined /> },
            { key: 'video', label: '发送到生视频', icon: <VideoCameraOutlined /> },
        ],
        onClick: ({ key }: { key: string }) => {
            if (key === 'zoom') { setZoomUrl(imageUrl); return; }
            if (key === 'download') { downloadImg(imageUrl); return; }
            if (key === 'copy') { navigator.clipboard.writeText(prompt); message.success('已复制提示词'); return; }
            if (key === 'video') { sendToVideo(imageUrl); return; }
            if (key === 'region') { setRegionEditImage(imageUrl); setShowRegionEditor(true); return; }
            sendToMode(key as StudioMode, imageUrl);
        },
    });

    const renderImageUploader = (label: string, img: string | null, setImg: (v: string | null) => void, refObj: React.RefObject<HTMLInputElement | null>) => (
        <div>
            <Button size="small" icon={<UploadOutlined />} onClick={() => refObj.current?.click()}>{img ? '换' : label}</Button>
            <input ref={refObj as any} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { if (!e.target.files?.length) return; readImages(e.target.files, 1, imgs => setImg(imgs[0] || null)); e.target.value = ''; }} />
            {img && (
                <div style={{ marginTop: 6, position: 'relative', display: 'inline-block' }}>
                    <img src={img} alt={label} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <span onClick={() => setImg(null)} style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>
            )}
        </div>
    );

    // ===== 对话改图模式: 左右格局 — 左侧历史/快捷, 右侧消息流 =====
    if (mode === 'edit') {
        return (
            <div style={{ display: 'flex', height: 'calc(100vh - 50px)', color: 'var(--fg)', background: 'var(--bg)' }}>
                {/* ===== 左侧侧边栏: 历史 + 快捷操作 ===== */}
                <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--panel)', overflow: 'hidden' }}>
                    {/* 模式切换 */}
                    <div style={{ display: 'flex', gap: 4, padding: '8px' }}>
                        {MODES.map(m => (
                            <button key={m.key} onClick={() => { setMode(m.key); setCurrent(null); setSourceImage(null); setRefImages([]); }}
                                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 2px', borderRadius: 8, fontSize: 10, cursor: 'pointer', background: mode === m.key ? 'rgba(16,185,129,0.15)' : 'transparent', border: `1px solid ${mode === m.key ? '#10b981' : 'transparent'}`, color: mode === m.key ? '#10b981' : 'var(--muted-2)', transition: 'all 0.2s' }}>
                                {m.icon} {m.label}
                            </button>
                        ))}
                    </div>
                    {/* 参数设置 — 竖排不截断 */}
                    <div style={{ padding: '4px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>参数设置</div>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>模型</div>
                            <Select size="small" value={model} onChange={setModel} style={{ width: '100%' }} options={allModelOptions} />
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>尺寸</div>
                                <Select size="small" value={size} onChange={setSize} style={{ width: '100%' }} options={SIZES} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>强度</div>
                                <Select size="small" value={String(strength)} onChange={v => setStrength(parseFloat(v))} style={{ width: '100%' }}
                                    options={[{ value: '0.3', label: '0.3 轻微' }, { value: '0.5', label: '0.5 适中' }, { value: '0.65', label: '0.65 默认' }, { value: '0.8', label: '0.8 强力' }, { value: '0.95', label: '0.95 重绘' }]} />
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>画幅</div>
                            <Select size="small" value={ratio} onChange={setRatio} style={{ width: '100%' }} options={ASPECT_RATIOS} />
                        </div>
                    </div>

                    {/* 快捷操作 */}
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>快捷操作</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {EDIT_QUICK_ACTIONS.map(a => (
                                <button key={a.label} onClick={() => { if (!sourceImage && !current?.url) { message.warning('请先上传图片'); return; } setEditInput(a.prompt); }}
                                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-2)', cursor: 'pointer', transition: 'all 0.15s' }}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.color = '#10b981'; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--fg-2)'; }}>
                                    {a.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {/* 生成历史缩略图 */}
                    <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', justifyContent: 'space-between' }}>
                            <span>生成历史 ({history.length})</span>
                            {history.length > 0 && <span style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => { try { localStorage.removeItem('agentai-image-tasks'); setHistory([]); } catch {} }}>清空</span>}
                        </div>
                        {history.length === 0 ? (
                            <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: 20 }}>暂无历史记录</div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                {history.slice(0, 30).map(h => (
                                    <div key={h.id} style={{ position: 'relative', cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}
                                        onClick={() => { setSourceImage(h.url); setRefImages([h.url]); setCurrent(h); setEditInput(''); message.info('已设为底图, 输入修改指令'); }}
                                        title={h.prompt}>
                                        <img src={h.url} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 8, padding: '2px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {h.prompt.slice(0, 22)}
                                        </div>
                                        {/* 悬停操作栏 */}
                                        <div style={{ position: 'absolute', top: 2, right: 2, display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s' }}
                                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                                            onMouseLeave={e => { e.currentTarget.style.opacity = '0'; }}>
                                            <button onClick={(e) => { e.stopPropagation(); downloadImg(h.url); }}
                                                style={{ width: 18, height: 18, borderRadius: 4, background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                title="下载"><DownloadOutlined /></button>
                                            <button onClick={(e) => { e.stopPropagation(); deleteHistoryItem(h.id); }}
                                                style={{ width: 18, height: 18, borderRadius: 4, background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                title="删除"><DeleteOutlined /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* ===== 右侧: 消息流 + 预设模版 + 输入栏 ===== */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* 中间: 消息流 + 输入栏 */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* 顶栏 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <MessageOutlined style={{ color: '#10b981' }} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>对话改图</span>
                            {sourceImage && <Tag color="green" style={{ fontSize: 10 }}>底图已加载</Tag>}
                        </div>
                        <Space size={4}>
                            <Button size="small" icon={<UploadOutlined />} onClick={() => sourceRef.current?.click()}>上传图片</Button>
                            <Button size="small" icon={<EditOutlined />} disabled={!sourceImage && !current?.url}
                                onClick={() => { const img = sourceImage || current?.url; if (img) { setRegionEditImage(img); setShowRegionEditor(true); } }}>区域编辑</Button>
                            <Button size="small" icon={<StarOutlined />} onClick={() => setShowPromptLib(true)} />
                            {editMessages.length > 0 && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setEditMessages([]); }}>清空</Button>}
                        </Space>
                    </div>

                    {/* 消息流 */}
                    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                        {editMessages.length === 0 && !sourceImage && !current?.url ? (
                            /* 空状态引导 */
                            <div style={{ textAlign: 'center', marginTop: 80 }}>
                                <div style={{ marginBottom: 16, color: 'var(--muted)' }}><MessageOutlined style={{ fontSize: 48 }} /></div>
                                <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>AI 对话改图</div>
                                <div style={{ fontSize: 14, color: 'var(--muted-2)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                                    上传一张图片，用自然语言描述修改需求，AI 逐步迭代优化。<br/>
                                    支持多轮对话，每次基于上次结果继续编辑。
                                </div>
                                <Button type="primary" size="large" icon={<UploadOutlined />} onClick={() => sourceRef.current?.click()}
                                    style={{ background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 12, height: 48, padding: '0 32px', fontSize: 15 }}>
                                    上传图片开始
                                </Button>
                                <input ref={sourceRef} type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={e => { if (e.target.files?.length) readImages(e.target.files, 1, imgs => { setSourceImage(imgs[0]); setRefImages([imgs[0]]); setCurrent({ id: 'src', prompt: '上传图片', url: imgs[0], size: '', ts: Date.now(), mode: 'edit' }); }); e.target.value = ''; }} />
                                <div style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 600, margin: '32px auto 0' }}>
                                    {EDIT_QUICK_ACTIONS.slice(0, 6).map(a => (
                                        <Tag key={a.label} style={{ cursor: 'pointer', fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)' }}
                                            onClick={() => { message.info('请先上传一张图片'); }}>{a.label}</Tag>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div style={{ maxWidth: 800, margin: '0 auto' }}>
                                {/* 底图展示 */}
                                {sourceImage && editMessages.length === 0 && (
                                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                                        <Dropdown menu={imgContextMenu(sourceImage)} trigger={['contextMenu']}>
                                            <img src={sourceImage} alt="source" style={{ maxWidth: 500, maxHeight: 500, borderRadius: 12, border: '2px solid var(--border)', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} onClick={() => setZoomUrl(sourceImage)} />
                                        </Dropdown>
                                        <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>📷 当前底图 · 右键可发送到其他模式</div>
                                        <div style={{ marginTop: 8 }}>
                                            <Button size="small" type="primary" ghost icon={<EditOutlined />} onClick={() => { setRegionEditImage(sourceImage); setShowRegionEditor(true); }}>
                                                框选区域编辑
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {/* 消息列表 */}
                                {editMessages.map((msg, i) => (
                                    <div key={i} style={{ marginBottom: 20 }}>
                                        {msg.role === 'user' ? (
                                            /* 用户消息 — 右对齐气泡, 包含图片缩略图+文字 */
                                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                <div style={{ maxWidth: '70%' }}>
                                                    {/* 用户上传的图片缩略图 */}
                                                    {msg.images && msg.images.length > 0 && (
                                                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', marginBottom: 4, flexWrap: 'wrap' }}>
                                                            {msg.images.map((img, idx) => (
                                                                <img key={idx} src={img} alt={`upload-${idx}`} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setZoomUrl(img)} />
                                                            ))}
                                                        </div>
                                                    )}
                                                    {msg.content && (
                                                        <div style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--fg)', padding: '12px 18px', borderRadius: '18px 18px 4px 18px', fontSize: 14, lineHeight: 1.6 }}>{msg.content}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            /* AI 消息 — 左对齐 + 图片 + 操作栏 */
                                            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff', fontSize: 14, fontWeight: 700 }}>AI</div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    {msg.imageUrl && (
                                                        <Dropdown menu={imgContextMenu(msg.imageUrl)} trigger={['contextMenu']}>
                                                            <img src={msg.imageUrl} alt="result" style={{ width: 400, borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer', display: 'block', marginBottom: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }} onClick={() => setZoomUrl(msg.imageUrl || null)} />
                                                        </Dropdown>
                                                    )}
                                                    {msg.content && (
                                                        <div style={{ background: msg.error ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.10)', color: msg.error ? '#ef4444' : 'var(--fg)', padding: '12px 16px', borderRadius: '4px 18px 18px 18px', maxWidth: 500, fontSize: 14, lineHeight: 1.6 }}>{msg.content}</div>
                                                    )}
                                                    {/* 错误重试按钮 */}
                                                    {msg.error && msg.retryData && (
                                                        <div style={{ marginTop: 8 }}>
                                                            <Button size="small" type="primary" danger icon={<ReloadOutlined />} loading={busy} onClick={() => retryFailed(msg.retryData!)}>
                                                                重试
                                                            </Button>
                                                        </div>
                                                    )}
                                                    {/* 图片操作栏 */}
                                                    {msg.imageUrl && (
                                                        <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                                                            <Tooltip title="下载"><Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => downloadImg(msg.imageUrl!)} /></Tooltip>
                                                            <Tooltip title="以此为底图继续编辑"><Button size="small" type="text" icon={<SwapOutlined />} onClick={() => { setSourceImage(msg.imageUrl!); setRefImages([msg.imageUrl!]); message.success('已设为底图'); }} /></Tooltip>
                                                            <Tooltip title="区域标注编辑"><Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setRegionEditImage(msg.imageUrl!); setShowRegionEditor(true); }} /></Tooltip>
                                                            <Tooltip title="高清放大 (洗图)"><Button size="small" type="text" icon={<FullscreenOutlined />} loading={upscaling === msg.imageUrl} onClick={() => upscaleImage(msg.imageUrl!)} /></Tooltip>
                                                            <Dropdown menu={imgContextMenu(msg.imageUrl!)} trigger={['click']}>
                                                                <Tooltip title="发送到"><Button size="small" type="text" icon={<ArrowRightOutlined />} /></Tooltip>
                                                            </Dropdown>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {/* 加载中 */}
                                {busy && (
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 700 }}>AI</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <Spin size="small" /> <span style={{ color: 'var(--muted)', fontSize: 13 }}>正在生成图片...</span>
                                        </div>
                                    </div>
                                )}
                                <div ref={editEndRef} />
                            </div>
                        )}
                    </div>

                    {/* 底部输入栏 — 类似聊天输入框, 上传按钮在内 */}
                    <div style={{ flexShrink: 0, padding: '12px 16px', background: 'var(--panel)', borderTop: '1px solid var(--border)' }}>
                        {/* 当前底图 + 待发送图片缩略图 (在输入框上方, 始终可见) */}
                        {(sourceImage || editInputImages.length > 0) && (
                            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', padding: '8px 12px', background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)', alignItems: 'center' }}>
                                {/* 当前底图缩略图 — 始终显示, 悬停显示编辑入口 */}
                                {sourceImage && (
                                    <div style={{ position: 'relative', width: 64, height: 64 }} title="当前底图">
                                        <img src={sourceImage} alt="底图" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '2px solid #10b981' }} />
                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(16,185,129,0.85)', color: '#fff', fontSize: 8, textAlign: 'center', padding: '1px 0', borderRadius: '0 0 6px 6px' }}>底图</div>
                                        {/* 悬停编辑入口 */}
                                        <button onClick={(e) => { e.stopPropagation(); setRegionEditImage(sourceImage); setShowRegionEditor(true); }}
                                            style={{ position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: 4, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}
                                            title="框选编辑"><EditOutlined /></button>
                                        <button onClick={() => { setSourceImage(null); setRefImages([]); }}
                                            style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                                    </div>
                                )}
                                {/* 待发送图片缩略图 — 悬停显示编辑入口 */}
                                {editInputImages.filter(img => img !== sourceImage).map((img, idx) => (
                                    <div key={`pending-${idx}`} style={{ position: 'relative', width: 64, height: 64 }}>
                                        <img src={img} alt={`pending-${idx}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                                        <button onClick={(e) => { e.stopPropagation(); setRegionEditImage(img); setShowRegionEditor(true); }}
                                            style={{ position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: 4, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}
                                            title="框选编辑"><EditOutlined /></button>
                                        <button onClick={() => setEditInputImages(prev => prev.filter((_, i) => i !== idx))}
                                            style={{ position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%', background: 'var(--danger)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                                    </div>
                                ))}
                                {/* 添加更多图片按钮 */}
                                <button onClick={() => editInputRef.current?.click()}
                                    style={{ width: 64, height: 64, borderRadius: 6, border: '1px dashed var(--border)', background: 'var(--bg)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>+</button>
                                <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                                    {sourceImage ? '底图' : ''}{sourceImage && editInputImages.length > 0 ? ' + ' : ''}{editInputImages.length > 0 ? `${editInputImages.length}张待发` : ''}
                                </span>
                            </div>
                        )}
                        {/* 输入框 + 上传按钮 + 发送按钮 */}
                        <div style={{ display: 'flex', gap: 0, alignItems: 'flex-end', background: 'var(--bg)', borderRadius: 12, border: '1px solid var(--border)', padding: '4px 4px 4px 0', minHeight: 56 }}>
                            {/* 上传按钮 — 在输入框左侧 */}
                            <Tooltip title={editInputImages.length > 0 ? `已选 ${editInputImages.length} 张, 点击添加更多` : '上传图片 (支持多选)'}>
                                <button onClick={() => editInputRef.current?.click()} disabled={busy}
                                    style={{ width: 44, height: 44, flexShrink: 0, border: 'none', background: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--accent)', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <PictureOutlined />
                                </button>
                            </Tooltip>
                            <Input.TextArea value={editInput} onChange={e => setEditInput(e.target.value)} placeholder={editInputImages.length > 0 ? '描述修改需求 (可不填, 直接发送图片)' : '描述你想要的修改，如：把背景换成海边日落...'} autoSize={{ minRows: 1, maxRows: 6 }} disabled={busy}
                                onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); sendEditMessage(); } }} style={{ flex: 1, border: 'none', background: 'transparent', borderRadius: 0, fontSize: 14, padding: '12px 8px', resize: 'none', boxShadow: 'none' }} />
                            <Button type="primary" icon={<MessageOutlined />} loading={busy} onClick={sendEditMessage} disabled={!editInput.trim() && editInputImages.length === 0}
                                style={{ borderRadius: 10, background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', height: 40, minWidth: 72, fontSize: 14, fontWeight: 600, margin: '2px' }}>
                                {busy ? '生成中' : '发送'}
                            </Button>
                        </div>
                        {/* 隐藏的多图上传 input */}
                        <input ref={editInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                            onChange={e => { if (e.target.files?.length) readImages(e.target.files, 5, imgs => { setEditInputImages(prev => [...prev, ...imgs]); if (imgs.length > 0 && !sourceImage) { setSourceImage(imgs[0]); setRefImages(prev => [...prev, ...imgs]); setCurrent({ id: 'src', prompt: '上传图片', url: imgs[0], size: '', ts: Date.now(), mode: 'edit' }); } message.success(`已添加 ${imgs.length} 张图片`); }); e.target.value = ''; }} />
                    </div>
                </div>

                {/* 右侧: 预设模版区 (240px) */}
                <div style={{ width: 240, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--panel)', overflow: 'auto', padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <BulbOutlined /> 预设模版
                    </div>
                    {EDIT_TEMPLATES.map(cat => (
                        <div key={cat.category} style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg-2)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>{cat.icon}</span> {cat.category}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                {cat.items.map(item => (
                                    <button key={item.label}
                                        onClick={() => { if (!sourceImage && !current?.url) { message.warning('请先上传图片'); return; } setEditInput(item.prompt); }}
                                        style={{ textAlign: 'left', fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--fg-2)', cursor: 'pointer', transition: 'all 0.15s', lineHeight: 1.4 }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.color = '#10b981'; e.currentTarget.style.background = 'rgba(16,185,129,0.06)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.background = 'var(--bg)'; }}>
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div style={{ fontSize: 9, color: 'var(--muted-2)', textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                        点击模版自动填入输入框<br/>可在此基础上修改后发送
                    </div>
                </div>
                </div>

                {/* 弹窗 */}
                <Modal open={!!zoomUrl} footer={null} onCancel={() => setZoomUrl(null)} width="90%" centered styles={{ body: { padding: 0, textAlign: 'center', background: 'var(--bg)' } }}>
                    {zoomUrl && <img src={zoomUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '85vh' }} />}
                </Modal>
                <Modal open={showPromptLib} title="提示词收藏夹" onCancel={() => setShowPromptLib(false)} footer={null} width={560}>
                    <Tabs items={promptLibrary.getCategories().map(cat => ({
                        key: cat, label: `${cat} (${promptLibrary.getByCategory(cat).length})`,
                        children: (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {promptLibrary.getByCategory(cat).map(t => (
                                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)', cursor: 'pointer' }}
                                        onClick={() => { setEditInput(t.prompt); setShowPromptLib(false); message.success(`已加载: ${t.label}`); }}>
                                        <StarOutlined style={{ fontSize: 16, color: 'var(--accent)' }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                                            <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.prompt}</div>
                                        </div>
                                        {!t.isBuiltIn && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => { e.stopPropagation(); promptLibrary.remove(t.id); }} />}
                                    </div>
                                ))}
                            </div>
                        ),
                    }))} />
                </Modal>

                {/* 区域标注编辑器 — 全屏覆盖 */}
                {showRegionEditor && regionEditImage && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg)', padding: 16 }}>
                        <RegionEditor
                            imageUrl={regionEditImage}
                            onApply={(combined, refImgs, annotatedImage, maskImage) => {
                                setEditInput(combined);
                                // 发给 AI 的图片: [带标注的原图(含编号框选), 彩色mask图]
                                // AI 看到标注图上的编号区域 + 彩色蒙版, 配合 prompt 中的颜色对应表, 理解每个区域的修改指令
                                const imagesToSend: string[] = [];
                                if (annotatedImage) imagesToSend.push(annotatedImage);
                                if (maskImage) imagesToSend.push(maskImage);
                                // 如果都失败, fallback 用原图
                                if (imagesToSend.length === 0) imagesToSend.push(regionEditImage);
                                setSourceImage(annotatedImage || regionEditImage);
                                setRefImages(imagesToSend);
                                // 待发送列表显示: 带标注预览图 + 参考图
                                const previewImages: string[] = [];
                                if (annotatedImage) previewImages.push(annotatedImage);
                                if (refImgs && refImgs.length > 0) previewImages.push(...refImgs);
                                setEditInputImages(previewImages);
                                setShowRegionEditor(false);
                                setRegionEditImage('');
                                message.success('已生成区域编辑指令 (含彩色蒙版), 点击发送执行');
                            }}
                            onClose={() => { setShowRegionEditor(false); setRegionEditImage(''); }}
                        />
                    </div>
                )}
            </div>
        );
    }

    // ===== 非对话模式: 左右分栏 =====
    return (
        <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 50px)', color: 'var(--fg)' }}>
            {/* 左侧: 控制面板 */}
            <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' }}>
                {/* 模式选择 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                    {MODES.map(m => {
                        const active = mode === m.key;
                        const colors: Record<string, string> = { text2img: '#3B82F6', img2img: '#EC4899', style_transfer: '#8B5CF6', edit: '#10B981', tryon: '#F59E0B' };
                        const c = colors[m.key] || '#6366f1';
                        return (
                            <button key={m.key} onClick={() => { setMode(m.key); setCurrent(null); setSourceImage(null); setRefImages([]); }}
                                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '8px 2px', borderRadius: 8, cursor: 'pointer', background: active ? `${c}18` : 'var(--panel)', border: `2px solid ${active ? c : 'var(--border)'}`, transition: 'all 0.2s' }}>
                                <span style={{ fontSize: 16, color: active ? c : 'var(--muted-2)' }}>{m.icon}</span>
                                <span style={{ fontSize: 10, fontWeight: active ? 700 : 600, color: active ? c : 'var(--fg-2)' }}>{m.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* 控制卡 */}
                <Card size="small" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
                    title={<Space><PictureOutlined /> {MODES.find(m => m.key === mode)?.label}</Space>}
                    extra={<Space size={4}>
                        <Select size="small" value={model} onChange={setModel} style={{ width: 140 }} options={allModelOptions}
                            dropdownRender={(menu) => (<>{menu}<div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)' }}><Button size="small" type="link" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setShowAddModel(true); }}>添加自定义</Button></div></>)} />
                        <Select size="small" value={size} onChange={setSize} style={{ width: 100 }} options={SIZES} />
                    </Space>}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                        {/* 提示词输入 */}
                        <div style={{ display: 'flex', gap: 4 }}>
                            <Input.TextArea value={prompt} onChange={e => setPrompt(e.target.value)}
                                placeholder={mode === 'text2img' ? '描述你想要的图片...' : mode === 'img2img' ? '描述变体效果 (可选)...' : mode === 'style_transfer' ? '选择或描述风格...' : '描述试穿效果 (可选)...'}
                                autoSize={{ minRows: 3, maxRows: 6 }} disabled={busy} style={{ flex: 1 }} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                <Tooltip title="收藏夹"><Button size="small" icon={<StarOutlined />} onClick={() => setShowPromptLib(true)} /></Tooltip>
                                <Tooltip title="保存"><Button size="small" icon={<PlusOutlined />} disabled={!prompt.trim()} onClick={() => { setNewPromptLabel(prompt.slice(0, 20)); setShowSavePrompt(true); }} /></Tooltip>
                                <Tooltip title="AI优化"><Button size="small" icon={<BulbOutlined />} disabled={busy || !prompt.trim()} onClick={async () => {
                                    setBusy(true);
                                    try { const d = await apiPost('/v1/prompt/optimize', { text: prompt, type: 'image' }); if (d.ok && d.enhanced) { setPrompt(d.enhanced); message.success('✨ 已优化'); } else { setPrompt(`masterpiece, best quality, ${prompt}, 8k`); } }
                                    catch { setPrompt(`masterpiece, best quality, ${prompt}, 8k`); } finally { setBusy(false); }
                                }} /></Tooltip>
                            </div>
                        </div>

                        {/* 画幅比例 — 后端一直支持 ratio, 这里之前根本没有入口, 所以出图恒为 1:1 */}
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>画幅</span>
                            <Select size="small" value={ratio} onChange={setRatio} style={{ flex: 1 }} options={ASPECT_RATIOS} disabled={busy} />
                        </div>

                        {/* 风格预设 */}
                        {mode === 'text2img' && (
                            <Select size="small" value={prompt && TEXT2IMG_PRESETS.find(p => p.prompt === prompt)?.label || undefined}
                                onChange={v => setPrompt(TEXT2IMG_PRESETS.find(p => p.label === v)?.prompt || '')}
                                placeholder="选择风格预设..." style={{ width: '100%' }} allowClear disabled={busy}
                                options={TEXT2IMG_PRESETS.map(p => ({ value: p.label, label: p.label }))} />
                        )}
                        {mode === 'style_transfer' && (
                            <Select size="small" value={prompt && STYLE_PRESETS.find(p => p.prompt === prompt)?.label || undefined}
                                onChange={v => setPrompt(STYLE_PRESETS.find(p => p.label === v)?.prompt || '')}
                                placeholder="选择目标风格..." style={{ width: '100%' }} allowClear disabled={busy}
                                options={STYLE_PRESETS.map(p => ({ value: p.label, label: p.label }))} />
                        )}

                        {/* 图生图上传 */}
                        {mode === 'img2img' && (
                            <div>
                                <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} block>
                                    {refImages.length > 0 ? `已选 ${refImages.length} 张参考图` : '上传参考图'}
                                </Button>
                                <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                                    onChange={e => { if (e.target.files?.length) readImages(e.target.files, 5, imgs => { setRefImages(imgs); setSourceImage(imgs[0] || null); }); e.target.value = ''; }} />
                                {refImages.length > 0 && (
                                    <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                                        {refImages.map((img, i) => (
                                            <div key={i} style={{ position: 'relative' }}>
                                                <img src={img} alt={`ref${i}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                                                <span onClick={() => { setRefImages(prev => prev.filter((_, j) => j !== i)); if (i === 0) setSourceImage(null); }}
                                                    style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div style={{ marginTop: 6 }}><span style={{ color: 'var(--muted)', fontSize: 11 }}>强度: {strength.toFixed(2)}</span>
                                    <Slider min={0.1} max={0.95} step={0.05} value={strength} onChange={setStrength} style={{ width: '100%' }} /></div>
                            </div>
                        )}

                        {/* 风格迁移上传 */}
                        {mode === 'style_transfer' && <div>{renderImageUploader('上传原图', sourceImage, setSourceImage, sourceRef)}</div>}

                        {/* 换装上传 */}
                        {mode === 'tryon' && (
                            <div style={{ display: 'flex', gap: 8 }}>
                                {renderImageUploader('人物', personImage, setPersonImage, personRef)}
                                {renderImageUploader('服装', clothingImage, setClothingImage, clothingRef)}
                            </div>
                        )}

                        {/* 负面提示词 */}
                        <div>
                            <button onClick={() => setShowNegative(!showNegative)} style={{ background: 'none', border: 'none', color: 'var(--muted-2)', fontSize: 11, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                                {showNegative ? <span style={{ fontSize: 9 }}>▼</span> : <span style={{ fontSize: 9 }}>▶</span>} 负面提示词
                            </button>
                            {showNegative && <Input.TextArea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} placeholder="blurry, low quality..." autoSize={{ minRows: 1, maxRows: 2 }} size="small" disabled={busy} style={{ marginTop: 4 }} />}
                        </div>

                        {/* 生成按钮 */}
                        <div>
                            <Space>
                                {mode === 'text2img' && <Select size="small" value={batchCount} onChange={setBatchCount} style={{ width: 75 }} disabled={busy} options={[{ value: 1, label: '1张' }, { value: 2, label: '2张' }, { value: 4, label: '4张' }]} />}
                                <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={() => gen()}
                                    disabled={mode === 'tryon' && (!personImage || !clothingImage)}
                                    style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', borderRadius: 10, padding: '0 28px', boxShadow: '0 4px 16px rgba(99,102,241,0.3)' }}>
                                    {busy ? '生成中...' : `生成${batchCount > 1 ? ` ×${batchCount}` : ''}`}
                                </Button>
                            </Space>
                        </div>

                        {/* ★ 填充: 最近提示词 */}
                        {history.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <HistoryOutlined /> 最近提示词
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {history.slice(0, 4).map(h => (
                                        <div key={h.id} onClick={() => { setPrompt(h.prompt); message.success('已加载提示词'); }}
                                            style={{ padding: '6px 8px', borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 11, color: 'var(--fg-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'all 0.2s' }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--fg-2)'; }}>
                                            {h.prompt}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ★ 填充: 模型信息 */}
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)', marginBottom: 4 }}>当前引擎</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                {model === 'agnes' && 'Agnes Image 2.5 Flash — 支持文生图/图生图/风格迁移/改图'}
                                {model === 'cogview' && 'Cogview-3-Flash — 智谱免费模型, 仅支持文生图'}
                                {model.startsWith('alrc-') && `${MODELS.find(m => m.value === model)?.label || model} — 通过模型工厂接入`}
                                {model.startsWith('custom:') && `自定义模型: ${customModels.find(m => 'custom:' + m.id === model)?.name || ''}`}
                            </div>
                            {mode !== 'text2img' && model === 'cogview' && (
                                <div style={{ fontSize: 10, color: 'var(--danger)', marginTop: 4 }}>此模型不支持当前模式, 将自动切换 Agnes</div>
                            )}
                        </div>
                    </div>
                </Card>
            </div>

            {/* 右侧: 结果展示 */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', minWidth: 0 }}>
                {/* 当前结果 */}
                {current && (
                    <Card size="small" style={{ animation: 'imgResultIn 0.4s ease' }}
                        title={<Space><PictureOutlined /> 结果 <Tag>{current.provider || 'unknown'}</Tag></Space>}
                        extra={<Space size={4}>
                            <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadImg(current.url)}>下载</Button>
                            <Dropdown menu={imgContextMenu(current.url)} trigger={['click']}>
                                <Button size="small" icon={<ArrowRightOutlined />} type="primary" ghost>发送到</Button>
                            </Dropdown>
                            <Button size="small" icon={<ReloadOutlined />} onClick={() => gen()}>再来一张</Button>
                        </Space>}>
                        <div style={{ textAlign: 'center', background: 'var(--panel)', padding: 12, borderRadius: 8 }}>
                            <Dropdown menu={imgContextMenu(current.url)} trigger={['contextMenu']}>
                                <img src={current.url} alt={current.prompt} style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 300px)', borderRadius: 4, cursor: 'pointer' }} onClick={() => setZoomUrl(current.url)} />
                            </Dropdown>
                        </div>
                        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                            <div style={{ color: 'var(--muted)', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.prompt}</div>
                            <div style={{ color: 'var(--muted-2)', fontSize: 11, marginLeft: 8 }}>{current.size} · {new Date(current.ts).toLocaleTimeString()}</div>
                        </div>
                    </Card>
                )}

                {/* 加载中 */}
                {busy && (
                    <Card size="small" style={{ textAlign: 'center', padding: 40 }}>
                        <Spin size="large" />
                        <Progress percent={Math.min(fakeProgress, 95)} status="active" style={{ maxWidth: 400, margin: '16px auto' }} />
                        <div style={{ color: 'var(--muted)' }}>{mode === 'style_transfer' ? '风格迁移中...' : mode === 'tryon' ? '换装中...' : 'AI 绘画中...'}</div>
                    </Card>
                )}

                {/* 空状态 */}
                {!current && !busy && history.length === 0 && (
                    <div style={{ textAlign: 'center', marginTop: 60 }}>
                        <div style={{ marginBottom: 12, color: 'var(--muted)' }}><PictureOutlined style={{ fontSize: 40 }} /></div>
                        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>AI 图像工作室</div>
                        <div style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 24 }}>选择模式，输入描述，开始创作</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8, maxWidth: 500, margin: '0 auto' }}>
                            {TEXT2IMG_PRESETS.slice(0, 6).map(p => (
                                <button key={p.label} onClick={() => { setMode('text2img'); setPrompt(p.prompt); }}
                                    style={{ padding: '14px 8px', borderRadius: 10, cursor: 'pointer', background: 'var(--panel)', border: '1px solid var(--border)', transition: 'all 0.2s', textAlign: 'center' }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
                                    <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{p.label}</span>
                                    <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>点击使用</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* 历史记录 */}
                {history.length > 0 && (
                    <Card size="small" title={<Space><HistoryOutlined /> 历史 ({history.length})</Space>}
                        extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setHistory([]); setCurrent(null); }}>清空</Button>}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                            {history.slice(0, 30).map(item => (
                                <Dropdown key={item.id} menu={imgContextMenu(item.url)} trigger={['contextMenu']}>
                                    <div style={{ position: 'relative', cursor: 'pointer', border: current?.id === item.id ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
                                        onClick={() => { setCurrent(item); setZoomUrl(item.url); }}
                                        onContextMenu={e => { e.preventDefault(); downloadImg(item.url); }}>
                                        <img src={item.url} alt={item.prompt} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '3px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
                                            <div style={{ fontSize: 10, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{MODES.find(m => m.key === item.mode)?.label || item.mode}</div>
                                        </div>
                                    </div>
                                </Dropdown>
                            ))}
                        </div>
                        <div style={{ textAlign: 'center', marginTop: 6, fontSize: 10, color: 'var(--muted-2)' }}>右键图片可发送到其他模式</div>
                    </Card>
                )}
            </div>

            {/* CSS */}
            <style>{`@keyframes imgResultIn { 0% { opacity: 0; transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }`}</style>

            {/* 放大预览 */}
            <Modal open={!!zoomUrl} footer={null} onCancel={() => setZoomUrl(null)} width="90%" centered
                styles={{ body: { padding: 0, textAlign: 'center', background: 'var(--bg)' } }}>
                {zoomUrl && <img src={zoomUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '85vh' }} />}
            </Modal>

            {/* 自定义模型弹窗 */}
            <Modal open={showAddModel} title="添加自定义模型" onCancel={() => { setShowAddModel(false); setNewModel({}); }} onOk={handleAddModel} okText="添加" width={460}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>模型名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <Input placeholder="如: DALL·E 3" value={newModel.name} onChange={e => setNewModel(prev => ({ ...prev, name: e.target.value }))} /></div>
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>API Key <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <Input.Password placeholder="sk-..." value={newModel.apiKey} onChange={e => setNewModel(prev => ({ ...prev, apiKey: e.target.value }))} /></div>
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>Base URL (可选)</label>
                        <Input placeholder="https://api.openai.com/v1" value={newModel.baseUrl} onChange={e => setNewModel(prev => ({ ...prev, baseUrl: e.target.value }))} /></div>
                    <Alert type="info" message="API Key 安全存储在本地浏览器中" showIcon style={{ fontSize: 11 }} />
                </Space>
            </Modal>

            {/* 提示词收藏夹弹窗 */}
            <Modal open={showPromptLib} title="提示词收藏夹" onCancel={() => setShowPromptLib(false)} footer={null} width={560}>
                <Tabs items={promptLibrary.getCategories().map(cat => ({
                    key: cat, label: `${cat} (${promptLibrary.getByCategory(cat).length})`,
                    children: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {promptLibrary.getByCategory(cat).map(t => (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)', cursor: 'pointer' }}
                                    onClick={() => { setPrompt(t.prompt); setShowPromptLib(false); message.success(`已加载: ${t.label}`); }}>
                                    <StarOutlined style={{ fontSize: 16, color: 'var(--accent)' }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                                        <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.prompt}</div>
                                    </div>
                                    {!t.isBuiltIn && <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={e => { e.stopPropagation(); promptLibrary.remove(t.id); }} />}
                                </div>
                            ))}
                        </div>
                    ),
                }))} />
            </Modal>

            {/* 保存提示词弹窗 */}
            <Modal open={showSavePrompt} title="保存提示词" onCancel={() => setShowSavePrompt(false)}
                onOk={() => { if (newPromptLabel.trim()) { promptLibrary.add(newPromptLabel, prompt, newPromptCategory); setShowSavePrompt(false); setNewPromptLabel(''); message.success('已保存'); } }}
                okText="保存" width={400}>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>名称</label>
                        <Input value={newPromptLabel} onChange={e => setNewPromptLabel(e.target.value)} placeholder="给提示词起个名字" /></div>
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>分类</label>
                        <Select value={newPromptCategory} onChange={setNewPromptCategory} style={{ width: '100%' }}
                            options={[{ value: '生图', label: '生图' }, { value: '生视频', label: '生视频' }, { value: '改图指令', label: '改图指令' }, { value: '自定义', label: '自定义' }]} /></div>
                    <div><label style={{ fontSize: 13, marginBottom: 4, display: 'block' }}>内容</label>
                        <Input.TextArea value={prompt} readOnly autoSize={{ minRows: 2, maxRows: 4 }} style={{ fontSize: 12 }} /></div>
                </Space>
            </Modal>

              {/* 区域标注编辑器 — 全屏覆盖 */}
              {showRegionEditor && regionEditImage && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg)', padding: 16 }}>
                  <RegionEditor
                    imageUrl={regionEditImage}
                    onApply={(combined) => {
                      // 根据当前模式决定填入哪里
                      if ((mode as string) === 'edit') {
                        setEditInput(combined);
                        setSourceImage(regionEditImage);
                        setRefImages([regionEditImage]);
                      } else {
                        setPrompt(combined);
                        if (!sourceImage) setSourceImage(regionEditImage);
                        setMode('img2img');
                        setRefImages([regionEditImage]);
                      }
                    }}
                    onClose={() => { setShowRegionEditor(false); setRegionEditImage(''); }}
                  />
                </div>
              )}
        </div>
    );
};