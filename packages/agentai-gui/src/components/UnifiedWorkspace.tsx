/**
 * UnifiedWorkspace — 统一工作区主容器
 * ----------------------------------------------------
 * 根据 workspaceStore 的 mode 自动渲染对应子组件：
 *   - editor   → EditorMode（代码/文本编辑）
 *   - browser  → BrowserMode（内嵌浏览器）
 *   - preview  → PreviewMode（图片/PDF/视频预览）
 *   - auto     → 自动推断最佳模式
 *
 * 特性：
 *   - 模式切换带 CSS 过渡动画（300ms cubic-bezier）
 *   - 错误边界防止单个模式崩溃影响整体
 *   - 加载骨架屏提升感知性能
 *   - 支持键盘快捷键切换模式 (Ctrl+1/2/3/0)
 */
import React, { useEffect, useCallback } from 'react';
import { Spin } from 'antd';
import {
  useWorkspaceStore,
  useResolvedWorkspaceMode,
} from '../store/workspaceStore';
import type { WorkspaceMode } from '../types/workspace';
import { ErrorBoundary } from './ErrorBoundary';

// 直接导入三个子模式组件（避免 Vite dynamic import 的依赖链加载失败问题）
import { EditorMode } from './modes/EditorMode';
import { BrowserMode } from './modes/BrowserMode';
import { PreviewMode } from './modes/PreviewMode';

/** 工作区内容加载态 */
const WorkspaceLoading: React.FC = () => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 300,
  }}>
    <Spin size="large" tip="工作区加载中..." />
  </div>
);

/** 错误回退 UI */
const WorkspaceErrorFallback: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    minHeight: 200,
    gap: 16,
    padding: 40,
  }}>
    <span style={{ fontSize: 48 }}>😕</span>
    <h3 style={{ color: 'var(--text-secondary, #888)', margin: 0 }}>工作区加载失败</h3>
    <p style={{ color: 'var(--text-tertiary, #666)', margin: 0 }}>
      当前模式遇到问题，可以尝试刷新或切换到其他模式
    </p>
    <button
      onClick={onRetry}
      style={{
        padding: '8px 24px',
        borderRadius: 8,
        border: '1px solid var(--border-color, #333)',
        background: 'var(--bg-secondary, #222)',
        color: 'var(--text-primary, #eee)',
        cursor: 'pointer',
        fontSize: 14,
      }}
    >
      刷新工作区
    </button>
  </div>
);

/** 模式渲染器 — 根据当前模式渲染对应的子组件 */
const ModeRenderer: React.FC<{ mode: ReturnType<typeof useResolvedWorkspaceMode> }> = ({ mode }) => {
  const { loading, transitioning } = useWorkspaceStore();

  const contentClass = [
    'workspace-mode-content',
    transitioning ? 'mode-entering' : 'mode-active',
    loading ? 'mode-loading' : '',
  ].filter(Boolean).join(' ');

  switch (mode) {
    case 'browser':
      return (
        <div className={contentClass} key="browser-mode">
          <BrowserMode />
        </div>
      );
    case 'preview':
      return (
        <div className={contentClass} key="preview-mode">
          <PreviewMode />
        </div>
      );
    case 'editor':
    default:
      return (
        <div className={contentClass} key="editor-mode">
          <EditorMode />
        </div>
      );
  }
};

/** 统一工作区主组件 */
export const UnifiedWorkspace: React.FC = () => {
  const resolvedMode = useResolvedWorkspaceMode();
  const { setMode, inferMode } = useWorkspaceStore();
  const [errorKey, setErrorKey] = React.useState(0);

  // ===== 全局键盘快捷键 =====
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '1') { e.preventDefault(); setMode('editor'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '2') { e.preventDefault(); setMode('browser'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '3') { e.preventDefault(); setMode('preview'); }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setMode('auto'); inferMode(); }
  }, [setMode, inferMode]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ===== 启动时恢复上次使用的模式 =====
  useEffect(() => {
    try {
      const lastMode = localStorage.getItem('agentai.workspace.lastMode') as WorkspaceMode | null;
      if (lastMode && ['editor', 'browser', 'preview'].includes(lastMode)) {
        const currentMode = useWorkspaceStore.getState().mode;
        if (currentMode === 'auto') {
          useWorkspaceStore.getState().setMode(lastMode);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ===== 监听 HTML 预览事件 =====
  useEffect(() => {
    const handlePreviewHtml = (e: CustomEvent<{ path: string }>) => {
      const { path } = e.detail;
      const store = useWorkspaceStore.getState();
      // 切换到预览模式并设置当前文件
      store.setMode('preview');
      store.setCurrentFile({
        path,
        name: path.split(/[\\/]/).pop() || path,
        type: 'file',
        ext: '.html',
      });
    };
    
    window.addEventListener('agentai:preview-html', handlePreviewHtml as EventListener);
    return () => window.removeEventListener('agentai:preview-html', handlePreviewHtml as EventListener);
  }, []);

  return (
    <ErrorBoundary
      key={`workspace-error-${errorKey}`}
      fallback={<WorkspaceErrorFallback onRetry={() => setErrorKey(k => k + 1)} />}
    >
      <main className="unified-workspace-container">
        {/* 模式指示器 */}
        <ModeIndicator mode={resolvedMode} />
        {/* 模式内容区域 */}
        <ModeRenderer mode={resolvedMode} />
      </main>
      <style>{WORKSPACE_STYLES}</style>
    </ErrorBoundary>
  );
};

/** 小型模式指示器 badge */
const ModeIndicator: React.FC<{ mode: string }> = ({ mode }) => {
  const modeConfig: Record<string, { label: string; color: string }> = {
    editor: { label: '编辑器', color: '#4ade80' },
    browser: { label: '浏览器', color: '#60a5fa' },
    preview: { label: '预览', color: '#f472b6' },
    auto: { label: '自动', color: '#a78bfa' },
  };
  const config = modeConfig[mode] || modeConfig.auto;

  return (
    <div
      className="workspace-mode-indicator"
      title={`当前模式: ${config.label} (Ctrl+${mode === 'editor' ? '1' : mode === 'browser' ? '2' : mode === 'preview' ? '3' : '0'})`}
      style={{
        position: 'absolute',
        top: 8,
        right: 12,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 11,
        color: 'var(--text-tertiary, #777)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: config.color,
        boxShadow: `0 0 6px ${config.color}40`,
      }} />
      {config.label}
    </div>
  );
};

/** 统一工作区的全局 CSS 样式 */
const WORKSPACE_STYLES = `
.unified-workspace-container {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary, #111);
}

.workspace-mode-content {
  width: 100%;
  height: 100%;
  animation: modeFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes modeFadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.mode-entering {
  animation: modeSlideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes modeSlideIn {
  from { opacity: 0; transform: translateY(10px) scale(0.995); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.mode-active { opacity: 1; transform: none; }

.mode-loading { filter: brightness(0.95); pointer-events: none; }

@media (max-width: 768px) {
  .workspace-mode-indicator {
    top: 4px; right: 8px;
    padding: 2px 8px !important;
    font-size: 10px !important;
  }
}
`;

/** 导出便捷 hook 供外部使用 */
export { useResolvedWorkspaceMode as useWorkspaceMode };
export { useWorkspaceStore };
