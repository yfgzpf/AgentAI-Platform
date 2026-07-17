/**
 * AI自主营销系统使用示例
 * 
 * 用户只需一句话，AI自动完成所有操作
 */

import { getAgentAIRouter } from './llm-router.js';
import { getAIAutonomousMarketing } from './ai-autonomous-marketing.js';

console.log('='.repeat(70));
console.log('AI自主营销系统 - 一句话完成所有操作');
console.log('='.repeat(70));

async function main() {
  // 初始化
  const router = getAgentAIRouter();
  const aiMarketing = getAIAutonomousMarketing(router);

  // ═══════════════════════════════════════════════════════════
  // 示例1: 用户说一句话，AI自动发朋友圈
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('示例1: 发朋友圈');
  console.log('='.repeat(70));

  const result1 = await aiMarketing.execute('帮我发一条朋友圈，推广装修服务');
  
  console.log('\n📊 执行结果:');
  console.log(`   动作: ${result1.action}`);
  console.log(`   结果: ${result1.result}`);
  console.log(`   详情:`, JSON.stringify(result1.details, null, 2));

  // ═══════════════════════════════════════════════════════════
  // 示例2: 用户说一句话，AI自动群发
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('示例2: 群发消息');
  console.log('='.repeat(70));

  const result2 = await aiMarketing.execute('给所有客户群发一条装修优惠信息');
  
  console.log('\n📊 执行结果:');
  console.log(`   动作: ${result2.action}`);
  console.log(`   结果: ${result2.result}`);

  // ═══════════════════════════════════════════════════════════
  // 示例3: 用户说一句话，AI自动添加好友
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('示例3: 添加好友');
  console.log('='.repeat(70));

  const result3 = await aiMarketing.execute('添加这些手机号到微信：13800138001, 13900139002');
  
  console.log('\n📊 执行结果:');
  console.log(`   动作: ${result3.action}`);
  console.log(`   结果: ${result3.result}`);

  // ═══════════════════════════════════════════════════════════
  // 示例4: 用户说一句话，AI启动自动回复
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('示例4: 启动自动回复');
  console.log('='.repeat(70));

  const result4 = await aiMarketing.execute('帮我自动回复微信消息，我是装修顾问');
  
  console.log('\n📊 执行结果:');
  console.log(`   动作: ${result4.action}`);
  console.log(`   结果: ${result4.result}`);
  
  console.log('\n   💡 系统将持续运行，自动回复 incoming 消息');
  console.log('   按 Ctrl+C 停止');

  // ═══════════════════════════════════════════════════════════
  // 示例5: 用户说一句话，AI执行完整营销活动
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('示例5: 执行完整营销活动');
  console.log('='.repeat(70));

  const result5 = await aiMarketing.execute('执行一个完整的装修推广活动');
  
  console.log('\n📊 执行结果:');
  console.log(`   动作: ${result5.action}`);
  console.log(`   结果: ${result5.result}`);
  console.log(`   活动详情:`, JSON.stringify(result5.details?.campaign, null, 2));

  // 完成
  console.log('\n' + '='.repeat(70));
  console.log('✅ 所有示例执行完成！');
  console.log('='.repeat(70));

  // 停止系统
  await aiMarketing.stop();
}

// 运行
main().catch(console.error);

export { main };
