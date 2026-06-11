import * as fs from 'fs';
import * as path from 'path';

interface RevertPreference {
  pattern: string;
  preference: string;
  count: number;
  lastLearned: number;
}

const LRU_MAX = 32;

export class RevertBridge {
  private cache = new Map<string, RevertPreference[]>();

  learn(workspace: string, _file: string, aiCode: string, userCode: string): { learned: boolean; insight: string } {
    const prefs = this._load(workspace);
    const diff = this._analyzeDiff(aiCode, userCode);
    if (!diff) return { learned: false, insight: 'no clear pattern' };

    const existing = prefs.find(p => p.pattern === diff.pattern);
    if (existing) {
      existing.count++;
      existing.preference = diff.preference;
      existing.lastLearned = Date.now();
    } else {
      prefs.push({ pattern: diff.pattern, preference: diff.preference, count: 1, lastLearned: Date.now() });
    }

    // LRU
    if (prefs.length > LRU_MAX) prefs.sort((a, b) => b.count - a.count).splice(LRU_MAX);
    this._save(workspace, prefs);
    this.cache.set(workspace, prefs);
    console.log(`[RevertLearner] 📝 Learned: ${diff.preference}`);
    return { learned: true, insight: diff.preference };
  }

  toSystemPrompt(workspace: string): string {
    const prefs = this._load(workspace);
    if (prefs.length === 0) return '';
    return `## 用户偏好\n${prefs.slice(0, 5).map(p => `- ${p.preference}`).join('\n')}`;
  }

  snapshot(workspace: string): { learned: number; patterns: string[] } {
    const prefs = this._load(workspace);
    return { learned: prefs.length, patterns: prefs.map(p => p.preference) };
  }

  reset(workspace: string): void {
    this.cache.delete(workspace);
    const file = path.join(workspace, '.agentai', 'preferences.json');
    try { fs.unlinkSync(file); } catch {}
  }

  private _load(workspace: string): RevertPreference[] {
    if (this.cache.has(workspace)) return this.cache.get(workspace)!;
    const file = path.join(workspace, '.agentai', 'preferences.json');
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
  }

  private _save(workspace: string, prefs: RevertPreference[]): void {
    const dir = path.join(workspace, '.agentai');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify(prefs, null, 2), 'utf-8');
  }

  private _analyzeDiff(aiCode: string, userCode: string): { pattern: string; preference: string } | null {
    const aiIndent = aiCode.match(/^ */m)?.[0]?.length || 0;
    const userIndent = userCode.match(/^ */m)?.[0]?.length || 0;
    if (userIndent !== aiIndent) return { pattern: 'indent', preference: `使用 ${userIndent}空格 缩进` };

    const aiQuotes = (aiCode.match(/'/g) || []).length;
    const userQuotes = (userCode.match(/'/g) || []).length;
    if (Math.abs(aiQuotes - userQuotes) > 2) return { pattern: 'quotes', preference: userQuotes > aiQuotes ? '使用 单引号' : '使用 双引号' };

    return null;
  }
}

export const revertBridge = new RevertBridge();
