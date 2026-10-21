/**
 * 复审: IndexedDB(异步存储) 是否破坏了 2026-10-21 的「首屏恢复」P0 修复
 * ======================================================================
 * 背景: 首屏恢复 (useSessionAutoSave) 依赖 sessionStore 在**模块加载期就完成水合**。
 *   旧后端 quotaSafeSessionStorage = localStorage = **同步** → 首帧 activeId 已有值。
 *   新后端 indexedDbStorage = IndexedDB = **异步** → 水合推迟到 IDB 回调 → 首帧 activeId 为 null。
 *
 * 本文件用两个 effect 的**逐行等价实现**复现真实时序, 对比修复前/后的差异。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = readFileSync(path.resolve(__dirname, 'hooks/useSessionAutoSave.ts'), 'utf-8');
const STARTUP = readFileSync(path.resolve(__dirname, 'utils/startup-storage-check.ts'), 'utf-8');
const { create } = require('zustand') as typeof import('zustand');
const { persist, createJSONStorage } = require('zustand/middleware') as typeof import('zustand/middleware');

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

function syncStorage(seed: Record<string, string>) {
  const mem = { ...seed };
  return { getItem: (n: string) => mem[n] ?? null, setItem: (n: string, v: string) => { mem[n] = v; }, removeItem: (n: string) => { delete mem[n]; } };
}
function asyncStorage(seed: Record<string, string>) {
  const mem = { ...seed };
  return {
    getItem: (n: string) => new Promise<string | null>((r) => setTimeout(() => r(mem[n] ?? null), 5)),
    setItem: (n: string, v: string) => { mem[n] = v; return Promise.resolve(); },
    removeItem: (n: string) => { delete mem[n]; return Promise.resolve(); },
  };
}
function makeStore(storage: any) {
  return create<any>()(
    persist(() => ({ sessions: [] as any[], activeId: null as any, currentUserId: 'default' }),
      { name: 'agentai-sessions', storage: createJSONStorage(() => storage) }),
  );
}

/**
 * 两个 effect 的时序模拟。
 * @param gated 是否启用「等水合」闸门 + prevActiveId 同步 (修复后的行为)
 */
function runTimeline(gated: boolean) {
  const sessionMsgs = ['m1'];
  const chatStore = ['m2'];          // chatStore 里有一条尚未落盘的新消息
  let sessions: any[] = [];
  let activeId: string | null = null;
  let didHydrate = false;
  let prevActiveId: string | null = null;
  let displayed: string[] = [];

  const effect1 = () => {
    if (gated && activeId === null && sessions.length === 0) return; // 等水合闸门
    if (didHydrate) return;
    if (!activeId) { didHydrate = true; return; }
    didHydrate = true;
    const s = sessions.find((x) => x.id === activeId);
    if (!s) return;
    const byId = new Map<string, string>(s.messages.map((m: any) => [m.id, m.id]));
    for (const m of chatStore) if (!byId.has(m)) byId.set(m, m);
    displayed = [...byId.keys()];
    if (gated) prevActiveId = activeId;   // ★ 修复: 同步游标, 防 effect2 冲掉
  };
  const effect2 = () => {
    if (!activeId || prevActiveId === activeId) return;
    prevActiveId = activeId;
    const s = sessions.find((x) => x.id === activeId);
    displayed = s ? s.messages.map((m: any) => m.id) : [];   // clearMessages + 替换
  };

  // 第 1 帧: IndexedDB 还没回来
  effect1(); effect2();
  // 水合完成
  sessions = SEED.state.sessions as any[];
  activeId = SEED.state.activeId as string;
  effect1(); effect2();

  return displayed;
}

describe('复审 A: 同步 vs 异步存储的水合时机', () => {
  it('旧 localStorage(同步): 首帧 activeId 已有值', () => {
    const store = makeStore(syncStorage({ 'agentai-sessions': JSON.stringify(SEED) }));
    expect(store.getState().activeId).toBe('sess-1');
  });

  it('新 IndexedDB(异步): 首帧 activeId 仍为 null (这正是回归的触发条件)', () => {
    const store = makeStore(asyncStorage({ 'agentai-sessions': JSON.stringify(SEED) }));
    expect(store.getState().activeId).toBeNull();
  });
});

describe('复审 B: 首屏恢复在异步水合下的两种结局', () => {
  it('修复前: 退化为「替换」, chatStore 未落盘消息被 clearMessages 冲掉', () => {
    const displayed = runTimeline(false);
    expect(displayed).toEqual(['m1']);      // ← m2 丢了
  });

  it('修复后: 保持「合并」, session 基线 + chatStore 新消息都在', () => {
    const displayed = runTimeline(true);
    expect(displayed.sort()).toEqual(['m1', 'm2']);
  });
});

describe('复审 C: 源码契约锁死 (防回退)', () => {
  it('首屏恢复 effect 已加「等水合」闸门', () => {
    expect(HOOK).toContain('if (!storeHydrated) return;');
    expect(HOOK).toContain('onFinishHydration');
    expect(HOOK).toContain('hasHydrated');
  });

  it('首屏恢复后同步 prevActiveId, 防「切换会话」effect 用替换冲掉合并结果', () => {
    expect(HOOK).toContain('prevActiveIdRef.current = activeId;');
  });
});

describe('复审 D: 启动体检与异步水合相容', () => {
  it('IndexedDB 可用时不再裁剪 localStorage 里的旧会话(否则先砍后迁, 白丢数据)', () => {
    expect(STARTUP).toContain('isIndexedDbAvailable');
    expect(STARTUP).toMatch(/targets:\s*migrateToIdb\s*\?\s*\[\]/);
  });

  it('启动会话清理等 onFinishHydration, 不再因读到空数组而静默失效', () => {
    expect(STARTUP).toContain('onFinishHydration');
    expect(STARTUP).toContain('hasHydrated');
  });
});