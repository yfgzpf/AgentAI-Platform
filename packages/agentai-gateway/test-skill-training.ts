/**
 * SkillOpt 训练流程测试脚本
 */

import { SkillTrainer } from './skill-training.js';

async function testTraining() {
  console.log('=== 开始测试 SkillOpt 训练流程 ===');

  // 创建训练器
  const trainer = new SkillTrainer({
    learningRateBudget: 100,
    validationGateThreshold: 0.05,
    maxEpochs: 3,
    validationTasks: 3,
  });

  // 定义测试技能内容
  const skillContent = `
# Web Development Skill

## 功能描述
帮助用户进行Web开发，包括创建React组件、修复bug、优化性能等。

## 使用场景
- 创建新的React组件
- 修复前端bug
- 优化代码性能
- 实现新功能

## 最佳实践
1. 先理解用户需求
2. 分析现有代码结构
3. 设计解决方案
4. 实现功能
5. 测试验证
`;

  // 定义验证任务
  const validationTasks = [
    '创建一个简单的React按钮组件',
    '修复一个按钮点击事件bug',
    '优化组件渲染性能',
  ];

  // 执行训练
  console.log('\n开始训练...');
  const result = await trainer.trainSkill('web-dev', skillContent, validationTasks);

  // 输出结果
  console.log('\n=== 训练结果 ===');
  console.log(`技能ID: ${result.skillId}`);
  console.log(`训练前分数: ${result.beforeScore.toFixed(2)}`);
  console.log(`训练后分数: ${result.afterScore.toFixed(2)}`);
  console.log(`分数提升: ${result.improvement.toFixed(2)}`);
  console.log(`验证门控: ${result.passedGate ? '✅ 通过' : '❌ 失败'}`);
  console.log(`原因: ${result.reason}`);

  // 输出拒绝缓冲区
  console.log('\n=== 拒绝编辑缓冲区 ===');
  const rejectBuffer = trainer.getRejectBuffer();
  console.log(`拒绝编辑数量: ${rejectBuffer.length}`);
  if (rejectBuffer.length > 0) {
    console.log('拒绝编辑详情:');
    rejectBuffer.forEach((edit, index) => {
      console.log(`${index + 1}. ${edit.edit.type} - ${edit.edit.reason}`);
      console.log(`   拒绝原因: ${edit.reason}`);
    });
  }

  console.log('\n=== 测试完成 ===');
}

testTraining().catch(console.error);