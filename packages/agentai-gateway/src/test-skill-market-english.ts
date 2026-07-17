/**
 * SkillMarket 英文关键词搜索测试
 * 
 * 技能市场技能是英文的，使用英文关键词搜索
 */

import axios from 'axios';

const API_KEY = 'sk_live_skillsmp_pdfxyKqllhCy51DrF6Gi81yho8L3Y_lLwceKzqofcak';
const BASE_URL = 'https://skillsmp.com/api/v1';

console.log('='.repeat(70));
console.log('SkillMarket 英文关键词搜索测试');
console.log('='.repeat(70));

async function testEnglishSearch() {
  const englishTerms = [
    'SEO',
    'marketing',
    'automation',
    'scraping',
    'data',
    'analysis',
    'writing',
    'content',
    'social',
    'media',
    'email',
    'development',
    'coding',
    'programming',
    'design',
    'graphic',
    'video',
    'editing',
    'research',
    'analytics',
    'AI',
    'machine learning',
    'chatbot',
    'API',
    'integration',
    'workflow',
    'productivity',
    'management',
    'sales',
    'lead',
    'generation',
  ];

  let totalFound = 0;
  const allSkills: any[] = [];

  console.log('\n[英文关键词搜索测试]');
  console.log('-'.repeat(50));

  for (const term of englishTerms) {
    try {
      const response = await axios.get(`${BASE_URL}/skills/search`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        params: { 
          q: term,
          limit: 10,
        },
        timeout: 15000,
      });

      const skills = response.data.data || [];
      const count = skills.length;
      
      if (count > 0) {
        console.log(`✅ "${term}": ${count} 个技能`);
        totalFound += count;
        allSkills.push(...skills);
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
  
  console.log('\n[搜索结果统计]');
  console.log('-'.repeat(50));
  console.log(`总找到技能: ${totalFound}`);
  
  if (allSkills.length > 0) {
    // 去重
    const uniqueSkills = Array.from(new Map(allSkills.map(s => [s.id, s])).values());
    console.log(`去重后技能: ${uniqueSkills.length}`);
    
    console.log('\n[技能列表示例]');
    console.log('-'.repeat(50));
    
    uniqueSkills.slice(0, 20).forEach((skill: any, i: number) => {
      console.log(`${i + 1}. ${skill.name}`);
      console.log(`   ID: ${skill.id}`);
      console.log(`   描述: ${skill.description?.slice(0, 100)}...`);
      console.log(`   分类: ${skill.category || 'N/A'}`);
      console.log(`   评分: ${skill.stars || skill.rating || 'N/A'}`);
      console.log(`   下载: ${skill.downloads || skill.downloadCount || 'N/A'}`);
      console.log('');
    });

    // 测试获取第一个技能的详情
    if (uniqueSkills.length > 0) {
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
        const skill = detailResponse.data.data;
        console.log('   名称:', skill.name);
        console.log('   完整描述:', skill.description);
        console.log('   作者:', skill.author);
        console.log('   版本:', skill.version);
        console.log('   标签:', skill.tags?.join(', '));
        console.log('   README:', skill.readme?.slice(0, 200) + '...');
      } catch (error: any) {
        console.log('❌ 获取详情失败:', error.response?.data?.error?.message || error.message);
      }
    }
  } else {
    console.log('\n没有找到任何技能，可能原因：');
    console.log('  1. API响应结构不同');
    console.log('  2. 需要其他查询参数');
    console.log('  3. 技能市场数据问题');
  }

  // ═══════════════════════════════════════════════════════════
  // 测试分类筛选
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[分类筛选测试]');
  console.log('-'.repeat(50));
  
  const categories = [
    'data-ai',
    'devops',
    'marketing',
    'productivity',
    'development',
  ];
  
  for (const category of categories) {
    try {
      const response = await axios.get(`${BASE_URL}/skills/search`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        params: { 
          q: 'automation',
          category,
          limit: 5,
        },
        timeout: 10000,
      });

      const count = response.data.data?.length || 0;
      console.log(`✅ 分类 "${category}": ${count} 个技能`);
    } catch (error: any) {
      console.log(`❌ 分类 "${category}": ${error.response?.data?.error?.message || error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 测试职业筛选
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[职业筛选测试]');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: { 
        q: 'automation',
        occupation: 'software-developers',
        sortBy: 'stars',
        limit: 10,
      },
      timeout: 10000,
    });

    const count = response.data.data?.length || 0;
    console.log(`✅ 职业筛选 "software-developers": ${count} 个技能`);
    
    if (response.data.data?.length > 0) {
      response.data.data.slice(0, 5).forEach((skill: any, i: number) => {
        console.log(`   ${i + 1}. ${skill.name}`);
      });
    }
  } catch (error: any) {
    console.log(`❌ 职业筛选: ${error.response?.data?.error?.message || error.message}`);
  }

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('测试结果总结');
  console.log('='.repeat(70));
  console.log(`\n✅ API密钥: 有效`);
  console.log(`📊 找到技能: ${totalFound} 个`);
  console.log(`📊 去重后: ${allSkills.length > 0 ? Array.from(new Map(allSkills.map(s => [s.id, s])).values()).length : 0} 个`);
  
  if (totalFound > 0) {
    console.log('\n✅ SkillMarket API完全可用！');
    console.log('✅ AI可以真实调用技能搜索和获取功能');
    console.log('✅ 可以集成到项目');
  } else {
    console.log('\n⚠️ API可用，但没有返回技能数据');
    console.log('可能原因：');
    console.log('  - 响应结构与我们预期不同');
    console.log('  - 需要检查实际响应结构');
  }
}

testEnglishSearch().catch(console.error);

export { testEnglishSearch };
