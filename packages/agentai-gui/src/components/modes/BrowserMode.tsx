/**
 * BrowserMode — 浏览器模式子组件
 * ----------------------------------------------------
 * 在统一工作区内提供完整的浏览器体验：
 *   - 地址栏（支持输入 URL、后退/前进/刷新）
 *   - 内嵌 iframe 浏览器（复用现有 EmbeddedBrowser）
 *   - AI 控制模式预留接口（Phase 2 接入 AIOverlay）
 *   - 屏幕尺寸切换（桌面/移动端模拟）
 *
 * 与现有 EmbeddedBrowser 的关系：
 *   - BrowserMode 是"有状态的容器"，管理 URL 历史、导航状态
 *   - EmbeddedBrowser 是"无状态的视图"，负责 iframe 渲染和元素扫描
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Input, Button, Tooltip, Segmented, Tag } from 'antd';
import {
  ArrowLeftOutlined, ArrowRightOutlined, ReloadOutlined,
  SendOutlined, FullscreenOutlined, FullscreenExitOutlined,
  DesktopOutlined, MobileOutlined, RobotOutlined,
  LockOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { EmbeddedBrowser, type IdentifiedElement } from '../EmbeddedBrowser';

/** 默认首页 URL */
const DEFAULT_URL = 'about:blank';

