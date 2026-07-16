/**
 * UserModel — Honcho 4维度用户建模 (多用户版)
 * ----------------------------------------------------------------
 * 存储: ~/.agentai/user-models.json   (Map<userId, UserModel>)
 *
 * 4 维度:
 *   - identity: 用户身份 (行业/角色/偏好)
 *   - behavior: 行为模式 (常用工具/交互频率/任务类型)
 *   - preferences: 偏好 (回复风格/模型/语言)
 *   - history: 历史摘要 (最近N次对话精华)
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

const USER_MODELS_FILE = path.join(os.homedir(), '.agentai', 'user-models.json');

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export interface UserIdentity {
  name: string;
  industry?: string;
  industrySkills?: string[];
  role?: string;
  onboardedAt?: number;
  questionnaire?: Record<string, string>;
}

export interface UserBehavior {
  totalSessions: number;
  totalMessages: number;
  topTools: Array<{ name: string; count: number }>;
  taskTypeFrequency: Record<string, number>;
  avgSessionLength: number;
  lastActive: number;
  activeHours: number[];
}

export interface UserPreferences {
  replyStyle: 'concise' | 'detailed' | 'friendly';
  preferredModel: string;
  language: string;
  autoMode: boolean;
  soundEnabled: boolean;
  desktopNotifyEnabled: boolean;
}

export interface HistorySnapshot {
  summary: string;
  ts: number;
  sessionId: string;
  keyOutcomes: string[];
}

export interface UserModel {
  identity: UserIdentity;
  behavior: UserBehavior;
  preferences: UserPreferences;
  history: HistorySnapshot[];
  updatedAt: number;
}

const DEFAULT_MODEL: UserModel = {
  identity: { name: 'User' },
  behavior: {
    totalSessions: 0, totalMessages: 0, topTools: [],
    taskTypeFrequency: {}, avgSessionLength: 0,
    lastActive: 0, activeHours: [],
  },
  preferences: {
    replyStyle: 'friendly', preferredModel: 'agentai',
    language: 'zh', autoMode: true,
    soundEnabled: true, desktopNotifyEnabled: true,
  },
  history: [],
  updatedAt: Date.now(),
};

// ---------------------------------------------------------------------------
// 多用户引擎
// ---------------------------------------------------------------------------

class UserModelEngine {
  private models: Record<string, UserModel> = {};
  private previousIndustry: Record<string, string | undefined> = {};
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.loadAll();
  }

  // ---- 存储 ----

  private loadAll(): void {
    try {
      if (fs.existsSync(USER_MODELS_FILE)) {
        const raw = JSON.parse(fs.readFileSync(USER_MODELS_FILE, 'utf-8'));
        this.models = raw || {};
        // 记录所有已有用户的行业
        for (const uid of Object.keys(this.models)) {
          this.previousIndustry[uid] = this.models[uid]!.identity.industry;
        }
        return;
      }
    } catch { /* ignore */ }
    this.models = {};
  }

  private _scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.dirty) return;
      this.dirty = false;
      try {
        const dir = path.dirname(USER_MODELS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(USER_MODELS_FILE, JSON.stringify(this.models, null, 2), 'utf-8');
      } catch {}
    }, 500); // 防抖 500ms
  }

  // ---- 内部工具 ----

  private _ensureUser(userId: string): UserModel {
    if (!this.models[userId]) {
      this.models[userId] = { ...DEFAULT_MODEL, identity: { ...DEFAULT_MODEL.identity } };
    }
    return this.models[userId];
  }

  private _resolve(userId?: string): string {
    return userId || 'default';
  }

  // ---- 公开 API (全部接受 userId) ----

  /** 设置用户身份 (Onboarding 后调用) */
  setIdentity(userId: string, id: Partial<UserIdentity>): void {
    const uid = this._resolve(userId);
    const model = this._ensureUser(uid);
    model.identity = { ...model.identity, ...id };
    model.updatedAt = Date.now();
    this._scheduleSave();

    // 行业变更检测 → 触发知识补全
    const newIndustry = model.identity.industry;
    if (newIndustry && newIndustry !== this.previousIndustry[uid]) {
      this.previousIndustry[uid] = newIndustry;
      this.triggerIndustryKnowledgeEnrichment(newIndustry).catch(() => {});
    }
  }

  /** 记录一次交互 */
  recordInteraction(userId: string, opts: {
    toolsUsed: string[];
    taskCategory?: string;
    messageCount: number;
    model: string;
  }): void {
    const uid = this._resolve(userId);
    const model = this._ensureUser(uid);
    const b = model.behavior;
    b.totalSessions++;
    b.totalMessages += opts.messageCount;
    b.lastActive = Date.now();
    b.avgSessionLength = Math.round(b.totalMessages / b.totalSessions);

    for (const tool of opts.toolsUsed) {
      const entry = b.topTools.find(t => t.name === tool);
      if (entry) entry.count++;
      else b.topTools.push({ name: tool, count: 1 });
    }
    b.topTools = b.topTools.sort((a, b) => b.count - a.count).slice(0, 10);

    if (opts.taskCategory) {
      b.taskTypeFrequency[opts.taskCategory] = (b.taskTypeFrequency[opts.taskCategory] || 0) + 1;
    }

    const hour = new Date().getHours();
    if (!b.activeHours.includes(hour)) {
      b.activeHours.push(hour);
      b.activeHours.sort();
    }

    if (opts.model !== model.preferences.preferredModel) {
      model.preferences.preferredModel = opts.model;
    }

    model.updatedAt = Date.now();
    this._scheduleSave();
  }

  /** 记录历史快照 */
  addHistorySnapshot(userId: string, snapshot: Omit<HistorySnapshot, 'ts'>): void {
    const uid = this._resolve(userId);
    const model = this._ensureUser(uid);
    model.history.unshift({ ...snapshot, ts: Date.now() });
    if (model.history.length > 50) model.history = model.history.slice(0, 50);
    model.updatedAt = Date.now();
    this._scheduleSave();
  }

  /** 设置偏好 */
  setPreference<K extends keyof UserPreferences>(userId: string, key: K, value: UserPreferences[K]): void {
    const uid = this._resolve(userId);
    const model = this._ensureUser(uid);
    model.preferences[key] = value;
    model.updatedAt = Date.now();
    this._scheduleSave();
  }

  /** 获取某个用户的完整模型 */
  get(userId?: string): UserModel {
    return this._ensureUser(this._resolve(userId));
  }

  /** 获取所有用户 (管理用) */
  getAllUsers(): Record<string, UserModel> {
    return { ...this.models };
  }

  /** 列出所有已知 userId */
  listUserIds(): string[] {
    return Object.keys(this.models).filter(id => id !== 'default');
  }

  /** 构建系统提示词注入 (按用户) */
  buildSystemPromptFragment(userId?: string): string {
    const uid = this._resolve(userId);
    const model = this._ensureUser(uid);
    const id = model.identity;
    const b = model.behavior;
    const p = model.preferences;
    const recentHistory = model.history.slice(0, 3);

    let frag = `\n# User Profile (Honcho)\n`;
    frag += `User: ${id.name}${id.industry ? `, Industry: ${id.industry}` : ''}${id.role ? `, Role: ${id.role}` : ''}\n`;
    frag += `Sessions: ${b.totalSessions}, Messages: ${b.totalMessages}, Avg/Len: ${b.avgSessionLength}\n`;
    frag += `Prefers: ${p.replyStyle} style, Model: ${p.preferredModel}\n`;

    if (id.industrySkills && id.industrySkills.length > 0) {
      frag += `Industry skills: ${id.industrySkills.join(', ')}\n`;
    }

    if (id.questionnaire && Object.keys(id.questionnaire).length > 0) {
      frag += `User background (${id.industry || 'general'}):\n`;
      for (const [key, val] of Object.entries(id.questionnaire)) {
        if (val) frag += `  - ${key}: ${val}\n`;
      }
    }

    if (b.topTools.length > 0) {
      frag += `Top tools: ${b.topTools.slice(0, 5).map(t => `${t.name}(${t.count})`).join(', ')}\n`;
    }
    if (b.taskTypeFrequency && Object.keys(b.taskTypeFrequency).length > 0) {
      const taskEntries = Object.entries(b.taskTypeFrequency).sort((a, b) => b[1] - a[1]);
      frag += `Common tasks: ${taskEntries.slice(0, 3).map(([k, v]) => `${k}(${v})`).join(', ')}\n`;
    }
    if (recentHistory.length > 0) {
      frag += `Recent sessions:\n`;
      for (const h of recentHistory) {
        frag += `  - ${h.summary}\n`;
      }
    }
    return frag;
  }

  // ---- 行业知识补全 (不变) ----

  private async triggerIndustryKnowledgeEnrichment(industry: string): Promise<void> {
    try {
      const { readMemory, writeMemory } = await import('./memory.js');
      const existing = await readMemory({ userId: 'system', workspace: '', limit: 50 });
      const industryMems = existing.filter(m =>
        m.industry === industry || (m.content && m.content.includes(industry))
      );
      if (industryMems.length >= 3) return;

      const searchOutput = await this._webSearchBing(`${industry}行业 核心知识 工作流程 专业术语 最新趋势`);
      if (searchOutput) {
        await writeMemory({
          userId: 'system', workspace: '', role: 'system', source: 'auto_reflect',
          content: `[行业知识自动补全] ${industry}\n${searchOutput.slice(0, 800)}`,
          industry, metadata: { type: 'industry_knowledge' },
        });
      }
      const behaviorOutput = await this._webSearchBing(`${industry}从业者 常用工具 典型工作场景 AI辅助需求`);
      if (behaviorOutput) {
        await writeMemory({
          userId: 'system', workspace: '', role: 'system', source: 'auto_reflect',
          content: `[行业行为洞察] ${industry}\n${behaviorOutput.slice(0, 600)}`,
          industry, metadata: { type: 'industry_behavior' },
        });
      }
      console.log(`[industry-enrichment] completed for ${industry}`);
    } catch (e: any) {
      console.warn(`[industry-enrichment] failed for ${industry}: ${e.message}`);
    }
  }

  private async _webSearchBing(query: string): Promise<string | null> {
    try {
      const r = await fetch(`https://cn.bing.com/search?q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!r.ok) return null;
      const html = await r.text();
      const results: string[] = [];
      const re = /<li class="b_algo"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null && results.length < 5) {
        const title = (m[2] || '').replace(/<[^>]+>/g, '').trim();
        const snippetMatch = html.slice(m.index, m.index + 400).match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const snippet = snippetMatch ? snippetMatch[1]!.replace(/<[^>]+>/g, '').trim() : '';
        if (title) results.push(`${title}${snippet ? ' - ' + snippet : ''}`);
      }
      return results.length > 0 ? results.join('\n') : null;
    } catch { return null; }
  }
}

export const userModel = new UserModelEngine();
