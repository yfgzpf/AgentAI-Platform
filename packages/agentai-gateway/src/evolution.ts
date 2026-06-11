import * as fs from 'fs';
import * as path from 'path';

interface EvolutionEntry {
  ts: number;
  type: 'success' | 'failure' | 'preference';
  content: string;
  metadata?: Record<string, any>;
}

export function writeEvolution(entry: Omit<EvolutionEntry, 'ts'>): void {
  try {
    const dir = path.join(process.cwd(), '.agentai');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'evolution.jsonl');
    fs.appendFileSync(file, JSON.stringify({ ...entry, ts: Date.now() }) + '\n', 'utf-8');
  } catch {}
}

export function readEvolution(limit: number = 50): EvolutionEntry[] {
  try {
    const file = path.join(process.cwd(), '.agentai', 'evolution.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l));
  } catch { return []; }
}

export function getSummary(): { successRate: number; topPreferences: string[]; recentTopics: string[] } {
  const entries = readEvolution(200);
  const successes = entries.filter(e => e.type === 'success').length;
  const total = entries.filter(e => e.type === 'success' || e.type === 'failure').length;
  const prefs = entries.filter(e => e.type === 'preference').map(e => e.content).slice(0, 5);
  const topics = entries.filter(e => e.type === 'success').map(e => e.content.slice(0, 50)).slice(0, 5);
  return {
    successRate: total > 0 ? successes / total : 0,
    topPreferences: prefs,
    recentTopics: topics,
  };
}
