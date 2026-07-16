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

  /** 注销技能 (进化系统淘汰低质技能时调用) */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;
    this.skills.delete(name);
    // 清理关键词索引
    const keywords = this.extractKeywords(skill);
    for (const kw of keywords) {
      const list = this.keywordIndex.get(kw);
      if (list) {
        const idx = list.indexOf(name);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.keywordIndex.delete(kw);
      }
    }
    this.emit('skill:unregistered', { name });
    return true;
  }

  /** 从目录扫描 SKILL.md 并注册 (动态绑定 handler) */
  scanDirectory(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    try {
      // 递归扫描 (最多 2 层): skills/<category>/<skill>/SKILL.md
      const walk = (currentDir: string, depth: number) => {
        if (depth > 2) return;
        for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '_lib') continue;
          const subDir = path.join(currentDir, entry.name);
          const skillMd = path.join(subDir, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const registered = this._registerFromDir(subDir, skillMd);
            count += registered;
          } else {
            walk(subDir, depth + 1);
          }
        }
      };
      walk(dir, 0);
    } catch {}
    if (count > 0) console.log(`[orchestrator] scanned ${count} skills from ${dir}`);
    return count;
  }

  private _registerFromDir(skillDir: string, skillMd: string): number {
    const meta = this.parseSkillMd(skillMd);
    if (!meta.name) return 0;

    const handlerPy = path.join(skillDir, 'handler.py');
    const handlerTs = path.join(skillDir, 'handler.ts');
    const handlerJs = path.join(skillDir, 'index.js');
    const mainPy = path.join(skillDir, 'main.py');

    // 动态构建 handler — 发现脚本文件后自动绑定执行器
    let handler: SkillDescriptor['handler'] | undefined;
    let handlerPath: string | undefined;

    if (fs.existsSync(handlerPy)) {
      handlerPath = handlerPy;
      handler = async (args: any) => {
        try {
          const { callPython } = await import('./python-bridge.js');
          return await callPython(handlerPy!, args);
        } catch (e: any) {
          return { success: false, output: `Python skill error: ${e.message}` };
        }
      };
    } else if (fs.existsSync(mainPy)) {
      handlerPath = mainPy;
      handler = async (args: any) => {
        try {
          const { callPython } = await import('./python-bridge.js');
          return await callPython(mainPy, args);
        } catch (e: any) {
          return { success: false, output: `Python skill error: ${e.message}` };
        }
      };
    } else if (fs.existsSync(handlerTs)) {
      handlerPath = handlerTs;
      handler = async (args: any) => {
        try {
          const mod = await import(handlerTs!);
          const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
          if (typeof fn === 'function') return await fn(args);
          return { success: false, output: `TS skill has no executable export` };
        } catch (e: any) {
          return { success: false, output: `TS skill error: ${e.message}` };
        }
      };
    } else if (fs.existsSync(handlerJs)) {
      handlerPath = handlerJs;
      handler = async (args: any) => {
        try {
          const mod = await import(handlerJs!);
          const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
          if (typeof fn === 'function') return await fn(args);
          return { success: false, output: `JS skill has no executable export` };
        } catch (e: any) {
          return { success: false, output: `JS skill error: ${e.message}` };
        }
      };
    }

    this.register({
      name: meta.name,
      description: meta.description || meta.name,
      category: meta.category || 'uncategorized',
      tags: meta.tags || [],
      handlerPath,
      handler,
      parameters: meta.parameters,
      parallelSafe: true,
      riskLevel: 'low',
      // @ts-ignore - 扩展字段
      triggers: meta.triggers || [],
    });
    return 1;
  }

  /**
   * smart_dispatch: 根据用户消息自动匹配最合适的技能
   * 返回技能名称列表，按匹配度排序
   * 
   * 改进：支持 metadata.triggers 中的正则匹配
   */
  smartDispatch(userMessage: string, limit = 3): Array<{ name: string; score: number; description: string; triggers?: string[] }> {
    const lower = userMessage.toLowerCase();
    const scores = new Map<string, { score: number; triggers: string[] }>();

    for (const [name, skill] of this.skills) {
      let score = 0;
      const matchedTriggers: string[] = [];

      // 1. 检查 metadata.triggers（最高优先级）
      if ((skill as any).triggers && Array.isArray((skill as any).triggers)) {
        for (const trigger of (skill as any).triggers) {
          try {
            const regex = new RegExp(trigger, 'i');
            if (regex.test(userMessage)) {
              score += 20; // 触发词匹配给高分
              matchedTriggers.push(trigger);
            }
          } catch {
            // 无效正则，忽略
          }
        }
      }

      // 2. 名称匹配
      if (lower.includes(skill.name.toLowerCase())) {
        score += 10;
      }

      // 3. 标签匹配
      for (const tag of skill.tags) {
        if (lower.includes(tag.toLowerCase())) {
          score += 5;
        }
      }

      // 4. 描述关键词匹配
      const descWords = skill.description.toLowerCase().split(/[\s,，、]+/);
      for (const w of descWords) {
        if (w.length >= 2 && lower.includes(w)) {
          score += 1;
        }
      }

      if (score > 0) {
        scores.set(name, { score, triggers: matchedTriggers });
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit)
      .map(([name, data]) => ({
        name,
        score: data.score,
        description: this.skills.get(name)?.description || '',
        triggers: data.triggers,
      }));
  }

  /**
   * 获取技能的触发词（用于 System Prompt）
   */
  getSkillTriggers(skillName: string): string[] {
    const skill = this.skills.get(skillName);
    if (!skill) return [];
    return (skill as any).triggers || [];
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

  private parseSkillMd(filePath: string): Partial<SkillDescriptor & { triggers?: string[] }> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);
      const result: Partial<SkillDescriptor & { tags?: string[]; triggers?: string[] }> = {};

      if (frontMatter) {
        const fmContent = frontMatter[1]!;
        
        // 解析简单字段
        for (const line of fmContent.split('\n')) {
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
        
        // 解析 metadata.triggers
        const triggersMatch = fmContent.match(/triggers:\s*([\s\S]*?)(?=\n\w|$)/);
        if (triggersMatch) {
          const triggersText: string = triggersMatch[1] || '';
          result.triggers = triggersText
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('- '))
            .map(line => line.substring(2).trim().replace(/["']/g, ''))
            .filter(Boolean);
        }
      }
      return result;
    } catch { return {}; }
  }

  /**
   * 执行技能 (供 WorkflowOrchestrator 调用)
   */
  async executeSkill(skillName: string, params: any): Promise<{ success: boolean; output: string; data?: any }> {
    console.log(`[skill] 🚀 执行技能: ${skillName}, 参数: ${JSON.stringify(params).slice(0, 200)}`);

    const skill = this.skills.get(skillName);
    if (!skill) {
      console.error(`[skill] ❌ 技能不存在: ${skillName}`);
      return { success: false, output: `技能 "${skillName}" 不存在` };
    }
    if (!skill.handler) {
      console.error(`[skill] ❌ 技能没有 handler: ${skillName}`);
      return { success: false, output: `技能 "${skillName}" 没有实现 handler` };
    }

    const startTime = Date.now();
    try {
      const result = await skill.handler(params, {});
      const duration = Date.now() - startTime;
      console.log(`[skill] ✅ 技能执行成功: ${skillName}, 耗时: ${duration}ms, 结果: ${result.success}`);
      return result;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`[skill] ❌ 技能执行失败: ${skillName}, 耗时: ${duration}ms, 错误: ${err.message}`);
      return { success: false, output: `技能执行失败: ${err.message}` };
    }
  }
}

export const skillOrchestrator = new SkillOrchestrator();

// 延迟注册内置系统技能 (避免顶层 await)
// 注意: auto-error-repair 的 handler 在 gateway/skills/ 目录下不存在 (文件已被删除)
// 后续如果创建了 handler 文件, 启用下面逻辑即可
//
// skillOrchestrator.on('skills:loaded', () => {
//   import('./skills/auto-error-repair.js').then((mod: any) => { ... });
// });
//
// import('./skills/auto-error-repair.js').then((mod: any) => { ... }).catch(() => {});
