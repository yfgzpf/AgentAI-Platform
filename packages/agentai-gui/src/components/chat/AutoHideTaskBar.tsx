/**
 * AutoHideTaskBar — 自动隐藏的任务提示条包装器
 * 用户未操作时自动收起，避免常驻遮挡视线
 *
 * 2026-10-12 从 ChatView.tsx (2454 行) 拆出 — ChatView 瘦身计划第一批。
 * 原位置: ChatView.tsx:9-30。
 */
import React, { useState, useEffect } from 'react';

export const AutoHideTaskBar: React.FC<{
  children: React.ReactNode;
  visible: boolean;
  delay?: number;
  onHidden?: () => void;
}> = ({ children, visible, delay = 8000, onHidden }) => {
  const [show, setShow] = useState(visible);

  useEffect(() => {
    if (!visible) { setShow(false); return; }
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      onHidden?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, delay]);

  if (!show) return null;
  return <>{children}</>;
};

export default AutoHideTaskBar;
