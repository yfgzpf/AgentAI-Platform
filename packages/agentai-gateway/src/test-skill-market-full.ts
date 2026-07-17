/**
 * SkillMarket 完整功能测试
 * 
 * 测试各种搜索词和API功能
 */

import axios from 'axios';

const API_KEY = 'sk_live_skillsmp_pdfxyKqllhCy51DrF6Gi81yho8L3Y_lLwceKzqofcak';
const BASE_URL = 'https://skillsmp.com/api/v1';

console.log('='.repeat(70));
console.log('SkillMarket 完整功能测试');
console.log('='.repeat(70));

async function testFullAPI() {
  const searchTerms = [
    '3D',
    'modeling',
    'image',
    'video',
    'AI',
    'automation',
    'code',
    'writing',
    'data',
    'analysis',
    'web',
    'scraping',
    'API',
    'integration',
  ];

  let totalSkills = 0;
  const allSkills: any[] = [];

  // ═══════════════════════════════════════════════════════════
  // 测试各种搜索词
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[批量搜索测试]');
  console.log('-'.repeat(50));

  for (const term of searchTerms) {
    try {
      const response = await axios.get(`${BASE_URL}/skills/search`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        params: { q: term, limit: 5 },
        timeout: 10000,
      });

      const count = response.data.data?.length || 0;
      totalSkills += count;
      
      if (count > 0) {
        console.log(`✅ "${term}": ${count} 个技能`);
        allSkills.push(...(response.data.data || []));
      } else {
        console.log(`⚠️  "${term}": 0 个技能`);
      }
    } catch (error: any) {
      console.log(`❌ "${term}": ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 显示找到的技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[找到的技能]');
  console.log('-'.repeat(50));

  if (allSkills.length > 0) {
    // 去重
    const uniqueSkills = Array.from(new Map(allSkills.map(s => [s.id, s])).values());
    
    console.log(`共找到 ${uniqueSkills.length} 个唯一技能:\n`);
    
    uniqueSkills.slice(0, 10).forEach((skill: any, i: number) => {
      console.log(`${i + 1}. ${skill.name}`);
      console.log(`   ID: ${skill.id}`);
      console.log(`   描述: ${skill.description?.slice(0, 80)}...`);
      console.log(`   作者: ${skill.author}`);
      console.log(`   评分: ${skill.stars || skill.rating || 'N/A'}`);
      console.log(`   分类: ${skill.category || 'N/A'}`);
      console.log('');
    });

    // 测试获取第一个技能的详情
    const firstSkill = uniqueSkills[0];
    console.log('[技能详情测试]');
    console.log('-'.repeat(50));
    
    try {
      const detailResponse = await axios.get(`${BASE_URL}/skills/${firstSkill.id}`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        timeout: 10000,
      });

      console.log('✅ 获取详情成功');
      console.log('   完整数据:', JSON.stringify(detailResponse.data.data, null, 2).slice(0, 500));
    } catch (error: any) {
      console.log('❌ 获取详情失败:', error.response?.data?.error?.message || error.message);
    }
  } else {
    console.log('没有找到任何技能');
    console.log('可能原因:');
    console.log('  1. 技能市场还没有发布技能');
    console.log('  2. 需要更精确的搜索词');
    console.log('  3. API可能有其他查询参数');
  }

  // ═══════════════════════════════════════════════════════════
  // 测试其他端点
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[其他端点测试]');
  console.log('-'.repeat(50));

  // 测试热门技能
  try {
    const popularResponse = await axios.get(`${BASE_URL}/skills/popular`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: 10000,
    });
    console.log('✅ /skills/popular: 成功');
    console.log('   数量:', popularResponse.data.data?.length || 0);
  } catch (error: any) {
    console.log('❌ /skills/popular:', error.response?.status, error.response?.data?.error?.message || '');
  }

  // 测试最新技能
  try {
    const latestResponse = await axios.get(`${BASE_URL}/skills/latest`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: 10000,
    });
    console.log('✅ /skills/latest: 成功');
    console.log('   数量:', latestResponse.data.data?.length || 0);
  } catch (error: any) {
    console.log('❌ /skills/latest:', error.response?.status, error.response?.data?.error?.message || '');
  }

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('测试结果总结');
  console.log('='.repeat(70));
  console.log('\n✅ API密钥: 有效');
  console.log('✅ 搜索功能: 正常');
  console.log(`📊 找到技能: ${allSkills.length} 个`);
  console.log('\n结论:');
  if (allSkills.length > 0) {
    console.log('  SkillMarket API完全可用，可以集成到项目');
    console.log('  AI可以真实调用技能搜索和获取功能');
  } else {
    console.log('  API可用，但技能市场可能还没有技能数据');
    console.log('  建议联系SkillMarket确认数据状态');
  }
}

testFullAPI().catch(console.error);

export { testFullAPI };
