/**
 * RealContentPublisher 使用示例
 * 
 * 真实可运行的代码示例
 */

import { getRealContentPublisher } from './real-content-publisher.js';

// ═══════════════════════════════════════════════════════════
// 示例1: 配置微信公众号并发布文章
// ═══════════════════════════════════════════════════════════

async function exampleWeChatPublish() {
  const publisher = getRealContentPublisher();

  // 1. 配置微信公众号（需要真实的appId和appSecret）
  publisher.configureAccount('wechat', {
    appId: 'wx1234567890abcdef', // 替换为你的公众号appId
    appSecret: 'your-app-secret-here', // 替换为你的公众号appSecret
  });

  // 2. 创建发布任务
  const job = await publisher.createJob({
    contentId: 'article-001',
    platform: 'wechat',
    title: '装修避坑指南：10个省钱技巧',
    content: `
# 装修避坑指南

## 1. 提前规划预算
装修前一定要做好预算规划...

## 2. 选择靠谱装修公司
查看公司资质和案例...

## 3. 材料采购技巧
批量采购可以节省20%成本...
    `,
    mediaUrls: ['https://example.com/cover-image.jpg'],
    // scheduledAt: Date.now() + 3600000, // 1小时后发布（可选）
  });

  console.log('发布任务已创建:', job.id);
  console.log('状态:', job.status);

  // 3. 等待发布完成（实际使用时可以通过事件监听）
  publisher.on('job:published', (data) => {
    console.log('发布成功！');
    console.log('文章链接:', data.result.url);
  });

  publisher.on('job:failed', (data) => {
    console.error('发布失败:', data.error);
  });
}

// ═══════════════════════════════════════════════════════════
// 示例2: 配置小红书并发布笔记
// ═══════════════════════════════════════════════════════════

async function exampleXiaohongshuPublish() {
  const publisher = getRealContentPublisher();

  // 1. 配置小红书账号
  publisher.configureAccount('xiaohongshu', {
    username: 'your-xiaohongshu-username',
    password: 'your-password',
  });

  // 2. 创建发布任务
  const job = await publisher.createJob({
    contentId: 'note-001',
    platform: 'xiaohongshu',
    title: '装修小白必看！',
    content: `
✨ 姐妹们，装修真的太容易踩坑了！

🏠 今天分享3个省钱技巧：
1️⃣ 提前规划预算，避免超支
2️⃣ 多对比几家装修公司
3️⃣ 材料自己采购更划算

💰 我这样做省了2万块！

#装修 #省钱 #装修避坑
    `,
    mediaUrls: [
      'https://example.com/image1.jpg',
      'https://example.com/image2.jpg',
      'https://example.com/image3.jpg',
    ],
  });

  console.log('小红书笔记发布任务:', job.id);
}

// ═══════════════════════════════════════════════════════════
// 示例3: 定时发布（批量创建任务）
// ═══════════════════════════════════════════════════════════

async function exampleScheduledPublish() {
  const publisher = getRealContentPublisher();

  // 配置账号
  publisher.configureAccount('wechat', {
    appId: 'your-app-id',
    appSecret: 'your-app-secret',
  });

  // 创建一周的内容发布计划
  const articles = [
    { title: '周一：装修预算规划', content: '...' },
    { title: '周二：材料选择技巧', content: '...' },
    { title: '周三：装修公司对比', content: '...' },
  ];

  for (let i = 0; i < articles.length; i++) {
    const scheduledTime = Date.now() + (i + 1) * 24 * 60 * 60 * 1000; // 每天一篇

    await publisher.createJob({
      contentId: `scheduled-${i}`,
      platform: 'wechat',
      title: articles[i].title,
      content: articles[i].content,
      scheduledAt: scheduledTime,
    });

    console.log(`已安排 ${articles[i].title} 在 ${new Date(scheduledTime).toLocaleString()} 发布`);
  }
}

// ═══════════════════════════════════════════════════════════
// 示例4: 查看发布统计
// ═══════════════════════════════════════════════════════════

async function exampleGetStats() {
  const publisher = getRealContentPublisher();

  const stats = publisher.getStats();

  console.log('发布统计:');
  console.log(`- 总任务: ${stats.total}`);
  console.log(`- 已发布: ${stats.published}`);
  console.log(`- 待发布: ${stats.pending}`);
  console.log(`- 失败: ${stats.failed}`);
  console.log('- 各平台发布数:', stats.byPlatform);
}

// ═══════════════════════════════════════════════════════════
// 示例5: 监听发布事件
// ═══════════════════════════════════════════════════════════

function setupEventListeners() {
  const publisher = getRealContentPublisher();

  publisher.on('job:created', (job) => {
    console.log(`[事件] 任务创建: ${job.id}`);
  });

  publisher.on('job:published', (data) => {
    console.log(`[事件] 发布成功: ${data.jobId}`);
    console.log(`[事件] 文章链接: ${data.result.url}`);
    
    // 可以在这里发送通知给用户
    // sendNotification(userId, '文章发布成功', data.result.url);
  });

  publisher.on('job:failed', (data) => {
    console.error(`[事件] 发布失败: ${data.jobId}`);
    console.error(`[事件] 错误: ${data.error}`);
    
    // 可以在这里发送错误通知
    // sendAlert(adminId, '发布失败', data.error);
  });
}

// ═══════════════════════════════════════════════════════════
// 运行示例
// ═══════════════════════════════════════════════════════════

// 注意：运行前需要配置真实的API凭证
// exampleWeChatPublish().catch(console.error);
// exampleXiaohongshuPublish().catch(console.error);
// exampleScheduledPublish().catch(console.error);
// exampleGetStats();
// setupEventListeners();

export {
  exampleWeChatPublish,
  exampleXiaohongshuPublish,
  exampleScheduledPublish,
  exampleGetStats,
  setupEventListeners,
};
