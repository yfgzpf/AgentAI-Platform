/**
 * Sandbox 规则加载/校验/匹配
 *
 * 不依赖 picomatch/minimatch — 手写 glob→regex, 支持:
 *   - *      单层任意字符 (不含 /)
 *   - **     跨层任意
 *   - ?      单字符
 *   - [abc]  字符集
 *   - {a,b}  或 (仅简单形式, 不嵌套)
 *
 * 路径标准化:
 *   - \\ → /
 *   - 绝对化
 *   - ~  → os.homedir()
 *   - 末尾 / 去掉
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { SandboxRules } from './types.js';

/** 默认规则 (首次启动生成) */
export function defaultRules(): SandboxRules {
    const home = os.homedir();
    return {
        allow: [
            `${process.cwd()}/**`,
            `${home}/Documents/**`,
            `${home}/Downloads/**`,
            `${home}/Desktop/**`,
        ],
        deny: [
            'C:/Windows/**',
            'C:/Program Files/**',
            'C:/Program Files (x86)/**',
            '/etc/**',
            '/usr/**',
            '/bin/**',
            '/sbin/**',
            '/var/**',
            'C:/System32/**',
            `${home}/.ssh/**`,
            `${home}/.aws/**`,
            `${home}/.gnupg/**`,
            `${home}/.config/gh/**`,
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
        ],
        prompt: [
            '**/.env*',
            '**/secrets/**',
            '**/secrets.*',
            '**/*.key',
            '**/*.pem',
            '**/*.p12',
            '**/id_rsa*',
            '**/credentials*',
            '**/.npmrc',
            '**/.pypirc',
        ],
        maxFileSize: 100 * 1024 * 1024,      // 100 MB
        maxTotalSize: 1024 * 1024 * 1024,    // 1 GB
        version: 1,
        updatedAt: Date.now(),
    };
}

/**
 * 路径标准化
 * 1. \ → /
 * 2. 展开 ~
 * 3. 绝对化 (相对 process.cwd())
 * 4. 末尾 / 去掉
 * 5. Windows: 盘符大写
 */
export function normalizePath(p: string): string {
    if (!p) return p;
    let s = p.replace(/\\/g, '/');
    // 展开 ~ (只处理开头)
    if (s.startsWith('~/') || s === '~') {
        s = path.join(os.homedir(), s.slice(1));
    }
    // 绝对化
    if (!path.isAbsolute(s)) {
        s = path.resolve(process.cwd(), s);
    }
    // 末尾 / 去掉
    if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
    // Windows: 盘符大写
    if (process.platform === 'win32') {
        s = s.replace(/^([a-z]):/i, (_, c) => c.toUpperCase() + ':');
    }
    return s;
}

/**
 * Glob → 正则
 * 支持: *  **  ?  [abc]  {a,b}
 */
export function globToRegex(glob: string): RegExp {
    // 转义正则特殊字符 (但保留 *, ?, [, {, })
    let s = glob
        .replace(/[.+^$|()\\]/g, '\\$&')
        .replace(/!/g, '\\!');

    // 替换 ** → 占位符 (避免被 * 吞掉)
    s = s.replace(/\*\*/g, '\x00DOUBLESTAR\x00');

    // 替换 * → 任意 (不含 /)
    s = s.replace(/\*/g, '[^/]*');

    // 还原 ** → 任意 (含 /)
    s = s.replace(/\x00DOUBLESTAR\x00/g, '.*');

    // ? → 单字符 (不含 /)
    s = s.replace(/\?/g, '[^/]');

    // [abc] 字符集 — 已在上面转义, 这里不需要
    // 但 glob 里的 [abc] 不是正则特殊字符, 我们的转义没动 [ ]
    // 验证: [a-z] 保持原样就是合法正则

    // {a,b} → (a|b)
    s = s.replace(/\{([^}]+)\}/g, (_, inner) => {
        const alts = inner.split(',').map((x: string) => x.trim()).join('|');
        return `(${alts})`;
    });

    return new RegExp('^' + s + '$', 'i');
}

/**
 * 路径是否匹配任一 glob
 */
export function matchAny(normalizedPath: string, patterns: string[]): { matched: boolean; pattern?: string } {
    for (const pat of patterns) {
        const normPat = normalizePath(pat);
        const re = globToRegex(normPat);
        if (re.test(normalizedPath)) {
            return { matched: true, pattern: pat };
        }
    }
    return { matched: false };
}

/**
 * 校验规则结构
 * 返回 { ok, errors }
 */
export function validate(rules: unknown): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!rules || typeof rules !== 'object') {
        return { ok: false, errors: ['rules must be an object'] };
    }
    const r = rules as Record<string, any>;
    for (const k of ['allow', 'deny', 'prompt']) {
        if (r[k] !== undefined && !Array.isArray(r[k])) {
            errors.push(`${k} must be an array`);
        }
        if (Array.isArray(r[k])) {
            for (let i = 0; i < r[k].length; i++) {
                if (typeof r[k][i] !== 'string') {
                    errors.push(`${k}[${i}] must be string`);
                }
            }
        }
    }
    if (r.maxFileSize !== undefined && (typeof r.maxFileSize !== 'number' || r.maxFileSize < 0)) {
        errors.push('maxFileSize must be non-negative number');
    }
    if (r.maxTotalSize !== undefined && (typeof r.maxTotalSize !== 'number' || r.maxTotalSize < 0)) {
        errors.push('maxTotalSize must be non-negative number');
    }
    return { ok: errors.length === 0, errors };
}

/**
 * 加载规则
 * - 不存在: 写默认 + 返默认
 * - 存在但 JSON 错: 返默认 + 标 invalid
 * - 存在且有效: 返内容
 */
export async function load(filePath: string): Promise<{ rules: SandboxRules; source: 'file' | 'default' | 'invalid'; errors?: string[] }> {
    try {
        const text = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(text);
        const v = validate(parsed);
        if (!v.ok) {
            return { rules: defaultRules(), source: 'invalid', errors: v.errors };
        }
        return { rules: parsed as SandboxRules, source: 'file' };
    } catch (e: any) {
        if (e?.code === 'ENOENT') {
            // 首次启动 — 写默认
            try {
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                const def = defaultRules();
                await fs.writeFile(filePath, JSON.stringify(def, null, 2), 'utf-8');
            } catch {
                /* 写盘失败也用默认 */
            }
            return { rules: defaultRules(), source: 'default' };
        }
        // JSON 错等
        return { rules: defaultRules(), source: 'invalid', errors: [String(e?.message || e)] };
    }
}

/**
 * 保存规则
 * - 校验通过才写
 * - 自动 +1 version
 */
export async function save(filePath: string, rules: SandboxRules): Promise<{ ok: boolean; errors?: string[] }> {
    const v = validate(rules);
    if (!v.ok) return { ok: false, errors: v.errors };
    const next: SandboxRules = {
        ...rules,
        version: (rules.version || 0) + 1,
        updatedAt: Date.now(),
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf-8');
    return { ok: true };
}
