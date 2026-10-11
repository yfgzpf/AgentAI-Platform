/**
 * 页面壳层三件 —— 所有页面的统一骨架 (2026-10-12)。
 *
 *   import { PageShell, PageHeader, EmptyState } from '../shell';
 *
 * 用法:
 *   <PageShell>
 *     <PageHeader title="用量" subtitle="工具调用统计" icon={<ThunderboltOutlined />} actions={...} />
 *     <div className="page-body">
 *       {list.length ? <List .../> : <EmptyState description="暂无调用记录" hint="对话中触发工具后会出现在这里" />}
 *     </div>
 *   </PageShell>
 *
 * 契约与反例见 styles/shell.css 头注释。
 */
export { PageShell } from './PageShell';
export { PageHeader } from './PageHeader';
export { EmptyState } from './EmptyState';
