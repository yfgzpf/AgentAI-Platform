/**
 * 寻找能返回技能的关键词
 */

import axios from 'axios';

const API_KEY = 'sk_live_skillsmp_pdfxyKqllhCy51DrF6Gi81yho8L3Y_lLwceKzqofcak';
const BASE_URL = 'https://skillsmp.com/api/v1';

console.log('寻找能返回技能的关键词...\n');

async function findWorkingKeywords() {
  const keywords = [
    'a', 'b', 'c', 'd', 'e',
    'python', 'javascript', 'java', 'go', 'rust',
    'react', 'vue', 'angular', 'svelte',
    'node', 'django', 'flask', 'spring',
    'aws', 'azure', 'gcp', 'cloud',
    'docker', 'kubernetes', 'terraform',
    'sql', 'nosql', 'mongodb', 'postgres',
    'git', 'github', 'gitlab',
    'testing', 'jest', 'cypress',
    'security', 'auth', 'oauth',
    'mobile', 'ios', 'android', 'flutter',
    'web', 'frontend', 'backend', 'fullstack',
    'api', 'rest', 'graphql',
    'ai', 'ml', 'data', 'analytics',
    'blockchain', 'crypto', 'web3',
    'devops', 'ci', 'cd', 'pipeline',
  ];

  for (const keyword of keywords) {
    try {
      const response = await axios.get(`${BASE_URL}/skills/search`, {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
        params: { q: keyword, limit: 5 },
        timeout: 10000,
      });

      const skills = response.data.data?.skills || [];
      
      if (skills.length > 0) {
        console.log(`✅ "${keyword}": ${skills.length} 个技能`);
        console.log('   示例:', skills[0].name);
        
        // 打印完整技能结构
        console.log('\n完整技能数据:');
        console.log(JSON.stringify(skills[0], null, 2));
        return; // 找到一个就停止
      }
    } catch (error: any) {
      if (error.response?.data?.error?.message?.includes('Too many requests')) {
        console.log('⏳ 速率限制，等待60秒...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
    
    // 延迟避免速率限制
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n没有找到返回技能的关键词');
}

findWorkingKeywords().catch(console.error);
