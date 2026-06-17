/**
 * MsgActions — 消息级操作栏
 * ----------------------------------------------------
 * 悬浮出现, 提供 6 类操作:
 *   - 复制      (所有消息)
 *   - 重新生成  (仅 AI 消息)
 *   - 编辑      (仅用户消息)
 *   - 重新发送  (仅用户消息, 编辑后)
 *   - 点赞/点踩 (仅 AI 消息)
 *   - 收藏      (所有消息)
 *
 * 设计:
 *   - 紧凑图标按钮, 12x12
 *   - 复制成功反馈: 1.2s 自动消失
 *   - 点赞/踩可切换, 状态写 localStorage
 */
import React, { useState, useEffect } from 'react';
import { Tooltip, message as antdMsg, Popconfirm } from 'antd';

export type MsgRole = 'user' | 'assistant';

export interface MsgActionsProps {
  role: MsgRole;
  messageId: string;
  /** 用于复制的纯文本 */
  text: string;
  /** 重新生成回调 (AI 消息) */
  onRegenerate?: () => void;
  /** 编辑回调 (用户消息) — 进入 Composer 编辑模式 */
  onEdit?: () => void;
  /** 重新发送回调 (用户消息) */
  onResend?: () => void;
  /** 反馈回调 (AI 消息) */
  onFeedback?: (kind: 'up' | 'down') => void;
  /** 收藏回调 */
  onBookmark?: () => void;
  /** 是否流式中 (禁用某些操作) */
  streaming?: boolean;
}

const FEEDBACK_STORE_KEY = 'agentai.msg_feedback';

function loadFeedback(): Record<string, 'up' | 'down'> {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_STORE_KEY) || '{}'); } catch { return {}; }
}

function saveFeedback(map: Record<string, 'up' | 'down'>) {
  try { localStorage.setItem(FEEDBACK_STORE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export const MsgActions: React.FC<MsgActionsProps> = ({
  role, messageId, text, onRegenerate, onEdit, onResend, onFeedback, onBookmark, streaming,
}) => {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const all = loadFeedback();
    if (all[messageId]) setFeedback(all[messageId]);
  }, [messageId]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      antdMsg.error('复制失败');
    }
  };

  const handleFeedback = (kind: 'up' | 'down') => (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = feedback === kind ? null : kind;
    setFeedback(next);
    const all = loadFeedback();
    if (next) all[messageId] = next;
    else delete all[messageId];
    saveFeedback(all);
    onFeedback?.(kind);
    antdMsg.success(next === 'up' ? '👍 已点赞' : next === 'down' ? '👎 已点踩' : '已撤销');
  };

  const handleRegenerate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (streaming) return;
    onRegenerate?.();
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  };

  const handleResend = (e: React.MouseEvent) => {
    e.stopPropagation();
    onResend?.();
  };

  const handleBookmark = (e: React.MouseEvent) => {
    e.stopPropagation();
    onBookmark?.();
    antdMsg.success('⭐ 已收藏');
  };

  return (
    <div
      className="msg-actions"
      onClick={e => e.stopPropagation()}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        padding: '2px 4px', borderRadius: 6,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        opacity: 0.6,
        transition: 'opacity 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.6'; }}
    >
      {/* 复制 (通用) */}
      <Tooltip title={copied ? '已复制' : '复制'} mouseEnterDelay={0.3}>
        <button onClick={handleCopy} style={btnStyle}>
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
      </Tooltip>

      {role === 'user' ? (
        <>
          {/* 编辑 */}
          <Tooltip title="编辑后重新发送" mouseEnterDelay={0.3}>
            <button onClick={handleEdit} style={btnStyle}>
              <Icon name="edit" />
            </button>
          </Tooltip>
          {/* 重新发送 */}
          {onResend && (
            <Tooltip title="原样重新发送" mouseEnterDelay={0.3}>
              <button onClick={handleResend} style={btnStyle} disabled={streaming}>
                <Icon name="resend" />
              </button>
            </Tooltip>
          )}
        </>
      ) : (
        <>
          {/* 重新生成 */}
          {onRegenerate && (
            <Popconfirm
              title="重新生成回复?"
              description="当前回复将被替换"
              okText="重新生成"
              cancelText="取消"
              onConfirm={handleRegenerate as any}
              placement="topRight"
            >
              <Tooltip title="重新生成" mouseEnterDelay={0.3}>
                <button style={btnStyle} disabled={streaming}>
                  <Icon name="refresh" />
                </button>
              </Tooltip>
            </Popconfirm>
          )}
          {/* 点赞 */}
          <Tooltip title="这条回复有用" mouseEnterDelay={0.3}>
            <button
              onClick={handleFeedback('up')}
              style={{
                ...btnStyle,
                color: feedback === 'up' ? 'var(--success)' : 'var(--muted-2)',
                background: feedback === 'up' ? 'rgba(16,185,129,0.1)' : 'transparent',
              }}
            >
              <Icon name="thumbUp" />
            </button>
          </Tooltip>
          {/* 点踩 */}
          <Tooltip title="这条回复有问题" mouseEnterDelay={0.3}>
            <button
              onClick={handleFeedback('down')}
              style={{
                ...btnStyle,
                color: feedback === 'down' ? 'var(--danger)' : 'var(--muted-2)',
                background: feedback === 'down' ? 'rgba(239,68,68,0.1)' : 'transparent',
              }}
            >
              <Icon name="thumbDown" />
            </button>
          </Tooltip>
        </>
      )}

      {/* 收藏 */}
      <Tooltip title="收藏到笔记" mouseEnterDelay={0.3}>
        <button onClick={handleBookmark} style={btnStyle}>
          <Icon name="bookmark" />
        </button>
      </Tooltip>
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, padding: 0, border: 'none',
  background: 'transparent', color: 'var(--muted-2)',
  borderRadius: 4, cursor: 'pointer', transition: 'all 0.12s',
};

const Icon: React.FC<{ name: string }> = ({ name }) => {
  const props = {
    width: 12, height: 12, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'copy':
      return (<svg {...props}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>);
    case 'check':
      return (<svg {...props}><polyline points="20 6 9 17 4 12"/></svg>);
    case 'edit':
      return (<svg {...props}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>);
    case 'resend':
      return (<svg {...props}><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>);
    case 'refresh':
      return (<svg {...props}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>);
    case 'thumbUp':
      return (<svg {...props} fill="currentColor" stroke="none"><path d="M14 9V5a3 3 0 0 0-6 0v4H2v11h11.5a3 3 0 0 0 2.88-2.18l1.5-5A3 3 0 0 0 15 9h-1zm-6 11V11"/></svg>);
    case 'thumbDown':
      return (<svg {...props} fill="currentColor" stroke="none"><path d="M10 15v4a3 3 0 0 0 6 0v-4h6V4H10.5a3 3 0 0 0-2.88 2.18l-1.5 5A3 3 0 0 0 9 15h1zm6-11v9"/></svg>);
    case 'bookmark':
      return (<svg {...props}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>);
    default:
      return null;
  }
};

export default MsgActions;
