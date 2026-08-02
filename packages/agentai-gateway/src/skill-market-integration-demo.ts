// @ts-nocheck
/**
 * SkillMarket 集成演示 - AI真实调用示例
 * 
 * 演示AI如何：
 * 1. 遇到无法处理的任务
 * 2. 自动发现所需技能
 * 3. 安装并获取能力
 * 4. 使用新技能完成任务
 */

import { getAISkillDiscovery } from './ai-skill-discovery.js';
import { SKILL_MARKET_TOOLS } from './skill-market-tools.js';

console.log('='.repeat(70));
console.log('SkillMarket 集成演示 - AI真实调用');
console.log('='.repeat(70));

async function demonstrateAIUsingSkillMarket() {
  const discovery = getAISkillDiscovery();

  // ═══════════════════════════════════════════════════════════
  // 场景1: AI需要3D建模能力
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景1] AI需要3D建模能力');
  console.log('-'.repeat(50));
  console.log('用户: "帮我创建一个3D机器人模型"');
  console.log('AI: 我需要3D建模技能...');

  const result1 = await discovery.discoverSkillForTask('3D modeling robot');
  
  if (result1.found) {
    console.log(`✅ 发现技能: ${result1.skill!.name}`);
    console.log(`   作者: ${result1.skill!.author}`);
    console.log(`   评分: ${result1.skill!.stars}`);
    console.log(`   已安装: ${result1.alreadyInstalled ? '是' : '否'}`);
    console.log(`   自动安装: ${result1.autoInstalled ? '成功' : '失败'}`);
    
    if (result1.alternatives) {
      console.log(`   备选技能: ${result1.alternatives.map(s => s.name).join(', ')}`);
    }
  } else {
    console.log('❌ 未发现匹配技能');
  }

  // ═══════════════════════════════════════════════════════════
  // 场景2: AI调用工具搜索技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景2] AI调用search_skills工具');
  console.log('-'.repeat(50));

  const searchResult = await SKILL_MARKET_TOOLS.search_skills({
    query: 'automation',
    limit: 5,
  });

  console.log('AI调用结果:', searchResult.success ? '✅ 成功' : '❌ 失败');
  if (searchResult.skills) {
    console.log(`找到 ${searchResult.total} 个技能:`);
    searchResult.skills.forEach((skill, i) => {
      console.log(`  ${i + 1}. ${skill.name} (${skill.stars}⭐)`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 场景3: AI调用工具发现技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景3] AI调用discover_skill工具');
  console.log('-'.repeat(50));
  console.log('AI: 我需要网页抓取能力...');

  const discoverResult = await SKILL_MARKET_TOOLS.discover_skill({
    capability: 'web scraping',
    autoInstall: true,
  });

  console.log('AI调用结果:', discoverResult.success ? '✅ 成功' : '❌ 失败');
  if (discoverResult.found) {
    console.log(`发现技能: ${discoverResult.skill!.name}`);
    console.log(`自动安装: ${discoverResult.installed ? '成功' : '未安装'}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 场景4: AI获取已安装技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景4] AI调用get_installed_skills工具');
  console.log('-'.repeat(50));

  const installedResult = await SKILL_MARKET_TOOLS.get_installed_skills({});
  
  console.log(`AI当前拥有 ${installedResult.count} 个技能:`);
  if (installedResult.skills) {
    installedResult.skills.forEach((skill, i) => {
      console.log(`  ${i + 1}. ${skill.name} v${skill.version}`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 场景5: 智能缓存测试
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景5] 智能缓存测试');
  console.log('-'.repeat(50));
  console.log('第一次查询 "data analysis"...');
  
  const start1 = Date.now();
  await discovery.discoverSkillForTask('data analysis');
  const time1 = Date.now() - start1;
  console.log(`耗时: ${time1}ms`);

  console.log('第二次查询 "data analysis"（应该命中缓存）...');
  const start2 = Date.now();
  await discovery.discoverSkillForTask('data analysis');
  const time2 = Date.now() - start2;
  console.log(`耗时: ${time2}ms (缓存命中)`);

  // ═══════════════════════════════════════════════════════════
  // 统计
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[系统统计]');
  console.log('-'.repeat(50));
  const stats = discovery.getStats();
  console.log(`缓存条目: ${stats.cacheSize}`);
  console.log(`已安装技能: ${stats.installedSkills}`);

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('演示完成！');
  console.log('='.repeat(70));
  console.log('\n✅ AI现在可以：');
  console.log('   1. 自动发现所需技能');
  console.log('   2. 调用SkillMarket API搜索');
  console.log('   3. 自动安装获取能力');
  console.log('   4. 使用缓存避免重复调用');
  console.log('\n✅ 集成到agentai-loop后，AI会在需要时自动调用这些工具');
}

// 运行演示
demonstrateAIUsingSkillMarket().catch(console.error);

export { demonstrateAIUsingSkillMarket };
