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
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Drawer, message, Space, Tag, Badge, Button, Tooltip } from 'antd';
import { GlobalOutlined, CloseOutlined, FullscreenOutlined,
  FullscreenExitOutlined, ReloadOutlined,
  ThunderboltOutlined, ZoomInOutlined, ZoomOutOutlined,
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
  // 缩放控制: 默认 75% 大小，用户可调整 (25%-100%)
  const [zoom, setZoom] = useState<number>(0.75);

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
      // AI 任务结束后自动关闭浏览器 (3 秒延迟, 让用户看到最后结果)
      setTimeout(() => {
        setOpen(prev => {
          // 只有 AI 打开的浏览器才自动关闭, 用户手动打开的不关
          if (prev && aiOpenedRef.current) {
            aiOpenedRef.current = false;
            return false;
          }
          return prev;
        });
      }, 3000);
    };
    window.addEventListener('pulseflow:browser:ai-start', onAiStart);
    window.addEventListener('pulseflow:browser:ai-end', onAiEnd);
    return () => {
      window.removeEventListener('pulseflow:browser:ai-start', onAiStart);
      window.removeEventListener('pulseflow:browser:ai-end', onAiEnd);
      if (timer) clearTimeout(timer);
    };
  }, []);

  // ===== 监听 browser_close 工具调用, 立即关闭浏览器 =====
  const aiOpenedRef = useRef(false);
  useEffect(() => {
    const onBrowserClose = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      // 立即关闭浏览器
      aiOpenedRef.current = false;
      setOpen(false);
    };
    window.addEventListener('pulseflow:browser:close', onBrowserClose);
    return () => {
      window.removeEventListener('pulseflow:browser:close', onBrowserClose);
    };
  }, []);

  // ===== 监听 AI 返回结果中的 _show_browser 标记 =====
  useEffect(() => {
    /**
     * 监听来自 Gateway 的浏览器自动显示请求
     * Gateway 在 browser_* 工具返回结果中添加 _show_browser: true
     * 前端检测到后自动打开浏览器面板
     */
    const onShowBrowser = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      
      // 标记为 AI 打开, 任务完成后自动关闭
      aiOpenedRef.current = true;
      // 自动打开抽屉
      setOpen(true);
      
      // 如果有 URL，自动导航
      if (detail.url) {
        setInitialUrl(detail.url);
        setTimeout(() => {
          // 触发导航事件
          window.dispatchEvent(new CustomEvent('pulseflow:browser:navigate', {
            detail: { url: detail.url }
          }));
        }, 500);
      }
    };
    
    window.addEventListener('agentai:show-browser', onShowBrowser);
    return () => {
      window.removeEventListener('agentai:show-browser', onShowBrowser);
    };
  }, []);

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
            {/* 缩放控制 */}
            {!fullscreen && (
              <>
                <Tooltip title="缩小">
                  <Button
                    type="text" size="small" icon={<ZoomOutOutlined />}
                    onClick={() => setZoom(z => {
                      if (z <= 0.3) return Math.max(0.25, Math.round((z - 0.05) * 100) / 100);
                      return Math.max(0.25, Math.round((z - 0.1) * 100) / 100);
                    })}
                    disabled={zoom <= 0.25}
                  />
                </Tooltip>
                <Tag style={{ margin: 0, fontSize: 10, padding: '0 6px', lineHeight: '16px' }}>
                  {Math.round(zoom * 100)}%
                </Tag>
                <Tooltip title="放大">
                  <Button
                    type="text" size="small" icon={<ZoomInOutlined />}
                    onClick={() => setZoom(z => Math.min(1.0, Math.round((z + 0.1) * 100) / 100))}
                    disabled={zoom >= 1.0}
                  />
                </Tooltip>
              </>
            )}
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
            zoom={zoom}
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
