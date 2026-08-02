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
 */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: '' };

  static getDerivedStateFromError(e: any) {
    return { hasError: true, error: e?.message || String(e) };
  }

  componentDidCatch(e: any, info: any) {
    console.error('[ErrorBoundary]', e, info);
  }

  render() {
    if (this.state.hasError) {
      // 安全守护: H13 修复 — 错误兜底页使用 CSS 变量，遵循当前主题
      return (
        <div className="agentai-error-boundary" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', fontFamily: 'system-ui',
          padding: 40, textAlign: 'center',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ marginBottom: 8 }}>应用遇到了错误</h2>
          <p style={{ fontSize: 13, maxWidth: 500, marginBottom: 20 }}>
            {this.state.error}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: '' }); window.location.reload(); }}
            className="agentai-error-reload"
            style={{
              padding: '8px 24px', borderRadius: 8, fontSize: 14,
              border: 'none', cursor: 'pointer',
            }}
          >
            重新加载
          </button>
          <button
            onClick={() => { localStorage.clear(); window.location.reload(); }}
            className="agentai-error-clear"
            style={{
              marginTop: 8, padding: '4px 16px', borderRadius: 6, fontSize: 12,
              background: 'transparent', cursor: 'pointer',
            }}
          >
            清除缓存并重新加载
          </button>
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
