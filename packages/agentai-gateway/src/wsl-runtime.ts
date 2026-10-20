/**
 * wsl-runtime — WSL 进程启动的单一真源 (2026-10-21)
 * ----------------------------------------------------------------
 * 富哥实锤事故: wsl_exec 报
 *   `Command failed: wsl -u root -d kali-linux -- bash -lc ...`
 * (execFile 的 err.message 形态 = 进程已启动但**非零退出**, 且无 stdout/stderr)。
 *
 * 两个假设 (富哥按概率排的):
 *   ① Node 进程 PATH 不含 System32 → execFile('wsl') 找不到 wsl.exe
 *   ② `-u root` 前置失败 (发行版 root 未启用) → wsl.exe 静默非零退出
 *
 * 本机实测 (2026-10-21): `where wsl` → C:\Windows\System32\wsl.exe 存在;
 *   Node 视角 PATH 含 System32 → **终端启动的网关不会是 ①**;
 *   但桌面端/服务方式启动的进程环境不可控, ① 仍是隐患。
 * 本模块把两个假设同时根治, 且失败时自带分层诊断:
 *   · 绝对路径解析 System32\wsl.exe (找不到才退回 PATH 查找)
 *   · 静默失败 (无 stdout 无 stderr) 且指定了 user → 自动退回默认用户重试一次
 *   · 错误里带: 实际 exe 路径 / 两次 exit code / 是否回退过 → 不用猜
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

let _cachedExe: string | null = null;

/**
 * 解析 wsl.exe 绝对路径。
 * win32: 依次试 %SystemRoot%\System32\wsl.exe / C:\Windows\System32\wsl.exe,
 *   取第一个存在的; 都找不到 → 退回裸 'wsl' (交给 PATH 查找, 非 Windows 亦走此路)。
 */
export function resolveWslExe(): string {
  if (_cachedExe) return _cachedExe;
  if (process.platform !== 'win32') { _cachedExe = 'wsl'; return _cachedExe; }
  const roots = [process.env.SystemRoot, process.env.SYSTEMROOT, 'C:\\Windows'].filter(Boolean) as string[];
  const candidates = [...roots.map(r => path.join(r, 'System32', 'wsl.exe')), 'C:\\Windows\\System32\\wsl.exe'];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { _cachedExe = c; return c; } } catch { /* ignore */ }
  }
  _cachedExe = 'wsl';
  return _cachedExe;
}

export interface WslRunResult {
  /** 进程退出码为 0 */
  ok: boolean;
  /** 退出码 (进程跑过才有; spawn 失败为 null) */
  exitCode: number | null;
  /** spawn/环境级错误 (ENOENT/EACCES/...; 进程跑过为 null) */
  spawnError: string | null;
  /** execFile 超时被杀 */
  timedOut: boolean;
  stdout: string;
  stderr: string;
  /** 实际生效的用户 (回退后为 '') */
  usedUser: string;
  /** 是否发生过 "指定用户静默失败 → 退回默认用户" */
  fellBack: boolean;
  /** 实际使用的 wsl.exe 路径 */
  exe: string;
  /** 首次尝试的退出码 (诊断用) */
  firstExitCode: number | null;
}

export interface WslRunOpts {
  distro?: string;
  user?: string;
  command: string;
  args?: string[];
  timeout?: number;
  maxBuffer?: number;
  /** 拿到 child 实例 (调用方可用它做超时杀进程树 — wsl.exe 的孙进程不会随 execFile 超时而死) */
  onSpawn?: (child: any) => void;
}

