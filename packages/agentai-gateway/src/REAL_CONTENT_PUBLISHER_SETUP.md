# 真实内容发布系统配置指南

## 概述

这是一个**真实可运行**的内容发布系统，支持：
- ✅ 微信公众号API真实接入
- ✅ 小红书浏览器自动化发布
- ✅ SQLite数据库存储
- ✅ 真实定时任务调度
- ✅ 完整的错误处理和重试机制

## 快速开始

### 1. 安装依赖

```bash
cd packages/agentai-gateway
npm install better-sqlite3 node-cron playwright axios
```

### 2. 配置微信公众号

#### 2.1 获取公众号凭证

1. 登录[微信公众平台](https://mp.weixin.qq.com/)
2. 进入"开发" -> "基本配置"
3. 获取 **AppID** 和 **AppSecret**
4. 添加IP白名单（你的服务器IP）

#### 2.2 代码配置

```typescript
import { getRealContentPublisher } from './real-content-publisher.js';

const publisher = getRealContentPublisher();

// 配置公众号
publisher.configureAccount('wechat', {
  appId: 'wx1234567890abcdef',      // 你的AppID
  appSecret: 'your-app-secret-here', // 你的AppSecret
});
```

### 3. 配置小红书

#### 3.1 账号要求

- 需要小红书账号和密码
- 账号需要实名认证
- 建议使用专用发布账号

#### 3.2 首次登录

```typescript
publisher.configureAccount('xiaohongshu', {
  username: 'your-username',
  password: 'your-password',
});

// 首次运行会打开浏览器，需要手动扫码登录
// 登录成功后cookie会自动保存，后续无需再次登录
```

### 4. 发布内容

```typescript
// 创建发布任务
const job = await publisher.createJob({
  contentId: 'article-001',
  platform: 'wechat', // 或 'xiaohongshu'
  title: '文章标题',
  content: '文章内容（支持Markdown）',
  mediaUrls: ['https://example.com/image.jpg'], // 封面图
  scheduledAt: Date.now() + 3600000, // 可选：定时发布（1小时后）
});

console.log('任务ID:', job.id);
```

### 5. 监听发布状态

```typescript
publisher.on('job:published', (data) => {
  console.log('发布成功！');
  console.log('链接:', data.result.url);
});

publisher.on('job:failed', (data) => {
  console.error('发布失败:', data.error);
});
```

## 数据库结构

系统自动创建SQLite数据库，位于：
```
.agentai/content-publisher.db
```

### 数据表

**publish_jobs** - 发布任务表
- `id` - 任务ID
- `content_id` - 内容ID
- `platform` - 平台（wechat/xiaohongshu/douyin/zhihu）
- `status` - 状态（pending/processing/published/failed/cancelled）
- `title` - 标题
- `content` - 内容
- `media_urls` - 媒体文件URL（JSON数组）
- `scheduled_at` - 计划发布时间
- `published_at` - 实际发布时间
- `platform_post_id` - 平台文章ID
- `platform_url` - 平台文章链接
- `error_message` - 错误信息
- `retry_count` - 重试次数

**platform_accounts** - 平台账号表
- `id` - 账号ID
- `platform` - 平台
- `account_name` - 账号名称
- `credentials` - 凭证（加密存储）
- `is_active` - 是否激活

**publish_logs** - 操作日志表
- `id` - 日志ID
- `job_id` - 任务ID
- `action` - 操作
- `details` - 详情
- `timestamp` - 时间戳

## API说明

### RealContentPublisher

#### configureAccount(platform, credentials)
配置平台账号

**参数：**
- `platform`: 'wechat' | 'xiaohongshu' | 'douyin' | 'zhihu'
- `credentials`: 平台凭证对象

#### createJob(job)
创建发布任务

**参数：**
```typescript
{
  contentId: string;        // 内容唯一标识
  platform: string;         // 平台
  title: string;           // 标题
  content: string;         // 内容（支持Markdown）
  mediaUrls?: string[];    // 媒体文件URL
  scheduledAt?: number;    // 定时发布（时间戳）
}
```

**返回：**
```typescript
{
  id: string;              // 任务ID
  status: string;          // 状态
  // ... 其他字段
}
```

#### getStats()
获取发布统计

**返回：**
```typescript
{
  total: number;           // 总任务数
  published: number;       // 已发布
  pending: number;         // 待发布
  failed: number;          // 失败
  byPlatform: Record<string, number>; // 各平台统计
}
```

### 事件

- `job:created` - 任务创建
- `job:published` - 发布成功
- `job:failed` - 发布失败
- `account:configured` - 账号配置

## 定时发布

系统使用 `node-cron` 每分钟检查一次待发布的任务。

创建定时任务：
```typescript
const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

await publisher.createJob({
  contentId: 'scheduled-001',
  platform: 'wechat',
  title: '明天发布的文章',
  content: '...',
  scheduledAt: tomorrow, // 明天这个时候发布
});
```

## 错误处理和重试

系统会自动重试失败的发布任务：
- 最多重试3次
- 每次重试间隔5分钟
- 重试次数达到上限后标记为失败

## 安全注意事项

1. **凭证安全**
   - 不要将真实凭证提交到Git
   - 使用环境变量存储敏感信息
   - 数据库中的凭证已加密

2. **频率限制**
   - 微信公众号：每篇文章需要审核
   - 小红书：建议每天不超过5篇
   - 避免触发平台反爬虫机制

3. **IP白名单**
   - 微信公众号需要配置IP白名单
   - 建议使用固定IP的服务器

## 故障排查

### 微信公众号发布失败

1. 检查AppID和AppSecret是否正确
2. 检查IP白名单是否配置
3. 检查公众号是否有发布权限
4. 查看数据库中的error_message字段

### 小红书登录失败

1. 检查账号密码是否正确
2. 首次登录需要手动扫码
3. 检查是否触发验证码
4. 查看浏览器窗口是否有异常提示

### 定时任务不执行

1. 检查系统时间是否正确
2. 检查scheduled_at是否设置正确
3. 查看数据库中status是否为'pending'
4. 检查node-cron是否正常运行

## 扩展开发

### 添加新平台

1. 创建平台发布器类：
```typescript
class NewPlatformPublisher {
  async publishArticle(title: string, content: string, mediaUrls?: string[]) {
    // 实现发布逻辑
    return { postId: 'xxx', url: 'https://...' };
  }
}
```

2. 在RealContentPublisher中注册：
```typescript
if (platform === 'newplatform') {
  this.publishers.set(platform, new NewPlatformPublisher(credentials, this.db));
}
```

## 示例代码

完整示例见：`real-content-publisher.example.ts`

运行示例：
```bash
npx tsx src/real-content-publisher.example.ts
```

## 技术支持

如有问题，请检查：
1. 数据库文件是否正确创建
2. 平台API凭证是否有效
3. 网络连接是否正常
4. 查看控制台错误信息