/** 浏览器模式主组件 */
export const BrowserMode: React.FC = () => {
  const {
    currentUrl, setCurrentUrl, pushBrowserHistory,
    navigateBrowserHistory, browserHistory, browserHistoryIndex,
    loading, setLoading, mode,
  } = useWorkspaceStore();

  const [inputValue, setInputValue] = useState(currentUrl || DEFAULT_URL);
  const [fullscreen, setFullscreen] = useState(false);
  const [screenSize, setScreenSize] = useState<'desktop' | 'mobile'>('desktop');
  const [aiControlled, setAiControlled] = useState(mode === 'browser');
  const [elements, setElements] = useState<IdentifiedElement[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  // 同步 store 的 URL 到 input
  useEffect(() => {
    if (currentUrl !== inputValue) {
      setInputValue(currentUrl || DEFAULT_URL);
    }
  }, [currentUrl]);

  // ===== 导航操作 =====
  const handleNavigate = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    // 自动补全协议
    let finalUrl = trimmed;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('about:')) {
      // 判断是否是 URL 还是搜索关键词
      if (trimmed.includes('.') && !trimmed.includes(' ')) {
        finalUrl = 'https://' + trimmed;
      } else {
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      }
    }
    pushBrowserHistory(finalUrl);
    setLoading(true);
  }, [pushBrowserHistory, setLoading]);

  const handleAddressSubmit = useCallback(() => {
    handleNavigate(inputValue);
  }, [inputValue, handleNavigate]);

  // ===== 元素扫描回调 =====
  const handleElementsDetected = useCallback((els: IdentifiedElement[], url: string) => {
    setElements(els);
    console.log(`[BrowserMode] Scanned ${els.length} elements from ${url}`);
  }, []);

  // ===== 全屏切换 =====
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }, []);

  // ===== 键盘事件：Escape 退出全屏 =====
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const canGoBack = browserHistoryIndex > 0;
  const canGoForward = browserHistoryIndex < browserHistory.length - 1;

  // 解析当前 URL 显示的安全状态
  const isSecure = currentUrl.startsWith('https://');
  const urlObj = (() => { try { return new URL(currentUrl); } catch { return null; } })();

  return (
    <div
      ref={containerRef}
      className={`browser-mode ${fullscreen ? 'is-fullscreen' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: '#000',
        position: fullscreen ? 'fixed' : 'relative',
        top: fullscreen ? 0 : undefined,
        left: fullscreen ? 0 : undefined,
        zIndex: fullscreen ? 9999 : undefined,
      }}
    >
      {/* ════════════ 工具栏 ════════════ */}
      <div className="browser-toolbar" style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'rgba(30,30,35,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
        backdropFilter: 'blur(10px)',
      }}>
        {/* 导航按钮组 */}
        <div className="browser-nav-buttons" style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="后退 (Alt+←)">
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              disabled={!canGoBack}
              onClick={() => navigateBrowserHistory('back')}
              style={{ color: canGoBack ? 'var(--text-primary,#ccc)' : 'var(--text-tertiary,#444)' }}
            />
          </Tooltip>
          <Tooltip title="前进 (Alt+→)">
            <Button
              type="text"
              size="small"
              icon={<ArrowRightOutlined />}
              disabled={!canGoForward}
              onClick={() => navigateBrowserHistory('forward')}
              style={{ color: canGoForward ? 'var(--text-primary,#ccc)' : 'var(--text-tertiary,#444)' }}
            />
          </Tooltip>
          <Tooltip title="刷新 (F5)">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={loading} />}
              onClick={() => {
                if (currentUrl) pushBrowserHistory(currentUrl);
              }}
              style={{ color: 'var(--text-primary,#ccc)' }}
            />
          </Tooltip>
        </div>

        {/* 地址栏 */}
        <div className="browser-address-bar" style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.4)',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.08)',
          padding: '0 10px',
          height: 32,
          transition: 'border-color 0.2s',
        }}
        onFocus={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent,#f97316)'; }}
        onBlur={(e) => { (e.target as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
        >
          {/* 安全图标 */}
          {currentUrl && currentUrl !== DEFAULT_URL && (
            <span style={{ marginRight: 6, fontSize: 14, flexShrink: 0 }}>
              {isSecure ? <SafetyCertificateOutlined style={{ color: '#4ade80' }} /> : <LockOutlined style={{ color: '#fbbf24' }} />}
            </span>
          )}

          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onPressEnter={handleAddressSubmit}
            placeholder="输入网址或搜索..."
            variant="borderless"
            style={{
              flex: 1,
              fontSize: 13,
              color: 'var(--text-primary,#ddd)',
              background: 'transparent',
              padding: 0,
            }}
          />

          <Tooltip title="导航">
            <Button
              type="text"
              size="small"
              icon={<SendOutlined />}
              onClick={handleAddressSubmit}
              style={{ color: 'var(--accent,#f97316)', flexShrink: 0, marginLeft: 4 }}
            />
          </Tooltip>
        </div>

        {/* 工具按钮组 */}
        <div className="browser-tool-buttons" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {/* AI 控制开关 */}
          <Tooltip title={`AI 控制模式: ${aiControlled ? '开启' : '关闭'} (Phase 2)`}>
            <Button
              type={aiControlled ? 'primary' : 'text'}
              size="small"
              icon={<RobotOutlined />}
              onClick={() => setAiControlled(!aiControlled)}
              style={{
                color: aiControlled ? '#fff' : 'var(--text-tertiary,#666)',
                background: aiControlled ? 'var(--accent,#f97316)' : 'transparent',
                fontSize: 11,
              }}
            />
          </Tooltip>

          {/* 屏幕尺寸切换 */}
          <Segmented
            size="small"
            value={screenSize}
            onChange={(v) => setScreenSize(v as 'desktop' | 'mobile')}
            options={[
              { value: 'desktop', icon: <DesktopOutlined /> },
              { value: 'mobile', icon: <MobileOutlined /> },
            ]}
            style={{ background: 'rgba(255,255,255,0.06)' }}
          />

          {/* 全屏按钮 */}
          <Tooltip title={fullscreen ? '退出全屏 (Esc)' : '全屏'}>
            <Button
              type="text"
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
              style={{ color: 'var(--text-primary,#ccc)' }}
            />
          </Tooltip>
        </div>
      </div>


      {/* ════════════ 浏览器内容区域 ════════════ */}
      <div
        className="browser-content-area"
        style={{
          flex: 1,
          overflow: 'hidden',
          position: 'relative',
          maxWidth: screenSize === 'mobile' ? 420 : '100%',
          margin: screenSize === 'mobile' ? '0 auto' : undefined,
          transition: 'max-width 0.3s ease',
        }}
      >
        <EmbeddedBrowser
          initialUrl={currentUrl || ''}
          compact={screenSize === 'mobile'}
          hideToolbar  // BrowserMode 自己有工具栏，隐藏内部导航栏
          aiControlled={aiControlled}
          autoScan={aiControlled}
          onElementsDetected={handleElementsDetected}
          style={{ width: '100%', height: '100%' }}
        />

        {/* 加载遮罩 */}
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            zIndex: 10,
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 36, height: 36,
              borderRadius: '50%',
              borderTop: '3px solid var(--accent,#f97316)',
              animation: 'browser-spin 0.8s linear infinite',
            }} />
          </div>
        )}
      </div>

      {/* ════════════ 底部状态栏 ════════════ */}
      {(currentUrl || elements.length > 0) && (
        <div className="browser-statusbar" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 24,
          paddingLeft: 12,
          paddingRight: 12,
          fontSize: 11,
          color: 'var(--text-tertiary,#555)',
          background: 'rgba(0,0,0,0.25)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          flexShrink: 0,
        }}>
          <span>
            {urlObj ? urlObj.host : (currentUrl || '就绪')}
          </span>
          <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {aiControlled && <Tag color="orange" style={{ fontSize: 10, lineHeight: 18, padding: '0 6px' }}>AI 控制</Tag>}
            {elements.length > 0 && <span>{elements.length} 个可交互元素</span>}
            {screenSize === 'mobile' && <Tag style={{ fontSize: 10, lineHeight: 18, padding: '0 6px' }}>移动端</Tag>}
          </span>
        </div>
      )}

      {/* 加载旋转动画 */}
      <style>{`@keyframes browser-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
