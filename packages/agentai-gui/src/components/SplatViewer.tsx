/**
 * SplatViewer — Gaussian Splat (.splat) 渲染槽 + 截帧
 * ----------------------------------------------------
 * 背景 (2026-10-17): Tripo image-to-splat 的产物是 3D 高斯场景 (.splat),
 * 而所有视频引擎只吃 2D 图 (firstFrame / end_frame / images[]) —— 没有任何
 * 引擎接受 3D 资产。所以「3D 场景 → 视频」的唯一通路是:
 *    .splat → 渲染成一张固定视角的 2D 帧 → 视频首帧
 *
 * 这个组件就是那一步的宿主: 复用 Scene3DViewer 的 iframe + srcDoc 外壳,
 * 内联 public/splat-viewer.js (vendor 自 antimatter15/splat, MIT)。
 *
 * 为什么不装 npm 包:
 *   1. monorepo 里 gui 没有 three/gsplat 依赖, 加包会牵动 lockfile;
 *   2. gsplat 的 worker 走 `new Worker(new URL(..., import.meta.url))`,
 *      CDN 跨源 worker 会被浏览器直接拒绝; 本方案用 blob worker (CSP 已放行);
 *   3. 上游是单文件实现, vendor 后可控 (已修 content-length / 取景 / 截帧坑)。
 *
 * 截帧尺寸固定 1280x720 (视频首帧), 与 iframe 的 CSS 显示尺寸解耦 ——
 * `__splatApi.capture()` 读的是 canvas 实际像素, 不是显示尺寸。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, Space, Tooltip, Alert, Spin, Tag, message } from 'antd';
import { CameraOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

/** 截帧分辨率 — 与 16:9 视频常用档一致 */
const FRAME_W = 1280;
const FRAME_H = 720;

/** 预设视角: yaw 绕 Y 轴 (弧度), pitch 抬升, zoom 帧内留白倍数 */
const VIEWS: Array<{ key: string; label: string; yaw: number; pitch: number }> = [
  { key: 'front', label: '正面', yaw: 0, pitch: 0.06 },
  { key: 'left', label: '左前', yaw: -Math.PI / 4, pitch: 0.22 },
  { key: 'right', label: '右前', yaw: Math.PI / 4, pitch: 0.22 },
  { key: 'back', label: '背面', yaw: Math.PI, pitch: 0.08 },
  { key: 'top', label: '俯视', yaw: 0, pitch: 1.15 },
];

/**
 * 拼装 iframe srcDoc。
 * 厂商预签名外链不带 CORS 头 → 走 gateway 的 /v1/3d-file 白名单代理。
 * 渲染器脚本用绝对 URL: srcDoc 里的相对路径在部分 WebView 下解析不到父页 origin。
 */
function buildSplatHtml(splatUrl: string): string {
  let loadUrl = splatUrl;
  try {
    const isRemote = /^https?:\/\//i.test(splatUrl)
      && typeof window !== 'undefined'
      && !splatUrl.toLowerCase().includes(window.location.host.toLowerCase());
    if (isRemote) {
      loadUrl = `${GATEWAY_HTTP}/v1/3d-file?url=${encodeURIComponent(splatUrl)}`;
    }
  } catch { /* 测试环境无 window 时保持原样 */ }

  const safeUrl = JSON.stringify(loadUrl);
  const scriptSrc = JSON.stringify(
    typeof document !== 'undefined'
      ? new URL('splat-viewer.js', document.baseURI).href
      : '/splat-viewer.js',
  );

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  #canvas{width:100%;height:100%;display:block;cursor:grab}
  #canvas:active{cursor:grabbing}
  #spinner{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;
    border:3px solid rgba(255,255,255,.18);border-top-color:rgba(255,255,255,.75);border-radius:50%;
    animation:sp 1s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  #progress{position:absolute;left:0;bottom:0;height:2px;width:0;background:rgba(120,200,255,.9)}
  #message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:#e8e8ef;font:12px/1.6 sans-serif;text-align:center;padding:24px;white-space:pre-wrap;
    pointer-events:none}
  #hud{position:absolute;left:8px;bottom:6px;color:rgba(255,255,255,.45);font:10px/1 sans-serif;pointer-events:none}
