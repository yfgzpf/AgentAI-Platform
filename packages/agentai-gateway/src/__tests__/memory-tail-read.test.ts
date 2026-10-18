/**
 * memory.ts P0 修复验证 — 2026-10-17
 * ==============================================
 * 背景 (验收全量回归时被抓出来的真 bug):
 *   用户目录 ~/.agentai/memory/default.jsonl 涨到 **1.6GB** (约 320 万条,
 *   绝大多数是测试跑出来的 auto_reflect)。连锁故障:
 *   ① readMemory 用 fs.readFile 整读 → 超 Node 字符串上限 (512MB) 抛
 *      Invalid string length, 被 catch 吞 → 静默返回 0 条记忆;
 *      且每次 recall 回退都要白读 7.5s 磁盘才抛错 (agent loop 里就是 7s 卡死)
 *   ② compressMemoryFile 同样整读 → 压缩在大文件上静默失效
 *   ③ cleanupOldMemory 同样整读 → "清理成功"但一条不删; 且**全代码库零调用**
 *      (evolution/task-snapshot/persistent-memory 都有 6h 循环, 唯独它没有)
 *      → 用户级文件只写不剪, 无限增长
 *   ④ atomicAppendFile 回退路径随机 tmp 名 + 失败不清理 → 实测泄漏
 *      10,931 个 0 字节 tmp (目录列表 847KB)
 *   ⑤ self-memory-updater.cleanupStaleMemories 是假功能: 条目无 id 字段,
 *      toDelete 恒空, 一条不删连日志都不打
 *
 * 本测试锁定修复后行为:
 *   R*  readTailLines 有界尾部读取 (小文件全读 / 大文件窗口读 / 不存在返回 [])
 *   A*  并发 append 串行不交错 + 不残留 tmp
 *   C*  cleanupOldMemory 真清理 (保留期 + 条数上限 + 陈旧 tmp 清扫)
 *   P*  pruneMemoryFile 排队原子重写
 *   S*  cleanupStaleMemories 真删除 (可实证文件行数变化)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readMemory, writeMemory, readTailLines, cleanupOldMemory, pruneMemoryFile,
  compressMemoryFile,
} from '../memory.js';
import { cleanupStaleMemories } from '../self-memory-updater.js';
import { WorkspaceManager } from '../workspace-manager.js';

const TMP = path.join(os.tmpdir(), 'agentai-memory-tailread-' + Date.now());
const WS = path.join(TMP, 'ws');
/** 独立 userId — 避免污染真实用户目录的 default.jsonl */
const UID = 'tailread-' + Date.now();
let userDir = '';

function wsMemoryFile(): string {
  return path.join(WS, '.agentai', 'memory.jsonl');
}

function entry(overrides: Partial<any> = {}): any {
  return {
    ts: Date.now(),
    userId: UID,
    workspace: WS,
    role: 'assistant',
    content: '测试记忆内容',
    source: 'workspace',
    ...overrides,
  };
}

