/**
 * 首屏恢复当前会话 (2026-10-21 富哥实锤: "关掉页面再进, 很多消息没了, 也不在当前对话")
 * ======================================================================
 * 两个根因:
 *   ① useSessionAutoSave 的恢复 effect 只在 activeId **变化**时跑, 首次挂载
 *      prevActiveIdRef 已等于 activeId → 直接 return → 只剩 chatStore 自己 persist
 *      的那份 (partialize 只留 200 条, 配额紧张时 pruner 压到 80 条);
 *      sessionStore (按会话分桶; 2026-10-22 起上限 50000, 此前 300) 从未被读 → "消息凭空少一大截"。
 *   ② activeId 指向的会话被 cleanupSessionsList 清掉后仍被持久化 → 打开空对话。
 * 本文件锁死: 首屏一次性 hydrate(session 基线 + chatStore 新消息合并) + 悬空兜底。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = readFileSync(path.resolve(__dirname, 'hooks/useSessionAutoSave.ts'), 'utf-8');
const STORE = readFileSync(path.resolve(__dirname, 'store/sessionStore.ts'), 'utf-8');

describe('首屏恢复: 以 sessionStore 为真源', () => {
  it('① 挂载即 hydrate 一次 (不依赖 activeId 变化)', () => {
    expect(HOOK).toContain('const didHydrateRef = useRef(false);');
    expect(HOOK).toMatch(/if \(didHydrateRef\.current\) return;/);
    expect(HOOK).toMatch(/didHydrateRef\.current = true;/);
    // 恢复基线来自 sessionStore 的当前会话
    expect(HOOK).toContain('const session = store.getMySessions().find((s: any) => s.id === activeId);');
  });

  it('② 合并 chatStore 里 session 尚未落盘的新消息 (两端都不丢)', () => {
    expect(HOOK).toContain('const fromSession = restoreFromSession(session);');
    expect(HOOK).toContain('if (!m?.id || byId.has(m.id)) continue;');
    // 合并后按时间排序, 且流式态收敛 (否则刷新后卡片永远"生成中")
    expect(HOOK).toMatch(/\.sort\(\(a: any, b: any\) => \(a\.ts \|\| 0\) - \(b\.ts \|\| 0\)\)/);
    expect(HOOK).toContain("streaming: false");
  });

  it('③ activeId 悬空 → 自动切到最近会话 (不再开一个空对话)', () => {
    expect(HOOK).toMatch(/if \(!session\) \{/);
    expect(HOOK).toContain('const latest = store.getMySessions()[0];');
    expect(HOOK).toContain('if (latest) store.setActive(latest.id);');
    expect(HOOK).toContain('useSessionStore.setState({ activeId: null } as any);');
  });

  it('④ 切会话路径复用同一套还原逻辑 (不重复实现)', () => {
    expect(HOOK).toMatch(/setChatMessages\(restoreFromSession\(session\)\)/);
  });
});

describe('会话上限: 保头保尾', () => {
  it('⑤ 两处写入都走 capSessionMessages, slice(-300) 绝迹', () => {
    expect(STORE).toContain('export function capSessionMessages<T>');
    expect(STORE).toContain('capSessionMessages([...x.messages, withId])');
    expect(STORE).toContain('capSessionMessages(arr)');
    expect(STORE).not.toContain('.slice(-300)');
  });
});

describe('① 会话存储迁 IndexedDB (根治 300 条硬上限数据丢失)', () => {
  it('persist 后端已是 indexedDbStorage, 不再用旧 quotaSafeSessionStorage 后端', () => {
    expect(STORE).toContain("from '../utils/indexed-db-storage'");
    expect(STORE).toMatch(/storage:\s*createJSONStorage\(\(\)\s*=>\s*indexedDbStorage\)/);
    // 旧 localStorage 后端不再出现在 persist config 里
    expect(STORE).not.toContain('createJSONStorage(() => quotaSafeSessionStorage)');
  });

  it('cap 默认值已抬到 50_000, 不再有 300 硬上限', () => {
    expect(STORE).toContain('cap = 50_000');
    expect(STORE).not.toContain('capSessionMessages<T>(arr: T[], cap = 300');
  });
});
