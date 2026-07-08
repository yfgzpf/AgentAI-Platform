/**
 * WeChat Acquisition System - 微信自动化获客系统
 * 
 * 参考 ZYAI 微信自动化，实现：
 * 1. 公众号/视频号内容自动发布
 * 2. 私信自动回复与线索收集
 * 3. 朋友圈自动化运营
 * 4. 微信群管理与转化
 * 5. 用户画像自动构建
 */

import { EventEmitter } from 'events';
import { userPreferenceEngine } from './user-preference-engine.js';

export interface WeChatLead {
  id: string;
  openId: string;
  unionId?: string;
  nickname?: string;
  avatar?: string;
  phone?: string;
  // 来源追踪
  source: {
    channel: 'official_account' | 'video_channel' | 'mini_program' | 'moments' | 'group';
    contentId?: string;      // 内容ID
    campaign?: string;       // 活动
    referrer?: string;       // 推荐人
  };
  // 互动记录
  interactions: {
    type: 'view' | 'like' | 'comment' | 'share' | 'message' | 'follow';
    contentId: string;
    timestamp: string;
    metadata?: any;
  }[];
  // 标签
  tags: string[];
  // 状态
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  score: number;  // 线索评分
  createdAt: string;
  updatedAt: string;
}

export interface ContentCampaign {
  id: string;
  name: string;
  type: 'article' | 'video' | 'image' | 'poster';
  platform: 'wechat_official' | 'wechat_video' | 'moments';
  // 内容
  title: string;
  content: string;
  mediaUrls?: string[];
  // 获客设置
  acquisition: {
    enabled: boolean;
    ctaType: 'form' | 'message' | 'phone' | 'mini_program';
    ctaText: string;
    landingPage?: string;
    formFields?: string[];
  };
  // 定向
  targeting: {
    cities?: string[];
    interests?: string[];
    demographics?: {
      age?: string[];
      gender?: string[];
    };
  };
  // 排期
  schedule: {
    publishAt: string;
    timezone: string;
  };
  status: 'draft' | 'scheduled' | 'published' | 'paused';
  stats: {
    views: number;
    likes: number;
    shares: number;
    comments: number;
    leads: number;
  };
}

export class WeChatAcquisitionSystem extends EventEmitter {
  private leads = new Map<string, WeChatLead>();
  private campaigns = new Map<string, ContentCampaign>();

  /**
   * 初始化获客系统
   */
  async initialize(): Promise<void> {
    console.log('[WeChatAcquisition] Initializing...');
    
    // 加载历史线索
    await this.loadLeads();
    
    // 启动自动化任务
    this.startAutomationTasks();
    
    this.emit('initialized');
  }

  /**
   * 创建内容营销活动
   */
  async createCampaign(campaign: Omit<ContentCampaign, 'id' | 'stats'>): Promise<ContentCampaign> {
    const newCampaign: ContentCampaign = {
      ...campaign,
      id: `campaign_${Date.now()}`,
      stats: {
        views: 0,
        likes: 0,
        shares: 0,
        comments: 0,
        leads: 0,
      },
    };

    this.campaigns.set(newCampaign.id, newCampaign);
    
    // 如果设置了定时发布
    if (newCampaign.status === 'scheduled') {
      this.schedulePublish(newCampaign);
    }

    this.emit('campaign:created', { campaign: newCampaign });
    
    return newCampaign;
  }

  /**
   * 自动发布内容（模拟）
   */
  private async schedulePublish(campaign: ContentCampaign): Promise<void> {
    const publishTime = new Date(campaign.schedule.publishAt).getTime();
    const now = Date.now();
    const delay = Math.max(0, publishTime - now);

    setTimeout(async () => {
      await this.publishContent(campaign);
    }, delay);
  }

  /**
   * 发布内容到微信平台
   */
  private async publishContent(campaign: ContentCampaign): Promise<void> {
    console.log(`[WeChatAcquisition] Publishing campaign: ${campaign.title}`);
    
    // 这里集成微信 API 进行实际发布
    // 目前为模拟实现
    
    campaign.status = 'published';
    this.emit('campaign:published', { campaign });
    
    // 启动监控
    this.monitorCampaign(campaign.id);
  }

  /**
   * 监控内容表现
   */
  private async monitorCampaign(campaignId: string): Promise<void> {
    // 模拟数据增长
    const interval = setInterval(() => {
      const campaign = this.campaigns.get(campaignId);
      if (!campaign || campaign.status !== 'published') {
        clearInterval(interval);
        return;
      }

      // 模拟增长
      campaign.stats.views += Math.floor(Math.random() * 10);
      campaign.stats.likes += Math.floor(Math.random() * 3);
      
      this.emit('campaign:stats', { campaignId, stats: campaign.stats });
    }, 60000); // 每分钟更新
  }

