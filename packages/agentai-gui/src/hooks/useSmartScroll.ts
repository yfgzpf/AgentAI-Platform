/**
 * useSmartScroll — 智能滚动 hook (P2-1: 从 ChatView 抽取)
 *
 * 功能:
 * 1. 新消息到达时自动滚动到底部 (仅当用户在底部附近)
 * 2. 用户手动上滑后不再强制滚动
 * 3. 暴露 isScrolledUp 状态供 UI 显示浮动按钮
 * 4. onDone 方法供 AI 完成后调用
 * 5. scrollToBottom 方法供浮动按钮调用
 */
import { useState, useRef, useCallback, useEffect, type DependencyList } from 'react';

export function useSmartScroll(deps: DependencyList) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const isScrolledUpRef = useRef(false);
  const hasNewMessageRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    isScrolledUpRef.current = !nearBottom;
    setIsScrolledUp(!nearBottom);
    if (nearBottom) hasNewMessageRef.current = false;
  }, []);

  // 新消息到达时自动滚动 (防抖 150ms, 避免图片加载等多次触发)
  const lastScrollTimeRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastScrollTimeRef.current;
    if (elapsed < 150) return; // 去抖: 150ms 内只执行一次
    lastScrollTimeRef.current = now;
    if (scrollRef.current && !isScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } else if (scrollRef.current) {
      hasNewMessageRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // AI 完成后的智能滚动
  const onDone = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  // 手动滚动到底部
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      isScrolledUpRef.current = false;
      setIsScrolledUp(false);
      hasNewMessageRef.current = false;
    }
  }, []);

  // 重置 (会话切换时调用)
  const reset = useCallback(() => {
    isScrolledUpRef.current = false;
    setIsScrolledUp(false);
    hasNewMessageRef.current = false;
  }, []);

  return {
    scrollRef,
    isScrolledUp,
    handleScroll,
    onDone,
    scrollToBottom,
    reset,
  };
}
