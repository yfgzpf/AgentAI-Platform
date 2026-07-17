/**
 * Industry Skill Mapper - 行业技能映射系统
 * 
 * 针对建材设计行业优化技能发现
 * 建立用户意图到SkillMarket技能的精确映射
 */

import { getSkillMarketClient, SkillMarketSkill } from './skill-market-client.js';

// ═══════════════════════════════════════════════════════════
// 建材设计行业技能映射
// ═══════════════════════════════════════════════════════════

export const CONSTRUCTION_DESIGN_SKILL_MAP: Record<string, {
  skillId: string;
  skillName: string;
  keywords: string[];
  description: string;
}> = {
  'autocad-redraw': {
    skillId: 'pengxiaoan-autocad-dwg-redraw-skill-skills-autocad-image-redraw',
    skillName: 'AutoCAD Image Redraw',
    keywords: ['cad', 'redraw', 'convert', 'image', 'photo', 'jpg', 'png', 'scan', 'dwg', 'drawing', 'trace', 'digitize'],
    description: '将图片、照片、扫描件重绘成AutoCAD DWG格式图纸',
  },
  'cad-conversion': {
    skillId: 'pengxiaoan-autocad-dwg-redraw-skill-skills-autocad-image-redraw',
    skillName: 'CAD Conversion',
    keywords: ['cad', 'convert', 'pdf', 'image', 'vector', 'dwg', 'dxf', 'drawing'],
    description: 'PDF/图片转CAD图纸',
  },
  'blueprint-digitalization': {
    skillId: 'pengxiaoan-autocad-dwg-redraw-skill-skills-autocad-image-redraw',
    skillName: 'Blueprint Digitalization',
    keywords: ['blueprint', 'plan', 'layout', 'floor plan', 'digital', 'cad', 'drawing'],
    description: '蓝图/平面图数字化',
  },
};

// ═══════════════════════════════════════════════════════════
// 行业关键词同义词映射
// ═══════════════════════════════════════════════════════════

export const KEYWORD_SYNONYMS: Record<string, string[]> = {
  'cad': ['cad', 'autocad', 'dwg', 'dxf', 'drawing', 'drafting', '制图', '绘图'],
  'redraw': ['redraw', '重绘', 'convert', '转换', 'trace', '描图', 'digitize', '数字化', 'vectorize', '矢量化'],
  'image': ['image', '图片', 'photo', '照片', 'picture', 'jpg', 'png', 'scan', '扫描', 'pdf'],
  'blueprint': ['blueprint', '蓝图', 'plan', '平面图', 'layout', '布局', 'floor plan', '户型图'],
  'design': ['design', '设计', 'architecture', '建筑', 'interior', '室内', 'decoration', '装修'],
  '3d': ['3d', 'model', '模型', 'modeling', '建模', 'render', '渲染'],
  'material': ['material', '材料', 'texture', '纹理', 'tile', '瓷砖', 'wood', '木材', 'marble', '大理石'],
};

// ═══════════════════════════════════════════════════════════
// 行业技能映射器
// ═══════════════════════════════════════════════════════════

export class IndustrySkillMapper {
  private client = getSkillMarketClient();

  /**
   * 映射用户查询到行业技能
   */
  async mapQueryToSkill(userQuery: string): Promise<{
    matched: boolean;
    skill?: SkillMarketSkill;
    confidence: number;
    reason: string;
  }> {
    console.log(`[IndustryMapper] 映射查询: "${userQuery}"`);

    // 1. 标准化查询
    const normalizedQuery = this.normalizeQuery(userQuery);
    
    // 2. 提取关键词
    const extractedKeywords = this.extractKeywords(normalizedQuery);
    console.log(`[IndustryMapper] 提取关键词:`, extractedKeywords);

    // 3. 匹配预定义映射
    for (const [skillType, mapping] of Object.entries(CONSTRUCTION_DESIGN_SKILL_MAP)) {
      const matchScore = this.calculateMatchScore(extractedKeywords, mapping.keywords);
      console.log(`[IndustryMapper] ${skillType} 匹配度: ${(matchScore * 100).toFixed(0)}%`);

      if (matchScore >= 0.6) { // 60%匹配度阈值
        // 4. 从SkillMarket搜索确认
        const searchResult = await this.searchAndVerify(mapping);
        
        if (searchResult) {
          return {
            matched: true,
            skill: searchResult,
            confidence: matchScore,
            reason: `匹配行业技能映射: ${mapping.description}`,
          };
        }
      }
    }

    // 5. 如果没有精确匹配，使用通用搜索
    return this.fallbackSearch(extractedKeywords);
  }

