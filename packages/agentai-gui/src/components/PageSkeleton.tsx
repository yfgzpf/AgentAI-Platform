/**
 * PageSkeleton — 通用骨架屏组件
 * 用于 React.lazy 代码分割时的加载占位
 * 跟随主题变量, 无硬编码颜色
 */
import React, { useState, useEffect } from 'react';

export const PageSkeleton: React.FC = () => {
  const [showTimeout, setShowTimeout] = useState(false);
  
  // 5秒后显示超时提示，避免无限加载
  useEffect(() => {
    const timer = setTimeout(() => setShowTimeout(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  
  const shimmerStyle: React.CSSProperties = {
    background: 'var(--card-hover)',
    borderRadius: 'var(--radius, 8px)',
    animation: 'skeletonPulse 1.5s ease-in-out infinite',
  };

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 超时提示 */}
      {showTimeout && (
        <div style={{ 
          padding: 12, 
          background: 'var(--warning-soft)', 
          borderRadius: 'var(--radius, 8px)',
          color: 'var(--warning)',
          fontSize: 14,
          marginBottom: 8
        }}>
          页面加载较慢，请检查网络连接或刷新页面重试
        </div>
      )}
      
      {/* 标题行 */}
      <div style={{ ...shimmerStyle, width: 200, height: 24 }} />
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ ...shimmerStyle, width: 120, height: 32 }} />
        <div style={{ ...shimmerStyle, width: 120, height: 32 }} />
        <div style={{ ...shimmerStyle, flex: 1, height: 32 }} />
      </div>
      {/* 内容块 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <div style={{ ...shimmerStyle, width: '100%', height: 80 }} />
        <div style={{ ...shimmerStyle, width: '90%', height: 60 }} />
        <div style={{ ...shimmerStyle, width: '95%', height: 60 }} />
        <div style={{ ...shimmerStyle, width: '85%', height: 80 }} />
      </div>
      {/* 底部输入区 */}
      <div style={{ ...shimmerStyle, width: '100%', height: 48 }} />
    </div>
  );
};
