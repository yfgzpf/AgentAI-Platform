import React from 'react';
import ReactDOM from 'react-dom/client';

// ═══ 第1层: Ant Design 基础样式 (必须在最前面) ═══
import 'antd/dist/reset.css';

// ═══ 第2层: 主题变量 (必须在组件样式之前) ═══
import './styles/agentai-theme.css';

// ═══ 第3层: 全局样式和工具类 ═══
import './styles/global.css';

// ═══ P0 修复: 全局 Fetch 拦截器 ═══
// 必须在所有组件之前导入, 自动将 /v1/, /api/ 等相对路径重定向到 GATEWAY_HTTP
// 解决 Tauri 打包后 fetch('/v1/...') 404 的问题
import './services/fetchInterceptor';

// ═══ 第4层: 应用组件 ═══
import { App } from './App';

/**
 * 全局错误边界 — 防止任何组件报错导致整个应用白屏
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║ 构建vs开发一致性修复 (P0):                                  ║
 * ║ 开发模式: Vite HMR overlay 全屏覆盖, 本 fallback 永远不可见 ║
 * ║ 生产构建: 无 HMR overlay, 若本 fallback 有按钮=无形多了按键 ║
 * ║ → 生产模式仅 1 个 "刷新" 按钮, 其余 UI 精简为卡片容器       ║
 * ╚══════════════════════════════════════════════════════════════╝
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string; retried: boolean }
> {
  state = { hasError: false, error: '', retried: false };

  static getDerivedStateFromError(e: any) {
    return { hasError: true, error: e?.message || String(e), retried: false };
  }

  componentDidCatch(e: any, info: any) {
    console.error('[ErrorBoundary] Global crash:', e, info);
    // 首错自动重试一次（解决懒加载 chunk 瞬时失败问题）
    if (!this.state.retried) {
      const timer = window.setTimeout(() => {
        this.setState({ retried: true }, () => {
          this.setState({ hasError: false, error: '' });
        });
      }, 250);
      return () => window.clearTimeout(timer);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="agentai-error-boundary"
          style={{
            position: 'fixed', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg)',
            color: 'var(--fg)',
            fontFamily: 'system-ui',
            padding: 32,
            zIndex: 99999,
          }}
        >
          <div style={{
            width: '100%', maxWidth: 420,
            padding: 24, borderRadius: 12,
            background: 'var(--card)',
            border: '1px solid var(--border)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.7 }}>⚠️</div>
            <h2 style={{
              fontSize: 18, margin: '0 0 8px',
              color: 'var(--fg)', fontWeight: 600,
            }}>工作区遇到了一点小问题</h2>
            <p style={{
              fontSize: 12, margin: '0 0 18px',
              color: 'var(--muted)',
              lineHeight: 1.6,
              maxHeight: 80, overflow: 'auto',
            }}>
              {this.state.error}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: '', retried: true });
                window.location.reload();
              }}
              style={{
                padding: '9px 22px', borderRadius: 8,
                fontSize: 14, fontWeight: 500,
                background: 'var(--accent)',
                color: 'white',
                border: 'none', cursor: 'pointer',
                width: '100%',
              }}
            >
              刷新恢复
            </button>
            {import.meta.env.DEV && (
              <button
                onClick={() => {
                  try { localStorage.clear(); } catch {}
                  window.location.reload();
                }}
                style={{
                  marginTop: 8, padding: '6px 14px',
                  borderRadius: 6, fontSize: 12,
                  background: 'transparent',
                  color: 'var(--muted)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer', width: '100%',
                }}
              >
                [DEV] 清除缓存并刷新
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
