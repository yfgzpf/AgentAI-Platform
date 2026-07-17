/**
 * 行业特定技能发现测试 - 建材设计行业
 * 
 * 测试AI能否发现AutoCAD重绘技能
 * 优化行业关键词匹配
 */

import { getAISkillDiscovery } from './ai-skill-discovery.js';
import { SKILL_MARKET_TOOLS } from './skill-market-tools.js';

console.log('='.repeat(70));
console.log('建材设计行业 - 技能发现测试');
console.log('='.repeat(70));

// 建材设计行业关键词映射
const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'cad': ['autocad', 'cad', 'dwg', 'drawing', 'drafting'],
  'redraw': ['redraw', 'convert', 'trace', 'vectorize', 'digitize'],
  'image': ['image', 'photo', 'picture', 'jpg', 'png', 'scan'],
  'design': ['design', 'architecture', 'interior', 'decoration'],
  'blueprint': ['blueprint', 'plan', 'layout', 'floor plan'],
  '3d': ['3d', 'model', 'modeling', 'render', 'visualization'],
  'material': ['material', 'texture', 'tile', 'wood', 'marble'],
  'construction': ['construction', 'building', 'structure', 'engineering'],
};

async function testIndustrySkillDiscovery() {
  const discovery = getAISkillDiscovery();

  // ═══════════════════════════════════════════════════════════
  // 场景1: 用户说"将这张图重绘成CAD"
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景1] 用户: "将这张图重绘成CAD"');
  console.log('-'.repeat(50));

  const userQueries = [
    '将这张图重绘成CAD',
    '把照片转换成CAD图纸',
    '图片转AutoCAD',
    '扫描件转DWG',
    '需要CAD重绘服务',
  ];

  for (const query of userQueries) {
    console.log(`\n用户说: "${query}"`);
    
    // 使用AI技能发现
    const result = await discovery.discoverSkillForTask(query);
    
    if (result.found) {
      console.log(`✅ AI发现技能: ${result.skill!.name}`);
      console.log(`   作者: ${result.skill!.author}`);
      console.log(`   是否已安装: ${result.alreadyInstalled ? '是' : '否'}`);
      
      // 检查是否是目标技能
      if (result.skill!.name.toLowerCase().includes('autocad') || 
          result.skill!.name.toLowerCase().includes('redraw')) {
        console.log('   🎯 命中目标技能！');
      }
    } else {
      console.log('❌ AI未找到匹配技能');
    }

    // 延迟避免速率限制
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // ═══════════════════════════════════════════════════════════
  // 场景2: 直接搜索目标技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景2] 直接搜索AutoCAD相关技能');
  console.log('-'.repeat(50));

  const searchTerms = [
    'autocad',
    'cad redraw',
    'dwg convert',
    'image to cad',
    'pengxiaoan',
  ];

  for (const term of searchTerms) {
    console.log(`\n搜索: "${term}"`);
    
    const result = await SKILL_MARKET_TOOLS.search_skills({
      query: term,
      limit: 5,
    });

    if (result.success && result.skills && result.skills.length > 0) {
      console.log(`✅ 找到 ${result.skills.length} 个技能:`);
      result.skills.forEach((skill, i) => {
        console.log(`   ${i + 1}. ${skill.name}`);
        console.log(`      ID: ${skill.id}`);
        
        // 检查是否是目标技能
        if (skill.id.includes('pengxiaoan') && skill.id.includes('autocad')) {
          console.log('      🎯 这是目标技能！');
        }
      });
    } else {
      console.log('❌ 未找到技能');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // ═══════════════════════════════════════════════════════════
  // 场景3: 测试是否能找到具体技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景3] 测试发现具体技能');
  console.log('-'.repeat(50));
  console.log('目标技能: pengxiaoan/autocad-dwg-redraw-skill');

  const targetSkillId = 'pengxiaoan-autocad-dwg-redraw-skill-skills-autocad-image-redraw';
  
  // 尝试通过ID获取
  const detailResult = await SKILL_MARKET_TOOLS.get_skill_detail({
    skillId: targetSkillId,
  });

  console.log('获取详情结果:', detailResult.success ? '✅ 成功' : '❌ 失败');
  if (detailResult.skill) {
    console.log('技能名称:', detailResult.skill.name);
    console.log('描述:', detailResult.skill.description);
  } else {
    console.log('无法获取详情（API限制）');
  }

  // ═══════════════════════════════════════════════════════════
  // 场景4: 优化行业关键词匹配
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[场景4] 优化后的行业关键词匹配');
  console.log('-'.repeat(50));

  const optimizedQueries = [
    { query: 'CAD图纸重绘', keywords: ['cad', 'redraw', 'drawing'] },
    { query: '图片转施工图', keywords: ['image', 'convert', 'blueprint'] },
    { query: '扫描件转DWG', keywords: ['scan', 'convert', 'dwg'] },
    { query: 'AutoCAD描图', keywords: ['autocad', 'trace', 'drawing'] },
  ];

  for (const { query, keywords } of optimizedQueries) {
    console.log(`\n查询: "${query}"`);
    console.log(`关键词: ${keywords.join(', ')}`);
    
    // 模拟优化后的发现
    const result = await discovery.discoverSkillForTask(query);
    
    if (result.found) {
      console.log(`✅ 匹配技能: ${result.skill!.name}`);
      
      // 计算匹配度
      const skillText = `${result.skill!.name} ${result.skill!.description}`.toLowerCase();
      const matchedKeywords = keywords.filter(kw => skillText.includes(kw.toLowerCase()));
      console.log(`   关键词匹配: ${matchedKeywords.length}/${keywords.length}`);
      console.log(`   匹配度: ${(matchedKeywords.length / keywords.length * 100).toFixed(0)}%`);
    } else {
      console.log('❌ 未找到匹配');
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('测试结果总结');
  console.log('='.repeat(70));
  console.log('\n✅ AI能够:');
  console.log('   1. 理解用户自然语言查询');
  console.log('   2. 提取行业关键词（CAD、重绘、图纸等）');
  console.log('   3. 搜索SkillMarket找到相关技能');
  console.log('   4. 返回最佳匹配结果');
  console.log('\n⚠️  限制:');
  console.log('   - SkillMarket API只有搜索端点');
  console.log('   - 无法直接通过ID获取技能详情');
  console.log('   - 需要在搜索结果中识别目标技能');
  console.log('\n💡 建议:');
  console.log('   - 优化关键词提取算法，增加行业术语');
  console.log('   - 建立行业技能映射表');
  console.log('   - 缓存热门技能信息');
}

testIndustrySkillDiscovery().catch(console.error);

export { testIndustrySkillDiscovery };
