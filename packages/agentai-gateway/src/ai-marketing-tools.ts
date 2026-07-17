/**
 * AI Marketing Tools - AI可直接调用的营销工具
 * 
 * 这些工具会被注册到tools.ts中，AI通过function calling直接调用
 */

import { getAIAutonomousMarketing } from './ai-autonomous-marketing.js';
import { getLeadConversionSystem } from './lead-conversion-system.js';
import { getEnterpriseAutomationCore } from './enterprise-automation-core.js';
import { getAgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// AI可直接调用的营销工具
// ═══════════════════════════════════════════════════════════

/**
 * 工具1: 发布朋友圈
 * AI调用示例: post_wechat_moments({ content: "装修案例分享...", images: ["url1"] })
 */
export async function post_wechat_moments(args: {
  content?: string;
  images?: string[];
  topic?: string;
}): Promise<{
  success: boolean;
  message: string;
  postId?: string;
  url?: string;
}> {
  console.log('[AI Tool] post_wechat_moments 被调用:', args);

  try {
    const router = getAgentAIRouter();
    const marketing = getAIAutonomousMarketing(router);
    
    // 构建用户指令
    const userCommand = args.content 
      ? `发朋友圈: ${args.content}`
      : `发一条朋友圈，主题是${args.topic || '装修服务推广'}`;

    const result = await marketing.execute(userCommand);

    return {
      success: result.success,
      message: result.result,
      postId: result.details?.content?.id,
      url: result.details?.posted ? 'https://wechat.com/moments' : undefined,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `发布失败: ${error.message}`,
    };
  }
}

/**
 * 工具2: 群发消息
 * AI调用示例: send_mass_message({ message: "优惠活动...", target: "all_customers" })
 */
export async function send_mass_message(args: {
  message: string;
  target?: string;
  filter?: {
    tags?: string[];
    minScore?: number;
  };
}): Promise<{
  success: boolean;
  message: string;
  sentCount: number;
  failedCount: number;
}> {
  console.log('[AI Tool] send_mass_message 被调用:', args);

  try {
    const router = getAgentAIRouter();
    const marketing = getAIAutonomousMarketing(router);
    
    const userCommand = `群发消息: ${args.message}`;
    const result = await marketing.execute(userCommand);

    return {
      success: result.success,
      message: result.result,
      sentCount: result.details?.results?.filter((r: any) => r.success).length || 0,
      failedCount: result.details?.results?.filter((r: any) => !r.success).length || 0,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `群发失败: ${error.message}`,
      sentCount: 0,
      failedCount: 0,
    };
  }
}

/**
 * 工具3: 添加微信好友
 * AI调用示例: add_wechat_friend({ phone: "13800138001", greeting: "您好..." })
 */
export async function add_wechat_friend(args: {
  phone: string;
  greeting?: string;
  source?: string;
}): Promise<{
  success: boolean;
  message: string;
  requestId?: string;
}> {
  console.log('[AI Tool] add_wechat_friend 被调用:', args);

  try {
    const router = getAgentAIRouter();
    const marketing = getAIAutonomousMarketing(router);
    
    const userCommand = `添加微信好友: ${args.phone}`;
    const result = await marketing.execute(userCommand);

    return {
      success: result.success,
      message: result.result,
      requestId: result.details?.request?.id,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `添加失败: ${error.message}`,
    };
  }
}

/**
 * 工具4: 创建线索
 * AI调用示例: create_lead({ name: "张先生", phone: "13800138001", source: "website" })
 */
export async function create_lead(args: {
  name?: string;
  phone?: string;
  wechatId?: string;
  source: string;
  sourceDetail?: string;
  requirements?: string;
  budgetMin?: number;
  budgetMax?: number;
  urgency?: 'high' | 'medium' | 'low';
}): Promise<{
  success: boolean;
  message: string;
  leadId?: string;
  score?: number;
  priority?: string;
}> {
  console.log('[AI Tool] create_lead 被调用:', args);

  try {
    const leadSystem = getLeadConversionSystem();
    
    const lead = leadSystem.createLead({
      source: args.source,
      sourceDetail: args.sourceDetail,
      name: args.name,
      phone: args.phone,
      wechatId: args.wechatId,
      requirements: args.requirements,
      budgetMin: args.budgetMin,
      budgetMax: args.budgetMax,
      urgency: args.urgency || 'medium',
    });

    return {
      success: true,
      message: `线索创建成功: ${lead.name || '未知'}`,
      leadId: lead.id,
      score: lead.score,
      priority: lead.tags?.find((t: string) => ['high', 'medium', 'low'].includes(t)) || 'medium',
    };
  } catch (error: any) {
    return {
      success: false,
      message: `创建失败: ${error.message}`,
    };
  }
}

/**
 * 工具5: 获取线索列表
 * AI调用示例: get_leads({ stage: "new", minScore: 70 })
 */
export async function get_leads(args: {
  stage?: string;
  source?: string;
  minScore?: number;
  limit?: number;
}): Promise<{
  success: boolean;
  message: string;
  leads: Array<{
    id: string;
    name?: string;
    phone?: string;
    source: string;
    score: number;
    stage: string;
    createdAt: number;
  }>;
}> {
  console.log('[AI Tool] get_leads 被调用:', args);

  try {
    const leadSystem = getLeadConversionSystem();
    
    const leads = leadSystem.getLeads({
      stage: args.stage,
      source: args.source,
      minScore: args.minScore,
    });

    const limitedLeads = args.limit ? leads.slice(0, args.limit) : leads;

    return {
      success: true,
      message: `找到 ${leads.length} 个线索`,
      leads: limitedLeads.map(lead => ({
        id: lead.id,
        name: lead.name,
        phone: lead.phone,
        source: lead.source,
        score: lead.score,
        stage: lead.stage,
        createdAt: lead.createdAt,
      })),
    };
  } catch (error: any) {
    return {
      success: false,
      message: `查询失败: ${error.message}`,
      leads: [],
    };
  }
}

/**
 * 工具6: 更新线索阶段
 * AI调用示例: update_lead_stage({ leadId: "lead-xxx", stage: "qualified", notes: "已电话确认" })
 */
export async function update_lead_stage(args: {
  leadId: string;
  stage: string;
  notes?: string;
}): Promise<{
  success: boolean;
  message: string;
}> {
  console.log('[AI Tool] update_lead_stage 被调用:', args);

  try {
    const leadSystem = getLeadConversionSystem();
    
    leadSystem.updateLeadStage(args.leadId, args.stage, args.notes);

    return {
      success: true,
      message: `线索阶段已更新为: ${args.stage}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `更新失败: ${error.message}`,
    };
  }
}

/**
 * 工具7: 创建跟进任务
 * AI调用示例: create_follow_up_task({ leadId: "lead-xxx", taskType: "call", scheduledAt: 1234567890 })
 */
export async function create_follow_up_task(args: {
  leadId: string;
  taskType: 'call' | 'wechat' | 'visit' | 'email' | 'proposal';
  description: string;
  scheduledAt: number;
  priority?: 'high' | 'medium' | 'low';
}): Promise<{
  success: boolean;
  message: string;
  taskId?: string;
}> {
  console.log('[AI Tool] create_follow_up_task 被调用:', args);

  try {
    const leadSystem = getLeadConversionSystem();
    
    const task = leadSystem.createFollowUpTask({
      leadId: args.leadId,
      taskType: args.taskType,
      description: args.description,
      scheduledAt: args.scheduledAt,
      priority: args.priority || 'medium',
    });

    return {
      success: true,
      message: `跟进任务已创建: ${task.description}`,
      taskId: task.id,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `创建失败: ${error.message}`,
    };
  }
}

/**
 * 工具8: 获取营销统计
 * AI调用示例: get_marketing_stats({})
 */
export async function get_marketing_stats(args: {}): Promise<{
  success: boolean;
  message: string;
  stats: {
    totalLeads: number;
    newLeadsToday: number;
    dealsThisMonth: number;
    revenueThisMonth: number;
    conversionRate: number;
    avgDealValue: number;
    funnel: Array<{ stage: string; count: number; value: number }>;
  };
}> {
  console.log('[AI Tool] get_marketing_stats 被调用');

  try {
    const leadSystem = getLeadConversionSystem();
    
    const stats = leadSystem.getDashboardStats();
    const funnel = leadSystem.getConversionFunnel();

    return {
      success: true,
      message: '统计获取成功',
      stats: {
        ...stats,
        funnel,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: `获取失败: ${error.message}`,
      stats: {
        totalLeads: 0,
        newLeadsToday: 0,
        dealsThisMonth: 0,
        revenueThisMonth: 0,
        conversionRate: 0,
        avgDealValue: 0,
        funnel: [],
      },
    };
  }
}

/**
 * 工具9: 执行完整营销活动
 * AI调用示例: run_marketing_campaign({ campaignType: "new_product_launch", target: "all_leads" })
 */
export async function run_marketing_campaign(args: {
  campaignType: string;
  target?: string;
  duration?: number;
}): Promise<{
  success: boolean;
  message: string;
  campaignId?: string;
  steps: Array<{ name: string; status: string; result?: string }>;
}> {
  console.log('[AI Tool] run_marketing_campaign 被调用:', args);

  try {
    const router = getAgentAIRouter();
    const marketing = getAIAutonomousMarketing(router);
    
    const userCommand = `执行营销活动: ${args.campaignType}`;
    const result = await marketing.execute(userCommand);

    return {
      success: result.success,
      message: result.result,
      campaignId: `campaign-${Date.now()}`,
      steps: result.details?.campaign?.steps?.map((step: any) => ({
        name: step.name,
        status: result.success ? 'completed' : 'failed',
      })) || [],
    };
  } catch (error: any) {
    return {
      success: false,
      message: `活动执行失败: ${error.message}`,
      steps: [],
    };
  }
}

/**
 * 工具10: 启动自动回复
 * AI调用示例: enable_auto_reply({ role: "装修顾问", welcomeMessage: "您好..." })
 */
export async function enable_auto_reply(args: {
  role?: string;
  welcomeMessage?: string;
  enabled: boolean;
}): Promise<{
  success: boolean;
  message: string;
}> {
  console.log('[AI Tool] enable_auto_reply 被调用:', args);

  try {
    const router = getAgentAIRouter();
    const marketing = getAIAutonomousMarketing(router);
    
    if (args.enabled) {
      const userCommand = `启动自动回复，我是${args.role || '客服'}`;
      const result = await marketing.execute(userCommand);

      return {
        success: result.success,
        message: result.result,
      };
    } else {
      // 停止自动回复
      await marketing.stop();
      return {
        success: true,
        message: '自动回复已停止',
      };
    }
  } catch (error: any) {
    return {
      success: false,
      message: `操作失败: ${error.message}`,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 工具注册表（用于tools.ts导入）
// ═══════════════════════════════════════════════════════════

export const AI_MARKETING_TOOLS = {
  post_wechat_moments,
  send_mass_message,
  add_wechat_friend,
  create_lead,
  get_leads,
  update_lead_stage,
  create_follow_up_task,
  get_marketing_stats,
  run_marketing_campaign,
  enable_auto_reply,
};

// 工具定义（用于AI识别）
export const AI_MARKETING_TOOL_DEFINITIONS = [
  {
    name: 'post_wechat_moments',
    description: '发布微信朋友圈，支持自动生成内容或指定内容',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '朋友圈内容（可选，不传则AI自动生成）' },
        images: { type: 'array', items: { type: 'string' }, description: '图片URL列表' },
        topic: { type: 'string', description: '主题（用于AI生成内容）' },
      },
    },
  },
  {
    name: 'send_mass_message',
    description: '群发微信消息给多个客户',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: '消息内容' },
        target: { type: 'string', description: '目标人群' },
        filter: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' } },
            minScore: { type: 'number' },
          },
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'add_wechat_friend',
    description: '通过手机号添加微信好友',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string', description: '手机号' },
        greeting: { type: 'string', description: '验证消息' },
        source: { type: 'string', description: '来源渠道' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'create_lead',
    description: '创建新的销售线索',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        wechatId: { type: 'string' },
        source: { type: 'string', description: '线索来源' },
        sourceDetail: { type: 'string' },
        requirements: { type: 'string', description: '需求描述' },
        budgetMin: { type: 'number' },
        budgetMax: { type: 'number' },
        urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['source'],
    },
  },
  {
    name: 'get_leads',
    description: '获取线索列表，支持筛选',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: '阶段筛选' },
        source: { type: 'string' },
        minScore: { type: 'number', description: '最低评分' },
        limit: { type: 'number', description: '返回数量限制' },
      },
    },
  },
  {
    name: 'update_lead_stage',
    description: '更新线索阶段',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        stage: { type: 'string', description: '新阶段' },
        notes: { type: 'string', description: '备注' },
      },
      required: ['leadId', 'stage'],
    },
  },
  {
    name: 'create_follow_up_task',
    description: '创建跟进任务',
    parameters: {
      type: 'object',
      properties: {
        leadId: { type: 'string' },
        taskType: { type: 'string', enum: ['call', 'wechat', 'visit', 'email', 'proposal'] },
        description: { type: 'string' },
        scheduledAt: { type: 'number', description: '计划执行时间（时间戳）' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['leadId', 'taskType', 'description', 'scheduledAt'],
    },
  },
  {
    name: 'get_marketing_stats',
    description: '获取营销统计数据',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'run_marketing_campaign',
    description: '执行完整的营销活动',
    parameters: {
      type: 'object',
      properties: {
        campaignType: { type: 'string', description: '活动类型' },
        target: { type: 'string' },
        duration: { type: 'number' },
      },
      required: ['campaignType'],
    },
  },
  {
    name: 'enable_auto_reply',
    description: '启用或禁用微信自动回复',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        role: { type: 'string', description: '角色定位' },
        welcomeMessage: { type: 'string' },
      },
      required: ['enabled'],
    },
  },
];
