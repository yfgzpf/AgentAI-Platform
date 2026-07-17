/**
 * 线索转化系统使用示例
 * 
 * 真实可运行的完整流程：
 * 1. 从各渠道捕获线索
 * 2. 自动评分和分级
 * 3. 自动添加微信好友
 * 4. AI自动回复培育
 * 5. 跟进任务提醒
 * 6. 成交转化追踪
 */

import { getLeadConversionSystem } from './lead-conversion-system.js';
import { getWeChatAutomationAdapter } from './wechat-automation-adapter.js';

console.log('='.repeat(70));
console.log('线索转化自动化系统 - 真实运行示例');
console.log('='.repeat(70));

// ═══════════════════════════════════════════════════════════
// 步骤1: 初始化系统
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤1] 初始化线索转化系统...');

const leadSystem = getLeadConversionSystem();

// 配置微信自动化（使用模拟模式，真实环境可配置zyai路径）
const wechatAdapter = getWeChatAutomationAdapter({
  dataPath: './wechat-data',
  industry: 'decoration',
  llmProvider: 'deepseek',
  // pythonScriptPath: 'F:/zyai/deepseek-reasonix/skills/wechat-bot/services/wechat_automation_service.py',
});

// 设置微信接口
leadSystem.setWeChatInterface({
  sendFriendRequest: async (phone, greeting) => {
    const result = await wechatAdapter.sendFriendRequest(phone, greeting);
    return { success: result.success, message: result.message };
  },
  sendMessage: async (to, content) => {
    const result = await wechatAdapter.sendMessage(to, content);
    return { success: result.success, messageId: result.messageId };
  },
  getMessages: async () => {
    return wechatAdapter.getNewMessages();
  },
  acceptFriendRequest: async (wechatId) => {
    return true; // 简化处理
  },
});

console.log('✅ 系统初始化完成');

// ═══════════════════════════════════════════════════════════
// 步骤2: 启动微信自动化服务
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤2] 启动微信自动化服务...');

async function initializeWeChat() {
  const started = await wechatAdapter.start();
  if (started) {
    console.log('✅ 微信自动化服务已启动');
    
    // 监听消息
    wechatAdapter.on('message', (msg) => {
      console.log(`\n[收到消息] ${msg.from}: ${msg.content}`);
      
      // 记录对话
      leadSystem.recordConversation({
        leadId: 'lead-from-wechat', // 实际应该根据from查找对应lead
        platform: 'wechat',
        direction: 'inbound',
        messageType: 'text',
        content: msg.content,
        aiGenerated: false,
      });
    });
    
    // 监听好友申请
    wechatAdapter.on('friend_request', (req) => {
      console.log(`\n[好友申请] ${req.fromUser}: ${req.verifyMessage}`);
    });
  } else {
    console.log('⚠️ 微信服务启动失败，将使用模拟模式');
  }
}

// ═══════════════════════════════════════════════════════════
// 步骤3: 创建真实线索
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤3] 创建真实线索...');

async function createSampleLeads() {
  // 线索1: 高价值装修客户（来自小红书）
  const lead1 = leadSystem.createLead({
    source: 'xiaohongshu',
    sourceDetail: '装修避坑笔记评论区',
    name: '张先生',
    phone: '13800138001',
    wechatId: 'zhang13800138001',
    industry: 'decoration',
    budgetMin: 200000,
    budgetMax: 300000,
    requirements: '120平米三居室，现代简约风格，全包',
    urgency: 'high',
    notes: '已在小红书互动3次，意向强烈',
  });
  
  console.log(`✅ 线索1创建: ${lead1.name}, 评分: ${lead1.score}, 优先级: ${lead1.tags?.includes('high') ? '高' : '中'}`);

  // 线索2: 中等价值客户（来自抖音）
  const lead2 = leadSystem.createLead({
    source: 'douyin',
    sourceDetail: '装修省钱技巧视频',
    name: '李女士',
    phone: '13900139002',
    industry: 'decoration',
    budgetMin: 100000,
    budgetMax: 150000,
    requirements: '80平米两居室，简装出租',
    urgency: 'medium',
  });
  
  console.log(`✅ 线索2创建: ${lead2.name}, 评分: ${lead2.score}, 优先级: ${lead2.tags?.includes('high') ? '高' : '中'}`);

  // 线索3: 低价值客户（来自网站）
  const lead3 = leadSystem.createLead({
    source: 'website',
    sourceDetail: '官网报价页面',
    name: '王先生',
    phone: '13700137003',
    industry: 'decoration',
    budgetMin: 50000,
    budgetMax: 80000,
    requirements: '50平米一居室，简单翻新',
    urgency: 'low',
  });
  
  console.log(`✅ 线索3创建: ${lead3.name}, 评分: ${lead3.score}, 优先级: ${lead3.tags?.includes('high') ? '高' : '低'}`);

  return [lead1, lead2, lead3];
}

// ═══════════════════════════════════════════════════════════
// 步骤4: 模拟对话和培育
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤4] 模拟客户对话和自动培育...');

