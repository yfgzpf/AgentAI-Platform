/**
 * 复审 E: 水合完成前的 set 是否会覆盖真实数据 (铁律 ② 写覆盖)
 * ======================================================================
 * App.tsx 的启动 effect `useEffect(() => setCurrentUserId(profile.name), [profile?.name])`
 * 是**挂载即跑**的。若它早于 IndexedDB 水合完成, zustand persist 会把
 * `{ sessions: [], activeId: null, currentUserId: 'x' }` 写回存储
 * → 真实会话被空态覆盖, 且不可恢复。
 *
 * 同步 localStorage 时代: 水合在模块加载期完成 → set 发生在水合之后 → 安全。
 * 异步 IndexedDB 时代: 水合推迟 → set 可能抢在水合之前 → 危险。
 */
import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const SEED = {
  state: {
    sessions: [
      { id: 'sess-1', title: 'T', messages: [{ id: 'm1', role: 'user', content: 'hi', ts: 1 }], createdAt: 1, updatedAt: 1, userId: 'default' },
    ],
    activeId: 'sess-1',
    currentUserId: 'default',
  },
  version: 0,
};

function makeAsyncStore() {
  const mem: Record<string, string> = { 'k': JSON.stringify(SEED) };
  const storage = {
    getItem: (n: string) => new Promise<string | null>((r) => setTimeout(() => r(mem[n] ?? null), 5)),
    setItem: (n: string, v: string) => { mem[n] = v; return Promise.resolve(); },
    removeItem: (n: string) => { delete mem[n]; return Promise.resolve(); },
  };
  const store = create<any>()(
    persist(() => ({ sessions: [] as any[], activeId: null as any, currentUserId: 'default' }),
      { name: 'k', storage: createJSONStorage(() => storage) }),
  );
  return { store, mem };
}

describe('复审 E: 水合前的写入会不会覆盖真实数据', () => {
  it('危险时序: 挂载 effect 先 set → 空态被写回存储', async () => {
    const { store, mem } = makeAsyncStore();

    // 首帧: 水合未完成, 模拟 App.tsx 启动 effect 抢先执行
    expect(store.getState().sessions).toEqual([]);
    store.getState().setCurrentUserId?.('alice') ?? store.setState({ currentUserId: 'alice' });

    // 被写下去的内容此刻就是空态
    const writtenEarly = JSON.parse(mem['k']).state;
    expect(writtenEarly.sessions).toEqual([]);   // ★ 空态已落盘

    // 等水合完成后, 存储里剩的是什么
    await new Promise((r) => setTimeout(r, 30));
    const after = JSON.parse(mem['k']).state;
    expect(after.sessions).toEqual([]);          // ★ 真实会话 sess-1 被覆盖没了
    expect(after.currentUserId).toBe('alice');
  });

  it('安全时序: 先等水合再 set → 真实数据保住', async () => {
    const { store, mem } = makeAsyncStore();
    await new Promise((r) => setTimeout(r, 30));            // 等水合
    expect(store.getState().sessions.length).toBe(1);       // 真实数据已回填
    store.setState({ currentUserId: 'alice' });
    const after = JSON.parse(mem['k']).state;
    expect(after.sessions.length).toBe(1);                  // ★ 没被覆盖
    expect(after.sessions[0].id).toBe('sess-1');
  });
});

describe('复审 F: 挂载期写入的真实后果 (比"回滚"更严重)', () => {
  it('App.tsx 启动 effect 抢在水合前写 → 存量会话被写空, 水合再把空态读回来 = 会话全没了', async () => {
    const mem: Record<string, string> = { 'k': JSON.stringify(SEED) }; // 存量 1 个会话
    const storage = {
      getItem: (n: string) => new Promise<string | null>((r) => setTimeout(() => r(mem[n] ?? null), 5)),
      setItem: (n: string, v: string) => { mem[n] = v; return Promise.resolve(); },
      removeItem: (n: string) => { delete mem[n]; return Promise.resolve(); },
    };
    const store = create<any>()(
      persist(() => ({ sessions: [] as any[], activeId: null as any, currentUserId: 'default' }),
        { name: 'k', storage: createJSONStorage(() => storage) }),
    );

    // 模拟 App.tsx:602 启动 effect —— 挂载即写 profile.name (水合尚未完成)
    store.setState({ currentUserId: 'alice' });

    // 水合完成。注意: getItem 在 5ms 后才读, 而那时 mem 已被上面的写覆盖成空态
    await new Promise((r) => setTimeout(r, 30));

    // ★ 存量会话彻底消失 (不是回滚, 是被写没再读回空态)
    expect(store.getState().sessions).toEqual([]);
    expect(JSON.parse(mem['k']).state.sessions).toEqual([]);
    // currentUserId 反倒保住了 alice —— 恰恰因为它是空态里唯一非空字段
    expect(store.getState().currentUserId).toBe('alice');
  });
});