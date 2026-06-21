/**
 * Model3DGen — 3D 模型生成面板
 * 引擎: 腾讯混元3D + 豆包 Seed3D
 * 密钥由用户输入, 缓存在 localStorage
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message, Empty, Tooltip, Progress } from 'antd';
import { AppstoreOutlined, DownloadOutlined, UploadOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

const PROVIDERS = [
  { value: 'doubao', label: '豆包 Seed3D 2.0', desc: '火山引擎 ARK_API_KEY, 图生3D', keyLabel: 'ARK API Key', keyStorage: 'agentai.3d.ark-key' },
  { value: 'hunyuan', label: '腾讯混元3D 3.0', desc: '腾讯云 SecretId + SecretKey, 文/图生3D', keyLabel: 'SecretId + SecretKey', keyStorage: 'agentai.3d.tc-keys' },
];

const FORMATS = [
  { value: 'glb', label: 'GLB (推荐)' },
  { value: 'obj', label: 'OBJ' },
  { value: 'stl', label: 'STL' },
  { value: 'fbx', label: 'FBX' },
  { value: 'usdz', label: 'USDZ (Apple AR)' },
];

interface TaskItem {
  id: string;
  taskId: string;
  provider: string;
  prompt?: string;
  status: string;
  fileUrl?: string;
  ts: number;
}

export const Model3DGen: React.FC = () => {
  const [provider, setProvider] = useState('doubao');
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [format, setFormat] = useState('glb');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [showKeys, setShowKeys] = useState(false);
  // 密钥
  const [arkKey, setArkKey] = useState(() => localStorage.getItem('agentai.3d.ark-key') || '');
  const [tcSecretId, setTcSecretId] = useState(() => localStorage.getItem('agentai.3d.tc-id') || '');
  const [tcSecretKey, setTcSecretKey] = useState(() => localStorage.getItem('agentai.3d.tc-secret') || '');
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const saveKeys = () => {
    localStorage.setItem('agentai.3d.ark-key', arkKey);
    localStorage.setItem('agentai.3d.tc-id', tcSecretId);
    localStorage.setItem('agentai.3d.tc-secret', tcSecretKey);
    message.success('密钥已保存到本地');
    setShowKeys(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { message.error('图片不能超过 6MB'); return; }
    const reader = new FileReader();
    reader.onload = () => { setImageBase64(reader.result as string); message.success('图片已加载'); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const pollTask = (taskId: string, prov: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const params = new URLSearchParams({ provider: prov });
        if (prov === 'doubao') params.set('apiKey', arkKey);
        else { params.set('secretId', tcSecretId); params.set('secretKey', tcSecretKey); }
        const r = await fetch(`${GATEWAY_HTTP}/v1/3d-generate/${taskId}?${params}`);
        const data = await r.json();
        setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: data.status || 'unknown', fileUrl: data.fileUrl } : t));
        if (data.status === 'succeeded' || data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          setBusy(false);
          if (data.status === 'succeeded') message.success('3D 模型生成完成!');
          else message.error('生成失败: ' + (data.error || ''));
        }
      } catch { /* retry */ }
    }, 5000);
  };

  const submit = async () => {
    if (provider === 'doubao' && !arkKey) { message.warning('请先配置豆包 ARK API Key'); setShowKeys(true); return; }
    if (provider === 'hunyuan' && (!tcSecretId || !tcSecretKey)) { message.warning('请先配置腾讯云密钥'); setShowKeys(true); return; }
    if (provider === 'doubao' && !imageBase64) { message.warning('豆包 Seed3D 需要上传图片'); return; }
    if (provider === 'hunyuan' && !prompt && !imageBase64) { message.warning('请输入文字描述或上传图片'); return; }

    setBusy(true);
    try {
      const body: any = { provider, format };
      if (prompt) body.prompt = prompt;
      if (imageBase64) body.imageBase64 = imageBase64;
      if (provider === 'doubao') body.apiKey = arkKey;
      else { body.secretId = tcSecretId; body.secretKey = tcSecretKey; }

      const r = await fetch(`${GATEWAY_HTTP}/v1/3d-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.error) { message.error(data.error); setBusy(false); return; }

      const task: TaskItem = {
        id: `${Date.now()}`,
        taskId: data.taskId,
        provider,
        prompt,
        status: 'queued',
        ts: Date.now(),
      };
      setTasks(prev => [task, ...prev]);
      pollTask(data.taskId, provider);
      message.info('任务已提交, 等待生成...');
    } catch (e: any) {
      message.error(e.message);
      setBusy(false);
    }
  };

  const providerInfo = PROVIDERS.find(p => p.value === provider);

  return (
    <div style={{ padding: 16, color: '#fff', height: '100%', overflow: 'auto' }}>
      <Card size="small" title={<Space><AppstoreOutlined /> 3D 模型生成</Space>}
        extra={<Button size="small" icon={<SettingOutlined />} onClick={() => setShowKeys(!showKeys)}>密钥配置</Button>}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* 密钥配置 */}
          {showKeys && (
            <div style={{ padding: 12, borderRadius: 8, background: '#1a1a1a', border: '1px solid #333' }}>
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>密钥保存在浏览器本地, 不上传服务器</div>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Input.Password size="small" placeholder="豆包 ARK API Key" value={arkKey} onChange={e => setArkKey(e.target.value)}
                  addonBefore="豆包" />
                <Input size="small" placeholder="腾讯云 SecretId" value={tcSecretId} onChange={e => setTcSecretId(e.target.value)}
                  addonBefore="SecretId" />
                <Input.Password size="small" placeholder="腾讯云 SecretKey" value={tcSecretKey} onChange={e => setTcSecretKey(e.target.value)}
                  addonBefore="SecretKey" />
                <Button size="small" type="primary" onClick={saveKeys}>保存密钥</Button>
              </Space>
            </div>
          )}

          {/* 平台选择 */}
          <Select value={provider} onChange={setProvider} style={{ width: '100%' }}
            options={PROVIDERS.map(p => ({ value: p.value, label: `${p.label} — ${p.desc}` }))} />

          {/* 文字描述 (混元支持) */}
          {provider === 'hunyuan' && (
            <Input.TextArea value={prompt} onChange={e => setPrompt(e.target.value)}
              placeholder="输入 3D 模型描述, 如: 一只可爱的卡通猫咪"
              autoSize={{ minRows: 2, maxRows: 4 }} disabled={busy} />
          )}

          {/* 图片上传 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>
              {imageBase64 ? '更换图片' : '上传图片'}
            </Button>
            <Select value={format} onChange={setFormat} style={{ width: 160 }}
              options={FORMATS} disabled={busy} />
            <Button type="primary" size="large" loading={busy} onClick={submit}>
              生成 3D
            </Button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
          </div>

          {/* 图片预览 */}
          {imageBase64 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 8, background: '#1a1a1a', border: '1px solid #333' }}>
              <img src={imageBase64} alt="参考图" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 6 }} />
              <div style={{ flex: 1, fontSize: 12, color: '#999' }}>
                已上传参考图<br />
                <span style={{ fontSize: 11, color: '#666' }}>{provider === 'doubao' ? '豆包将基于此图生成 3D 模型' : '混元将基于此图生成 3D 模型'}</span>
              </div>
              <Button size="small" danger onClick={() => setImageBase64('')}>移除</Button>
            </div>
          )}

          <Alert type="info" showIcon style={{ fontSize: 11 }}
            message={provider === 'doubao'
              ? '豆包 Seed3D: 需要 ARK API Key (火山引擎), 仅支持图生3D, 输出 GLB/OBJ/USD 格式'
              : '混元 3D: 需要腾讯云 SecretId+SecretKey, 支持文生3D 和 图生3D, 输出多种格式'} />
        </Space>
      </Card>

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <Card size="small" style={{ marginTop: 16 }} title="生成任务">
          {tasks.map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #222' }}>
              <Tag color={task.status === 'succeeded' ? 'green' : task.status === 'failed' ? 'red' : 'blue'}>
                {task.status === 'succeeded' ? '完成' : task.status === 'failed' ? '失败' : task.status === 'running' ? '生成中' : '排队中'}
              </Tag>
              <span style={{ flex: 1, fontSize: 12, color: '#ccc' }}>
                {task.prompt?.slice(0, 30) || '图生3D'} — {task.provider}
              </span>
              <span style={{ fontSize: 10, color: '#666' }}>{new Date(task.ts).toLocaleTimeString()}</span>
              {task.fileUrl && (
                <Button size="small" icon={<DownloadOutlined />} href={task.fileUrl} target="_blank">
                  下载
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {tasks.length === 0 && !busy && (
        <Empty description={<span style={{ color: '#666' }}>上传图片或输入描述, 生成 3D 模型</span>} style={{ marginTop: 60 }} />
      )}

      {busy && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#888' }}>3D 生成中, 通常需要 1-3 分钟...</div>
        </div>
      )}
    </div>
  );
};
