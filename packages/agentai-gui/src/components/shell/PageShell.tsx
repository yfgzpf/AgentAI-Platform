import React from 'react';

/**
 * 页面根壳 —— 统一「高度 / 滚动 / 透明底」三条契约 (2026-10-12)。
 *
 * 背景: 24 个页面原先各自内联 `style={{ display:'flex', flexDirection:'column',
 * height:'100%' }}` (12 页), 其余干脆不设高度; 3 个页面还把不透明底画在根上
 * (Editor 用 --editor-bg / SoulPanel 用 --bg-1 / WorkflowPanel 用 --panel),
 * 把 .app-content 的氛围层整个盖死。同一个"页面根"有五六种实现。
 *
 * 本组件**不画背景** —— 让 .app-content 的「星野·深空」透出来。页面若要底色,
 * 请画在自己的子元素上 (例如工具栏 / 卡片), 不要画在根。
 *
 * 样式在 styles/shell.css (.page-shell), 由 main.tsx 第 5 层导入。
 */
interface PageShellProps {
  children: React.ReactNode;
  /** 附加类名 (会追加在 page-shell 之后) */
  className?: string;
  /** 便于测试/定位的锚点 → data-testid */
  testId?: string;
}

export const PageShell: React.FC<PageShellProps> = ({ children, className, testId }) => (
  <div
    className={className ? `page-shell ${className}` : 'page-shell'}
    data-page-shell=""
    data-testid={testId}
  >
    {children}
  </div>
);
