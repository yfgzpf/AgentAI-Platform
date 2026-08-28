/**
 * VideoGen - AI 视频生成面板
 * 引擎: CogVideoX-Flash (智谱免费) 优先 / Agnes Video V2.0 降级
 * 共用: ZHIPU_API_KEY (文本/生图/生视频同一 key)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Card, Space, Tag, Alert, Spin, message, Progress, Select, Modal, Checkbox, Divider } from 'antd';
import { VideoCameraOutlined, DownloadOutlined, HistoryOutlined, DeleteOutlined, PlusOutlined, InfoCircleOutlined, BulbOutlined, UploadOutlined, PlayCircleOutlined, RedoOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { useModelStore } from '../store/modelStore';
import { apiPost } from '../services/api';

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

const PRESET_CATEGORIES = ['全部', '自然', '人文'];

const DURATIONS = [
  { value: '3s', label: '3秒 (快速)', frames: 73, fps: 24 },
  { value: '5s', label: '5s (快)', frames: 121, fps: 24 },
  { value: '8s', label: '8秒', frames: 193, fps: 24 },
  { value: '10s', label: '10s (标准)', frames: 241, fps: 24 },
  { value: '18s', label: '18s (长)', frames: 441, fps: 24 },
];

const MODELS = [
    { value: 'cogvideo', label: 'CogVideoX-Flash (免费)', desc: '智谱免费, 同 ZHIPU_API_KEY' },
    { value: 'agnes', label: 'Agnes Video V2.0', desc: '需 AGENTAI_API_KEY' },
    // NVIDIA Cosmos 已移除 (NIM 不可用)
    { value: 'wanx', label: '通义万相 (免费500条)', desc: '阿里 DashScope, 需 DASHSCOPE_API_KEY, 文/图生视频' },
    { value: 'runway-gen3', label: 'Runway Gen-3', desc: '需 RUNWAY_API_KEY, 专业级视频生成' },
    { value: 'pika', label: 'Pika Labs', desc: '需 PIKA_API_KEY, AI视频生成新秀' },
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
        const raw = localStorage.getItem('agentai-custom-video-models');
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveCustomModels = (models: CustomModel[]) => {
    localStorage.setItem('agentai-custom-video-models', JSON.stringify(models));
};

interface HistoryItem {
  id: string;
  prompt: string;
  taskId: string;
  videoUrl: string | null;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  ts: number;
  provider?: string;
}

const STORAGE_KEY = 'agentai-video-history';

export const VideoGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5s');
  const [model, setModel] = useState('cogvideo');
  const [busy, setBusy] = useState(false);
  const [presetCategory, setPresetCategory] = useState('全部');
  // ★ 四维润色
  const [dimensions, setDimensions] = useState<string[]>(['action', 'atmosphere', 'quality']);
  const [optimizing, setOptimizing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [firstFrame, setFirstFrame] = useState<string>(''); // 首帧 base64
  const [lastFrame, setLastFrame] = useState<string>('');  // 尾帧 base64
  const pollRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);

  // 自定义模型状态
  const [customModels, setCustomModels] = useState<CustomModel[]>(getCustomModels());
  const [showAddModel, setShowAddModel] = useState(false);
  const [newModel, setNewModel] = useState<Partial<CustomModel>>({});

  // 合并内置模型和自定义模型
  const videoModels = useModelStore.getState().models.filter(m => m.modelType === 'video' && m.enabled);
  const allModelOptions = [
    ...MODELS.map(m => ({ value: m.value, label: m.label })),
    ...videoModels.map(m => ({ value: m.id, label: `${m.label}${m.freeQuotaNote ? ' ' + m.freeQuotaNote : ''}` })),
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
    message.success(`已添加视频模型: ${model.name}`);
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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
    // ★ 读取跨页首帧 (从 ImageStudio 发送过来)
    try {
      const crossFrame = localStorage.getItem('agentai-video-firstframe');
      if (crossFrame) {
        setFirstFrame(crossFrame);
        localStorage.removeItem('agentai-video-firstframe');
        message.info('📸 已从图像工作室接收首帧图片');
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 30)));
    } catch {}
  }, [history]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const httpUrl = GATEWAY_HTTP;

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
        setPrompt(data.enhanced);
        message.success('✨ AI 已优化提示词');
      } else {
        // 降级: 本地增强
        const enhancers: string[] = [];
        let enhanced = prompt;
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
    setCurrent(null);
    setBusy(false);
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const pollTask = (taskId: string, item: HistoryItem) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`${httpUrl}/v1/video/${taskId}`);
        const data = await r.json();
        let parsed: any = {};
        try { parsed = JSON.parse(data.raw || '{}'); } catch {}
        const newStatus = (parsed.status || 'queued') as HistoryItem['status'];
        const newProgress = typeof parsed.progress === 'number' ? parsed.progress : 0;
        const remoteUrl = parsed.video_url || parsed.remixed_from_video_id || null;
        const updated: HistoryItem = { ...item, status: newStatus, progress: newProgress, videoUrl: remoteUrl };
        setCurrent(updated);
        setHistory(prev => prev.map(h => h.id === item.id ? updated : h));
        if (newStatus === 'completed' || newStatus === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          if (newStatus === 'completed') message.success('🎬 视频生成完成!');
          else message.error('视频生成失败');
        }
      } catch { /* retry */ }
    }, 3000);
  };

  const submit = async (imageUrl?: string) => {
    if (!prompt.trim()) {
      message.warning('写个视频描述吧~');
      return;
    }
    setBusy(true);
    try {
      const dur = DURATIONS.find(d => d.value === duration);
      const body: any = {
        prompt,
        num_frames: dur?.frames || 121,
        frame_rate: dur?.fps || 24,
        model,
      };
      // 优先使用直传参数, 否则使用首帧状态
      const img = imageUrl || firstFrame;
      if (img) body.image = img;
      if (lastFrame) body.end_frame = lastFrame;
      const r = await fetch(httpUrl + '/v1/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) { message.error('提交失败: ' + data.error); setBusy(false); return; }
      const modeLabel = lastFrame ? '[首尾帧]' : img ? '[图生视频]' : '';
      const item: HistoryItem = {
        id: `${Date.now()}`,
        prompt: modeLabel ? `${modeLabel} ${prompt}` : prompt,
        taskId: data.taskId || `${Date.now()}`,
        videoUrl: null,
        status: 'queued',
        progress: 0,
        ts: Date.now(),
        provider: data.provider,
      };
      setCurrent(item);
      setHistory([item, ...history]);
      pollTask(item.taskId, item);
      message.info(`📨 (${data.provider || model}) 任务已提交`);
    } catch (e: any) {
      message.error('网络错误: ' + e.message);
      setBusy(false);
    }
  };

  const handleUpload = async (file: File) => {
    if (!prompt.trim()) { message.warning('先写描述'); return; }
    const b64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    submit(b64);
  };

return (
<div style={{ padding: '8px 12px', color: 'var(--fg)', height: '100%', overflow: 'auto' }}>
      <Card
        size="small"
        title={<Space><VideoCameraOutlined />AI 生视频</Space>}
        extra={
          <Space>
  <Select
    size="small"
    value={model}
    onChange={setModel}
    style={{ width: 240 }}
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
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* ★ 步骤 1: 描述 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>输入视频描述</span>
          </div>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述视频内容, 越详细越好. 例: 'a cat walking on the beach at sunset, cinematic, soft golden lighting'"
            autoSize={{ minRows: 2, maxRows: 5 }}
            size="large"
            disabled={busy}
          />
          <Space wrap>
            <span style={{ color: 'var(--muted)' }}>🎬 场景:</span>
            {/* ★ 分类筛选 */}
            {PRESET_CATEGORIES.map(cat => (
              <Tag.CheckableTag key={cat} checked={presetCategory === cat} onChange={() => setPresetCategory(cat)}>
                {cat}
              </Tag.CheckableTag>
            ))}
          </Space>
          {/* ★ 场景预设卡片化 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 6 }}>
            {PRESETS.filter(p => presetCategory === '全部' || p.category === presetCategory).map(p => {
              const presetIcons: Record<string, string> = {
                '风景': '🏔️', '动物': '🐱', '海洋': '🌊', '植物': '🌸', '城市': '🌃', '科幻': '🚀',
                '电影感': '🎬', '建筑漫游': '🏛️', '美食': '🍜', '时尚': '👗', '运动': '⚽',
                '烟花': '🎆', '水下': '🐠', '星空': '🌌', '极光': '❄️',
              };
              const active = prompt === p.prompt;
              return (
                <button key={p.label}
                  onClick={() => setPrompt(p.prompt)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 10px', borderRadius: 8, fontSize: 12,
                    background: active ? 'rgba(139,92,246,0.15)' : 'var(--panel)',
                    border: `1px solid ${active ? '#8b5cf6' : 'var(--border)'}`,
                    color: active ? '#8b5cf6' : 'var(--fg-2)',
                    cursor: 'pointer', textAlign: 'left',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: 15 }}>{presetIcons[p.label] || '🎬'}</span>
                  <span style={{ fontWeight: 600 }}>{p.label}</span>
                </button>
              );
            })}
          </div>

          {/* ★ 四维润色面板 */}
          <div style={{ padding: 12, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>✨ 提示词四维润色</span>
              <Button size="small" icon={<BulbOutlined />} loading={optimizing} onClick={optimizePrompt}
                disabled={!prompt.trim() || busy}
                style={{ borderRadius: 6 }}
              >{optimizing ? '润色中...' : '一键润色'}</Button>
            </div>
            <Checkbox.Group value={dimensions} onChange={(vals) => setDimensions(vals as string[])}
              style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
            >
              <Checkbox value="action" style={{ fontSize: 12 }}>🏃 动作增强</Checkbox>
              <Checkbox value="atmosphere" style={{ fontSize: 12 }}>🌅 氛围渲染</Checkbox>
              <Checkbox value="quality" style={{ fontSize: 12 }}>💎 质量提升</Checkbox>
              <Checkbox value="style" style={{ fontSize: 12 }}>🎬 风格化</Checkbox>
            </Checkbox.Group>
          </div>

          <Divider style={{ margin: '4px 0' }} />

          {/* ★ 步骤 2: 设置 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>选择时长与首尾帧</span>
          </div>
          <Space wrap>
            <span style={{ color: 'var(--muted)' }}>⏱ 时长:</span>
            {DURATIONS.map(d => (
              <Tag.CheckableTag
                key={d.value}
                checked={duration === d.value}
                onChange={() => setDuration(d.value)}
              >
                {d.label}
              </Tag.CheckableTag>
            ))}
          </Space>
          <Space wrap>
            <Button size="small" icon={<UploadOutlined />} onClick={() => imgRef.current?.click()} disabled={busy}>
              {firstFrame ? '更换首帧' : '上传首帧'}
            </Button>
            <Button size="small" icon={<UploadOutlined />} onClick={() => lastFrameRef.current?.click()} disabled={busy || !firstFrame}>
              {lastFrame ? '更换尾帧' : '上传尾帧'}
            </Button>
            {(firstFrame || lastFrame) && <Button size="small" danger onClick={() => { setFirstFrame(''); setLastFrame(''); }}>清除图片</Button>}
            <input ref={imgRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setFirstFrame(r.result as string); r.readAsDataURL(f); e.target.value = ''; }} />
            <input ref={lastFrameRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setLastFrame(r.result as string); r.readAsDataURL(f); e.target.value = ''; }} />
          </Space>
          {model === 'cogvideo' && (
            <Alert message="CogVideoX-3 免费模型, 同 ZHIPU_API_KEY。支持: 文生视频 / 图生视频 / 首尾帧生视频" style={{ fontSize: 11, background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }} showIcon icon={<InfoCircleOutlined />} />
          )}
          {/* ★ 跨页首帧提示 */}
          {firstFrame && (
            <div style={{ display: 'flex', gap: 12, padding: 8, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>首帧</div>
                <img src={firstFrame} alt="首帧" style={{ width: 100, height: 60, objectFit: 'cover', borderRadius: 4 }} />
              </div>
              {lastFrame ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>尾帧</div>
                  <img src={lastFrame} alt="尾帧" style={{ width: 100, height: 60, objectFit: 'cover', borderRadius: 4 }} />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--muted)' }}>
                  可选: 上传尾帧 → 生成首尾帧过渡视频
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'var(--muted-2)', flex: 1 }}>
                {lastFrame ? '首尾帧模式: AI 将生成从首帧到尾帧的过渡视频' : '图生视频模式: AI 将基于此图生成动态视频'}
              </div>
            </div>
          )}
          {model === 'agnes' && (
            <Alert message={`Agnes Video V2.0 | 时长: ${duration} | 帧率: 24fps | 需 AGENTAI_API_KEY`} style={{ fontSize: 11, background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }} showIcon icon={<InfoCircleOutlined />} />
          )}

          <Divider style={{ margin: '4px 0' }} />

          {/* ★ 步骤 3: 生成 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>3</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>生成视频</span>
            <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>预计 {duration === '3s' ? '1-2 分钟' : duration === '5s' ? '2-3 分钟' : '3-5 分钟'}</span>
          </div>
          <Space>
            <Button type="primary" size="large" icon={<PlayCircleOutlined />} loading={busy} onClick={() => submit()}
              disabled={!prompt.trim() || busy}
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                border: 'none', borderRadius: 10, padding: '0 32px',
                boxShadow: '0 4px 16px rgba(99,102,241,0.3)',
              }}
            >
              {busy ? '提交中...' : '生成视频'}
            </Button>
            {/* ★ 重置按钮 */}
            <Button size="large" icon={<RedoOutlined />} onClick={resetAll} disabled={busy}>
              重置
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 当前结果 */}
      {current && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={
            <Space>
              {current.status === 'completed' ? '🎬 已生成' : current.status === 'failed' ? '❌ 失败' : '⏳ 生成中'}
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
            <div style={{ textAlign: 'center', background: 'var(--panel)', padding: 12, borderRadius: 8, animation: 'videoResultIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
              <video
                src={current.videoUrl}
                controls
                autoPlay
                loop
                style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }}
              />
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <Progress percent={current.progress} status="active" style={{ maxWidth: 400, margin: '16px auto' }} />
              <div style={{ color: 'var(--muted)' }}>
                {current.status === 'queued' && '🕒 排队中...'}
                {current.status === 'in_progress' && '🎨 AI 渲染中...'}
              </div>
              {/* ★ 预估时间提示 */}
              {current.status === 'in_progress' && current.progress > 0 && current.progress < 100 && (
                <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>
                  预计还需约 {Math.max(5, Math.ceil((100 - current.progress) * 0.8))} 秒
                </div>
              )}
            </div>
          )}
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
            {current.prompt} · {current.taskId.slice(0, 24)}...
          </div>
        </Card>
      )}

      {/* 历史 */}
      {history.length > 0 && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={<Space><HistoryOutlined />历史记录 ({history.length})</Space>}
          extra={
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => { setHistory([]); setCurrent(null); }}>
              清空
            </Button>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {history.map(item => (
              <div
                key={item.id}
                onClick={() => setCurrent(item)}
                style={{
                  cursor: 'pointer',
                  position: 'relative',
                  border: current?.id === item.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: 'var(--bg)',
                  aspectRatio: '16/9',
                }}
              >
                {item.videoUrl ? (
                  <video src={item.videoUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)' }}>
                    <Spin size="small" />
                  </div>
                )}
                <div style={{ position: 'absolute', top: 4, right: 4 }}>
                  <Tag color={item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'blue'}>
                    {item.status === 'completed' ? '✓' : item.status === 'failed' ? '✗' : `${item.progress}%`}
                  </Tag>
                </div>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 4, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', color: 'var(--fg)', fontSize: 11 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!current && history.length === 0 && !busy && (
        <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--fg)', marginBottom: 6 }}>
            AI 视频生成
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted-2)', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
            输入视频描述，选择场景预设，点击生成即可创建 AI 视频。支持文生视频 / 图生视频 / 首尾帧过渡
          </div>
          {/* 灵感画廊 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, maxWidth: 500, margin: '0 auto' }}>
            {PRESETS.slice(0, 6).map(p => {
              const presetIcons: Record<string, string> = {
                '风景': '🏔️', '动物': '🐱', '海洋': '🌊', '植物': '🌸', '城市': '🌃', '科幻': '🚀',
              };
              return (
                <button key={p.label}
                  onClick={() => setPrompt(p.prompt)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '20px 12px', borderRadius: 12, cursor: 'pointer',
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    transition: 'all 0.25s ease', textAlign: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(99,102,241,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <span style={{ fontSize: 32 }}>{presetIcons[p.label] || '🎬'}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>{p.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--muted-2)', lineHeight: 1.3 }}>点击试试 →</span>
                </button>
              );
            })}
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
        title="添加自定义视频生成模型"
        onCancel={() => { setShowAddModel(false); setNewModel({}); }}
        onOk={handleAddModel}
        okText="添加"
        width={480}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>模型名称 <span style={{ color: 'var(--danger)' }}>*</span></label>
            <Input
              placeholder="例如: Runway Gen-3、Pika Labs、Seedance"
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
              placeholder="https://api.runwayml.com/v1 (留空使用默认)"
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
