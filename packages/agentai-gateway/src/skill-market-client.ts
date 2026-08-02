// @ts-nocheck
/**
 * Skill Market Client - 技能市场客户端
 * 
 * 集成 https://skillsmp.com API
 * 让AI可以自动发现、获取、安装技能
 * 
 * API密钥: sk_live_skillsmp_-N5eZkkHAHhGmM3EVjmRlLAEmHzseZCv5xBJ8lxh3rM
 */

import axios from 'axios';
import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// SkillMarket API 配置
// ═══════════════════════════════════════════════════════════

const SKILL_MARKET_CONFIG = {
  apiKey: 'sk_live_skillsmp_pdfxyKqllhCy51DrF6Gi81yho8L3Y_lLwceKzqofcak',
  baseUrl: 'https://skillsmp.com/api/v1',
  // 备用端点
  fallbackUrls: [
    'https://www.skillsmp.com/api/v1',
  ],
};

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface SkillMarketSkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  rating: number;
  downloadCount: number;
  price: number; // 0 = 免费
  icon?: string;
  readme?: string;
  installCommand?: string;
  dependencies?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SkillSearchResult {
  skills: SkillMarketSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SkillInstallResult {
  success: boolean;
  skillId: string;
  installPath: string;
  message: string;
}

// ═══════════════════════════════════════════════════════════
// SkillMarket API 客户端
// ═══════════════════════════════════════════════════════════

export class SkillMarketClient extends EventEmitter {
  private apiKey: string;
  private baseUrl: string;
  private installedSkills: Map<string, SkillMarketSkill> = new Map();

  constructor(config = SKILL_MARKET_CONFIG) {
    super();
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  /**
   * 搜索技能
   */
  async searchSkills(params: {
    query?: string;
    category?: string;
    tags?: string[];
    page?: number;
    pageSize?: number;
    sortBy?: 'relevance' | 'rating' | 'downloads' | 'newest';
  }): Promise<SkillSearchResult> {
    const url = `${this.baseUrl}/skills/search`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        params: {
          q: params.query,
          category: params.category,
          tags: params.tags?.join(','),
          page: params.page || 1,
          page_size: params.pageSize || 20,
          sort: params.sortBy || 'relevance',
        },
        timeout: 30000,
      });

      const data = response.data.data || {};
      return {
        skills: data.skills || [],
        total: data.pagination?.total || 0,
        page: data.pagination?.page || 1,
        pageSize: data.pagination?.limit || 20,
      };
    } catch (error: any) {
      console.error('[SkillMarket] 搜索技能失败:', error.response?.data || error.message);
      
      // 尝试备用端点
      if (error.response?.status === 404) {
        return this.searchWithFallback(params);
      }
      
      throw new Error(`搜索技能失败: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * 使用备用端点搜索
   */
  private async searchWithFallback(params: any): Promise<SkillSearchResult> {
    for (const fallbackUrl of SKILL_MARKET_CONFIG.fallbackUrls) {
      try {
        const url = `${fallbackUrl}/skills/search`;
        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          params,
          timeout: 30000,
        });

        // 更新基础URL
        this.baseUrl = fallbackUrl;
        
        return {
          skills: response.data.skills || [],
          total: response.data.total || 0,
          page: response.data.page || 1,
          pageSize: response.data.page_size || 20,
        };
      } catch (e) {
        continue;
      }
    }

    throw new Error('所有端点都不可用');
  }

  /**
   * 获取技能详情（从搜索结果中查找）
   * 
   * 注意：SkillMarket API没有单独的详情端点，只能从搜索结果获取
   */
  async getSkillDetail(skillId: string): Promise<SkillMarketSkill | undefined> {
    // 从已缓存的搜索结果中查找
    // 实际使用时应该在搜索结果中保存完整信息
    return undefined;
  }

  /**
   * 获取技能分类
   */
  async getCategories(): Promise<string[]> {
    const url = `${this.baseUrl}/categories`;

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        timeout: 30000,
      });

      return response.data.categories || [];
    } catch (error: any) {
      console.error('[SkillMarket] 获取分类失败:', error.response?.data || error.message);
      
      // 返回默认分类
      return [
        'image-generation',
        'video-generation',
        '3d-modeling',
        'text-processing',
        'code-generation',
        'data-analysis',
        'automation',
        'marketing',
        'productivity',
      ];
    }
  }

  /**
   * 安装技能
   */
  async installSkill(skillId: string): Promise<SkillInstallResult> {
    console.log(`[SkillMarket] 安装技能: ${skillId}`);

    try {
      // 1. 获取技能详情
      const skill = await this.getSkillDetail(skillId);

      // 2. 检查是否已安装
      if (this.installedSkills.has(skillId)) {
        return {
          success: true,
          skillId,
          installPath: `./skills/${skillId}`,
          message: '技能已安装',
        };
      }

      // 3. 下载技能（模拟，实际应该调用下载API）
      // const downloadUrl = `${this.baseUrl}/skills/${skillId}/download`;
      // await this.downloadSkill(downloadUrl, skillId);

      // 4. 注册到本地
      this.installedSkills.set(skillId, skill);

      this.emit('skill:installed', { skillId, skill });

      return {
        success: true,
        skillId,
        installPath: `./skills/${skillId}`,
        message: `技能 "${skill.name}" 安装成功`,
      };
    } catch (error: any) {
      console.error('[SkillMarket] 安装技能失败:', error.message);
      return {
        success: false,
        skillId,
        installPath: '',
        message: `安装失败: ${error.message}`,
      };
    }
  }

  /**
   * 卸载技能
   */
  async uninstallSkill(skillId: string): Promise<boolean> {
    if (!this.installedSkills.has(skillId)) {
      return false;
    }

    this.installedSkills.delete(skillId);
    this.emit('skill:uninstalled', { skillId });
    
    return true;
  }

  /**
   * 获取已安装技能
   */
  getInstalledSkills(): SkillMarketSkill[] {
    return Array.from(this.installedSkills.values());
  }

  /**
   * 检查技能是否已安装
   */
  isSkillInstalled(skillId: string): boolean {
    return this.installedSkills.has(skillId);
  }

  /**
   * 获取推荐技能
   */
  async getRecommendedSkills(context?: string): Promise<SkillMarketSkill[]> {
    // 基于上下文推荐技能
    const searchParams: any = {
      sortBy: 'rating',
      pageSize: 10,
    };

    if (context) {
      searchParams.query = context;
    }

    const result = await this.searchSkills(searchParams);
    return result.skills;
  }

  /**
   * 智能发现技能
   * 
   * 当AI需要某个功能但没有对应技能时，自动去市场搜索
   */
  async discoverSkillForCapability(capability: string): Promise<{
    found: boolean;
    skill?: SkillMarketSkill;
    alternatives?: SkillMarketSkill[];
  }> {
    console.log(`[SkillMarket] 为能力 "${capability}" 发现技能...`);

    // 1. 搜索相关技能
    const searchResult = await this.searchSkills({
      query: capability,
      sortBy: 'rating',
      pageSize: 5,
    });

    if (searchResult.skills.length === 0) {
      return { found: false };
    }

    // 2. 返回最佳匹配
    const bestMatch = searchResult.skills[0];
    const alternatives = searchResult.skills.slice(1);

    return {
      found: true,
      skill: bestMatch,
      alternatives,
    };
  }
}

// 单例导出
let skillMarketClient: SkillMarketClient | null = null;

export function getSkillMarketClient(): SkillMarketClient {
  if (!skillMarketClient) {
    skillMarketClient = new SkillMarketClient();
  }
  return skillMarketClient;
}
