/**
 * chat/types — ChatView 消息行拆分共享类型 (2026-10-12 第二批)
 * --------------------------------------------------
 * 从 ChatView.tsx 搬来的 RowBinds (原 :72-81) 与流式进度类型
 * (原 :120-131 内联)。MessageList 与 ChatView 共用。
 */

/** 消息行绑定回调 — 按 msg 对象引用缓存, 保 React.memo 浅比较通过 */
export type RowBinds = {
  onResend?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onBookmark?: () => void;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
  /** 合并 durationMs 后的 usage (原每次渲染新建对象, 破坏 memo) */
  usage?: any;
};

/** 2026-06-24 透明进度状态 (ChatView progress state 的类型) */
export type StreamProgress = {
  step: string;
  description: string;
  percent: number;
  iteration?: number;
  maxIterations?: number;
  toolCount?: number;
  toolNames?: string;
  successCount?: number;
  failCount?: number;
  durationMs?: number;
};
