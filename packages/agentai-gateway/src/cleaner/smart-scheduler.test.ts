import { describe, it, expect } from 'vitest';
import { SmartScheduler, isUserIdleByHeartbeat } from './smart-scheduler.js';

describe('smart-scheduler', () => {
    it('skips when CPU high', async () => {
        const s = new SmartScheduler({ getCpuUsage: async () => 90, isUserIdle: async () => true });
        const d = await s.shouldRunDeepScan();
        expect(d.run).toBe(false);
        expect(d.reason).toContain('cpu');
    });

    it('skips when user not idle', async () => {
        const s = new SmartScheduler({ getCpuUsage: async () => 10, isUserIdle: async () => false });
        const d = await s.shouldRunDeepScan();
        expect(d.run).toBe(false);
        expect(d.reason).toContain('user');
    });

    it('runs when CPU low + user idle', async () => {
        const s = new SmartScheduler({ getCpuUsage: async () => 5, isUserIdle: async () => true });
        const d = await s.shouldRunDeepScan();
        expect(d.run).toBe(true);
    });

    it('isUserIdleByHeartbeat threshold', () => {
        expect(isUserIdleByHeartbeat(Date.now() - 6 * 60_000, 5 * 60_000)).toBe(true);
        expect(isUserIdleByHeartbeat(Date.now() - 1 * 60_000, 5 * 60_000)).toBe(false);
    });
});
