/**
 * 企业级桌面自动化 - 7x24小时无人值守运行示例
 * 
 * 特点：
 * - 多账号轮换，永不中断
 * - 智能行为模拟，完全规避检测
 * - 自动故障恢复，无需人工干预
 * - 完整监控告警，实时掌握状态
 */

import { getEnterpriseAutomationCore } from './enterprise-automation-core.js';

console.log('='.repeat(70));
console.log('企业级桌面自动化系统 - 7x24小时无人值守');
console.log('='.repeat(70));

// 企业级配置
const config = {
  // 账号池：多个微信账号轮换使用
  accounts: [
    {
      id: 'wx-001',
      platform: 'wechat' as const,
      username: 'wx_account_1',
      password: 'password1',
      status: 'active' as const,
      dailyQuota: 50,        // 每日50次操作
      usedToday: 0,
      lastUsedAt: 0,
    },
    {
      id: 'wx-002',
      platform: 'wechat' as const,
      username: 'wx_account_2',
      password: 'password2',
      status: 'active' as const,
      dailyQuota: 50,
      usedToday: 0,
      lastUsedAt: 0,
    },
    {
      id: 'wx-003',
      platform: 'wechat' as const,
      username: 'wx_account_3',
      password: 'password3',
      status: 'active' as const,
      dailyQuota: 50,
      usedToday: 0,
      lastUsedAt: 0,
    },
  ],
  
  // 行为模拟配置：完全模拟真人
  behavior: {
    minActionInterval: 5000,      // 最短5秒
    maxActionInterval: 15000,     // 最长15秒
    minTypingSpeed: 100,          // 打字速度100ms/字
    maxTypingSpeed: 300,          // 打字速度300ms/字
    randomOffset: 10,             // 鼠标偏移10像素
    workHoursStart: 9,            // 9点开始工作
    workHoursEnd: 21,             // 21点结束工作
    lunchBreakStart: 12,          // 12点午休
    lunchBreakEnd: 14,            // 14点结束午休
  },
  
  // 任务队列配置
  queue: {
    maxRetries: 3,                // 最多重试3次
    retryInterval: 300000,        // 5分钟后重试
    priorityLevels: 10,           // 10级优先级
    autoScale: true,              // 自动扩缩容
  },
  
  // 监控告警配置
  monitoring: {
    healthCheckInterval: 60000,   // 每分钟健康检查
    alertThreshold: 10,           // 失败10次告警
    autoRestart: true,            // 自动重启
    screenshotOnError: true,      // 错误时截图
  },
};

async function main() {
  // 初始化企业级核心
  const core = getEnterpriseAutomationCore(config);

  // 监听事件
  core.on('started', () => {
    console.log('\n✅ 企业级自动化引擎已启动');
    console.log('   工作模式: 7x24小时无人值守');
    console.log('   账号数量:', config.accounts.length);
    console.log('   工作时段:', `${config.behavior.workHoursStart}:00-${config.behavior.workHoursEnd}:00`);
  });

  core.on('task:added', (task) => {
    console.log(`\n[任务添加] ${task.id}, 类型: ${task.type}`);
  });

  core.on('task:completed', ({ taskId, result }) => {
    console.log(`\n[任务完成] ${taskId}`);
    console.log('   结果:', JSON.stringify(result, null, 2));
  });

  core.on('task:failed', ({ taskId, error }) => {
    console.log(`\n[任务失败] ${taskId}, 错误: ${error}`);
  });

  core.on('alert', ({ type, message, stats }) => {
    console.log(`\n🚨 [告警] ${type}: ${message}`);
    console.log('   统计:', stats);
  });

  // 启动引擎
  await core.start();

  // ═══════════════════════════════════════════════════════════
  // 模拟批量任务
  // ═══════════════════════════════════════════════════════════

  console.log('\n' + '='.repeat(70));
  console.log('批量添加营销任务');
  console.log('='.repeat(70));

  // 任务1: 朋友圈营销（高优先级）
  for (let i = 0; i < 5; i++) {
    core.addTask('wechat_post_moments', {
      content: `装修案例分享 ${i + 1} - 120平米现代简约风，业主超满意！`,
      images: [`case_${i + 1}.jpg`],
    }, 9); // 高优先级
  }
  console.log('✅ 已添加5个朋友圈发布任务');

  // 任务2: 添加潜在客户（中优先级）
  const phoneNumbers = [
    '13800138001', '13800138002', '13800138003',
    '13800138004', '13800138005', '13800138006',
    '13800138007', '13800138008', '13800138009', '13800138010',
  ];
  
  for (const phone of phoneNumbers) {
    core.addTask('wechat_add_friend', {
      phone,
      greeting: '您好，我是专业装修顾问，看到您有装修需求，想为您提供免费咨询服务',
    }, 7);
  }
  console.log(`✅ 已添加${phoneNumbers.length}个好友申请任务`);

  // 任务3: 群发消息（低优先级，晚上执行）
  core.addTask('wechat_mass_message', {
    message: '您好！本周有装修优惠活动，全场设计费8折，欢迎咨询了解详情~',
    targetGroups: ['客户群A', '客户群B'],
  }, 5);
  console.log('✅ 已添加群发消息任务');

  // ═══════════════════════════════════════════════════════════
  // 监控运行状态
  // ═══════════════════════════════════════════════════════════

  console.log('\n' + '='.repeat(70));
  console.log('实时监控');
  console.log('='.repeat(70));

  // 每10秒打印一次统计
  const monitorInterval = setInterval(() => {
    const stats = core.getStats();
    console.log(`\n[${new Date().toLocaleTimeString()}] 运行状态:`);
    console.log(`   队列任务: ${stats.queueSize}`);
    console.log(`   活跃账号: ${stats.activeAccounts}/${config.accounts.length}`);
    console.log(`   今日任务: ${stats.todayTasks} (成功: ${stats.todaySuccess}, 失败: ${stats.todayFailed})`);
    console.log(`   成功率: ${stats.todayTasks > 0 ? ((stats.todaySuccess / stats.todayTasks) * 100).toFixed(1) : 0}%`);
  }, 10000);

  // ═══════════════════════════════════════════════════════════
  // 运行一段时间后停止（实际生产环境一直运行）
  // ═══════════════════════════════════════════════════════════

  console.log('\n系统将持续运行60秒演示...');
  
  await new Promise(resolve => setTimeout(resolve, 60000));

  // 停止监控
  clearInterval(monitorInterval);

  // 打印最终统计
  console.log('\n' + '='.repeat(70));
  console.log('最终统计');
  console.log('='.repeat(70));
  
  const finalStats = core.getStats();
  console.log('今日总任务:', finalStats.todayTasks);
  console.log('成功:', finalStats.todaySuccess);
  console.log('失败:', finalStats.todayFailed);
  console.log('成功率:', `${((finalStats.todaySuccess / finalStats.todayTasks) * 100).toFixed(1)}%`);

  // 停止引擎
  await core.stop();

  console.log('\n' + '='.repeat(70));
  console.log('✅ 演示完成');
  console.log('='.repeat(70));
}

// 运行
main().catch(console.error);

export { main };
