/**
 * workspaceRegistry — 可管理的"工作区清单" (批次8, 2026-10-12)
 * ----------------------------------------------------------------
 * 背景: 工作区在 3 处各存一份 (profile.workspace / localStorage 'agentai.workspace'
 *   / gateway /v1/workspace), 但没有一处"清单"能统一管理"我最近用过哪几个工作区"。
 *   本 store 是叠加在这些运行时真相源之上的**可管理清单**:
 *     - 切到某工作区 (switchWorkspace 成功) 就自动 upsert 进来
 *     - 用户可 置顶 / 改名 / 删除 / 一键切换
 * 去重键: 归一化路径 (去尾斜杠 + Windows 大小写不敏感)。
 *
 * ⚠️ 它不是运行时真相源 — 实际工作区仍以 profile/localStorage/gateway 为准,
 *   本清单只负责"记住 + 可管理"。要彻底单一来源另批。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceItem {
  /** 归一化路径 (去尾斜杠; 存储时保留原大小写用于展示, 去重用 normKey) */
  path: string;
  /** 显示名; 缺省时 UI 用路径末段 */
  name?: string;
  pinned?: boolean;
  lastUsedAt: number;
}

interface RegistryState {
  items: WorkspaceItem[];
  /** 当前激活工作区对应的 item index 或路径 (切换时记) */
  activePath?: string;
  /** 新增或更新 (按路径去重) */
  upsert: (path: string, name?: string) => void;
  rename: (path: string, name: string) => void;
  togglePin: (path: string) => void;
  remove: (path: string) => void;
  setActive: (path: string | undefined) => void;
  clear: () => void;
}

/**
 * 去重键: 统一分隔符 (Windows 反斜杠 → 正斜杠) + 去尾斜杠 + 小写。
 * (Windows 大小写不敏感; macOS/Linux 会略微过度合并大小写, 可接受。)
 */
export function normKey(p: string): string {
  return (p || '').trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

const now = () => Date.now();

export const useWorkspaceRegistry = create<RegistryState>()(
  persist(
    (set, get) => ({
      items: [],
      activePath: undefined,
      upsert: (path, name) => {
        const p = (path || '').trim();
        if (!p) return;
        const key = normKey(p);
        const items = get().items;
        const existing = items.find(i => normKey(i.path) === key);
        set(s => ({
          items: existing
            ? s.items.map(i => (normKey(i.path) === key
                ? { ...i, lastUsedAt: now(), name: name ?? i.name }
                : i))
            : [...s.items, { path: p, name, lastUsedAt: now() }],
        }));
      },
      rename: (path, name) => {
        const key = normKey(path);
        set(s => ({ items: s.items.map(i => (normKey(i.path) === key ? { ...i, name: name || undefined } : i)) }));
      },
      togglePin: (path) => {
        const key = normKey(path);
        set(s => ({ items: s.items.map(i => (normKey(i.path) === key ? { ...i, pinned: !i.pinned } : i)) }));
      },
      remove: (path) => {
        const key = normKey(path);
        set(s => ({
          items: s.items.filter(i => normKey(i.path) !== key),
          activePath: s.activePath && normKey(s.activePath) === key ? undefined : s.activePath,
        }));
      },
      setActive: (path) => set({ activePath: path ? normKey(path) : undefined }),
      clear: () => set({ items: [], activePath: undefined }),
    }),
    { name: 'agentai-workspace-registry' },
  ),
);

/** 展示排序: 置顶在前, 其余按最近使用 */
export function sortWorkspaces(items: WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return b.lastUsedAt - a.lastUsedAt;
  });
}