beforeAll(() => {
  fs.mkdirSync(path.join(WS, '.agentai'), { recursive: true });
  userDir = WorkspaceManager.getInstance().subdir('memory');
  fs.mkdirSync(userDir, { recursive: true });
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  // 只删本测试自己造的文件 (UID 唯一, 不碰 default.jsonl 等真实数据)
  try {
    for (const f of fs.readdirSync(userDir)) {
      if (f.startsWith(UID) || f.startsWith(`zz-tailread-`)) {
        try { fs.unlinkSync(path.join(userDir, f)); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
});

// ═══════════════ R: readTailLines ═══════════════

describe('readTailLines — 有界尾部读取 (2026-10-17 P0)', () => {
  it('R1 小文件 (size <= maxBytes): 全量读取, 行序保持', async () => {
    const f = path.join(TMP, 'r1.jsonl');
    fs.writeFileSync(f, 'a\nb\nc\n');
    const lines = await readTailLines(f);
    expect(lines).toEqual(['a', 'b', 'c', '']);
  });

  it('R2 大文件 (size > maxBytes): 只读尾部窗口, 截断的首行被丢弃', async () => {
    const f = path.join(TMP, 'r2.jsonl');
    // 200 行 × 约 95B ≈ 19KB; 窗口 2KB → 只应看到最后约 21 行
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) lines.push(JSON.stringify({ i, pad: 'x'.repeat(80) }));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    const tail = await readTailLines(f, 2048);
    const nonEmpty = tail.filter(Boolean);
    expect(nonEmpty.length).toBeGreaterThan(10);
    expect(nonEmpty.length).toBeLessThan(30);
    // 最后一条完整保留; 窗口首条是文件中段 (i≈179) 的完整行 — 证明头部被跳过且没把截断行当数据
    expect(nonEmpty[nonEmpty.length - 1]).toContain('"i":199');
    expect(JSON.parse(nonEmpty[0]).i).toBeGreaterThan(170);
  });

  it('R3 不存在的文件: 返回 [] (与旧 readFile-ENOENT-被吞行为一致)', async () => {
    const lines = await readTailLines(path.join(TMP, 'no-such-file.jsonl'));
    expect(lines).toEqual([]);
  });

  it('R4 readMemory 端到端: >4MB 文件不再触发 Invalid string length, 且快', async () => {
    // 约 5MB+ (1 万条 × ~650B) — 超过默认 4MB 窗口, 走窗口读分支。
    // ts 用近期时间 (每秒一条, 最新的在文件尾) — 否则一年多前的旧 ts 会让
    // 时效衰减在双精度下全部抹平 (所有分数相等 → 稳定排序 → 返回窗口内最旧的),
    // 那是旧打分的固有行为, 不是本修复要解决的。
    const f = wsMemoryFile();
    const now = Date.now();
    const parts: string[] = [];
    for (let i = 0; i < 10000; i++) {
      parts.push(JSON.stringify(entry({ ts: now - (10000 - i) * 1000, content: `记忆 ${i} ` + 'y'.repeat(450) })));
    }
    fs.writeFileSync(f, parts.join('\n') + '\n');
    expect(fs.statSync(f).size).toBeGreaterThan(4 * 1024 * 1024);

    const t0 = Date.now();
    const results = await readMemory({ userId: UID, workspace: WS, limit: 50 });
    const elapsed = Date.now() - t0;
    expect(results.length).toBe(50);
    // 分数排序 favor 新条目 → 返回的是最新一批 (文件尾)
    const maxTs = Math.max(...results.map(r => r.ts));
    expect(maxTs).toBeGreaterThan(now - 60000);
    // 修复前: 5MB 整读虽不炸, 但 1.6GB 实文件每次 7.5s; 这里断言窗口读 < 2s 留足余量
    expect(elapsed).toBeLessThan(2000);
  });
});

// ═══════════════ A: append 串行 + tmp 不泄漏 ═══════════════

describe('atomicAppendFile — 并发串行 + tmp 治理 (2026-10-17 P0)', () => {
  it('A1 并发写 30 条: 行数精确 30, 全部可解析, 无交错, 无 tmp 残留', async () => {
    const uid = UID + '-a1';
    // 先清空工作区文件 (R4 刚往里写过 1 万条), 否则行数断言会被污染
    fs.writeFileSync(wsMemoryFile(), '');
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        writeMemory(entry({ userId: uid, ts: 1800000000000 + i, content: `A1-${i} ` + 'z'.repeat(100) }))),
    );
    // writeMemory 双写: 工作区文件 + 用户级文件, 两处都验
    for (const f of [wsMemoryFile(), path.join(userDir, `${uid}.jsonl`)]) {
      const lines = fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim());
      expect(lines.length).toBe(30);
      for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    }
    // 目录里不应留下任何 tmp (旧实现失败路径会攒随机名 tmp)
    const leftovers = fs.readdirSync(userDir).filter(f => f.endsWith('.tmp'));
    expect(leftovers.filter(f => f.includes(uid))).toEqual([]);
    try { fs.unlinkSync(path.join(userDir, `${uid}.jsonl`)); } catch { /* ignore */ }
  });
});

