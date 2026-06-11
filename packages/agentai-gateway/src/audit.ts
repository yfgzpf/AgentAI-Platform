import * as fs from 'fs';
import * as path from 'path';

const BASE_DIR = path.join(process.cwd(), '.agentai', 'audit');

function ensureDir() {
  try { fs.mkdirSync(BASE_DIR, { recursive: true }); } catch {}
}

export function log(entry: { reqId?: string; userId: string; workspace: string; action: string; result: string; detail?: string; durationMs?: number }): void {
  try {
    ensureDir();
    const file = path.join(BASE_DIR, `${new Date().toISOString().slice(0, 10)}.ndjson`);
    fs.appendFileSync(file, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf-8');
  } catch {}
}

export function query(opts: { userId?: string; action?: string; since?: number; limit?: number }): any[] {
  try {
    const files = fs.readdirSync(BASE_DIR).filter(f => f.endsWith('.ndjson')).sort().slice(-7);
    const results: any[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(path.join(BASE_DIR, f), 'utf-8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (opts.userId && entry.userId !== opts.userId) continue;
          if (opts.action && entry.action !== opts.action) continue;
          if (opts.since && entry.ts < opts.since) continue;
          results.push(entry);
          if (opts.limit && results.length >= opts.limit) break;
        } catch {}
      }
      if (opts.limit && results.length >= opts.limit) break;
    }
    return results;
  } catch { return []; }
}

export function summary(since?: number): { total: number; byAction: Record<string, number> } {
  const entries = query({ since, limit: 10000 });
  const byAction: Record<string, number> = {};
  for (const e of entries) { byAction[e.action] = (byAction[e.action] || 0) + 1; }
  return { total: entries.length, byAction };
}

export function cleanup(beforeDays: number = 30): number {
  try {
    const files = fs.readdirSync(BASE_DIR).filter(f => f.endsWith('.ndjson'));
    let removed = 0;
    for (const f of files) {
      const dateStr = f.replace('.ndjson', '');
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;
      if (Date.now() - date.getTime() > beforeDays * 86400000) {
        fs.unlinkSync(path.join(BASE_DIR, f));
        removed++;
      }
    }
    return removed;
  } catch { return 0; }
}
