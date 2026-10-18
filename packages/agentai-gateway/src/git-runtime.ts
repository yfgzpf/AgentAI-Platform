/**
 * git-runtime — Git 能力统一入口（2026-10-16 打包/部署加固）
 * ============================================================================
 * 背景: 项目里有两套 git 调用路径，只有一套带防护——
 *   - tools.ts 的 gitExec/findGitBinary: execFile 参数数组，有 Windows ENOENT 兜底
 *   - worktree.ts / auto-project-doc.ts / agentai-loop.ts: 裸 execSync('git ...') 或
 *     execFile('git', ...)，直接崩，且是 shell 字符串拼接（参数可注入元字符）
 *
 * 为什么必须统一（打包/部署视角）:
 *   - **桌面版不捆绑 git**。tauri.conf.json 无 externalBin，NSIS 安装包不含 git.exe。
 *     用户机器没装 Git for Windows 时，裸 execSync 抛的是 ENOENT 原文，
 *     前端看到的是"spawnSync git ENOENT"，完全无法理解。必须降级成人话提示。
 *   - **Docker 镜像里没有 .git 目录**（Dockerfile 只 COPY dist）。worktree 能力
 *     在容器里恒不可用，必须能在启动时探测并如实上报，而不是让用户误以为可用。
 *   - 探测结果要能暴露给 /v1/system/check-dep 和 GUI，让"为什么 worktree 不可用"
 *     变成一条可读的状态，而不是运行时才炸。
 *
 * 契约:
 *   - gitExec: 永远用 execFile + 参数数组（不经 shell），参数中元字符是字面量
 *   - gitEnvCheck: 不抛异常，返回结构化状态，供 UI/端点展示
 *   - gitAvailable(): 缓存探测结果（3s 探测一次太慢，但也不能永久缓存——
 *     用户装了 git 后要能生效，故缓存 60s）
 */

