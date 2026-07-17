/**
 * Unified Agent Core 演示
 * 
 * 展示统一智能体核心的强大能力
 */

import { getAgentAIRouter } from './llm-router.js';
import { getUnifiedAgentCore } from './unified-agent-core.js';

console.log('='.repeat(70));
console.log('Unified Agent Core - 无所不能的智能体');
console.log('='.repeat(70));

async function demonstrateUnifiedCore() {
  const router = getAgentAIRouter();
  const core = getUnifiedAgentCore(router);

  // 启动系统
  core.start();

  // 监听事件
  core.on('skill:installed', (skill) => {
    console.log(`\n[事件] 技能已安装: ${skill.name}`);
  });

  // ═══════════════════════════════════════════════════════════
  // 场景1: 建材设计 - CAD重绘
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('[场景1] 建材设计行业 - CAD重绘');
  console.log('='.repeat(70));
  console.log('用户: "将这张图重绘成CAD格式"');

  const result1 = await core.processRequest({
    content: '将这张图重绘成CAD格式',
    userId: 'user-001',
    sessionId: 'session-001',
  });

  console.log('\n处理结果:');
  console.log('✅ 成功:', result1.success);
  console.log('📝 AI回复:', result1.response);
  console.log('🔧 执行动作:', result1.actions.join(' → '));
  console.log('🛠️ 使用技能:', result1.skillsUsed.join(', ') || '无');

  // ═══════════════════════════════════════════════════════════
  // 场景2: 多媒体生成 - 3D模型
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('[场景2] 多媒体生成 - 3D模型');
  console.log('='.repeat(70));
  console.log('用户: "生成一个科幻风格的机器人3D模型"');

  const result2 = await core.processRequest({
    content: '生成一个科幻风格的机器人3D模型',
    userId: 'user-001',
    sessionId: 'session-002',
  });

  console.log('\n处理结果:');
  console.log('✅ 成功:', result2.success);
  console.log('📝 AI回复:', result2.response);
  console.log('🔧 执行动作:', result2.actions.join(' → '));

  // ═══════════════════════════════════════════════════════════
  // 场景3: 营销自动化 - 客户管理
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('[场景3] 营销自动化 - 客户管理');
  console.log('='.repeat(70));
  console.log('用户: "帮我创建一个新客户线索，张先生，电话13800138001，想装修房子"');

  const result3 = await core.processRequest({
    content: '帮我创建一个新客户线索，张先生，电话13800138001，想装修房子',
    userId: 'user-001',
    sessionId: 'session-003',
  });

  console.log('\n处理结果:');
  console.log('✅ 成功:', result3.success);
  console.log('📝 AI回复:', result3.response);
  console.log('🔧 执行动作:', result3.actions.join(' → '));

  // ═══════════════════════════════════════════════════════════
  // 场景4: 技能发现 - 自动获取能力
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('[场景4] 技能发现 - 自动获取能力');
  console.log('='.repeat(70));
  console.log('用户: "我需要网页抓取技能来采集竞品数据"');

  const result4 = await core.processRequest({
    content: '我需要网页抓取技能来采集竞品数据',
    userId: 'user-001',
    sessionId: 'session-004',
  });

  console.log('\n处理结果:');
  console.log('✅ 成功:', result4.success);
  console.log('📝 AI回复:', result4.response);
  console.log('🔧 执行动作:', result4.actions.join(' → '));
  console.log('🛠️ 使用技能:', result4.skillsUsed.join(', ') || '无');

  // ═══════════════════════════════════════════════════════════
  // 系统统计
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('[系统统计]');
  console.log('='.repeat(70));

  const stats = core.getStats();
  console.log('📊 总请求数:', stats.totalRequests);
  console.log('✅ 成功请求:', stats.successfulRequests);
  console.log('🔍 技能发现:', stats.skillsDiscovered);
  console.log('📦 技能安装:', stats.skillsInstalled);
  console.log('🎨 媒体生成:', stats.mediaGenerated);
  console.log('👥 线索创建:', stats.leadsCreated);
  console.log('❌ 错误数:', stats.errors);

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('✅ 统一智能体核心演示完成！');
  console.log('='.repeat(70));
  console.log('\n🚀 系统能力:');
  console.log('   ✓ 技能市场自动发现');
  console.log('   ✓ 行业特定处理（建材设计）');
  console.log('   ✓ 多媒体生成（图像/视频/3D）');
  console.log('   ✓ 营销自动化（线索/微信）');
  console.log('   ✓ 自我进化（错误学习）');
  console.log('   ✓ 统一入口处理所有请求');
  console.log('\n💪 真正强大，无所不能！');

  // 停止系统
  core.stop();
}

// 运行演示
demonstrateUnifiedCore().catch(console.error);

export { demonstrateUnifiedCore };
