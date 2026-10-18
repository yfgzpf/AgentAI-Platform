/**
 * FeatureGuide — 订阅引导包装器 (2026-10-12 从 App.tsx 拆出)
 * ------------------------------------------------------------
 * 原 App.tsx:105-172。职责: 未激活订阅且该页 requireSubscription 时,
 * 在页面顶部挂一条「免费内置模型」提示条 (可关闭并记忆)。
 */
import React, { useState } from 'react';
import { Button, Tooltip } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { useSubscriptionStore } from '../store/subscriptionStore';
import type { PageMeta } from './page-types';

export const FeatureGuide: React.FC<{
  page: PageMeta;
  children: React.ReactNode;
}> = ({ page, children }) => {
  const { isActivated } = useSubscriptionStore();

  // 「免费内置模型」提示条: 常驻会一直压在页面顶部, 允许用户关掉并记住
  const NAG_KEY = 'agentai.nag.freeModelDismissed';
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(NAG_KEY) === '1'; } catch { return false; }
  });
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(NAG_KEY, '1'); } catch { /* 隐私模式下忽略 */ }
  };

  // 如果已激活、不需要引导、或用户已关闭提示，直接显示内容
  if (isActivated || !page.requireSubscription || dismissed) {
    return <>{children}</>;
  }

  // 未激活时显示内容 + 顶部提示条
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶部提示条 */}
      <div style={{
        padding: '10px 16px',
        background: 'var(--accent-soft)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 'var(--fs-md)' }}>💡</span>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)', flex: 1 }}>
          当前使用<span style={{ fontWeight: 600, color: 'var(--accent)' }}> 免费内置模型</span>，
          能力有限。添加密钥可解锁 <b>GPT Image 2</b>、<b>Nano Banana</b> 等高级模型。
        </span>
        <Button
          type="primary"
          size="small"
          icon={<KeyOutlined />}
          onClick={() => window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'settings' as any } }))}
        >
          添加密钥解锁
        </Button>
        <Tooltip title="本页不再提示 (可在设置里恢复)">
          <span
            data-testid="nag-dismiss"
            onClick={dismiss}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              color: 'var(--muted-2)', fontSize: 'var(--fs-md)', lineHeight: 1, flexShrink: 0,
            }}
          >
            ×
          </span>
        </Tooltip>
      </div>
      {/* 页面内容 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
};

export default FeatureGuide;