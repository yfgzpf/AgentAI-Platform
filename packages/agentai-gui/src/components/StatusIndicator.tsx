/**
 * StatusIndicator — 消息状态指示器
 * 显示在对话气泡右下角，标记消息发送/接收/处理/失败状态
 * 点击可滚动定位到该消息
 */
import React from 'react';
import type { MessageStatus } from '../store/chatStore';

/* ===== 状态配置 ===== */
const STATUS_CONFIG: Record<MessageStatus, { icon: string; color: string; label: string; spin?: boolean }> = {
  sending:   { icon: '○', color: 'var(--accent)',   label: '发送中',   spin: true },
  sent:      { icon: '✓', color: 'var(--muted-2)',  label: '已发送' },
  received:  { icon: '✓✓',color: 'var(--muted-2)',  label: '已送达' },
  processing:{ icon: '⟳', color: 'var(--accent)',   label: '处理中',   spin: true },
  done:      { icon: '✓', color: 'var(--success)',  label: '完成' },
  error:     { icon: '✗', color: 'var(--danger)',   label: '失败' },
};

interface Props {
  status: MessageStatus;
  messageId?: string;
  /** 点击时滚动到指定消息元素 */
  onNavigate?: (messageId: string) => void;
}

export const StatusIndicator: React.FC<Props> = ({ status, messageId, onNavigate }) => {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.sent;

  return (
    <span
      onClick={() => {
        if (messageId && onNavigate) onNavigate(messageId);
      }}
      title={`${cfg.label}${messageId ? ' · 点击定位' : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 10, color: cfg.color,
        cursor: messageId && onNavigate ? 'pointer' : 'default',
        animation: cfg.spin ? 'spin 1.2s linear infinite' : undefined,
        userSelect: 'none',
        transition: 'color 0.3s ease',
      }}
    >
      {cfg.icon}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
};
