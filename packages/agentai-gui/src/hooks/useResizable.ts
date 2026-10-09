/**
 * useResizable — 可拖拽侧栏宽度
 * ========================================================================
 * 立项原因（布局审查实测）:
 *   App.tsx:1286 / :1318 三栏宽度硬编码 `width: 260` / `width: 320`，
 *   1366px 屏幕下主内容区只剩 786px；用户无法调整，只能改代码。
 *
 * 设计:
 *   1. 拖拽把手（grip）宽度 4px，hover 显示高亮，不占额外布局空间
 *   2. 双击把手 → 恢复默认宽度
 *   3. 宽度持久化到 localStorage（跨会话保持）
 *   4. 窄屏自动收窄（见clampWidth，低于 1100px 时上限压到 240）
 *   5. 键盘可达：把手支持 ←/→ 方向键调整（无障碍）
 *
 * 为什么不用 CSS `resize` 属性:
 *   `resize: horizontal` 只在 `overflow: hidden/auto` 且元素**非 display:flex 子项**
 *   时生效，且无法控制最小/最大值、无法双击复位、拖拽手柄样式不可控。
 *   三栏布局里侧栏恰好是 flex 子项，CSS resize 不可用。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseResizableOptions {
  /** localStorage 键（用于跨会话保持） */
  storageKey?: string;
  /** 默认宽度（px） */
  defaultWidth?: number;
  /** 最小宽度（px） */
  minWidth?: number;
  /** 最大宽度（px） */
  maxWidth?: number;
  /** 把手在哪一侧 */
  side?: 'left' | 'right';
  /** 是否启用（false 时完全不挂事件） */
  enabled?: boolean;
}

export interface UseResizableResult {
  width: number;
  /** 绑到侧栏容器 div */
  paneRef: React.RefObject<HTMLDivElement>;
  /** 绑到拖拽把手 */
  gripRef: React.RefObject<HTMLDivElement>;
  /** 是否正在拖拽（用于隐藏 iframe 指针/加 body class） */
  resizing: boolean;
  /** 手动设置宽度（双击复位用） */
  reset: () => void;
  /** 绑到把手的 onKeyDown：← → 调整（Shift 加速）、Home 复位 */
  onGripKeyDown: (e: React.KeyboardEvent) => void;
  /** 绑到把手的 onDoubleClick：复位到默认宽度 */
  onGripDoubleClick: () => void;
}

/**
 * 窄屏自适应上限：屏幕越窄，侧栏最大占比越小。
 * 低于 1024px 时侧栏最多占 24%，保证主内容区至少有 ~740px。
 */
function clampWidth(w: number, min: number, max: number): number {
  const screen = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const screenMax = screen < 1024 ? Math.round(screen * 0.24) : max;
  return Math.max(min, Math.min(w, screenMax, max));
}

export function useResizable(opts: UseResizableOptions = {}): UseResizableResult {
  const {
    storageKey = 'agentai.pane.width',
    defaultWidth = 260,
    minWidth = 180,
    maxWidth = 480,
    side = 'right',   // 左侧栏的把手在右边
    enabled = true,
  } = opts;

  const paneRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  // 初始宽度：localStorage → 默认值
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    try {
      const raw = localStorage.getItem(storageKey);
      const n = raw ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(n) && n > 0) return clampWidth(n, minWidth, maxWidth);
    } catch { /* ignore */ }
    return clampWidth(defaultWidth, minWidth, maxWidth);
  });

  const persist = useCallback((w: number) => {
    try { localStorage.setItem(storageKey, String(Math.round(w))); } catch { /* ignore */ }
  }, [storageKey]);

  // ── 鼠标拖拽 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: MouseEvent) => {
      const st = dragState.current;
      if (!st) return;
      e.preventDefault();
      // 左侧栏把手在右边：拖拽方向与鼠标一致
      // 右侧栏把手在左边：方向相反
      const delta = side === 'right' ? e.clientX - st.startX : st.startX - e.clientX;
      const next = clampWidth(st.startWidth + delta, minWidth, maxWidth);
      setWidth(next);
    };

    const onUp = (e: MouseEvent) => {
      if (!dragState.current) return;
      dragState.current = null;
      setResizing(false);
      // ★ 必须同时清body class —— layout.css 靠它给 iframe/video 加
      //   pointer-events:none，否则鼠标移进 iframe 后 mousemove 丢失，
      //   表现为「拖到一半卡住，松手也不恢复」。
      document.body.classList.remove('is-pane-resizing');
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
      // 用最后算出的宽度持久化（读 DOM 避免闭包过期值）
      const el = paneRef.current;
      if (el) {
        const w = parseInt(getComputedStyle(el).width, 10);
        if (Number.isFinite(w)) persist(w);
      }
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      void e;
    };

    const attach = () => {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    const grip = gripRef.current;
    if (!grip) return;
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      dragState.current = {
        startX: e.clientX,
        startWidth: paneRef.current ? parseInt(getComputedStyle(paneRef.current).width, 10) : width,
      };
      setResizing(true);
      // 拖拽时禁用文本选中，防止选中文字
      document.body.classList.add('is-pane-resizing');
      document.body.style.setProperty('user-select', 'none');
      document.body.style.setProperty('cursor', 'col-resize');
      attach();
    };

    const onDblClick = () => {
      setWidth(clampWidth(defaultWidth, minWidth, maxWidth));
      persist(defaultWidth);
    };

    grip.addEventListener('mousedown', onDown);
    grip.addEventListener('dblclick', onDblClick);
    return () => {
      grip.removeEventListener('mousedown', onDown);
      grip.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-pane-resizing');
      document.body.style.removeProperty('user-select');
      document.body.style.removeProperty('cursor');
    };
  }, [enabled, side, minWidth, maxWidth, defaultWidth, persist, width]);

  // ── 屏幕尺寸变化时重新 clamp（拖窗口/改分辨率）────────────────────────
  useEffect(() => {
    const onResize = () => {
      setWidth((w) => {
        const next = clampWidth(w, minWidth, maxWidth);
        return next === w ? w : next;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minWidth, maxWidth]);

  // ── 键盘无障碍：← → 调整，Home 复位 ──────────────────────────────────
  const onGripKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 12;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth((w) => { const n = clampWidth(w - step, minWidth, maxWidth); persist(n); return n; });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth((w) => { const n = clampWidth(w + step, minWidth, maxWidth); persist(n); return n; });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setWidth(clampWidth(defaultWidth, minWidth, maxWidth));
      persist(defaultWidth);
    }
  }, [minWidth, maxWidth, defaultWidth, persist]);

  const reset = useCallback(() => {
    setWidth(clampWidth(defaultWidth, minWidth, maxWidth));
    persist(defaultWidth);
  }, [defaultWidth, minWidth, maxWidth, persist]);

  return {
    width,
    paneRef,
    gripRef,
    resizing,
    reset,
    onGripKeyDown,
    onGripDoubleClick: reset,
  };
}