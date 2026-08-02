/**
 * ImageGen - AI 图片生成面板 v2.1
 * 引擎: Agnes Image 2.1 Flash (首选) / Cogview-3-Flash (智谱免费) 降级
 * 
 * Agnes Image 2.1 Flash 参数规范:
 *   - size: 1K, 2K, 3K, 4K (档位式)
 *   - ratio: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9
 *   - API: https://api.agnes-ai.cn/v1/images/generations
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message, Empty, Tooltip, Modal, Progress } from 'antd';
import { PictureOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined, DeleteOutlined, SendOutlined, SwapOutlined, BulbOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const PRESETS = [
  { label: '写实摄影', prompt: 'cinematic photo, realistic, 8k, highly detailed, natural lighting' },
  { label: '动漫插画', prompt: 'anime illustration, vibrant colors, studio ghibli style' },
  { label: '油画', prompt: 'oil painting, impressionist, monet style' },
  { label: '3D 渲染', prompt: '3D render, octane, unreal engine, soft lighting' },
  { label: '水墨', prompt: 'chinese ink wash painting, traditional, minimalist' },
  { label: '像素', prompt: 'pixel art, 16-bit retro game style' },
  { label: '奇幻', prompt: 'fantasy art, magical, dragons, epic landscape' },
  { label: '赛博朋克', prompt: 'cyberpunk, neon lights, rain, futuristic city' },
  { label: '室内设计', prompt: 'interior design, modern living room, natural light, 8k render, minimalist' },
  { label: '电影海报', prompt: 'movie poster, cinematic, dramatic lighting, 4k, typography' },
  { label: '国风插画', prompt: 'chinese traditional painting, ink wash, elegant, silk texture' },
  { label: '产品摄影', prompt: 'product photography, white background, studio lighting, commercial' },
];

// Agnes Image 2.1 Flash 档位式尺寸
const SIZES = [
  { value: '1K', label: '1K (1024x1024)', desc: '快速生成, 适合预览' },
  { value: '2K', label: '2K (2048x2048)', desc: '高清质量, 推荐' },
  { value: '3K', label: '3K (3072x3072)', desc: '超高清, 细节丰富' },
  { value: '4K', label: '4K (4096x4096)', desc: '最高质量, 大文件' },
];

// Agnes Image 2.1 Flash 支持的宽高比
const RATIOS = [
  { value: '1:1', label: '1:1 (正方形)', desc: '1024x1024 / 2048x2048' },
  { value: '16:9', label: '16:9 (宽屏)', desc: '1312x736 / 2624x1472' },
  { value: '9:16', label: '9:16 (竖屏)', desc: '736x1312 / 1472x2624' },
  { value: '4:3', label: '4:3 (标准)', desc: '1152x864 / 2304x1728' },
  { value: '3:4', label: '3:4 (竖版)', desc: '864x1152 / 1728x2304' },
  { value: '3:2', label: '3:2 (相机)', desc: '1248x832 / 2496x1664' },
  { value: '2:3', label: '2:3 (竖相机)', desc: '832x1248 / 1664x2496' },
  { value: '21:9', label: '21:9 (超宽)', desc: '1568x672 / 3136x1344' },
];

const MODELS = [
  { value: 'agnes', label: 'Agnes Image 2.1 Flash (推荐)', desc: '高信息密度, 构图保留, 需 AGENTAI_API_KEY' },
  { value: 'cogview', label: 'Cogview-3-Flash (免费)', desc: '智谱免费, 同 ZHIPU_API_KEY' },
];

interface HistoryItem {
  id: string;
  prompt: string;
  url: string;
  size: string;
  ts: number;
  provider?: string;
}

const STORAGE_KEY = 'agentai-image-history';

export const ImageGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('2K'); // Agnes Image 2.1 Flash 档位式尺寸
  const [ratio, setRatio] = useState('1:1'); // 宽高比
  const [model, setModel] = useState('agnes'); // 默认使用 Agnes Image 2.1 Flash
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]); // 多图参考 base64 数组
  const [fakeProgress, setFakeProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
    } catch {}
  }, [history]);

  const httpUrl = GATEWAY_HTTP;

  const gen = async () => {
    if (!prompt.trim()) {
      message.warning('写个 prompt 吧~~');
      return;
    }
    setBusy(true);
    setFakeProgress(0);
    // 假进度动画: 0 → 100, 15秒内完成
    const progressTimer = setInterval(() => {
      setFakeProgress((prev: number) => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 5 + 2;
      });
    }, 500);
    try {
      // 有参考图时自动切换到 Agnes (Cogview 不支持图生图)
      const effectiveModel = refImages.length > 0 ? 'agnes' : model;
      const body: any = { prompt, size, ratio, model: effectiveModel };
      if (refImages.length > 0) body.image = refImages; // 多图数组
      const r = await fetch(httpUrl + '/v1/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) {
        message.error('生成失败: ' + data.error);
        return;
      }
      const item: HistoryItem = {
        id: `${Date.now()}`,
        prompt,
        url: data.url?.startsWith('/') ? httpUrl + data.url : data.url,
        size,
        ts: Date.now(),
        provider: data.provider,
      };
      setCurrent(item);
      setHistory([item, ...history]);
      message.success('🎨 生成成功! 引擎: ' + (data.provider || 'unknown'));
    } catch (e: any) {
      message.error('网络错误: ' + e.message);
    } finally {
      clearInterval(progressTimer);
      setFakeProgress(100);
      setBusy(false);
    }
  };

  const downloadImg = (url: string, prompt: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `agentai-${Date.now()}.png`;
    a.click();
  };

  return (
    <div style={{ padding: 16, color: 'var(--fg)', height: '100%', overflow: 'auto' }}>
      <Card
        size="small"
        title={<Space><PictureOutlined />AI 生图</Space>}
        extra={
          <Space>
            <Select
              size="small"
              value={model}
              onChange={setModel}
              style={{ width: 220 }}
              options={MODELS.map(m => ({ value: m.value, label: m.label }))}
            />
            <Button size="small" icon={<PictureOutlined />} onClick={() => fileRef.current?.click()}>
              {refImages.length > 0 ? `已选 ${refImages.length} 张` : '上传参考图'}
            </Button>
            {refImages.length > 0 && <Button size="small" danger onClick={() => setRefImages([])}>清除全部</Button>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                const newImages: string[] = [];
                let loaded = 0;
                for (let i = 0; i < Math.min(files.length, 5); i++) {
                  const file = files[i];
                  if (file.size > 6 * 1024 * 1024) { message.error(`${file.name} 超过 6MB，已跳过`); continue; }
                  const reader = new FileReader();
                  reader.onload = () => {
                    newImages.push(reader.result as string);
                    loaded++;
                    if (loaded >= Math.min(files.length, 5)) {
                      setRefImages(prev => [...prev, ...newImages].slice(0, 5));
                      message.success(`已加载 ${newImages.length} 张参考图`);
                    }
                  };
                  reader.readAsDataURL(file);
                }
                e.target.value = '';
              }}
            />
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述要生成的图片, 比如: 一只橙色小猫在阳光下的窗台上, 写实摄影风格"
            autoSize={{ minRows: 2, maxRows: 5 }}
            size="large"
            disabled={busy}
          />
          <Space wrap>
            <span style={{ color: 'var(--muted)' }}>🎨 风格:</span>
            {PRESETS.map(p => (
              <Tag key={p.label} color="blue" style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => setPrompt(p.prompt)}>
                {p.label}
              </Tag>
            ))}
          </Space>
          <Space wrap>
            <span style={{ color: 'var(--muted)' }}>📐 档位:</span>
            <Select value={size} onChange={setSize} options={SIZES} style={{ width: 100 }} disabled={busy} />
            <span style={{ color: 'var(--muted)' }}>📏 比例:</span>
            <Select value={ratio} onChange={setRatio} options={RATIOS} style={{ width: 100 }} disabled={busy} />
            <Tooltip title="AI 自动优化提示词">
              <Button size="small" icon={<BulbOutlined />} onClick={() => {
                setPrompt(`masterpiece, best quality, ${prompt}, 8k, ultra detailed, sharp focus`);
              }} disabled={busy}>优化</Button>
            </Tooltip>
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={gen}>
              {busy ? '生成中...' : '生成'}
            </Button>
          </Space>
{/* NVIDIA qwen-image alert 已移除 */}
          {model === 'cogview' && (
            <Alert type="info" message="Cogview-3-Flash 免费模型, 同 ZHIPU_API_KEY。智谱生图/文本/视频共用同一 Key。" style={{ fontSize: 11 }} showIcon />
          )}
          {model === 'agnes' && (
            <Alert type="info" message={`Agnes Image 2.1 Flash | 档位: ${size} | 比例: ${ratio} | 需 AGENTAI_API_KEY`} style={{ fontSize: 11 }} showIcon />
          )}
          {/* 参考图预览 (多图) */}
          {refImages.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', flexWrap: 'wrap' }}>
              {refImages.map((img, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={img} alt={`参考图${i + 1}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                  <span
                    onClick={() => setRefImages(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%', background: 'var(--danger)', color: 'var(--fg)', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    ×
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: 'var(--muted-2)', marginLeft: 4 }}>
                {refImages.length} 张参考图 · 图生图模式<br />
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>自动使用 Agnes 2.0 引擎 · 最多 5 张</span>
              </div>
            </div>
          )}
        </Space>
      </Card>

      {busy && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <Progress 
            percent={Math.min(fakeProgress, 95)} 
            status="active" 
            style={{ maxWidth: 400, margin: '16px auto' }} 
          />
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>🎨 AI 绘画中，通常 7-15 秒...</div>
        </div>
      )}

      {current && !busy && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={<Space><PictureOutlined />当前结果 <Tag>{current.provider || 'unknown'}</Tag></Space>}
          extra={
            <Space>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadImg(current.url, current.prompt)}>下载</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={gen}>再来一张</Button>
            </Space>
          }
        >
          <div style={{ textAlign: 'center', background: 'var(--panel)', padding: 12, borderRadius: 8 }}>
            <img
              src={current.url}
              alt={current.prompt}
              style={{ maxWidth: '100%', maxHeight: 512, borderRadius: 4, cursor: 'pointer' }}
              onClick={() => setZoomUrl(current.url)}
            />
          </div>
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 12 }}>
            📝 {current.prompt} · 📐 {current.size} · 🕒 {new Date(current.ts).toLocaleString()}
          </div>
        </Card>
      )}

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
            {history.map((item) => (
              <div
                key={item.id}
                style={{
                  position: 'relative',
                  cursor: 'pointer',
                  border: current?.id === item.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: 'var(--panel)',
                }}
                onClick={() => setCurrent(item)}
                onContextMenu={(e) => { e.preventDefault(); downloadImg(item.url, item.prompt); }}
              >
                <img src={item.url} alt={item.prompt} style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 4, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', color: 'var(--fg)', fontSize: 11 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 11 }}>点击查看大图, 右键下载</div>
        </Card>
      )}

      {!current && !busy && history.length === 0 && (
        <Empty description={<span style={{ color: 'var(--muted)' }}>还没生成过图片, 上面写 prompt 点生成</span>} style={{ marginTop: 60 }} />
      )}

      {/* 图片放大预览 */}
      <Modal open={!!zoomUrl} footer={null} onCancel={() => setZoomUrl(null)} width="90%" centered
        styles={{ body: { padding: 0, textAlign: 'center', background: 'var(--bg)' } }}>
        {zoomUrl && <img src={zoomUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '85vh' }} />}
      </Modal>
    </div>
  );
};
