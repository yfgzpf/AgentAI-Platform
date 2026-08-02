/**
 * PageSkeleton — 通用骨架屏组件
 * 用于 React.lazy 代码分割时的加载占位
 * 跟随主题变量, 无硬编码颜色
 *
 * ╔═══════════════════════════════════════════════════════════╗
 * ║ 构建vs开发一致性修复 (P1):                               ║
 * ║ - 超时阈值 5s → 15s (生产构建 IO 比 dev 慢, 减少误报)   ║
 * ║ - 超时提示改为单行 inline 文本, 不再是独立卡片           ║
 * ║   消除"无形多了一个警告框"的视觉感受                     ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
import React, { useState, useEffect } from 'react';

export const PageSkeleton: React.FC = () => {
  const [showTimeout, setShowTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowTimeout(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  const shimmerStyle: React.CSSProperties = {
    background: 'var(--card-hover)',
    borderRadius: 'var(--radius, 8px)',
    animation: 'skeletonPulse 1.5s ease-in-out infinite',
    opacity: 0.7,
  };

  return (
    <div style={{
      padding: 24, height: '100%',
      display: 'flex', flexDirection: 'column', gap: 16,
      background: 'var(--bg)',
    }}>
      {showTimeout && (
        <div style={{
          fontSize: 12,
          color: 'var(--muted)',
          textAlign: 'right',
          padding: '0 2px',
        }}>
          组件加载中…若停留时间过久请刷新
        </div>
      )}

      <div style={{ ...shimmerStyle, width: 200, height: 24 }} />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...shimmerStyle, width: 120, height: 32 }} />
        <div style={{ ...shimmerStyle, width: 120, height: 32 }} />
        <div style={{ ...shimmerStyle, flex: 1, height: 32 }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div style={{ ...shimmerStyle, width: '100%', height: 80 }} />
        <div style={{ ...shimmerStyle, width: '90%', height: 60 }} />
        <div style={{ ...shimmerStyle, width: '95%', height: 60 }} />
        <div style={{ ...shimmerStyle, width: '85%', height: 80 }} />
      </div>
      <div style={{ ...shimmerStyle, width: '100%', height: 48 }} />
    </div>
  );
};
