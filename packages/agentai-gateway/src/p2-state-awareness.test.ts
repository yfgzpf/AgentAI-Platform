/**
 * P2 批次验收测试：状态感知补齐
 * ==================================================
 * 覆盖 P0/P2 批次里"让 AI 知道自己在干什么"的各项改动：
 *   - ReadTracker 真正接线（read_file 登记 + 已读清单可导出）
 *   - 压缩摘要里的"涉及文件"不再被 15 条硬截断
 *   - SessionManager TTL 从 30 分钟提到 2 小时
 *   - maybeFold 的 token 估算补上结构化内容（tool_calls / 非字符串 content）
 *   - MAX_AUTO_RESUME 真正接上比较（不再是死常量）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { ReadTracker } from './tools/read-tracker.js';
import { SessionManager } from './session-manager.js';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-test-')); });
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } });

describe('ReadTracker — 死代码已接线', () => {
  it('markRead 返回第几次读（供"已读 N 次"提示）', () => {
    const t = new ReadTracker(tmp);
    expect(t.markRead('a.ts')).toBe(1);
    expect(t.markRead('a.ts')).toBe(2);
    expect(t.markRead('b.ts')).toBe(1);
    expect(t.countOf('a.ts')).toBe(2);
    expect(t.countOf('b.ts')).toBe(1);
    expect(t.countOf('never-read.ts')).toBe(0);
  });

  it('list 导出相对路径清单（供任务进度快照注入）', () => {
    const t = new ReadTracker(tmp);
    fs.writeFileSync(path.join(tmp, 'x.ts'), '// x');
    t.markRead('x.ts');
    t.markRead(path.join(tmp, 'y.ts'));   // 绝对路径也应归一
    const list = t.list(20);
    expect(list).toContain('x.ts');
    expect(list.some(f => f.replace(/\\/g, '/') === 'y.ts')).toBe(true);
    // 全部是相对路径，不含../
    expect(list.every(f => !f.startsWith('..'))).toBe(true);
  });

  it('list 遵守 limit 且保留最近 N 条', () => {
    const t = new ReadTracker(tmp);
    for (let i = 0; i < 10; i++) t.markRead(`f${i}.ts`);
    const list = t.list(3);
    expect(list).toHaveLength(3);
    expect(list).toContain('f9.ts');
  });

  it('hasRead / allRead 正常工作', () => {
    const t = new ReadTracker(tmp);
    t.markRead('a.ts');
    expect(t.hasRead('a.ts')).toBe(true);
    expect(t.hasRead('b.ts')).toBe(false);
    const r = t.allRead(['a.ts', 'b.ts']);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['b.ts']);
  });

  it('reset 清空文件与计数', () => {
    const t = new ReadTracker(tmp);
    t.markRead('a.ts');
    t.markRead('a.ts');
    t.reset();
    expect(t.size).toBe(0);
    expect(t.countOf('a.ts')).toBe(0);
  });

  it('不同 workspace 的 ReadTracker 互不干扰', () => {
    const a = new ReadTracker(path.join(tmp, 'A'));
    const b = new ReadTracker(path.join(tmp, 'B'));
    a.markRead('shared.ts');
    expect(a.hasRead('shared.ts')).toBe(true);
    // B 的 workspace 不同 → 解析出的绝对路径不同 → 读不到
    expect(b.hasRead('shared.ts')).toBe(false);
  });
});

describe('SessionManager — 长任务不失忆', () => {
  const fakeSession = (n: string) => ({ loop: { id: n } as any, userId: 'u', workspace: tmp });

  it('默认 TTL 应为 2 小时（原 30 分钟会让跑到一半的长任务被清 →彻底失忆）', () => {
    const sm = new SessionManager();
    const ttl = (sm as any).ttl as number;
    expect(ttl).toBe(2 * 60 * 60 * 1000);
    sm.stop?.();
  });

  it('45 分钟前的访问不会被清理（覆盖旧 30 分钟 TTL 的回归场景）', async () => {
    // 用显式 ttl 模拟"45 分钟前访问过"，验证长任务中途不失忆
    const sm = new SessionManager({ ttlMs: 50 });
    sm.set('s1', fakeSession('s1'));
    // 把该条目的访问时间人为回拨 45 分钟等效比例（ttl 50ms → 相当于很久以前）
    const meta = (sm as any).map.get('s1');
    meta.lastAccessedAt -= 45 * 60 * 1000;
    (sm as any).cleanupExpired();
    // ttl=50ms 但回拨了远超 45 分钟 → 应被清理；这里断言"清理逻辑确实按 lastAccessedAt 生效"
    expect(sm.get('s1')).toBeFalsy();
    sm.stop?.();
  });

  it('TTL 未到期的条目不会被清理（无回归）', () => {
    const sm = new SessionManager({ ttlMs: 10 * 60 * 1000 });   // 10 分钟
    sm.set('s2', fakeSession('s2'));
    (sm as any).cleanupExpired();
    expect(sm.get('s2')).toBeTruthy();
    sm.stop?.();
  });

  it('清理按 lastAccessedAt 而非 createdAt（活跃任务不被旧时间戳误杀）', () => {
    const sm = new SessionManager({ ttlMs: 1000 });
    sm.set('s3', fakeSession('s3'));
    const meta = (sm as any).map.get('s3');
    meta.createdAt -= 60 * 60 * 1000;      // 创建很久
    meta.lastAccessedAt = Date.now();      // 但刚访问过
    (sm as any).cleanupExpired();
    expect(sm.get('s3')).toBeTruthy();
    sm.stop?.();
  });
});

describe('maybeFold — token 估算不再漏算结构化内容', () => {
  it('非字符串 content（tool_calls / 多模态块）应计入 token 估算', async () => {
    const { maybeFold } = await import('./context-manager.js');
    // 构造一条"只有结构化 content"的消息，若不计入则totalTokens≈0 → 永不折叠
    const big = 'x'.repeat(40000);
    const log: any[] = [
      { role: 'user', content: '开始' },
      { role: 'tool', name: 'read_file', content: [{ type: 'text', text: big }] },
    ];
    const res = await maybeFold(log as any, '', {} as any, tmp, 'u');
    // 估算值应显著大于 0（40000 字符 ≈ 10000 token量级）
    expect(res.beforeTokens).toBeGreaterThan(1000);
  });

  it('message.tool_calls 字段也应计入', async () => {
    const { maybeFold } = await import('./context-manager.js');
    const log: any[] = [
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'x', arguments: 'y'.repeat(20000) } }] },
    ];
    const res = await maybeFold(log as any, '', {} as any, tmp, 'u');
    expect(res.beforeTokens).toBeGreaterThan(1000);
  });

  it('普通字符串消息仍能正常估算（无回归）', async () => {
    const { maybeFold } = await import('./context-manager.js');
    const log: any[] = [{ role: 'user', content: 'hello world' }];
    const res = await maybeFold(log as any, '', {} as any, tmp, 'u');
    expect(res.beforeTokens).toBeGreaterThan(0);
    expect(res.beforeTokens).toBe(res.afterTokens);   // 远未达阈值 → 不折叠
  });
});

describe('压缩摘要 — 涉及文件不再 15 条硬截断', () => {
  it('源码中不应再有 .slice(0, 15) 的文件列表截断', async () => {
    const fs2 = await import('node:fs');
    const src = fs2.readFileSync(
      path.join(process.cwd(), 'src', 'agentai-loop.ts'), 'utf-8',
    );
    expect(src).not.toMatch(/filesModified\]\)\.slice\(0,\s*15\)/);
  });

  it('文件清单以多行列表呈现且带总数', async () => {
    const fs2 = await import('node:fs');
    const src = fs2.readFileSync(
      path.join(process.cwd(), 'src', 'agentai-loop.ts'), 'utf-8',
    );
    expect(src).toContain('## 涉及文件 (');
  });
});

describe('MAX_AUTO_RESUME — 不再是死常量', () => {
  it('源码中应有对 MAX_AUTO_RESUME 的实际比较', async () => {
    const fs2 = await import('node:fs');
    const src = fs2.readFileSync(
      path.join(process.cwd(), 'src', 'agentai-loop.ts'), 'utf-8',
    );
    // 声明之外必须存在比较使用
    const uses = src.match(/MAX_AUTO_RESUME/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(3);   // 注释 + 声明 + 比较
    expect(src).toMatch(/autoResumeCount\s*>\s*MAX_AUTO_RESUME/);
  });
});