// ═══════════════ C: cleanupOldMemory ═══════════════

describe('cleanupOldMemory — 真清理 (2026-10-17 P0)', () => {
  it('C1 保留期 + 条数上限: 丢 31 天前的, 1200 条新记忆砍到最新 1000', async () => {
    const uid = UID + '-c1';
    const userFile = path.join(userDir, `${uid}.jsonl`);
    const now = Date.now();
    const lines: string[] = [];
    // 5 条 31 天前 (应被保留期丢弃)
    for (let i = 0; i < 5; i++) {
      lines.push(JSON.stringify(entry({ userId: uid, ts: now - 31 * 86400_000 + i })));
    }
    // 1200 条新的 (应被 1000 上限砍到最新 1000)
    for (let i = 0; i < 1200; i++) {
      lines.push(JSON.stringify(entry({ userId: uid, ts: now - 100000 + i })));
    }
    fs.writeFileSync(userFile, lines.join('\n') + '\n');

    const r = await cleanupOldMemory(uid);
    expect(r.deleted).toBe(205);   // 5 (过期) + 200 (超上限)
    const kept = fs.readFileSync(userFile, 'utf-8').split('\n').filter(l => l.trim());
    expect(kept.length).toBe(1000);
    // 保留的必须是最新的 1000 条 (ts 最大的)
    const tss = kept.map(l => JSON.parse(l).ts).sort((a, b) => a - b);
    expect(tss[0]).toBe(now - 100000 + 200);      // 第 200 新的
    expect(tss[tss.length - 1]).toBe(now - 100000 + 1199);
  });

  it('C2 无变化不重写: 全是最新条目不触发文件变异', async () => {
    const uid = UID + '-c2';
    const userFile = path.join(userDir, `${uid}.jsonl`);
    fs.writeFileSync(userFile, JSON.stringify(entry({ userId: uid })) + '\n');
    const before = fs.statSync(userFile).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    const r = await cleanupOldMemory(uid);
    expect(r.deleted).toBe(0);
    expect(fs.statSync(userFile).mtimeMs).toBe(before);
  });

  it('C3 陈旧 tmp 清扫: 只清新代码确定性 tmp, 旧版随机名残留绝不碰', async () => {
    const stamp = Date.now();
    const oldTmp = path.join(userDir, `zz-tailread-${stamp}.jsonl.rewrite.tmp`);
    const freshTmp = path.join(userDir, `zz-tailread-${stamp}.jsonl.tmp`);
    const bigTmp = path.join(userDir, `zz-tailread-${stamp}.jsonl.prune.tmp`);
    // 旧版随机名残留 (2026-10-17 实测用户目录有 10,931 个) — 自动清理不经同意不动它们
    const legacyTmp = path.join(userDir, `zz-tailread-${stamp}.jsonl.a1b2c3d4.tmp`);
    fs.writeFileSync(oldTmp, '');
    fs.writeFileSync(freshTmp, '');
    fs.writeFileSync(bigTmp, 'x'.repeat(2 * 1024 * 1024));
    fs.writeFileSync(legacyTmp, '');
    const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
    for (const f of [oldTmp, bigTmp, legacyTmp]) {
      fs.utimesSync(f, twoHoursAgo / 1000, twoHoursAgo / 1000);
    }

    await cleanupOldMemory(UID + '-c3');
    expect(fs.existsSync(oldTmp)).toBe(false);    // 陈旧 + 新代码模式 → 扫掉
    expect(fs.existsSync(freshTmp)).toBe(true);   // 1h 内的可能在用 → 留
    expect(fs.existsSync(bigTmp)).toBe(true);     // 超 1MB → 保守不扫 (afterAll 兜底删)
    expect(fs.existsSync(legacyTmp)).toBe(true);  // ★ 历史遗留随机名: 自动清理绝不碰 (需用户同意)
  });

  it('C4 大文件 (>4MB): 流式全量清理 — 头部保留期内条目不被位置截断蒸发 (P0-2)', async () => {
    // 红线复现: user.jsonl 5.0MB/10,581 条。"尾部读窗口(4MB)+整体覆写"组合会把
    // 窗口外 (文件头部) 的真实记忆静默蒸发 — 位置截断 ≠ 清理。乱序/补写会让
    // 保留期条目落在头部 (本测试头部 150 条保留期 + 中部 4700 超期 + 尾部 150 保留期)。
    const uid = UID + '-c4';
    const f = path.join(userDir, `${uid}.jsonl`);
    const now = Date.now();
    const DAY = 86400_000;
    const pad = 'x'.repeat(800); // 每条 ~850B
    const keepMarkers: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 150; i++) {
      const m = `c4-head-${i}`;
      keepMarkers.push(m);
      lines.push(JSON.stringify({ ts: now - DAY, userId: uid, role: 'user', content: m + ' ' + pad }));
    }
    for (let i = 0; i < 4700; i++) {
      lines.push(JSON.stringify({ ts: now - 60 * DAY, userId: uid, role: 'assistant', content: `c4-mid-${i} ${pad}` }));
    }
    for (let i = 0; i < 150; i++) {
      const m = `c4-tail-${i}`;
      keepMarkers.push(m);
      lines.push(JSON.stringify({ ts: now, userId: uid, role: 'user', content: m + ' ' + pad }));
    }
    fs.writeFileSync(f, lines.join('\n') + '\n');
    expect(fs.statSync(f).size / 1024 / 1024).toBeGreaterThan(4); // 确认超过尾部读窗口

    const r = await cleanupOldMemory(uid);
    expect(r.deleted).toBe(4700); // 超期精确删除, 保留期一条不误伤

    const after = (await readTailLines(f)).filter(Boolean);
    expect(after.length).toBe(300); // 150 head + 150 tail 全保留
    const content = after.join('\n');
    for (const m of keepMarkers) {
      expect(content).toContain(m); // ★ 头部保留期条目一条不少 (旧实现在此全军覆没)
    }
  });

  it('C5 compressMemoryFile 大文件 (>4MB): 跳过不覆写, 等 cleanup 缩容 (P0-2)', async () => {
    // 60 条 × ~70KB ≈ 4.2MB — 超 COMPRESS_THRESHOLD(50) 且超 4MB 窗口。
    // 旧逻辑: 尾部读 + unlink + writeFile 覆写 → 窗口外条目蒸发; 新逻辑: 跳过。
    const f = path.join(TMP, 'c5.jsonl');
    const now = Date.now();
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(JSON.stringify({ ts: now - (60 - i) * 1000, userId: UID + '-c5', role: 'user', content: `c5-${i} ` + 'y'.repeat(70000) }));
    }
    fs.writeFileSync(f, lines.join('\n') + '\n');
    expect(fs.statSync(f).size / 1024 / 1024).toBeGreaterThan(4);
    const mtimeBefore = fs.statSync(f).mtimeMs;

    await compressMemoryFile(f);

    // 注意: 文件本身 >4MB, readTailLines 窗口读会丢窗口首行 (固有行为), 验证必须全量读
    const after = fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean);
    expect(after.length).toBe(60); // 一条没动 (压缩被跳过)
    expect(fs.statSync(f).mtimeMs).toBe(mtimeBefore); // 文件未被覆写
  });
});

