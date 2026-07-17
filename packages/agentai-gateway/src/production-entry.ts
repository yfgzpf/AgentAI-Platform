/**
 * Production Entry - 生产级统一入口
 * 
 * 这是融合所有能力的生产级入口，agentai-loop.ts应该调用这个入口
 */

import { getIntegratedAgentCore, AI_MARKETING_TOOLS } from './integrated-agent-core.js';
import { getAgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// 生产级工具注册
// ═══════════════════════════════════════════════════════════

/**
 * 注册所有营销工具到ToolRegistry
 * 
 * 这个函数应该在agentai-loop初始化时调用
 */
export function registerAllMarketingTools(toolRegistry: any): void {
  console.log('[ProductionEntry] 注册营销工具到ToolRegistry...');

  const tools = [
    {
      name: 'create_lead',
      handler: AI_MARKETING_TOOLS.create_lead,
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '客户姓名' },
          phone: { type: 'string', description: '手机号' },
          source: { type: 'string', description: '线索来源' },
          requirements: { type: 'string', description: '需求描述' },
          budgetMin: { type: 'number', description: '预算下限' },
          budgetMax: { type: 'number', description: '预算上限' },
          urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['source'],
      },
    },
    {
      name: 'add_wechat_friend',
      handler: AI_MARKETING_TOOLS.add_wechat_friend,
      schema: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: '手机号' },
          greeting: { type: 'string', description: '验证消息' },
          source: { type: 'string', description: '来源' },
        },
        required: ['phone'],
      },
    },
    {
      name: 'post_wechat_moments',
      handler: AI_MARKETING_TOOLS.post_wechat_moments,
      schema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '内容' },
          topic: { type: 'string', description: '主题' },
          images: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    {
      name: 'send_mass_message',
      handler: AI_MARKETING_TOOLS.send_mass_message,
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '消息内容' },
          target: { type: 'string', description: '目标人群' },
        },
        required: ['message'],
      },
    },
    {
      name: 'get_leads',
      handler: AI_MARKETING_TOOLS.get_leads,
      schema: {
        type: 'object',
        properties: {
          stage: { type: 'string' },
          minScore: { type: 'number' },
          limit: { type: 'number' },
        },
      },
    },
    {
      name: 'update_lead_stage',
      handler: AI_MARKETING_TOOLS.update_lead_stage,
      schema: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          stage: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['leadId', 'stage'],
      },
    },
    {
      name: 'create_follow_up_task',
      handler: AI_MARKETING_TOOLS.create_follow_up_task,
      schema: {
        type: 'object',
        properties: {
          leadId: { type: 'string' },
          taskType: { type: 'string', enum: ['call', 'wechat', 'visit', 'email', 'proposal'] },
          description: { type: 'string' },
          scheduledAt: { type: 'number' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['leadId', 'taskType', 'description', 'scheduledAt'],
      },
    },
    {
      name: 'get_marketing_stats',
      handler: AI_MARKETING_TOOLS.get_marketing_stats,
      schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'run_marketing_campaign',
      handler: AI_MARKETING_TOOLS.run_marketing_campaign,
      schema: {
        type: 'object',
        properties: {
          campaignType: { type: 'string' },
          target: { type: 'string' },
        },
        required: ['campaignType'],
      },
    },
    {
      name: 'enable_auto_reply',
      handler: AI_MARKETING_TOOLS.enable_auto_reply,
      schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          role: { type: 'string' },
          welcomeMessage: { type: 'string' },
        },
        required: ['enabled'],
      },
    },
  ];

  for (const tool of tools) {
    toolRegistry.register(tool.name, tool.handler, tool.schema);
    console.log(`   ✅ 注册工具: ${tool.name}`);
  }

  console.log(`[ProductionEntry] ✅ 共注册 ${tools.length} 个营销工具`);
}

/**
 * 初始化生产级系统
 * 
 * 这个函数应该在应用启动时调用
 */
export async function initializeProductionSystem(): Promise<{
  success: boolean;
  message: string;
  status: any;
}> {
  console.log('\n' + '='.repeat(60));
  console.log('初始化生产级融合系统');
  console.log('='.repeat(60));

  try {
    const router = getAgentAIRouter();
    const core = getIntegratedAgentCore(router);

    // 获取系统状态
    const status = core.getSystemStatus();

    console.log('\n系统状态:');
    console.log(`   信任等级: ${status.trustLevel}`);
    console.log(`   待学习缺口: ${status.activeGaps}`);
    console.log(`   技能基因组: ${status.skillCount}`);
    console.log(`   世界模型实体: ${status.worldModelEntities}`);
    console.log(`   线索总数: ${status.leadCount}`);

    console.log('\n可用工具:');
    const tools = core.getAvailableTools();
    tools.forEach(tool => {
      console.log(`   - ${tool.name}: ${tool.description}`);
    });

    console.log('\n✅ 生产级系统初始化完成');
    console.log('='.repeat(60));

    return {
      success: true,
      message: '系统初始化成功',
      status,
    };

  } catch (error: any) {
    console.error('❌ 初始化失败:', error.message);
    return {
      success: false,
      message: error.message,
      status: null,
    };
  }
}

/**
 * 执行融合任务（供agentai-loop调用）
 * 
 * 这是agentai-loop应该调用的统一入口
 */
export async function executeIntegratedTask(params: {
  toolName: string;
  toolArgs: any;
  userId: string;
  sessionId: string;
}): Promise<any> {
  const router = getAgentAIRouter();
  const core = getIntegratedAgentCore(router);

  return await core.executeTask({
    taskType: 'tool_execution',
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    userId: params.userId,
    sessionId: params.sessionId,
  });
}

/**
 * 快速执行示例
 */
export async function quickDemo(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('生产级系统快速演示');
  console.log('='.repeat(60));

  // 初始化
  const init = await initializeProductionSystem();
  if (!init.success) {
    console.error('初始化失败:', init.message);
    return;
  }

  // 演示1: 创建线索
  console.log('\n[演示1] 创建线索');
  const result1 = await executeIntegratedTask({
    toolName: 'create_lead',
    toolArgs: {
      name: '张先生',
      phone: '13800138001',
      source: 'website',
      requirements: '120平米装修',
      budgetMin: 200000,
      budgetMax: 300000,
      urgency: 'high',
    },
    userId: 'user-001',
    sessionId: 'session-001',
  });
  console.log('结果:', result1.success ? '✅ 成功' : '❌ 失败');
  console.log('信任决策:', result1.trustDecision);

  // 演示2: 获取统计
  console.log('\n[演示2] 获取营销统计');
  const result2 = await executeIntegratedTask({
    toolName: 'get_marketing_stats',
    toolArgs: {},
    userId: 'user-001',
    sessionId: 'session-001',
  });
  console.log('结果:', result2.success ? '✅ 成功' : '❌ 失败');
  console.log('统计:', result2.result?.stats);

  console.log('\n' + '='.repeat(60));
  console.log('演示完成');
  console.log('='.repeat(60));
}

// 如果直接运行此文件，执行演示
if (import.meta.url === `file://${process.argv[1]}`) {
  quickDemo().catch(console.error);
}
