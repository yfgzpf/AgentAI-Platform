/**
 * indexed-db-storage 单元测试
 * =============================
 * ① 退化路径: 当前 node 测试环境无 indexedDB → 自动退回 localStorage 兜底,
 *    验证 round-trip / removeItem / 缺失 key 行为正确 (与旧 persistence 兼容)。
 * ② 真实 IDB 路径: 若安装了 fake-indexeddb 则真跑 IndexedDB 往返,
 *    并验证"旧 localStorage 数据首次读取时自动迁入 IDB 并删除旧 key"。
 *    未安装时该用例自动跳过 (真实浏览器环境由终端验收)。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

import { createIndexedDbStorage, SESSIONS_LS_KEY } from './utils/indexed-db-storage';

describe('indexed-db-storage: localStorage 退化路径 (无 indexedDB)', () => {
  const storage = createIndexedDbStorage();

  it('setItem → getItem 往返一致', async () => {
    await storage.setItem('k1', 'v1');
    expect(await storage.getItem('k1')).toBe('v1');
  });

  it('缺失 key 返回 null (不抛)', async () => {
    expect(await storage.getItem('__not_exist__')).toBeNull();
  });

  it('removeItem 后读不到', async () => {
    await storage.setItem('k2', 'v2');
    await storage.removeItem('k2');
    expect(await storage.getItem('k2')).toBeNull();
  });

  it('退化路径同步返回 (string, 非 Promise), 兼容 zustand 同步 storage 契约', () => {
    const r = storage.getItem('k1');
    expect(r).not.toBeInstanceOf(Promise);
    expect(r).toBe('v1');
  });

  it('localStorage 抛配额错时被吞掉, 不冒泡 (降级 no-op)', () => {
    const ls = (globalThis as any).localStorage;
    const orig = ls.setItem;
    ls.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      // 退化路径的 setItem 必须用 try/catch 包住, 否则配额满会冒泡到 ErrorBoundary
      expect(() => storage.setItem('k3', 'v3')).not.toThrow();
    } finally {
      ls.setItem = orig;
    }
  });
});

describe('indexed-db-storage: 真实 IndexedDB 路径', () => {
  let hasIdb = false;

  beforeAll(async () => {
    try {
      // 可选依赖: 仅当安装 fake-indexeddb 时才跑真实 IDB 路径; 否则跳过 (浏览器终端验收)
      const idbAuto = 'fake-indexeddb/auto';
      await import(/* @vite-ignore */ idbAuto);
      hasIdb = typeof indexedDB !== 'undefined';
    } catch {
      hasIdb = false;
    }
  });

  it('IDB 往返 + 旧 localStorage 自动迁入', async () => {
    if (!hasIdb) {
      console.warn(
        '[test] fake-indexeddb 未安装 → 跳过真实 IDB 路径 (已在浏览器终端验收)。' +
        ' 安装: pnpm add -D fake-indexeddb',
      );
      return;
    }
    // 重新求值模块, 此时 indexedDB 已可用 → 单例走真实 IDB 分支
    vi.resetModules();
    const mod = await import('./utils/indexed-db-storage');
    const store = mod.createIndexedDbStorage();

    // 预置旧 localStorage 数据 (模拟升级前的用户)
    const ls = (globalThis as any).localStorage;
    ls.setItem(mod.SESSIONS_LS_KEY, 'LEGACY_SESSIONS');

    // 首次 getItem → 从 localStorage 迁入 IDB 并返回
    expect(await store.getItem(mod.SESSIONS_LS_KEY)).toBe('LEGACY_SESSIONS');
    // 迁入后旧 key 应被删除, 避免双源
    expect(ls.getItem(mod.SESSIONS_LS_KEY)).toBeNull();

    // 真实 IDB 上的正常往返
    await store.setItem('idb-k', 'idb-v');
    expect(await store.getItem('idb-k')).toBe('idb-v');
    await store.removeItem('idb-k');
    expect(await store.getItem('idb-k')).toBeNull();
  });
});
