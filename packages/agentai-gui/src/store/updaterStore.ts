/**
 * updaterStore — 关闭时自动安装的状态管理 (Trae 风格)
 * --------------------------------------------------------
 * 状态机:
 *   idle         — 无更新 (默认)
 *   checking     — 后台检查中 (启动 8s 后)
 *   downloading  — 后台静默下载中 (Rust 端进行)
 *   ready        — 已下载就绪 (关闭应用时弹 Modal 确认安装)
 *   installing   — 正在执行安装 + 重启 (短瞬态)
 *   error        — 失败 (显示错误文案)
 *
 * 事件总线:
 *   Rust emit  `updater://progress`  →  setStage()
 *   Rust IPC   updater_get_pending   → 启动/挂载时拉取
 *
 * 注意:
 *   - Web 端 (非 Tauri) 全部 no-op，不会抛错 (动态 import @tauri-apps)
 *   - 所有图标只用白名单: SyncOutlined / DownloadOutlined / InfoCircleOutlined / ReloadOutlined
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type UpdaterStage =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

export interface PendingUpdateMeta {
  version: string;
  bytes: number;
  date: string;
  body?: string;
  downloaded: boolean;
  progress: number; // 0..100
}

export interface UpdaterState {
  stage: UpdaterStage;
  /** 当前正在下载/已就绪的更新元信息 */
  pending: PendingUpdateMeta | null;
  /** 上次错误信息 (stage=error 时展示) */
  error: string;
  /** 用户设置: true 时关闭应用自动安装 (默认询问) */
  autoInstallOnClose: boolean;

  /* ── Action ── */
  setStage: (s: UpdaterStage, info?: Partial<PendingUpdateMeta>) => void;
  setError: (e: string) => void;
  clearPending: () => void;
  setAutoInstallOnClose: (v: boolean) => void;
  /** 启动时从 Rust 拉一次已下载状态 (例如上次下载了但用户选了仅关闭) */
  initFromRust: () => Promise<void>;
}

/** @tauri-apps 全部懒加载：避免 Web build / 非桌面端报错 */
const isTauri = (): boolean =>
  typeof window !== 'undefined' &&
  (!!(window as any).__TAURI_INTERNALS__ ||
    !!(window as any).__TAURI__ ||
    window.location.protocol === 'tauri:');

async function tauriInvoke<T = any>(cmd: string, args?: any): Promise<T> {
  const m = await import('@tauri-apps/api/core');
  return (m.invoke as any)(cmd, args) as T;
}

export const useUpdaterStore = create<UpdaterState>()(
  persist(
    (set, get) => ({
      stage: 'idle',
      pending: null,
      error: '',
      autoInstallOnClose: false,

      setStage: (s, info) => {
        set((prev) => {
          const merge: Partial<UpdaterState> = { stage: s };
          if (info) {
            const next = { ...(prev.pending || ({} as PendingUpdateMeta)), ...info };
            merge.pending = next.version ? (next as PendingUpdateMeta) : prev.pending;
          }
          if (s === 'idle' || s === 'checking') merge.error = '';
          return merge;
        });
      },

      setError: (e) => set({ stage: 'error', error: e }),
      clearPending: () => set({ stage: 'idle', pending: null, error: '' }),
      setAutoInstallOnClose: (v) => set({ autoInstallOnClose: v }),

      initFromRust: async () => {
        if (!isTauri()) return;
        try {
          const p = await tauriInvoke<PendingUpdateMeta | null>('updater_get_pending');
          if (p?.downloaded) {
            set({ stage: 'ready', pending: p });
          }
        } catch (e) {
          // 非桌面端 / Rust 旧版本无此命令 → 静默忽略
        }
      },
    }),
    {
      name: 'agentai-updater',
      version: 1,
      // 只持久化用户偏好设置；pending 每次启动从 Rust 真实拉，不存本地
      partialize: (s) => ({ autoInstallOnClose: s.autoInstallOnClose }),
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/* ──────────────────────────────────────────────
 * 全局一次性初始化 (App.tsx useEffect 里调用)
 *   · 启动时调 initFromRust
 *   · 订阅 Rust emit `updater://progress`
 * ────────────────────────────────────────────── */
let __listenerAttached = false;
export function mountUpdaterEventBus(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (__listenerAttached) return () => {};
  __listenerAttached = true;

  let unlisten: (() => void) | null = null;
  const detached = { current: false };

  (async () => {
    if (!isTauri()) return;
    try {
      // 先拉一次 Rust 内存缓存 (上次下载了但用户选仅关闭)
      await useUpdaterStore.getState().initFromRust();
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<any>('updater://progress', (event) => {
        if (detached.current) return;
        const p = event.payload || {};
        const stage = (p.stage || 'idle') as UpdaterStage;
        const meta: Partial<PendingUpdateMeta> = {};
        if (p.version) meta.version = p.version;
        if (typeof p.bytes === 'number') meta.bytes = p.bytes;
        if (typeof p.percent === 'number') meta.progress = Math.max(0, Math.min(100, p.percent));
        meta.downloaded = stage === 'ready' || (meta.progress ?? 0) >= 100;
        if (stage === 'error' && typeof p.error === 'string') {
          useUpdaterStore.getState().setError(p.error);
        } else {
          useUpdaterStore.getState().setStage(stage, meta);
        }
      });
    } catch (e) {
      // Web 端没装 @tauri-apps / 开发模式 Vite 下找不到模块 → 静默
      console.debug('[updater] 初始化跳过 (非桌面端):', e);
    }
  })();

  return () => {
    detached.current = true;
    if (unlisten) { try { unlisten(); } catch {} unlisten = null; }
    __listenerAttached = false;
  };
}
