/**
 * SkillMarket API 真实可用性测试
 * 
 * 测试内容：
 * 1. API端点是否可达
 * 2. 认证是否有效
 * 3. 响应格式是否正确
 * 4. 功能是否正常
 */

import axios from 'axios';

const API_KEY = process.env.SKILLMP_API_KEY || 'sk_live_skillsmp_-N5eZkkHAHhGmM3EVjmRlLAEmHzseZCv5xBJ8lxh3rM'; // ⚠️ 生产环境请使用环境变量
const BASE_URL = 'https://skillsmp.com/api/v1';

console.log('='.repeat(70));
console.log('SkillMarket API 真实可用性测试');
console.log('='.repeat(70));

async function testAPI() {
  // ═══════════════════════════════════════════════════════════
  // 测试1: 基础连通性
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试1] 基础连通性测试');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/health`, {
      timeout: 10000,
    });
    console.log('✅ 基础连通性: 成功');
    console.log('   状态:', response.status);
    console.log('   响应:', response.data);
  } catch (error: any) {
    console.log('❌ 基础连通性: 失败');
    console.log('   错误:', error.message);
    console.log('   尝试备用端点...');
    
    // 尝试备用端点
    const fallbackUrls = [
      'https://skillsmp.com/api/v1',
      'https://www.skillsmp.com/api/v1',
    ];
    
    for (const url of fallbackUrls) {
      try {
        const response = await axios.get(`${url}/health`, {
          timeout: 10000,
        });
        console.log(`✅ 备用端点 ${url}: 成功`);
        break;
      } catch (e) {
        console.log(`❌ 备用端点 ${url}: 失败`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 测试2: 认证测试
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试2] API认证测试');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: { q: 'test', limit: 1 },
      timeout: 15000,
    });
    console.log('✅ API认证: 成功');
    console.log('   状态:', response.status);
  } catch (error: any) {
    console.log('❌ API认证: 失败');
    console.log('   状态:', error.response?.status);
    console.log('   错误:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('   ⚠️ API密钥可能无效或已过期');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 测试3: 搜索技能
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试3] 搜索技能功能');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: {
        q: 'image',
        limit: 5,
      },
      timeout: 15000,
    });
    
    console.log('✅ 搜索技能: 成功');
    console.log('   找到技能:', response.data.total || 0);
    
    if (response.data.skills && response.data.skills.length > 0) {
      console.log('   示例技能:');
      response.data.skills.slice(0, 3).forEach((skill: any, i: number) => {
        console.log(`     ${i + 1}. ${skill.name} (${skill.id})`);
      });
    }
  } catch (error: any) {
    console.log('❌ 搜索技能: 失败');
    console.log('   错误:', error.response?.data?.message || error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 测试4: 获取分类
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试4] 获取分类列表');
  console.log('-'.repeat(50));
  
  try {
    const response = await axios.get(`${BASE_URL}/categories`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: 15000,
    });
    
    console.log('✅ 获取分类: 成功');
    console.log('   分类数量:', response.data.categories?.length || 0);
    
    if (response.data.categories) {
      console.log('   分类列表:', response.data.categories.slice(0, 5).join(', '));
    }
  } catch (error: any) {
    console.log('❌ 获取分类: 失败');
    console.log('   错误:', error.response?.data?.message || error.message);
  }

  // ═══════════════════════════════════════════════════════════
  // 测试5: 获取技能详情
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试5] 获取技能详情');
  console.log('-'.repeat(50));
  
  // 先搜索一个技能ID
  let skillId = 'test-skill';
  try {
    const searchResponse = await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      params: { limit: 1 },
      timeout: 15000,
    });
    
    if (searchResponse.data.skills?.length > 0) {
      skillId = searchResponse.data.skills[0].id;
    }
  } catch (e) {
    // 忽略搜索错误
  }
  
  try {
    const response = await axios.get(`${BASE_URL}/skills/${skillId}`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
      },
      timeout: 15000,
    });
    
    console.log('✅ 获取详情: 成功');
    console.log('   技能名称:', response.data.skill?.name);
    console.log('   版本:', response.data.skill?.version);
  } catch (error: any) {
    console.log('❌ 获取详情: 失败');
    console.log('   状态:', error.response?.status);
    if (error.response?.status === 404) {
      console.log('   提示: 技能不存在（可能是正常的）');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 测试6: 错误处理
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n[测试6] 错误处理测试');
  console.log('-'.repeat(50));
  
  // 测试无效密钥
  try {
    await axios.get(`${BASE_URL}/skills/search`, {
      headers: {
        'Authorization': 'Bearer invalid_key',
      },
      timeout: 10000,
    });
    console.log('❌ 无效密钥测试: 应该失败但没有');
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.log('✅ 无效密钥处理: 正确返回401');
    } else {
      console.log('⚠️ 无效密钥处理: 返回', error.response?.status);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 总结
  // ═══════════════════════════════════════════════════════════
  
  console.log('\n' + '='.repeat(70));
  console.log('测试结果总结');
  console.log('='.repeat(70));
  console.log('\nAPI端点:', BASE_URL);
  console.log('API密钥:', API_KEY.slice(0, 20) + '...');
  console.log('\n如果以上测试有❌，需要：');
  console.log('  1. 确认API密钥有效');
  console.log('  2. 确认网络可以访问skillsmp.com');
  console.log('  3. 确认API服务正常运行');
  console.log('\n如果所有测试都是✅，则API可用，可以继续集成。');
}

// 运行测试
testAPI().catch(console.error);

export { testAPI };
