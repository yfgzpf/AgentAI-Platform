import React from 'react';

/**
 * 页头条 —— 统一标题条的高度与内边距 (2026-10-12)。
 *
 * 背景: 各页原先的标题条/工具栏内边距有 12/16/20 三种写法, 高度从 32 到 52 不等,
 * 边框颜色还有一处硬编码 #303030。高度现统一走 --page-head-h, 内边距走 --page-pad-x。
 *
 * 样式在 styles/shell.css (.page-header / -title / -sub / -actions)。
 */
interface PageHeaderProps {
  /** 标题 (文本或节点) */
  title: React.ReactNode;
  /** 副标题 —— 单行省略, 建议一句话说明本页做什么 */
  subtitle?: React.ReactNode;
  /** 左侧图标 (建议 16px, 颜色由 .page-header-icon 统一给 --accent) */
  icon?: React.ReactNode;
  /** 右侧操作区 (按钮组等, 自动 margin-left:auto 靠右) */
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon, actions }) => (
  <div className="page-header">
    {icon ? <span className="page-header-icon">{icon}</span> : null}
    <span className="page-header-title">{title}</span>
    {subtitle ? <span className="page-header-sub">{subtitle}</span> : null}
    {actions ? <div className="page-header-actions">{actions}</div> : null}
  </div>
);
