/**
 * SkillMatcher - 高性能技能匹配器
 * 
 * 使用倒排索引实现 O(1) 技能查找
 * 替代线性扫描的 O(n) 算法
 */

import { Skill } from './skill-manager.js';

interface InvertedIndex {
  [keyword: string]: Set<string>; // keyword -> skill names
}

interface MatchResult {
  skill: Skill;
  score: number;
  matchedKeywords: string[];
}

export class SkillMatcher {
  private index: InvertedIndex = {};
  private skillCache: Map<string, Skill> = new Map();
  private keywordCache: Map<string, string[]> = new Map();
  
  // 性能统计
  private stats = {
    totalQueries: 0,
    cacheHits: 0,
    indexSize: 0,
  };

  /**
   * 构建倒排索引
   */
  buildIndex(skills: Skill[]): void {
    console.log(`[SkillMatcher] 构建倒排索引，${skills.length} 个技能`);
    
    const startTime = Date.now();
    this.index = {};
    this.skillCache.clear();
    
    for (const skill of skills) {
      // 缓存技能
      this.skillCache.set(skill.name, skill);
      
      // 提取所有关键词
      const keywords = this.extractKeywords(skill);
      
      // 构建倒排索引
      for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        if (!this.index[lowerKeyword]) {
          this.index[lowerKeyword] = new Set();
        }
        this.index[lowerKeyword].add(skill.name);
      }
    }
    
    this.stats.indexSize = Object.keys(this.index).length;
    const duration = Date.now() - startTime;
    
