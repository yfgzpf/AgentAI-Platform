/**
 * EmotionIndicator — 情绪指示器组件
 * 显示用户消息的情绪状态 (emoji + 强度条)
 */
import React from 'react';
import type { EmotionType } from '../services/emotion';

/* ===== 情绪颜色 ===== */
const EMOTION_COLORS: Record<EmotionType, string> = {
  positive:   '#22c55e',
  negative:   '#ef4444',
  neutral:    '#9ca3af',
  anxious:    '#f59e0b',
  angry:      '#dc2626',
  surprised:  '#8b5cf6',
  sad:        '#6366f1',
  joyful:     '#10b981',
};

interface Props {
  emotion: EmotionType;
  intensity: number;
  emoji: string;
  label: string;
  compact?: boolean;
}

export const EmotionIndicator: React.FC<Props> = ({
  emotion, intensity, emoji, label, compact,
}) => {
  const color = EMOTION_COLORS[emotion] || 'var(--muted-2)';
  const barWidth = `${Math.round(intensity * 100)}%`;

  return (
    <span
      title={`${label} (${Math.round(intensity * 100)}%)`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: compact ? 2 : 4,
        padding: compact ? '0 2px' : '1px 6px',
        borderRadius: 10,
        background: compact ? 'transparent' : `${color}15`,
        fontSize: compact ? 10 : 11,
        cursor: 'default',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: compact ? 10 : 12, lineHeight: 1 }}>{emoji}</span>
      {!compact && (
        <>
          <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>{label}</span>
          {/* Intensity bar */}
          <span style={{
            width: 24, height: 3, borderRadius: 2,
            background: 'var(--border)',
            display: 'inline-block', overflow: 'hidden',
          }}>
            <span style={{
              width: barWidth, height: '100%',
              background: color,
              borderRadius: 2,
              transition: 'width 0.4s ease',
              display: 'block',
            }} />
          </span>
        </>
      )}
    </span>
  );
};
