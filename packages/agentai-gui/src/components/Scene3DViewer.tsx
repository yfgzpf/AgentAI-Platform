/**
 * Scene3DViewer — AI 生成的 3D 可交互场景查看器
 * --------------------------------------------------
 * AI 调用 generate_3d_scene 工具生成 Three.js HTML
 * 前端用 iframe 渲染, 支持全屏/下载/刷新
 */
import React, { useState, useRef, useCallback } from 'react';
import { Card, Button, Space, Tooltip, Modal, Spin, Empty } from 'antd';
import { ExpandOutlined, ReloadOutlined, DownloadOutlined, FullscreenOutlined, CloseOutlined } from '@ant-design/icons';

export interface Scene3DData {
  title: string;
  html: string;
  params?: Array<{ name: string; label: string; min: number; max: number; default: number; step?: number }>;
}

interface Props {
  scene: Scene3DData | null;
}

export const Scene3DViewer: React.FC<Props> = ({ scene }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleReload = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  const handleDownload = useCallback(() => {
    if (!scene?.html) return;
    const blob = new Blob([scene.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${scene.title || 'scene-3d'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [scene]);

  if (!scene?.html) {
    return (
      <Card size="small" style={{ margin: '8px 0', background: 'var(--panel)' }}>
        <Empty description="暂无 3D 场景" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const iframeSrcDoc = scene.html;

  const iframeEl = (
    <iframe
      ref={iframeRef}
      key={reloadKey}
      srcDoc={iframeSrcDoc}
      title={scene.title || '3D Scene'}
      style={{
        width: '100%',
        height: fullscreen ? '100%' : 360,
        border: '1px solid var(--border)',
        borderRadius: 8,
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
            <span style={{ fontSize: 13 }}>🎲 {scene.title || '3D 场景'}</span>
          </div>
        }
        extra={
          <Space size={4}>
            <Tooltip title="刷新">
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={handleReload} />
            </Tooltip>
            <Tooltip title="下载 HTML">
              <Button size="small" type="text" icon={<DownloadOutlined />} onClick={handleDownload} />
            </Tooltip>
            <Tooltip title="全屏">
              <Button size="small" type="text" icon={<ExpandOutlined />} onClick={() => setFullscreen(true)} />
            </Tooltip>
          </Space>
        }
      >
        {iframeEl}
        {scene.params && scene.params.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted-2)' }}>
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
            <span>🎲 {scene.title || '3D 场景'}</span>
            <Space>
              <Button size="small" icon={<ReloadOutlined />} onClick={handleReload}>刷新</Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleDownload}>下载</Button>
            </Space>
          </div>
        }
        closeIcon={<CloseOutlined />}
      >
        <div style={{ height: 'calc(100vh - 140px)' }}>
          {iframeEl}
        </div>
      </Modal>
    </>
  );
};

export default Scene3DViewer;
