import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CleanerDaemon } from './index.js';
import type { Rule } from './types.js';

describe('CleanerDaemon', () => {
    it('runs safe items and reports bytesFreed', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-'));
        const audit = { log: vi.fn() };
        const rules: Rule[] = [{ id: 'safe', match: { path: tmp + '/*' }, action: 'delete', risk: 'safe' }];
        await fs.writeFile(path.join(tmp, 'x'), 'x');
        const d = new CleanerDaemon({
            rules, stateDir: tmp + '/state', scanRoots: [tmp], workspace: tmp,
            audit: audit as any,
        });
        const r = await d.runOnce({ scope: 'safe' });
        expect(r.bytesFreed).toBeGreaterThan(0);
        await expect(fs.access(path.join(tmp, 'x'))).rejects.toThrow();
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('places risky items into pendingRiskyPlans', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-'));
        const audit = { log: vi.fn() };
        const rules: Rule[] = [{ id: 'risky', match: { path: tmp + '/*' }, action: 'confirm-required', risk: 'risky' }];
        await fs.writeFile(path.join(tmp, 'y'), 'y');
        const d = new CleanerDaemon({
            rules, stateDir: tmp + '/state', scanRoots: [tmp], workspace: tmp,
            audit: audit as any,
        });
        const r = await d.runOnce({ scope: 'all' });
        expect(r.riskyCount).toBe(1);
        expect(r.bytesFreed).toBe(0);
        const state = await d.getState();
        expect(state.pendingRiskyPlans.length).toBe(1);
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('confirmPlan approve executes and removes from queue', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-'));
        const audit = { log: vi.fn() };
        const rules: Rule[] = [{ id: 'risky-del', match: { path: tmp + '/*' }, action: 'delete', risk: 'risky' }];
        const f = path.join(tmp, 'z');
        await fs.writeFile(f, 'zz');
        const d = new CleanerDaemon({
            rules, stateDir: tmp + '/state', scanRoots: [tmp], workspace: tmp,
            audit: audit as any,
        });
        await d.runOnce({ scope: 'all' });
        const s1 = await d.getState();
        const planId = s1.pendingRiskyPlans[0]!.planId;
        const r = await d.confirmPlan(planId, 'approve');
        expect(r.ok).toBe(true);
        expect((await d.getState()).pendingRiskyPlans.length).toBe(0);
        await expect(fs.access(f)).rejects.toThrow();
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('start() should initialize nextQuickCheckAt and nextFullRunAt', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-'));
        const audit = { log: vi.fn() };
        const rules: Rule[] = [];
        const d = new CleanerDaemon({
            rules, stateDir: tmp + '/state', scanRoots: [tmp], workspace: tmp,
            audit: audit as any,
        });
        const before = Date.now();
        await d.start();
        const state = await d.getState();
        // nextQuickCheckAt ≈ before + 5min
        expect(state.nextQuickCheckAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
        expect(state.nextQuickCheckAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 200);
        // nextFullRunAt ≈ before + 1h
        expect(state.nextFullRunAt).toBeGreaterThanOrEqual(before + 60 * 60 * 1000);
        expect(state.nextFullRunAt).toBeLessThanOrEqual(Date.now() + 60 * 60 * 1000 + 200);
        d.stop();
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('runOnce() should roll nextQuickCheckAt (+5min) and nextFullRunAt (+24h)', async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'daemon-'));
        const audit = { log: vi.fn() };
        const rules: Rule[] = [];
        const d = new CleanerDaemon({
            rules, stateDir: tmp + '/state', scanRoots: [tmp], workspace: tmp,
            audit: audit as any,
        });
        await d.start();
        const before = Date.now();
        const r = await d.runOnce({ scope: 'safe' });
        expect(r.bytesFreed).toBeGreaterThanOrEqual(0);
        const state = await d.getState();
        // nextQuickCheckAt 滚动到 +5min
        expect(state.nextQuickCheckAt).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
        expect(state.nextQuickCheckAt).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 200);
        // nextFullRunAt 滚动到 +24h(任一 scope 都滚动, 见 spec)
        expect(state.nextFullRunAt).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
        expect(state.nextFullRunAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 200);
        d.stop();
        await fs.rm(tmp, { recursive: true, force: true });
    });
});
