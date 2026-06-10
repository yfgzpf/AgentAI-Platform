import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { scan } from './scanner.js';

describe('scanner', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cleaner-scan-'));
        await fs.writeFile(path.join(tmp, 'a.txt'), 'hello');
        await fs.mkdir(path.join(tmp, 'sub'));
        await fs.writeFile(path.join(tmp, 'sub', 'b.log'), 'world');
        await fs.mkdir(path.join(tmp, 'node_modules'));
        await fs.writeFile(path.join(tmp, 'node_modules', 'c.js'), 'skip');
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('walks files and returns metadata', async () => {
        const files = await scan({ roots: [tmp], maxDepth: 5, timeoutMs: 5000 });
        const paths = files.map(f => f.path).sort();
        expect(paths).toContain(path.join(tmp, 'a.txt'));
        expect(paths).toContain(path.join(tmp, 'sub', 'b.log'));
        // node_modules 默认跳过
        expect(paths).not.toContain(path.join(tmp, 'node_modules', 'c.js'));
    });

    it('respects maxDepth', async () => {
        const deep = path.join(tmp, 'd1', 'd2', 'd3');
        await fs.mkdir(deep, { recursive: true });
        await fs.writeFile(path.join(deep, 'x'), 'x');
        const files = await scan({ roots: [tmp], maxDepth: 2, timeoutMs: 5000 });
        expect(files.map(f => f.path)).not.toContain(path.join(deep, 'x'));
    });
});