  /**
   * 处理用户互动（Webhook 入口）
   */
  async handleInteraction(
    openId: string,
    type: WeChatLead['interactions'][0]['type'],
    contentId: string,
    metadata?: any
  ): Promise<WeChatLead> {
    let lead = await this.getLeadByOpenId(openId);
    
    if (!lead) {
      // 新线索
      lead = await this.createLead({
        openId,
        source: {
          channel: this.detectChannel(contentId),
          contentId,
        },
      });
    }

    // 记录互动
    lead.interactions.push({
      type,
      contentId,
      timestamp: new Date().toISOString(),
      metadata,
    });

    // 更新评分
    lead.score = this.calculateLeadScore(lead);
    lead.updatedAt = new Date().toISOString();

    // 触发自动化流程
    await this.triggerAutomation(lead, type);

    this.emit('lead:interaction', { lead, type });
    
    return lead;
  }

  /**
   * 创建新线索
   */
  private async createLead(data: Partial<WeChatLead>): Promise<WeChatLead> {
    const lead: WeChatLead = {
      id: `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      openId: data.openId!,
      source: data.source || { channel: 'official_account' },
      interactions: [],
      tags: ['new', 'wechat'],
      status: 'new',
      score: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    };

    this.leads.set(lead.id, lead);
    
    // 同步创建用户画像
    await userPreferenceEngine.createProfile(lead.id, {
      profile: {
        name: lead.nickname,
      },
      source: {
        channel: lead.source.channel,
        campaign: lead.source.campaign,
      },
      tags: ['wechat_lead', lead.source.channel],
    });

    this.emit('lead:created', { lead });
    
    return lead;
  }

  /**
   * 触发自动化流程
   */
  private async triggerAutomation(lead: WeChatLead, action: string): Promise<void> {
    // 根据互动类型触发不同流程
    switch (action) {
      case 'follow':
        // 新关注 - 发送欢迎语
        await this.sendWelcomeMessage(lead);
        break;
        
      case 'message':
        // 私信 - 智能回复
        await this.handleMessage(lead);
        break;
        
      case 'view':
        // 查看内容 - 记录兴趣
        await this.trackInterest(lead);
        break;
        
      case 'share':
        // 分享 - 高意向标记
        lead.tags.push('high_intent');
        lead.score += 20;
        break;
    }

    // 高评分线索自动转销售
    if (lead.score >= 80 && lead.status === 'new') {
      await this.qualifyLead(lead);
    }
  }

  /**
   * 发送欢迎消息
   */
  private async sendWelcomeMessage(lead: WeChatLead): Promise<void> {
    const welcomeMsg = `您好！欢迎了解我们的装修服务 🏠

我们可以为您提供：
✅ 免费户型规划
✅ 精准预算报价  
✅ 3D效果预览
✅ 全程施工监理

请回复您的【城市+面积】，我们为您初步估算一下装修预算~`;

    // 这里调用微信 API 发送消息
    console.log(`[WeChatAcquisition] Sending welcome to ${lead.openId}`);
    
    this.emit('message:sent', { leadId: lead.id, message: welcomeMsg });
  }

  /**
   * 处理用户消息（智能回复）
   */
  private async handleMessage(lead: WeChatLead): Promise<void> {
    const lastInteraction = lead.interactions[lead.interactions.length - 1];
    const message = lastInteraction.metadata?.content || '';

    // 提取关键信息
    const extracted = this.extractInfoFromMessage(message);
    
    if (extracted.area || extracted.city) {
      // 更新用户画像
      await userPreferenceEngine.updateProfile(lead.id, {
        profile: {
          city: extracted.city,
          area: extracted.area,
        },
      });

      // 触发报价流程
      if (extracted.area && extracted.city) {
        await this.triggerQuoteFlow(lead, extracted);
      }
    }
  }

  /**
   * 从消息提取信息
   */
  private extractInfoFromMessage(message: string): { city?: string; area?: number } {
    const result: { city?: string; area?: number } = {};
    
    // 提取城市
    const cities = ['北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉'];
    for (const city of cities) {
      if (message.includes(city)) {
        result.city = city;
        break;
      }
    }
    
    // 提取面积
    const areaMatch = message.match(/(\d+)\s*平/);
    if (areaMatch) {
      result.area = parseInt(areaMatch[1]);
    }
    
    return result;
  }

  /**
   * 触发报价流程
   */
  private async triggerQuoteFlow(
    lead: WeChatLead,
    info: { city: string; area: number }
  ): Promise<void> {
    // 获取精准报价参数
    const quoteParams = await userPreferenceEngine.getQuoteParams(
      lead.id,
      info.area
    );

    const quoteMsg = `根据您的情况，初步估算：

📐 面积：${info.area}㎡
📍 城市：${info.city}
💰 建议预算：${quoteParams.totalBudget.toLocaleString()}元
📊 单价：${quoteParams.budgetPerSqm}元/㎡
🎯 档次：${quoteParams.level === 'economy' ? '经济型' : quoteParams.level === 'comfort' ? '舒适型' : '豪华型'}

推荐配置：
${quoteParams.suggestedMaterials.map(m => `• ${m}`).join('\n')}

需要详细报价单？点击获取 👇
[获取详细报价]`;

    console.log(`[WeChatAcquisition] Sending quote to ${lead.openId}`);
    
    this.emit('quote:sent', { leadId: lead.id, quote: quoteParams });
  }

  /**
   * 标记合格线索
   */
  private async qualifyLead(lead: WeChatLead): Promise<void> {
    lead.status = 'qualified';
    lead.tags.push('qualified');
    
    // 通知销售跟进
    this.emit('lead:qualified', { 
      lead,
      notification: {
        type: 'high_intent_lead',
        message: `高意向线索：${lead.nickname || lead.openId}，评分：${lead.score}`,
      }
    });
  }

  /**
   * 计算线索评分
   */
  private calculateLeadScore(lead: WeChatLead): number {
    let score = 0;
    
    // 基础分
    score += lead.interactions.length * 5;
    
    // 互动类型加权
    for (const interaction of lead.interactions) {
      switch (interaction.type) {
        case 'message': score += 10; break;
        case 'share': score += 15; break;
        case 'comment': score += 8; break;
        case 'follow': score += 5; break;
      }
    }
    
    // 标签加成
    if (lead.tags.includes('high_intent')) score += 20;
    if (lead.phone) score += 30;
    
    return Math.min(score, 100);
  }

  /**
   * 检测渠道
   */
  private detectChannel(contentId: string): WeChatLead['source']['channel'] {
    if (contentId.startsWith('video_')) return 'video_channel';
    if (contentId.startsWith('article_')) return 'official_account';
    if (contentId.startsWith('moments_')) return 'moments';
    return 'official_account';
  }

  /**
   * 获取线索
   */
  async getLeadByOpenId(openId: string): Promise<WeChatLead | null> {
    for (const lead of this.leads.values()) {
      if (lead.openId === openId) {
        return lead;
      }
    }
    return null;
  }

  /**
   * 加载历史线索
   */
  private async loadLeads(): Promise<void> {
    // 从持久化存储加载
    console.log('[WeChatAcquisition] Loading historical leads...');
  }

  /**
   * 启动自动化任务
   */
  private startAutomationTasks(): void {
    // 定时发布内容
    setInterval(() => {
      this.checkScheduledCampaigns();
    }, 60000);

    // 线索培育
    setInterval(() => {
      this.nurtureLeads();
    }, 3600000); // 每小时
  }

  /**
   * 检查待发布活动
   */
  private async checkScheduledCampaigns(): Promise<void> {
    const now = new Date();
    for (const campaign of this.campaigns.values()) {
      if (campaign.status === 'scheduled') {
        const publishTime = new Date(campaign.schedule.publishAt);
        if (publishTime <= now) {
          await this.publishContent(campaign);
        }
      }
    }
  }

  /**
   * 线索培育
   */
  private async nurtureLeads(): Promise<void> {
    for (const lead of this.leads.values()) {
      if (lead.status === 'new' && lead.interactions.length > 0) {
        const lastInteraction = new Date(lead.interactions[lead.interactions.length - 1].timestamp);
        const hoursSinceLastInteraction = (Date.now() - lastInteraction.getTime()) / 3600000;
        
        // 24小时未回复，发送培育内容
        if (hoursSinceLastInteraction > 24) {
          await this.sendNurtureContent(lead);
        }
      }
    }
  }

  /**
   * 发送培育内容
   */
  private async sendNurtureContent(lead: WeChatLead): Promise<void> {
    const contents = [
      '【装修干货】2024年最流行的10种装修风格，您喜欢哪一种？',
      '【案例分享】100㎡三室两厅，15万装出25万的效果',
      '【避坑指南】装修前必看的20个注意事项',
    ];
    
    const randomContent = contents[Math.floor(Math.random() * contents.length)];
    
    console.log(`[WeChatAcquisition] Sending nurture to ${lead.openId}: ${randomContent}`);
  }

  /**
   * 获取获客统计
   */
  getStats(): {
    totalLeads: number;
    newLeads: number;
    qualifiedLeads: number;
    convertedLeads: number;
    totalCampaigns: number;
    activeCampaigns: number;
  } {
    const leads = Array.from(this.leads.values());
    const campaigns = Array.from(this.campaigns.values());
    
    return {
      totalLeads: leads.length,
      newLeads: leads.filter(l => l.status === 'new').length,
      qualifiedLeads: leads.filter(l => l.status === 'qualified').length,
      convertedLeads: leads.filter(l => l.status === 'converted').length,
      totalCampaigns: campaigns.length,
      activeCampaigns: campaigns.filter(c => c.status === 'published').length,
    };
  }
}

// 单例导出
export const wechatAcquisition = new WeChatAcquisitionSystem();
