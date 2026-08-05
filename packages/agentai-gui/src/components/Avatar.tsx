/**
 * Avatar — 精致双层环 + 字母头像
 * ----------------------------------------------------
 * 设计: 外环 (accent border) + 内圆 (渐变) + 居中字母
 *
 * AI 头像 (kind=ai):
 *   - 按 provider 取色的对角渐变
 *   - pending 时外环呼吸光晕
 *   - 异常时右上角红点
 *   - 显示 provider 首字母
 *
 * 用户头像 (kind=user):
 *   - 名字哈希生成的 HSL 渐变
 *   - 显示名字首字
 *   - 自定义头像图: 覆盖
 *
 * 默认尺寸 24px (对话流)
 */
import React, { useState } from 'react';
import { Tooltip } from 'antd';

export type AvatarKind = 'user' | 'ai' | 'group' | 'system';

export interface AvatarProps {
  kind: AvatarKind;
  /** AI: provider id (agentai/deepseek/openai/cline/zhipu) / 用户: 名字 */
  name?: string;
  /** 头像图片 URL (可选, 覆盖) */
  src?: string;
  /** 状态: pending=思考中, done=已回复, error=失败 */
  state?: 'pending' | 'done' | 'error' | 'idle';
  /** 尺寸, 默认 24 (对话流) */
  size?: number;
  messageId?: string;
  onClick?: () => void;
}

/** provider → 配色 */
const PROVIDER_PALETTE: Record<string, { grad: string; ring: string; label: string; letter: string }> = {
  agentai: {
    grad: 'linear-gradient(135deg, #A78BFA 0%, #6366F1 50%, #4338CA 100%)',
    ring: 'rgba(99,102,241,0.85)',
    label: 'PulseFlow',
    letter: 'A',
  },
  deepseek: {
    grad: 'linear-gradient(135deg, #67E8F9 0%, #06B6D4 50%, #0369A1 100%)',
    ring: 'rgba(6,182,212,0.85)',
    label: 'DeepSeek',
    letter: 'D',
  },
  openai: {
    grad: 'linear-gradient(135deg, #6EE7B7 0%, #10B981 50%, #047857 100%)',
    ring: 'rgba(16,185,129,0.85)',
    label: 'OpenAI',
    letter: 'O',
  },
  cline: {
    grad: 'linear-gradient(135deg, #FCD34D 0%, #F59E0B 50%, #B45309 100%)',
    ring: 'rgba(245,158,11,0.85)',
    label: 'Cline',
    letter: 'C',
  },
  zhipu: {
    grad: 'linear-gradient(135deg, #F9A8D4 0%, #EC4899 50%, #BE185D 100%)',
    ring: 'rgba(236,72,153,0.85)',
    label: '智谱 GLM',
    letter: 'Z',
  },
  default: {
    grad: 'linear-gradient(135deg, #A78BFA 0%, #6366F1 50%, #4338CA 100%)',
    ring: 'rgba(99,102,241,0.85)',
    label: 'PulseFlow',
    letter: 'A',
  },
};

/** 根据名字生成用户色 */
function userPalette(name: string): { grad: string; ring: string; letter: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const h2 = (h + 40) % 360;
  // 取中文字符首字
  const letter = name.charAt(0).toUpperCase();
  return {
    grad: `linear-gradient(135deg, hsl(${h}, 80%, 65%) 0%, hsl(${h}, 75%, 50%) 50%, hsl(${h2}, 70%, 40%) 100%)`,
    ring: `hsla(${h}, 80%, 60%, 0.85)`,
    letter,
  };
}

