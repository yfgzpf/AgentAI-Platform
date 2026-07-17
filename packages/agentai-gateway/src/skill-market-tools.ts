/**
 * Skill Market Tools - AI可调用的技能市场工具
 * 
 * 让AI能够：
 * 1. 搜索和发现技能
 * 2. 自动安装所需技能
 * 3. 管理已安装技能
 * 4. 基于需求推荐技能
 */

import { getSkillMarketClient, SkillMarketSkill } from './skill-market-client.js';

// ═══════════════════════════════════════════════════════════
// 工具1: 搜索技能
// ═══════════════════════════════════════════════════════════

export async function search_skills(args: {
  query?: string;
  category?: string;
  tags?: string[];
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'newest';
  limit?: number;
}): Promise<{
  success: boolean;
  message: string;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    rating: number;
    downloads: number;
    price: number;
  }>;
  total?: number;
}> {
  console.log('[AI Tool] search_skills:', args.query || '浏览全部');

  try {
    const client = getSkillMarketClient();
    
    const result = await client.searchSkills({
      query: args.query,
      category: args.category,
      tags: args.tags,
      sortBy: args.sortBy || 'relevance',
      pageSize: args.limit || 20,
    });

    return {
      success: true,
      message: `找到 ${result.total} 个技能`,
      skills: result.skills.map((skill: SkillMarketSkill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        rating: skill.rating,
        downloads: skill.downloadCount,
        price: skill.price,
      })),
      total: result.total,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `搜索失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具2: 发现技能（智能匹配）
// ═══════════════════════════════════════════════════════════

export async function discover_skill(args: {
  capability: string; // 需要的能力描述
  autoInstall?: boolean;
}): Promise<{
  success: boolean;
  message: string;
  found: boolean;
  skill?: {
    id: string;
    name: string;
    description: string;
    rating: number;
  };
  alternatives?: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  installed?: boolean;
}> {
  console.log('[AI Tool] discover_skill:', args.capability);

  try {
    const client = getSkillMarketClient();
    
    const discovery = await client.discoverSkillForCapability(args.capability);

    if (!discovery.found) {
      return {
        success: true,
        found: false,
        message: `未找到匹配 "${args.capability}" 的技能`,
      };
    }

    let installed = false;
    
    // 自动安装
    if (args.autoInstall && discovery.skill) {
      const installResult = await client.installSkill(discovery.skill.id);
      installed = installResult.success;
    }

    return {
      success: true,
      found: true,
      message: installed 
        ? `已找到并安装技能: ${discovery.skill!.name}`
        : `找到推荐技能: ${discovery.skill!.name}`,
      skill: discovery.skill ? {
        id: discovery.skill.id,
        name: discovery.skill.name,
        description: discovery.skill.description,
        rating: discovery.skill.rating,
      } : undefined,
      alternatives: discovery.alternatives?.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
      installed,
    };
  } catch (error: any) {
    return {
      success: false,
      found: false,
      message: `发现失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具3: 安装技能
// ═══════════════════════════════════════════════════════════

export async function install_skill(args: {
  skillId: string;
}): Promise<{
  success: boolean;
  message: string;
  skillId: string;
  installPath?: string;
}> {
  console.log('[AI Tool] install_skill:', args.skillId);

  try {
    const client = getSkillMarketClient();
    
    const result = await client.installSkill(args.skillId);

    return {
      success: result.success,
      message: result.message,
      skillId: result.skillId,
      installPath: result.installPath,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `安装失败: ${error.message}`,
      skillId: args.skillId,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具4: 获取已安装技能
// ═══════════════════════════════════════════════════════════

export async function get_installed_skills(args: {}): Promise<{
  success: boolean;
  message: string;
  skills?: Array<{
    id: string;
    name: string;
    version: string;
    category: string;
  }>;
  count: number;
}> {
  console.log('[AI Tool] get_installed_skills');

  try {
    const client = getSkillMarketClient();
    const skills = client.getInstalledSkills();

    return {
      success: true,
      message: `已安装 ${skills.length} 个技能`,
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        version: s.version,
        category: s.category,
      })),
      count: skills.length,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `获取失败: ${error.message}`,
      count: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具5: 获取技能分类
// ═══════════════════════════════════════════════════════════

export async function get_skill_categories(args: {}): Promise<{
  success: boolean;
  message: string;
  categories?: string[];
}> {
  console.log('[AI Tool] get_skill_categories');

  try {
    const client = getSkillMarketClient();
    const categories = await client.getCategories();

    return {
      success: true,
      message: `获取到 ${categories.length} 个分类`,
      categories,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `获取失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具6: 获取技能详情
// ═══════════════════════════════════════════════════════════

export async function get_skill_detail(args: {
  skillId: string;
}): Promise<{
  success: boolean;
  message: string;
  skill?: {
    id: string;
    name: string;
    description: string;
    version: string;
    author: string;
    category: string;
    tags: string[];
    rating: number;
    downloads: number;
    price: number;
    readme?: string;
  };
}> {
  console.log('[AI Tool] get_skill_detail:', args.skillId);

  try {
    const client = getSkillMarketClient();
    const skill = await client.getSkillDetail(args.skillId);

    return {
      success: true,
      message: '获取成功',
      skill: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        author: skill.author,
        category: skill.category,
        tags: skill.tags,
        rating: skill.rating,
        downloads: skill.downloadCount,
        price: skill.price,
        readme: skill.readme,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `获取失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具7: 智能技能推荐
// ═══════════════════════════════════════════════════════════

export async function recommend_skills(args: {
  context?: string;
  limit?: number;
}): Promise<{
  success: boolean;
  message: string;
  recommendations?: Array<{
    id: string;
    name: string;
    description: string;
    reason: string;
  }>;
}> {
  console.log('[AI Tool] recommend_skills:', args.context || '通用推荐');

  try {
    const client = getSkillMarketClient();
    const skills = await client.getRecommendedSkills(args.context);

    return {
      success: true,
      message: `推荐 ${skills.length} 个技能`,
      recommendations: skills.slice(0, args.limit || 5).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        reason: args.context 
          ? `匹配您的需求: ${args.context}`
          : '基于热门和高评分',
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      message: `推荐失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具注册表
// ═══════════════════════════════════════════════════════════

export const SKILL_MARKET_TOOLS = {
  search_skills,
  discover_skill,
  install_skill,
  get_installed_skills,
  get_skill_categories,
  get_skill_detail,
  recommend_skills,
};

// 工具定义（用于AI识别）
export const SKILL_MARKET_TOOL_DEFINITIONS = [
  {
    name: 'search_skills',
    description: '在技能市场搜索技能',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        category: { type: 'string', description: '分类筛选' },
        tags: { type: 'array', items: { type: 'string' } },
        sortBy: { type: 'string', enum: ['relevance', 'rating', 'downloads', 'newest'] },
        limit: { type: 'number', description: '返回数量' },
      },
    },
  },
  {
    name: 'discover_skill',
    description: '智能发现技能，基于所需能力自动匹配',
    parameters: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: '需要的能力描述' },
        autoInstall: { type: 'boolean', description: '是否自动安装' },
      },
      required: ['capability'],
    },
  },
  {
    name: 'install_skill',
    description: '安装指定技能',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: '技能ID' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'get_installed_skills',
    description: '获取已安装的技能列表',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_skill_categories',
    description: '获取技能分类列表',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_skill_detail',
    description: '获取技能详细信息',
    parameters: {
      type: 'object',
      properties: {
        skillId: { type: 'string' },
      },
      required: ['skillId'],
    },
  },
  {
    name: 'recommend_skills',
    description: '获取智能推荐技能',
    parameters: {
      type: 'object',
      properties: {
        context: { type: 'string', description: '使用场景' },
        limit: { type: 'number' },
      },
    },
  },
];
