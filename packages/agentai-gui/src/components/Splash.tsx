/**
 * Splash — 启动欢迎页
 * 品牌: ALTES | 岐黄
 * 设计: 升维塔 LOGO 脉冲动画 + 双语品牌名淡入
 */
import React, { useEffect, useState } from 'react';

interface Props {
  onFinish?: () => void;
  duration?: number;
}

export const Splash: React.FC<Props> = ({ onFinish, duration = 4500 }) => {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => {
      setFadeOut(true);
    }, duration - 400);

    const hideTimer = setTimeout(() => {
      setVisible(false);
      onFinish?.();
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [duration, onFinish]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'linear-gradient(135deg, #1a1a1e 0%, #232328 50%, #1a1a1e 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.4s ease-out',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* LOGO 脉冲动画 */}
        <div
          style={{
            position: 'relative',
            width: 120,
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* 外环脉冲 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '2px solid var(--accent, #CD7A3A)',
              animation: 'altes-ring-expand 2.2s ease-out infinite',
            }}
          />
          {/* 中环脉冲 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '1.5px solid var(--accent, #CD7A3A)',
              animation: 'altes-ring-expand-2 2.2s ease-out infinite',
              animationDelay: '0.5s',
            }}
          />
          {/* 内环脉冲 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: '1px solid var(--accent, #CD7A3A)',
              animation: 'altes-ring-expand-3 2.2s ease-out infinite',
              animationDelay: '1s',
            }}
          />
          {/* LOGO 图标 - 升维塔 */}
          <svg
            width="80"
            height="80"
            viewBox="0 0 64 64"
            style={{
              animation: 'altes-pulse 2.2s ease-in-out infinite',
              zIndex: 2,
              filter: 'drop-shadow(0 4px 12px rgba(205, 122, 58, 0.3))',
            }}
          >
            <defs>
              <linearGradient id="splash-tower" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#CD7A3A" stopOpacity="0.4" />
                <stop offset="50%" stopColor="#CD7A3A" stopOpacity="0.7" />
                <stop offset="100%" stopColor="#E89055" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="14" fill="#1a1a1e" stroke="#CD7A3A33" strokeWidth="1" />
            <path d="M32 10 L50 46 L42 46 L32 26 L22 46 L14 46 Z" fill="url(#splash-tower)" />
            <path d="M32 24 L40 44 L32 38 L24 44 Z" fill="#CD7A3A" />
            <circle cx="32" cy="14" r="3" fill="#E89055" />
          </svg>
        </div>

        {/* 品牌名淡入 - 双语设计 */}
        <div
          style={{
            marginTop: 36,
            textAlign: 'center',
            animation: 'altes-fade-in-up 0.9s ease-out 0.4s both',
          }}
        >
          {/* 英文品牌名 */}
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: 10,
              color: 'var(--fg, #f0f0f4)',
              textShadow: '0 2px 20px rgba(205, 122, 58, 0.2)',
            }}
          >
            ALTES
          </div>
          
          {/* 分隔符 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              margin: '12px 0',
            }}
          >
            <div style={{ width: 40, height: 1, background: 'linear-gradient(90deg, transparent, #CD7A3A)' }} />
            <div
              style={{
                fontSize: 14,
                color: 'var(--accent, #CD7A3A)',
                fontWeight: 500,
              }}
            >
              |
            </div>
            <div style={{ width: 40, height: 1, background: 'linear-gradient(90deg, #CD7A3A, transparent)' }} />
          </div>
          
          {/* 中文品牌名 */}
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--accent, #CD7A3A)',
              letterSpacing: 6,
              fontFamily: '"Noto Serif SC", "Source Han Serif SC", serif',
            }}
          >
            岐 黄
          </div>
          
          {/* 加载进度指示器 */}
          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {/* 进度条 */}
            <div
              style={{
                width: 200,
                height: 2,
                background: 'rgba(205, 122, 58, 0.2)',
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(90deg, transparent, #CD7A3A, transparent)',
                  animation: 'altes-progress 4s ease-out forwards',
                }}
              />
            </div>
            
            {/* 加载状态文字 */}
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted, #888892)',
                fontFamily: 'monospace',
                letterSpacing: 1,
              }}
            >
              <span style={{ animation: 'altes-dots 1.5s infinite' }}>Initializing</span>
            </div>
          </div>
          
          {/* Slogan */}
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted, #888892)',
              letterSpacing: 2,
              marginTop: 16,
              fontStyle: 'italic',
            }}
          >
            以岐黄之术，治数字之疾
          </div>
          
          {/* 英文副标题 */}
          <div
            style={{
              fontSize: 9,
              color: 'var(--muted-2, #66666a)',
              letterSpacing: 3,
              marginTop: 8,
              textTransform: 'uppercase',
            }}
          >
            AI Task & Logic Agent System
          </div>
        </div>
      </div>

      {/* 动画关键帧 */}
      <style>{`
        @keyframes altes-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.06); opacity: 0.9; }
        }
        @keyframes altes-ring-expand {
          0% { transform: scale(0.7); opacity: 0.8; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes altes-ring-expand-2 {
          0% { transform: scale(0.7); opacity: 0; }
          20% { opacity: 0.5; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes altes-ring-expand-3 {
          0% { transform: scale(0.7); opacity: 0; }
          20% { opacity: 0.3; }
          100% { transform: scale(3.2); opacity: 0; }
        }
        @keyframes altes-fade-in-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes altes-progress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes altes-dots {
          0%, 20% { content: 'Initializing'; }
          40% { content: 'Initializing.'; }
          60% { content: 'Initializing..'; }
          80%, 100% { content: 'Initializing...'; }
        }
      `}</style>
    </div>
  );
};

export default Splash;
