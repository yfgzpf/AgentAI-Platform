/**
 * SkillMarket API 调试测试
 * 
 * 打印完整响应结构，查看数据格式
 */

import axios from 'axios';

const API_KEY = 'sk_live_skillsmp_pdfxyKqllhCy51DrF6Gi81yho8L3Y_lLwceKzqofcak';
const BASE_URL = 'https://skillsmp.com/api/v1';

console.log('='.repeat(70));
console.log('SkillMarket API 调试 - 查看完整响应结构');
console.log('='.repeat(70));

async function debugAPI() {
  console.log('\n等待60秒避免速率限制...');
  await new Promise(resolve => setTimeout(resolve, 60000));
  
  console.log('\n[测试1] 搜索 "SEO" - 打印完整响应');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: { 
        q: 'SEO',
        limit: 5,
      },
      timeout: 15000,
    });

    console.log('✅ 请求成功');
    console.log('状态:', response.status);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));
    console.log('\n完整响应数据:');
    console.log(JSON.stringify(response.data, null, 2));
    
    // 分析数据结构
    console.log('\n[数据结构分析]');
    console.log('-'.repeat(50));
    console.log('响应键:', Object.keys(response.data));
    
    if (response.data.data) {
      console.log('data类型:', typeof response.data.data);
      console.log('data是数组:', Array.isArray(response.data.data));
      console.log('data长度:', response.data.data.length);
      
      if (response.data.data.length > 0) {
        console.log('\n第一个技能结构:');
        console.log(JSON.stringify(response.data.data[0], null, 2));
      }
    }
    
    if (response.data.meta) {
      console.log('\nMeta信息:');
      console.log(JSON.stringify(response.data.meta, null, 2));
    }
    
  } catch (error: any) {
    console.log('❌ 请求失败');
    console.log('状态:', error.response?.status);
    console.log('错误:', error.response?.data || error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 测试2: 尝试不同的查询参数
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n\n[测试2] 尝试不同查询参数');
  console.log('-'.repeat(50));
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: { 
        q: 'automation',
        page: 1,
        limit: 20,
      },
      timeout: 15000,
    });

    console.log('✅ 请求成功');
    console.log('找到技能:', response.data.data?.length || 0);
    
    if (response.data.data?.length > 0) {
      console.log('\n技能名称列表:');
      response.data.data.forEach((skill: any, i: number) => {
        console.log(`  ${i + 1}. ${skill.name} (ID: ${skill.id})`);
      });
    } else {
      console.log('响应结构:', Object.keys(response.data));
    }
  } catch (error: any) {
    console.log('❌ 请求失败:', error.response?.data?.error?.message || error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 测试3: 如果有技能，测试详情接口
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n\n[测试3] 如果有技能ID，测试详情接口');
  console.log('-'.repeat(50));
  
  // 这里需要一个真实的技能ID
  const testSkillId = 'example-skill-id';
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/${testSkillId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: 10000,
    });

    console.log('✅ 详情请求成功');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.log('❌ 详情请求失败:', error.response?.status);
    console.log('错误:', error.response?.data?.error?.message || error.message);
  }

  console.log('\n' + '='.repeat(70));
  console.log('调试完成');
  console.log('='.repeat(70));
}

debugAPI().catch(console.error);

export { debugAPI };