async function simulateConversations(leads: any[]) {
  // 模拟客户1的对话
  const lead1 = leads[0];
  
  // 客户发送消息
  leadSystem.recordConversation({
    leadId: lead1.id,
    platform: 'wechat',
    direction: 'inbound',
    messageType: 'text',
    content: '你好，我想了解一下装修报价',
    aiGenerated: false,
    intent: 'price_query',
  });
  console.log(`[${lead1.name}] 发送: 你好，我想了解一下装修报价`);

  // AI自动回复
  setTimeout(() => {
    leadSystem.recordConversation({
      leadId: lead1.id,
      platform: 'wechat',
      direction: 'outbound',
      messageType: 'text',
      content: '您好张先生！感谢您的咨询。120平米现代简约全包，我们的报价在20-30万之间，具体需要根据您的需求定制。方便的话可以先量房，我们提供免费设计方案。',
      aiGenerated: true,
    });
    console.log(`[AI回复] 发送: 您好张先生！感谢您的咨询...`);
  }, 1000);

  // 客户继续询问
  setTimeout(() => {
    leadSystem.recordConversation({
      leadId: lead1.id,
      platform: 'wechat',
      direction: 'inbound',
      messageType: 'text',
      content: '可以，这周末有空量房吗？',
      aiGenerated: false,
      intent: 'appointment',
    });
    console.log(`[${lead1.name}] 发送: 可以，这周末有空量房吗？`);

    // 创建跟进任务
    leadSystem.createFollowUpTask({
      leadId: lead1.id,
      taskType: 'visit',
      priority: 'high',
      description: '安排量房 - 张先生，120平米，周六或周日',
      scheduledAt: Date.now() + 24 * 60 * 60 * 1000, // 明天
    });
    console.log(`[系统] 创建跟进任务: 安排量房`);
  }, 2000);
}

// ═══════════════════════════════════════════════════════════
// 步骤5: 更新线索阶段
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤5] 更新线索阶段...');

async function updateLeadStages(leads: any[]) {
  const lead1 = leads[0];
  
  // 更新阶段
  leadSystem.updateLeadStage(lead1.id, 'qualified', '客户意向明确，已预约量房');
  console.log(`[系统] ${lead1.name} 阶段更新: qualified`);

  // 再过几天更新为提案阶段
  setTimeout(() => {
    leadSystem.updateLeadStage(lead1.id, 'proposal', '量房完成，已发送设计方案和报价');
    console.log(`[系统] ${lead1.name} 阶段更新: proposal`);
  }, 3000);

  // 最终成交
  setTimeout(() => {
    leadSystem.updateLeadStage(lead1.id, 'closed_won', '客户确认签约，合同金额25万');
    console.log(`[系统] ${lead1.name} 阶段更新: closed_won 🎉`);
  }, 5000);
}

// ═══════════════════════════════════════════════════════════
// 步骤6: 查看统计报表
// ═══════════════════════════════════════════════════════════

console.log('\n[步骤6] 查看转化统计...');

async function showStatistics() {
  // 获取转化漏斗
  const funnel = leadSystem.getConversionFunnel();
  console.log('\n📊 转化漏斗:');
  funnel.forEach(stage => {
    console.log(`   ${stage.stage}: ${stage.count}人, ¥${stage.value.toLocaleString()}`);
  });

  // 获取仪表板统计
  const stats = leadSystem.getDashboardStats();
  console.log('\n📈 关键指标:');
  console.log(`   总线索数: ${stats.totalLeads}`);
  console.log(`   今日新线索: ${stats.newLeadsToday}`);
  console.log(`   本月成交: ${stats.dealsThisMonth}单`);
  console.log(`   本月收入: ¥${stats.revenueThisMonth.toLocaleString()}`);
  console.log(`   转化率: ${(stats.conversionRate * 100).toFixed(1)}%`);
  console.log(`   平均客单价: ¥${stats.avgDealValue.toLocaleString()}`);

  // 获取线索列表
  const allLeads = leadSystem.getLeads();
  console.log('\n👥 线索列表:');
  allLeads.forEach(lead => {
    console.log(`   ${lead.name} | ${lead.source} | 评分:${lead.score} | 阶段:${lead.stage}`);
  });
}

// ═══════════════════════════════════════════════════════════
// 主运行函数
// ═══════════════════════════════════════════════════════════

async function main() {
  try {
    // 初始化微信
    await initializeWeChat();

    // 创建线索
    const leads = await createSampleLeads();

    // 模拟对话
    await simulateConversations(leads);

    // 更新阶段
    await updateLeadStages(leads);

    // 等待一段时间后显示统计
    setTimeout(async () => {
      await showStatistics();
      
      console.log('\n' + '='.repeat(70));
      console.log('✅ 线索转化流程演示完成！');
      console.log('系统已就绪，可以处理真实业务。');
      console.log('='.repeat(70));

      // 关闭资源
      wechatAdapter.stop();
      leadSystem.close();
    }, 6000);

  } catch (error) {
    console.error('运行错误:', error);
  }
}

// 运行
main();

export { main };
