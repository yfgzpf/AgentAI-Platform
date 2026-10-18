/**
 * session-checkpoint.ts — 会话级 checkpoint / rewind (2026-10-16)
 * =================================================================
 * 补上 agentai-platform 缺失的「会话内撤销」能力 (docs/GIT_CAPABILITY_RESEARCH.md 缺口 B)。
 *
 * 机制对齐 Claude Code 官方 checkpointing (code.claude.com/docs/en/checkpointing):
 *   1. checkpoint = **一个用户 turn 的起点** (对话位置 + 该轮改动前的文件副本)
 *   2. 改文件前存 pre-edit 副本 (Claude 存 ~/.claude/file-history/, 我们存 blobs/)
 *   3. rewind 三选项: 只回滚代码 / 只回滚对话 / 两者 (对话由 GUI/调用方处理, 本模块管代码)
 *
 * 与本项目既有机制的关系 (三者互补, 不重复):
 *   - discipline/gates.ts createAnchor()  → commit 粒度回滚 (跨会话永久)
 *   - task-snapshot.ts                     → 任务**进度**恢复 (不回滚代码)
 *   - 本模块                               → 回合粒度**代码**回滚 (会话内, 秒级)
 *
 * ⚠️ 已知边界 (与 Claude 官方一致, 提前绕, 别假装没有):
 *   - bash 命令改的文件 (run_command 跑 rm/mv/sed -i/格式化器) **不跟踪** → 那些必须靠 git
 *   - subagent 在自己进程里改的文件默认不跟踪 (除非它显式带 sessionId 走本模块)
 *   - 符号链接/硬链接路径一律跳过 (防回滚顺着链接写到工作区外)
 *
 * 安全红线 (不可放宽):
 *   1. **只回滚本 checkpoint 跟踪过的文件** — 绝不扫描/猜测目录, 绝不 git reset
 *   2. 写回前重新 lstat: 若路径此刻已变成符号链接 → 跳过 (TOCTOU 防护)
 *   3. 路径必须仍在原工作区内 → 否则跳过 (防止跨工作区误写)
 *   4. 默认 dryRun: 调用方必须显式 apply:true 才真写盘
 *
 * 存储:
 *   ~/.agentai/checkpoints/{sessionId}/
 *     index.json          Checkpoint[] (滚动保留最近 100 个, 标 current)
 *     {cpId}.json         该 cp 跟踪的文件清单 [{path, blob, existed, size}]
 *     blobs/{sha1}.bak    内容寻址备份 (同一内容多 cp 共享一份, 自动去重)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { resolveAgentAiHome } from './workspace-manager.js';

// ===== 类型 =====

export interface Checkpoint {
  id: string;
  sessionId: string;
  ts: number;
  /** 该轮用户输入的摘要 (rewind 菜单里显示, 代替裸时间戳) */
  label: string;
  /** 该轮跟踪到的文件数 (0 = 这轮没改文件, rewind 只有对话选项) */
  fileCount: number;
  /** 是否为当前轮 */
  current?: boolean;
}

interface TrackedFile {
  /** 绝对路径 */
  path: string;
  /** 内容寻址备份文件名 (existed=false 时为 null) */
  blob: string | null;
  /** 跟踪时该文件是否存在 (false = 这是 AI 新建的文件, rewind 时应删除) */
  existed: boolean;
  size: number;
}

export interface RewindAction {
  path: string;
  action: 'restore' | 'delete' | 'unchanged' | 'skip';
  reason?: string;
}

export interface RewindResult {
  ok: boolean;
  dryRun: boolean;
  checkpointId: string;
  actions: RewindAction[];
  restored: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  error?: string;
}

// ===== 配置 =====

/**
 * 默认根目录走统一解析（认 AGENTAI_HOME）。
 * 2026-10-16: 原为 `path.join(os.homedir(), '.agentai', 'checkpoints')` 硬编码，
 * 导致桌面版 checkpoint 落在 %USERPROFILE% 而非 Tauri 传入的 AGENTAI_HOME，
 * Docker 里也落在未挂持久卷的目录 → 容器重建即丢。
 */
const DEFAULT_ROOT = path.join(resolveAgentAiHome(), 'checkpoints');
/** 保留最近多少个 checkpoint (对齐 Claude 的 100) */
const KEEP_DEFAULT = 100;
/** 单文件备份上限 — 超过不跟踪 (防误跟踪巨型文件/数据库文件) */
const MAX_BLOB_BYTES = 8 * 1024 * 1024;
/** prompt 摘要长度 */
const LABEL_MAX = 100;

