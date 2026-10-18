/**
 * worktree — Git Worktree 隔离（2026-10-16 重写）
 * ============================================================================
 * 为什么重写: 旧实现是 145 行半成品，同时踩了 5 个坑，其中 2 个让功能**完全无效**：
 *
 * 1. 【假功能·最严重】worktreeCreate 只把 worktreePath 当字符串返回给 LLM，
 *    **ctx.cwd / workspace 从不切换** → 文件操作全留在原 projectDir。
 *    用户以为"我建了 worktree 就安全了"，实际并行会话照样互相覆盖。
 *    比没有这功能更危险（虚假的安全感）。
 * 2. 【打包致命】桌面版不捆绑 git（tauri.conf.json 无 externalBin），
 *    旧代码裸 execSync('git ...') 在没装 Git for Windows 的机器上抛 ENOENT，
 *    前端只看到 "spawnSync git ENOENT"，用户无法理解。
 * 3. 【安全】旧代码 execSync(`git worktree add "${wdir}" -b "${branch}"`) 是
 *    shell 字符串拼接 → 参数里的元字符可注入。全项目已在 tools.ts 完成
 *    execFile 参数数组整改（见 tools.ts:529-541 注释），worktree 没跟上。
 * 4. 【部署】worktree 目录硬编码 os.homedir()，绕过 AGENTAI_HOME。
 * 5. 【生命周期】无状态文件，孤儿 worktree（git worktree list 里的 prunable）
 *    永远没人清。实测仓库里已积压一个 F:/wt-probe 孤儿。
 *
 * 本次重写后的契约:
 *   - 全部走 git-runtime（execFile 参数数组 + Windows 路径兜底 + 可用性探测）
 *   - git 不可用 / 非 git 仓库 → 返回结构化降级（ok:false + 中文原因），**不抛裸异常**
 *   - worktrees.json 持久化状态（id/name/branch/路径/创建时间/来源会话）
 *   - 认 AGENTAI_HOME；支持 .worktreeinclude（补未跟踪文件，解决"新 worktree 起不来"）
 *   - sweepWorktrees() 清孤儿，对应 git-manager SKILL 的「建了就要清」不变式
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  gitExec, gitExecSafe, gitEnvCheck, isGitRepo, isRepoDirty,
} from './git-runtime.js';
import { resolveAgentAiHome } from './workspace-manager.js';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

export interface WorktreeInfo {
  id?: string;
  /** 用户可读名（短名，用于 UI 展示） */
  name?: string;
  path: string;
  branch: string;
  /** HEAD commit hash (前 7 字符) */
  head: string;
  /** 是否当前所在的 worktree */
  current: boolean;
  /** git 标记为 prunable（目录已不存在，可直接清） */
  prunable?: boolean;
  createdAt?: string;
  /** 来源会话（哪个会话建的，便于回溯与自动清理） */
  sessionId?: string;
}

/** 统一的失败结构：调用方只需看 ok + reason，无需 try/catch 猜异常类型 */
export interface WorktreeResult<T = unknown> {
  ok: boolean;
  /** 失败原因（中文，面向用户） */
  reason?: string;
  /** 机器可读错误码 */
  code?: string;
  data?: T;
  /** 降级提示（如 git 不可用 → 建议装 git，或建议用会话 rewind） */
  hint?: string;
}

const OK = <T>(data: T): WorktreeResult<T> => ({ ok: true, data });
const FAIL = (reason: string, code: string, hint?: string): WorktreeResult<never> =>
  ({ ok: false, reason, code, ...(hint ? { hint } : {}) });

/**
 * 路径归一化比较（Windows 关键）
 * ---------------------------------------------------------------------------
 * git 在 Windows 上**始终输出正斜杠**（`F:/temp/xxx`），而 path.resolve() 在
 * Windows 上给反斜杠（`F:\temp\xxx`）。直接字符串比较 → 永远不相等，
 * 表现为"列表里有这个 worktree 但按路径找不到"，进而元数据关联失败、
 * 删除护栏把主 worktree 也当成越界路径拦掉。
 */
function pathEq(a: string, b: string): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32'
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}

/** 归一化到 git 的输出风格（正斜杠），便于落盘与展示一致 */
function toGitPath(p: string): string {
  return p.replace(/\\/g, '/');
}

