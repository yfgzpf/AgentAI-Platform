import React from 'react';
import { Button, Empty } from 'antd';

/**
 * 页面级空态 —— 统一原先 30 处 Antd `<Empty>` 与 50 处手写「暂无数据」(2026-10-12)。
 *
 * ⚠️ 只用于**页面级**空态 (整个页面主体为空)。卡片内、列表内的小空态保持原样 ——
 * 那些位置的密度与小字号是刻意的, 强行套用大尺寸空态反而更差。
 *
 * 样式: .page-empty (styles/shell.css)。
 */
interface EmptyStateProps {
  /** 主说明, 例如「还没有会话」「未选择文件」 */
  description?: React.ReactNode;
  /** 次要说明 —— 引导用户下一步该做什么 */
  hint?: React.ReactNode;
  /** 主操作按钮文案 (与 onAction 同时提供才渲染) */
  actionLabel?: string;
  onAction?: () => void;
  /** 自定义插图 */
  image?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  description = '暂无数据',
  hint,
  actionLabel,
  onAction,
  image,
}) => (
  <div className="page-empty">
    <Empty
      image={image}
      description={
        <span>
          {description}
          {hint ? (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--muted)', marginTop: 4 }}>
              {hint}
            </div>
          ) : null}
        </span>
      }
    >
      {actionLabel && onAction ? (
        <Button type="primary" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Empty>
  </div>
);
