/**
 * 批次8 — workspaceRegistry (工作区清单) + cleanupSessionsList (按时间清理) 测试
 * ----------------------------------------------------------------
 * 环境: node + 自带浏览器 stub (zustand persist 需要 localStorage)。
 * 覆盖: 去重 (路径归一化 + Windows 大小写) / 置顶 / 改名 / 删除 / upsert /
 *       清理器 (每工作区上限 + 时间窗 + 全局上限)。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useWorkspaceRegistry, normKey, sortWorkspaces } from './workspaceRegistry';
import { cleanupSessionsList } from './sessionStore';
import type { Session } from './sessionStore';

const installStubs = () => {
  const mem: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => { mem[k] = String(v); },
    removeItem: (k: string) => { delete mem[k]; },
    clear: () => { for (const k of Object.keys(mem)) delete mem[k]; },
  });
};

const reset = () => useWorkspaceRegistry.getState().clear();

describe('workspaceRegistry.normKey — 去重键归一化', () => {
  it('去尾斜杠 + 小写 (Windows 大小写不敏感)', () => {
    expect(normKey('F:\\work\\proj\\')).toBe(normKey('f:/work/proj'));
    expect(normKey('F:/a')).toBe(normKey('f:/a/'));
  });
  it('不同路径不合并', () => {
    expect(normKey('F:/a')).not.toBe(normKey('F:/b'));
  });
});

describe('workspaceRegistry.upsert / togglePin / rename / remove', () => {
  beforeEach(() => { installStubs(); reset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('upsert 按归一化路径去重, 重复切换只有一条 + 更新 lastUsedAt', () => {
    const r = useWorkspaceRegistry.getState();
    r.upsert('F:\\proj\\');
    r.upsert('f:/proj'); // 同一路径 (大小写/斜杠/尾斜杠不同)
    expect(useWorkspaceRegistry.getState().items).toHaveLength(1);
    expect(useWorkspaceRegistry.getState().items[0].path).toBe('F:\\proj\\');
    // 再切一次, 仍只一条, 且 lastUsedAt 有更新
    const before = useWorkspaceRegistry.getState().items[0].lastUsedAt;
    r.upsert('f:/proj');
    expect(useWorkspaceRegistry.getState().items).toHaveLength(1);
    expect(useWorkspaceRegistry.getState().items[0].lastUsedAt >= before).toBe(true);
  });

  it('togglePin 翻转 pinned; remove 清掉该项', () => {
    useWorkspaceRegistry.getState().upsert('F:/a');
    expect(useWorkspaceRegistry.getState().items[0].pinned).toBeFalsy();
    useWorkspaceRegistry.getState().togglePin('f:/A'); // 归一化匹配
    expect(useWorkspaceRegistry.getState().items[0].pinned).toBe(true);
    useWorkspaceRegistry.getState().remove('F:/a');
    expect(useWorkspaceRegistry.getState().items).toHaveLength(0);
  });

  it('rename 设显示名, setActive 记录归一化路径', () => {
    useWorkspaceRegistry.getState().upsert('F:/proj', '老项目');
    useWorkspaceRegistry.getState().rename('f:/proj', '新名字');
    expect(useWorkspaceRegistry.getState().items[0].name).toBe('新名字');
    useWorkspaceRegistry.getState().setActive('F:/proj');
    expect(useWorkspaceRegistry.getState().activePath).toBe(normKey('F:/proj'));
  });
});

describe('sortWorkspaces — 置顶优先, 其余按最近使用', () => {
  it('置顶排前, 非置顶按 lastUsedAt 倒序', () => {
    const items = [
      { path: 'a', lastUsedAt: 1 },
      { path: 'b', lastUsedAt: 3, pinned: true },
      { path: 'c', lastUsedAt: 2 },
    ];
    expect(sortWorkspaces(items).map(i => i.path)).toEqual(['b', 'c', 'a']);
  });
});

describe('cleanupSessionsList — 按时间 + 每工作区上限清理', () => {
  const NOW = 1_000_000_000_000; // 固定基准, 保证断言可预测 (14 天 = 1.2096e9 ms)
  /** age: 0=最新, 越大越旧; 直接给 updatedAt = NOW - age*ms */
  const mk = (id: string, ws: string, age: number): Session => ({
    id, title: id, messages: [], createdAt: 0,
    updatedAt: NOW - age * 86_400_000, workspace: ws,
  });

  it('每工作区只留最近 N 条', () => {
    // s0 最旧 … s9 最新 (age 越小越新)
    const many = Array.from({ length: 10 }, (_, i) => mk(`s${i}`, 'W', 10 - i));
    const kept = cleanupSessionsList(many, { maxPerWorkspace: 3, now: NOW });
    expect(kept).toHaveLength(3);
    // 保留的是最近 3 条: s9 > s8 > s7
    expect(kept.map(s => s.id).sort()).toEqual(['s7', 's8', 's9']);
  });

  it('太旧且不在"每区最近 N"内的会被清掉', () => {
    const kept = cleanupSessionsList(
      [mk('old', 'W', 30), mk('fresh', 'W', 1)],
      { maxPerWorkspace: 1, olderThanDays: 14, now: NOW },
    );
    // maxPerWorkspace=1 → 只留 fresh; old (30 天前) 太旧且不是最近 1 条 → 清掉
    expect(kept.map(s => s.id)).toEqual(['fresh']);
  });

  it('全局上限: 超出按最新保留', () => {
    const all = Array.from({ length: 5 }, (_, i) => ({ ...mk(`g${i}`, `W${i}`, 5 - i) })); // g4 最新
    const kept = cleanupSessionsList(all, { maxPerWorkspace: 30, globalCap: 3, now: NOW });
    expect(kept).toHaveLength(3);
    expect(kept.map(s => s.id).sort()).toEqual(['g2', 'g3', 'g4']);
  });

  it('不同工作区互不干扰 (各自算上限)', () => {
    const a = [mk('a1', 'A', 0), mk('a2', 'A', 1), mk('a3', 'A', 2)]; // a1 最新
    const b = [mk('b1', 'B', 0)];
    const kept = cleanupSessionsList([...a, ...b], { maxPerWorkspace: 2, globalCap: 100, now: NOW });
    expect(kept.filter(s => s.workspace === 'A').map(s => s.id).sort()).toEqual(['a1', 'a2']);
    expect(kept.filter(s => s.workspace === 'B')).toHaveLength(1);
  });
});