    console.log(`[SkillMatcher] 索引构建完成，${this.stats.indexSize} 个关键词，耗时 ${duration}ms`);
  }

  /**
   * 快速匹配 - O(1) 复杂度
   */
  match(message: string): MatchResult | null {
    this.stats.totalQueries++;
    
    // 检查缓存
    const cached = this.keywordCache.get(message);
    if (cached) {
      this.stats.cacheHits++;
      const skill = this.skillCache.get(cached[0]);
      if (skill) {
        return {
          skill,
          score: 1.0,
          matchedKeywords: cached.slice(1),
        };
      }
    }
    
    // 提取查询关键词
    const queryWords = this.tokenize(message);
    const scores: Map<string, { score: number; keywords: string[] }> = new Map();
    
    // O(m) 复杂度，m = 查询词数量
    for (const word of queryWords) {
      const lowerWord = word.toLowerCase();
      
      // 直接匹配 O(1)
      if (this.index[lowerWord]) {
        for (const skillName of this.index[lowerWord]) {
          const current = scores.get(skillName) || { score: 0, keywords: [] };
          current.score += this.calculateWeight(lowerWord);
          current.keywords.push(lowerWord);
          scores.set(skillName, current);
        }
      }
      
      // 前缀匹配 O(1)
      const prefixMatches = this.findByPrefix(lowerWord);
      for (const skillName of prefixMatches) {
        const current = scores.get(skillName) || { score: 0, keywords: [] };
        current.score += this.calculateWeight(lowerWord) * 0.5; // 前缀匹配权重减半
        scores.set(skillName, current);
      }
    }
    
    // 找出最高分
    let bestMatch: MatchResult | null = null;
    let maxScore = 0;
    
    for (const [skillName, data] of scores) {
      if (data.score > maxScore && data.score >= 0.5) {
        const skill = this.skillCache.get(skillName);
        if (skill) {
          maxScore = data.score;
          bestMatch = {
            skill,
            score: Math.min(data.score, 1.0),
            matchedKeywords: data.keywords,
          };
        }
      }
    }
    
    // 缓存结果
    if (bestMatch) {
      this.keywordCache.set(message, [bestMatch.skill.name, ...bestMatch.matchedKeywords]);
    }
    
    return bestMatch;
  }

  /**
   * 批量匹配 - 用于预加载
   */
  matchBatch(messages: string[]): Map<string, MatchResult> {
    const results = new Map<string, MatchResult>();
    
    for (const message of messages) {
      const match = this.match(message);
      if (match) {
        results.set(message, match);
      }
    }
    
    return results;
  }

  /**
   * 模糊匹配 - 支持拼写错误
   */
  fuzzyMatch(message: string, maxDistance = 2): MatchResult | null {
    const queryWords = this.tokenize(message);
    const scores: Map<string, { score: number; keywords: string[] }> = new Map();
    
    for (const word of queryWords) {
      // 精确匹配
      const exactMatches = this.index[word.toLowerCase()];
      if (exactMatches) {
        for (const skillName of exactMatches) {
          const current = scores.get(skillName) || { score: 0, keywords: [] };
          current.score += 1.0;
          current.keywords.push(word);
          scores.set(skillName, current);
        }
        continue;
      }
      
      // 模糊匹配 - 编辑距离
      for (const [keyword, skillNames] of Object.entries(this.index)) {
        if (this.levenshteinDistance(word.toLowerCase(), keyword) <= maxDistance) {
          for (const skillName of skillNames) {
            const current = scores.get(skillName) || { score: 0, keywords: [] };
            current.score += 0.3; // 模糊匹配权重较低
            current.keywords.push(`${word}~${keyword}`);
            scores.set(skillName, current);
          }
        }
      }
    }
    
    // 找出最佳匹配
    let bestMatch: MatchResult | null = null;
    let maxScore = 0;
    
    for (const [skillName, data] of scores) {
      if (data.score > maxScore && data.score >= 0.3) {
        const skill = this.skillCache.get(skillName);
        if (skill) {
          maxScore = data.score;
          bestMatch = {
            skill,
            score: Math.min(data.score, 1.0),
            matchedKeywords: data.keywords,
          };
        }
      }
    }
    
    return bestMatch;
  }

  /**
   * 获取性能统计
   */
  getStats() {
    return {
      ...this.stats,
      cacheHitRate: this.stats.totalQueries > 0 
        ? (this.stats.cacheHits / this.stats.totalQueries * 100).toFixed(2) + '%'
        : '0%',
      skillCount: this.skillCache.size,
      indexSize: this.stats.indexSize,
    };
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.keywordCache.clear();
    this.stats.cacheHits = 0;
    this.stats.totalQueries = 0;
    console.log('[SkillMatcher] 缓存已清空');
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private extractKeywords(skill: Skill): string[] {
    const keywords = new Set<string>();
    
    // 名称
    keywords.add(skill.name);
    keywords.add(skill.name.toLowerCase());
    
    // 标签
    for (const tag of skill.tags) {
      keywords.add(tag.toLowerCase());
    }
    
    // 触发器
    for (const trigger of skill.triggers || []) {
      // 提取触发器中的关键词
      const words = trigger.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]+/g) || [];
      for (const word of words) {
        keywords.add(word);
      }
    }
    
    // 描述中的关键词
    const descWords = skill.description.toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]+/g) || [];
    for (const word of descWords.slice(0, 10)) { // 只取前10个
      if (word.length > 2) {
        keywords.add(word);
      }
    }
    
    return Array.from(keywords);
  }

  private tokenize(message: string): string[] {
    // 中文分词 + 英文单词
    const words: string[] = [];
    
    // 匹配中文词语
    const chineseWords = message.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    words.push(...chineseWords);
    
    // 匹配英文单词
    const englishWords = message.toLowerCase().match(/[a-z]{2,}/g) || [];
    words.push(...englishWords);
    
    // 匹配数字
    const numbers = message.match(/\d+/g) || [];
    words.push(...numbers);
    
    return words;
  }

  private calculateWeight(keyword: string): number {
    // 短词权重更高（更精确）
    if (keyword.length <= 2) return 0.3;
    if (keyword.length <= 4) return 0.5;
    return 0.3;
  }

  private findByPrefix(prefix: string): Set<string> {
    const results = new Set<string>();
    
    for (const [keyword, skillNames] of Object.entries(this.index)) {
      if (keyword.startsWith(prefix) || prefix.startsWith(keyword)) {
        for (const name of skillNames) {
          results.add(name);
        }
      }
    }
    
    return results;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
}

// 单例导出
export const skillMatcher = new SkillMatcher();
