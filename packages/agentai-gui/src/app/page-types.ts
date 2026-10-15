/**
 * page-types — 页面注册表的类型定义 (2026-10-12 从 App.tsx 拆出)
 * -------------------------------------------------------------
 * 遵循 AGENTS.md「组件注册必须走 PAGES 字典」: 这里是字典的**类型契约**,
 * PAGES 数组本身留在 App.tsx (它引用 20+ lazy 组件, 搬家会引发 import 重排)。
 * FeatureGuide 需要 PageMeta 类型, 故把类型单独成文件避免循环依赖。
 */
import type React from 'react';

export type PageKey =
  | 'chat' | 'write' | 'image' | 'video' | '3d' | 'pascal' | 'decorai' | 'editor'
  | 'skills' | 'qq' | 'wechat' | 'knowledge' | 'settings' | 'notification'
  | 'workflow' | 'suggestions' | 'xuanji' | 'automation' | 'tasks' | 'stats'
  | 'evolution' | 'monitoring' | 'knowledge-explore' | 'soul' | 'pentest-scope';

export interface PageMeta {
  key: PageKey;
  label: string;
  icon: React.ReactNode;
  comp: React.FC;
  /** 在 Sidebar 出现时排序分组 */
  group: 'core' | 'media' | 'system';
  /** 描述, 悬浮 tooltip 用 */
  desc: string;
  /** 导航下拉内的分组标题. system 组 15 项平铺太长, 用它切成可扫读的段落;
   *  同 section 的条目必须在数组里连续 (下拉按数组顺序渲染)。 */
  section?: string;
  /** 右上角小徽章 (可选) */
  badge?: string;
  /** 是否需要订阅才能使用 */
  requireSubscription?: boolean;
  /** 是否在侧栏隐藏 (空壳/半成品栏目, 代码保留但不在导航中显示) */
  hidden?: boolean;
}