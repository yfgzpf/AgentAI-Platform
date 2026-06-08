/**
 * ImageGen - 真接 agentai image API 的图片生成面板
 * 直接在页面上显示生成的图, 不再到文件系统找
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message, Empty } from 'antd';
import { PictureOutlined, ThunderboltOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';

const PRESETS = [
  { label: '📷 写实摄影', prompt: 'cinematic photo, realistic, 8k, highly detailed, natural lighting' },
  { label: '🎨 动漫插画', prompt: 'anime illustration, vibrant colors, studio ghibli style' },
  { label: '🖼️ 油画', prompt: 'oil painting, impressionist, monet style' },
  { label: '🧊 3D 渲染', prompt: '3D render, octane, unreal engine, soft lighting' },
  { label: '🖌️ 水墨', prompt: 'chinese ink wash painting, traditional, minimalist' },
  { label: '👾 像素', prompt: 'pixel art, 16-bit retro game style' },
  { label: '🏰 奇幻', prompt: 'fantasy art, magical, dragons, epic landscape' },
  { label: '🌆 赛博朋克', prompt: 'cyberpunk, neon lights, rain, futuristic city' },
];

const SIZES = [
  { value: '512x512', label: '512x512 (小)' },
  { value: '768x768', label: '768x768 (中)' },
  { value: '1024x1024', label: '1024x1024 (大)' },
  { value: '1024x768', label: '1024x768 (横屏)' },
  { value: '768x1024', label: '768x1024 (竖屏)' },
  { value: '1920x1080', label: '1920x1080 (FHD)' },
];

interface HistoryItem {
  id: string;
  prompt: string;
  url: string;       // /media/... 路径, 可直接 <img src>
  size: string;
  ts: number;
}

const STORAGE_KEY = 'agentai-image-history';

export const ImageGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 从 localStorage 拉历史
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  // 持久化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
    } catch {}
  }, [history]);

  const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

  const gen = async () => {
    if (!prompt.trim()) {
      message.warning('富哥, 写个 prompt 吧~');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(httpUrl + '/v1/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size }),
      });
      const data = await r.json();
      if (data.error) {
        message.error('生成失败: ' + data.error);
        return;
      }
      // data.url 是后端给的 /media 路径
      const item: HistoryItem = {
        id: data.id || `${Date.now()}`,
        prompt,
        url: data.url,
        size,
        ts: Date.now(),
      };
      setCurrent(item);
      setHistory([item, ...history]);
      message.success('🎨 生成成功!');
    } catch (e: any) {
      message.error('网络错误: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  // 图生图
  const handleUpload = async (file: File) => {
    if (!prompt.trim()) {
      message.warning('上传图片后请描述要改的效果');
      return;
    }
    setBusy(true);
    try {
      // 先把图转 base64
      const b64 = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });
      const r = await fetch(httpUrl + '/v1/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size, image: b64, mode: 'img2img' }),
      });
      const data = await r.json();
      if (data.error) { message.error('失败: ' + data.error); return; }
      const item: HistoryItem = {
        id: data.id || `${Date.now()}`,
        prompt: `[图生图] ${prompt}`,
        url: data.url,
        size,
        ts: Date.now(),
      };
      setCurrent(item);
      setHistory([item, ...history]);
      message.success('🖌️ 图生图成功!');
    } catch (e: any) {
      message.error('上传失败: ' + e.message);
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
        title={<Space><PictureOutlined />AI 生图 (Agnes Image 2.1 Flash · 1024x1024 · 7-15s)</Space>}
        extra={
          <Space>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
            />
            <Button size="small" icon={<PictureOutlined />} onClick={() => fileRef.current?.click()}>
              上传参考图
            </Button>
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
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={gen}>
              {busy ? 'AI 画图中...' : '✨ 立即生成'}
            </Button>
          </Space>
        </Space>
      </Card>

      {/* 当前生成结果 */}
      {busy && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#888' }}>AI 正在画图, 通常 7-15 秒...</div>
          <div style={{ marginTop: 4, color: '#666', fontSize: 12 }}>提示: 用 .env 配的真 key 直连 Agnes</div>
        </div>
      )}

      {current && !busy && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={<Space><PictureOutlined />当前结果</Space>}
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
              style={{ maxWidth: '100%', maxHeight: 512, borderRadius: 4 }}
            />
          </div>
          <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
            📝 {current.prompt} · 📐 {current.size} · 🕒 {new Date(current.ts).toLocaleString()}
          </div>
        </Card>
      )}

      {/* 历史画廊 */}
      {history.length > 0 && (
        <Card
          size="small"
          style={{ marginTop: 16 }}
          title={
            <Space>
              <HistoryOutlined />
              <span>历史记录 ({history.length})</span>
            </Space>
          }
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
          <div style={{ marginTop: 8, color: '#666', fontSize: 11 }}>💡 提示: 点击查看大图, 右键下载</div>
        </Card>
      )}

      {!current && !busy && history.length === 0 && (
        <Empty description={<span style={{ color: '#666' }}>还没生成过图片, 上面写 prompt 点生成</span>} style={{ marginTop: 60 }} />
      )}
    </div>
  );
};
