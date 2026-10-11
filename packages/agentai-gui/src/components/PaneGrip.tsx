/**
 * PaneGrip — 可拖拽面板把手 (通用)
 * ========================================================================
 * 立项原因 (2026-10-11 布局审查):
 *   `useResizable` 早已存在且完整 (持久化 / 窄屏 clamp / 键盘无障碍 / 双击复位),
 *   但只有外壳三栏用了它。页面内部的控制栏仍是硬编码宽度 —— 同一份把手 JSX
 *   在 App.tsx 里手写了 2 遍, 再复制到 VideoGen / ImageStudio 就是 5 遍。
 *
 * 用法 (外层必须带 `page-pane page-pane--left|--right`, 定位由 CSS 负责):
 *   const ctrlPane = useResizable({ storageKey: 'agentai.video.ctrlW', defaultWidth: 420, ... });
 *   <div ref={ctrlPane.paneRef} className="page-pane page-pane--left" style={{ width: ctrlPane.width }}>
 *     <PaneGrip resizable={ctrlPane} min={260} max={620} label="调整控制面板宽度" />
 *     <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>…</div>
 *   </div>
 *
 * 注意: 本组件刻意不带定位类 —— `.pane-grip` 的 left/right 由父级
 * `.page-pane--left/--right` 决定, 与 `.app-pane-left/--right` 的既有做法一致。
 */

import React from 'react';
import type { UseResizableResult } from '../hooks/useResizable';

interface PaneGripProps {
  resizable: UseResizableResult;
  /** 与 useResizable 的 minWidth / maxWidth 保持一致 —— 供 aria-valuemin/max 朗读 */
  min: number;
  max: number;
  /** 无障碍标签主体, 例: "调整控制面板宽度" */
  label: string;
}

export const PaneGrip: React.FC<PaneGripProps> = ({ resizable: r, min, max, label }) => (
  <div
    ref={r.gripRef}
    className={`pane-grip${r.resizing ? ' is-dragging' : ''}`}
    role="separator"
    aria-orientation="vertical"
    aria-label={`${label}（方向键调整，双击复位）`}
    aria-valuenow={r.width}
    aria-valuemin={min}
    aria-valuemax={max}
    tabIndex={0}
    onKeyDown={r.onGripKeyDown}
    onDoubleClick={r.onGripDoubleClick}
  />
);

export default PaneGrip;
