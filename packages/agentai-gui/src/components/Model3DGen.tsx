/**
 * Model3DGen — 3D 模型生成面板
 * 引擎: 腾讯混元3D + 豆包 Seed3D
 * 密钥由用户输入, 缓存在 localStorage
 */
import React, { useState, useEffect, useRef } from 'react';
import { Input, Button, Select, Card, Space, Tag, Alert, Spin, message, Empty, Tooltip } from 'antd';
import { AppstoreOutlined, DownloadOutlined, UploadOutlined, ReloadOutlined, SettingOutlined, EyeOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';
import { saveApiKey } from '../services/secureKeyStorage';
import { Scene3DViewer } from './Scene3DViewer';

const PROVIDERS = [
  { value: 'doubao', label: '豆包 Seed3D 2.0', desc: '火山引擎 ARK_API_KEY, 图生3D', keyLabel: 'ARK API Key', keyStorage: 'agentai.3d.ark-key' },
  { value: 'hunyuan', label: '腾讯混元3D 3.0', desc: '腾讯云 SecretId + SecretKey, 文/图生3D', keyLabel: 'SecretId + SecretKey', keyStorage: 'agentai.3d.tc-keys' },
  { value: 'tripo', label: 'Tripo 3D · 高斯场景', desc: 'Tripo 国内站 Bearer Key, 单图→Gaussian Splat (.splat, 约4分钟/30积分), 可发往生视频做场景首帧', keyLabel: 'Tripo API Key', keyStorage: 'agentai.3d.tripo-key' },
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
  /** 2026-10-12: 记录生成时的格式, 供「用此参数重生成」回填 */
  format?: string;
  status: string;
  fileUrl?: string;
  /** 2026-10-17: Tripo splat 任务的源图 (用于「发送到生视频」时作为首帧) */
  sourceImage?: string;
  ts: number;
}

export const Model3DGen: React.FC = () => {
  const [provider, setProvider] = useState('doubao');
  const [prompt, setPrompt] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [format, setFormat] = useState('glb');
  const [busy, setBusy] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try { const raw = localStorage.getItem('agentai-3d-tasks'); if (raw) return JSON.parse(raw); } catch {}
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem('agentai-3d-tasks', JSON.stringify(tasks.slice(0, 20))); } catch {}
  }, [tasks]);
  const [showKeys, setShowKeys] = useState(false);
  // 2026-10-12: 用户在任务列表点「在画布中查看」的任务 (null = 显示最新成功的)
  const [previewTask, setPreviewTask] = useState<TaskItem | null>(null);
  // 密钥
  const [arkKey, setArkKey] = useState(() => localStorage.getItem('agentai.3d.ark-key') || '');
  const [tcSecretId, setTcSecretId] = useState(() => localStorage.getItem('agentai.3d.tc-id') || '');
  const [tcSecretKey, setTcSecretKey] = useState(() => localStorage.getItem('agentai.3d.tc-secret') || '');
  // 2026-10-17: Tripo 国内站 Bearer Key (图生 Gaussian Splat)
  const [tripoKey, setTripoKey] = useState(() => localStorage.getItem('agentai.3d.tripo-key') || '');
  const fileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const saveKeys = () => {
    // 改用 sessionStorage（关闭浏览器自动销毁）
    try {
      if (arkKey) saveApiKey('ARK_API_KEY', arkKey);
      if (tcSecretId) saveApiKey('TENCENT_TC_ID', tcSecretId);
      if (tcSecretKey) saveApiKey('TENCENT_TC_SECRET', tcSecretKey);
      // 兼容旧 key 名（自动迁移）
      try { localStorage.removeItem('agentai.3d.ark-key'); } catch {}
      try { localStorage.removeItem('agentai.3d.tc-id'); } catch {}
      try { localStorage.removeItem('agentai.3d.tc-secret'); } catch {}
      // 2026-10-17: Tripo key 存 localStorage (纯展示用, 不上传服务器; 与既有惯例一致)
      if (tripoKey) try { localStorage.setItem('agentai.3d.tripo-key', tripoKey); } catch {}
      message.success('密钥已保存到 sessionStorage');
    } catch (e) {
      message.error('保存失败：' + (e as Error).message);
    }
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
        // 2026-10-12 安全修复: 密钥改走 POST body (旧 GET query 会进浏览器历史/网关日志)
        const body: any = { provider: prov };
        if (prov === 'doubao') body.apiKey = arkKey;
        else if (prov === 'tripo') body.apiKey = tripoKey;
        else { body.secretId = tcSecretId; body.secretKey = tcSecretKey; }
        const r = await fetch(`${GATEWAY_HTTP}/v1/3d-generate/${taskId}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await r.json();
        setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: data.status || 'unknown', fileUrl: data.fileUrl } : t));
        if (data.status === 'succeeded' || data.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
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
    if (provider === 'tripo' && !tripoKey) { message.warning('请先配置 Tripo API Key'); setShowKeys(true); return; }
    if (provider === 'doubao' && !imageBase64) { message.warning('豆包 Seed3D 需要上传图片'); return; }
    if (provider === 'hunyuan' && !prompt && !imageBase64) { message.warning('请输入文字描述或上传图片'); return; }
    if (provider === 'tripo' && !imageBase64) { message.warning('Tripo 高斯场景需要上传一张场景图'); return; }

    setBusy(true);
    try {
      const body: any = { provider, format };
      if (prompt) body.prompt = prompt;
      if (imageBase64) body.imageBase64 = imageBase64;
      if (provider === 'doubao') body.apiKey = arkKey;
      else if (provider === 'tripo') body.apiKey = tripoKey;
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
        format,
        provider,
        prompt,
        status: 'queued',
        // 2026-10-17: Tripo 任务记录源图, 「发送到生视频」用它做首帧
        sourceImage: provider === 'tripo' ? imageBase64 : undefined,
        ts: Date.now(),
      };
      setTasks(prev => [task, ...prev]);
      pollTask(data.taskId, provider);
      message.info(provider === 'tripo' ? '任务已提交, 高斯场景约需 4 分钟...' : '任务已提交, 等待生成...');
    } catch (e: any) {
      message.error(e.message);
      setBusy(false);
    }
  };

  // 2026-10-12 删死代码: providerInfo (PROVIDERS.find) 从未被使用

  return (
    <div style={{ padding: 16, color: 'var(--fg)', height: '100%', overflow: 'auto' }}>
      <Card size="small" title={<Space><AppstoreOutlined /> 3D 模型生成</Space>}
        extra={<Button size="small" icon={<SettingOutlined />} onClick={() => setShowKeys(!showKeys)}>密钥配置</Button>}>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {/* 密钥配置 */}
          {showKeys && (
<div style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
<div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginBottom: 8 }}>密钥保存在浏览器本地, 不上传服务器</div>
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                <Input.Password size="small" placeholder="豆包 ARK API Key" value={arkKey} onChange={e => setArkKey(e.target.value)}
                  addonBefore="豆包" />
                <Input size="small" placeholder="腾讯云 SecretId" value={tcSecretId} onChange={e => setTcSecretId(e.target.value)}
                  addonBefore="SecretId" />
                <Input.Password size="small" placeholder="腾讯云 SecretKey" value={tcSecretKey} onChange={e => setTcSecretKey(e.target.value)}
                  addonBefore="SecretKey" />
                <Input.Password size="small" placeholder="Tripo API Key (国内站, 免费注册)" value={tripoKey} onChange={e => setTripoKey(e.target.value)}
                  addonBefore="Tripo" />
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
            {provider !== 'tripo' && (
              <Select value={format} onChange={setFormat} style={{ width: 160 }}
                options={FORMATS} disabled={busy} />
            )}
            <Button type="primary" size="large" loading={busy} onClick={submit}>
              {provider === 'tripo' ? '生成高斯场景' : '生成 3D'}
            </Button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
          </div>

          {/* 图片预览 */}
          {imageBase64 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <img src={imageBase64} alt="参考图" style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--radius-md)' }} />
              <div style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>
                已上传参考图<br />
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                  {provider === 'doubao' ? '豆包将基于此图生成 3D 模型'
                    : provider === 'tripo' ? 'Tripo 将基于此图生成高斯场景 (约4分钟), 完成后可发往生视频做首帧'
                    : '混元将基于此图生成 3D 模型'}
                </span>
              </div>
              <Button size="small" danger onClick={() => setImageBase64('')}>移除</Button>
            </div>
          )}

          <Alert type="info" showIcon style={{ fontSize: 'var(--fs-micro)' }}
            message={provider === 'doubao'
              ? '豆包 Seed3D: 需要 ARK API Key (火山引擎), 仅支持图生3D, 输出 GLB/OBJ/USD 格式'
              : provider === 'tripo'
                ? 'Tripo 国内站: 单图→Gaussian Splat (.splat, 约4分钟/30积分). 产物是 3D 高斯场景, 可点任务条「发往生视频」把场景图作为视频首帧 (透视/光照锁定). .splat 产物可下载, 需 splat 查看器渲染'
                : '混元 3D: 需要腾讯云 SecretId+SecretKey, 支持文生3D 和 图生3D, 输出多种格式'} />
        </Space>
      </Card>

      {/* ===== 2026-10-12: 画布预览 — 最新成功的模型 =====
          原来生成完只给下载按钮, 用户看不到模型长什么样。
          复用 Scene3DViewer 的 GLB 模式 (iframe + jsdelivr three + OrbitControls),
          左键旋转/滚轮缩放/右键平移, 支持全屏。 */}
      {(() => {
        const target = previewTask && previewTask.fileUrl
          ? previewTask
          : tasks.find(t => t.status === 'succeeded' && t.fileUrl);
        if (!target?.fileUrl) return null;
        return (
          <div style={{ marginTop: 16 }}>
            <Scene3DViewer scene={null} glbUrl={target.fileUrl}
              glbTitle={target.prompt?.slice(0, 20) || '3D 模型'} />
            {previewTask && (
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4 }}>
                正在查看选中的模型 · <a onClick={() => setPreviewTask(null)} style={{ cursor: 'pointer' }}>回到最新</a>
              </div>
            )}
          </div>
        );
      })()}

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <Card size="small" style={{ marginTop: 16 }} title="生成任务">
          {tasks.map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <Tag color={task.status === 'succeeded' ? 'green' : task.status === 'failed' ? 'red' : 'blue'}>
                {task.status === 'succeeded' ? '完成' : task.status === 'failed' ? '失败' : task.status === 'running' ? '生成中' : '排队中'}
              </Tag>
              <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--fg-2)' }}>
                {task.prompt?.slice(0, 30) || '图生3D'} — {task.provider}
              </span>
              <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>{new Date(task.ts).toLocaleTimeString()}</span>
              {task.status === 'succeeded' && task.fileUrl && (
                <Tooltip title="在画布中查看">
                  <Button size="small" icon={<EyeOutlined />} onClick={() => setPreviewTask(task)} />
                </Tooltip>
              )}
              {/* 2026-10-12: 带参重生成 — provider 不支持基于已有模型续改,
                  所以"修改"= 把该任务的参数填回表单重新生成 (调研报告已明确此边界) */}
              {task.status === 'succeeded' && (
                <Tooltip title="用这组参数重新生成">
                  <Button size="small" icon={<ReloadOutlined />} onClick={() => {
                    setProvider(task.provider);
                    if (task.prompt) setPrompt(task.prompt);
                    if (task.format) setFormat(task.format);
                    message.info('参数已填回表单, 可调整后重新生成');
                  }} />
                </Tooltip>
              )}
              {/* 2026-10-17: 场景图 → 生视频首帧 (跨页 localStorage 链路, 同 ImageStudio 先例) */}
              {task.provider === 'tripo' && task.sourceImage && (
                <Tooltip title="把场景图发往生视频页做首帧 (图生视频, 场景透视/光照锁定)">
                  <Button size="small" type="primary"
                    onClick={() => {
                      try {
                        localStorage.setItem('agentai-video-sceneframe', task.sourceImage!);
                        message.success('已发送 3D 场景图, 请切换到「生视频」页查看');
                      } catch { message.error('图片太大, 无法传递'); }
                    }}>
                    发往生视频
                  </Button>
                </Tooltip>
              )}
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
        <Empty description={<span style={{ color: 'var(--muted-2)' }}>上传图片或输入描述, 生成 3D 模型</span>} style={{ marginTop: 60 }} />
      )}

      {busy && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'var(--muted)' }}>3D 生成中, 通常需要 1-3 分钟...</div>
        </div>
      )}
    </div>
  );
};
