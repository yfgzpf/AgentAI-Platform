/**
 * ErrorBoundary — 页面级错误边界
 * 捕获子组件渲染异常，防止整个应用白屏崩溃
 *
 * ╔═══════════════════════════════════════════════════════════╗
 * ║ 构建vs开发一致性修复 (P0):                               ║
 * ║ - 去掉 Antd Result (带巨型卡片+2按钮=无形多了框和按键)  ║
 * ║ - fallback 改为与 PageSkeleton 视觉一致的轻量占位       ║
 * ║ - 首错自动重试 (200ms)，避免瞬时 chunk 加载失败        ║
 * ║ - 仅 1 个"重试"按钮，不再"返回对话"                     ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
import React from 'react';
import { Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

interface Props {
  children: React.ReactNode;
  onRetry?: () => void;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retried: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retried: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, retried: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Page crashed:', error, errorInfo);
    // 自动重试一次，避免懒加载 chunk 瞬时超时
    if (!this.state.retried) {
      const timer = window.setTimeout(() => {
        this.setState({ retried: true, hasError: false, error: null }, () => {
          this.props.onRetry?.();
        });
      }, 200);
      this._timer = timer;
    }
  }

  private _timer?: number;
  componentWillUnmount() {
    if (this._timer) window.clearTimeout(this._timer);
  }

  handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ hasError: false, error: null, retried: true });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            height: '100%',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'var(--bg)',
            color: 'var(--fg)',
          }}
        >
          <div
            style={{
              padding: 20, borderRadius: 10,
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10,
              maxWidth: 380, width: '100%',
            }}
          >
            <div style={{ fontSize: 28, opacity: 0.55 }}>⚠️</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>页面加载中断</div>
            <div
              style={{
                fontSize: 12, color: 'var(--muted)',
                textAlign: 'center', lineHeight: 1.6,
                maxHeight: 60, overflow: 'auto',
                padding: '0 8px',
              }}
            >
              {this.state.error?.message || '请点击重试加载组件'}
            </div>
            {this.state.retried && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--danger)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  background: 'var(--danger-soft)',
                }}
              >
                自动重试未成功
              </div>
            )}
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={this.handleRetry}
              style={{ width: '100%', marginTop: 4 }}
            >
              重新加载
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
