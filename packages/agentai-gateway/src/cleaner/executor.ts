/**
 * 执行器: 把 SAFE 桶的动作实际落地
 * - delete: 删文件
 * - gzip-archive: 压缩归档 (源文件删除)
 * - move-archive: 移动到归档目录
 * - llm-free-archive: 启发式压缩(只保留 markdown 标题),源文件删除
 *
 * 所有动作带 3 次指数退避重试
 * 单个失败不影响其他动作
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import type { FileAction, AuditWriter } from './types.js';

export interface ExecuteResult {
    bytesFreed: number;
    failures: Array<{ planId: string; path: string; error: string }>;
}

/**
 * 指数退避重试: 1s / 2s / 4s,封顶 4s
 * - isPermanent 谓词判断哪些错误无需重试(直接抛)
 *   例如 ENOENT: 文件不存在,重试无意义
 */
async function withRetry<T>(
    op: () => Promise<T>,
    attempts = 3,
    isPermanent?: (e: any) => boolean,
): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
        try { return await op(); }
        catch (e) {
            if (isPermanent?.(e)) throw e;
            lastErr = e;
            if (i < attempts - 1) {
                await new Promise(r => setTimeout(r, Math.min(2 ** i * 1000, 4000)));
            }
        }
    }
    throw lastErr;
}

function expandHome(p?: string): string {
    if (!p) return '';
    if (p.startsWith('~')) return path.join(process.env.HOME || process.env.USERPROFILE || '', p.slice(1));
    return p;
}

async function gzipFile(src: string, dst: string): Promise<void> {
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await pipeline(createReadStream(src), zlib.createGzip(), createWriteStream(dst));
}

async function moveFile(src: string, dstDir: string): Promise<void> {
    await fs.mkdir(dstDir, { recursive: true });
    const dst = path.join(dstDir, path.basename(src));
    try {
        await fs.rename(src, dst);
    } catch {
        // 跨设备 rename 失败 → 复制+删除
        await fs.copyFile(src, dst);
        await fs.unlink(src);
    }
}

/**
 * 启发式归档: 只保留 markdown 标题(#, ##, ###, ####, #####, ######)
 * 移除正文,大幅压缩体积
 */
async function archiveMemoryMd(src: string, dstDir: string): Promise<void> {
    await fs.mkdir(dstDir, { recursive: true });
    const text = await fs.readFile(src, 'utf-8');
    const kept = text.split('\n').filter(l => /^\s*#{1,6}\s/.test(l)).join('\n');
    await fs.writeFile(path.join(dstDir, path.basename(src)), kept + '\n', 'utf-8');
    await fs.unlink(src);
}

/**
 * 执行一批 SAFE 动作
 */
export async function executeSafe(actions: FileAction[], audit: AuditWriter): Promise<ExecuteResult> {
    const result: ExecuteResult = { bytesFreed: 0, failures: [] };

    for (const a of actions) {
        try {
            const size = a.file.size;
            switch (a.action) {
                case 'delete':
                    // ENOENT (文件不存在) 视为永久错误,直接抛 → 外层计入 failures
                    await withRetry(() => fs.unlink(a.file.path), 3, e => e?.code === 'ENOENT');
                    break;
                case 'gzip-archive':
                    await withRetry(() => gzipFile(
                        a.file.path,
                        path.join(expandHome(a.archiveDir), path.basename(a.file.path) + '.gz'),
                    ));
                    await withRetry(() => fs.unlink(a.file.path));
                    break;
                case 'move-archive':
                    await withRetry(() => moveFile(a.file.path, expandHome(a.archiveDir)));
                    break;
                case 'llm-free-archive':
                    await withRetry(() => archiveMemoryMd(a.file.path, expandHome(a.archiveDir)));
                    break;
                default:
                    // 其他动作(confirm-required/alert/none)不在 SAFE 桶执行
                    continue;
            }
            result.bytesFreed += size;
            await audit.log({
                action: 'cleaner_execute',
                payload: { planId: a.planId, ruleId: a.ruleId, file: a.file.path, action: a.action, size },
            });
        } catch (e: any) {
            result.failures.push({ planId: a.planId, path: a.file.path, error: String(e?.message || e) });
            await audit.log({
                action: 'cleaner_execute',
                result: 'error',
                payload: { planId: a.planId, file: a.file.path, error: String(e?.message || e) },
            });
        }
    }
    return result;
}