  /**
   * 标准化查询
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .replace(/[，。！？、]/g, ' ') // 中文标点转空格
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 提取关键词（含同义词扩展）
   */
  private extractKeywords(query: string): string[] {
    const keywords: string[] = [];
    const queryWords = query.split(' ');

    // 直接匹配
    keywords.push(...queryWords);

    // 同义词扩展
    for (const [baseWord, synonyms] of Object.entries(KEYWORD_SYNONYMS)) {
      if (queryWords.some(w => synonyms.includes(w.toLowerCase()))) {
        keywords.push(baseWord, ...synonyms);
      }
    }

    // 行业特定模式匹配
    if (query.includes('图') || query.includes('drawing')) {
      keywords.push('drawing', 'blueprint', 'plan');
    }
    if (query.includes('转') || query.includes('convert')) {
      keywords.push('convert', 'redraw', 'digitize');
    }
    if (query.includes('重绘') || query.includes('redraw')) {
      keywords.push('redraw', 'trace', 'convert');
    }

    return [...new Set(keywords)]; // 去重
  }

  /**
   * 计算匹配分数
   */
  private calculateMatchScore(extractedKeywords: string[], skillKeywords: string[]): number {
    if (skillKeywords.length === 0) return 0;

    const matched = skillKeywords.filter(skillKw =>
      extractedKeywords.some(extractedKw => 
        extractedKw.toLowerCase().includes(skillKw.toLowerCase()) ||
        skillKw.toLowerCase().includes(extractedKw.toLowerCase())
      )
    );

    return matched.length / skillKeywords.length;
  }

  /**
   * 搜索并验证技能
   */
  private async searchAndVerify(mapping: typeof CONSTRUCTION_DESIGN_SKILL_MAP[string]): Promise<SkillMarketSkill | null> {
    try {
      // 搜索技能
      const result = await this.client.searchSkills({
        query: mapping.skillName,
        pageSize: 10,
      });

      // 查找精确匹配
      const exactMatch = result.skills.find(s => 
        s.id === mapping.skillId || 
        s.name.toLowerCase() === mapping.skillName.toLowerCase()
      );

      if (exactMatch) {
        console.log(`[IndustryMapper] 找到精确匹配: ${exactMatch.name}`);
        return exactMatch;
      }

      // 返回最佳匹配
      if (result.skills.length > 0) {
        console.log(`[IndustryMapper] 返回最佳匹配: ${result.skills[0].name}`);
        return result.skills[0];
      }

      return null;
    } catch (error) {
      console.error('[IndustryMapper] 搜索失败:', error);
      return null;
    }
  }

  /**
   * 回退搜索
   */
  private async fallbackSearch(keywords: string[]): Promise<{
    matched: boolean;
    skill?: SkillMarketSkill;
    confidence: number;
    reason: string;
  }> {
    // 使用最相关的关键词搜索
    const primaryKeyword = keywords.find(kw => 
      ['cad', 'autocad', 'redraw', 'convert'].includes(kw.toLowerCase())
    ) || keywords[0];

    try {
      const result = await this.client.searchSkills({
        query: primaryKeyword,
        pageSize: 5,
      });

      if (result.skills.length > 0) {
        return {
          matched: true,
          skill: result.skills[0],
          confidence: 0.3, // 低置信度
          reason: `回退搜索: 使用关键词 "${primaryKeyword}"`,
        };
      }
    } catch (error) {
      console.error('[IndustryMapper] 回退搜索失败:', error);
    }

    return {
      matched: false,
      confidence: 0,
      reason: '未找到匹配技能',
    };
  }

  /**
   * 获取行业推荐技能
   */
  async getRecommendedIndustrySkills(): Promise<SkillMarketSkill[]> {
    const recommendations: SkillMarketSkill[] = [];

    for (const mapping of Object.values(CONSTRUCTION_DESIGN_SKILL_MAP)) {
      const skill = await this.searchAndVerify(mapping);
      if (skill && !recommendations.find(r => r.id === skill.id)) {
        recommendations.push(skill);
      }
    }

    return recommendations;
  }
}

// 单例导出
let industrySkillMapper: IndustrySkillMapper | null = null;

export function getIndustrySkillMapper(): IndustrySkillMapper {
  if (!industrySkillMapper) {
    industrySkillMapper = new IndustrySkillMapper();
  }
  return industrySkillMapper;
}
