import { describe, it, expect } from 'vitest';
import { plan } from './planner.js';
import type { Rule, FileMeta } from './types.js';

const rules: Rule[] = [
    { id: 'safe-del', match: { path: '/tmp/*' }, action: 'delete', risk: 'safe' },
    { id: 'risky-conf', match: { path: '/tasks/*' }, action: 'confirm-required', risk: 'risky' },
    { id: 'alert', match: { sizeBytes: '>1000' }, action: 'alert', risk: 'alert' },
];
const file = (p: string, size: number): FileMeta => ({ path: p, size, mtime: 0, atime: 0, isFile: true });

describe('planner', () => {
    it('separates safe, risky, alerts', () => {
        const r = plan(rules, [file('/tmp/a', 10), file('/tasks/b', 20), file('/big/c', 2000)], { home: '/h', workspace: '/w' });
        expect(r.safe.length).toBe(1);
        expect(r.risky.length).toBe(1);
        expect(r.alerts.length).toBe(1);
    });

    it('assigns planId starting with p_', () => {
        const r = plan(rules, [file('/tmp/a', 10)], { home: '/h', workspace: '/w' });
        expect(r.safe[0].planId).toMatch(/^p_/);
    });
});
