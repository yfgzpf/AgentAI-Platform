/**
 * AI使用营销工具的实际示例
 * 
 * 展示AI如何通过function calling直接调用营销工具
 */

import {
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
} from './ai-marketing-tools.js';

console.log('='.repeat(70));
console.log('AI直接调用营销工具 - 实际使用示例');
console.log('='.repeat(70));

async function demonstrateAIUsingTools() {
  // ═══════════════════════════════════════════════════════════
  // 场景1: AI自动创建线索
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景1] AI从对话中提取信息，自动创建线索');
  console.log('-'.repeat(50));
  
  // 模拟：用户说"我叫张先生，电话13800138001，想装修120平米的房子"
  const leadResult = await create_lead({
    name: '张先生',
    phone: '13800138001',
    source: 'wechat',
    sourceDetail: '主动咨询',
    requirements: '120平米房子装修',
    budgetMin: 200000,
    budgetMax: 300000,
    urgency: 'high',
  });
  
  console.log('AI调用 create_lead 结果:');
  console.log('  成功:', leadResult.success);
  console.log('  线索ID:', leadResult.leadId);
  console.log('  评分:', leadResult.score);
  console.log('  优先级:', leadResult.priority);

  // ═══════════════════════════════════════════════════════════
  // 场景2: AI自动添加微信好友
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景2] AI自动添加客户微信');
  console.log('-'.repeat(50));
  
  const addFriendResult = await add_wechat_friend({
    phone: '13800138001',
    greeting: '张先生您好，我是您的专属装修顾问，看到您的咨询想为您提供专业服务',
    source: '线索系统',
  });
  
  console.log('AI调用 add_wechat_friend 结果:');
  console.log('  成功:', addFriendResult.success);
  console.log('  消息:', addFriendResult.message);

  // ═══════════════════════════════════════════════════════════
  // 场景3: AI自动发布朋友圈
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景3] AI自动生成并发布朋友圈');
  console.log('-'.repeat(50));
  
  const postResult = await post_wechat_moments({
    topic: '装修案例分享',
    images: ['https://example.com/case1.jpg'],
  });
  
  console.log('AI调用 post_wechat_moments 结果:');
  console.log('  成功:', postResult.success);
  console.log('  消息:', postResult.message);

  // ═══════════════════════════════════════════════════════════
  // 场景4: AI自动创建跟进任务
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景4] AI自动创建跟进任务');
  console.log('-'.repeat(50));
  
  if (leadResult.leadId) {
    const taskResult = await create_follow_up_task({
      leadId: leadResult.leadId,
      taskType: 'call',
      description: '电话确认量房时间，客户张先生，120平米装修',
      scheduledAt: Date.now() + 24 * 60 * 60 * 1000, // 明天
      priority: 'high',
    });
    
    console.log('AI调用 create_follow_up_task 结果:');
    console.log('  成功:', taskResult.success);
    console.log('  任务ID:', taskResult.taskId);
    console.log('  描述:', taskResult.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 场景5: AI自动群发消息
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景5] AI自动群发优惠活动');
  console.log('-'.repeat(50));
  
  const massResult = await send_mass_message({
    message: '【限时优惠】本周签约客户享受设计费全免，再送全屋智能家居！活动截止本月底，先到先得！',
    target: 'all_customers',
  });
  
  console.log('AI调用 send_mass_message 结果:');
  console.log('  成功:', massResult.success);
  console.log('  发送成功:', massResult.sentCount);
  console.log('  发送失败:', massResult.failedCount);

  // ═══════════════════════════════════════════════════════════
  // 场景6: AI自动更新线索阶段
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景6] AI自动更新线索阶段');
  console.log('-'.repeat(50));
  
  if (leadResult.leadId) {
    const updateResult = await update_lead_stage({
      leadId: leadResult.leadId,
      stage: 'qualified',
      notes: '电话沟通确认，客户预算充足，意向强烈，已预约量房',
    });
    
    console.log('AI调用 update_lead_stage 结果:');
    console.log('  成功:', updateResult.success);
    console.log('  消息:', updateResult.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 场景7: AI自动获取线索列表
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景7] AI自动查询高价值线索');
  console.log('-'.repeat(50));
  
  const leadsResult = await get_leads({
    minScore: 70,
    limit: 5,
  });
  
  console.log('AI调用 get_leads 结果:');
  console.log('  成功:', leadsResult.success);
  console.log('  找到线索数:', leadsResult.leads.length);
  leadsResult.leads.forEach(lead => {
    console.log(`    - ${lead.name || '未知'} | 评分:${lead.score} | 阶段:${lead.stage}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 场景8: AI自动获取统计数据
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景8] AI自动获取营销统计');
  console.log('-'.repeat(50));
  
  const statsResult = await get_marketing_stats({});
  
  console.log('AI调用 get_marketing_stats 结果:');
  console.log('  总线索数:', statsResult.stats.totalLeads);
  console.log('  今日新线索:', statsResult.stats.newLeadsToday);
  console.log('  本月成交:', statsResult.stats.dealsThisMonth);
  console.log('  本月收入:', `¥${statsResult.stats.revenueThisMonth.toLocaleString()}`);
  console.log('  转化率:', `${(statsResult.stats.conversionRate * 100).toFixed(1)}%`);
  console.log('  转化漏斗:');
  statsResult.stats.funnel.forEach(stage => {
    console.log(`    ${stage.stage}: ${stage.count}人`);
  });

  // ═══════════════════════════════════════════════════════════
  // 场景9: AI自动执行完整营销活动
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景9] AI自动执行完整营销活动');
  console.log('-'.repeat(50));
  
  const campaignResult = await run_marketing_campaign({
    campaignType: '装修服务推广',
    target: '所有潜在客户',
  });
  
  console.log('AI调用 run_marketing_campaign 结果:');
  console.log('  成功:', campaignResult.success);
  console.log('  消息:', campaignResult.message);
  console.log('  执行步骤:');
  campaignResult.steps.forEach((step, i) => {
    console.log(`    ${i + 1}. ${step.name}: ${step.status}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 场景10: AI自动启用自动回复
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景10] AI自动启用微信自动回复');
  console.log('-'.repeat(50));
  
  const autoReplyResult = await enable_auto_reply({
    enabled: true,
    role: '专业装修顾问',
    welcomeMessage: '您好！我是您的专属装修顾问，有任何装修问题都可以随时咨询我，我会为您提供专业的建议和服务！',
  });
  
  console.log('AI调用 enable_auto_reply 结果:');
  console.log('  成功:', autoReplyResult.success);
  console.log('  消息:', autoReplyResult.message);

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ AI营销工具调用演示完成！');
  console.log('='.repeat(70));
  console.log('\nAI现在可以直接调用这些工具：');
  console.log('  1. create_lead - 创建线索');
  console.log('  2. add_wechat_friend - 添加微信好友');
  console.log('  3. post_wechat_moments - 发布朋友圈');
  console.log('  4. send_mass_message - 群发消息');
  console.log('  5. create_follow_up_task - 创建跟进任务');
  console.log('  6. update_lead_stage - 更新线索阶段');
  console.log('  7. get_leads - 获取线索列表');
  console.log('  8. get_marketing_stats - 获取统计数据');
  console.log('  9. run_marketing_campaign - 执行营销活动');
  console.log('  10. enable_auto_reply - 启用自动回复');
  console.log('\n这些工具已经集成到系统中，AI可以通过function calling直接调用！');
}

// 运行演示
demonstrateAIUsingTools().catch(console.error);

export { demonstrateAIUsingTools };
