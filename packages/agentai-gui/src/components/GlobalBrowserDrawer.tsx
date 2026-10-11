/**
 * GlobalBrowserDrawer — 全局浏览器「独立抽屉」宿主 (PulseFlow 核心能力)
 * ===========================================================
 *
 * 2026-10-11 重构: 本组件从「唯一宿主 + 事件中枢」降级为**纯消费方**。
 *   - 事件中枢 (pulseflow:browser:* / agentai:show-browser) 已迁到
 *     services/browser-host.ts —— 因为现在有两个宿主 (右侧栏常驻 rail 与这个抽屉),
 *     各自监听同一批事件会导致双开 + 双导航 + EmbeddedBrowser 重复 subscribe socket。
 *   - 本组件现在只负责「独立大窗」这一种宿主的渲染, 由 BrowserHost.intent === 'drawer' 驱动。
 *   - 常驻宿主在 App.tsx 的右栏 (railMode === 'browser'), 由右栏的 ⬈ 按钮切到这里。
 *
 * 入口:
 *   - 右栏浏览器模式顶部的「⬈ 独立大窗」
 *   - 任何代码调用 openGlobalBrowser() (auto 宿主, 默认进右栏, 不进这里)
 *   - 各页面 (EditorChatPanel 等) 的浏览器按钮
 */
import React from 'react';
import { Drawer, Space, Tag, Button, Tooltip } from 'antd';
import { GlobalOutlined, CloseOutlined, FullscreenOutlined,
  FullscreenExitOutlined, ReloadOutlined,
  ThunderboltOutlined, ZoomInOutlined, ZoomOutOutlined,
} from '@ant-design/icons';
import { EmbeddedBrowser } from './EmbeddedBrowser';
import { useEffect, useState } from 'react';
import { gatewayFallback } from '../services/GatewayFallback';
import { BrowserHost, useBrowserHost, openGlobalBrowser, navigateGlobalBrowser } from '../services/browser-host';

// 兼容旧调用点 (App.tsx / ChatView.tsx / EditorChatPanel.tsx 从本文件 import)
export { openGlobalBrowser, navigateGlobalBrowser };

export const GlobalBrowserDrawer: React.FC = () => {
  const host = useBrowserHost();
  // 只有 intent === 'drawer' 才由本组件承载 (auto 走右栏常驻)
  const open = host.visible && host.intent === 'drawer';
  const { fullscreen, zoom, aiActive, url, reloadSeq } = host;

  // 抽屉挂载时记住要打开的 URL (EmbeddedBrowser 只在 mount 时读 initialUrl)
  const [mountUrl, setMountUrl] = useState(url);
  useEffect(() => {
    if (open) setMountUrl(url);
  }, [open, url]);

  // 健康检查: gateway 连接
  const [gatewayOk, setGatewayOk] = useState<boolean>(true);
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch(`${gatewayFallback.url}/v1/health`, { method: 'GET' });
        if (mounted) setGatewayOk(res.ok);
      } catch {
        if (mounted) setGatewayOk(false);
      }
    };
    const t = setInterval(check, 10_000);
    check();
    return () => {
      mounted = false;
      clearInterval(t);
    };
  }, []);

  // 抽屉宽度: 根据缩放比例动态计算，默认 55vw (给对话窗口留更多空间)
  // 缩放比例 0.25-1.0 对应宽度 35vw-75vw
  const drawerWidth = fullscreen ? '100vw' : `${Math.min(75, Math.max(35, 35 + zoom * 40))}vw`;

  return (
    <>
      {/* 独立抽屉宿主: intent === 'drawer' 才渲染 (常驻宿主在 App 右栏) */}
      <Drawer
        open={open}
        onClose={() => BrowserHost.closeDrawer()}
        placement="right"
        width={drawerWidth}
        height="100vh"
        maskClosable
        mask={fullscreen}
        destroyOnClose={false}
        closable={false}
        styles={{
          body: { padding: 0, background: 'var(--bg)' },
          header: { display: 'none' },
        }}
        style={{ zIndex: 'var(--z-modal)' }}
      >
        {/* 自定义顶栏: 标题 + 状态 + 操作 */}
        <div style={{
          height: 44, padding: '0 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
        }}>
          <Space size={10}>
            <GlobalOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
            <span style={{ color: 'var(--fg)', fontSize: 14, fontWeight: 600 }}>
              智能体浏览器
            </span>
            <Tag
              color={gatewayOk ? 'success' : 'error'}
              style={{ margin: 0, fontSize: 10, padding: '0 6px', lineHeight: '16px' }}
            >
              Gateway {gatewayOk ? '在线' : '离线'}
            </Tag>
            {aiActive && (
              <Tag
                color="processing"
                icon={<ThunderboltOutlined spin />}
                style={{ margin: 0, fontSize: 10, padding: '0 6px' }}
              >
                AI 正在操作
              </Tag>
            )}
          </Space>
          <Space size={6}>
            {/* 缩放控制 */}
            {!fullscreen && (
              <>
                <Tooltip title="缩小">
                  <Button
                    type="text" size="small" icon={<ZoomOutOutlined />}
                    onClick={() => BrowserHost.setZoom(zoom <= 0.3 ? zoom - 0.05 : zoom - 0.1)}
                    disabled={zoom <= 0.25}
                  />
                </Tooltip>
                <Tag style={{ margin: 0, fontSize: 10, padding: '0 6px', lineHeight: '16px' }}>
                  {Math.round(zoom * 100)}%
                </Tag>
                <Tooltip title="放大">
                  <Button
                    type="text" size="small" icon={<ZoomInOutlined />}
                    onClick={() => BrowserHost.setZoom(zoom + 0.1)}
                    disabled={zoom >= 1.0}
                  />
                </Tooltip>
              </>
            )}
            <Tooltip title="重新加载浏览器">
              <Button
                type="text" size="small" icon={<ReloadOutlined />}
                onClick={() => BrowserHost.reload()}
              />
            </Tooltip>
            <Tooltip title={fullscreen ? '退出全屏' : '全屏'}>
              <Button
                type="text" size="small"
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => BrowserHost.setFullscreen(!fullscreen)}
              />
            </Tooltip>
            <Tooltip title="关闭 (回到右栏)">
              <Button
                type="text" size="small" icon={<CloseOutlined />}
                onClick={() => BrowserHost.closeDrawer()}
              />
            </Tooltip>
          </Space>
        </div>

        {/* EmbeddedBrowser 主体 — reloadSeq 变化即重建实例 = 真重载 */}
        <div style={{ height: 'calc(100vh - 44px)' }}>
          {open && (
            <EmbeddedBrowser
              key={reloadSeq}
              initialUrl={mountUrl}
              compact={true}
              aiControlled={true}
              autoScan={true}
              zoom={zoom}
              style={{ height: '100%' }}
            />
          )}
        </div>
      </Drawer>
    </>
  );
};

export default GlobalBrowserDrawer;
