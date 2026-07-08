/**
 * User Preference Engine - 用户偏好与价格体系引擎
 * 
 * 核心功能：
 * 1. 首次接触自动记录用户偏好（风格、预算、需求）
 * 2. 建立用户价格体系（经济/舒适/豪华定位）
 * 3. 后续报价自动匹配用户价格体系
 * 4. 动态定价调研（问卷+行为分析）
 * 5. 与获客系统联动，实现自动化
 */

import { EventEmitter } from 'events';
import { persistentMemory } from './persistent-memory.js';

export interface UserPreference {
  userId: string;
  // 基础画像
  profile: {
    name?: string;
    phone?: string;
    city?: string;
    district?: string;
    houseType?: 'apartment' | 'villa' | 'old' | 'new';
    area?: number;
    rooms?: string;
  };
  // 风格偏好
  style: {
    preferred: string[];      // 喜欢的风格
    disliked: string[];       // 不喜欢的风格
    colors: string[];         // 颜色偏好
    materials: string[];      // 材质偏好
  };
  // 价格体系（核心）
  pricing: {
    level: 'economy' | 'comfort' | 'luxury' | 'unknown';  // 价格档次
    budgetPerSqm: number;      // 每平米预算
    totalBudget: number;       // 总预算
    budgetFlexible: boolean;   // 预算是否可调整
    priorityAreas: string[];   // 重点投入区域
    sensitiveAreas: string[];  // 价格敏感区域
  };
  // 功能需求
  functional: {
    storageLevel: 'high' | 'medium' | 'low';
    hasChildren: boolean;
    hasElderly: boolean;
    hasPets: boolean;
    homeOffice: boolean;
    cookingFrequency: 'daily' | 'often' | 'occasional' | 'never';
    specialNeeds: string[];
  };
  // 行为数据
  behavior: {
    firstContactAt: string;
    lastActiveAt: string;
    viewCount: number;
    inquiryCount: number;
    quoteCount: number;
    preferredContact: 'wechat' | 'phone' | 'visit';
    decisionSpeed: 'fast' | 'normal' | 'slow';
  };
  // 获客来源
  source: {
    channel: 'wechat' | 'douyin' | 'xiaohongshu' | 'referral' | 'offline' | 'other';
    campaign?: string;         // 营销活动
    referrer?: string;         // 推荐人
    landingPage?: string;      // 落地页
  };
  // 动态标签
  tags: string[];
  // 版本控制
  version: number;
  updatedAt: string;
}

export interface PricingSurvey {
  userId: string;
  surveyId: string;
  status: 'pending' | 'completed' | 'expired';
  questions: SurveyQuestion[];
  answers: Record<string, any>;
  result: {
    suggestedLevel: string;
    suggestedBudget: number;
    confidence: number;  // 置信度
  };
  createdAt: string;
  completedAt?: string;
}

interface SurveyQuestion {
  id: string;
  type: 'single' | 'multiple' | 'number' | 'text' | 'slider';
  question: string;
  options?: string[];
  weight: number;  // 对定价的影响权重
}

export class UserPreferenceEngine extends EventEmitter {
  private preferences = new Map<string, UserPreference>();
  private surveys = new Map<string, PricingSurvey>();

