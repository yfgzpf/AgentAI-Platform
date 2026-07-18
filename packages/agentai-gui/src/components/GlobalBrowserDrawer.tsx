// @ts-nocheck
/**
 * GlobalBrowserDrawer — 全局浏览器容器 (PulseFlow 核心能力)
 * ===========================================================
 *
 * 设计目标: 让浏览器自动化从**任意页面**都可用
 *   - 不依赖页面 (ChatView / Editor / Write / Image 都行)
 *   - 入口集成到主布局 (不再使用右下角悬浮按钮, 避免遮挡)
 *   - AI 调用 browser_* 工具时自动唤起
 *   - 手动入口: 顶部导航栏"浏览器"按钮 / 快捷键 Ctrl+B
 *
 * 集成方式:
 *   - App.tsx 顶层挂载一次
 *   - 任何页面调用: openGlobalBrowser() 或 Ctrl+B
 *   - AI tool bridge 全局可用
 *
 * 关键修复 (2026-07-16):
 *   - 移除右下角悬浮按钮 (用户反馈: 位置碍事, 不应悬浮)
 *   - 入口由 App.tsx 顶部导航控制 (与 ChatView/Settings 同一行)
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Drawer, message, Space, Tag, Badge, Button, Tooltip } from 'antd';
import {
  GlobalOutlined, CloseOutlined, FullscreenOutlined,
  FullscreenExitOutlined, ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { EmbeddedBrowser } from './EmbeddedBrowser';
import { gatewayFallback } from '../services/GatewayFallback';

/* ============================================================ */
/*  全局唤起 API (window event)                                */
/* ============================================================ */
const BROWSER_OPEN_EVENT = 'pulseflow:browser:open';
const BROWSER_NAVIGATE_EVENT = 'pulseflow:browser:navigate';

export function openGlobalBrowser(url?: string): void {
  window.dispatchEvent(new CustomEvent(BROWSER_OPEN_EVENT, { detail: { url } }));
}

export function navigateGlobalBrowser(url: string): void {
  window.dispatchEvent(new CustomEvent(BROWSER_NAVIGATE_EVENT, { detail: { url } }));
  openGlobalBrowser(url);
}

export const GlobalBrowserDrawer: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [initialUrl, setInitialUrl] = useState<string>('');
  const [aiActive, setAiActive] = useState(false);

  // 监听全局事件: AI/其他组件可触发唤起
  useEffect(() => {
    const onOpen = (e: Event) => {
      const ce = e as CustomEvent<{ url?: string }>;
      setInitialUrl(ce.detail?.url || '');
      setOpen(true);
    };
    const onNavigate = (e: Event) => {
      const ce = e as CustomEvent<{ url?: string }>;
      if (ce.detail?.url) {
        setInitialUrl(ce.detail.url);
      }
    };
    window.addEventListener(BROWSER_OPEN_EVENT, onOpen as EventListener);
    window.addEventListener(BROWSER_NAVIGATE_EVENT, onNavigate as EventListener);
    return () => {
      window.removeEventListener(BROWSER_OPEN_EVENT, onOpen as EventListener);
      window.removeEventListener(BROWSER_NAVIGATE_EVENT, onNavigate as EventListener);
    };
  }, []);

  // 键盘快捷键: Ctrl/Cmd + B 唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // AI 调用浏览器工具时, 弹一个"AI 正在操作"提示
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAiStart = () => {
      setAiActive(true);
      // 30s 后自动隐藏 (兜底)
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setAiActive(false), 30_000);
    };
    const onAiEnd = () => {
      setAiActive(false);
      if (timer) clearTimeout(timer);
    };
    window.addEventListener('pulseflow:browser:ai-start', onAiStart);
    window.addEventListener('pulseflow:browser:ai-end', onAiEnd);
    return () => {
      window.removeEventListener('pulseflow:browser:ai-start', onAiStart);
      window.removeEventListener('pulseflow:browser:ai-end', onAiEnd);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 健康检查: gateway 连接
  const [gatewayOk, setGatewayOk] = useState<boolean>(true);
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const res = await fetch(`${gatewayFallback()}/v1/health`, { method: 'GET' });
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

  const drawerWidth = fullscreen ? '100vw' : '75vw';

  return (
    <>
      {/* 全局 Drawer: 任何页面唤起都可见 (入口由 App.tsx 顶部导航控制) */}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        placement="right"
        width={drawerWidth}
        height="100vh"
        maskClosable
        mask={fullscreen}
        destroyOnClose={false}
        closable={false}
        styles={{
          body: { padding: 0, background: '#0e0e14' },
          header: { display: 'none' },
        }}
        style={{ zIndex: 1002 }}
      >
        {/* 自定义顶栏: 标题 + 状态 + 操作 */}
        <div style={{
          height: 44, padding: '0 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, #16161c 0%, #0e0e14 100%)',
          borderBottom: '1px solid #2a2a38',
        }}>
          <Space size={10}>
            <GlobalOutlined style={{ color: '#CD7A3A', fontSize: 16 }} />
            <span style={{ color: '#f0f0f4', fontSize: 14, fontWeight: 600 }}>
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
            <Tooltip title="重新加载浏览器">
              <Button
                type="text" size="small" icon={<ReloadOutlined />}
                onClick={() => {
                  setOpen(false);
                  setTimeout(() => setOpen(true), 100);
                }}
              />
            </Tooltip>
            <Tooltip title={fullscreen ? '退出全屏' : '全屏'}>
              <Button
                type="text" size="small"
                icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                onClick={() => setFullscreen(f => !f)}
              />
            </Tooltip>
            <Tooltip title="关闭 (Ctrl+B)">
              <Button
                type="text" size="small" icon={<CloseOutlined />}
                onClick={() => setOpen(false)}
              />
            </Tooltip>
          </Space>
        </div>

        {/* EmbeddedBrowser 主体 */}
        <div style={{ height: 'calc(100vh - 44px)' }}>
          <EmbeddedBrowser
            initialUrl={initialUrl}
            compact={true}
            aiControlled={true}
            autoScan={true}
            style={{ height: '100%' }}
          />
        </div>
      </Drawer>

      {/* 动画 */}
      <style>{`
        @keyframes pulseflow-glow {
          0%, 100% {
            box-shadow: 0 6px 24px rgba(205, 122, 58, 0.45);
          }
          50% {
            box-shadow: 0 6px 36px rgba(205, 122, 58, 0.85);
          }
        }
      `}</style>
    </>
  );
};

export default GlobalBrowserDrawer;
