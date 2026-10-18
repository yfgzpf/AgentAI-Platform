/**
 * quota-safe-storage 测试
 * ============================================================
 * 锁定的实机事故 (2026-10-18):
 *   `Failed to execute 'setItem' on 'Storage': Setting the value of
 *    'agentai-sessions' exceeded the quota.` → ErrorBoundary 吞掉整页
 *
 * 这里要保证的契约:
 *   ① **任何情况都不抛异常** (这是"页面加载中断"的直接死因);
 *   ② 超预算时先瘦身再写, 且瘦身顺序**不伤当前会话**;
 *   ③ 配额真满时先丢可牺牲的临时键;
 *   ④ 损坏的 JSON 不阻塞启动。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isQuotaError,
  capText,
  createQuotaSafeStorage,
  createSessionPruner,
  createTieredPruner,
  safeSetItem,
  rescueSpace,
  storageUsage,
  ensureLocalStorageHealthy,
  TRANSIENT_KEYS,
  TRIM_SUFFIX,
} from './quota-safe-storage';

/** 造一个"按总字符数算配额"的假 localStorage */
function makeFakeLS(limitChars: number) {
  const map = new Map<string, string>();
  const total = (except?: string) => {
    let n = 0;
    for (const [k, v] of map) if (k !== except) n += v.length;
    return n;
  };
  return {
    get length() { return map.size; },
    key(i: number) { return [...map.keys()][i] ?? null; },
    getItem(k: string) { return map.has(k) ? map.get(k)! : null; },
    setItem(k: string, v: string) {
      if (total(k) + String(v).length > limitChars) {
        const e = new Error(
          `Failed to execute 'setItem' on 'Storage': Setting the value of '${k}' exceeded the quota.`,
        );
        e.name = 'QuotaExceededError';
        (e as unknown as { code: number }).code = 22;
        throw e;
      }
      map.set(k, String(v));
    },
    removeItem(k: string) { map.delete(k); },
    clear() { map.clear(); },
    _map: map,
    _total: () => total(),
  };
}

const msg = (content: string) => ({ id: `m-${content.length}`, role: 'user', content, ts: 1 });
const sess = (id: string, nMsg: number, len: number, updatedAt: number) => ({
  id,
  title: id,
  messages: Array.from({ length: nMsg }, (_, i) => msg(`${id}-${i}:` + 'x'.repeat(len))),
  createdAt: updatedAt,
  updatedAt,
  userId: 'default',
  workspace: 'ws',
});

describe('isQuotaError', () => {
  it('识别浏览器各种配额异常形态', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 22 })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
    expect(isQuotaError(new Error('Setting the value of X exceeded the quota.'))).toBe(true);
  });

  it('普通错误不误判', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });
});

describe('capText', () => {
  it('未超长原样返回', () => {
    const r = capText('short', 100);
    expect(r.changed).toBe(false);
    expect(r.text).toBe('short');
  });

  it('超长时保留头尾并带精简标记', () => {
    const src = 'HEAD' + 'x'.repeat(5000) + 'TAIL';
    const r = capText(src, 1000);
    expect(r.changed).toBe(true);
    expect(r.text.length).toBeLessThan(src.length);
    expect(r.text.startsWith('HEAD')).toBe(true);
    expect(r.text.endsWith('TAIL')).toBe(true);
    expect(r.text).toContain('已省略');
  });

  it('非字符串安全返回', () => {
    expect(capText(undefined, 10)).toEqual({ text: '', changed: false });
    expect(capText(null, 10)).toEqual({ text: '', changed: false });
  });
});

