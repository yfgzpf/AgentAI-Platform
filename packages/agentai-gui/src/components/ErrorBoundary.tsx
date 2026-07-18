/**
 * ErrorBoundary — 页面级错误边界
 * 捕获子组件渲染异常，防止整个应用白屏崩溃
 * 提供「重试」和「返回对话」操作
 */
import React from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: React.ReactNode;
  /** 错误时的重试回调 (可选, 默认重新渲染) */
  onRetry?: () => void;
  /** 错误时的 fallback 渲染 */
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Component crashed:', error, errorInfo);
  }

  handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100%', padding: 40,
        }}>
          <Result
            status="error"
            title="页面加载出错"
            subTitle={this.state.error?.message || '组件渲染时发生异常'}
            extra={[
              <Button key="retry" type="primary" onClick={this.handleRetry}>
                重试
              </Button>,
              <Button key="home" onClick={() => {
                window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'chat' } }));
                this.setState({ hasError: false, error: null });
              }}>
                返回对话
              </Button>,
            ]}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