export const Avatar: React.FC<AvatarProps> = ({
  kind, name = '', src, state = 'idle', size = 24, messageId, onClick,
}) => {
  const [errored, setErrored] = useState(false);
  const [hovered, setHovered] = useState(false);
  const useImage = src && !errored;
  const isAI = kind === 'ai';
  const isPending = state === 'pending';

  // 解析 provider
  const providerKey = (name || '').toLowerCase().split(/[-:]/)[0];
  const aiPal = isAI ? (PROVIDER_PALETTE[providerKey] || PROVIDER_PALETTE.default) : null;
  const userPal = !isAI ? userPalette(name || 'U') : null;

  const tooltipText = isAI
    ? `${aiPal!.label} · ${name || 'PulseFlow'}`
    : name || '你';

  // 字号按尺寸缩放
  const fontSize = Math.max(9, Math.round(size * 0.45));
  const ringWidth = Math.max(1, Math.round(size * 0.06));
  // X 字符大小
  const xFontSize = Math.max(10, Math.round(size * 0.55));

  return (
    <Tooltip title={tooltipText} mouseEnterDelay={0.4}>
      <div
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: 'relative',
          width: size, height: size,
          flexShrink: 0,
          cursor: onClick ? 'pointer' : 'default',
          transition: 'transform 0.18s ease',
          transform: hovered ? 'scale(1.06)' : 'scale(1)',
        }}
      >
        {/* 错误徽标 (右上角) */}
        {state === 'error' && (
          <div
            style={{
              position: 'absolute', right: -2, top: -2, zIndex: 5,
              width: 7, height: 7, borderRadius: '50%',
              background: '#ef4444',
              border: '1.5px solid var(--panel, #141414)',
              boxShadow: '0 0 4px rgba(239,68,68,0.6)',
            }}
          />
        )}

        {/* === AI 默认: 渲染 X 图标 (替代字母) === */}
        {!useImage && isAI ? (
          <div
            data-msg-id={messageId}
            style={{
              position: 'relative',
              width: size, height: size, borderRadius: '50%',
              background: 'var(--panel, #141414)',
              border: `${ringWidth}px solid ${aiPal!.ring}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isPending
                ? `0 0 6px 2px ${aiPal!.ring}`
                : '0 1px 3px rgba(0,0,0,0.2)',
              opacity: isPending ? 0.85 : 1,
              animation: isPending ? 'avatarPulse 1.4s ease-in-out infinite' : 'none',
              transition: 'box-shadow 0.3s ease, opacity 0.3s ease',
            }}
          >
            {/* PulseFlow 脉搏波纹 */}
            <svg
              viewBox="0 0 24 24"
              width={Math.round(size * 0.6)}
              height={Math.round(size * 0.6)}
              style={{ display: 'block' }}
            >
              <polyline
                points="2,12 6,12 8,6 11,18 14,9 16,12 22,12"
                fill="none"
                stroke={aiPal!.ring}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : useImage ? (
          <div
            data-msg-id={messageId}
            style={{
              width: size, height: size, borderRadius: '50%', overflow: 'hidden',
              border: `${ringWidth}px solid ${isAI ? aiPal!.ring : userPal!.ring}`,
              boxShadow: isPending
                ? `0 0 6px 2px ${isAI ? aiPal!.ring : userPal!.ring}`
                : '0 1px 3px rgba(0,0,0,0.2)',
            }}
          >
            <img src={src} alt={tooltipText} onError={() => setErrored(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        ) : (
          <div
            data-msg-id={messageId}
            style={{
              position: 'relative',
              width: size, height: size, borderRadius: '50%',
              background: userPal!.grad,
              border: `${ringWidth}px solid ${userPal!.ring}`,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff',
              fontSize, fontWeight: 700, letterSpacing: 0,
              boxShadow: isPending
                ? `0 0 6px 2px ${userPal!.ring}`
                : '0 1px 3px rgba(0,0,0,0.2)',
              opacity: isPending ? 0.85 : 1,
              animation: isPending ? 'avatarPulse 1.4s ease-in-out infinite' : 'none',
              transition: 'box-shadow 0.3s ease, opacity 0.3s ease',
            }}
          >
            {/* 内部高光: 提升质感 */}
            <div
              style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'radial-gradient(circle at 30% 25%, rgba(255,255,255,0.25) 0%, transparent 50%)',
                pointerEvents: 'none',
              }}
            />
            <span style={{ position: 'relative', zIndex: 1, textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}>
              {userPal!.letter}
            </span>
          </div>
        )}
      </div>
    </Tooltip>
  );
};

export default Avatar;

/* ====================== 动画样式注入 (幂等) ====================== */

const STYLE_ID = 'avatar-animations-v4';
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const sheet = document.createElement('style');
  sheet.id = STYLE_ID;
  sheet.textContent = `
    @keyframes avatarPulse {
      0%, 100% { opacity: 0.7; }
      50%      { opacity: 1; }
    }
  `;
  document.head.appendChild(sheet);
}
