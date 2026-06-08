/**
 * VideoGen - 真接 agentai video API 的视频生成面板
 */
import React, { useState } from 'react';
import { Input, Button, Card, Space, Tag, Alert, Spin, message, Progress } from 'antd';
import { VideoCameraOutlined, ThunderboltOutlined } from '@ant-design/icons';

export const VideoGen: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!prompt.trim()) {
      message.warning('请输入 prompt');
      return;
    }
    setBusy(true);
    setError(null);
    setStatus('submitting');
    try {
      const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');
      const r = await fetch(httpUrl + '/v1/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await r.json();
      if (data.error) {
        setError(data.error);
        setBusy(false);
        return;
      }
      setTaskId(data.taskId);
      setStatus('submitted');
      // 轮询状态
      const poll = async () => {
        for (let i = 0; i < 60; i++) { // 最多 5 分钟
          await new Promise(r => setTimeout(r, 5000));
          try {
            const sr = await fetch(httpUrl + '/v1/video/' + data.taskId);
            const sd = await sr.json();
            if (sd.raw) {
              setStatus(sd.raw.includes('completed') || sd.raw.includes('succeeded') ? 'completed' : 'processing');
              if (sd.raw.includes('failed') || sd.raw.includes('error')) {
                setError('视频生成失败: ' + sd.raw.slice(0, 200));
                setBusy(false);
                return;
              }
              if (sd.raw.includes('completed') || sd.raw.includes('succeeded')) {
                setStatus('completed');
                setBusy(false);
                message.success('视频生成完成!');
                return;
              }
            }
          } catch (e) {
            // 继续轮询
          }
        }
        setStatus('timeout');
        setBusy(false);
      };
      poll();
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Card size="small" title={<Space><VideoCameraOutlined />生视频 (Agnes AI Video v2.0)</Space>}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述要生成的视频 (例如: 'a cat running on the grass, cinematic')"
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={busy}
          />
          <Space wrap>
            <Tag color="purple">5s</Tag>
            <Tag color="cyan">720p</Tag>
            <Tag color="blue">异步任务</Tag>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={busy} onClick={submit}>
              提交任务
            </Button>
          </Space>
          {busy && (
            <div>
              <Progress percent={status === 'completed' ? 100 : 50} status="active" />
              <div style={{ color: '#888', textAlign: 'center' }}>
                <Spin size="small" /> 任务 {taskId} 状态: {status}
              </div>
            </div>
          )}
          {error && <Alert type="error" message="错误" description={error} showIcon />}
          {status === 'completed' && (
            <Alert type="success" message="视频已生成" description="请在 agentai-skills/out/ 目录查找" showIcon />
          )}
        </Space>
      </Card>
    </div>
  );
};
