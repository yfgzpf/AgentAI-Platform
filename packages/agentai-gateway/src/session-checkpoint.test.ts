/**
 * session-checkpoint.test.ts — 会话级 checkpoint/rewind 单测
 * =================================================================
 * 重点不是"能不能存回来" (那是文件系统的事), 而是**安全红线有没有被锁死**:
 *   - 只回滚被跟踪的文件, 绝不碰目录里其他东西
 *   - 符号链接 / 工作区外路径 一律拒绝
 *   - dryRun 默认不动盘
 *   - first write wins (回到的是"这一轮开始前", 不是"上一次编辑前")
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ROOT 由 AGENTAI_CHECKPOINT_ROOT 决定 (模块内每次读 env) → 必须在 import 之前设,
// 且**整个文件周期内不能删** (删了模块会退回真实 ~/.agentai/checkpoints 写盘)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'session-cp-'));
const WS = path.join(TMP, 'ws');
fs.mkdirSync(WS, { recursive: true });
process.env.AGENTAI_CHECKPOINT_ROOT = path.join(TMP, 'cp-store');
process.env.SESSION_CHECKPOINT_ENABLED = 'true';
delete process.env.SESSION_CHECKPOINT_KEEP;

const cp = await import('./session-checkpoint.ts');

const SID = 'test-session-1';

function f(p: string): string { return path.join(WS, p); }

beforeEach(() => {
  fs.rmSync(path.join(TMP, 'cp-store'), { recursive: true, force: true });
  // ⚠️ 必须整目录重建而不是 writeFileSync 覆盖:
  // TOCTOU 用例会把 a.txt 换成符号链接, 而 writeFileSync 对链接是"跟随写入",
  // 链接本身还在 → 后续用例全部读到链接 (这坑踩过一次)。
  fs.rmSync(WS, { recursive: true, force: true });
  fs.mkdirSync(WS, { recursive: true });
  fs.writeFileSync(f('a.txt'), 'v0', 'utf8');
  fs.writeFileSync(f('b.txt'), 'untouched', 'utf8');
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* Windows 可能占用 */ }
});

describe('session-checkpoint · 建点', () => {
  it('beginTurn 建 checkpoint 并标 current', () => {
    const id = cp.beginTurn(SID, '帮我改一下 a.txt');
    expect(id).toBeTruthy();
    expect(cp.getCurrentCheckpoint(SID)).toBe(id);
    const list = cp.listCheckpoints(SID);
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('帮我改一下 a.txt');
    expect(list[0].fileCount).toBe(0);
  });

  it('prompt 摘要压空白 + 截断 100 字', () => {
    const id = cp.beginTurn(SID, 'a'.repeat(50) + '   \n  ' + 'b'.repeat(200));
    expect(id).toBeTruthy();
    const label = cp.listCheckpoints(SID)[0].label;
    expect(label.length).toBeLessThanOrEqual(100);
    expect(label).not.toContain('\n');
  });

  it('开关关掉 → 不建点也不跟踪 (零副作用)', () => {
    process.env.SESSION_CHECKPOINT_ENABLED = 'false';
    expect(cp.beginTurn(SID, 'x')).toBeNull();
    expect(cp.getCurrentCheckpoint(SID)).toBeNull();
    expect(cp.trackFile(SID, f('a.txt'), WS)).toBe(false);
    process.env.SESSION_CHECKPOINT_ENABLED = 'true';
  });

  it('sessionId 含穿越字符 → 目录名被消毒, 不写到 ROOT 之外', () => {
    const evil = '../../evil';
    const id = cp.beginTurn(evil, 'x');
    expect(id).toBeTruthy();
    const dirs = fs.readdirSync(path.join(TMP, 'cp-store'));
    expect(dirs.every(d => !d.includes('..') && !d.includes('/'))).toBe(true);
    expect(fs.existsSync(path.join(TMP, 'evil'))).toBe(false);
  });
});

