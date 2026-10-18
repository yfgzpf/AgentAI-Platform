/**
 * rail-styles — 右栏模式切换条样式 (2026-10-12 从 App.tsx 拆出)
 * -------------------------------------------------------------
 * 原 App.tsx:175-189。模块级定义 (避免每次渲染新建对象)。
 */
import type React from 'react';

export function railTabStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 'var(--fs-micro)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-sm)',
    cursor: 'pointer', userSelect: 'none',
    color: active ? 'var(--accent)' : 'var(--muted-2)',
    background: active ? 'var(--accent-soft)' : 'transparent',
    transition: 'color 0.15s, background 0.15s',
  };
}

export const railIconStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 20, height: 20, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
};