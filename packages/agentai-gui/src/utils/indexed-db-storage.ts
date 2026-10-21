/**
 * indexed-db-storage — zustand persist 的 IndexedDB 后端
 * ============================================================
 * 2026-10-22 (续跑修复 ①): 单会话 300 条硬上限的元凶是 localStorage 的 5MB 配额 ——
 *   会话消息一旦进 localStorage, 就只能靠 `capSessionMessages` 截短来"塞得下",
 *   结果"任务原始要求"(会话最开头那条) 在正常长任务里就被 slice 掉了, 且**不可恢复**。
 *
 * 根治: 把 `agentai-sessions` 整库迁到 IndexedDB。IndexedDB 容量是 GB 级
 *   (浏览器按源分配数十 MB ~ 数 GB, 远超 localStorage 的 5MB), 不再有任何理由截短消息,
 *   300 条硬上限因此可以取消 (capSessionMessages 退化为极端情况下的安全网)。
 *
 * 契约: 实现 zustand persist 的 `StateStorage` 异步接口
 *   (getItem/setItem/removeItem 均可返回 Promise)。
 *
 * 健壮性:
 *   - `indexedDB` 不可用时 (SSR / Node 测试 / 隐私模式 / 老浏览器) → 退回 localStorage 兜底;
 *   - 首次启动若 localStorage 里还有旧 `agentai-sessions`, 自动一次性迁入 IndexedDB, 并删除旧 key;
 *   - 任何异常都**不抛**, 写失败退回 localStorage, 绝不阻塞 UI。
 */

import type { StateStorage } from 'zustand/middleware';
import { getLS } from './quota-safe-storage';

const DB_NAME = 'agentai-sessions-db';
const STORE_NAME = 'kv';
const DB_VERSION = 1;

/** localStorage 里旧 key 名 (与 sessionStore persist 的 name 保持一致) */
export const SESSIONS_LS_KEY = 'agentai-sessions';

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
  // 任何失败都清空缓存, 下次再试 (避免一次性失败永久锁死)
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function idbGet(name: string): Promise<string | null> {
  return openDB().then(
    (db) =>
      new Promise<string | null>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).get(name);
          req.onsuccess = () => resolve((req.result as string) ?? null);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

function idbSet(name: string, value: string): Promise<boolean> {
  return openDB().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(value, name);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      }),
  );
}

function idbDel(name: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(name);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

/**
 * 构造 IndexedDB 后端。
 * 当运行环境无 `indexedDB` 时, 直接返回 localStorage 实现, 行为与旧 persistence 一致。
 */
export function createIndexedDbStorage(): StateStorage {
  if (!idbAvailable()) {
    const ls = getLS();
    return {
      getItem: (name) => ls?.getItem(name) ?? null,
      setItem: (name, value) => {
        try {
          ls?.setItem(name, value);
        } catch {
          /* 配额满/隐私模式: 降级为内存态, 不抛 */
        }
      },
      removeItem: (name) => {
        try {
          ls?.removeItem(name);
        } catch {
          /* ignore */
        }
      },
    };
  }

  return {
    getItem: async (name) => {
      const fromIdb = await idbGet(name);
      if (fromIdb != null) return fromIdb;
      // 首次启动: localStorage 里可能还残留旧数据, 一次性迁入 IDB 再删旧 key
      const ls = getLS();
      const legacy = ls?.getItem(name) ?? null;
      if (legacy != null) {
        void idbSet(name, legacy); // 异步迁入, 不阻塞读取
        try {
          ls?.removeItem(name);
        } catch {
          /* ignore */
        }
      }
      return legacy;
    },
    setItem: async (name, value) => {
      const ok = await idbSet(name, value);
      if (!ok) {
        // IDB 写失败 → 退回 localStorage 兜底, 绝不丢数据
        try {
          getLS()?.setItem(name, value);
        } catch {
          /* ignore */
        }
      }
    },
    removeItem: async (name) => {
      await idbDel(name);
      try {
        getLS()?.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

/** 单例: 整个应用共用一个 IndexedDB 连接 */
export const indexedDbStorage = createIndexedDbStorage();