</style></head><body>
<canvas id="canvas"></canvas>
<div id="spinner"></div>
<div id="progress"></div>
<div id="message"></div>
<div id="hud"><span id="fps"></span> <span id="camid"></span></div>
<script>
  window.__SPLAT_OPTS__ = {
    url: ${safeUrl},
    static: true,
    width: ${FRAME_W},
    height: ${FRAME_H},
    pixelRatio: 1,
    bg: '#000'
  };
<\/script>
<script src=${scriptSrc}><\/script>
</body></html>`;
}

interface Props {
  /** .splat 直链 (Tripo 预签名 URL) */
  splatUrl: string;
  /** 卡片标题 */
  title?: string;
  /** 截帧回调 — 拿到 1280x720 JPEG dataURL */
  onFrame?: (dataUrl: string) => void;
  /** 传给父级的附加操作 (例如「发往生视频」) */
  extra?: React.ReactNode;
}

interface SplatState {
  ready?: boolean;
  frames?: number;
  sorts?: number;
  vertexCount?: number;
  error?: string | null;
  bounds?: { count: number; radius: number };
}

export const SplatViewer: React.FC<Props> = ({ splatUrl, title, onFrame, extra }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [frame, setFrame] = useState('');
  const [capturing, setCapturing] = useState(false);
  const [activeView, setActiveView] = useState('front');

  // srcDoc 字符串必须稳定: 每次渲染重新拼会触发 React 重设属性 → iframe 重载
  const html = useMemo(() => buildSplatHtml(splatUrl), [splatUrl]);

  /** iframe 内的渲染 API (同源 srcdoc, 直接读 contentWindow) */
  const api = useCallback((): any => {
    try { return (iframeRef.current?.contentWindow as any)?.__splatApi; } catch { return null; }
  }, []);

  const state = useCallback((): SplatState | null => {
    try {
      const w = iframeRef.current?.contentWindow as any;
      if (!w) return null;
      if (w.__splatError) return { error: String(w.__splatError) };
      return w.__splatApi?.getState?.() || null;
    } catch { return null; }
  }, []);

  const waitFor = useCallback(async (pred: (s: SplatState) => boolean, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = state();
      if (s?.error) throw new Error(s.error);
      if (s && pred(s)) return s;
      await new Promise(r => setTimeout(r, 120));
    }
    throw new Error('等待渲染超时');
  }, [state]);

  // 轮询就绪 — 渲染器不会通知宿主, 只能读它写出的全局量
  useEffect(() => {
    setStatus('loading');
    setError('');
    setFrame('');
    const iv = window.setInterval(() => {
      const s = state();
      if (s?.error) {
        setStatus('error');
        setError(s.error);
        window.clearInterval(iv);
        return;
      }
      if (s?.ready) {
        setStatus('ready');
        window.clearInterval(iv);
      }
    }, 200);
    const hardStop = window.setTimeout(() => {
      setStatus(prev => {
        if (prev === 'loading') {
          setError('渲染器 30 秒未就绪 — 可能是 .splat 链接已过期, 或文件不是有效的高斯场景');
          return 'error';
        }
        return prev;
      });
      window.clearInterval(iv);
    }, 30000);
    return () => { window.clearInterval(iv); window.clearTimeout(hardStop); };
  }, [splatUrl, reloadKey, state]);

  /** 切换预设视角 (等一次新的深度排序完成, 否则截到旧画面) */
  const applyView = useCallback(async (key: string, yaw: number, pitch: number) => {
    const a = api();
    if (!a) return;
    setActiveView(key);
    try {
      const before = state() || {};
      a.setView(yaw, pitch, 1.15);
      await waitFor(s => (s.sorts || 0) > (before.sorts || 0), 8000);
    } catch { /* 视角切换失败不阻断截帧, 用户还可以拖拽 */ }
  }, [api, state, waitFor]);

  const capture = useCallback(async () => {
    const a = api();
    if (!a) { message.warning('渲染器还没就绪'); return; }
    setCapturing(true);
    try {
      // 用户可能刚拖拽过相机; 等当前帧稳定 (排序完成 + 至少画过一帧)
      const before = state() || {};
      await waitFor(s => (s.frames || 0) > (before.frames || 0), 5000).catch(() => null);
      const dataUrl: string = a.capture('image/jpeg', 0.92);
      if (!dataUrl || dataUrl.length < 2000) throw new Error('截帧为空 — 场景可能还没画出来');
      setFrame(dataUrl);
      onFrame?.(dataUrl);
      message.success('已截取当前视角 (1280×720)');
    } catch (e: any) {
      message.error(e?.message || '截帧失败');
    } finally {
      setCapturing(false);
    }
  }, [api, onFrame, state, waitFor]);

  const iframeEl = (
    <iframe
      ref={iframeRef}
      key={reloadKey}
      srcDoc={html}
      title={title || '高斯场景渲染'}
      style={{
        width: '100%',
        aspectRatio: '16 / 9',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: '#000',
        display: 'block',
      }}
      sandbox="allow-scripts allow-same-origin"
    />
  );

  return (
    <Card
      size="small"
      style={{ margin: '8px 0', background: 'var(--panel)' }}
      title={<Space size={6}><span>🧊 {title || '高斯场景 (.splat)'}</span>
        {status === 'ready' && <Tag color="green" style={{ fontSize: 'var(--fs-micro)' }}>可截帧</Tag>}
        {status === 'loading' && <Tag style={{ fontSize: 'var(--fs-micro)' }}>渲染中</Tag>}
        {status === 'error' && <Tag color="red" style={{ fontSize: 'var(--fs-micro)' }}>加载失败</Tag>}
      </Space>}
      extra={
        <Space size={4}>
          <Tooltip title="重新加载场景">
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => setReloadKey(k => k + 1)} />
          </Tooltip>
        </Space>
      }
    >
      <div style={{ position: 'relative' }}>
        {iframeEl}
        {status === 'loading' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 10, color: 'var(--muted)', pointerEvents: 'none',
            background: 'rgba(0,0,0,.25)', borderRadius: 'var(--radius-md)',
          }}>
            <Spin size="small" /> <span style={{ fontSize: 'var(--fs-sm)' }}>解析高斯点云…</span>
          </div>
        )}
      </div>

      {status === 'error' && (
        <Alert type="warning" showIcon style={{ marginTop: 8, fontSize: 'var(--fs-micro)' }}
          message="渲染失败"
          description={error || '.splat 链接可能已过期 (厂商预签名 URL 有时效), 或文件格式不对。'}
        />
      )}

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>视角</span>
        {VIEWS.map(v => (
          <Button key={v.key} size="small" type={activeView === v.key ? 'primary' : 'default'}
            disabled={status !== 'ready'} onClick={() => applyView(v.key, v.yaw, v.pitch)}>
            {v.label}
          </Button>
        ))}
        <Tooltip title="也可以在画面上拖拽旋转 / 滚轮缩放后直接截帧">
          <Button type="primary" size="small" icon={<CameraOutlined />} loading={capturing}
            disabled={status !== 'ready'} onClick={capture}>
            截取当前视角
          </Button>
        </Tooltip>
        {extra}
      </div>

      {frame && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <img src={frame} alt="截帧预览" style={{
            width: 240, aspectRatio: '16 / 9', objectFit: 'cover',
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
          }} />
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', flex: 1, minWidth: 180 }}>
            已渲染 1280×720 帧 (当前视角)。这张图可以作视频首帧 —— 透视与光照已由 3D 场景锁定,
            比直接拿源图更不容易「跑形」。
            <div style={{ marginTop: 6 }}>
              <Button size="small" type="primary" icon={<SendOutlined />}
                onClick={() => {
                  try {
                    localStorage.setItem('agentai-video-sceneframe', frame);
                    message.success('已发往「生视频」页, 切换过去即可看到首帧');
                  } catch { message.error('帧太大, 无法传递 (localStorage 超限)'); }
                }}>
                用这个视角发往生视频
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

export default SplatViewer;
