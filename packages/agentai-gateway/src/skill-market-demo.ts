/**
 * 技能市场演示
 * 
 * 演示AI如何自动发现和获取技能
 */

import {
  search_skills,
  discover_skill,
  install_skill,
  get_installed_skills,
  get_skill_categories,
  get_skill_detail,
  recommend_skills,
} from './skill-market-tools.js';
import { getSkillMarketClient } from './skill-market-client.js';

console.log('='.repeat(70));
console.log('SkillMarket 技能市场 - AI自动发现技能演示');
console.log('='.repeat(70));

async function main() {
  // ═══════════════════════════════════════════════════════════
  // 场景1: AI需要3D建模能力，自动发现技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景1] AI需要3D建模能力，自动发现技能');
  console.log('-'.repeat(50));

  const discovery = await discover_skill({
    capability: '3D模型生成',
    autoInstall: true,
  });

  console.log('发现结果:', discovery.found ? '✅ 找到' : '❌ 未找到');
  if (discovery.skill) {
    console.log('推荐技能:', discovery.skill.name);
    console.log('评分:', discovery.skill.rating);
    console.log('已安装:', discovery.installed ? '是' : '否');
  }
  if (discovery.alternatives) {
    console.log('备选技能:', discovery.alternatives.map(s => s.name).join(', '));
  }

  // ═══════════════════════════════════════════════════════════
  // 场景2: 搜索图像生成技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景2] 搜索图像生成技能');
  console.log('-'.repeat(50));

  const searchResult = await search_skills({
    query: 'image generation',
    category: 'image-generation',
    sortBy: 'rating',
    limit: 5,
  });

  console.log('搜索结果:', searchResult.success ? '✅ 成功' : '❌ 失败');
  console.log('找到技能:', searchResult.total);
  if (searchResult.skills) {
    searchResult.skills.forEach((skill, i) => {
      console.log(`  ${i + 1}. ${skill.name} (${skill.rating}⭐, ${skill.downloads}下载)`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 场景3: 获取技能分类
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景3] 获取技能分类');
  console.log('-'.repeat(50));

  const categories = await get_skill_categories({});
  console.log('分类数量:', categories.categories?.length);
  if (categories.categories) {
    categories.categories.forEach(cat => {
      console.log(`  - ${cat}`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 场景4: 获取已安装技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景4] 获取已安装技能');
  console.log('-'.repeat(50));

  const installed = await get_installed_skills({});
  console.log('已安装技能数:', installed.count);
  if (installed.skills && installed.skills.length > 0) {
    installed.skills.forEach(skill => {
      console.log(`  - ${skill.name} v${skill.version} [${skill.category}]`);
    });
  } else {
    console.log('  暂无已安装技能');
  }

  // ═══════════════════════════════════════════════════════════
  // 场景5: 智能推荐
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景5] 基于场景智能推荐技能');
  console.log('-'.repeat(50));

  const recommendations = await recommend_skills({
    context: '视频编辑和后期处理',
    limit: 3,
  });

  console.log('推荐结果:', recommendations.success ? '✅ 成功' : '❌ 失败');
  if (recommendations.recommendations) {
    recommendations.recommendations.forEach((rec, i) => {
      console.log(`  ${i + 1}. ${rec.name}`);
      console.log(`     ${rec.description}`);
      console.log(`     推荐理由: ${rec.reason}`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 场景6: 安装技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景6] 安装技能');
  console.log('-'.repeat(50));

  // 假设发现了一个技能ID
  const mockSkillId = 'tripo3d-modeling';
  const installResult = await install_skill({
    skillId: mockSkillId,
  });

  console.log('安装结果:', installResult.success ? '✅ 成功' : '❌ 失败');
  console.log('消息:', installResult.message);
  if (installResult.installPath) {
    console.log('安装路径:', installResult.installPath);
  }

  // ═══════════════════════════════════════════════════════════
  // 完成
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('演示完成！');
  console.log('='.repeat(70));
  console.log('\nAI现在可以自动：');
  console.log('  1. 发现技能 - 根据需求自动搜索');
  console.log('  2. 安装技能 - 一键安装所需能力');
  console.log('  3. 管理技能 - 查看已安装技能');
  console.log('  4. 获取推荐 - 基于场景智能推荐');
  console.log('\n这样AI就不会缺少任何技能了！');
}

// 运行
main().catch(console.error);

export { main };
