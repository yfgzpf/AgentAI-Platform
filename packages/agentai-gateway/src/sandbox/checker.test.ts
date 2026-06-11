/**
 * Sandbox checker 测试
 *
 * 覆盖:
 *   - deny 优先级最高 (覆盖 allow)
 *   - prompt 优先级次之
 *   - 默认 deny (白名单模式)
 *   - 大小限制
 *   - 错误兜底
 */

import { describe, it, expect } from 'vitest';
import { check } from './checker.js';
import { defaultRules } from './rules.js';
import type { SandboxRules } from './types.js';

describe('check() priority', () => {
    it('deny > allow (deny path is denied even if in allow)', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: ['/workspace/secret/**'],
            prompt: [],
        };
        const r = check({ path: '/workspace/secret/password.txt', op: 'read' }, rules);
        expect(r.verdict).toBe('deny');
        expect(r.source).toBe('deny');
    });

    it('deny > prompt (deny path is denied, not prompted)', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: ['/workspace/sensitive/**'],
            prompt: ['/workspace/sensitive/**'],
        };
        const r = check({ path: '/workspace/sensitive/data.txt', op: 'read' }, rules);
        expect(r.verdict).toBe('deny');
    });

    it('prompt for sensitive patterns', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: ['**/.env*'],
        };
        const r = check({ path: '/workspace/.env.production', op: 'read' }, rules);
        expect(r.verdict).toBe('prompt');
        expect(r.source).toBe('prompt');
    });

    it('allow for whitelisted path', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
        };
        const r = check({ path: '/workspace/src/main.ts', op: 'read' }, rules);
        expect(r.verdict).toBe('allow');
        expect(r.source).toBe('allow');
    });

    it('default deny for unmatched path', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
        };
        const r = check({ path: '/etc/passwd', op: 'read' }, rules);
        expect(r.verdict).toBe('deny');
        expect(r.source).toBe('default');
    });
});

describe('check() size limits', () => {
    it('denies file exceeding maxFileSize', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
            maxFileSize: 1000,
        };
        const r = check({ path: '/workspace/big.bin', op: 'write', size: 2000 }, rules);
        expect(r.verdict).toBe('deny');
        expect(r.source).toBe('size');
    });

    it('allows file under maxFileSize', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
            maxFileSize: 1000,
        };
        const r = check({ path: '/workspace/small.bin', op: 'write', size: 500 }, rules);
        expect(r.verdict).toBe('allow');
    });

    it('denies total exceeding maxTotalSize', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
            maxTotalSize: 1000,
        };
        const r = check(
            { path: '/workspace/file.bin', op: 'write', size: 800 },
            rules,
            { currentTotal: 500 }, // 500 + 800 = 1300 > 1000
        );
        expect(r.verdict).toBe('deny');
        expect(r.source).toBe('size');
    });

    it('skip size check if size not provided', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
            maxFileSize: 1000,
        };
        const r = check({ path: '/workspace/file.bin', op: 'write' }, rules);
        expect(r.verdict).toBe('allow');
    });

    it('skip size check for read op', () => {
        const rules: SandboxRules = {
            allow: ['/workspace/**'],
            deny: [],
            prompt: [],
            maxFileSize: 1000,
        };
        const r = check({ path: '/workspace/file.bin', op: 'read', size: 99999 }, rules);
        expect(r.verdict).toBe('allow');
    });
});

describe('check() with default rules', () => {
    it('denies C:\\Windows\\System32', () => {
        if (process.platform === 'win32') {
            const r = check({ path: 'C:/Windows/System32/config.txt', op: 'read' }, defaultRules());
            expect(r.verdict).toBe('deny');
        }
    });

    it('prompts ~/.ssh/id_rsa', () => {
        const r = check({ path: require('os').homedir() + '/.ssh/id_rsa', op: 'read' }, defaultRules());
        // 可能 deny (因为 deny 含 ~/.ssh/**) 或 prompt (因为 prompt 含 **/id_rsa*)
        // deny 优先级高, 应为 deny
        expect(r.verdict).toBe('deny');
    });

    it('prompts workspace .env', () => {
        const r = check({ path: process.cwd() + '/.env.production', op: 'read' }, defaultRules());
        expect(r.verdict).toBe('prompt');
    });
});
