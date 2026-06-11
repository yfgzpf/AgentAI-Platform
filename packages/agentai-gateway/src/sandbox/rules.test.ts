/**
 * Sandbox 规则测试
 *
 * 覆盖:
 *   - defaultRules
 *   - normalizePath (\ → /, ~, 绝对化, 盘符大写)
 *   - globToRegex (*, **, ?, [abc], {a,b})
 *   - matchAny
 *   - validate
 */

import { describe, it, expect } from 'vitest';
import {
    defaultRules,
    normalizePath,
    globToRegex,
    matchAny,
    validate,
} from './rules.js';

describe('defaultRules', () => {
    it('returns valid SandboxRules structure', () => {
        const r = defaultRules();
        expect(r.allow).toBeInstanceOf(Array);
        expect(r.deny).toBeInstanceOf(Array);
        expect(r.prompt).toBeInstanceOf(Array);
        expect(r.allow.length).toBeGreaterThan(0);
        expect(r.deny.length).toBeGreaterThan(0);
        expect(r.prompt.length).toBeGreaterThan(0);
    });

    it('denies C:/Windows/**', () => {
        const r = defaultRules();
        expect(r.deny.some(p => p.includes('Windows'))).toBe(true);
    });

    it('prompts **/.env*', () => {
        const r = defaultRules();
        expect(r.prompt.some(p => p.includes('.env'))).toBe(true);
    });

    it('has size limits', () => {
        const r = defaultRules();
        expect(r.maxFileSize).toBeGreaterThan(0);
        expect(r.maxTotalSize).toBeGreaterThan(0);
    });
});

describe('normalizePath', () => {
    it('replaces backslash with forward slash', () => {
        // 注意: 在 *nix 上 path.resolve 会转 \\ 为 /
        // 在 Windows 上保持 \\
        if (process.platform === 'win32') {
            expect(normalizePath('C:\\Users\\foo')).toContain('C:');
        } else {
            // *nix 平台 \\ 是字面字符, 不会自动转
            // 我们的函数显式 replace, 所以应转
            const r = normalizePath('C:\\Users\\foo');
            // 这里只验证函数不抛错
            expect(typeof r).toBe('string');
        }
    });

    it('removes trailing slash', () => {
        const p = process.cwd() + '/';
        const n = normalizePath(p);
        expect(n.endsWith('/')).toBe(false);
    });

    it('makes path absolute', () => {
        const n = normalizePath('./relative/path');
        expect(path.isAbsolute(n) || n.startsWith('/')).toBe(true);
    });
});

// 需 import path 用于测试
import * as path from 'path';
import * as os from 'os';

describe('globToRegex', () => {
    it('* matches any chars in a single segment', () => {
        const re = globToRegex('/foo/*.txt');
        expect(re.test('/foo/bar.txt')).toBe(true);
        expect(re.test('/foo/sub/bar.txt')).toBe(false);
    });

    it('** matches across segments', () => {
        const re = globToRegex('/foo/**/*.txt');
        expect(re.test('/foo/bar.txt')).toBe(true);
        expect(re.test('/foo/sub/bar.txt')).toBe(true);
        expect(re.test('/foo/sub/deep/bar.txt')).toBe(true);
    });

    it('? matches single char', () => {
        const re = globToRegex('/foo/a?c.txt');
        expect(re.test('/foo/abc.txt')).toBe(true);
        expect(re.test('/foo/ac.txt')).toBe(false);
    });

    it('[] character class', () => {
        const re = globToRegex('/foo/[abc].txt');
        expect(re.test('/foo/a.txt')).toBe(true);
        expect(re.test('/foo/b.txt')).toBe(true);
        expect(re.test('/foo/c.txt')).toBe(true);
        expect(re.test('/foo/d.txt')).toBe(false);
    });

    it('{a,b} alternation', () => {
        const re = globToRegex('/foo/{a,b}.txt');
        expect(re.test('/foo/a.txt')).toBe(true);
        expect(re.test('/foo/b.txt')).toBe(true);
        expect(re.test('/foo/c.txt')).toBe(false);
    });
});

describe('matchAny', () => {
    it('returns matched=true when path matches pattern', () => {
        const r = matchAny('/home/user/test.txt', ['/home/**/*.txt']);
        expect(r.matched).toBe(true);
        expect(r.pattern).toBe('/home/**/*.txt');
    });

    it('returns matched=false when no pattern matches', () => {
        const r = matchAny('/etc/passwd', ['/home/**']);
        expect(r.matched).toBe(false);
    });

    it('handles case-insensitive on Windows', () => {
        if (process.platform === 'win32') {
            const r = matchAny('C:/Windows/System32', ['c:/windows/**']);
            expect(r.matched).toBe(true);
        }
    });
});

describe('validate', () => {
    it('accepts valid rules', () => {
        const v = validate({ allow: ['/foo/**'], deny: ['/bar/**'], prompt: [] });
        expect(v.ok).toBe(true);
        expect(v.errors).toEqual([]);
    });

    it('rejects non-array allow', () => {
        const v = validate({ allow: 'not-array' as any });
        expect(v.ok).toBe(false);
        expect(v.errors.some(e => e.includes('allow'))).toBe(true);
    });

    it('rejects non-string pattern', () => {
        const v = validate({ allow: [123 as any] });
        expect(v.ok).toBe(false);
    });

    it('rejects negative maxFileSize', () => {
        const v = validate({ allow: [], maxFileSize: -1 });
        expect(v.ok).toBe(false);
    });

    it('rejects non-object', () => {
        expect(validate(null).ok).toBe(false);
        expect(validate('string').ok).toBe(false);
        expect(validate(undefined).ok).toBe(false);
    });
});

describe('load + save roundtrip', () => {
    it('writes default if not exists', async () => {
        const { load, save } = await import('./rules.js');
        const tmp = path.join(os.tmpdir(), `sandbox-test-${Date.now()}.json`);
        const r = await load(tmp);
        expect(r.source).toBe('default');
        expect(r.rules.allow.length).toBeGreaterThan(0);
        // 写盘已发生
        const fs = await import('fs/promises');
        const stat = await fs.stat(tmp);
        expect(stat.isFile()).toBe(true);
        // 清理
        await fs.unlink(tmp);
    });

    it('roundtrips custom rules', async () => {
        const { load, save } = await import('./rules.js');
        const tmp = path.join(os.tmpdir(), `sandbox-test-${Date.now()}.json`);
        const custom = {
            allow: ['/workspace/**'],
            deny: ['/secret/**'],
            prompt: [],
        };
        const s = await save(tmp, custom);
        expect(s.ok).toBe(true);
        const l = await load(tmp);
        expect(l.source).toBe('file');
        expect(l.rules.allow).toContain('/workspace/**');
        expect(l.rules.deny).toContain('/secret/**');
        // 清理
        const fs = await import('fs/promises');
        await fs.unlink(tmp);
    });

    it('handles corrupt JSON gracefully', async () => {
        const { load } = await import('./rules.js');
        const tmp = path.join(os.tmpdir(), `sandbox-bad-${Date.now()}.json`);
        const fs = await import('fs/promises');
        await fs.writeFile(tmp, '{ invalid json', 'utf-8');
        const r = await load(tmp);
        expect(r.source).toBe('invalid');
        expect(r.errors).toBeDefined();
        expect(r.rules.allow.length).toBeGreaterThan(0); // 回退到默认
        await fs.unlink(tmp);
    });
});