  /**
   * 首次接触 - 自动创建用户画像
   */
  async createProfile(userId: string, initialData: Partial<UserPreference>): Promise<UserPreference> {
    const existing = await this.getProfile(userId);
    if (existing) {
      return this.updateProfile(userId, initialData);
    }

    const profile: UserPreference = {
      userId,
      profile: {
        city: initialData.profile?.city,
        ...initialData.profile,
      },
      style: {
        preferred: initialData.style?.preferred || [],
        disliked: initialData.style?.disliked || [],
        colors: initialData.style?.colors || [],
        materials: initialData.style?.materials || [],
      },
      pricing: {
        level: 'unknown',
        budgetPerSqm: 0,
        totalBudget: 0,
        budgetFlexible: true,
        priorityAreas: [],
        sensitiveAreas: [],
        ...initialData.pricing,
      },
      functional: {
        storageLevel: 'medium',
        hasChildren: false,
        hasElderly: false,
        hasPets: false,
        homeOffice: false,
        cookingFrequency: 'often',
        specialNeeds: [],
        ...initialData.functional,
      },
      behavior: {
        firstContactAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        viewCount: 1,
        inquiryCount: 0,
        quoteCount: 0,
        preferredContact: 'wechat',
        decisionSpeed: 'normal',
        ...initialData.behavior,
      },
      source: {
        channel: 'wechat',
        ...initialData.source,
      },
      tags: initialData.tags || [],
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    // 保存到持久化存储
    await this.saveProfile(profile);
    
    this.emit('profile:created', { userId, profile });
    
    // 触发定价调研
    if (profile.pricing.level === 'unknown') {
      this.createPricingSurvey(userId);
    }

    return profile;
  }

  /**
   * 更新用户画像
   */
  async updateProfile(userId: string, updates: Partial<UserPreference>): Promise<UserPreference> {
    const existing = await this.getProfile(userId);
    if (!existing) {
      throw new Error(`User profile not found: ${userId}`);
    }

    const updated: UserPreference = {
      ...existing,
      ...updates,
      profile: { ...existing.profile, ...updates.profile },
      style: { ...existing.style, ...updates.style },
      pricing: { ...existing.pricing, ...updates.pricing },
      functional: { ...existing.functional, ...updates.functional },
      behavior: { 
        ...existing.behavior, 
        ...updates.behavior,
        lastActiveAt: new Date().toISOString(),
      },
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };

    await this.saveProfile(updated);
    this.emit('profile:updated', { userId, profile: updated, changes: updates });

    return updated;
  }

  /**
   * 获取用户画像
   */
  async getProfile(userId: string): Promise<UserPreference | null> {
    // 先查内存
    if (this.preferences.has(userId)) {
      return this.preferences.get(userId)!;
    }

    // 查持久化存储
    try {
      const data = await persistentMemory.get(`user:preference:${userId}`);
      if (data) {
        const profile = JSON.parse(data) as UserPreference;
        this.preferences.set(userId, profile);
        return profile;
      }
    } catch (e) {
      console.error('[UserPreferenceEngine] Failed to load profile:', e);
    }

    return null;
  }

  /**
   * 创建定价调研问卷
   */
  async createPricingSurvey(userId: string): Promise<PricingSurvey> {
    const survey: PricingSurvey = {
      userId,
      surveyId: `survey_${Date.now()}`,
      status: 'pending',
      questions: this.generatePricingQuestions(),
      answers: {},
      result: {
        suggestedLevel: 'unknown',
        suggestedBudget: 0,
        confidence: 0,
      },
      createdAt: new Date().toISOString(),
    };

    this.surveys.set(survey.surveyId, survey);
    
    // 保存到用户画像
    await this.updateProfile(userId, {
      tags: [...(await this.getProfile(userId))?.tags || [], 'pricing_survey_pending'],
    });

    this.emit('survey:created', { userId, survey });
    
    return survey;
  }

  /**
   * 生成定价调研问题
   */
  private generatePricingQuestions(): SurveyQuestion[] {
    return [
      {
        id: 'house_value',
        type: 'single',
        question: '您的房屋总价大约是多少？',
        options: ['100万以下', '100-200万', '200-500万', '500-1000万', '1000万以上'],
        weight: 0.3,
      },
      {
        id: 'income_level',
        type: 'single',
        question: '您的家庭年收入大约是多少？',
        options: ['10万以下', '10-20万', '20-50万', '50-100万', '100万以上'],
        weight: 0.25,
      },
      {
        id: 'brand_preference',
        type: 'single',
        question: '您更倾向于哪种品牌策略？',
        options: ['性价比优先，不追求品牌', '国产品牌即可', '进口品牌，品质优先', '顶级品牌，彰显身份'],
        weight: 0.2,
      },
      {
        id: 'renovation_history',
        type: 'single',
        question: '您之前有过装修经验吗？',
        options: ['第一次装修', '装修过1次', '装修过2次以上'],
        weight: 0.1,
      },
      {
        id: 'priority_areas',
        type: 'multiple',
        question: '您愿意在哪些区域投入更多预算？（多选）',
        options: ['客厅', '主卧', '厨房', '卫生间', '儿童房', '书房', '阳台'],
        weight: 0.15,
      },
    ];
  }

  /**
   * 提交定价调研答案
   */
  async submitSurveyAnswers(surveyId: string, answers: Record<string, any>): Promise<PricingSurvey> {
    const survey = this.surveys.get(surveyId);
    if (!survey) {
      throw new Error(`Survey not found: ${surveyId}`);
    }

    survey.answers = answers;
    survey.status = 'completed';
    survey.completedAt = new Date().toISOString();

    // 分析结果
    const result = this.analyzePricingSurvey(survey);
    survey.result = result;

    // 更新用户画像
    await this.updateProfile(survey.userId, {
      pricing: {
        level: result.suggestedLevel as any,
        budgetPerSqm: result.suggestedBudget,
        totalBudget: 0, // 需要根据面积计算
        budgetFlexible: true,
        priorityAreas: answers.priority_areas || [],
        sensitiveAreas: [],
      },
      tags: ['pricing_survey_completed', `pricing_${result.suggestedLevel}`],
    });

    this.emit('survey:completed', { surveyId, survey });

    return survey;
  }

  /**
   * 分析定价调研结果
   */
  private analyzePricingSurvey(survey: PricingSurvey): PricingSurvey['result'] {
    const answers = survey.answers;
    let score = 0;

    // 房屋价值评分
    const houseValueMap: Record<string, number> = {
      '100万以下': 1,
      '100-200万': 2,
      '200-500万': 3,
      '500-1000万': 4,
      '1000万以上': 5,
    };
    score += (houseValueMap[answers.house_value] || 3) * 0.3;

    // 收入评分
    const incomeMap: Record<string, number> = {
      '10万以下': 1,
      '10-20万': 2,
      '20-50万': 3,
      '50-100万': 4,
      '100万以上': 5,
    };
    score += (incomeMap[answers.income_level] || 3) * 0.25;

    // 品牌偏好评分
    const brandMap: Record<string, number> = {
      '性价比优先，不追求品牌': 1,
      '国产品牌即可': 2,
      '进口品牌，品质优先': 4,
      '顶级品牌，彰显身份': 5,
    };
    score += (brandMap[answers.brand_preference] || 3) * 0.2;

    // 确定档次和预算
    let level: string;
    let budgetPerSqm: number;

    if (score <= 2) {
      level = 'economy';
      budgetPerSqm = 1000;
    } else if (score <= 3.5) {
      level = 'comfort';
      budgetPerSqm = 1800;
    } else {
      level = 'luxury';
      budgetPerSqm = 3500;
    }

    return {
      suggestedLevel: level,
      suggestedBudget: budgetPerSqm,
      confidence: Math.min(score / 5, 1),
    };
  }

  /**
   * 获取精准报价参数
   * 根据用户画像自动调整报价
   */
  async getQuoteParams(userId: string, baseArea: number): Promise<{
    level: string;
    budgetPerSqm: number;
    totalBudget: number;
    priorityAreas: string[];
    suggestedMaterials: string[];
  }> {
    const profile = await this.getProfile(userId);
    if (!profile) {
      // 未识别用户，返回默认
      return {
        level: 'comfort',
        budgetPerSqm: 1500,
        totalBudget: baseArea * 1500,
        priorityAreas: ['客厅', '主卧'],
        suggestedMaterials: ['国产一线品牌'],
      };
    }

    const pricing = profile.pricing;
    
    // 根据用户画像调整
    let adjustedBudget = pricing.budgetPerSqm;
    
    // 有老人/小孩 - 增加环保预算
    if (profile.functional.hasChildren || profile.functional.hasElderly) {
      adjustedBudget *= 1.1;
    }
    
    // 高频做饭 - 增加厨房预算
    if (profile.functional.cookingFrequency === 'daily') {
      adjustedBudget *= 1.05;
    }
    
    // 居家办公 - 增加书房预算
    if (profile.functional.homeOffice) {
      adjustedBudget *= 1.05;
    }

    return {
      level: pricing.level,
      budgetPerSqm: Math.round(adjustedBudget),
      totalBudget: Math.round(adjustedBudget * baseArea),
      priorityAreas: pricing.priorityAreas,
      suggestedMaterials: this.getSuggestedMaterials(pricing.level),
    };
  }

  /**
   * 获取推荐材料档次
   */
  private getSuggestedMaterials(level: string): string[] {
    const materials: Record<string, string[]> = {
      economy: ['国产性价比品牌', '基础款瓷砖', '复合地板', '乳胶漆'],
      comfort: ['国产一线品牌', '通体大理石瓷砖', '实木复合地板', '进口涂料'],
      luxury: ['进口高端品牌', '天然大理石', '实木地板', '艺术涂料', '智能卫浴'],
    };
    return materials[level] || materials.comfort;
  }

  /**
   * 保存用户画像
   */
  private async saveProfile(profile: UserPreference): Promise<void> {
    this.preferences.set(profile.userId, profile);
    
    try {
      await persistentMemory.set(
        `user:preference:${profile.userId}`,
        JSON.stringify(profile),
        { namespace: 'user_preferences' }
      );
    } catch (e) {
      console.error('[UserPreferenceEngine] Failed to save profile:', e);
    }
  }

  /**
   * 获取相似用户画像（用于推荐）
   */
  async getSimilarProfiles(userId: string, limit: number = 5): Promise<UserPreference[]> {
    const target = await this.getProfile(userId);
    if (!target) return [];

    const allProfiles = Array.from(this.preferences.values());
    
    // 简单相似度计算
    const scored = allProfiles
      .filter(p => p.userId !== userId)
      .map(p => ({
        profile: p,
        score: this.calculateSimilarity(target, p),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return scored.map(s => s.profile);
  }

  /**
   * 计算用户相似度
   */
  private calculateSimilarity(a: UserPreference, b: UserPreference): number {
    let score = 0;
    
    // 城市相同
    if (a.profile.city === b.profile.city) score += 1;
    
    // 面积相近
    if (a.profile.area && b.profile.area) {
      const areaDiff = Math.abs(a.profile.area - b.profile.area);
      if (areaDiff < 20) score += 1;
    }
    
    // 风格相同
    const styleOverlap = a.style.preferred.filter(s => b.style.preferred.includes(s));
    score += styleOverlap.length * 0.5;
    
    // 价格档次相同
    if (a.pricing.level === b.pricing.level) score += 2;
    
    return score;
  }
}

// 单例导出
export const userPreferenceEngine = new UserPreferenceEngine();
