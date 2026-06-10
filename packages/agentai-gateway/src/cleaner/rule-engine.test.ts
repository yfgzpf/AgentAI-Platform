import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { matchRule, loadRules } from './rule-engine.js';
import type { Rule, FileMeta } from './types.js';

const rules: Rule[] = [
    { id: 'old-tmp', match: { path: '~/.agentai/tmp/*', mtimeDaysAgo: '>7' }, action: 'delete', risk: 'safe' },
    { id: 'big', match: { sizeBytes: '>100' }, action: 'alert', risk: 'alert' },
    { id: 'total', match: { totalBytes: '>1000' }, action: 'alert', risk: 'alert' },
];

const now = Date.now();
const eightDaysAgo = now - 8 * 86_400_000;
const file = (over: Partial<FileMeta> = {}): FileMeta => ({
    path: '/x/y.txt', size: 50, mtime: eightDaysAgo, atime: now, isFile: true, ...over,
});

describe('rule-engine', () => {
    it('matches by path glob with ~', () => {
        const r = matchRule(rules, file({ path: '/home/u/.agentai/tmp/x.log' }), { home: '/home/u', workspace: '/ws' });
        expect(r?.id).toBe('old-tmp');
    });

    it('matches by sizeBytes', () => {
        const r = matchRule(rules, file({ size: 200 }));
        expect(r?.id).toBe('big');
    });

    it('returns null when no match', () => {
        const r = matchRule(rules, file({ size: 50 }), { home: '/h', workspace: '/w' });
        expect(r).toBeNull();
    });

    it('expands <workspace> in path', () => {
        const wsRules: Rule[] = [{ id: 'ws', match: { path: '<workspace>/.agentai/x' }, action: 'delete', risk: 'safe' }];
        const r = matchRule(wsRules, file({ path: '/ws/.agentai/x' }), { home: '/h', workspace: '/ws' });
        expect(r?.id).toBe('ws');
    });
});

describe('loadRules', () => {
    it('loads JSON file from rules.json', async () => {
        const p = path.join(__dirname, 'rules.json');
        const rs = await loadRules(p);
        expect(rs.length).toBeGreaterThan(0);
        // 必须至少有 11 条内置规则
        expect(rs.length).toBeGreaterThanOrEqual(11);
    });
});
