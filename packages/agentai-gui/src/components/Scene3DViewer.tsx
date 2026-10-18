/**
 * Scene3DViewer — AI 生成的 3D 可交互场景查看器
 * --------------------------------------------------
 * 两种输入:
 *   1. scene.html  — AI 工具 generate_3d_scene 生成的 Three.js HTML (iframe srcDoc)
 *   2. glbUrl      — 3D 建模页 (Model3DGen) 产出的 GLB 外链, 由 buildGltbHtml()
 *                    现场拼装成同形态的自包含 HTML 后走同一条 iframe 渲染路径
 *
 * 2026-10-12 扩展 GLB 支持的背景: Model3DGen 生成完只给下载按钮, 页面上看不到模型。
 * 不引入 three npm 依赖 (pnpm monorepo 装不上), 复用本组件既有的 iframe 外壳。
 *
 * ⚠️ CDN 必须用 jsdelivr 不能用 cdnjs: tauri.conf.json 的 CSP script-src
 *    白名单含 jsdelivr, **不含 cdnjs**。tools.ts:763 给 AI 的 3D 工具约定用的
 *    是 cdnjs r128, 桌面壳里可能被拦 —— 自建模板必须走 jsdelivr。
 *    这条约束由 media-contract.test.ts 用断言锁住。
 */
import React, { useState, useRef, useCallback } from 'react';
import { Card, Button, Space, Tooltip, Modal, Spin, Empty } from 'antd';
import { ExpandOutlined, ReloadOutlined, DownloadOutlined, FullscreenOutlined, CloseOutlined } from '@ant-design/icons';
import { GATEWAY_HTTP } from '../services/config';

export interface Scene3DData {
  title: string;
  html: string;
  params?: Array<{ name: string; label: string; min: number; max: number; default: number; step?: number }>;
}

/** three r128 (非 module 版, 全局 THREE.*) — 与 tools.ts:763 的版本约定一致, 仅换 CDN */
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.128.0';

/**
 * 把 GLB 外链拼成自包含 HTML (three + OrbitControls + GLTFLoader)
 * @param glbUrl 模型直链 (厂商预签名 URL)
 * @param hint   画布上的操作提示
 */