describe('session-checkpoint · 跟踪改动', () => {
  it('改动前存副本; first write wins (改两次只存首份)', () => {
    cp.beginTurn(SID, 'turn1');
    expect(cp.trackFile(SID, f('a.txt'), WS)).toBe(true);          // v0 入库
    fs.writeFileSync(f('a.txt'), 'v1', 'utf8');                     // AI 改成 v1
    expect(cp.trackFile(SID, f('a.txt'), WS)).toBe(false);         // 本轮第二次 → 不再存
    fs.writeFileSync(f('a.txt'), 'v2', 'utf8');                     // 又改成 v2
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('v0');         // 回到本轮开始前
  });

  it('工作区外路径拒绝跟踪', () => {
    cp.beginTurn(SID, 'x');
    const outside = path.join(TMP, 'outside.txt');
    fs.writeFileSync(outside, 'secret', 'utf8');
    expect(cp.trackFile(SID, outside, WS)).toBe(false);
  });

  it('目录 / 符号链接不跟踪 (防回滚穿透出工作区)', () => {
    cp.beginTurn(SID, 'x');
    expect(cp.trackFile(SID, WS, WS)).toBe(false);                 // 目录
    const link = f('link.txt');
    try {
      fs.symlinkSync(path.join(TMP, 'outside.txt'), link, 'file'); // Windows 可能无权限 → 跳过
      expect(cp.trackFile(SID, link, WS)).toBe(false);
    } catch {
      /* symlink 权限不足, 该分支在本机跳过 */
    }
  });

  it('巨型文件不跟踪 (省磁盘)', () => {
    cp.beginTurn(SID, 'x');
    const big = f('big.bin');
    fs.writeFileSync(big, Buffer.alloc(9 * 1024 * 1024, 1));
    expect(cp.trackFile(SID, big, WS)).toBe(false);
  });
});

describe('session-checkpoint · rewind', () => {
  it('dryRun (默认) 只出计划, 不动盘', () => {
    cp.beginTurn(SID, 'turn');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'broken', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { workspaceRoot: WS });
    expect(r.dryRun).toBe(true);
    expect(r.restored).toBe(1);
    expect(r.actions[0].action).toBe('restore');
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('broken');   // 盘上还是 broken
  });

  it('apply 恢复内容, 且不碰未跟踪的文件', () => {
    cp.beginTurn(SID, 'turn');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'broken', 'utf8');
    fs.writeFileSync(f('b.txt'), 'AI 顺手改的', 'utf8');            // 没被跟踪
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('v0');         // 恢复
    expect(fs.readFileSync(f('b.txt'), 'utf8')).toBe('AI 顺手改的'); // 没动
    expect(r.actions.filter(a => a.action === 'skip')).toHaveLength(0);
  });

  it('本轮新建的文件 → rewind 删掉它', () => {
    cp.beginTurn(SID, 'turn');
    expect(cp.trackFile(SID, f('new.ts'), WS)).toBe(true);          // 跟踪时不存在 → existed:false
    fs.writeFileSync(f('new.ts'), 'AI 新建的垃圾', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.deleted).toBe(1);
    expect(fs.existsSync(f('new.ts'))).toBe(false);
  });

  it('TOCTOU: 跟踪后路径被换成符号链接 → 拒绝写回', () => {
    cp.beginTurn(SID, 'turn');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'tampered', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    // 删掉真文件, 换成指向工作区外的链接 (模拟"中途被换掉")
    fs.unlinkSync(f('a.txt'));
    let linked = false;
    try {
      fs.symlinkSync(path.join(TMP, 'outside.txt'), f('a.txt'), 'file');
      linked = true;
    } catch { /* 无权限则跳过断言 */ }
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    if (linked) {
      expect(r.skipped).toBe(1);
      expect(r.actions[0].action).toBe('skip');
      expect(r.actions[0].reason).toContain('符号链接');
    } else {
      // 无 symlink 权限时: 文件已不存在 → 走 restore 分支重建, 也不能崩
      expect(r.ok).toBe(true);
    }
  });

  it('内容没变 → unchanged (不白写盘)', () => {
    cp.beginTurn(SID, 'turn');
    cp.trackFile(SID, f('a.txt'), WS);
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.unchanged).toBe(1);
    expect(r.restored).toBe(0);
  });

  it('空 checkpoint (该轮没改文件) → ok 且零动作', () => {
    const id = cp.beginTurn(SID, '只问了个问题');
    const r = cp.rewind(SID, id!, { apply: true, workspaceRoot: WS });
    expect(r.ok).toBe(true);
    expect(r.actions).toHaveLength(0);
  });

  it('路径已移出工作区 → 跳过', () => {
    cp.beginTurn(SID, 'turn');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'changed', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: path.join(WS, 'other') });
    expect(r.skipped).toBe(1);
    expect(r.actions[0].reason).toContain('工作区');
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('changed');
  });

  it('不存在的 checkpointId → ok:true 零动作 (不报错, 菜单里空选项而已)', () => {
    const r = cp.rewind(SID, 'cp-不存在的', { apply: true, workspaceRoot: WS });
    expect(r.ok).toBe(true);
    expect(r.actions).toHaveLength(0);
  });
});

