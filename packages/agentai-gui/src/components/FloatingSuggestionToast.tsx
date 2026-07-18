/**
 * FloatingSuggestionToast.tsx
 * 浮动建议弹窗 — 高优先级建议主动弹出，类似装修行业预警系统
 *
 * 特性:
 * - 右下角浮动，带脉冲动画吸引注意
 * - 自动倒计时关闭（用户可暂停）
 * - 一键采纳 / 忽略 / 稍后查看
 * - CSS 变量适配深浅主题
 */

import React, { useState, useEffect, useRef } from 'react';
import { useSuggestionStore, SuggestionItem } from '../store/suggestionStore';

interface Props {
  onAccept?: (suggestion: SuggestionItem) => void;
}

const AUTO_DISMISS_MS = 15000; // 15 秒自动消失

const FloatingSuggestionToast: React.FC<Props> = ({ onAccept }) => {
  const floatingSuggestion = useSuggestionStore(s => s.floatingSuggestion);
  const dismissFloating = useSuggestionStore(s => s.dismissFloating);
  const removeSuggestion = useSuggestionStore(s => s.removeSuggestion);

  const [progress, setProgress] = useState(100);
  const [hovering, setHovering] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 倒计时进度条
  useEffect(() => {
    if (!floatingSuggestion || hovering) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setProgress(100);
    const startTime = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        dismissFloating();
      }
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [floatingSuggestion, hovering, dismissFloating]);

  if (!floatingSuggestion) return null;

  const s = floatingSuggestion;

  // 优先级配色
  const theme = {
    critical: {
      border: 'var(--danger, #ff4d4f)',
      bg: 'linear-gradient(135deg, rgba(255,77,79,0.12), var(--card))',
      iconBg: 'linear-gradient(135deg, #ff4d4f, #ff7875)',
      label: '紧急',
      pulse: 'pulse-red',
    },
    high: {
      border: 'var(--warning, #faad14)',
      bg: 'linear-gradient(135deg, rgba(250,173,20,0.12), var(--card))',
      iconBg: 'linear-gradient(135deg, #faad14, #ffc53d)',
      label: '重要',
      pulse: 'pulse-orange',
    },
    medium: {
      border: 'var(--accent, #1890ff)',
      bg: 'linear-gradient(135deg, rgba(24,144,255,0.10), var(--card))',
      iconBg: 'linear-gradient(135deg, #1890ff, #36cfc9)',
      label: '推荐',
      pulse: '',
    },
    low: {
      border: 'var(--success, #52c41a)',
      bg: 'linear-gradient(135deg, rgba(82,196,26,0.08), var(--card))',
      iconBg: 'linear-gradient(135deg, #52c41a, #73d13d)',
      label: '建议',
      pulse: '',
    },
  }[s.priority] || {
    border: 'var(--border)',
    bg: 'var(--card)',
    iconBg: 'var(--accent)',
    label: '',
    pulse: '',
  };

  const handleAccept = () => {
    if (onAccept) {
      onAccept(s);
    }
    removeSuggestion(s.id);
    dismissFloating();
  };

  const handleDismiss = () => {
    removeSuggestion(s.id);
    dismissFloating();
  };

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 380,
        maxWidth: 'calc(100vw - 48px)',
        zIndex: 9999,
        borderRadius: 14,
        border: `2px solid ${theme.border}`,
        background: theme.bg,
        backdropFilter: 'blur(12px)',
        boxShadow: s.priority === 'critical'
          ? '0 8px 32px rgba(255,77,79,0.25)'
          : '0 8px 32px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        animation: 'toast-slide-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* 倒计时进度条 */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: theme.border,
          width: `${progress}%`,
          transition: 'width 100ms linear',
          opacity: hovering ? 0.3 : 1,
        }}
      />

      {/* 内容区 */}
      <div style={{ padding: '14px 16px' }}>
        {/* 头部 */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: theme.iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            flexShrink: 0,
            color: '#fff',
          }}>
            {s.icon || '💡'}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 2,
            }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: 4,
                background: theme.border,
                color: '#fff',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}>
                {theme.label}
              </span>
              <span style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--fg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {s.title}
              </span>
            </div>
            <div style={{
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.5,
              maxHeight: 40,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {s.description}
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={dismissFloating}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted-2)',
              fontSize: 16,
              padding: 0,
              lineHeight: 1,
              flexShrink: 0,
            }}
            title="稍后再看"
          >
            ✕
          </button>
        </div>

        {/* 操作按钮 */}
        <div style={{
          display: 'flex',
          gap: 8,
          marginTop: 12,
        }}>
          <button
            onClick={handleAccept}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: theme.iconBg,
            }}
          >
            ✅ 采纳
          </button>
          <button
            onClick={handleDismiss}
            style={{
              flex: 1,
              padding: '8px 0',
              borderRadius: 8,
              border: '1px solid var(--border)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--muted)',
              background: 'transparent',
            }}
          >
            忽略
          </button>
        </div>
      </div>

      {/* 动画 keyframes */}
      <style>{`
        @keyframes toast-slide-in {
          0% {
            transform: translateX(420px) scale(0.8);
            opacity: 0;
          }
          100% {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export default FloatingSuggestionToast;