describe('safeSetItem (组件里的裸写入)', () => {
  let ls: ReturnType<typeof makeFakeLS>;
  beforeEach(() => {
    ls = makeFakeLS(50_000);
    vi.stubGlobal('localStorage', ls);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('正常写入返回 true', () => {
    expect(safeSetItem('k', 'hello')).toBe(true);
    expect(ls.getItem('k')).toBe('hello');
  });

  it('超 maxChars 自动截断, 不会把配额一条吃光', () => {
    const ok = safeSetItem('draft', 'y'.repeat(5000), { maxChars: 1000 });
    expect(ok).toBe(true);
    const saved = ls.getItem('draft')!;
    expect(saved.length).toBeLessThan(1200);
    expect(saved).toContain('已省略');
  });

  it('配额满时先清临时键, 再写成功', () => {
    ls.setItem(TRANSIENT_KEYS[0], 'z'.repeat(49_000));       // 几乎占满
    const ok = safeSetItem('agentai-write-draft', 'a'.repeat(3000), { maxChars: 3000 });
    expect(ok).toBe(true);
    expect(ls.getItem(TRANSIENT_KEYS[0])).toBeNull();        // 临时键被牺牲
    expect(ls.getItem('agentai-write-draft')).toContain('a');
  });

  it('彻底写不进时返回 false 而不是抛异常', () => {
    ls.setItem('other', 'q'.repeat(49_990));
    expect(() => safeSetItem('k2', 'b'.repeat(5000), { maxChars: 5000 })).not.toThrow();
    expect(safeSetItem('k2', 'b'.repeat(5000), { maxChars: 5000 })).toBe(false);
  });
});

describe('createQuotaSafeStorage (zustand persist 用)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('纯文本超配额也不抛异常 (事故现场)', () => {
    vi.stubGlobal('localStorage', makeFakeLS(1000));
    const store = createQuotaSafeStorage({ label: 't', budgetChars: 100 });
    expect(() => store.setItem('agentai-sessions', 'x'.repeat(99_999))).not.toThrow();
  });

  it('有 pruner 时: 写进去的是裁剪后的版本', () => {
    vi.stubGlobal('localStorage', makeFakeLS(20_000));
    const pruner = createTieredPruner([
      (st) => { st.items = st.items.map((s: string) => s.slice(0, 10)); return true; },
    ], 5_000);
    const store = createQuotaSafeStorage({ label: 't2', budgetChars: 5_000, pruner: pruner.pruner });
    const payload = JSON.stringify({ state: { items: Array.from({ length: 50 }, () => 'y'.repeat(1000)) } });

    store.setItem('k', payload);
    const saved = localStorage.getItem('k')!;
    expect(saved.length).toBeLessThanOrEqual(5_000);
    expect(JSON.parse(saved).state.items[0].length).toBe(10);
  });

  it('损坏 JSON + 配额满 → 不抛异常', () => {
    vi.stubGlobal('localStorage', makeFakeLS(10));
    const pruner = createTieredPruner([() => true], 5);
    const store = createQuotaSafeStorage({ label: 't3', budgetChars: 5, pruner: pruner.pruner });
    expect(() => store.setItem('k', '{not-json')).not.toThrow();
  });

  it('localStorage 不可用 → no-op, 不崩', () => {
    vi.stubGlobal('localStorage', undefined);
    const store = createQuotaSafeStorage({ label: 't4' });
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBeNull();
    expect(() => store.removeItem('k')).not.toThrow();
  });

  it('getItem 抛异常 → 返回 null', () => {
    vi.stubGlobal('localStorage', {
      get length() { return 1; },
      key: () => 'k',
      getItem: () => { throw new Error('denied'); },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    const store = createQuotaSafeStorage({ label: 't5' });
    expect(store.getItem('k')).toBeNull();
  });
});

describe('createSessionPruner (会话分级瘦身)', () => {
  const buildPayload = () => JSON.stringify({
    state: {
      sessions: [
        sess('old-1', 10, 5000, 1),
        sess('old-2', 10, 5000, 2),
        sess('active', 10, 5000, 3),
      ],
      activeId: 'active',
      currentUserId: 'default',
    },
    version: 0,
  });

  it('能压到预算内', () => {
    const pruner = createSessionPruner(60_000);
    const out = pruner.pruner(buildPayload());
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(60_000);
  });

  it('优先牺牲非当前会话, 而不是用户正在看的这段', () => {
    const pruner = createSessionPruner(200_000);
    const out = pruner.pruner(buildPayload());
    expect(out).toBeTruthy();
    const st = JSON.parse(out!).state;
    const active = st.sessions.find((s: any) => s.id === 'active');
    const others = st.sessions.filter((s: any) => s.id !== 'active');
    const activeChars = JSON.stringify(active).length;
    const otherChars = Math.max(...others.map((s: any) => JSON.stringify(s).length));
    expect(activeChars).toBeGreaterThan(otherChars);
  });

  it('压到极限时当前会话仍然存在 (不会整段丢失)', () => {
    const pruner = createSessionPruner(2_000);
    const out = pruner.pruner(buildPayload());
    expect(out).toBeTruthy();
    const st = JSON.parse(out!).state;
    expect(st.sessions.length).toBeGreaterThan(0);
    expect(st.sessions.some((s: any) => s.id === 'active')).toBe(true);
    expect(st.activeId).toBe('active');
  });

  it('损坏 JSON 返回 null 而不是抛错', () => {
    const pruner = createSessionPruner(1000);
    expect(pruner.pruner('{broken')).toBeNull();
    expect(pruner.pruner('{}')).toBeNull();
  });

  it('粘性: level 会推进并可通过 reset 归零', () => {
    const pruner = createSessionPruner(60_000);
    pruner.pruner(buildPayload());
    expect(pruner.level).toBeGreaterThan(0);
    pruner.reset();
    expect(pruner.level).toBe(0);
  });
});

describe('rescueSpace / storageUsage', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('按可牺牲顺序清临时键, 不动 keep 中的键', () => {
    const ls = makeFakeLS(1_000_000);
    vi.stubGlobal('localStorage', ls);
    ls.setItem(TRANSIENT_KEYS[0], 'a'.repeat(100));
    ls.setItem(TRANSIENT_KEYS[1], 'b'.repeat(100));
    ls.setItem('agentai-sessions', 'c'.repeat(100));

    const freed = rescueSpace({ keep: ['agentai-sessions'] });
    expect(freed).toBe(200);
    expect(ls.getItem('agentai-sessions')).toBe('c'.repeat(100));
    expect(ls.getItem(TRANSIENT_KEYS[0])).toBeNull();
  });

  it('统计用量按大小排序', () => {
    const ls = makeFakeLS(1_000_000);
    vi.stubGlobal('localStorage', ls);
    ls.setItem('small', 'x');
    ls.setItem('big', 'y'.repeat(500));
    const u = storageUsage();
    expect(u.usedChars).toBe(501);
    expect(u.items[0].key).toBe('big');
  });

  it('localStorage 不可用时全部降级为 0 / 空', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(storageUsage()).toEqual({ usedChars: 0, items: [] });
    expect(rescueSpace()).toBe(0);
  });
});

