/**
 * 跨平台工具抽象层
 * ----------------------------------------------------
 * 解决元模式 1 (POSIX-First 假设):
 *   - shellExec(): 跨平台 shell 执行
 *   - symlink(): 跨平台符号链接
 *   - searchFiles(): 跨平台文件搜索 (替代 grep)
 *   - mklink(): 跨平台目录链接
 *
 * @see 第四层诊断: 架构预防 - 元模式 1
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const IS_WIN = process.platform === 'win32';

// ===== Shell 执行 =====

/**
 * 跨平台 shell 执行
 * - Windows: powershell.exe -NoProfile -NonInteractive -Command
 * - POSIX: /bin/bash -c
 */
export function shellExec(
  command: string,
  opts?: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    encoding?: string;
    env?: NodeJS.ProcessEnv;
  },
): { stdout: string; stderr: string; status: number | null } {
  const shell = IS_WIN
    ? 'powershell.exe'
    : (process.env.SHELL || '/bin/bash');
  const shellArgs = IS_WIN
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-c', command];

  const result = spawnSync(shell, shellArgs, {
    cwd: opts?.cwd || process.cwd(),
    timeout: opts?.timeout || 30000,
    encoding: (opts?.encoding as BufferEncoding) || 'utf-8',
    maxBuffer: opts?.maxBuffer || 1024 * 1024,
    env: { ...process.env, ...(opts?.env || {}) },
  });

  return {
    stdout: (result.stdout as string) || '',
    stderr: (result.stderr as string) || '',
    status: result.status,
  };
}

/**
 * 同步 shell 执行 (返回合并输出)
 */
export function shellExecSync(
  command: string,
  opts?: { cwd?: string; timeout?: number; maxBuffer?: number },
): string {
  const result = shellExec(command, opts);
  return (result.stdout || '') + (result.stderr || '');
}

// ===== 符号链接 =====

/**
 * 跨平台符号链接
 * - Windows: mklink /J (junction)
 * - POSIX: ln -s (symlink)
 */
export function createSymlink(target: string, linkPath: string): void {
  if (IS_WIN) {
    // Windows: 用 junction (目录软链)
    execSync(`mklink /J "${linkPath}" "${target}"`, { timeout: 5000 });
  } else {
    fs.symlinkSync(target, linkPath, 'dir');
  }
}

/**
 * 检查是否支持符号链接
 */
export function supportsSymlink(): boolean {
  if (IS_WIN) {
    // Windows 10+ 支持，但需要管理员权限或开发者模式
    try {
      const testDir = path.join(os.tmpdir(), `symlink-test-${Date.now()}`);
      fs.mkdirSync(testDir);
      const linkPath = path.join(os.tmpdir(), `symlink-link-${Date.now()}`);
      fs.symlinkSync(testDir, linkPath, 'dir');
      fs.rmSync(linkPath);
      fs.rmSync(testDir);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

// ===== 文件搜索 (替代 grep) =====

/**
 * 跨平台文件内容搜索
 * - Windows: Select-String
 * - POSIX: grep
 */
export function searchFileContent(
  pattern: string,
  basePath: string,
  opts?: {
    glob?: string;
    context?: number;
    maxResults?: number;
  },
): string {
  const escapedPattern = pattern.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const maxResults = opts?.maxResults || 200;

  if (IS_WIN) {
    // Windows: Select-String
    const globFilter = opts?.glob ? ` -Include ${opts.glob}` : '';
    const contextFlag = opts?.context ? ` -Context ${opts.context},${opts.context}` : '';
    const command = `Get-ChildItem -Path "${basePath}" -Recurse -File${globFilter} | Select-String -Pattern "${escapedPattern}"${contextFlag} | Select-Object -First ${maxResults} | ForEach-Object { "$($_.Filename):$($_.LineNumber): $($_.Line)" }`;
    return shellExecSync(command, { cwd: basePath, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }) || '(no matches)';
  } else {
    // POSIX: grep
    const contextFlag = opts?.context ? ` -C ${opts.context}` : '';
    const globFlag = opts?.glob ? ` --include="${opts.glob}"` : '';
    const command = `grep -rn${contextFlag}${globFlag} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build "${escapedPattern}" "${basePath}" 2>/dev/null | head -n ${maxResults}`;
    return shellExecSync(command, { cwd: basePath, timeout: 15000, maxBuffer: 10 * 1024 * 1024 }) || '(no matches)';
  }
}

// ===== 目录链接 (复用 node_modules) =====

/**
 * 创建目录链接 (用于 worktree node_modules 复用)
 */
export function linkDirectory(source: string, dest: string): void {
  if (fs.existsSync(dest)) return; // 已存在则跳过
  if (!fs.existsSync(source)) return; // 源不存在则跳过

  try {
    if (IS_WIN) {
      execSync(`mklink /J "${dest}" "${source}"`, { timeout: 5000 });
    } else {
      fs.symlinkSync(source, dest, 'dir');
    }
  } catch {
    // symlink 失败不影响主流程
  }
}

// ===== 路径操作 =====

/**
 * 获取系统临时目录
 */
export function getTempDir(): string {
  return path.join(os.tmpdir(), 'agentai');
}

/**
 * 创建安全的临时文件
 */
export function createTempFile(suffix: string = '.json'): { path: string; cleanup: () => void } {
  const tempDir = getTempDir();
  fs.mkdirSync(tempDir, { recursive: true });
  const fileName = `agentai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}${suffix}`;
  const filePath = path.join(tempDir, fileName);
  return {
    path: filePath,
    cleanup: () => {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    },
  };
}

/**
 * 获取操作系统名
 */
export function getOS(): string {
  return IS_WIN ? 'win32' : process.platform;
}
