import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { loadState, saveState } from './state.js';
import { EMPTY_STATE } from './types.js';

describe('cleaner state', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cleaner-state-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns EMPTY_STATE when no file', async () => {
        const s = await loadState(tmpDir);
        expect(s).toEqual(EMPTY_STATE);
    });

    it('roundtrips state via save/load', async () => {
        const s1 = { ...EMPTY_STATE, cumulativeBytes: 12345, lastFullRun: 1700000000000 };
        await saveState(tmpDir, s1);
        const s2 = await loadState(tmpDir);
        expect(s2.cumulativeBytes).toBe(12345);
        expect(s2.lastFullRun).toBe(1700000000000);
    });

    it('recovers from corruption via backup', async () => {
        // 主文件损坏,备份是有效的
        await fs.writeFile(path.join(tmpDir, 'state.json'), 'not json {{{', 'utf-8');
        await fs.writeFile(path.join(tmpDir, 'state.json.bak'), JSON.stringify({ ...EMPTY_STATE, cumulativeBytes: 999 }), 'utf-8');
        const s = await loadState(tmpDir);
        expect(s.cumulativeBytes).toBe(999);
    });

    it('preserves previous file as backup on save', async () => {
        await saveState(tmpDir, { ...EMPTY_STATE, cumulativeBytes: 100 });
        await saveState(tmpDir, { ...EMPTY_STATE, cumulativeBytes: 200 });
        const s = await loadState(tmpDir);
        expect(s.cumulativeBytes).toBe(200);
        // 备份应该是上一版 100
        const bak = JSON.parse(await fs.readFile(path.join(tmpDir, 'state.json.bak'), 'utf-8'));
        expect(bak.cumulativeBytes).toBe(100);
    });
});