/** 单次尝试 (不抛异常, 全部落进 result) */
function attempt(exe: string, user: string, distro: string, command: string, args: string[], timeout: number, maxBuffer: number, onSpawn?: (child: any) => void): Promise<WslRunResult> {
  const argv = user ? ['-u', user, '-d', distro, '--', command, ...args] : ['-d', distro, '--', command, ...args];
  return new Promise((resolve) => {
    const child = execFile(exe, argv, { timeout, maxBuffer, windowsHide: true, encoding: 'utf-8' },
      (err: any, so: any, se: any) => {
        const stdout = String(so ?? '');
        const stderr = String(se ?? '');
        if (!err) {
          resolve({ ok: true, exitCode: 0, spawnError: null, timedOut: false, stdout, stderr, usedUser: user, fellBack: false, exe, firstExitCode: 0 });
          return;
        }
        const timedOut = err.killed === true || err.code === 'ETIMEDOUT' || /timed out|timeout/i.test(String(err.message || ''));
        const numeric = typeof err.code === 'number';
        resolve({
          ok: false,
          exitCode: numeric ? (err.code as number) : null,
          spawnError: numeric ? null : String(err.message || err.code || 'spawn failed'),
          timedOut,
          stdout, stderr,
          usedUser: user, fellBack: false, exe,
          firstExitCode: numeric ? (err.code as number) : null,
        });
      });
    try { onSpawn?.(child); } catch { /* hook optional */ }
  });
}

/**
 * 数组化执行 WSL 命令 (不经 cmd.exe, 引号安全)。
 *
 * 重试策略 (2026-10-21, 只补环境层洞, 不放大命令层噪音):
 *   · 首次**静默失败** (非零退出且无任何输出) 且指定了 user → 用默认用户重试一次
 *     —— 静默非零 = 环境/用户层问题 (假设 ②); 有输出的失败是命令自己的事, 不重试
 *   · spawn 错误 (ENOENT 等) → 不重试 (换用户没用), 直接带诊断返回
 */
export async function wslRun(opts: WslRunOpts): Promise<WslRunResult> {
  const distro = opts.distro || 'kali-linux';
  const user = (opts.user || '').trim();
  const command = String(opts.command || '').trim();
  const args = Array.isArray(opts.args) ? opts.args.map(a => String(a)) : [];
  const timeout = Math.min(opts.timeout || 120_000, 600_000);
  const maxBuffer = opts.maxBuffer ?? 5 * 1024 * 1024;
  const exe = resolveWslExe();

  const first = await attempt(exe, user, distro, command, args, timeout, maxBuffer, opts.onSpawn);
  if (first.ok) return first;

  // spawn 级错误 (找不到 wsl.exe 等) — 换用户无解, 直接返回诊断
  if (first.spawnError) return first;

  // 有输出的失败 = 命令自己跑过了 (exit 1 + 报告) — 不是用户层问题, 不重试
  const silent = !first.stdout.trim() && !first.stderr.trim();
  if (!silent || !user) return first;

  // 静默失败 + 指定了 user → 退回默认用户重试一次 (假设 ②: -u root 未启用)
  const second = await attempt(exe, '', distro, command, args, timeout, maxBuffer);
  if (second.ok) return { ...second, usedUser: '', fellBack: true, firstExitCode: first.exitCode };
  // 两次都失败 → 合并诊断 (保留首次 exit code, 标注回退过)
  return {
    ...second,
    usedUser: '',
    fellBack: true,
    firstExitCode: first.exitCode,
    stdout: first.stdout || second.stdout,
    stderr: first.stderr || second.stderr,
  };
}

/** 把失败结果格式化成"可行动"的诊断文本 (给 AI 看) */
export function formatWslFailure(r: WslRunResult, distro: string): string {
  const lines: string[] = [];
  lines.push(`wsl.exe: ${r.exe}`);
  lines.push(`distro: ${distro}`);
  if (r.fellBack) {
    lines.push(`用户: 指定用户静默失败 (exit=${r.firstExitCode ?? '?'}) → 已自动回退默认用户重试 (exit=${r.exitCode ?? '?'}), 仍失败`);
  } else {
    lines.push(`用户: ${r.usedUser || '(默认)'} / exit=${r.exitCode ?? '?'}`);
  }
  if (r.spawnError) lines.push(`spawn 错误: ${r.spawnError}`);
  if (r.timedOut) lines.push('超时: 已到达 execFile 超时上限');
  if (r.stderr.trim()) lines.push(`STDERR: ${r.stderr.trim().slice(0, 1500)}`);
  if (r.stdout.trim()) lines.push(`STDOUT: ${r.stdout.trim().slice(0, 1500)}`);
  return lines.join('\n');
}
