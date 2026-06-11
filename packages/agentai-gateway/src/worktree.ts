// @ts-nocheck
/**
 * Git Worktree 隔离并行任务
 * ----------------------------------------------------
 * 实现:
 *   - worktree_create:  创建隔离分支 + symlink node_modules
 *   - worktree_list:    列出所有工作树
 *   - worktree_remove:  删除工作树 + 清理
 *
 * 安全约束:
 *   - 不允许删除主工作树 (main/master)
 *   - 不允许在已有工作树下再创建
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WorktreeInfo {
    path: string;
    branch: string;
    /** HEAD commit hash (前 7 字符) */
    head: string;
    /** 是否当前所在 */
    current: boolean;
}

/**
 * 创建隔离工作树
 * @param basePath 主仓库根目录
 * @param branchPrefix 分支名前缀 (默认 task-)
 * @returns 新工作树路径和分支名
 */
export function worktreeCreate(basePath: string, branchPrefix = 'task-'): { worktreePath: string; branch: string } {
    if (!fs.existsSync(path.join(basePath, '.git'))) {
        throw new Error('Not a git repository: ' + basePath);
    }

    // 安全地生成分支名
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const rawBranch = `${branchPrefix}${ts}-${rand}`;
    // 验证分支名安全性
    const { validateBranchName } = await import('./sanitize.js');
    const branchCheck = validateBranchName(rawBranch);
    if (!branchCheck.valid) {
      // 使用备用名称
      const safeBranch = rawBranch.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
      const branch = validateBranchName(safeBranch).valid ? safeBranch : `task-${ts}-${rand}`;
      execSync(`git worktree add "${wdir}" -b "${branch}"`, { cwd, encoding: 'utf-8', timeout: 30000 });
      return { worktreePath: wdir, branch };
    }
    const branch = rawBranch;

    // 工作树目录: ~/.agentai/worktrees/<branch>
    const wdir = path.join(os.homedir(), '.agentai', 'worktrees', branch);

    if (fs.existsSync(wdir)) {
        throw new Error(`Worktree path already exists: ${wdir}`);
    }

    const cwd = basePath;
    execSync(`git worktree add "${wdir}" -b "${branch}"`, { cwd, encoding: 'utf-8', timeout: 30000 });

    // Symlink node_modules (复用主工作树的依赖, 不用重新 pnpm install)
    const mainNodeModules = path.join(basePath, 'node_modules');
    const wtNodeModules = path.join(wdir, 'node_modules');
    if (fs.existsSync(mainNodeModules) && !fs.existsSync(wtNodeModules)) {
        try {
            if (process.platform === 'win32') {
                // Windows: 用 junction (目录软链)
                execSync(`mklink /J "${wtNodeModules}" "${mainNodeModules}"`, { timeout: 5000 });
            } else {
                fs.symlinkSync(mainNodeModules, wtNodeModules, 'dir');
            }
        } catch { /* symlink 失败不影响, 用户手动 pnpm install */ }
    }

    return { worktreePath: wdir, branch };
}

/**
 * 列出所有工作树
 */
export function worktreeList(basePath: string): WorktreeInfo[] {
    if (!fs.existsSync(path.join(basePath, '.git'))) return [];
    try {
        const out = execSync('git worktree list', { cwd: basePath, encoding: 'utf-8', timeout: 10000 });
        const lines = out.trim().split('\n');
        return lines.map(line => {
            const parts = line.trim().split(/\s+/);
            const wpath = parts[0];
            const head = parts.length > 1 ? parts[1].replace(/[\[\]]/g, '') : '';
            const branch = parts.length > 2 ? parts[2].replace(/[\[\]]/g, '') : head;
            const current = line.includes('(detached') ? false : !line.includes('(bare');
            return { path: wpath, branch, head: head.slice(0, 7), current };
        });
    } catch {
        return [];
    }
}

/**
 * 删除工作树 (安全: 不允许删主工作树)
 */
export function worktreeRemove(basePath: string, worktreePath: string): { ok: boolean; error?: string } {
    if (!fs.existsSync(path.join(basePath, '.git'))) {
        return { ok: false, error: 'Not a git repo' };
    }

    // 检查是否为主工作树
    const trees = worktreeList(basePath);
    const target = trees.find(t => t.path === worktreePath);
    if (!target) return { ok: false, error: `Worktree not found: ${worktreePath}` };
    if (target.current) return { ok: false, error: 'Cannot remove the current worktree' };

    // 主分支保护
    const mainBranches = ['main', 'master'];
    if (mainBranches.includes(target.branch)) {
        return { ok: false, error: `Cannot remove worktree for protected branch: ${target.branch}` };
    }

    try {
        // 先删目录 (PowerShell 限制, 走 cmd)
        if (process.platform === 'win32') {
            try { execSync(`rmdir /s /q "${worktreePath}"`, { timeout: 10000 }); } catch { /* OK, git worktree remove 也会清理 */ }
        } else {
            fs.rmSync(worktreePath, { recursive: true, force: true });
        }

        // git worktree remove (如果目录已被删, 会报错但分支已游离)
        try {
            execSync(`git worktree remove "${worktreePath}" --force`, { cwd: basePath, encoding: 'utf-8', timeout: 10000 });
        } catch { /* 忽略, 目录已清理 */ }

        // 删除分支
        try {
            execSync(`git branch -D "${target.branch}"`, { cwd: basePath, encoding: 'utf-8', timeout: 5000 });
        } catch { /* 分支可能已被移除 */ }

        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e.message || String(e) };
    }
}
