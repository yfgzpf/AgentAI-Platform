/**
 * VideoGen - 真接 agentai video API 的视频生成面板
 * 视频直接在页面上播放, 不用到文件系统
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Card, Space, Tag, Alert, Spin, message, Progress, Empty } from 'antd';
import { VideoCameraOutlined, ThunderboltOutlined, DownloadOutlined, HistoryOutlined, ReloadOutlined, DeleteOutlined } from '@ant-design/icons';

const PRESETS = [
  { label: '🌅 风景', prompt: 'A cinematic sunset over a misty mountain valley, soft golden light, camera slowly panning' },
  { label: '🐱 动物', prompt: 'A cute orange cat playing with a ball of yarn in a cozy living room, natural lighting' },
  { label: '🌊 海洋', prompt: 'Aerial view of ocean waves crashing on a sandy beach at golden hour, drone shot' },
  { label: '🏙️ 城市', prompt: 'Cyberpunk city street at night, rain-soaked neon reflections, person walking with umbrella' },
  { label: '🚀 科幻', prompt: 'A spaceship flying through colorful nebula in deep space, stars twinkling' },
  { label: '🌸 植物', prompt: 'Time-lapse of a cherry blossom tree blooming, soft pink petals falling in the wind' },
];

const DURATIONS = [
  { value: '5s', label: '⏱ 5s (快)', frames: 121, fps: 24 },
  { value: '10s', label: '⏱ 10s (标准)', frames: 241, fps: 24 },
  { value: '18s', label: '⏱ 18s (长)', frames: 441, fps: 24 },
];

interface HistoryItem {
  id: string;
  prompt: string;
  taskId: string;
  videoUrl: string | null;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  ts: number;
}

const STORAGE_KEY = 'agentai-video-history';

export const VideoGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState('5s');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const pollRef = useRef<number | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 30)));
    } catch {}
  }, [history]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

  const pollTask = (taskId: string, item: HistoryItem) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const r = await fetch(`${httpUrl}/v1/video/${taskId}`);
        const data = await r.json();
        // 解析 raw (JSON 字符串)
        let parsed: any = {};
        try { parsed = JSON.parse(data.raw || '{}'); } catch {}
        const newStatus = (parsed.status || 'queued') as HistoryItem['status'];
        const newProgress = typeof parsed.progress === 'number' ? parsed.progress : 0;
        // video_url 是 google storage 远程 URL, remixed_from_video_id 才是真
        const remoteUrl = parsed.video_url || parsed.remixed_from_video_id || null;
        const updated: HistoryItem = { ...item, status: newStatus, progress: newProgress, videoUrl: remoteUrl };
        setCurrent(updated);
        setHistory(prev => prev.map(h => h.id === item.id ? updated : h));
        if (newStatus === 'completed' || newStatus === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          if (newStatus === 'completed') {
            message.success('🎬 视频生成完成!');
          } else {
            message.error('视频生成失败');
          }
        }
      } catch {
        // 继续轮询
      }
    }, 3000);
  };

  const submit = async (imageUrl?: string) => {
    if (!prompt.trim()) {
      message.warning('富哥, 写个视频描述吧~');
      return;
    }
    setBusy(true);
    try {
      const dur = DURATIONS.find(d => d.value === duration);
      const body: any = {
        prompt,
        num_frames: dur?.frames || 121,
        frame_rate: dur?.fps || 24,
      };
      if (imageUrl) body.image = imageUrl;
      const r = await fetch(httpUrl + '/v1/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) { message.error('提交失败: ' + data.error); setBusy(false); return; }
      const item: HistoryItem = {
        id: `${Date.now()}`,
        prompt: imageUrl ? `[图生视频] ${prompt}` : prompt,
        taskId: data.taskId || data.task_id || `${Date.now()}`,
        videoUrl: null,
        status: 'queued',
        progress: 0,
        ts: Date.now(),
      };
      setCurrent(item);
      setHistory([item, ...history]);
      pollTask(item.taskId, item);
      message.info(`📨 任务已提交: ${item.taskId.slice(0, 16)}...`);
    } catch (e: any) {
      message.error('网络错误: ' + e.message);
      setBusy(false);
    }
  };

  // 图生视频
  const handleUpload = async (file: File) => {
    if (!prompt.trim()) {
      message.warning('先写描述要做什么动画');
      return;
    }
    const b64 = await new Promise<string>((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    submit(b64);
  };

  return (
    <div style={{ padding: 16, color: '#fff', height: '100%', overflow: 'auto' }}>
      <Card
        size="small"
        title={<Space><VideoCameraOutlined />AI 生视频 (Agnes Video v2.0 · 异步任务 · 30s-3min)</Space>}
        extra={
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
          />
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述视频内容, 越详细越好. 例: 'a cat walking on the beach at sunset, cinematic, soft golden lighting'"
            autoSize={{ minRows: 2, maxRows: 5 }}
            size="large"
            disabled={busy}
          />
          <Space wrap>
            <span style={{ color: '#888' }}>🎬 场景:</span>
            {PRESETS.map(p => (
              <Tag key={p.label} color="purple" style={{ cursor: 'pointer', padding: '4px 8px' }} onClick={() => setPrompt(p.prompt)}>
                {p.label}
              </Tag>
            ))}
          </Space>
          <Space wrap>
            <span style={{ color: '#888' }}>⏱ 时长:</span>
            {DURATIONS.map(d => (
              <Tag.CheckableTag
                key={d.value}
                checked={duration === d.value}
                onChange={() => setDuration(d.value)}
              >
                {d.label}
              </Tag.CheckableTag>
            ))}
            <Button size="small" icon={<VideoCameraOutlined />} onClick={() => imgRef.current?.click()} disabled={busy}>
              🖼️ 图生视频
            </Button>
            <Button type="primary" size="large" icon={<ThunderboltOutlined />} loading={busy} onClick={() => submit()}>
              {busy ? '提交中...' : '✨ 提交生成'}
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
            <div style={{ textAlign: 'center', background: '#0a0a0a', padding: 12, borderRadius: 8 }}>
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
              <div style={{ color: '#888' }}>
                {current.status === 'queued' && '🕒 排队中 (5s-3min)...'}
                {current.status === 'in_progress' && '🎨 AI 渲染中...'}
              </div>
            </div>
          )}
          <div style={{ marginTop: 8, color: '#888', fontSize: 12 }}>
            📝 {current.prompt} · 🆔 {current.taskId.slice(0, 24)}...
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
                  border: current?.id === item.id ? '2px solid #9333EA' : '1px solid #333',
                  borderRadius: 4,
                  overflow: 'hidden',
                  background: '#000',
                  aspectRatio: '16/9',
                }}
              >
                {item.videoUrl ? (
                  <video src={item.videoUrl} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666' }}>
                    <Spin size="small" />
                  </div>
                )}
                <div style={{ position: 'absolute', top: 4, right: 4 }}>
                  <Tag color={item.status === 'completed' ? 'green' : item.status === 'failed' ? 'red' : 'blue'}>
                    {item.status === 'completed' ? '✓' : item.status === 'failed' ? '✗' : `${item.progress}%`}
                  </Tag>
                </div>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 4, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', color: '#fff', fontSize: 11 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.prompt}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!current && history.length === 0 && !busy && (
        <Empty description={<span style={{ color: '#666' }}>还没生成过视频, 上面写 prompt 提交</span>} style={{ marginTop: 60 }} />
      )}
    </div>
  );
};
