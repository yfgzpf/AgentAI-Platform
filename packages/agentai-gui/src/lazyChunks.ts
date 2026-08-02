/**
 * lazyChunks.ts — 共享的 React.lazy 代码分割单例
 * ---------------------------------------------------
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║ 构建vs开发一致性修复 (P1):                                   ║
 * ║                                                               ║
 * ║ 问题: 两个不同文件各自 React.lazy(() => import('./Xxx'))     ║
 * ║       → 生产构建下生成 2 份独立 Promise wrapper              ║
 * ║       → 模块加载时序微抖动 → CSS 注入不一致 → 样式混乱/闪   ║
 * ║                                                               ║
 * ║ 修复: 所有跨文件复用的懒加载组件统一从此文件导出             ║
 * ║       → 全应用共享同一 Promise wrapper                       ║
 * ║       → 首屏预优化: 空闲时 (requestIdleCallback) 预加载      ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */
import { lazy } from 'react';

/* -------- 知识图谱 (App.tsx PAGES + KnowledgeBasePanel.tsx 两处复用) -------- */
export const KnowledgeGraphPanelChunk = lazy(
  () => import('./components/knowledge/KnowledgeGraphPanel')
);

/* -------- 首屏之后空闲预加载: 知识图谱 + 知识库 + 设置 + 自动化 -------- */
const PRELOAD_LAZY_PATHS: Array<() => Promise<any>> = [
  () => import('./components/knowledge/KnowledgeGraphPanel'),
  () => import('./components/KnowledgeBasePanel'),
  () => import('./components/Settings'),
  () => import('./components/AutomationPanel'),
];

let preloaded = false;
export function preloadLazyChunks(): void {
  if (preloaded) return;
  preloaded = true;
  const schedule = typeof requestIdleCallback !== 'undefined'
    ? (cb: IdleRequestCallback) => requestIdleCallback(cb, { timeout: 3000 })
    : (cb: () => void) => window.setTimeout(cb, 1200);
  schedule(() => {
    PRELOAD_LAZY_PATHS.forEach(loader => {
      try { loader(); } catch { /* 静默: 预加载是纯优化 */ }
    });
  });
}