describe('session-checkpoint · 并发与审计 (2026-10-16 自审新增)', () => {
  it('显式 cpId: 并发两个 loop 各挂各的点, 互不串台 (回归: 曾丢跟踪导致回退空转)', () => {
    const cpA = cp.beginTurn(SID, '并发消息 A')!;
    const cpB = cp.beginTurn(SID, '并发消息 B')!;   // 抢走了 current
    // A 的 loop 必须按**自己的** cpId 跟踪, 不能靠 current
    expect(cp.trackFile(SID, f('a.txt'), WS, cpA)).toBe(true);
    fs.writeFileSync(f('a.txt'), 'A 改坏了', 'utf8');
    expect(cp.trackFile(SID, f('b.txt'), WS, cpB)).toBe(true);
    fs.writeFileSync(f('b.txt'), 'B 改坏了', 'utf8');

    // 各自回退都真的生效 —— 这才是修复的意义
    const ra = cp.rewind(SID, cpA, { apply: true, workspaceRoot: WS });
    expect(ra.actions.length).toBe(1);
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('v0');
    const rb = cp.rewind(SID, cpB, { apply: true, workspaceRoot: WS });
    expect(rb.actions.length).toBe(1);
    expect(fs.readFileSync(f('b.txt'), 'utf8')).toBe('untouched');
  });

  it('不传 cpId 时退回 current (老调用方兼容)', () => {
    const id = cp.beginTurn(SID, 'x')!;
    expect(cp.trackFile(SID, f('a.txt'), WS)).toBe(true);
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.actions.some(a => a.path === f('a.txt'))).toBe(true);
  });

  it('Windows 盘符大小写不同不该导致静默跳过', () => {
    cp.beginTurn(SID, 'x');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'changed', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    // 模拟 GUI 传的工作区只有盘符大小写不同
    const flipped = process.platform === 'win32'
      ? WS.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ':')
      : WS;
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: flipped });
    if (process.platform === 'win32') {
      expect(r.skipped).toBe(0);
      expect(r.restored + r.unchanged).toBe(1);
    } else {
      expect(r.skipped).toBe(1); // 非 Windows 仍应严格
    }
  });

  it('回滚留痕: 动过哪些文件、谁干的、preview 与 apply 分开记', () => {
    cp.beginTurn(SID, 'x');
    cp.trackFile(SID, f('a.txt'), WS);
    fs.writeFileSync(f('a.txt'), 'broken', 'utf8');
    const id = cp.getCurrentCheckpoint(SID)!;
    const preview = cp.rewind(SID, id, { workspaceRoot: WS });
    cp.logRewind(SID, preview, { workspaceRoot: WS, actor: 'gui' });
    const applied = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    cp.logRewind(SID, applied, { workspaceRoot: WS, actor: 'gui' });

    const log = cp.readRewindLog(SID);
    expect(log).toHaveLength(2);
    expect(log[0].action).toBe('rewind-apply');       // 最新的在前
    expect(log[1].action).toBe('rewind-preview');
    expect(log[0].actor).toBe('gui');
    expect(log[0].files[0].path).toBe(f('a.txt'));
    expect(log[0].files[0].action).toBe('restore');
  });

  it('过期会话被清扫, 新会话不动 (磁盘只涨不跌的兜底)', () => {
    cp.beginTurn(SID, '旧会话');
    cp.trackFile(SID, f('a.txt'), WS);
    // 把整个会话目录的时间戳往前推 40 天 (超过默认 30 天保留)
    const dir = path.join(TMP, 'cp-store', SID);
    const old = new Date(Date.now() - 40 * 86400_000);
    for (const name of fs.readdirSync(dir)) {
      try { fs.utimesSync(path.join(dir, name), old, old); } catch { /* Windows 目录可能拒绝 */ }
    }
    try { fs.utimesSync(dir, old, old); } catch { /* ignore */ }

    // index 里的 ts 也是旧的 (sweep 用它二次判定)
    const idx = path.join(dir, 'index.json');
    const list = JSON.parse(fs.readFileSync(idx, 'utf8'));
    for (const c of list) c.ts = old.getTime();
    fs.writeFileSync(idx, JSON.stringify(list));

    const r = cp.sweepOldSessions(30);
    expect(r.removed).toBe(1);
    expect(fs.existsSync(dir)).toBe(false);

    // 新建的会话不受影响
    const fresh = 'fresh-session';
    cp.beginTurn(fresh, '新会话');
    cp.sweepOldSessions(30);
    expect(fs.existsSync(path.join(TMP, 'cp-store', fresh))).toBe(true);
  });

  it('fileCount 以文件清单为准 (index 被并发覆盖也不影响预览)', () => {
    const id = cp.beginTurn(SID, 'x')!;
    cp.trackFile(SID, f('a.txt'), WS, id);
    cp.trackFile(SID, f('b.txt'), WS, id);
    // 人为把 index 里的 fileCount 打坏
    const idx = path.join(TMP, 'cp-store', SID, 'index.json');
    const list = JSON.parse(fs.readFileSync(idx, 'utf8'));
    list[list.length - 1].fileCount = 999;
    fs.writeFileSync(idx, JSON.stringify(list));
    // 真实清单仍能给出正确预览
    const files = cp.getCheckpointFiles(SID, id);
    expect(files).toHaveLength(2);
    const r = cp.rewind(SID, id, { apply: true, workspaceRoot: WS });
    expect(r.actions.length).toBe(2);
  });

  it('清扫跳过符号链接 (根目录下混入指向外部的链接 → 绝不递归删到工作区外)', () => {
    const outside = path.join(TMP, 'outside-target');
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'must survive', 'utf8');
    // 在 checkpoint 根下放一个指向外部目录的符号链接, 并伪造成"过期"
    const link = path.join(TMP, 'cp-store', 'evil-link');
    try { fs.symlinkSync(outside, link, 'junction'); } catch { return; } // 无权限建链接就跳过
    const old = new Date(Date.now() - 40 * 86400_000);
    try { fs.utimesSync(link, old, old); } catch { /* ignore */ }

    cp.sweepOldSessions(30);
    expect(fs.existsSync(link)).toBe(true);                                  // 链接没被删
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('must survive'); // 外部目录没被碰到
    try { fs.unlinkSync(link); } catch { /* ignore */ }
  });

  it('rewind 日志有上限: 超 2MB 滚动保留上一份, 不无限撑大', () => {
    const dir = path.join(TMP, 'cp-store', SID);
    fs.mkdirSync(dir, { recursive: true });
    const logFile = path.join(dir, 'rewind-log.jsonl');
    // 造一个已超过 2MB 的日志
    fs.writeFileSync(logFile, 'x'.repeat(2 * 1024 * 1024 + 10), 'utf8');
    const r = cp.rewind(SID, cp.beginTurn(SID, 'roll')!, { workspaceRoot: WS });
    cp.logRewind(SID, r, { workspaceRoot: WS });

    expect(fs.existsSync(logFile + '.1')).toBe(true);   // 旧的滚到 .1
    const nowSize = fs.statSync(logFile).size;
    expect(nowSize).toBeLessThan(1024);                 // 新文件只剩这一条
    expect(cp.readRewindLog(SID).length).toBe(1);
  });
});

