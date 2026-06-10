import { describe, it, expect, vi } from 'vitest';
import { sendAlert } from './alerts.js';

describe('alerts', () => {
    it('oversize file alert', async () => {
        const push = vi.fn();
        await sendAlert({ kind: 'oversize-file', file: '/x', size: 200 }, push);
        expect(push).toHaveBeenCalledOnce();
        expect(push.mock.calls[0][0].type).toBe('cleaner_alert');
        expect(push.mock.calls[0][0].level).toBe('warning');
    });

    it('total-quota alert', async () => {
        const push = vi.fn();
        await sendAlert({ kind: 'total-quota', totalBytes: 2 * 1024 ** 3 }, push);
        expect(push).toHaveBeenCalledOnce();
        expect(push.mock.calls[0][0].message).toContain('GB');
    });
});
