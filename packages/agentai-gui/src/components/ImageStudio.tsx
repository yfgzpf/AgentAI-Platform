/**
 * ImageStudio v2.0 — AI 图像工作室
 * =================================================================
 * 5 种创作模式:
 *   1. 文生图 — AI 根据描述生成图片
 *   2. 图生图 — 上传参考图 + 描述, AI 生成变体
 *   3. 风格迁移 — 上传原图, 选择目标风格
 *   4. 对话改图 — 对话式迭代修改图片
 *   5. AI 换装 — 上传人物+服装, AI 虚拟试穿
 *
 * 引擎: Cogview-3-Flash (免费) → Agnes Image 2.x (NVIDIA NIM 已移除)
 */
import React, { useState, useEffect, useRef } from 'react';
import {
    Input, Button, Select, Card, Space, Tag, Alert, Spin, message,
    Tooltip, Modal, Progress, Slider,
} from 'antd';
import {
    PictureOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined,
    DeleteOutlined, BulbOutlined, ThunderboltOutlined, SwapOutlined,
    BgColorsOutlined, MessageOutlined, SkinOutlined,
    UploadOutlined, PlusOutlined, ArrowRightOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import { GATEWAY_HTTP } from '../services/config';
import { useModelStore } from '../store/modelStore';
import { apiPost } from '../services/api';

// ======================== 常量 ========================

type StudioMode = 'text2img' | 'img2img' | 'style_transfer' | 'edit' | 'tryon';

const MODES: { key: StudioMode; label: string; icon: React.ReactNode; desc: string }[] = [
    { key: 'text2img', label: '文生图', icon: <ThunderboltOutlined />, desc: '描述你想要的图片' },
    { key: 'img2img', label: '图生图', icon: <SwapOutlined />, desc: '上传参考图生成变体' },
    { key: 'style_transfer', label: '风格迁移', icon: <BgColorsOutlined />, desc: '改变图片的艺术风格' },
    { key: 'edit', label: '对话改图', icon: <MessageOutlined />, desc: '对话式迭代修改图片' },
    { key: 'tryon', label: 'AI 换装', icon: <SkinOutlined />, desc: '虚拟试穿服装' },
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

const SIZES = [
    { value: '512x512', label: '512 (小)' },
    { value: '1024x1024', label: '1024 (中)' },
    { value: '1024x768', label: '1024x768 (横)' },
    { value: '768x1024', label: '768x1024 (竖)' },
    { value: '1920x1080', label: 'FHD' },
    { value: '768x1344', label: '768x1344' },
    { value: '1440x720', label: '1440x720' },
    { value: '720x1440', label: '720x1440' },
];

const MODELS = [
// NVIDIA qwen-image 已移除 (NIM 不可用)
{ value: 'cogview', label: 'Cogview-3-Flash (免费)', desc: '智谱免费, 同 ZHIPU_API_KEY' },
    { value: 'agnes', label: 'Agnes Image 2.x', desc: '需 AGENTAI_API_KEY, 支持图生图/风格迁移' },
    { value: 'openai-dalle3', label: 'DALL·E 3 (OpenAI)', desc: '需 OPENAI_API_KEY' },
    { value: 'stability-sdxl', label: 'Stable Diffusion XL', desc: '需 STABILITY_API_KEY' },
    { value: 'midjourney', label: 'Midjourney (代理)', desc: '通过 Gateway 代理调用' },
    // ALRC 生图模型
    { value: 'alrc-nano-banana', label: 'Nano Banana (ALRC ¥0.16)', desc: 'Google · 标准版' },
    { value: 'alrc-nano-banana-2', label: 'Nano Banana 2 (ALRC ¥0.14)', desc: 'Google · 最新版' },
    { value: 'alrc-nano-banana-pro', label: 'Nano Banana Pro (ALRC ¥0.21)', desc: 'Google · 旗舰版' },
    { value: 'alrc-gpt-image-2', label: 'GPT Image 2 (ALRC ¥0.05)', desc: 'OpenAI · 标准版' },
    { value: 'alrc-gpt-image-2-vip', label: 'GPT Image 2 VIP (ALRC ¥0.18)', desc: 'OpenAI · 高清版' },
];

/** 自定义模型配置 */
interface CustomModel {
    id: string;
    name: string;
    apiKey: string;
    baseUrl: string;
}

const getCustomModels = (): CustomModel[] => {
    try {
        const raw = localStorage.getItem('agentai-custom-models');
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveCustomModels = (models: CustomModel[]) => {
    localStorage.setItem('agentai-custom-models', JSON.stringify(models));
};

interface HistoryItem {
    id: string; prompt: string; url: string; size: string; ts: number;
    provider?: string; mode: StudioMode; sourceUrl?: string;
}
interface EditMessage { role: 'user' | 'ai'; content: string; imageUrl?: string; }

const STORAGE_KEY = 'agentai-studio-history';

// ======================== 组件 ========================

export const ImageStudio: React.FC = () => {
    const [mode, setMode] = useState<StudioMode>('text2img');
    const [prompt, setPrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [showNegative, setShowNegative] = useState(false);
    const [size, setSize] = useState('1024x1024');
    const [model, setModel] = useState('cogview');
    const [strength, setStrength] = useState(0.65);
    const [batchCount, setBatchCount] = useState(1);
    const [busy, setBusy] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [current, setCurrent] = useState<HistoryItem | null>(null);
    const [zoomUrl, setZoomUrl] = useState<string | null>(null);
    const [refImages, setRefImages] = useState<string[]>([]);
    const [sourceImage, setSourceImage] = useState<string | null>(null);
    const [personImage, setPersonImage] = useState<string | null>(null);
    const [clothingImage, setClothingImage] = useState<string | null>(null);
    const [fakeProgress, setFakeProgress] = useState(0);
    // 对话改图
    const [editMessages, setEditMessages] = useState<EditMessage[]>([]);
    const [editInput, setEditInput] = useState('');

    const fileRef = useRef<HTMLInputElement>(null);
    const sourceRef = useRef<HTMLInputElement>(null);
    const personRef = useRef<HTMLInputElement>(null);
    const clothingRef = useRef<HTMLInputElement>(null);
    const editEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => { try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setHistory(JSON.parse(raw)); } catch {} }, []);
    useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 80))); } catch {} }, [history]);
    useEffect(() => { editEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [editMessages]);

    // 合并内置模型和自定义模型
    const [customModels, setCustomModels] = useState<CustomModel[]>(getCustomModels());
    const [showAddModel, setShowAddModel] = useState(false);
    const [newModel, setNewModel] = useState<Partial<CustomModel>>({});

    // 从 modelStore 获取生图模型选项
    const imageModels = useModelStore.getState().models.filter(m => m.modelType === 'image' && m.enabled);
    const allModelOptions = [
        ...MODELS.map(m => ({ value: m.value, label: m.label })),
        ...imageModels.map(m => ({ value: m.id, label: `${m.label}${m.freeQuotaNote ? ' ' + m.freeQuotaNote : ''}` })),
        ...customModels.map(m => ({ value: `custom:${m.id}`, label: `🔑 ${m.name}`, isCustom: true })),
    ];

    /** 添加自定义模型 */
    const handleAddModel = () => {
        if (!newModel.name || !newModel.apiKey) {
            message.error('请填写模型名称和 API Key');
            return;
        }
        const model: CustomModel = {
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
        message.success(`已添加模型: ${model.name}`);
    };

    /** 删除自定义模型 */
    const handleDeleteModel = (id: string) => {
        const updated = customModels.filter(m => m.id !== id);
        setCustomModels(updated);
        saveCustomModels(updated);
        if (model.startsWith('custom:') && model === `custom:${id}`) {
            setModel('cogview');
        }
    };

    const httpUrl = GATEWAY_HTTP;

    /** 将图片发送到其他模式 */
    const sendToMode = (targetMode: StudioMode, imageUrl: string) => {
        setMode(targetMode);
        setCurrent(null);
        setSourceImage(imageUrl);
        setRefImages([imageUrl]);
        // ★ 风格迁移/换装需要清空旧 prompt, 因为旧 prompt 是内容描述而非风格/试穿描述
        if (targetMode === 'style_transfer' || targetMode === 'tryon') {
            setPrompt('');
        }
        if (targetMode === 'edit') {
            setEditMessages([]);
        }
        // 滚动到顶部
        window.scrollTo({ top: 0, behavior: 'smooth' });
        message.success(`已发送到「${MODES.find(m => m.key === targetMode)?.label}」模式`);
    };

    /** 将图片发送到视频生成 (跨页面) */
    const sendToVideo = (imageUrl: string) => {
        // 存入 localStorage, VideoGen 读取后自动设为首帧
        try {
            localStorage.setItem('agentai-video-firstframe', imageUrl);
            message.success('已设为视频首帧, 请切换到「AI 生视频」页查看');
        } catch { message.error('图片太大, 无法传递'); }
    };

    /** 通用图片生成 */
    const gen = async (overridePrompt?: string) => {
        const actualPrompt = overridePrompt || prompt;
        if (!actualPrompt.trim()) { message.warning('请输入描述'); return; }
        setBusy(true); setFakeProgress(0);
        const progressTimer = setInterval(() => {
            setFakeProgress((prev: number) => prev >= 95 ? prev : prev + Math.random() * 5 + 2);
        }, 500);
        try {
            // ★ 风格迁移: 构建正确的组合 prompt
            let finalPrompt = actualPrompt;
            if (mode === 'style_transfer' && sourceImage) {
                // 组合: 保持原图内容 + 应用目标风格
                finalPrompt = `Transform the provided image into the following art style while preserving the original composition and subject: ${prompt}. Apply the style transformation to the entire image.`;
            }

            const body: any = { prompt: finalPrompt, size, model, mode, n: batchCount };
            if (negativePrompt.trim()) body.negative_prompt = negativePrompt;
            if (mode !== 'text2img' && refImages.length > 0) body.image = refImages;
            if (mode === 'style_transfer' && sourceImage) body.image = [sourceImage];
            if (mode === 'edit' && sourceImage) body.image = [sourceImage];
            if (mode === 'tryon' && personImage && clothingImage) {
                body.image = [personImage, clothingImage];
                body.prompt = `virtual try-on: person wearing the clothing from the second image, photorealistic`;
            }
            if (strength !== 0.65) body.strength = strength;

            const r = await fetch(httpUrl + '/v1/image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await r.json();
            if (data.error) { message.error('生成失败: ' + data.error); return; }
            const item: HistoryItem = {
                id: `${Date.now()}`, prompt: actualPrompt, mode,
                url: data.url?.startsWith('/') ? httpUrl + data.url : data.url,
                size, ts: Date.now(), provider: data.provider,
                sourceUrl: sourceImage || undefined,
            };
            setCurrent(item);
            setHistory(prev => [item, ...prev]);

            // 对话改图: 添加 AI 回复
            if (mode === 'edit') {
                setEditMessages(prev => [...prev, {
                    role: 'ai',
                    content: `已根据你的指令修改图片: "${actualPrompt}"`,
                    imageUrl: item.url,
                }]);
            }

            message.success(`生成成功! 引擎: ${data.provider || 'unknown'}`);
        } catch (e: any) { message.error('网络错误: ' + e.message); }
        finally { clearInterval(progressTimer); setFakeProgress(100); setBusy(false); }
    };

    const downloadImg = (url: string) => {
        const a = document.createElement('a'); a.href = url;
        a.download = `pulseflow-${Date.now()}.png`; a.click();
    };

    /** 读图 base64 */
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

    // =============== 对话改图 ===============
    const sendEditMessage = () => {
        if (!editInput.trim()) return;
        if (!sourceImage && !current?.url) { message.warning('请先生成或上传一张图片'); return; }
        const userMsg = editInput;
        setPrompt(userMsg);
        setEditMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        if (!sourceImage && current?.url) {
            setSourceImage(current.url);
            setRefImages([current.url]);
        }
        setEditInput('');
        // ★ 直接传 userMsg, 避免竞态条件 (setPrompt 是异步的)
        gen(userMsg);
    };

    // =============== 渲染 ===============

    const renderImageUploader = (
        label: string, img: string | null, setImg: (v: string | null) => void,
        refObj: React.RefObject<HTMLInputElement | null>, max = 1
    ) => (
        <div>
            <Button size="small" icon={<UploadOutlined />}
                onClick={() => refObj.current?.click()}
            >{img ? '换一张' : label}</Button>
            <input ref={refObj as any} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => {
                    if (!e.target.files?.length) return;
                    readImages(e.target.files, max, imgs => { setImg(imgs[0] || null); });
                    e.target.value = '';
                }}
            />
            {img && (
                <div style={{ marginTop: 8, position: 'relative', display: 'inline-block' }}>
                    <img src={img} alt={label} style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                    <span onClick={() => setImg(null)}
                        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--danger)', color: 'var(--fg)', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                </div>
            )}
        </div>
    );

    const renderResultCard = () => {
        if (!current) return null;
        // ★ 跨模式跳转菜单
        const sendToMenu = {
            items: [
                { key: 'img2img', label: '📐 图生图 — 以此图生成变体', icon: <SwapOutlined /> },
                { key: 'style_transfer', label: '🎨 风格迁移 — 改变此图风格', icon: <BgColorsOutlined /> },
                { key: 'edit', label: '✏️ 对话改图 — 对话式修改', icon: <MessageOutlined /> },
                { type: 'divider' as const },
                { key: 'video', label: '🎬 发送到视频首帧', icon: <VideoCameraOutlined /> },
            ],
            onClick: ({ key }: { key: string }) => {
                if (key === 'video') sendToVideo(current.url);
                else sendToMode(key as StudioMode, current.url);
            },
        };
        return (
            <Card size="small" style={{ marginTop: 16 }}
                title={<Space><PictureOutlined />结果 <Tag>{current.provider || 'unknown'}</Tag> <Tag color="purple">{MODES.find(m => m.key === current.mode)?.label}</Tag></Space>}
                extra={<Space>
                    <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadImg(current.url)}>下载</Button>
                    {mode === 'edit' && (
                        <Button size="small" icon={<SwapOutlined />}
                            onClick={() => { setSourceImage(current.url); setRefImages([current.url]); }}
                        >以此为底图</Button>
                    )}
                    {/* ★ 发送到其他模式 */}
                    <Dropdown menu={sendToMenu} trigger={['click']}>
                        <Button size="small" icon={<ArrowRightOutlined />} type="primary" ghost>发送到</Button>
                    </Dropdown>
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => gen()}>再来一张</Button>
                </Space>}
            >
                <div style={{ textAlign: 'center', background: 'var(--panel)', padding: 12, borderRadius: 8 }}>
                    <img src={current.url} alt={current.prompt}
                        style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4, cursor: 'pointer' }}
                        onClick={() => setZoomUrl(current.url)} />
                </div>
                <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
                    {current.prompt.slice(0, 100)} · {current.size} · {new Date(current.ts).toLocaleTimeString()}
                </div>
            </Card>
        );
    };

    const renderHistory = () => {
        if (history.length === 0) return null;
        return (
            <Card size="small" style={{ marginTop: 16 }}
                title={<Space><HistoryOutlined />历史记录 ({history.length})</Space>}
                extra={<Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setHistory([]); setCurrent(null); setEditMessages([]); }}>清空</Button>}
            >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
                    {history.map(item => (
                        <div key={item.id}
                            style={{ position: 'relative', cursor: 'pointer', border: current?.id === item.id ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', background: 'var(--panel)' }}
                            onClick={() => { setCurrent(item); setZoomUrl(item.url); }}
                            onContextMenu={e => { e.preventDefault(); downloadImg(item.url); }}
                        >
                            <img src={item.url} alt={item.prompt}
                                style={{ width: '100%', height: 90, objectFit: 'cover', display: 'block' }}
                                title={item.prompt.slice(0, 40)}
                            />
                            {/* ★ 历史图片也加发送到按钮 */}
                            <div style={{ position: 'absolute', top: 2, right: 2, opacity: 0, transition: 'opacity 0.2s' }}
                                className="history-send-btn"
                                onClick={(e) => { e.stopPropagation(); }}
                            >
                                <Dropdown menu={{ items: [
                                    { key: 'img2img', label: '→ 图生图', icon: <SwapOutlined /> },
                                    { key: 'style_transfer', label: '→ 风格迁移', icon: <BgColorsOutlined /> },
                                    { key: 'edit', label: '→ 对话改图', icon: <MessageOutlined /> },
                                    { key: 'video', label: '→ 视频首帧', icon: <VideoCameraOutlined /> },
                                ], onClick: ({ key }: { key: string }) => {
                                    if (key === 'video') sendToVideo(item.url);
                                    else sendToMode(key as StudioMode, item.url);
                                } }} trigger={['click']}>
                                    <Button size="small" type="primary" ghost style={{ minWidth: 0, width: 24, height: 24, padding: 0, fontSize: 11 }}>→</Button>
                                </Dropdown>
                            </div>
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '2px 4px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
                                <div style={{ fontSize: 9, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {MODES.find(m => m.key === item.mode || m.label.includes(item.provider || ''))?.label || item.provider || item.mode}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </Card>
        );
    };

return (
<div style={{ padding: '8px 12px', color: 'var(--fg)', height: '100%', overflow: 'auto' }}>
            {/* ===== 模式选择卡片 (重构为视觉化卡片) ===== */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 12 }}>
                {MODES.map(m => {
                    const active = mode === m.key;
                    const modeColors: Record<string, string> = {
                        text2img: '#3B82F6', img2img: '#EC4899', style_transfer: '#8B5CF6',
                        edit: '#10B981', tryon: '#F59E0B',
                    };
                    const color = modeColors[m.key] || '#6366f1';
                    return (
                        <button key={m.key}
                            onClick={() => { setMode(m.key); setCurrent(null); setSourceImage(null); setRefImages([]); }}
                            style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                                padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
                                background: active ? `${color}18` : 'var(--panel)',
                                border: `2px solid ${active ? color : 'var(--border)'}`,
                                transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
                                transform: active ? 'scale(1.03) translateY(-2px)' : 'scale(1)',
                                boxShadow: active ? `0 4px 16px ${color}30` : 'none',
                                position: 'relative', overflow: 'hidden',
                            }}
                        >
                            {active && <div style={{ position: 'absolute', top: 0, left: '20%', right: '20%', height: 2, background: color, borderRadius: 1 }} />}
                            <span style={{ fontSize: 22, color: active ? color : 'var(--muted-2)', transition: 'all 0.2s' }}>{m.icon}</span>
                            <span style={{ fontSize: 12, fontWeight: active ? 700 : 600, color: active ? color : 'var(--fg-2)' }}>{m.label}</span>
                            <span style={{ fontSize: 10, color: 'var(--muted-2)', textAlign: 'center', lineHeight: 1.3 }}>{m.desc}</span>
                        </button>
                    );
                })}
            </div>

            {/* ===== 主控制卡 ===== */}
            <Card size="small"
                title={<Space><PictureOutlined />AI 图像工作室 · {MODES.find(m => m.key === mode)?.desc}</Space>}
                extra={
                    <Space>
<Select size="small" value={model} onChange={setModel} style={{ width: 220 }}
    options={allModelOptions}
    dropdownRender={(menu) => (
        <>
            {menu}
            <div style={{ padding: '4px 8px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>自定义模型</span>
                <Button size="small" type="link" icon={<PlusOutlined />} onClick={(e) => { e.stopPropagation(); setShowAddModel(true); }}>
                    添加
                </Button>
            </div>
        </>
    )}
/>
{model.startsWith('custom:') && (
    <Button size="small" type="link" danger onClick={() => handleDeleteModel(model.replace('custom:', ''))} style={{ fontSize: 12, marginLeft: 8 }}>
        删除此模型
    </Button>
)}
                        <Select size="small" value={size} onChange={setSize} style={{ width: 130 }}
                            options={SIZES} />
                    </Space>
                }
            >
                <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {/* Prompt 输入 */}
                    <Input.TextArea
                        value={prompt}
                        onChange={e => setPrompt(e.target.value)}
                        placeholder={
                            mode === 'text2img' ? '描述你想要的图片...' :
                            mode === 'img2img' ? '描述想要的变体效果 (可选)...' :
                            mode === 'style_transfer' ? '选择或描述目标风格...' :
                            mode === 'edit' ? '描述要如何修改这张图片...' :
                            '描述试穿效果偏好 (可选)...'
                        }
                        autoSize={{ minRows: 2, maxRows: 4 }} size="large" disabled={busy}
                    />

                    {/* ★ 负面提示词 (可折叠) */}
                    <div>
                        <button onClick={() => setShowNegative(!showNegative)}
                            style={{ background: 'none', border: 'none', color: 'var(--muted-2)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                            {showNegative ? '▼' : '▶'} 负面提示词 (排除不想要的元素)
                        </button>
                        {showNegative && (
                            <Input.TextArea
                                value={negativePrompt}
                                onChange={e => setNegativePrompt(e.target.value)}
                                placeholder="如: blurry, low quality, distorted, watermark, text"
                                autoSize={{ minRows: 1, maxRows: 2 }} size="small" disabled={busy}
                                style={{ marginTop: 4, fontSize: 12 }}
                            />
                        )}
                    </div>

                    {/* === 模式专属控件 === */}

                    {/* 文生图 - 风格预设 (卡片化) */}
                    {mode === 'text2img' && (
                        <div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>🎨 风格预设 — 点击应用</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6 }}>
                                {TEXT2IMG_PRESETS.map(p => {
                                    const presetIcons: Record<string, string> = {
                                        '写实摄影': '📷', '动漫插画': '🎴', '油画': '🎨', '3D 渲染': '🧊',
                                        '水墨': '🖌️', '像素': '👾', '奇幻': '🐉', '赛博朋克': '🌃',
                                        '室内设计': '🏠', '电影海报': '🎬', '国风插画': '🏮', '产品摄影': '📦',
                                    };
                                    const active = prompt === p.prompt;
                                    return (
                                        <button key={p.label}
                                            onClick={() => setPrompt(p.prompt)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6,
                                                padding: '8px 10px', borderRadius: 8, fontSize: 12,
                                                background: active ? 'var(--accent-soft)' : 'var(--panel)',
                                                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                                                color: active ? 'var(--accent)' : 'var(--fg-2)',
                                                cursor: 'pointer', textAlign: 'left',
                                                transition: 'all 0.2s ease',
                                            }}
                                        >
                                            <span style={{ fontSize: 16 }}>{presetIcons[p.label] || '🎨'}</span>
                                            <span style={{ fontWeight: 600 }}>{p.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 图生图 - 上传参考图 */}
                    {mode === 'img2img' && (
                        <div>
                            <div style={{ marginBottom: 8, color: 'var(--muted)', fontSize: 12 }}>📎 上传参考图 (AI 以此为基础生成变体):</div>
                            <Button size="small" icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                                {refImages.length > 0 ? `已选 ${refImages.length} 张` : '上传参考图'}
                            </Button>
                            <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                                onChange={e => { if (e.target.files?.length) readImages(e.target.files, 5, imgs => { setRefImages(imgs); setSourceImage(imgs[0] || null); }); e.target.value = ''; }} />
                            <span style={{ marginLeft: 8, color: 'var(--muted-2)', fontSize: 11 }}>支持多图, 最多 5 张 (自动使用 Agnes 引擎)</span>
                            {strength !== undefined && (
                                <div style={{ marginTop: 8 }}>
                                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>参考图强度: {strength.toFixed(2)}</span>
                                    <Slider min={0.1} max={0.95} step={0.05} value={strength} onChange={setStrength} style={{ width: 200, marginLeft: 8 }} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* 风格迁移 - 上传原图 + 风格选择 (卡片化) */}
                    {mode === 'style_transfer' && (
                        <div>
                            <div style={{ marginBottom: 8 }}>{renderImageUploader('上传原图', sourceImage, setSourceImage, sourceRef)}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>🎨 目标风格 — 点击应用</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
                                {STYLE_PRESETS.map(p => {
                                    const styleIcons: Record<string, string> = {
                                        '梵高': '🌻', '莫奈': '🌸', '毕加索': '📐', '浮世绘': '🗻',
                                        '赛博朋克': '🌃', '水墨画': '🖌️', '像素艺术': '👾', '素描': '✏️',
                                        '水彩': '💧', '卡通': '🎈', '哥特': '🏰', '波普': '🥤',
                                    };
                                    const active = prompt === p.prompt;
                                    return (
                                        <button key={p.label}
                                            onClick={() => setPrompt(p.prompt)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 5,
                                                padding: '7px 10px', borderRadius: 8, fontSize: 12,
                                                background: active ? 'rgba(139,92,246,0.15)' : 'var(--panel)',
                                                border: `1px solid ${active ? '#8b5cf6' : 'var(--border)'}`,
                                                color: active ? '#8b5cf6' : 'var(--fg-2)',
                                                cursor: 'pointer', textAlign: 'left',
                                                transition: 'all 0.2s ease',
                                            }}
                                        >
                                            <span style={{ fontSize: 15 }}>{styleIcons[p.label] || '🎨'}</span>
                                            <span style={{ fontWeight: 600 }}>{p.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 对话改图 - 对话历史 */}
                    {mode === 'edit' && (
                        <div style={{ maxHeight: 250, overflow: 'auto', background: 'var(--panel)', borderRadius: 8, padding: 8 }}>
                            {(sourceImage || current?.url) && !editMessages.length && (
                                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>
                                    将基于此图进行修改, 在下方输入修改指令开始
                                </div>
                            )}
                            {editMessages.map((msg, i) => (
                                <div key={i} style={{ marginBottom: 8 }}>
                                    {msg.role === 'user' ? (
                                        <div style={{ textAlign: 'right' }}>
                                            <Tag color="blue" style={{ maxWidth: '80%', textAlign: 'left', whiteSpace: 'normal', padding: 6 }}>
                                                {msg.content}
                                            </Tag>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                            {msg.imageUrl && (
                                                <img src={msg.imageUrl} alt="result" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer' }}
                                                    onClick={() => setZoomUrl(msg.imageUrl || null)} />
                                            )}
                                            <Tag color="green" style={{ maxWidth: '60%', whiteSpace: 'normal', padding: 6 }}>
                                                {msg.content}
                                            </Tag>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <div ref={editEndRef} />
                        </div>
                    )}

                    {/* AI 换装 - 上传人物+服装 */}
                    {mode === 'tryon' && (
                        <div style={{ display: 'flex', gap: 24 }}>
                            <div>{renderImageUploader('上传人物照片', personImage, setPersonImage, personRef)}</div>
                            <div>{renderImageUploader('上传服装图片', clothingImage, setClothingImage, clothingRef)}</div>
                            {(!personImage || !clothingImage) && (
                                <div style={{ color: 'var(--muted)', fontSize: 12, alignSelf: 'center' }}>
                                    ⚠️ AI 换装需同时上传人物和服装图片<br />
                                    <span style={{ color: 'var(--muted-2)' }}>使用 Agnes 引擎, 效果以实际生成为准</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 操作栏 */}
                    <Space>
                        {mode === 'edit' ? (
                            <Space.Compact style={{ width: '100%' }}>
                                <Input value={editInput} onChange={e => setEditInput(e.target.value)}
                                    placeholder="输入修改指令, 如: 把背景改成海边日落"
                                    onPressEnter={sendEditMessage} disabled={busy} style={{ flex: 1 }} />
                                <Button type="primary" icon={<MessageOutlined />} loading={busy}
                                    onClick={sendEditMessage} disabled={!editInput.trim()}>发送</Button>
                            </Space.Compact>
                        ) : (
                            <>
<Tooltip title="AI 优化提示词"><Button size="small" icon={<BulbOutlined />}
onClick={async () => {
  if (!prompt.trim()) { message.warning('请先输入描述'); return; }
  setBusy(true);
  try {
    const data = await apiPost('/v1/prompt/optimize', { text: prompt, type: 'image' });
    if (data.ok && data.enhanced) {
      setPrompt(data.enhanced);
      message.success('✨ AI 已优化提示词');
    } else {
      setPrompt(`masterpiece, best quality, ${prompt}, 8k, ultra detailed, sharp focus`);
      message.warning('AI 优化失败, 已本地增强');
    }
  } catch (e: any) {
    setPrompt(`masterpiece, best quality, ${prompt}, 8k, ultra detailed, sharp focus`);
    message.warning('AI 优化失败, 已本地增强');
  } finally { setBusy(false); }
}}
disabled={busy}>优化</Button></Tooltip>
                                {/* ★ 批量生成选择 */}
                                {mode === 'text2img' && (
                                    <Select size="small" value={batchCount} onChange={setBatchCount} style={{ width: 90 }}
                                        options={[{ value: 1, label: '1 张' }, { value: 2, label: '2 张' }, { value: 4, label: '4 张' }]}
                                        disabled={busy}
                                    />
                                )}
                                <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={() => gen()}
                                    disabled={mode === 'tryon' && (!personImage || !clothingImage)}
                                    style={{
                                        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        border: 'none', borderRadius: 10, padding: '0 32px',
                                        boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
                                    }}>
                                    {busy ? '生成中...' : `生成${batchCount > 1 ? ` ×${batchCount}` : ''}`}
                                </Button>
                            </>
                        )}
                    </Space>

                    {/* 参考图预览 */}
                    {refImages.length > 0 && mode !== 'edit' && (
                        <div style={{ display: 'flex', gap: 8, padding: 8, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
                            {refImages.map((img, i) => (
                                <div key={i} style={{ position: 'relative' }}>
                                    <img src={img} alt={`ref${i}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                                    <span onClick={() => { setRefImages(prev => prev.filter((_, j) => j !== i)); if (i === 0) setSourceImage(null); }}
                                        style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: 'var(--fg)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>×</span>
                                </div>
                            ))}
                            <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{mode === 'img2img' ? '图生图模式' : '参考图'} · 自动使用 Agnes 引擎</div>
                        </div>
                    )}

                    {/* 模型提示 */}
                    {/* NVIDIA qwen-image alert 已移除 */}
                    {model === 'cogview' && <Alert type="info" message="Cogview-3-Flash 免费模型, 仅支持文生图。图生图/风格迁移自动切换 Agnes。" style={{ fontSize: 11 }} showIcon />}
                    {model === 'agnes' && <Alert type="info" message="Agnes Image 2.x, 支持文生图+图生图+风格迁移。需 AGENTAI_API_KEY。" style={{ fontSize: 11 }} showIcon />}
                </Space>
            </Card>

            {/* 加载动画 */}
            {busy && (
                <div style={{ textAlign: 'center', padding: 40 }}>
                    <Spin size="large" />
                    <Progress percent={Math.min(fakeProgress, 95)} status="active" style={{ maxWidth: 400, margin: '16px auto' }} />
                    <div style={{ marginTop: 8, color: 'var(--muted)' }}>
                        {mode === 'style_transfer' ? '🎨 风格迁移中...' : mode === 'edit' ? '✏️ 改图中...' : mode === 'tryon' ? '👔 换装中...' : '🎨 AI 绘画中...'}
                    </div>
                </div>
            )}

            {/* 结果 + 历史 */}
            {current && (
                <div style={{ animation: 'imgResultIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
                    {renderResultCard()}
                </div>
            )}
            {renderHistory()}

            {/* ★ 空状态 — 示例画廊 (取代纯 Empty) */}
            {!current && !busy && history.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 40 }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>🎨</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', marginBottom: 6 }}>
                        AI 图像工作室
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 24 }}>
                        选择上方模式，输入描述或点击预设风格，开始创作你的第一幅 AI 作品
                    </div>
                    {/* 灵感画廊 */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, maxWidth: 600, margin: '0 auto' }}>
                        {TEXT2IMG_PRESETS.slice(0, 6).map(p => {
                            const presetIcons: Record<string, string> = {
                                '写实摄影': '📷', '动漫插画': '🎴', '油画': '🎨', '3D 渲染': '🧊',
                                '水墨': '🖌️', '像素': '👾',
                            };
                            return (
                                <button key={p.label}
                                    onClick={() => { setMode('text2img'); setPrompt(p.prompt); }}
                                    style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                                        padding: '20px 12px', borderRadius: 12, cursor: 'pointer',
                                        background: 'var(--panel)', border: '1px solid var(--border)',
                                        transition: 'all 0.25s ease', textAlign: 'center',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,0.1)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                                >
                                    <span style={{ fontSize: 32 }}>{presetIcons[p.label] || '🎨'}</span>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{p.label}</span>
                                    <span style={{ fontSize: 10, color: 'var(--muted-2)', lineHeight: 1.3 }}>点击试试 →</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )
            }

            {/* ★ 结果动画 CSS */}
            <style>{`
                @keyframes imgResultIn {
                    0% { opacity: 0; transform: scale(0.92) translateY(20px); }
                    60% { transform: scale(1.02) translateY(-4px); }
                    100% { opacity: 1; transform: scale(1) translateY(0); }
                }
                .history-send-btn { opacity: 0; transition: opacity 0.2s; }
                div:hover > .history-send-btn { opacity: 1; }
            `}</style>

            {/* 放大预览 */}
            <Modal open={!!zoomUrl} footer={null} onCancel={() => setZoomUrl(null)} width="90%" centered
                styles={{ body: { padding: 0, textAlign: 'center', background: 'var(--bg)' } }}>
                {zoomUrl && <img src={zoomUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '85vh' }} />}
            </Modal>

            {/* 自定义模型配置弹窗 */}
            <Modal
                open={showAddModel}
                title="添加自定义图像生成模型"
                onCancel={() => { setShowAddModel(false); setNewModel({}); }}
                onOk={handleAddModel}
                okText="添加"
                width={480}
            >
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>模型名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <Input
                            placeholder="例如: DALL·E 3、Stable Diffusion XL、Midjourney"
                            value={newModel.name}
                            onChange={e => setNewModel(prev => ({ ...prev, name: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>API Key <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <Input.Password
                            placeholder="sk-... 或 api-..."
                            value={newModel.apiKey}
                            onChange={e => setNewModel(prev => ({ ...prev, apiKey: e.target.value }))}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Base URL（可选）</label>
                        <Input
                            placeholder="https://api.openai.com/v1 (留空使用默认)"
                            value={newModel.baseUrl}
                            onChange={e => setNewModel(prev => ({ ...prev, baseUrl: e.target.value }))}
                        />
                    </div>
                    <Alert type="info" message="API Key 将安全存储在本地浏览器中，不会上传到服务器。" showIcon style={{ fontSize: 11 }} />
                </Space>
            </Modal>
        </div>
    );
};
