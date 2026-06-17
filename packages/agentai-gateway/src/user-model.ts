/**
 * UserModel — Honcho 4维度用户建模
 * ----------------------------------------------------------------
 * 学自: Honcho 辩证推理 (Hermes 分析报告)
 * 
 * 4 维度:
 *   - identity: 用户身份 (行业/角色/偏好)
 *   - behavior: 行为模式 (常用工具/交互频率/任务类型)
 *   - preferences: 偏好 (回复风格/模型/语言)
 *   - history: 历史摘要 (最近N次对话精华)
 * 
 * 存储: .agentai/user-model.json
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { WorkspaceManager } from './workspace-manager.js';

const USER_MODEL_FILE = (() => {
  try { return WorkspaceManager.getInstance().userModelPath; }
  catch { return path.join(os.homedir(), '.agentai', 'user-model.json'); }
})();

export interface UserIdentity {
  name: string;
  industry?: string;
  industrySkills?: string[];
  role?: string;
  onboardedAt?: number;
  questionnaire?: Record<string, string>;  // 行业问卷答案
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

class UserModelEngine {
  private model: UserModel;
  private previousIndustry: string | undefined;

  constructor() {
    this.model = this.load();
    this.previousIndustry = this.model.identity.industry;
  }

  private load(): UserModel {
    try {
      if (fs.existsSync(USER_MODEL_FILE)) {
        return { ...DEFAULT_MODEL, ...JSON.parse(fs.readFileSync(USER_MODEL_FILE, 'utf-8')) };
      }
    } catch {}
    return { ...DEFAULT_MODEL };
  }

  private save() {
    try {
      const dir = path.dirname(USER_MODEL_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.model.updatedAt = Date.now();
      fs.writeFileSync(USER_MODEL_FILE, JSON.stringify(this.model, null, 2), 'utf-8');
    } catch {}
  }

  /** 设置用户身份 (Onboarding 后调用) */
  setIdentity(id: Partial<UserIdentity>) {
    this.model.identity = { ...this.model.identity, ...id };
    this.save();

    // 行业变更检测 → 触发知识补全
    const newIndustry = this.model.identity.industry;
    if (newIndustry && newIndustry !== this.previousIndustry) {
      this.previousIndustry = newIndustry;
      this.triggerIndustryKnowledgeEnrichment(newIndustry).catch(() => {});
    }
  }

  /** 行业知识自动补全: 检查记忆 → 联网搜索 → 写入记忆 */
  private async triggerIndustryKnowledgeEnrichment(industry: string): Promise<void> {
    try {
      const { readMemory, writeMemory } = await import('./memory.js');
      // 1. 检查是否已有该行业记忆
      const existing = await readMemory({ userId: 'system', workspace: '', limit: 50 });
      const industryMems = existing.filter(m =>
        m.industry === industry || (m.content && m.content.includes(industry))
      );

      // 2. 如果已有 3 条以上行业记忆，跳过联网搜索
      if (industryMems.length >= 3) return;

      // 3. 联网搜索行业知识 (Bing)
      const searchOutput = await this.webSearchBing(`${industry}行业 核心知识 工作流程 专业术语 最新趋势`);

      if (searchOutput) {
        await writeMemory({
          userId: 'system',
          content: `[行业知识自动补全] ${industry}\n${searchOutput.slice(0, 800)}`,
          industry,
          type: 'industry_knowledge',
        });
      }

      // 4. 搜索用户行为记忆
      const behaviorOutput = await this.webSearchBing(`${industry}从业者 常用工具 典型工作场景 AI辅助需求`);

      if (behaviorOutput) {
        await writeMemory({
          userId: 'system',
          content: `[行业行为洞察] ${industry}\n${behaviorOutput.slice(0, 600)}`,
          industry,
          type: 'industry_behavior',
        });
      }

      console.log(`[industry-enrichment] completed for ${industry}`);
    } catch (e: any) {
      console.warn(`[industry-enrichment] failed for ${industry}: ${e.message}`);
    }
  }

  /** Bing 搜索 (轻量级, 不依赖工具注册表) */
  private async webSearchBing(query: string): Promise<string | null> {
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
    } catch {
      return null;
    }
  }

  /** 记录一次交互 */
  recordInteraction(opts: {
    toolsUsed: string[];
    taskCategory?: string;
    messageCount: number;
    model: string;
  }) {
    const b = this.model.behavior;
    b.totalSessions++;
    b.totalMessages += opts.messageCount;
    b.lastActive = Date.now();
    b.avgSessionLength = Math.round(b.totalMessages / b.totalSessions);

    // 工具频率
    for (const tool of opts.toolsUsed) {
      const entry = b.topTools.find(t => t.name === tool);
      if (entry) entry.count++;
      else b.topTools.push({ name: tool, count: 1 });
    }
    b.topTools = b.topTools.sort((a, b) => b.count - a.count).slice(0, 10);

    // 任务类型频率
    if (opts.taskCategory) {
      b.taskTypeFrequency[opts.taskCategory] = (b.taskTypeFrequency[opts.taskCategory] || 0) + 1;
    }

    // 活跃小时
    const hour = new Date().getHours();
    if (!b.activeHours.includes(hour)) {
      b.activeHours.push(hour);
      b.activeHours.sort();
    }

    // 模型偏好更新
    if (opts.model !== this.model.preferences.preferredModel) {
      this.model.preferences.preferredModel = opts.model;
    }

    this.save();
  }

  /** 记录历史快照 */
  addHistorySnapshot(snapshot: Omit<HistorySnapshot, 'ts'>) {
    this.model.history.unshift({ ...snapshot, ts: Date.now() });
    // 保留最近 50 条
    if (this.model.history.length > 50) this.model.history = this.model.history.slice(0, 50);
    this.save();
  }

  /** 设置偏好 */
  setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    this.model.preferences[key] = value;
    this.save();
  }

  /** 获取模型 */
  get(): UserModel { return this.model; }

  /** 构建系统提示词注入 */
  buildSystemPromptFragment(): string {
    const id = this.model.identity;
    const b = this.model.behavior;
    const p = this.model.preferences;
    const recentHistory = this.model.history.slice(0, 3);

    let frag = `\n# User Profile (Honcho)\n`;
    frag += `User: ${id.name}${id.industry ? `, Industry: ${id.industry}` : ''}${id.role ? `, Role: ${id.role}` : ''}\n`;
    frag += `Sessions: ${b.totalSessions}, Messages: ${b.totalMessages}, Avg/Len: ${b.avgSessionLength}\n`;
    frag += `Prefers: ${p.replyStyle} style, Model: ${p.preferredModel}\n`;

    // 行业技能注入
    if (id.industrySkills && id.industrySkills.length > 0) {
      frag += `Industry skills: ${id.industrySkills.join(', ')}\n`;
    }

    // 行业问卷知识注入
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
}

export const userModel = new UserModelEngine();
