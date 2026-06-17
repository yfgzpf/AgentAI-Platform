/**
 * SkillOrchestrator — 通用技能调度器
 * ----------------------------------------------------------------
 * 学自: OpenClaw Unified Orchestrator (handler.py)
 * 
 * 架构:
 *   - 动态技能发现 (扫描技能目录)
 *   - smart_dispatch (关键词匹配自动路由)
 *   - 统一 execute(skillName, params) 接口
 *   - 技能注册 → IndustryEngine 的行业技能接入此调度器
 * 
 * 与 IndustryEngine 的关系:
 *   IndustryEngine 定义行业技能 (装修/建筑/园林)
 *   SkillOrchestrator 统一注册 + 调度
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(os.homedir(), '.agentai');
const SKILLS_ROOT = path.join(AGENTAI_DIR, 'skills');

export interface SkillDescriptor {
  name: string;
  description: string;
  category: string;
  tags: string[];
  handlerPath?: string;
  handler?: (args: any, ctx?: any) => Promise<{ success: boolean; output: string; data?: any }>;
  parameters?: Record<string, any>;
  parallelSafe?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
}

export class SkillOrchestrator extends EventEmitter {
  private skills = new Map<string, SkillDescriptor>();
  private keywordIndex = new Map<string, string[]>();

  /** 注册技能 */
  register(skill: SkillDescriptor): void {
    this.skills.set(skill.name, skill);

    // 构建关键词索引
    const keywords = this.extractKeywords(skill);
    for (const kw of keywords) {
      const list = this.keywordIndex.get(kw) || [];
      if (!list.includes(skill.name)) list.push(skill.name);
      this.keywordIndex.set(kw, list);
    }
  }

  /** 批量注册 (行业引擎技能接入点) */
  registerAll(skills: SkillDescriptor[]): void {
    for (const s of skills) this.register(s);
    this.emit('skills:loaded', { count: skills.length });
  }

  /** 从目录扫描 SKILL.md 并注册 */
  scanDirectory(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;

        const meta = this.parseSkillMd(skillMd);
        if (!meta.name) continue;

        const handlerPy = path.join(dir, entry.name, 'handler.py');
        const handlerTs = path.join(dir, entry.name, 'handler.ts');
        const handlerPath = fs.existsSync(handlerPy) ? handlerPy : fs.existsSync(handlerTs) ? handlerTs : undefined;

        this.register({
          name: meta.name,
          description: meta.description || meta.name,
          category: meta.category || 'uncategorized',
          tags: meta.tags || [],
          handlerPath,
          parameters: meta.parameters,
          parallelSafe: true,
          riskLevel: 'low',
        });
        count++;
      }
    } catch {}
    if (count > 0) console.log(`[orchestrator] scanned ${count} skills from ${dir}`);
    return count;
  }

  /**
   * smart_dispatch: 根据用户消息自动匹配最合适的技能
   * 返回技能名称列表，按匹配度排序
   */
  smartDispatch(userMessage: string, limit = 3): Array<{ name: string; score: number; description: string }> {
    const lower = userMessage.toLowerCase();
    const scores = new Map<string, number>();

    for (const [name, skill] of this.skills) {
      let score = 0;
      // 名称匹配
      if (lower.includes(skill.name.toLowerCase())) score += 10;
      // 描述关键词匹配
      for (const tag of skill.tags) {
        if (lower.includes(tag.toLowerCase())) score += 5;
      }
      // 描述匹配
      const descWords = skill.description.toLowerCase().split(/\s+/);
      for (const w of descWords) {
        if (w.length >= 2 && lower.includes(w)) score += 1;
      }
      if (score > 0) scores.set(name, score);
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([name, score]) => ({
        name,
        score,
        description: this.skills.get(name)?.description || '',
      }));
  }

  /** 按名称查找技能 */
  get(name: string): SkillDescriptor | undefined {
    return this.skills.get(name);
  }

  /** 列出所有技能 */
  list(): SkillDescriptor[] {
    return [...this.skills.values()];
  }

  /** 列出指定分类的技能 */
  listByCategory(category: string): SkillDescriptor[] {
    return [...this.skills.values()].filter(s => s.category === category);
  }

  /** 构建系统提示词片段 (列出可用技能) */
  buildAvailableSkillsPrompt(tokenLimit = 2000): string {
    const lines: string[] = ['## 可用技能\n'];
    let tokens = 0;
    for (const [name, skill] of this.skills) {
      const line = `- **${name}**: ${skill.description} [${skill.category}]`;
      if (tokens + line.length > tokenLimit) {
        lines.push(`- … 还有 ${this.skills.size - lines.length} 个技能`);
        break;
      }
      tokens += line.length;
      lines.push(line);
    }
    return lines.join('\n');
  }

  private extractKeywords(skill: SkillDescriptor): string[] {
    const words = new Set<string>();
    for (const tag of skill.tags) words.add(tag.toLowerCase());
    for (const w of skill.description.toLowerCase().split(/[\s,，、]+/)) {
      if (w.length >= 2) words.add(w);
    }
    words.add(skill.name.toLowerCase());
    return [...words];
  }

  private parseSkillMd(filePath: string): Partial<SkillDescriptor> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);
      const result: Partial<SkillDescriptor & { tags?: string[] }> = {};

      if (frontMatter) {
        for (const line of frontMatter[1]!.split('\n')) {
          const [key, ...rest] = line.split(':');
          if (!key || rest.length === 0) continue;
          const val = rest.join(':').trim();
          switch (key.trim()) {
            case 'name': result.name = val; break;
            case 'description': result.description = val; break;
            case 'category': result.category = val; break;
            case 'tags':
              result.tags = val.replace(/[\[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
              break;
          }
        }
      }
      return result;
    } catch { return {}; }
  }
}

export const skillOrchestrator = new SkillOrchestrator();
