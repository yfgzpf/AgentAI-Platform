/**
 * Splash — 启动进入首页 (极简质感版: Logo + 品牌名 + 一句话标语)
 * ----------------------------------------------------------------
 * 去繁琐: 无粒子 / 网格 / 光斑 / 标签飘出 / 状态轮播, 仅品牌标识 + 标语。
 * 质感来源(而非堆元素): 呼吸光晕 + Logo 描边入场 + 渐变字标 + 底部细进度条。
 * 保留: fixed 容器 / 自动消失 / 点击任意位置跳过。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { BrandLogo } from './BrandLogo';

interface Props {
  onFinish?: () => void;
  duration?: number;          // 总停留时间 (默认 4000ms)
  minDuration?: number;       // 最少停留 (避免太快消失)
}

export const Splash: React.FC<Props> = ({ onFinish, duration = 4000, minDuration = 2800 }) => {
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const handleSkip = useCallback(() => {
    if (skipped) return;
    setSkipped(true);
    setFadeOut(true);
    setTimeout(() => {
      setVisible(false);
      onFinish?.();
    }, 300);
  }, [skipped, onFinish]);

  useEffect(() => {
    if (skipped) return;
    const finalDuration = Math.max(duration, minDuration);
    const fadeTimer = setTimeout(() => setFadeOut(true), finalDuration - 500);
    const hideTimer = setTimeout(() => {
      setVisible(false);
      onFinish?.();
    }, finalDuration);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [duration, minDuration, onFinish, skipped]);

  if (!visible) return null;
  const finalDuration = Math.max(duration, minDuration);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(ellipse at 50% 42%, #16161f 0%, #0d0d13 58%, #08080c 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 'var(--z-dragging)',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
        overflow: 'hidden',
        cursor: skipped ? 'wait' : 'pointer',
        userSelect: 'none',
      }}
      onClick={handleSkip}
    >
      {/* 中心呼吸光晕 — 唯一的"动", 营造呼吸感而非堆砌特效 */}
      <div style={{
        position: 'absolute',
        left: '50%', top: '44%',
        width: 520, height: 520,
        marginLeft: -260, marginTop: -260,
        background: 'radial-gradient(circle, rgba(205,122,58,0.20) 0%, rgba(205,122,58,0.06) 45%, transparent 70%)',
        animation: 'splash-breathe 5.5s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      {/* 主体: Logo + 字标 + 标语 */}
      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      }}>
        <div className="splash-logo" style={{ position: 'relative', display: 'flex' }}>
          <BrandLogo size={88} glow animate />
        </div>

        <h1 className="splash-name" style={{
          margin: '22px 0 0',
          fontSize: 27,
          fontWeight: 700,
          letterSpacing: 6,
          paddingLeft: 6, // 抵消末字母后的字距, 保证视觉居中
          background: 'linear-gradient(120deg, #F6D3B0 0%, #E89055 45%, #CD7A3A 100%)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
        }}>
          PulseFlow
        </h1>

        <div className="splash-divider" style={{
          width: 132, height: 1, marginTop: 18,
          background: 'linear-gradient(90deg, transparent, rgba(205,122,58,0.55), transparent)',
        }} />

        <p className="splash-tagline" style={{
          margin: '16px 0 0',
          fontSize: 14,
          fontWeight: 400,
          letterSpacing: 3,
          paddingLeft: 3,
          color: 'rgba(240,232,224,0.66)',
        }}>
          让创作直接产生价值的智能体
        </p>
      </div>

      {/* 底部: 细进度条 + 跳过提示 — 暗示"正在准备", 让停留不显空洞 */}
      <div style={{
        position: 'absolute',
        left: 0, right: 0, bottom: 40,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
      }}>
        <div style={{
          width: 128, height: 2, borderRadius: 2,
          background: 'rgba(255,255,255,0.08)',
          overflow: 'hidden',
        }}>
          <div className="splash-progress" style={{
            height: '100%', width: 0, borderRadius: 2,
            background: 'linear-gradient(90deg, #E89055, #CD7A3A)',
            animationDuration: `${finalDuration}ms`,
          }} />
        </div>
        <div className="splash-skip" style={{
          marginTop: 14,
          fontSize: 11, letterSpacing: 2,
          color: 'rgba(240,240,248,0.28)',
        }}>
          点击任意位置跳过
        </div>
      </div>

      <style>{`
        @keyframes splash-rise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes splash-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes splash-breathe {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.07); }
        }
        @keyframes splash-progress { from { width: 0; } to { width: 100%; } }

        /* 分层入场: Logo → 字标 → 分割线 → 标语 → 底部, 错落淡入 */
        .splash-logo    { animation: splash-rise 0.75s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .splash-name    { animation: splash-rise 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.16s both; }
        .splash-divider { animation: splash-fade 0.7s ease both 0.42s; }
        .splash-tagline { animation: splash-rise 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both; }
        .splash-skip    { animation: splash-fade 0.8s ease both 0.75s; }
        .splash-progress { animation-name: splash-progress; animation-timing-function: linear; animation-fill-mode: forwards; }

        @media (prefers-reduced-motion: reduce) {
          .splash-logo, .splash-name, .splash-divider, .splash-tagline, .splash-skip {
            animation: none; opacity: 1; transform: none;
          }
          div[style*="splash-breathe"], .splash-breathe { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default Splash;