import { execFile, execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════
// 可用性探测
// ═══════════════════════════════════════════════════════════

export interface GitEnvStatus {
  /** git 是否可用 */
  available: boolean;
  /** 解析到的 git 可执行文件路径（available 时有值） */
  bin?: string;
  /** git 版本号，如 "2.55.0.windows.3" */
  version?: string;
  /** 探测方式: 'where' | 'common-path' | 'path-fallback' | 'none' */
  source?: 'where' | 'common-path' | 'path-fallback' | 'none';
  /** 不可用时的人话原因（给用户看，不要给他看 ENOENT） */
  reason?: string;
}

let _gitBinCache: string | null = null;
let _gitProbeCache: GitEnvStatus | null = null;
let _gitProbeAt = 0;
const PROBE_TTL_MS = 60_000;

/** Windows 上查找 git 完整路径（DEF-11 修复: 避免 execFile ENOENT） */
export function findGitBinary(): string {
  if (_gitBinCache) return _gitBinCache;

  if (process.platform === 'win32') {
    try {
      const found = execSync('where git 2>nul', { encoding: 'utf-8', timeout: 3000 })
        .trim().split('\n')[0].trim();
      if (found && fs.existsSync(found)) { _gitBinCache = found; return found; }
    } catch { /* where 不可用，走常见路径 */ }

    // 常见安装路径（含 scoop / winget / 便携版）
    const candidates = [
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Git\\bin\\git.exe`,
      `${process.env.USERPROFILE || ''}\\scoop\\apps\\git\\current\\cmd\\git.exe`,
    ];
    for (const p of candidates) {
      try { if (p && fs.existsSync(p)) { _gitBinCache = p; return p; } } catch { /* 忽略 */ }
    }
  }

  // 非 Windows 或上面都没找到: 直接用 PATH 解析（Linux/macOS 的 execFile 能正常解析）
  _gitBinCache = 'git';
  return _gitBinCache;
}

/**
 * 探测 git 环境（不抛异常）
 * 给 /v1/system/check-dep、GUI 能力面板、worktree 工具的前置检查用。
 */
export async function gitEnvCheck(force = false): Promise<GitEnvStatus> {
  const now = Date.now();
  if (!force && _gitProbeCache && now - _gitProbeAt < PROBE_TTL_MS) return _gitProbeCache;

  let st: GitEnvStatus;
  if (process.platform === 'win32') {
    // 先探常见路径（where 命令本身可能被杀软拦）
    let found: string | null = null;
    let source: GitEnvStatus['source'] = 'none';
    for (const p of [
      'C:\\Program Files\\Git\\bin\\git.exe',
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Program Files (x86)\\Git\\bin\\git.exe',
      `${process.env.LOCALAPPDATA || ''}\\Programs\\Git\\bin\\git.exe`,
      `${process.env.USERPROFILE || ''}\\scoop\\apps\\git\\current\\cmd\\git.exe`,
    ]) {
      try { if (p && fs.existsSync(p)) { found = p; source = 'common-path'; break; } } catch { /* 忽略 */ }
    }
    if (!found) {
      try {
        const w = execSync('where git 2>nul', { encoding: 'utf-8', timeout: 3000 })
          .trim().split('\n')[0].trim();
        if (w && fs.existsSync(w)) { found = w; source = 'where'; }
      } catch { /* 忽略 */ }
    }
    if (found) { _gitBinCache = found; st = { available: true, bin: found, source }; }
    else {
      // 最后一试: 让 execFile 自己解析 PATH（用户装在自定义目录的情况）
      try {
        const out = probeGitVersionSync('git');
        if (out) { _gitBinCache = 'git'; st = { available: true, bin: 'git', source: 'path-fallback' }; }
        else { st = { available: false, reason: notInstalledMessage() }; }
      } catch {
        st = { available: false, reason: notInstalledMessage() };
      }
    }
  } else {
    try {
      const out = probeGitVersionSync('git');
      if (out) { _gitBinCache = 'git'; st = { available: true, bin: 'git', source: 'path-fallback' }; }
      else { st = { available: false, reason: notInstalledMessage() }; }
    } catch {
      st = { available: false, reason: notInstalledMessage() };
    }
  }

  if (st.available) {
    // ⚠️ 这里必须用同步探测，**不能调 gitExec** —— gitExec 内部会再调 gitEnvCheck，
    // 首次探测（缓存未写入）时形成无限递归 → RangeError: Maximum call stack size exceeded。
    const raw = probeGitVersionSync(st.bin || 'git');
    const m = String(raw).match(/(\d+\.\d+\.\S+)/);
    if (m) st.version = m[1];
  }

  _gitProbeCache = st;
  _gitProbeAt = now;
  return st;
}

/** git 不可用时给用户看的话（关键: 不暴露 ENOENT / spawnSync） */
function notInstalledMessage(): string {
  return process.platform === 'win32'
    ? '未检测到 Git。Git 隔离（worktree）功能需要 Git for Windows，请从 https://git-scm.com/download/win 安装后重启。'
    : '未检测到 Git。请先安装 git 后重试。';
}

/** 同步跑一次 git --version（探测用；不用 shell 拼接，git 不存在时安静返回空串） */
function probeGitVersionSync(bin: string): string {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 3000, windowsHide: true }).trim();
  } catch {
    return '';
  }
}

/** 布尔版: git 是否可用 */
export async function gitAvailable(): Promise<boolean> {
  return (await gitEnvCheck()).available;
}

// ═══════════════════════════════════════════════════════════
// 执行
// ═══════════════════════════════════════════════════════════

export interface GitExecOptions {
  cwd: string;
  timeout?: number;
  /** 允许的额外环境变量（worktree 隔离时可能要注入 GIT_DIR 等） */
  env?: Record<string, string>;
}

/**
 * 执行 git（永远 execFile + 参数数组，绝不 shell 拼接）
 * git 不可用时抛出**人话**错误，不是 ENOENT。
 */
export async function gitExec(args: string[], opts: GitExecOptions): Promise<string> {
  const env = await gitEnvCheck();
  if (!env.available) {
    const e: any = new Error(env.reason || notInstalledMessage());
    e.code = 'GIT_NOT_AVAILABLE';
    e.userFacing = true;
    throw e;
  }
  const gitBin = process.platform === 'win32' ? findGitBinary() : 'git';

  return new Promise((resolve, reject) => {
    execFile(
      gitBin,
      args,
      {
        cwd: opts.cwd,
        encoding: 'utf-8',
        timeout: opts.timeout ?? 10000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      },
      (err: any, stdout: any, stderr: any) => {
        const out = String(stdout ?? '');
        const errOut = String(stderr ?? '');
        if (err) {
          const e: any = new Error((out + '\n' + errOut).trim() || err.message);
          e.gitExitCode = err.code;
          reject(e);
          return;
        }
        resolve((out + (errOut ? '\n' + errOut : '')).trim());
      },
    );
  });
}

/** gitExec 的"不抛"版本（用于可选能力探测，如"当前目录是不是仓库"） */
export async function gitExecSafe(args: string[], opts: GitExecOptions): Promise<{ ok: boolean; output: string; error?: string }> {
  try {
    const output = await gitExec(args, opts);
    return { ok: true, output };
  } catch (e: any) {
    return { ok: false, output: '', error: e?.message || String(e) };
  }
}

// ═══════════════════════════════════════════════════════════
// 仓库事实
// ═══════════════════════════════════════════════════════════

/** 目录是否是 git 仓库工作区（兼容 worktree 与子模块: 认 .git 文件） */
export function isGitRepo(basePath: string): boolean {
  try {
    if (!basePath || !fs.existsSync(basePath)) return false;
    const dotGit = path.join(basePath, '.git');
    const st = fs.lstatSync(dotGit);
    // .git 目录（普通仓库）或 .git 文件（worktree / 子模块, 内容是 "gitdir: ..."）
    return st.isDirectory() || st.isSymbolicLink() || st.isFile();
  } catch {
    return false;
  }
}

/** 拿仓库根（.git 可能在上级，如 monorepo 子目录进grandparent） */
export async function gitRepoRoot(cwd: string): Promise<string | null> {
  const r = await gitExecSafe(['rev-parse', '--show-toplevel'], { cwd, timeout: 5000 });
  if (r.ok && r.output) return r.output.split('\n')[0].trim();
  return null;
}

/**
 * 仓库是否"脏"（有未提交改动）—— worktree 创建前必须检查
 * 脏仓库上建 worktree，agent 看到的基线和用户的工作区不一致，容易误覆盖。
 */
export async function isRepoDirty(cwd: string): Promise<boolean> {
  const r = await gitExecSafe(['status', '--porcelain'], { cwd, timeout: 8000 });
  if (!r.ok) return false;
  return r.output.trim().length > 0;
}

/** 清掉探测缓存（测试用；或用户刚装完 git 想立即生效） */
export function resetGitProbeCache(): void {
  _gitBinCache = null;
  _gitProbeCache = null;
  _gitProbeAt = 0;
}