function enabled(): boolean {
  return (process.env.SESSION_CHECKPOINT_ENABLED || 'true').toLowerCase() !== 'false';
}

/** 每次调用都读 env (而非模块加载时求值): 测试可指向临时目录, 生产可整体迁移 */
function root(): string {
  return process.env.AGENTAI_CHECKPOINT_ROOT || DEFAULT_ROOT;
}

function sessionDir(sessionId: string): string {
  // sessionId 来自外部 → 只允许安全字符, 防目录穿越
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return path.join(root(), safe);
}

function indexFile(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'index.json');
}

function cpFile(sessionId: string, cpId: string): string {
  return path.join(sessionDir(sessionId), `${cpId}.json`);
}

function blobDir(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'blobs');
}

function ensureDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ===== index 读写 (损坏按空, 不阻断主流程) =====

function readIndex(sessionId: string): Checkpoint[] {
  try {
    const f = indexFile(sessionId);
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeIndex(sessionId: string, list: Checkpoint[]): void {
  try {
    if (!ensureDir(sessionDir(sessionId))) return;
    fs.writeFileSync(indexFile(sessionId), JSON.stringify(list, null, 2), 'utf8');
  } catch {
    /* 索引写失败不该阻断工具调用 */
  }
}

function readTracked(sessionId: string, cpId: string): TrackedFile[] {
  try {
    const f = cpFile(sessionId, cpId);
    if (!fs.existsSync(f)) return [];
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeTracked(sessionId: string, cpId: string, files: TrackedFile[]): void {
  try {
    ensureDir(sessionDir(sessionId));
    fs.writeFileSync(cpFile(sessionId, cpId), JSON.stringify(files, null, 2), 'utf8');
  } catch {
    /* 同上 */
  }
}

// ===== 内容寻址 blob =====

function sha1(buf: Buffer | string): string {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function storeBlob(sessionId: string, content: Buffer): string | null {
  const hash = sha1(content);
  const dir = blobDir(sessionId);
  const f = path.join(dir, `${hash}.bak`);
  try {
    if (!fs.existsSync(f)) {
      if (!ensureDir(dir)) return null;
      // 先写临时文件再改名, 避免半截文件被 rewind 读成坏内容
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, f);
    }
    return `${hash}.bak`;
  } catch {
    return null;
  }
}

function readBlob(sessionId: string, blob: string): Buffer | null {
  try {
    const f = path.join(blobDir(sessionId), path.basename(blob));
    if (!fs.existsSync(f)) return null;
    return fs.readFileSync(f);
  } catch {
    return null;
  }
}

/** 路径是否落在 root 之内 (防越界写)。
 *  ⚠️ Windows 上必须大小写不敏感: track 时用 opts.workspace, rewind 时用 HTTP 端点解析出的
 *  workspace, 两者可能只有盘符大小写不同 (`f:\x` vs `F:\x`) → 大小写敏感比较会让
 *  rewind 把所有文件判成"已移出工作区"而**静默跳过**, 用户看到"跳过 N 个"却不知为何。 */
function insideRoot(root: string, target: string): boolean {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const eq = process.platform === 'win32' ? (a: string, b: string) => a.toLowerCase() === b.toLowerCase() : (a: string, b: string) => a === b;
  if (eq(r, t)) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  if (process.platform === 'win32') return t.toLowerCase().startsWith(prefix.toLowerCase());
  return t.startsWith(prefix);
}

// ===== 公开 API =====

/**
 * 开一个新回合 → 建 checkpoint。
 * @param promptExcerpt 该轮用户输入 (取前 100 字当标签)
 * @returns checkpoint id; 未启用/失败返回 null (调用方照常跑, 只是没撤销点)
 */
export function beginTurn(sessionId: string, promptExcerpt?: string): string | null {
  if (!enabled() || !sessionId) return null;
  const dir = sessionDir(sessionId);
  if (!ensureDir(dir)) return null;

  const id = `cp-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const label = String(promptExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);

  const list: Checkpoint[] = readIndex(sessionId).map(c => ({ ...c, current: false }));
  const cp: Checkpoint = { id, sessionId, ts: Date.now(), label, fileCount: 0, current: true };
  list.push(cp);
  writeTracked(sessionId, id, []);
  // 滚动保留: 超额丢最老的 (含其文件清单; blob 由 pruneSession 统一回收)
  const keep = Number(process.env.SESSION_CHECKPOINT_KEEP || KEEP_DEFAULT);
  const trimmed = list.length > keep ? list.slice(list.length - keep) : list;
  writeIndex(sessionId, trimmed);
  if (list.length > keep) pruneSession(sessionId, keep);
  return id;
}

/** 取当前回合的 checkpoint id (工具层 track 用, 免得层层传参) */
export function getCurrentCheckpoint(sessionId: string): string | null {
  const list = readIndex(sessionId);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].current) return list[i].id;
  }
  return null;
}

/**
 * 文件改动**前**调用: 存 pre-edit 副本。
 * 同一 checkpoint 内同一文件只存首份 (first write wins) —— 这正是 rewind 需要的语义:
 * 要回到的是「这一轮开始前」的样子, 不是「上一次编辑前」。
 *
 * ⚠️ cpId 必须由调用方显式传 (loop 用**自己**的 run() 返回值)。绝不能只靠 index 里的
 * `current` 标记: 同一会话并发两条消息时 (SSE 未断就再发 / 前端重试), 后到的 beginTurn
 * 会抢走 current, 先到的那个 loop 再调 trackFile 就把文件挂到了**别人的** checkpoint 上 ——
 * 结果是 rewind 那个点变成空操作, 代码改坏了却退不回来 (已复现)。实例级 cpId 免疫此问题。
 *
 * @returns true=已跟踪, false=未跟踪 (超限/符号链接/无当前轮/越界)
 */
export function trackFile(sessionId: string, absPath: string, workspaceRoot: string, cpId?: string): boolean {
  if (!enabled() || !sessionId || !absPath) return false;
  const id = cpId || getCurrentCheckpoint(sessionId);
  if (!id) return false;

  const target = path.resolve(absPath);
  // 安全: 只跟踪工作区内的路径 (AI 可能传绝对路径到工作区外)
  if (!insideRoot(workspaceRoot, target)) return false;

  const tracked = readTracked(sessionId, id);
  if (tracked.some(t => t.path === target)) return false; // 已存首份

  let existed = true;
  let blob: string | null = null;
  let size = 0;
  try {
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) return false;      // 符号链接: 不跟踪 (防穿透)
    if (!st.isFile()) return false;             // 目录/设备/套接字: 不跟踪
    size = st.size;
    if (size > MAX_BLOB_BYTES) return false;    // 巨型文件: 不跟踪 (省磁盘)
    blob = storeBlob(sessionId, fs.readFileSync(target));
    if (!blob) return false;
  } catch {
    // 文件不存在 = AI 要新建 → 记 existed:false, rewind 时删掉它
    existed = false;
  }

  tracked.push({ path: target, blob, existed, size });
  writeTracked(sessionId, id, tracked);

  // fileCount 直接从文件清单算 (index 只是缓存) —— 并发下 index 可能被别人覆盖,
  // 但 {cpId}.json 是这个点私有的, 不会被并发串台。
  const list = readIndex(sessionId);
  const cp = list.find(c => c.id === id);
  if (cp && cp.fileCount !== tracked.length) {
    cp.fileCount = tracked.length;
    writeIndex(sessionId, list);
  }
  return true;
}

/** 列 checkpoint (最新在前) */
export function listCheckpoints(sessionId: string, limit = 50): Checkpoint[] {
  const list = readIndex(sessionId);
  return list.slice().reverse().slice(0, Math.max(1, Math.min(limit, 200)));
}

/**
 * 该 checkpoint 跟踪了哪些文件 (rewind 前给用户看"会动哪些文件")。
 * 只暴露判断所需字段 —— blob 路径是内部实现, 不外泄。
 */
export function getCheckpointFiles(sessionId: string, cpId: string): Array<{ path: string; existed: boolean; size: number }> {
  return readTracked(sessionId, cpId).map(t => ({ path: t.path, existed: t.existed, size: t.size }));
}

/**
 * 回滚到某个 checkpoint 时刻的文件状态。
 * @param apply false (默认) = 只算计划不动盘; true = 真写
 * @param workspaceRoot 二次校验: 跟踪时在工作区内、现在也得在
 */
export function rewind(sessionId: string, cpId: string, opts: { apply?: boolean; workspaceRoot: string }): RewindResult {
  const dryRun = opts.apply !== true;
  const base: RewindResult = {
    ok: false, dryRun, checkpointId: cpId, actions: [],
    restored: 0, deleted: 0, unchanged: 0, skipped: 0,
  };
  if (!sessionId || !cpId) return { ...base, error: 'sessionId/cpId 必填' };

  const tracked = readTracked(sessionId, cpId);
  if (tracked.length === 0) {
    return { ...base, ok: true, error: undefined, actions: [] };
  }

  for (const t of tracked) {
    // 安全闸 ①: 路径必须仍在原工作区内
    if (!insideRoot(opts.workspaceRoot, t.path)) {
      base.actions.push({ path: t.path, action: 'skip', reason: '已移出工作区, 拒绝写回' });
      base.skipped++;
      continue;
    }

    // 现状判定 (注意用 lstat: 现在的路径可能已被换成符号链接)
    let curExists = false;
    let curIsLink = false;
    let curSize = -1;
    try {
      const st = fs.lstatSync(t.path);
      curIsLink = st.isSymbolicLink();
      curExists = st.isFile();
      curSize = st.size;
    } catch { /* 不存在 */ }

    // 安全闸 ②: TOCTOU — 此刻是链接就绝不写 (跟踪时检查过不够, 中间可能被人换了)
    if (curIsLink) {
      base.actions.push({ path: t.path, action: 'skip', reason: '当前路径是符号链接, 拒绝写回 (防越界)' });
      base.skipped++;
      continue;
    }

    if (!t.existed) {
      // 本轮新建的文件 → rewind 应该删掉
      if (!curExists) { base.actions.push({ path: t.path, action: 'unchanged' }); base.unchanged++; continue; }
      base.actions.push({ path: t.path, action: 'delete' });
      base.deleted++;
      if (!dryRun) { try { fs.unlinkSync(t.path); } catch (e: any) { base.actions[base.actions.length - 1] = { path: t.path, action: 'skip', reason: `删除失败: ${e.message}` }; base.deleted--; base.skipped++; } }
      continue;
    }

    // 原本存在 → 写回原内容
    const content = readBlob(sessionId, t.blob || '');
    if (!content) {
      base.actions.push({ path: t.path, action: 'skip', reason: '备份内容已丢失' });
      base.skipped++;
      continue;
    }
    if (curExists && curSize === content.length && t.size === content.length) {
      // 尺寸一致只说明"可能"没变; 仍需比对内容才敢跳过 (文件不大, 直接读)
      let same = false;
      try { same = sha1(fs.readFileSync(t.path)) === sha1(content); } catch { same = false; }
      if (same) { base.actions.push({ path: t.path, action: 'unchanged' }); base.unchanged++; continue; }
    }
    base.actions.push({ path: t.path, action: 'restore' });
    base.restored++;
    if (!dryRun) {
      try {
        ensureDir(path.dirname(t.path));
        const tmp = `${t.path}.${process.pid}.rewind.tmp`;
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, t.path);
      } catch (e: any) {
        base.actions[base.actions.length - 1] = { path: t.path, action: 'skip', reason: `写回失败: ${e.message}` };
        base.restored--;
        base.skipped++;
      }
    }
  }

  return { ...base, ok: true };
}

/** 回收: 保留最近 keep 个 checkpoint, 其余文件清单删除; blob 被保留者引用则留, 否则删 */
export function pruneSession(sessionId: string, keep = KEEP_DEFAULT): { droppedCheckpoints: number; droppedBlobs: number } {
  const list = readIndex(sessionId);
  if (list.length <= keep) return { droppedCheckpoints: 0, droppedBlobs: 0 };
  const drop = list.slice(0, list.length - keep);
  const keepList = list.slice(list.length - keep);

  const liveBlobs = new Set<string>();
  for (const c of keepList) {
    for (const t of readTracked(sessionId, c.id)) if (t.blob) liveBlobs.add(t.blob);
  }

  let droppedBlobs = 0;
  for (const c of drop) {
    for (const t of readTracked(sessionId, c.id)) {
      if (!t.blob || liveBlobs.has(t.blob)) continue;
      try { fs.unlinkSync(path.join(blobDir(sessionId), t.blob)); droppedBlobs++; } catch { /* 已不在 */ }
    }
    try { fs.unlinkSync(cpFile(sessionId, c.id)); } catch { /* 已不在 */ }
  }
  writeIndex(sessionId, keepList);
  return { droppedCheckpoints: drop.length, droppedBlobs };
}

/** 清空某会话的全部 checkpoint (用户显式要求删历史时) */
export function clearSession(sessionId: string): boolean {
  try {
    const dir = sessionDir(sessionId);
    if (!fs.existsSync(dir)) return true;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** 磁盘占用 (字节) — 供 /status 类端点展示 */
export function sessionCheckpointUsage(sessionId: string): { checkpoints: number; bytes: number } {
  const list = readIndex(sessionId);
  let bytes = 0;
  try {
    const bd = blobDir(sessionId);
    if (fs.existsSync(bd)) {
      for (const f of fs.readdirSync(bd)) {
        try { bytes += fs.statSync(path.join(bd, f)).size; } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
  return { checkpoints: list.length, bytes };
}

/**
 * 回滚留痕: rewind 会**覆盖磁盘上的代码**, 属破坏性操作, 必须可追溯。
 * 落 {sessionDir}/rewind-log.jsonl (append-only, 同 pentest 的 scope-audit 思路):
 * 谁在什么时候把哪个点回滚了、动了哪些文件 —— 事后能查"这行代码怎么变回去的"。
 */
export function logRewind(sessionId: string, r: RewindResult, opts: { workspaceRoot: string; actor?: string }): void {
  try {
    const dir = sessionDir(sessionId);
    if (!ensureDir(dir)) return;
    const entry = {
      ts: new Date().toISOString(),
      actor: opts.actor || 'human',
      action: r.dryRun ? 'rewind-preview' : 'rewind-apply',
      checkpointId: r.checkpointId,
      workspace: opts.workspaceRoot,
      restored: r.restored,
      deleted: r.deleted,
      unchanged: r.unchanged,
      skipped: r.skipped,
      files: r.actions.filter(a => a.action === 'restore' || a.action === 'delete').map(a => ({ path: a.path, action: a.action })),
      skipReasons: r.actions.filter(a => a.action === 'skip').map(a => ({ path: a.path, reason: a.reason })),
    };
    // append-only 但要有上限: 一次长会话里反复 preview 会把日志撑爆。
    // 超过 2MB 就滚动改名 (保留 .1 上一份), 审计看最近的就够, 真要追溯再翻。
    const logFile = path.join(dir, 'rewind-log.jsonl');
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
        try { fs.rmSync(logFile + '.1', { force: true }); } catch { /* 忽略 */ }
        fs.renameSync(logFile, logFile + '.1');
      }
    } catch { /* 滚动失败就继续追加 */ }
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch { /* 留痕失败不阻断回滚 (回滚本身才是用户要的结果) */ }
}

/** 读回滚留痕 (审计端点用) */
export function readRewindLog(sessionId: string, limit = 100): any[] {
  try {
    const f = path.join(sessionDir(sessionId), 'rewind-log.jsonl');
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-limit).reverse()
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 会话级存储生命周期清扫 (2026-10-16): 会话废弃后没人再管它的 blobs, 磁盘只涨不跌。
 * 按"整个会话目录最后修改时间"删过期会话 —— 比按单个 checkpoint ts 更粗但更安全
 * (正在用的会话目录 mtime 一定是新的)。
 * @param maxAgeDays 默认 30 天 (对齐 Claude Code 的 30 天保留)
 */
export function sweepOldSessions(maxAgeDays = Number(process.env.SESSION_CHECKPOINT_RETENTION_DAYS || 30)): { removed: number; freedBytes: number } {
  const base = root();
  let removed = 0, freedBytes = 0;
  try {
    if (!fs.existsSync(base)) return { removed, freedBytes };
    const cutoff = Date.now() - Math.max(1, maxAgeDays) * 86400_000;
    for (const name of fs.readdirSync(base)) {
      const dir = path.join(base, name);
      try {
        // 用 lstat 而非 stat: 根目录下若混入指向工作区外的符号链接, stat 会跟随并把它算成
        // "过期目录" → 递归删到工作区外面去。只认真目录, 链接一律跳过。
        const st = fs.lstatSync(dir);
        if (!st.isDirectory() || st.isSymbolicLink()) continue;
        if (st.mtimeMs > cutoff) continue;      // 最近还动过 → 可能在用
        // 目录里最新的 checkpoint 也老 → 彻底没人管了
        const list = readIndex(name);
        const newest = list.length ? Math.max(...list.map(c => c.ts)) : st.mtimeMs;
        if (newest > cutoff) continue;
        let bytes = 0;
        const bd = blobDir(name);
        if (fs.existsSync(bd)) for (const f of fs.readdirSync(bd)) {
          try { bytes += fs.statSync(path.join(bd, f)).size; } catch { /* 忽略 */ }
        }
        fs.rmSync(dir, { recursive: true, force: true });
        removed++; freedBytes += bytes;
      } catch { /* 单个会话删不掉就跳过, 不能影响其他 */ }
    }
  } catch { /* 忽略 */ }
  return { removed, freedBytes };
}

/** 单定时器版清扫 (挂进既有清理循环, 不另起进程/定时器) */
export function sweepOldSessionsOnce(maxAgeDays?: number): void {
  const r = sweepOldSessions(maxAgeDays);
  if (r.removed > 0) {
    console.log(`[session-checkpoint] 清扫过期会话: ${r.removed} 个, 释放 ${(r.freedBytes / 1024 / 1024).toFixed(1)}MB`);
  }
}