describe('TRIM_SUFFIX', () => {
  it('标记里带省略字数, 便于排查', () => {
    expect(TRIM_SUFFIX(1234)).toContain('1234');
  });
});

describe('ensureLocalStorageHealthy (启动自愈)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('未超阈值时不动任何东西', () => {
    const ls = makeFakeLS(10_000_000);
    vi.stubGlobal('localStorage', ls);
    ls.setItem('agentai-sessions', 'x'.repeat(500));
    const r = ensureLocalStorageHealthy({ thresholdChars: 2_000_000 });
    expect(r.actions).toEqual([]);
    expect(ls.getItem('agentai-sessions')).toBe('x'.repeat(500));
  });

  it('已经撑爆时: 先清临时键, 再把会话压到预算内', () => {
    const ls = makeFakeLS(10_000_000);
    vi.stubGlobal('localStorage', ls);

    // 撑到 2.5M 字: sessions 2.4M + 临时键 100K
    const bigSessions = JSON.stringify({
      state: {
        sessions: [sess('a', 10, 200_000, 1), sess('b', 2, 1000, 2)],
        activeId: 'a',
        currentUserId: 'default',
      },
      version: 0,
    });
    const transient = TRANSIENT_KEYS[0];
    const room = 2_600_000;
    ls._map.set('agentai-sessions', bigSessions);
    ls._map.set(transient, 'z'.repeat(Math.max(0, room - bigSessions.length)));

    const pruner = createSessionPruner(200_000);
    const r = ensureLocalStorageHealthy({
      thresholdChars: 2_000_000,
      targets: [{ key: 'agentai-sessions', budgetChars: 200_000, pruner: pruner.pruner }],
    });

    expect(r.before).toBeGreaterThan(2_000_000);
    expect(r.after).toBeLessThan(r.before);
    expect(r.actions.length).toBeGreaterThan(0);
    expect(ls.getItem(transient)).toBeNull();                       // 临时键被清
    expect(ls.getItem('agentai-sessions')!.length).toBeLessThanOrEqual(200_000);
  });

  it('localStorage 不可用时不抛异常', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => ensureLocalStorageHealthy()).not.toThrow();
    expect(ensureLocalStorageHealthy().actions).toEqual([]);
  });
});
