/**
 * useStoreHydrated — 等待 zustand persist 水合完成的单一真源
 * ============================================================
 * 2026-10-22 (IndexedDB 迁移复审): 会话存储后端从 localStorage(**同步**) 换成
 *   IndexedDB(**异步**) 后, "模块加载期 state 就已填好" 这个前提被打破。
 *   任何在挂载期**读** state 或 **写** store 的代码都会踩两个坑:
 *
 *   ① 读: `if (!activeId) return` 之类守卫会把「还没水合」误判成「没有数据」;
 *   ② 写: 水合完成前的任何 set 都会把**初始空态**写回存储, 而水合随后又把这份
 *      空态读回来 → 存量会话被彻底抹掉(不是"回滚", 是"写没再读回空")。
 *
 * 所以: 依赖持久化数据的读/写, 一律先等本 hook 返回 true。
 * 兜底: onFinishHydration 永不回调时 3s 放行, 绝不让界面永久卡在骨架屏。
 */
import { useEffect, useState } from 'react';

/**
 * 等待 zustand store 的 persist 水合完成。
 * @param store zustand store (需带 persist 中间件)
 * @param timeoutMs 兜底放行时间, 默认 3s
 */
export function useStoreHydrated(store: unknown, timeoutMs = 3000): boolean {
  const persistApi = (store as { persist?: unknown } | null)?.persist as
    | { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => (() => void) | void }
    | undefined;

  const [hydrated, setHydrated] = useState<boolean>(
    () => (typeof persistApi?.hasHydrated === 'function' ? persistApi.hasHydrated() : true),
  );

  useEffect(() => {
    const p = (store as { persist?: unknown } | null)?.persist as
      | { hasHydrated?: () => boolean; onFinishHydration?: (cb: () => void) => (() => void) | void }
      | undefined;
    if (!p) return;
    if (typeof p.hasHydrated === 'function' && p.hasHydrated()) {
      setHydrated(true);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setHydrated(true);
    };
    const unsub = p.onFinishHydration?.(finish);
    // 兜底: onFinishHydration 永不回调(如存储被禁用)时也要放行, 不能把界面永久卡住
    const timer = setTimeout(() => {
      try { unsub?.(); } catch { /* ignore */ }
      finish();
    }, timeoutMs);
    return () => {
      clearTimeout(timer);
      try { unsub?.(); } catch { /* ignore */ }
    };
  }, [store, timeoutMs]);

  return hydrated;
}