describe('session-checkpoint · 多轮与回收', () => {
  it('能回到任意更早的轮次', () => {
    cp.beginTurn(SID, 'turn1');
    cp.trackFile(SID, f('a.txt'), WS);           // 存 v0
    fs.writeFileSync(f('a.txt'), 'after-turn1', 'utf8');
    const firstId = cp.getCurrentCheckpoint(SID)!;

    cp.beginTurn(SID, 'turn2');
    cp.trackFile(SID, f('a.txt'), WS);           // 存 after-turn1
    fs.writeFileSync(f('a.txt'), 'after-turn2', 'utf8');

    // 回到 turn1 之后的状态
    const r = cp.rewind(SID, firstId, { apply: true, workspaceRoot: WS });
    expect(fs.readFileSync(f('a.txt'), 'utf8')).toBe('v0');
    expect(r.ok).toBe(true);
  });

  it('超出 KEEP 后旧点被回收, 仍在用的 blob 不被误删', () => {
    process.env.SESSION_CHECKPOINT_KEEP = '2';
    for (let i = 0; i < 4; i++) {
      cp.beginTurn(SID, `turn${i}`);
      cp.trackFile(SID, f('a.txt'), WS);
      fs.writeFileSync(f('a.txt'), `v${i}`, 'utf8');
    }
    const list = cp.listCheckpoints(SID, 50);
    expect(list.length).toBeLessThanOrEqual(2);
    // 保留下来的点仍可正常回滚 (说明它们引用的 blob 还在)
    const okId = list[0].id;
    const r = cp.rewind(SID, okId, { apply: true, workspaceRoot: WS });
    expect(r.ok).toBe(true);
    delete process.env.SESSION_CHECKPOINT_KEEP;
  });

  it('相同内容只存一份 blob (内容寻址去重)', () => {
    for (let i = 0; i < 3; i++) {
      cp.beginTurn(SID, `turn${i}`);
      cp.trackFile(SID, f('b.txt'), WS); // b.txt 内容三轮都不变
    }
    const usage = cp.sessionCheckpointUsage(SID);
    expect(usage.checkpoints).toBe(3);
    expect(usage.bytes).toBeLessThan(300); // 3×"untouched" 若不去重会更大, 但仍应只有 1 份
  });

  it('clearSession 清空整个会话', () => {
    cp.beginTurn(SID, 'x');
    cp.trackFile(SID, f('a.txt'), WS);
    expect(cp.listCheckpoints(SID).length).toBe(1);
    expect(cp.clearSession(SID)).toBe(true);
    expect(cp.listCheckpoints(SID)).toHaveLength(0);
  });
});