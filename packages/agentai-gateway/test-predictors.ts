/**
 * 用户行为预判和数据预判测试脚本
 */

import { UserBehaviorPredictor } from './user-behavior-predictor.js';
import { DataPredictor } from './data-predictor.js';

async function testPredictors() {
  console.log('=== 开始测试用户行为预判和数据预判 ===');

  // 创建用户行为预判器（安全配置）
  const behaviorPredictor = new UserBehaviorPredictor({
    enabled: true,
    analyzeSensitiveData: false, // 不分析敏感数据
    sendToExternalServer: false, // 不发送到外部服务器
  });

  // 创建数据预判器（安全配置）
  const dataPredictor = new DataPredictor({
    enabled: true,
    predictSensitiveData: false, // 不预判敏感数据
    sendToExternalServer: false, // 不发送到外部服务器
    enableRateLimitProtection: true, // 启用速率限制保护
  });

  console.log('\n=== 测试用户行为预判 ===');

  // 模拟历史会话
  const session1 = {
    sessionId: 'session-1',
    userActions: ['创建React组件', '测试组件', '部署组件'],
    context: '前端开发',
    timestamp: new Date().toISOString(),
    extractedPatterns: [],
  };

  const session2 = {
    sessionId: 'session-2',
    userActions: ['查询用户列表', '分析用户数据', '生成报告'],
    context: '数据分析',
    timestamp: new Date().toISOString(),
    extractedPatterns: [],
  };

  // 分析历史会话
  console.log('\n分析历史会话...');
  const patterns1 = behaviorPredictor.analyzeSession(session1);
  const patterns2 = behaviorPredictor.analyzeSession(session2);

  console.log(`提取的行为模式数量: ${patterns1.length + patterns2.length}`);

  // 预测用户下一步行动
  console.log('\n预测用户下一步行动...');
  const prediction1 = behaviorPredictor.predictNextActions('前端开发');
  console.log(`预测结果: ${prediction1.predictedActions.join(', ')}`);
  console.log(`置信度: ${prediction1.confidence.toFixed(2)}`);
  console.log(`推理: ${prediction1.reasoning}`);
  console.log(`准备资源: ${prediction1.preparedResources.join(', ')}`);
  console.log(`安全检查: ${prediction1.safetyCheck ? '✅ 通过' : '❌ 失败'}`);

  // 测试安全保护：过滤敏感数据
  console.log('\n测试安全保护：过滤敏感数据...');
  const sensitiveSession = {
    sessionId: 'sensitive-session',
    userActions: ['查询用户密钥', '读取API密码', '获取token'],
    context: '敏感数据',
    timestamp: new Date().toISOString(),
    extractedPatterns: [],
  };

  const sensitivePatterns = behaviorPredictor.analyzeSession(sensitiveSession);
  console.log(`敏感数据会话提取的模式数量: ${sensitivePatterns.length} (应该为0，因为被过滤)`);
  console.log(`安全配置: analyzeSensitiveData=${behaviorPredictor.getSafetyConfig().analyzeSensitiveData}`);

  console.log('\n=== 测试数据预判 ===');

  // 分析数据请求模式
  console.log('\n分析数据请求模式...');
  const requestPattern1 = dataPredictor.analyzeRequestPattern('查询用户列表', 'user-api');
  const requestPattern2 = dataPredictor.analyzeRequestPattern('获取API数据', 'external-api');

  console.log(`提取的请求模式数量: ${(requestPattern1 ? 1 : 0) + (requestPattern2 ? 1 : 0)}`);

  // 预判用户需要的数据
  console.log('\n预判用户需要的数据...');
  const dataPrediction = dataPredictor.predictRequiredData('查询用户详细信息');
  console.log(`预判数据: ${dataPrediction.predictedData.join(', ')}`);
  console.log(`置信度: ${dataPrediction.confidence.toFixed(2)}`);
  console.log(`数据源: ${dataPrediction.dataSource}`);
  console.log(`缓存数据数量: ${dataPrediction.cachedData.size}`);
  console.log(`安全检查: ${dataPrediction.safetyCheck ? '✅ 通过' : '❌ 失败'}`);
  console.log(`速率限制检查: ${dataPrediction.rateLimitCheck ? '✅ 通过' : '❌ 失败'}`);

  // 测试安全保护：过滤敏感数据源
  console.log('\n测试安全保护：过滤敏感数据源...');
  const sensitivePattern = dataPredictor.analyzeRequestPattern('查询密钥', '密钥数据库');
  console.log(`敏感数据源提取的模式: ${sensitivePattern ? '存在' : '不存在'} (应该不存在，因为被过滤)`);
  console.log(`安全配置: predictSensitiveData=${dataPredictor.getSafetyConfig().predictSensitiveData}`);

  // 测试速率限制保护
  console.log('\n测试速率限制保护...');
  dataPredictor.addDataSourceConfig({
    sourceId: 'test-api',
    sourceType: 'api',
    endpoint: 'https://test-api.com',
    rateLimit: 5, // 每分钟最多5次请求
    safetyLevel: 'safe',
  });

  console.log(`数据源配置已添加: rateLimit=5`);

  // 模拟多次请求（测试速率限制）
  for (let i = 0; i < 10; i++) {
    const prediction = dataPredictor.predictRequiredData(`查询数据${i}`);
    console.log(`请求${i + 1}: 缓存数据数量=${prediction.cachedData.size}, rateLimitCheck=${prediction.rateLimitCheck}`);
  }

  console.log('\n=== 测试完成 ===');

  // 输出安全配置总结
  console.log('\n=== 安全配置总结 ===');
  console.log('用户行为预判安全配置:');
  console.log(JSON.stringify(behaviorPredictor.getSafetyConfig(), null, 2));
  console.log('\n数据预判安全配置:');
  console.log(JSON.stringify(dataPredictor.getSafetyConfig(), null, 2));

  // 测试禁用功能
  console.log('\n=== 测试禁用功能 ===');
  behaviorPredictor.disable();
  dataPredictor.disable();

  const disabledBehaviorPrediction = behaviorPredictor.predictNextActions('前端开发');
  const disabledDataPrediction = dataPredictor.predictRequiredData('查询数据');

  console.log(`禁用后用户行为预测: ${disabledBehaviorPrediction.predictedActions.length} (应该为0)`);
  console.log(`禁用后数据预判: ${disabledDataPrediction.predictedData.length} (应该为0)`);
}

testPredictors().catch(console.error);