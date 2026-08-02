/**
 * AI Skill Discovery - AI技能自动发现系统
 * 
 * 核心功能：
 * 1. 当AI遇到无法处理的任务时，自动发现所需技能
 * 2. 智能缓存，避免重复调用
 * 3. 自动安装，无缝获取能力
 * 4. 与agentai-loop深度集成
 */

import { EventEmitter } from 'events';
import { getSkillMarketClient, SkillMarketSkill } from './skill-market-client.js';

// ═══════════════════════════════════════════════════════════
// 智能缓存系统
// ═══════════════════════════════════════════════════════════

interface CacheEntry {
  skills: SkillMarketSkill[];
  timestamp: number;
  query: string;
}

export class AISkillDiscovery extends EventEmitter {
  private client = getSkillMarketClient();
  private cache: Map<string, CacheEntry> = new Map();
  private installedSkills: Set<string> = new Set();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  constructor() {
    super();
    this.loadInstalledSkills();
  }

  /**
   * 加载已安装技能
   */
  private loadInstalledSkills(): void {
    const skills = this.client.getInstalledSkills();
    skills.forEach(s => this.installedSkills.add(s.id));
  }

  /**
   * 智能发现技能（带缓存）
   * 
   * 这是AI应该调用的主要方法
   */
  async discoverSkillForTask(taskDescription: string): Promise<{
    found: boolean;
    skill?: SkillMarketSkill;
    alreadyInstalled: boolean;
    autoInstalled: boolean;
    alternatives?: SkillMarketSkill[];
  }> {
    console.log(`[AISkillDiscovery] 为任务发现技能: "${taskDescription}"`);

    // 1. 检查缓存
    const cacheKey = this.normalizeQuery(taskDescription);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log('[AISkillDiscovery] 使用缓存结果');
      return this.processDiscoveryResult(cached, taskDescription);
    }


    // 2. 提取关键词
    const keywords = this.extractKeywords(taskDescription);
    console.log('[AISkillDiscovery] 提取关键词:', keywords);

    // 3. 搜索技能
    let allSkills: SkillMarketSkill[] = [];
    
    for (const keyword of keywords) {
      try {
        const result = await this.client.searchSkills({
          query: keyword,
          pageSize: 5,
        });
        
        if (result.skills.length > 0) {
          allSkills.push(...result.skills);
        }
      } catch (error) {
        console.error(`[AISkillDiscovery] 搜索 "${keyword}" 失败:`, error);
      }
      
      // 避免速率限制
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // 4. 去重和排序
    const uniqueSkills = this.deduplicateAndSort(allSkills);
    
    // 5. 存入缓存
    this.saveToCache(cacheKey, uniqueSkills);

    // 6. 处理结果
    return this.processDiscoveryResult(uniqueSkills, taskDescription);
  }

  /**
   * 处理发现结果
   */
  private async processDiscoveryResult(
    skills: SkillMarketSkill[],
    taskDescription: string
  ): Promise<{
    found: boolean;
    skill?: SkillMarketSkill;
    alreadyInstalled: boolean;
    autoInstalled: boolean;
    alternatives?: SkillMarketSkill[];
  }> {
    if (skills.length === 0) {
      return { found: false, alreadyInstalled: false, autoInstalled: false };
    }

    const bestMatch = skills[0];
    const alreadyInstalled = this.installedSkills.has(bestMatch.id);
    
    // 如果未安装，自动安装
    let autoInstalled = false;
    if (!alreadyInstalled) {
      try {
        const installResult = await this.client.installSkill(bestMatch.id);
        autoInstalled = installResult.success;
        if (autoInstalled) {
          this.installedSkills.add(bestMatch.id);
          this.emit('skill:auto_installed', bestMatch);
        }
      } catch (error) {
        console.error('[AISkillDiscovery] 自动安装失败:', error);
      }
    }

    return {
      found: true,
      skill: bestMatch,
      alreadyInstalled,
      autoInstalled,
      alternatives: skills.slice(1, 4),
    };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(taskDescription: string): string[] {
    const keywords: string[] = [];
    const lowerDesc = taskDescription.toLowerCase();

    // 技术关键词映射
    const keywordMap: Record<string, string[]> = {
      '3d': ['3d', 'modeling', 'blender', 'maya'],
      'image': ['image', 'photo', 'picture', 'generation', 'stable diffusion'],
      'video': ['video', 'animation', 'movie', 'editing'],
      'web': ['web', 'scraping', 'crawler', 'spider'],
      'data': ['data', 'analysis', 'analytics', 'processing'],
      'code': ['code', 'programming', 'development', 'coding'],
      'automation': ['automation', 'automate', 'workflow', 'bot'],
      'marketing': ['marketing', 'seo', 'social media', 'email'],
      'writing': ['writing', 'content', 'copywriting', 'blog'],
      'api': ['api', 'integration', 'webhook', 'rest'],
      'ai': ['ai', 'machine learning', 'ml', 'artificial intelligence'],
      'security': ['security', 'auth', 'authentication', 'oauth'],
      'database': ['database', 'sql', 'nosql', 'mongodb', 'postgres'],
      'cloud': ['cloud', 'aws', 'azure', 'gcp', 'deployment'],
      'testing': ['testing', 'test', 'jest', 'cypress', 'qa'],
    };

    // 匹配关键词
    for (const [category, terms] of Object.entries(keywordMap)) {
      if (terms.some(term => lowerDesc.includes(term))) {
        keywords.push(category);
        keywords.push(...terms.slice(0, 2));
      }
    }

    // 如果没有匹配到，使用原始描述的前3个词
    if (keywords.length === 0) {
      const words = taskDescription.split(' ').slice(0, 3);
      keywords.push(...words);
    }

    return [...new Set(keywords)].slice(0, 5); // 去重，最多5个
  }

  /**
   * 标准化查询
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): SkillMarketSkill[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 检查是否过期
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return entry.skills;
  }

  /**
   * 保存到缓存
   */
  private saveToCache(key: string, skills: SkillMarketSkill[]): void {
    this.cache.set(key, {
      skills,
      timestamp: Date.now(),
      query: key,
    });

    // 清理过期缓存
    this.cleanupCache();
  }

  /**
   * 清理缓存
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 去重和排序
   */
  private deduplicateAndSort(skills: SkillMarketSkill[]): SkillMarketSkill[] {
    // 去重
    const unique = Array.from(new Map(skills.map(s => [s.id, s])).values());

    // 按评分排序 (rating 0-5 制)
    return unique.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  }

  /**
   * 检查是否有技能可以处理任务
   */
  hasSkillForTask(taskDescription: string): boolean {
    const keywords = this.extractKeywords(taskDescription);
    
    for (const skill of this.client.getInstalledSkills()) {
      const skillText = `${skill.name} ${skill.description} ${skill.tags?.join(' ')}`.toLowerCase();
      if (keywords.some(kw => skillText.includes(kw.toLowerCase()))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 获取统计
   */
  getStats(): {
    cacheSize: number;
    installedSkills: number;
  } {
    return {
      cacheSize: this.cache.size,
      installedSkills: this.installedSkills.size,
    };
  }
}

// 单例导出
let aiSkillDiscovery: AISkillDiscovery | null = null;

export function getAISkillDiscovery(): AISkillDiscovery {
  if (!aiSkillDiscovery) {
    aiSkillDiscovery = new AISkillDiscovery();
  }
  return aiSkillDiscovery;
}
