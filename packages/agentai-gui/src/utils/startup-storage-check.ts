/**
 * startup-storage-check — 启动时的 localStorage 体检与自愈
 * ============================================================
 * 必须在**所有 store 模块求值之前**执行 (main.tsx 里放在 `import { App }` 之前),
 * 否则 store 已经拿着"满仓"数据完成了 rehydrate, 体检就晚了一步。
 *
 * 事故背景 (2026-10-18): `agentai-sessions` 写爆配额 →
 *   `Failed to execute 'setItem' on 'Storage': ... exceeded the quota` →
 *   ErrorBoundary 接管整页 → "页面加载中断"。
 */
import {
  ensureLocalStorageHealthy,
  createSessionPruner,
  getLS,
  storageUsage,
} from './quota-safe-storage';
import { isIndexedDbAvailable } from './indexed-db-storage';

const SESSION_KEY = 'agentai-sessions';
const SESSION_BUDGET = 1_400_000;

let result: { before: number; after: number; actions: string[] } = { before: 0, after: 0, actions: [] };

try {
  // 每个 key 用独立的裁剪器实例 —— 粘性 level 不应与运行期 store 的那个互相影响
  const startupPruner = createSessionPruner(SESSION_BUDGET);
  // ★ 2026-10-22 复审: 会话存储已迁 IndexedDB, localStorage 里的 `agentai-sessions`
  //   只是**尚未迁移的旧数据**, store 水合时会原样搬进 GB 级存储。
  //   此时若还按老规矩裁剪, 等于"先把能全存下的数据砍掉, 再迁到 spacious 存储" ——
  //   纯亏。所以 IndexedDB 可用时不再裁剪这个 key;
  //   只有 IndexedDB 不可用(退化回 localStorage)时, 才需要沿用旧裁剪策略兜住配额。
  const migrateToIdb = isIndexedDbAvailable();
  result = ensureLocalStorageHealthy({
    thresholdChars: 2_200_000,
    targets: migrateToIdb
      ? []
      : [{ key: SESSION_KEY, budgetChars: SESSION_BUDGET, pruner: startupPruner.pruner }],
  });
} catch (e) {
  // 体检本身绝不能阻塞启动
  console.warn('[startup-storage-check] 体检失败(已忽略):', e);
}

/** 供设置页/诊断面板读取 */
export const startupStorageReport = {
  ...result,
  usage: (() => {
    try { return getLS() ? storageUsage() : { usedChars: 0, items: [] }; } catch { return { usedChars: 0, items: [] }; }
  })(),
};

// ═══ 2026-10-19: 会话数量体检 (恢复"自动清理对话") ═══
// 富哥实锤: "以前项目有自动清理, 现在没有了, 对话保留太多"。
// 真相: `cleanupSessionsList` 纯函数写得好好的 (每工作区 30 条 / 14 天 / 全局 200),
//   `cleanupOldSessions` action 也在 store 里实现了 —— 但**全项目零调用方**。
//   它只在 `createSession` 里被间接用到, 于是"不新建会话就永远不裁"。
// 修法: 启动时跑一次 (与本文件同一时机), 让裁剪结果随 persist 落盘。
// 用动态 import + 微任务: 不能在这里同步 import store —— 本模块必须早于 store 求值。
const SESSION_SOFT_CAP = 50; // 超过这个数就按 updatedAt 从最旧开始删 (当前会话受保护)

if (typeof window !== 'undefined' && !sessionStorage.getItem('agentai:session-cleanup-ran')) {
  sessionStorage.setItem('agentai:session-cleanup-ran', '1');
  // setTimeout(0) = 等本模块求值完、store 都加载完之后, 再动 store
  setTimeout(async () => {
    try {
      const store: any = await import('../store/sessionStore');
      const useStore = store.useSessionStore;
      if (!useStore?.getState) return;
      // ★ 2026-10-22 复审: 存储后端是 IndexedDB 时**水合是异步的**, setTimeout(0) 很可能
      //   早于水合完成 —— 此时 getState().sessions 还是空数组, 下面 `length <= 50` 直接 return,
      //   清理会**静默失效**(富哥"对话保留太多"的回归)。必须等 onFinishHydration。
      const p = useStore.persist;
      if (p && typeof p.hasHydrated === 'function' && !p.hasHydrated()) {
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => { if (!done) { done = true; resolve(); } };
          const unsub = p.onFinishHydration?.(finish);
          // 兜底: 2s 后无论如何继续, 免得回调不触发导致清理永久丢失
          setTimeout(() => { try { unsub?.(); } catch { /* ignore */ } finish(); }, 2000);
        });
      }
      const sessions = (useStore.getState().sessions || []) as any[];
      if (sessions.length <= SESSION_SOFT_CAP) return; // 没超上限就不动, 不打扰用户
      const activeId = useStore.getState().activeId;
      // 按最近使用排序, 保留前 N 条; 当前正在看的会话若被挤掉, 强制留在里面
      const sorted = [...sessions].sort((a: any, b: any) => b.updatedAt - a.updatedAt);
      const kept = sorted.slice(0, SESSION_SOFT_CAP);
      if (activeId && !kept.some((s: any) => s.id === activeId)) {
        const idx = sorted.findIndex((s: any) => s.id === activeId);
        if (idx >= SESSION_SOFT_CAP) kept[SESSION_SOFT_CAP - 1] = sorted[idx];
      }
      const before = sessions.length;
      if (kept.length >= before) return;
      useStore.setState({ sessions: kept });
      console.info(`[startup] 会话清理: ${before} → ${kept.length} 条 (全局上限 ${SESSION_SOFT_CAP}, 最旧的先删, 当前会话已保护)`);
    } catch (e) {
      console.warn('[startup-storage-check] 会话清理跳过:', e);
    }
  }, 0);
}