// ═══════════════ P: pruneMemoryFile ═══════════════

describe('pruneMemoryFile — 排队原子重写 (2026-10-17 P0)', () => {
  it('P1 decide 保留子集 → rewritten=true, 内容真实更换', async () => {
    const f = path.join(TMP, 'p1.jsonl');
    fs.writeFileSync(f, [
      JSON.stringify(entry({ ts: 1, content: 'keep-1' })),
      JSON.stringify(entry({ ts: 2, content: 'drop' })),
      JSON.stringify(entry({ ts: 3, content: 'keep-3' })),
    ].join('\n') + '\n');
    const r = await pruneMemoryFile(f, (entries) => entries.filter(e => !String(e.content).includes('drop')));
    expect(r).toEqual({ before: 3, after: 2, rewritten: true });
    const lines = fs.readFileSync(f, 'utf-8').split('\n').filter(l => l.trim());
    expect(lines.length).toBe(2);
    expect(fs.readFileSync(f, 'utf-8')).not.toContain('drop');
  });

  it('P2 decide 全保留 → rewritten=false, 不碰文件', async () => {
    const f = path.join(TMP, 'p2.jsonl');
    fs.writeFileSync(f, JSON.stringify(entry({ content: 'x' })) + '\n');
    const before = fs.statSync(f).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    const r = await pruneMemoryFile(f, (entries) => entries);
    expect(r.rewritten).toBe(false);
    expect(fs.statSync(f).mtimeMs).toBe(before);
  });
});

