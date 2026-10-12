/**
 * workspace-switch — 工作区切换单一入口 (2026-10-12)
 * ----------------------------------------------------
 * 背景: 「工作区」在三处各存一份 (profile.workspace / localStorage /
 * gateway /v1/workspace), 切换逻辑原本只写在 WorkspaceSelector 内部,
 * 外部无法复用 → 会话列表点进历史会话时无法把工作区切回去。
 *
 * 本模块把这套 4 步 (localStorage → profileStore → 事件广播 → gateway 同步)
 * 抽为唯一入口, 保证任何调用方切换工作区都走同一条路径, 不会漏步。
 */
import { useProfileStore } from '../store';
import { useWorkspaceRegistry } from '../store/workspaceRegistry';

/** 读当前工作区 (profile 优先, 回退 localStorage) */
export function getCurrentWorkspace(): string {
  const profile = useProfileStore.getState()?.profile as Record<string, any> | undefined;
  return profile?.workspace || localStorage.getItem('agentai.workspace') || '';
}

/**
 * 切换工作区 — 与原 WorkspaceSelector.applyWorkspace 逻辑逐字等价。
 * @param path       目标工作区绝对路径
 * @param opts.syncGateway false 时不 POST /v1/workspace (仅本地切换)
 * @returns 是否真的发生了切换 (目标与当前相同则返回 false)
 */
export function switchWorkspace(path: string, opts: { syncGateway?: boolean } = {}): boolean {
  const trimmed = (path || '').trim();
  if (!trimmed) return false;
  if (trimmed === getCurrentWorkspace()) return false;

  // 1) localStorage (供 Git 服务与旧组件读取)
  localStorage.setItem('agentai.workspace', trimmed);

  // 2) profileStore (现代组件的第一真相源)
  const { profile, setProfile } = useProfileStore.getState() as any;
  if (setProfile) {
    setProfile({
      ...profile,
      name: profile?.name || 'User',
      onboardedAt: profile?.onboardedAt || Date.now(),
      language: profile?.language || 'zh',
      workspace: trimmed,
    });
  }

  // 3) 广播事件 (WorkspaceSelector / ChatView / LastSessionHint 等订阅刷新)
  window.dispatchEvent(new CustomEvent('agentai:workspace-changed', { detail: { workspace: trimmed } }));

  // 4) 同步 Gateway 工作目录 (原逻辑静默失败, 不阻塞本地切换)
  if (opts.syncGateway !== false) {
    const gw = (window as any).__AGENTAI_GATEWAY__ || 'http://127.0.0.1:18789';
    fetch(`${gw}/v1/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: trimmed }),
    }).catch(() => { /* Gateway 不可达时静默失败 (本地已保存) */ });
  }

  // 5) 批次8: 自动进"工作区清单" (去重 + 记最近使用) — 任何入口切换都会登记
  try {
    const reg = useWorkspaceRegistry.getState();
    reg.upsert(trimmed);
    reg.setActive(trimmed);
  } catch { /* registry 不可用时不阻塞切换 */ }

  return true;
}

/** 工作区显示名 — 取路径末段 (F:/a/b → b); 空则返回占位符 */
export function workspaceLabel(path: string | undefined, fallback = '未分类'): string {
  const p = (path || '').trim().replace(/[\\/]+$/, '');
  if (!p) return fallback;
  const seg = p.split(/[\\/]/).filter(Boolean);
  return seg[seg.length - 1] || p;
}