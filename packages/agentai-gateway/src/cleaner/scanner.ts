/**
 * 目录扫描器: 递归遍历 + 超时控制 + 跳过白名单
 * - 默认跳过 node_modules / .git / dist / build / .next / coverage / __pycache__
 * - maxDepth 限制递归深度
 * - timeoutMs 整体超时,超时后停止扫描并返回已收集文件
 * - 跳过符号链接,防止循环
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { FileMeta } from './types.js';

export interface ScanOptions {
    roots: string[];
    maxDepth: number;
    timeoutMs: number;
    skipDirs?: string[];
}

const DEFAULT_SKIP = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'];

/**
 * 扫描入口: 多 root 串行扫描,共享超时预算
 */
export async function scan(opts: ScanOptions): Promise<FileMeta[]> {
    const skip = new Set([...(opts.skipDirs ?? DEFAULT_SKIP)]);
    const out: FileMeta[] = [];
    const start = Date.now();
    const timedOut = { v: false };
    const timer = setTimeout(() => { timedOut.v = true; }, opts.timeoutMs);
    try {
        for (const root of opts.roots) {
            if (timedOut.v) break;
            try {
                await walk(root, 0, opts.maxDepth, skip, out, start, opts.timeoutMs, timedOut);
            } catch {
                // 单个 root 失败不影响其他 root
            }
        }
    } finally {
        clearTimeout(timer);
    }
    return out;
}

/**
 * 递归遍历: 深度优先,跳过白名单目录和符号链接
 */
async function walk(
    dir: string,
    depth: number,
    maxDepth: number,
    skip: Set<string>,
    out: FileMeta[],
    start: number,
    timeoutMs: number,
    timedOut: { v: boolean },
): Promise<void> {
    if (timedOut.v || depth > maxDepth || Date.now() - start > timeoutMs) return;

    let entries: import('fs').Dirent[];
    try {
        entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
        return;  // 目录不可读(权限等)
    }

    for (const e of entries) {
        if (timedOut.v) return;
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        try {
            if (e.isSymbolicLink()) continue;  // 防循环
            if (e.isDirectory()) {
                await walk(full, depth + 1, maxDepth, skip, out, start, timeoutMs, timedOut);
            } else if (e.isFile()) {
                const st = await fs.stat(full);
                out.push({ path: full, size: st.size, mtime: st.mtimeMs, atime: st.atimeMs, isFile: true });
            }
        } catch {
            /* 跳过不可访问文件 */
        }
    }
}

/**
 * 展开 ~ → 用户主目录
 */
export function expandHome(p: string): string {
    if (p.startsWith('~')) return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(1));
    return p;
}
