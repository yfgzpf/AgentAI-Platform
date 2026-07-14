/**
 * SkillManager - 统一技能管理器
 * 
 * 解决技能系统架构分散问题：
 * 1. 单一注册表 - 所有技能统一注册
 * 2. 统一扫描 - 唯一入口扫描技能目录
 * 3. 强制调用 - 高置信度时强制AI调用技能
 * 4. 结果反馈 - 技能执行结果自动注入AI上下文
 * 5. 标准化接口 - 统一handler调用方式
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Skill {
  name: string;
  description: string;
  category: string;
  tags: string[];
  triggers: string[];
  tools: string[];
  dir: string;
  handlerPath?: string;
  handler?: (args: any, ctx?: any) => Promise<SkillResult>;
  parameters?: Record<string, any>;
  parallelSafe?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  source?: 'built-in' | 'project' | 'user';
}

export interface SkillResult {
  success: boolean;
  output: string;
  data?: any;
  durationMs?: number;
  error?: string;
}

export interface SkillMatch {
  skill: Skill;
  confidence: number;
  params: Record<string, any>;
  reason: string;
}

// ═══════════════════════════════════════════════════════════
// SkillManager 核心类
// ═══════════════════════════════════════════════════════════

export class SkillManager extends EventEmitter {
  private skills = new Map<string, Skill>();
  private keywordIndex = new Map<string, string[]>();
  private scannedDirs = new Set<string>();

  // ═══════════════════════════════════════════════════════════
  // 技能注册
  // ═══════════════════════════════════════════════════════════

  register(skill: Skill): void {
    if (!skill.name) {
      console.warn('[SkillManager] 跳过无效技能: 缺少name');
      return;
    }

    // 检查是否已存在
    if (this.skills.has(skill.name)) {
      console.log(`[SkillManager] 更新技能: ${skill.name}`);
    } else {
      console.log(`[SkillManager] 注册技能: ${skill.name}`);
    }

    this.skills.set(skill.name, skill);

    // 构建关键词索引
    this.buildIndex(skill);

    this.emit('skill:registered', { name: skill.name, category: skill.category });
  }

  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) return false;

    this.skills.delete(name);
    this.removeFromIndex(skill);
    this.emit('skill:unregistered', { name });
    return true;
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  listByCategory(category: string): Skill[] {
    return this.list().filter(s => s.category === category);
  }

  // ═══════════════════════════════════════════════════════════
  // 技能扫描
  // ═══════════════════════════════════════════════════════════

  scanDirectory(dir: string): number {
    if (this.scannedDirs.has(dir)) {
      console.log(`[SkillManager] 已扫描过: ${dir}`);
      return 0;
    }

    if (!fs.existsSync(dir)) {
      console.warn(`[SkillManager] 目录不存在: ${dir}`);
      return 0;
    }

    let count = 0;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(dir, entry.name);
        const skillMd = path.join(skillDir, 'SKILL.md');

        if (!fs.existsSync(skillMd)) {
          // 递归扫描子目录
          count += this.scanDirectory(skillDir);
          continue;
        }

        const skill = this.parseSkill(skillDir, skillMd);
        if (skill) {
          this.register(skill);
          count++;
        }
      }

      this.scannedDirs.add(dir);
      console.log(`[SkillManager] 扫描完成: ${dir}, 注册 ${count} 个技能`);
    } catch (e: any) {
      console.error(`[SkillManager] 扫描失败 ${dir}:`, e.message);
    }

    return count;
  }

  // ═══════════════════════════════════════════════════════════
  // 技能解析
  // ═══════════════════════════════════════════════════════════

  private parseSkill(dir: string, skillMdPath: string): Skill | null {
    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      const frontMatter = content.match(/^---\s*\n([\s\S]*?)\n---/);

      if (!frontMatter) {
        console.warn(`[SkillManager] 无效的SKILL.md: ${skillMdPath}`);
        return null;
      }

      const fm = this.parseFrontMatter(frontMatter[1]);

      // 查找handler
      const handlerPath = this.findHandler(dir);

      // 创建handler函数
      const handler = this.createHandler(handlerPath);

      return {
        name: fm.name || path.basename(dir),
        description: fm.description || fm.name || '无描述',
        category: fm.category || 'uncategorized',
        tags: fm.tags || [],
        triggers: fm.triggers || [],
        tools: fm.tools || [],
        dir,
        handlerPath,
        handler,
        parameters: fm.parameters,
        parallelSafe: fm.parallelSafe !== false,
        riskLevel: fm.riskLevel || 'low',
        source: 'built-in',
      };
    } catch (e: any) {
      console.error(`[SkillManager] 解析技能失败 ${dir}:`, e.message);
      return null;
    }
  }

  private parseFrontMatter(content: string): any {
    const result: any = {};
    const lines = content.split('\n');
    let currentKey = '';
    let currentArray: string[] = [];
    let inArray = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('- ') && inArray) {
        // 数组项
        currentArray.push(trimmed.slice(2).replace(/["']/g, ''));
      } else if (trimmed.includes(':')) {
        // 保存之前的数组
        if (inArray && currentKey) {
          result[currentKey] = currentArray;
          inArray = false;
          currentArray = [];
        }

        const [key, ...valueParts] = trimmed.split(':');
        const value = valueParts.join(':').trim();
        currentKey = key.trim();

        if (value) {
          // 有值的字段
          result[currentKey] = value.replace(/["']/g, '');
          inArray = false;
        } else {
          // 可能是数组开始
          inArray = true;
          currentArray = [];
        }
      }
    }

    // 保存最后的数组
    if (inArray && currentKey) {
      result[currentKey] = currentArray;
    }

    return result;
  }

  private findHandler(dir: string): string | undefined {
    const candidates = [
      path.join(dir, 'handler.py'),
      path.join(dir, 'main.py'),
      path.join(dir, 'index.js'),
      path.join(dir, 'handler.ts'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private createHandler(handlerPath: string | undefined): Skill['handler'] {
    if (!handlerPath) return undefined;

    const ext = path.extname(handlerPath);

    if (ext === '.py') {
      return async (args: any) => {
        try {
          const { callPython } = await import('./python-bridge.js');
          return await callPython(handlerPath, args);
        } catch (e: any) {
          return { success: false, output: `Python执行错误: ${e.message}` };
        }
      };
    }

    if (ext === '.js' || ext === '.ts') {
      return async (args: any) => {
        try {
          const mod = await import(handlerPath);
          const fn = typeof mod === 'function' ? mod : mod.default || mod.handler || mod.execute;
          if (typeof fn === 'function') {
            return await fn(args);
          }
          return { success: false, output: 'Handler没有可执行函数' };
        } catch (e: any) {
          return { success: false, output: `JS执行错误: ${e.message}` };
        }
      };
    }

    return undefined;
  }

  // ═══════════════════════════════════════════════════════════
  // 意图匹配
  // ═══════════════════════════════════════════════════════════

  matchIntent(message: string): SkillMatch | null {
    const lowerMsg = message.toLowerCase();
    let bestMatch: SkillMatch | null = null;
    let highestScore = 0;

    for (const skill of this.skills.values()) {
      let score = 0;
      const matchedTriggers: string[] = [];

      // 1. 检查triggers（最高优先级）
      for (const trigger of skill.triggers) {
        const pattern = new RegExp(trigger.replace(/\*/g, '.*'), 'i');
        if (pattern.test(message)) {
          score += 0.5;
          matchedTriggers.push(trigger);
        }
      }

      // 2. 检查关键词
      for (const tag of skill.tags) {
        if (lowerMsg.includes(tag.toLowerCase())) {
          score += 0.2;
        }
      }

      // 3. 检查名称匹配
      if (lowerMsg.includes(skill.name.toLowerCase())) {
        score += 0.3;
      }

      // 4. 检查描述匹配
      const descWords = skill.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 2 && lowerMsg.includes(word)) {
          score += 0.1;
        }
      }

      if (score > highestScore && score >= 0.5) {
        highestScore = score;
        bestMatch = {
          skill,
          confidence: Math.min(score, 1),
          params: this.extractParams(message, skill),
          reason: `匹配触发器: ${matchedTriggers.join(', ')}`,
        };
      }
    }

    return bestMatch;
  }

  private extractParams(message: string, skill: Skill): Record<string, any> {
    const params: Record<string, any> = {};

    // 提取平台
    if (message.includes('抖音')) params.platform = 'douyin';
    else if (message.includes('小红书')) params.platform = 'xiaohongshu';
    else if (message.includes('视频号')) params.platform = 'shipinhao';

    // 提取关键词
    const keywordMatch = message.match(/关键词[是为]?\s*[:：]?\s*([^，,。]+)/);
    if (keywordMatch) {
      params.keywords = [keywordMatch[1].trim()];
    }

    // 提取城市
    const cityMatch = message.match(/(北京|上海|广州|深圳|杭州|成都|武汉|南京|西安)/);
    if (cityMatch) {
      params.city = cityMatch[1];
    }

    return params;
  }

  // ═══════════════════════════════════════════════════════════
  // 技能执行
  // ═══════════════════════════════════════════════════════════

  async execute(skillName: string, params: any = {}): Promise<SkillResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      return {
        success: false,
        output: `技能不存在: ${skillName}`,
      };
    }

    if (!skill.handler) {
      return {
        success: false,
        output: `技能没有handler: ${skillName}`,
      };
    }

    console.log(`[SkillManager] 执行技能: ${skillName}, 参数:`, params);
    const startTime = Date.now();

    try {
      const result = await skill.handler(params, {});
      const durationMs = Date.now() - startTime;

      const fullResult: SkillResult = {
        success: result.success !== false,
        output: result.output || '执行完成',
        data: result.data,
        durationMs,
      };

      this.emit('skill:executed', {
        name: skillName,
        success: fullResult.success,
        durationMs,
      });

      return fullResult;
    } catch (e: any) {
      const durationMs = Date.now() - startTime;
      return {
        success: false,
        output: `执行异常: ${e.message}`,
        durationMs,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 生成调用提示
  // ═══════════════════════════════════════════════════════════

  generateInvocationPrompt(match: SkillMatch): string {
    return `【强制技能调用】
检测到用户需求匹配技能: ${match.skill.name}
描述: ${match.description}
匹配度: ${(match.confidence * 100).toFixed(0)}%
原因: ${match.reason}

**必须执行**: 调用技能工具 '${match.skill.name}'
参数: ${JSON.stringify(match.params)}

⚠️ 重要: 这是强制指令，不要思考"是否调用"，立即执行！`;
  }

  // ═══════════════════════════════════════════════════════════
  // 索引管理
  // ═══════════════════════════════════════════════════════════

  private buildIndex(skill: Skill): void {
    const keywords = [...skill.tags, ...skill.triggers, skill.name];
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      const list = this.keywordIndex.get(lowerKw) || [];
      if (!list.includes(skill.name)) {
        list.push(skill.name);
        this.keywordIndex.set(lowerKw, list);
      }
    }
  }

  private removeFromIndex(skill: Skill): void {
    const keywords = [...skill.tags, ...skill.triggers, skill.name];
    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase();
      const list = this.keywordIndex.get(lowerKw);
      if (list) {
        const idx = list.indexOf(skill.name);
        if (idx >= 0) list.splice(idx, 1);
        if (list.length === 0) this.keywordIndex.delete(lowerKw);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 统计信息
  // ═══════════════════════════════════════════════════════════

  getStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
    }
    return {
      total: this.skills.size,
      byCategory,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 单例导出
// ═══════════════════════════════════════════════════════════

export const skillManager = new SkillManager();
