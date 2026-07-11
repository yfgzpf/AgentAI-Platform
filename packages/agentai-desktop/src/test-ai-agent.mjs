/**
 * AI Browser Agent 测试脚本
 * 
 * 演示AI如何自动操作浏览器获客
 */

import { aiBrowserAgent } from './ai-browser-agent.ts';

async function main() {
  console.log('🚀 启动AI浏览器代理测试\n');

  try {
    // 1. 初始化
    console.log('1. 初始化浏览器...');
    await aiBrowserAgent.init(false); // false = 显示浏览器窗口

    // 2. 执行获客任务
    console.log('\n2. 执行获客任务...');
    const leads = await aiBrowserAgent.executeLeadGenerationTask({
      platform: 'douyin',
      keyword: '装修',
      maxLeads: 5,
    });

    // 3. 保存结果
    console.log('\n3. 保存结果...');
    await aiBrowserAgent.saveResults('./leads-result.json');

    // 4. 打印结果
    console.log('\n✅ 获客完成！');
    console.log(`采集到 ${leads.length} 条线索：`);
    leads.forEach((lead, i) => {
      console.log(`\n[${i + 1}] ${lead.username}`);
      console.log(`    评论: ${lead.comment}`);
      console.log(`    意向分: ${lead.intentScore}/10`);
      console.log(`    视频: ${lead.videoTitle}`);
    });

  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    // 关闭浏览器
    await aiBrowserAgent.close();
  }
}

// 运行测试
main();
