/**
 * BrandLogo — PulseFlow 品牌标识 (2026-10-10)
 * ----------------------------------------------------------------
 * 设计理念: 两个交叠流线 = Pulse (脉动) + Flow (流动)
 * 极简几何, 可缩放, 单色自适应主题
 *
 * 大品牌参考: Linear(几何), Vercel(三角形), Stripe(渐变线)
 */
import React from 'react';

interface BrandLogoProps {
  size?: number;
  /** 是否带光晕动画 (欢迎页用) */
  glow?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ size = 56, glow = false }) => {
  return (
    <div style={{
      width: size, height: size,
      position: 'relative',
      filter: glow ? 'drop-shadow(0 4px 20px rgba(205,122,58,0.35))' : 'none',
      transition: 'filter 0.3s ease',
    }}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="pf-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#E89055" />
            <stop offset="100%" stopColor="#CD7A3A" />
          </linearGradient>
          <linearGradient id="pf-grad-2" x1="100%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#CD7A3A" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#E89055" stopOpacity="0.3" />
          </linearGradient>
        </defs>

        {/* 外圆角方 — 品牌容器 */}
        <rect width="64" height="64" rx="16" fill="#1a1a22" />

        {/* 左侧流线 (Pulse) — 从下到上的弧线 */}
        <path
          d="M18 48 C 18 36, 24 28, 24 16"
          stroke="url(#pf-grad)"
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* 右侧流线 (Flow) — 从上到下的弧线, 与左侧交叠 */}
        <path
          d="M46 16 C 46 28, 40 36, 40 48"
          stroke="url(#pf-grad-2)"
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
        />

        {/* 交叠点 — 脉冲圆点 */}
        <circle cx="32" cy="32" r="4" fill="#E89055" />
        <circle cx="32" cy="32" r="2" fill="#fff" opacity="0.9" />
      </svg>
    </div>
  );
};

export default BrandLogo;
