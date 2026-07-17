/**
 * SkillMarket Mock - 模拟数据模式
 * 
 * 当SkillMarket API没有真实数据时，使用模拟数据继续开发和测试
 */

import { SkillMarketSkill } from './skill-market-client.js';

// ═══════════════════════════════════════════════════════════
// 模拟技能数据
// ═══════════════════════════════════════════════════════════

export const MOCK_SKILLS: SkillMarketSkill[] = [
  {
    id: 'tripo3d-modeling',
    name: 'Tripo3D 3D建模',
    description: '使用Tripo3D API生成高质量3D模型，支持文生3D和图生3D',
    version: '1.0.0',
    author: 'PulseFlow Team',
    category: '3d-modeling',
    tags: ['3D', 'modeling', 'AI', 'generation'],
    rating: 4.8,
    downloadCount: 1250,
    price: 0,
    createdAt: '2026-07-01',
    updatedAt: '2026-07-15',
  },
  {
    id: 'image-generation',
    name: 'AI图像生成',
    description: '使用Stable Diffusion等模型生成高质量图像',
    version: '2.1.0',
    author: 'PulseFlow Team',
    category: 'image-generation',
    tags: ['image', 'AI', 'generation', 'art'],
    rating: 4.5,
    downloadCount: 3200,
    price: 0,
    createdAt: '2026-06-15',
    updatedAt: '2026-07-10',
  },
  {
    id: 'video-generation',
    name: 'AI视频生成',
    description: '生成高质量AI视频，支持文生视频和图生视频',
    version: '1.5.0',
    author: 'PulseFlow Team',
    category: 'video-generation',
    tags: ['video', 'AI', 'generation', 'animation'],
    rating: 4.3,
    downloadCount: 890,
    price: 0,
    createdAt: '2026-06-20',
    updatedAt: '2026-07-12',
  },
  {
    id: 'web-scraping',
    name: '智能网页抓取',
    description: '自动抓取网页数据，支持动态渲染和反爬虫绕过',
    version: '3.0.0',
    author: 'PulseFlow Team',
    category: 'automation',
    tags: ['scraping', 'web', 'data', 'automation'],
    rating: 4.7,
    downloadCount: 2100,
    price: 0,
    createdAt: '2026-05-10',
    updatedAt: '2026-07-08',
  },
  {
    id: 'code-generation',
    name: '智能代码生成',
    description: '根据需求自动生成代码，支持多种编程语言',
    version: '2.0.0',
    author: 'PulseFlow Team',
    category: 'code-generation',
    tags: ['code', 'AI', 'generation', 'programming'],
    rating: 4.6,
    downloadCount: 2800,
    price: 0,
    createdAt: '2026-05-20',
    updatedAt: '2026-07-05',
  },
  {
    id: 'data-analysis',
    name: '数据分析助手',
    description: '自动分析数据，生成图表和洞察报告',
    version: '1.8.0',
    author: 'PulseFlow Team',
    category: 'data-analysis',
    tags: ['data', 'analysis', 'visualization', 'AI'],
    rating: 4.4,
    downloadCount: 1500,
    price: 0,
    createdAt: '2026-06-01',
    updatedAt: '2026-07-01',
  },
  {
    id: 'marketing-automation',
    name: '营销自动化',
    description: '自动化营销任务，包括社交媒体发布、邮件营销等',
    version: '1.2.0',
    author: 'PulseFlow Team',
    category: 'marketing',
    tags: ['marketing', 'automation', 'social', 'email'],
    rating: 4.2,
    downloadCount: 980,
    price: 0,
    createdAt: '2026-06-10',
    updatedAt: '2026-06-28',
  },
  {
    id: 'document-processing',
    name: '文档智能处理',
    description: '自动处理文档，包括OCR、摘要生成、翻译等',
    version: '2.3.0',
    author: 'PulseFlow Team',
    category: 'productivity',
    tags: ['document', 'OCR', 'AI', 'processing'],
    rating: 4.5,
    downloadCount: 1800,
    price: 0,
    createdAt: '2026-05-15',
    updatedAt: '2026-07-03',
  },
];

// ═══════════════════════════════════════════════════════════
// 模拟搜索函数
// ═══════════════════════════════════════════════════════════

export function mockSearchSkills(params: {
  query?: string;
  category?: string;
  tags?: string[];
  sortBy?: string;
}): { skills: SkillMarketSkill[]; total: number } {
  let results = [...MOCK_SKILLS];

  // 关键词搜索
  if (params.query) {
    const query = params.query.toLowerCase();
    results = results.filter(skill =>
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }

  // 分类筛选
  if (params.category) {
    results = results.filter(skill =>
      skill.category.toLowerCase() === params.category?.toLowerCase()
    );
  }

  // 标签筛选
  if (params.tags && params.tags.length > 0) {
    results = results.filter(skill =>
      params.tags!.some(tag => skill.tags.includes(tag))
    );
  }

  // 排序
  if (params.sortBy === 'stars' || params.sortBy === 'rating') {
    results.sort((a, b) => b.rating - a.rating);
  } else if (params.sortBy === 'newest') {
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } else if (params.sortBy === 'downloads') {
    results.sort((a, b) => b.downloadCount - a.downloadCount);
  }

  return {
    skills: results,
    total: results.length,
  };
}

// ═══════════════════════════════════════════════════════════
// 模拟获取技能详情
// ═══════════════════════════════════════════════════════════

export function mockGetSkillDetail(skillId: string): SkillMarketSkill | undefined {
  return MOCK_SKILLS.find(skill => skill.id === skillId);
}

// ═══════════════════════════════════════════════════════════
// 模拟分类
// ═══════════════════════════════════════════════════════════

export function mockGetCategories(): string[] {
  const categories = new Set(MOCK_SKILLS.map(skill => skill.category));
  return Array.from(categories);
}

// ═══════════════════════════════════════════════════════════
// 模拟推荐
// ═══════════════════════════════════════════════════════════

export function mockGetRecommendedSkills(context?: string): SkillMarketSkill[] {
  if (!context) {
    // 返回评分最高的
    return [...MOCK_SKILLS].sort((a, b) => b.rating - a.rating).slice(0, 5);
  }

  // 基于上下文匹配
  const contextLower = context.toLowerCase();
  return MOCK_SKILLS.filter(skill =>
    skill.name.toLowerCase().includes(contextLower) ||
    skill.description.toLowerCase().includes(contextLower) ||
    skill.tags.some(tag => tag.toLowerCase().includes(contextLower))
  ).slice(0, 5);
}
