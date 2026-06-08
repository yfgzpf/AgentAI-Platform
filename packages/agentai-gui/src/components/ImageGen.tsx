/**
 * ImageGen - 真接 agentai image API 的图片生成面板
 */
import React, { useState } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message } from 'antd';
import { PictureOutlined, ThunderboltOutlined, DownloadOutlined } from '@ant-design/icons';

const PRESETS = [
  { label: '写实摄影', prompt: 'cinematic photo, realistic, 8k, highly detailed' },
  { label: '动漫插画', prompt: 'anime illustration, vibrant colors, studio ghibli style' },
  { label: '油画', prompt: 'oil painting, impressionist, monet style' },
  { label: '3D 渲染', prompt: '3D render, octane, unreal engine, soft lighting' },
  { label: '水墨', prompt: 'chinese ink wash painting, traditional, minimalist' },
  { label: '像素', prompt: 'pixel art, 16-bit retro game style' },
];

const SIZES = ['512x512', '768x768', '1024x1024', '1024x768', '768x1024', '1920x1080'];

export const ImageGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ outputPath: string; ok: boolean; error?: string } | null>(null);

  const gen = async () => {
    if (!prompt.trim()) {
      message.warning('请输入 prompt');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');
      const r = await fetch(httpUrl + '/v1/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, size }),
      });
      const data = await r.json();
      if (data.error) {
        setResult({ ok: false, outputPath: '', error: data.error });
        message.error('生成失败');
      } else {
        setResult({ ok: true, outputPath: data.outputPath });
        message.success('生成成功!');
      }
    } catch (e: any) {
      setResult({ ok: false, outputPath: '', error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Card size="small" title={<Space><PictureOutlined />生图 (Agnes AI Image 2.1)</Space>}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述要生成的图片 (支持中英文, 越详细越好)"
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <Space wrap>
            <span style={{ color: '#888' }}>风格预设:</span>
            {PRESETS.map(p => (
              <Tag key={p.label} color="blue" style={{ cursor: 'pointer' }} onClick={() => setPrompt(p.prompt)}>
                {p.label}
              </Tag>
            ))}
          </Space>
          <Space>
            <span style={{ color: '#888' }}>尺寸:</span>
            <Select value={size} onChange={setSize} options={SIZES.map(s => ({ value: s, label: s }))} style={{ width: 140 }} />
            <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={gen}>
              生成
            </Button>
          </Space>
          {busy && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin /> <span style={{ marginLeft: 8, color: '#888' }}>AI 画图中... (10-30s)</span>
            </div>
          )}
          {result && !result.ok && (
            <Alert type="error" message="生成失败" description={result.error} showIcon />
          )}
          {result && result.ok && (
            <Alert
              type="success"
              message="生成成功"
              description={
                <Space direction="vertical">
                  <code style={{ background: '#1a1a1a', padding: 4, borderRadius: 4, display: 'block' }}>
                    {result.outputPath}
                  </code>
                  <Button size="small" icon={<DownloadOutlined />} onClick={() => {
                    message.info('请手动打开路径: ' + result.outputPath);
                  }}>
                    打开文件
                  </Button>
                </Space>
              }
              showIcon
            />
          )}
        </Space>
      </Card>
    </div>
  );
};
