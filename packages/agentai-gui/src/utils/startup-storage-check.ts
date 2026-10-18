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

const SESSION_KEY = 'agentai-sessions';
const SESSION_BUDGET = 1_400_000;

let result: { before: number; after: number; actions: string[] } = { before: 0, after: 0, actions: [] };

try {
  // 每个 key 用独立的裁剪器实例 —— 粘性 level 不应与运行期 store 的那个互相影响
  const startupPruner = createSessionPruner(SESSION_BUDGET);
  result = ensureLocalStorageHealthy({
    thresholdChars: 2_200_000,
    targets: [
      { key: SESSION_KEY, budgetChars: SESSION_BUDGET, pruner: startupPruner.pruner },
    ],
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