// ═══════════════ S: cleanupStaleMemories 真删除 ═══════════════

describe('cleanupStaleMemories — 假功能修复 (2026-10-17 P0)', () => {
  it('S1 superseded + 低重要性过期 真被删, 文件行数可实证', async () => {
    const now = Date.now();
    const lines = [
      JSON.stringify(entry({ ts: now - 1000, importance: 0.9, content: 'good-recent', metadata: { category: 'decision' } })),
      JSON.stringify(entry({ ts: now - 1000, importance: 0.05, content: 'low-but-recent', metadata: { category: 'pattern' } })),
      JSON.stringify(entry({ ts: now - 31 * 86400_000, importance: 0.9, content: 'old-but-important' })),
      JSON.stringify(entry({ ts: now - 31 * 86400_000, importance: 0.05, content: 'old-and-low' })),
      JSON.stringify(entry({ ts: now - 1000, importance: 0.8, content: 'superseded-one', metadata: { category: 'superseded' } })),
    ];
    fs.writeFileSync(wsMemoryFile(), lines.join('\n') + '\n');

    const r = await cleanupStaleMemories(WS);
    // 旧实现: deleted 恒 0 (条目无 id, toDelete 恒空)
    expect(r.deleted).toBe(2);            // old-and-low + superseded-one
    expect(r.remaining).toBe(3);

    const after = fs.readFileSync(wsMemoryFile(), 'utf-8');
    expect(after.split('\n').filter(l => l.trim()).length).toBe(3);
    expect(after).not.toContain('old-and-low');
    expect(after).not.toContain('superseded-one');
    expect(after).toContain('old-but-important');   // 重要性高, 过期也留
    expect(after).toContain('low-but-recent');      // 重要性低但新, 留
  });

  it('S2 超过 200 条: LRU 砍到 200, 先砍最不重要的', async () => {
    const now = Date.now();
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) {
      lines.push(JSON.stringify(entry({ ts: now - 1000 + i, importance: i < 50 ? 0.05 : 0.9, content: `S2-${i}` })));
    }
    fs.writeFileSync(wsMemoryFile(), lines.join('\n') + '\n');
    const r = await cleanupStaleMemories(WS);
    expect(r.deleted).toBe(50);
    expect(r.remaining).toBe(200);
    const after = fs.readFileSync(wsMemoryFile(), 'utf-8');
    expect(after.split('\n').filter(l => l.trim()).length).toBe(200);
    expect(after).not.toContain('S2-0');      // 最低分被砍
    expect(after).toContain('S2-249');        // 最高分 (也最新) 保留
  });
});
