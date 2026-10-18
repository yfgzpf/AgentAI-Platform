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
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import { isQuotaError, rescueSpace, storageUsage } from '../utils/quota-safe-storage';

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
    // 2026-10-18: 配额事故的自动抢救 —— 先丢掉可牺牲的临时键 (截图帧/草稿),
    //   再走下面原有的"自动重试一次"。多数情况下这一次就能恢复, 用户无感。
    if (isQuotaError(error)) {
      const freed = rescueSpace();
      console.warn(`[ErrorBoundary] localStorage 配额超限, 已释放 ${freed} 字临时缓存`);
    }
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

  /** 配额事故专用: 清临时缓存后再重载 (不动对话历史) */
  handlePurgeAndReload = () => {
    try {
      const freed = rescueSpace();
      console.warn(`[ErrorBoundary] 手动静默临时缓存 ${freed} 字`);
    } catch { /* ignore */ }
    this.handleRetry();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // 2026-10-18: localStorage 配额超限单独给文案 —— 这不是"页面坏了",
      //   是本地存满了, 用户需要知道"清缓存"而不是反复点重新加载。
      const quota = isQuotaError(this.state.error);
      const usedK = quota ? Math.round(storageUsage().usedChars / 1024) : 0;
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
              padding: 20, borderRadius: 'var(--radius-md)',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 10,
              maxWidth: 380, width: '100%',
            }}
          >
            <div style={{ fontSize: 'var(--fs-hero)', opacity: 0.55 }}>⚠️</div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 500 }}>
              {quota ? '本地存储已满' : '页面加载中断'}
            </div>
            <div
              style={{
                fontSize: 'var(--fs-sm)', color: 'var(--muted)',
                textAlign: 'center', lineHeight: 1.6,
                maxHeight: 60, overflow: 'auto',
                padding: '0 8px',
              }}
            >
              {quota
                ? `浏览器本地存储空间已用满 (约 ${usedK}K 字符)，会话记录无法继续保存。已尝试自动清理临时缓存，若仍不行请点下方按钮。`
                : (this.state.error?.message || '请点击重试加载组件')}
            </div>
            {this.state.retried && (
              <div
                style={{
                  fontSize: 'var(--fs-micro)',
                  color: 'var(--danger)',
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--danger-soft)',
                }}
              >
                自动重试未成功
              </div>
            )}
            <Button
              type="primary"
              icon={quota ? <DeleteOutlined /> : <ReloadOutlined />}
              onClick={quota ? this.handlePurgeAndReload : this.handleRetry}
              style={{ width: '100%', marginTop: 4 }}
            >
              {quota ? '清理临时缓存并恢复' : '重新加载'}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