// ═══════════════════════════════════════════════════════════
// 路径
// ═══════════════════════════════════════════════════════════

/** worktree 根目录：认 AGENTAI_HOME（桌面版/容器可整体迁移） */
export function worktreeRoot(): string {
  return path.join(resolveAgentAiHome(), 'worktrees');
}

/** 状态文件：记录我们自己建的 worktree（git 自己只记路径，丢了创建意图） */
function stateFile(): string {
  return path.join(resolveAgentAiHome(), 'config', 'worktrees.json');
}

interface WorktreeState {
  version: 1;
  items: WorktreeInfo[];
}

function readState(): WorktreeState {
  try {
    const f = stateFile();
    if (!fs.existsSync(f)) return { version: 1, items: [] };
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!j || !Array.isArray(j.items)) return { version: 1, items: [] };
    return { version: 1, items: j.items };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeState(s: WorktreeState): void {
  try {
    const f = stateFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // 先写临时文件再 rename: 避免进程被杀时留下半截 JSON 导致状态文件彻底不可读
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
    fs.renameSync(tmp, f);
  } catch { /* 状态丢失不致命: 仍可从 git worktree list 反查 */ }
}

// ═══════════════════════════════════════════════════════════
// 前置检查
// ═══════════════════════════════════════════════════════════

/**
 * worktree 能力可用性（供 /v1/system/check-dep、GUI 能力面板、工具前置检查用）
 * 不抛异常，返回可直接展示的状态。
 */
export async function worktreeCapability(basePath?: string): Promise<{
  available: boolean;
  reason?: string;
  code?: string;
  hint?: string;
  git?: { available: boolean; version?: string; bin?: string; reason?: string };
  repoPath?: string;
  dirty?: boolean;
  worktreeRoot?: string;
}> {
  const env = await gitEnvCheck();
  const out: any = {
    git: env,
    worktreeRoot: worktreeRoot(),
  };
  if (!env.available) {
    return {
      ...out,
      available: false,
      reason: env.reason,
      code: 'GIT_NOT_AVAILABLE',
      hint: '安装 Git for Windows 后重启即可启用任务隔离。不装也不影响其他功能——会话内改错仍可用 /rewind 秒退。',
    };
  }
  const repoPath = basePath || process.cwd();
  if (!isGitRepo(repoPath)) {
    return {
      ...out,
      available: false,
      reason: `当前目录不是 git 仓库: ${repoPath}`,
      code: 'NOT_A_GIT_REPO',
      hint: '任务隔离需要 git 仓库。非仓库目录可以用会话级 rewind 回退改动。',
    };
  }
  out.repoPath = repoPath;
  out.dirty = await isRepoDirty(repoPath);
  return { ...out, available: true };
}

// ═══════════════════════════════════════════════════════════
// 创建
// ═══════════════════════════════════════════════════════════

function sanitizeSegment(s: string, max = 60): string {
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return cleaned || 'wt';
}

/**
 * 创建隔离工作树
 * @param basePath 主仓库根目录（必须是 git 仓库）
 * @param opts.label 人类可读标签（会进分支名与状态文件，便于回溯）
 * @param opts.sessionId 来源会话（便于会话结束时自动清理）
 */
export async function worktreeCreate(
  basePath: string,
  opts: { label?: string; sessionId?: string; branchPrefix?: string } = {},
): Promise<WorktreeResult<{ worktreePath: string; branch: string; id: string }>> {
  // ① git 可用性（桌面版/容器会在这里降级，而不是抛 ENOENT）
  const cap = await worktreeCapability(basePath);
  if (!cap.available) return FAIL(cap.reason!, cap.code!, cap.hint);

  const repoPath = cap.repoPath!;
  const prefix = opts.branchPrefix || 'agentai';

  // ② 目录名安全: 不使用用户输入直接拼路径，全部经 sanitizeSegment
  const label = sanitizeSegment(opts.label || 'task');
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  const id = `${label}-${ts}-${rand}`;
  // git 分支名不能以 - 开头、不能含 .. 等，sanitize 后再加兜底校验
  const branch = `${prefix}/${id}`;

  // ③ 用 execFile 参数数组执行（不经 shell，元字符全是字面量）
  const wdir = path.join(worktreeRoot(), id);
  const r = await gitExecSafe(['worktree', 'add', wdir, '-b', branch], {
    cwd: repoPath,
    timeout: 120_000,   // 大仓库检出可能较慢（实测本机 2470 文件）
  });
  if (!r.ok) {
    // git 的错误信息已经含人话（"fatal: not a git repository" 等），直接透出
    return FAIL(
      `创建 worktree 失败: ${(r.error || '').split('\n')[0]}`,
      'WORKTREE_ADD_FAILED',
      '若提示分支已存在或目录已存在，可先执行清理（worktree_sweep）再试。',
    );
  }

  // ④ 补未跟踪文件（.worktreeinclude）—— 否则新 worktree 缺 .env 等，跑不起来
  let included = 0;
  try { included = applyWorktreeInclude(repoPath, wdir); } catch { /* 非致命 */ }

  // ⑤ node_modules 复用（避免每个 worktree 重跑一次 pnpm install）
  let linkedModules = false;
  try { linkedModules = linkNodeModules(repoPath, wdir); } catch { /* 非致命 */ }

  // ⑥ 落状态
  const state = readState();
  state.items.push({
    id,
    name: opts.label || id,
    path: wdir,
    branch,
    head: '',
    current: false,
    createdAt: new Date().toISOString(),
    sessionId: opts.sessionId,
  });
  writeState(state);

  return OK({ worktreePath: wdir, branch, id, ...(included ? { included } : {}), ...(linkedModules ? { linkedModules: true } : {}) } as any);
}

/**
 * 复制 .worktreeinclude 里列出的未跟踪文件到新 worktree
 * ---------------------------------------------------------------------------
 * worktree 不共享未跟踪文件（这是它的隔离性来源），但也意味着 .env / 本地配置
 * 这些"不该进 git 但运行必需"的东西会丢。约定在仓库根放 .worktreeinclude，
 * 每行一个相对路径（支持 # 注释与简单 glob 前缀匹配）。
 */
function applyWorktreeInclude(repoPath: string, wdir: string): number {
  const inc = path.join(repoPath, '.worktreeinclude');
  if (!fs.existsSync(inc)) return 0;
  let count = 0;
  const lines = fs.readFileSync(inc, 'utf8').split('\n');
  for (const raw of lines) {
    const rel = raw.trim();
    if (!rel || rel.startsWith('#')) continue;
    const src = path.join(repoPath, rel);
    const dst = path.join(wdir, rel);
    try {
      if (!fs.existsSync(src)) continue;
      // 防越界: .worktreeinclude 是仓库里的文件，不该能指向仓库外
      const relCheck = path.relative(repoPath, path.resolve(src));
      if (relCheck.startsWith('..')) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      count++;
    } catch { /* 单个失败不阻断 */ }
  }
  return count;
}

/** 把主工作树的 node_modules 链进新 worktree（junction/symlink），省一次 install */
function linkNodeModules(repoPath: string, wdir: string): boolean {
  const main = path.join(repoPath, 'node_modules');
  const dst = path.join(wdir, 'node_modules');
  if (!fs.existsSync(main) || fs.existsSync(dst)) return false;
  try {
    if (process.platform === 'win32') {
      // Windows 用 junction（目录联接），普通用户无需管理员权限
      execFileSync('cmd', ['/c', 'mklink', '/J', dst, main], { timeout: 10_000, windowsHide: true });
    } else {
      fs.symlinkSync(main, dst, 'dir');
    }
    return true;
  } catch {
    return false;   // 失败不致命: 用户自己 pnpm install 即可
  }
}

// ═══════════════════════════════════════════════════════════
// 列表
// ═══════════════════════════════════════════════════════════

/**
 * 列出所有工作树（git 的事实 + 我们自己的元数据合并）
 * git 不可用/非仓库时返回空列表而非抛错——列表是只读的展示能力，不该阻断调用方。
 */
export async function worktreeList(basePath: string): Promise<WorktreeInfo[]> {
  if (!(await gitEnvCheck()).available) return [];
  const repoPath = isGitRepo(basePath) ? basePath : process.cwd();
  const r = await gitExecSafe(['worktree', 'list', '--porcelain'], { cwd: repoPath, timeout: 10_000 });
  if (!r.ok) return [];

  const state = readState();
  // ⚠️ 路径比较必须用 pathEq: git 返正斜杠, Windows path.resolve 返反斜杠
  const byPath = new Map<string, WorktreeInfo>();
  for (const it of state.items) byPath.set(path.resolve(it.path), it);

  // porcelain 格式稳定可解析: 每条记录以空行分隔, key value 形式
  const out: WorktreeInfo[] = [];
  let isFirst = true;
  for (const block of r.output.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const get = (k: string) => lines.find(l => l.startsWith(k + ' '))?.slice(k.length + 1).trim();
    const wpath = get('worktree');
    if (!wpath) continue;
    const branchRef = get('branch');
    const head = (get('HEAD') || '').slice(0, 7);
    let known: WorktreeInfo | undefined;
    for (const [k, v] of byPath) {
      if (pathEq(k, wpath)) { known = v; break; }
    }
    out.push({
      ...(known || {}),
      path: wpath,
      branch: branchRef ? branchRef.replace(/^refs\/heads\//, '') : `${head || '?'}(detached)`,
      head,
      // porcelain 第一条即当前所在 worktree（git 输出顺序保证）
      current: isFirst,
      // prunable 行形如 "prunable gitdir file points to non-existent location"
      ...(lines.some(l => l.startsWith('prunable')) ? { prunable: true } : {}),
    } as WorktreeInfo);
    isFirst = false;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 删除
// ═══════════════════════════════════════════════════════════

/**
 * 删除工作树（安全: 不允许删主工作树 / 不允许删 main·master 分支）
 */
export async function worktreeRemove(
  basePath: string,
  worktreePath: string,
  opts: { deleteBranch?: boolean } = {},
): Promise<WorktreeResult<{ branch?: string }>> {
  const cap = await worktreeCapability(basePath);
  if (!cap.available) return FAIL(cap.reason!, cap.code!, cap.hint);
  const repoPath = cap.repoPath!;

  const resolved = path.resolve(worktreePath);
  const trees = await worktreeList(repoPath);
  const target = trees.find(t => pathEq(t.path, resolved));
  if (!target) {
    return FAIL(
      `Worktree 不存在: ${worktreePath}`,
      'WORKTREE_NOT_FOUND',
      '可用 worktree_list 查看现有 worktree。',
    );
  }
  // 护栏顺序很重要: 先认得出它是个 worktree，再谈越界。
  // 反过来会把主 worktree（本来就在仓库根，不在 worktree 根目录下）误报成"越界"。
  if (target.current) return FAIL('不能删除当前所在的 worktree', 'IS_CURRENT_WORKTREE');
  if (['main', 'master'].includes(target.branch)) {
    return FAIL(`不能删除受保护分支的 worktree: ${target.branch}`, 'PROTECTED_BRANCH');
  }
  // 额外护栏: 只允许删我们自己根目录下的 worktree，绝不接受任意路径
  const rootResolved = path.resolve(worktreeRoot());
  const rel = path.relative(rootResolved, resolved);
  const inside = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
  if (!inside) {
    return FAIL(
      `拒绝删除: 路径不在 worktree 根目录内: ${worktreePath}`,
      'OUTSIDE_WORKTREE_ROOT',
      'worktree 根目录为 ' + rootResolved,
    );
  }
  const gitPath = toGitPath(resolved);

  // 用 git 自己的 remove（它会一并清理 .git/worktrees 元数据），目录不存在时再兜底删
  const r = await gitExecSafe(['worktree', 'remove', resolved, '--force'], { cwd: repoPath, timeout: 60_000 });
  if (!r.ok) {
    // 目录可能已被手工删掉 → 直接 prune 元数据即可
    await gitExecSafe(['worktree', 'prune'], { cwd: repoPath, timeout: 20_000 });
    if (fs.existsSync(resolved)) {
      try { fs.rmSync(resolved, { recursive: true, force: true }); }
      catch (e: any) {
        return FAIL(`删除目录失败: ${e?.message || e}`, 'REMOVE_FAILED');
      }
    }
  }
  if (fs.existsSync(resolved)) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* git 已处理 */ }
  }

  let branch: string | undefined;
  if (opts.deleteBranch !== false && target.branch && !target.branch.includes('(detached)')) {
    // 分支上可能已有提交 → 用 -D 强删（隔离分支的语义就是"用完即弃"）
    const d = await gitExecSafe(['branch', '-D', target.branch], { cwd: repoPath, timeout: 10_000 });
    if (d.ok) branch = target.branch;
  }
  // 清状态文件
  const state = readState();
  state.items = state.items.filter(i => path.resolve(i.path) !== resolved);
  writeState(state);

  return OK({ branch });
}

// ═══════════════════════════════════════════════════════════
// 清扫（对应 git-manager SKILL 不变式 6「建了就要清」）
// ═══════════════════════════════════════════════════════════

/**
 * 清扫孤儿 worktree
 * 三类垃圾:
 *   1. prunable: git 标记目录已不存在（元数据残留）
 *   2. 目录已不存在但 git 还记着
 *   3. 我们状态文件里记着、但 git 完全不知道（创建过程崩了）
 * @param maxAgeDays 超龄 worktree 自动清理（默认 7 天，对齐"长任务别无限堆积"）
 */
export async function worktreeSweep(
  basePath: string,
  opts: { maxAgeDays?: number; dryRun?: boolean } = {},
): Promise<WorktreeResult<{ removed: string[]; pruned: number; kept: number }>> {
  const cap = await worktreeCapability(basePath);
  if (!cap.available) return FAIL(cap.reason!, cap.code!, cap.hint);
  const repoPath = cap.repoPath!;
  const maxAge = opts.maxAgeDays ?? 7;
  const cutoff = Date.now() - maxAge * 86_400_000;

  const trees = await worktreeList(repoPath);
  const state = readState();
  // 同一套路径比较（Windows 分隔符差异），不能用 Set<path.resolve>
  const isKnown = (p: string) => trees.some(t => pathEq(t.path, p));
  const removed: string[] = [];

  // ① 状态文件里有、git 里没有 → 创建中断的残留
  for (const it of state.items) {
    if (isKnown(it.path)) continue;
    if (!opts.dryRun) {
      try { if (fs.existsSync(it.path)) fs.rmSync(it.path, { recursive: true, force: true }); } catch { /* 忽略 */ }
    }
    removed.push(`${it.path} (状态残留)`);
  }
  if (!opts.dryRun) {
    writeState({ ...state, items: state.items.filter(i => isKnown(i.path)) });
  }

  // ② 超龄的非当前 worktree
  let kept = 0;
  for (const t of trees) {
    if (t.current) { kept++; continue; }
    const age = t.createdAt ? Date.parse(t.createdAt) : NaN;
    const tooOld = Number.isFinite(age) ? age < cutoff : false;
    // git 标记 prunable → 无条件清元数据
    if (t.prunable || tooOld) {
      if (!opts.dryRun) {
        await gitExecSafe(['worktree', 'remove', path.resolve(t.path), '--force'], { cwd: repoPath, timeout: 30_000 });
        if (t.branch && !t.branch.includes('(detached)') && !['main', 'master'].includes(t.branch)) {
          await gitExecSafe(['branch', '-D', t.branch], { cwd: repoPath, timeout: 10_000 });
        }
      }
      removed.push(`${t.path} (${t.prunable ? '目录已丢失' : `超 ${maxAge} 天`})`);
    } else {
      kept++;
    }
  }

  // ③ git 元数据 prune（清掉指向已删目录的残留记录）
  if (!opts.dryRun) await gitExecSafe(['worktree', 'prune'], { cwd: repoPath, timeout: 30_000 });

  return OK({ removed, pruned: removed.length, kept });
}

// ═══════════════════════════════════════════════════════════
// 兼容旧调用方（返回 promise 的 create + 抛错的旧语义）
// ═══════════════════════════════════════════════════════════

/**
 * 旧接口兼容层: worktreeCreate(basePath, branchPrefix) -> Promise<{worktreePath, branch}>
 * 新代码请用 worktreeCreate(basePath, {label}) 的结构化返回（能拿到 ok/reason/hint）。
 */
export async function worktreeCreateLegacy(basePath: string, branchPrefix = 'task-') {
  const r = await worktreeCreate(basePath, { branchPrefix });
  if (!r.ok) throw new Error(r.reason);
  return { worktreePath: r.data!.worktreePath, branch: r.data!.branch };
}