function buildGltbHtml(glbUrl: string, hint = '左键旋转 · 滚轮缩放 · 右键平移'): string {
  // 2026-10-12: 厂商预签名外链 (火山 TOS / 腾讯 COS) 不带 CORS 头,
  // iframe 里直接 fetch 会失败 → 改走 gateway 的 /v1/3d-file 白名单代理 (同源)。
  // 本地/同源路径 (如 /api/...) 不代理, 直接加载。
  let loadUrl = glbUrl;
  try {
    const isRemote = /^https?:\/\//i.test(glbUrl)
      && typeof window !== 'undefined'
      && !glbUrl.toLowerCase().includes(window.location.host.toLowerCase());
    if (isRemote) {
      loadUrl = `${GATEWAY_HTTP}/v1/3d-file?url=${encodeURIComponent(glbUrl)}`;
    }
  } catch { /* 无 window (测试环境) 时保持原样 */ }
  // JSON.stringify 防 glbUrl 里的引号/尖括号破坏 HTML 结构
  const safeUrl = JSON.stringify(loadUrl);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body{margin:0;overflow:hidden;background:#1a1a22}
#hint{position:absolute;top:8px;left:10px;color:#fff;font:12px/1.4 sans-serif;opacity:.65;pointer-events:none}
#err{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;color:#e5e5e5;font:13px/1.6 sans-serif;text-align:center;padding:24px}
</style></head><body>
<div id="hint">${hint}</div>
<div id="err"><div>模型加载失败</div><div style="opacity:.7;margin-top:6px">可能是网络无法访问 CDN, 或模型链接已过期<br>可点击右上角「下载 GLB」后本地查看</div></div>
<script src="${THREE_CDN}/build/three.min.js"><\/script>
<script src="${THREE_CDN}/examples/js/controls/OrbitControls.js"><\/script>
<script src="${THREE_CDN}/examples/js/loaders/GLTFLoader.js"><\/script>
<script>
(function(){
  var url = ${safeUrl};
  var w = window.innerWidth, h = window.innerHeight;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a22);
  var camera = new THREE.PerspectiveCamera(45, w/h, 0.01, 1000);
  var renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  document.body.appendChild(renderer.domElement);
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var d1 = new THREE.DirectionalLight(0xffffff, 0.8); d1.position.set(3, 5, 4); scene.add(d1);
  var d2 = new THREE.DirectionalLight(0xffffff, 0.4); d2.position.set(-3, -2, -4); scene.add(d2);
  new THREE.GLTFLoader().load(url, function(gltf){
    var model = gltf.scene;
    // 自动居中 + 缩放到统一视野: 不同厂商的模型尺度差异极大
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    var center = box.getCenter(new THREE.Vector3());
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    model.position.sub(center);
    model.scale.setScalar(2 / maxDim);
    scene.add(model);
    camera.position.set(2.2, 1.6, 2.6);
    controls.target.set(0, 0, 0);
    controls.update();
  }, undefined, function(){
    document.getElementById('err').style.display = 'flex';
  });
  window.addEventListener('resize', function(){
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  (function animate(){ requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); })();
})();
<\/script>
</body></html>`;
}

interface Props {
  scene: Scene3DData | null;
  /** GLB 模型直链 — 传入时优先走 GLB 渲染路径 (3D 建模页) */
  glbUrl?: string | null;
  /** GLB 模式下的标题 */
  glbTitle?: string;
}

export const Scene3DViewer: React.FC<Props> = ({ scene, glbUrl, glbTitle }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // GLB 模式优先: 传入 glbUrl 时无视 scene, 现场拼装自包含 HTML
  const isGlb = !!(glbUrl && glbUrl.trim());
  const effectiveHtml = isGlb ? buildGltbHtml(glbUrl!.trim()) : (scene?.html || '');
  const effectiveTitle = isGlb ? (glbTitle || '3D 模型') : (scene?.title || '3D 场景');

  const handleReload = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  const handleDownload = useCallback(() => {
    if (isGlb) {
      // GLB 模式: 直接下模型文件, 不是 HTML
      const a = document.createElement('a');
      a.href = glbUrl!;
      a.download = `${effectiveTitle || 'model'}.glb`;
      a.target = '_blank';
      a.click();
      return;
    }
    if (!scene?.html) return;
    const blob = new Blob([scene.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene.title || 'scene-3d'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [scene, isGlb, glbUrl, effectiveTitle]);

  if (!effectiveHtml) {
    return (
      <Card size="small" style={{ margin: '8px 0', background: 'var(--panel)' }}>
        <Empty description="暂无 3D 场景" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const iframeSrcDoc = effectiveHtml;

  const iframeEl = (
    <iframe
      ref={iframeRef}
      key={reloadKey}
      srcDoc={iframeSrcDoc}
      title={effectiveTitle || '3D Scene'}
      style={{
        width: '100%',
        height: fullscreen ? '100%' : 360,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: '#000',
      }}
      allowFullScreen
      sandbox="allow-scripts allow-same-origin"
    />
  );

  return (
    <>
      <Card
        size="small"
        style={{ margin: '8px 0', background: 'var(--panel)' }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 'var(--fs-md)' }}>🎲 {effectiveTitle || '3D 场景'}</span>
          </div>
        }
        extra={
          <Space size={4}>
            <Tooltip title="刷新">
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={handleReload} />
            </Tooltip>
            <Tooltip title={isGlb ? '下载 GLB' : '下载 HTML'}>
              <Button size="small" type="text" icon={<DownloadOutlined />} onClick={handleDownload} />
            </Tooltip>
            <Tooltip title="全屏">
              <Button size="small" type="text" icon={<ExpandOutlined />} onClick={() => setFullscreen(true)} />
            </Tooltip>
          </Space>
        }
      >
        {iframeEl}
        {!isGlb && scene?.params && scene.params.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
            可调参数: {scene.params.map(p => p.label).join(' · ')}
          </div>
        )}
      </Card>

      <Modal
        open={fullscreen}
        onCancel={() => setFullscreen(false)}
        footer={null}
        width="90vw"
        style={{ top: 20 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>🎲 {effectiveTitle || '3D 场景'}</span>
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={handleReload}>刷新</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>下载</Button>
            </Space>
          </div>
        }
        closeIcon={<CloseOutlined />}
      >
        {/* 原 `calc(100vh - 140px)`: 其中 60 是外壳 (--chrome-h), 余下 80 是本组件自己的
            工具条 + 提示条高度。魔法数字 140 拆开后两段各有出处。 */}
        <div style={{ height: 'calc(100dvh - var(--chrome-h) - 80px)' }}>
          {iframeEl}
        </div>
      </Modal>
    </>
  );
};

export default Scene3DViewer;
