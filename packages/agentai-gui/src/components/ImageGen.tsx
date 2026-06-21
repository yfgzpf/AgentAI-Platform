/**
 * ImageGen - AI 图片生成面板
 * 引擎: Cogview-3-Flash (智谱免费) 优先 / agnes-image-2.1-flash 降级
 * 共用: ZHIPU_API_KEY (文本/生图/生视频同一 key)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message, Empty, Tooltip, Modal } from 'antd';
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

const SIZES = [
  { value: '512x512', label: '512x512 (小)' },
  { value: '768x768', label: '768x768 (中)' },
  { value: '1024x1024', label: '1024x1024 (大)' },
  { value: '1024x768', label: '1024x768 (横屏)' },
  { value: '768x1024', label: '768x1024 (竖屏)' },
  { value: '1920x1080', label: '1920x1080 (FHD)' },
  // Cogview 专属尺寸
  { value: '768x1344', label: '768x1344 (竖屏)' },
  { value: '864x1152', label: '864x1152' },
  { value: '1344x768', label: '1344x768 (横屏)' },
  { value: '1152x864', label: '1152x864' },
  { value: '1440x720', label: '1440x720 (横屏)' },
  { value: '720x1440', label: '720x1440 (竖屏)' },
];

const MODELS = [
  { value: 'cogview', label: 'Cogview-3-Flash (免费)', desc: '智谱免费, 同 ZHIPU_API_KEY' },
  { value: 'agnes', label: 'Agnes Image 2.1 Flash', desc: '需 AGENTAI_API_KEY' },
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
  const [size, setSize] = useState('1024x1024');
  const [model, setModel] = useState('cogview');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [refImage, setRefImage] = useState<string>(''); // 参考图 base64
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
    try {
      // 有参考图时自动切换到 Agnes (Cogview 不支持图生图)
      const effectiveModel = refImage ? 'agnes' : model;
      const body: any = { prompt, size, model: effectiveModel };
      if (refImage) body.image = refImage; // Data URI
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
        url: data.url,
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
    <div style={{ padding: 16, color: '#fff', height: '100%', overflow: 'auto' }}>
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
              {refImage ? '更换参考图' : '上传参考图'}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 6 * 1024 * 1024) { message.error('参考图不能超过 6MB'); return; }
                const reader = new FileReader();
                reader.onload = () => { setRefImage(reader.result as string); message.success('参考图已加载'); };
                reader.readAsDataURL(file);
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
            <span style={{ color: '#888' }}>🎨 风格:</span>
            {PRESETS.map(p => (
              <Tag key={p.label} color="blue" style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => setPrompt(p.prompt)}>
                {p.label}
              </Tag>
            ))}
          </Space>
          <Space wrap>
            <span style={{ color: '#888' }}>📐 尺寸:</span>
            <Select value={size} onChange={setSize} options={SIZES} style={{ width: 180 }} disabled={busy} />
            <Tooltip title="AI 自动优化提示词">
              <Button size="small" icon={<BulbOutlined />} onClick={() => {
                setPrompt(`masterpiece, best quality, ${prompt}, 8k, ultra detailed, sharp focus`);
              }} disabled={busy}>优化</Button>
            </Tooltip>
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={gen}>
              {busy ? '生成中...' : '生成'}
            </Button>
          </Space>
          {model === 'cogview' && (
            <Alert type="info" message="Cogview-3-Flash 免费模型, 同 ZHIPU_API_KEY。智谱生图/文本/视频共用同一 Key。" style={{ fontSize: 11 }} showIcon />
          )}
          {model === 'agnes' && (
            <Alert type="info" message="Agnes Image 2.1 Flash, 需 AGENTAI_API_KEY。" style={{ fontSize: 11 }} showIcon />
          )}
          {/* 参考图预览 */}
          {refImage && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 8, background: '#1a1a1a', border: '1px solid #333' }}>
              <img src={refImage} alt="参考图" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6 }} />
              <div style={{ flex: 1, fontSize: 12, color: '#999' }}>
                已上传参考图 (图生图)<br />
                <span style={{ fontSize: 11, color: '#666' }}>将自动使用 Agnes Image 引擎生成</span>
              </div>
              <Button size="small" danger onClick={() => setRefImage('')}>移除</Button>
            </div>
          )}
        </Space>
      </Card>

      {busy && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#888' }}>处理中, 通常 7-15 秒...</div>
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
          <div style={{ textAlign: 'center', background: '#0a0a0a', padding: 12, borderRadius: 8 }}>
            <img
              src={current.url}
              alt={current.prompt}
              style={{ maxWidth: '100%', maxHeight: 512, borderRadius: 4, cursor: 'pointer' }}
              onClick={() => setZoomUrl(current.url)}
            />
          </div>
          <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
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
                  border: current?.id === item.id ? '2px solid #4F46E5' : '1px solid #333',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: '#0a0a0a',
                }}
                onClick={() => setCurrent(item)}
                onContextMenu={(e) => { e.preventDefault(); downloadImg(item.url, item.prompt); }}
              >
                <img src={item.url} alt={item.prompt} style={{ width: '100%', height: 180, objectFit: 'cover', display: 'block' }} />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 4, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', color: '#fff', fontSize: 11 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>点击查看大图, 右键下载</div>
        </Card>
      )}

      {!current && !busy && history.length === 0 && (
        <Empty description={<span style={{ color: '#666' }}>还没生成过图片, 上面写 prompt 点生成</span>} style={{ marginTop: 60 }} />
      )}

      {/* 图片放大预览 */}
      <Modal open={!!zoomUrl} footer={null} onCancel={() => setZoomUrl(null)} width="90%" centered
        styles={{ body: { padding: 0, textAlign: 'center', background: '#000' } }}>
        {zoomUrl && <img src={zoomUrl} alt="zoom" style={{ maxWidth: '100%', maxHeight: '85vh' }} />}
      </Modal>
    </div>
  );
};
