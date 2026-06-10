import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { executeSafe } from './executor.js';
import type { FileAction, AuditWriter } from './types.js';

const noopAudit: AuditWriter = { log: async () => { /* noop */ } };

describe('executor', () => {
    let tmp: string;

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'cleaner-exec-'));
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    it('deletes file', async () => {
        const f = path.join(tmp, 'a.txt');
        await fs.writeFile(f, 'x');
        const action: FileAction = {
            planId: 'p1', ruleId: 'r', risk: 'safe', action: 'delete',
            file: { path: f, size: 1, mtime: 0, atime: 0, isFile: true }
        };
        const r = await executeSafe([action], noopAudit);
        expect(r.bytesFreed).toBe(1);
        expect(r.failures).toEqual([]);
        await expect(fs.access(f)).rejects.toThrow();
    });

    it('gzip-archives ndjson', async () => {
        const f = path.join(tmp, '2025-01-01.ndjson');
        await fs.writeFile(f, '{"x":1}\n');
        const archiveDir = path.join(tmp, 'archive');
        const action: FileAction = {
            planId: 'p1', ruleId: 'r', risk: 'safe', action: 'gzip-archive',
            file: { path: f, size: 8, mtime: 0, atime: 0, isFile: true },
            archiveDir,
        };
        const r = await executeSafe([action], noopAudit);
        expect(r.bytesFreed).toBe(8);
        const gz = path.join(archiveDir, '2025-01-01.ndjson.gz');
        const stat = await fs.stat(gz);
        expect(stat.size).toBeGreaterThan(0);
    });

    it('move-archive', async () => {
        const f = path.join(tmp, 'old.json');
        await fs.writeFile(f, '{}');
        const archiveDir = path.join(tmp, 'archive');
        const action: FileAction = {
            planId: 'p1', ruleId: 'r', risk: 'safe', action: 'move-archive',
            file: { path: f, size: 2, mtime: 0, atime: 0, isFile: true },
            archiveDir,
        };
        const r = await executeSafe([action], noopAudit);
        expect(r.bytesFreed).toBe(2);
        expect(await fs.readdir(archiveDir)).toContain('old.json');
    });

    it('llm-free-archive keeps section titles only', async () => {
        const md = path.join(tmp, 'project_memory.md');
        const body = '# Top\n\n## Section A\n\nlong content\n\n## Section B\n\nmore content';
        await fs.writeFile(md, body);
        const archiveDir = path.join(tmp, 'archive');
        const action: FileAction = {
            planId: 'p1', ruleId: 'r', risk: 'safe', action: 'llm-free-archive',
            file: { path: md, size: body.length, mtime: 0, atime: 0, isFile: true },
            archiveDir,
        };
        await executeSafe([action], noopAudit);
        const archived = path.join(archiveDir, 'project_memory.md');
        const txt = await fs.readFile(archived, 'utf-8');
        expect(txt).toContain('## Section A');
        expect(txt).not.toContain('long content');
    });

    it('records failure but continues', async () => {
        const action: FileAction = {
            planId: 'p1', ruleId: 'r', risk: 'safe', action: 'delete',
            file: { path: path.join(tmp, 'nonexistent.txt'), size: 0, mtime: 0, atime: 0, isFile: true },
        };
        const r = await executeSafe([action], noopAudit);
        expect(r.failures.length).toBe(1);
    });
});
