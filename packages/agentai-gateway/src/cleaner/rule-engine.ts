/**
 * 规则引擎: 加载声明式规则 + 按 path/size/mtime/total 阈值匹配
 *
 * 路径模板支持:
 *   - ~  → 用户主目录
 *   - <workspace> → 当前工作区
 *
 * 阈值表达式:
 *   - ">N", ">=N", "<N", "<=N", "=N" / "==N"
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import type { Rule, FileMeta } from './types.js';

export interface MatchContext {
    home: string;
    workspace: string;
    totalBytes?: number;  // 用于 totalBytes 阈值
}

/**
 * 展开路径模板 (~, <workspace>)
 */
function expandTemplate(p: string, ctx: MatchContext): string {
    return p.replace(/^~/, ctx.home).replace(/<workspace>/g, ctx.workspace);
}

/**
 * 比较阈值表达式,支持 > >= < <= = ==
 */
function compareThreshold(actual: number, expr: string): boolean {
    const m = expr.match(/^([><=]+)\s*(\d+)$/);
    if (!m) return false;
    const op = m[1];
    const n = Number(m[2]);
    if (op === '>') return actual > n;
    if (op === '>=') return actual >= n;
    if (op === '<') return actual < n;
    if (op === '<=') return actual <= n;
    if (op === '=' || op === '==') return actual === n;
    return false;
}

/**
 * glob 匹配: 支持 ** (跨多级) 和 * (单级非斜杠)
 * 转义正则元字符,避免误匹配
 */
function globMatch(pattern: string, target: string, ctx: MatchContext): boolean {
    const expanded = expandTemplate(pattern, ctx).replace(/[.+^$|()\[\]\\]/g, '\\$&');
    const re = new RegExp('^' + expanded.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
    return re.test(target);
}

/**
 * 规则匹配: 顺序遍历规则,任一规则全部条件满足即返回
 * 多条件之间是 AND 关系
 * ctx 可选: 无 ctx 时 path 匹配必然失败,但纯阈值规则(sizeBytes/totalBytes/mtimeDaysAgo)仍可工作
 */
export function matchRule(rules: Rule[], file: FileMeta, ctx?: Partial<MatchContext>): Rule | null {
    const now = Date.now();
    const safeCtx: MatchContext = {
        home: ctx?.home ?? '',
        workspace: ctx?.workspace ?? '',
        totalBytes: ctx?.totalBytes,
    };
    for (const r of rules) {
        let ok = true;

        if (r.match.path) {
            ok = ok && globMatch(r.match.path, file.path, safeCtx);
        }

        if (ok && r.match.mtimeDaysAgo) {
            const days = (now - file.mtime) / 86_400_000;
            ok = ok && compareThreshold(days, r.match.mtimeDaysAgo);
        }

        if (ok && r.match.sizeBytes) {
            ok = ok && compareThreshold(file.size, r.match.sizeBytes);
        }

        if (ok && r.match.totalBytes) {
            // totalBytes 需要 ctx 提供
            ok = ok && (safeCtx.totalBytes !== undefined) && compareThreshold(safeCtx.totalBytes, r.match.totalBytes);
        }

        if (ok) return r;
    }
    return null;
}

/**
 * 同步版本,供 watchRules 回调使用
 */
export function loadRulesSync(filePath: string): Rule[] {
    const text = fsSync.readFileSync(filePath, 'utf-8');
    return JSON.parse(text) as Rule[];
}

/**
 * 从 JSON 文件加载规则
 */
export async function loadRules(filePath: string): Promise<Rule[]> {
    const text = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(text) as Rule[];
}

/**
 * 加载规则 + 失败时回退到缓存
 * 缓存: 缓存最后一次成功加载的规则,用于 rules.json 损坏时恢复
 */
export async function loadRulesWithCache(filePath: string, cacheFile: string): Promise<Rule[]> {
    try {
        const rules = await loadRules(filePath);
        await fs.writeFile(cacheFile, JSON.stringify(rules), 'utf-8');
        return rules;
    } catch (e) {
        try {
            const text = await fs.readFile(cacheFile, 'utf-8');
            return JSON.parse(text) as Rule[];
        } catch {
            throw e;
        }
    }
}

/**
 * 监听规则文件变化,变化时重新加载
 * 返回 dispose 函数用于停止监听
 */
export function watchRules(filePath: string, onChange: (rules: Rule[]) => void): () => void {
    // 初次加载(异步,失败静默)
    loadRules(filePath).then(r => onChange(r)).catch(() => { /* keep current */ });

    let watcher: ReturnType<typeof fsSync.watch> | undefined;
    try {
        watcher = fsSync.watch(filePath, () => {
            try {
                const r = loadRulesSync(filePath);
                onChange(r);
            } catch {
                /* keep current */
            }
        });
    } catch {
        /* no fs.watch support */
    }
    return () => {
        try { watcher?.close(); } catch { /* ignore */ }
    };
}
