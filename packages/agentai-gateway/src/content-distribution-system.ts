/**
 * ContentDistributionSystem - 内容自动化分发系统
 * 
 * 功能：
 * 1. 一键分发到多个自媒体平台
 * 2. 自动适配各平台格式
 * 3. 定时发布调度
 * 4. 数据回收与分析
 */

import { EventEmitter } from 'events';
import { ContentPiece, ChannelType, ContentPerformance } from './marketing-acquisition-engine.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface DistributionJob {
  id: string;
  contentId: string;
  channel: ChannelType;
  status: 'pending' | 'processing' | 'published' | 'failed';
  scheduledAt?: number;
  publishedAt?: number;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}

export interface PlatformAdapter {
  name: ChannelType;
  publish: (content: ContentPiece, credentials: PlatformCredentials) => Promise<{
    postId: string;
    url: string;
  }>;
  getPerformance: (postId: string, credentials: PlatformCredentials) => Promise<ContentPerformance>;
}

export interface PlatformCredentials {
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  accountId?: string;
}

export interface DistributionSchedule {
  contentId: string;
  distributions: Array<{
    channel: ChannelType;
    scheduledAt: number;
    credentials: PlatformCredentials;
  }>;
}

export interface ContentAdaptation {
  originalContent: ContentPiece;
  adaptedContent: Record<ChannelType, ContentPiece>;
}

// ═══════════════════════════════════════════════════════════
// 平台适配器
// ═══════════════════════════════════════════════════════════

class WeChatAdapter implements PlatformAdapter {
  name: ChannelType = 'wechat';

  async publish(content: ContentPiece, credentials: PlatformCredentials): Promise<{ postId: string; url: string }> {
    // 模拟微信公众号发布
    console.log(`[WeChat] Publishing: ${content.title}`);
    return {
      postId: `wx-${Date.now()}`,
      url: `https://mp.weixin.qq.com/s/${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  async getPerformance(postId: string, credentials: PlatformCredentials): Promise<ContentPerformance> {
    return {
      views: Math.floor(Math.random() * 10000),
      likes: Math.floor(Math.random() * 500),
      comments: Math.floor(Math.random() * 100),
      shares: Math.floor(Math.random() * 200),
      saves: 0,
      clicks: Math.floor(Math.random() * 300),
      leads: Math.floor(Math.random() * 20),
      engagementRate: Math.random() * 0.1,
    };
  }
}

class XiaohongshuAdapter implements PlatformAdapter {
  name: ChannelType = 'xiaohongshu';

  async publish(content: ContentPiece, credentials: PlatformCredentials): Promise<{ postId: string; url: string }> {
    // 模拟小红书发布
    console.log(`[Xiaohongshu] Publishing: ${content.title}`);
    return {
      postId: `xhs-${Date.now()}`,
      url: `https://www.xiaohongshu.com/discovery/item/${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  async getPerformance(postId: string, credentials: PlatformCredentials): Promise<ContentPerformance> {
    return {
      views: Math.floor(Math.random() * 50000),
      likes: Math.floor(Math.random() * 2000),
      comments: Math.floor(Math.random() * 300),
      shares: Math.floor(Math.random() * 500),
      saves: Math.floor(Math.random() * 1000),
      clicks: Math.floor(Math.random() * 200),
      leads: Math.floor(Math.random() * 30),
      engagementRate: Math.random() * 0.15,
    };
  }
}

class DouyinAdapter implements PlatformAdapter {
  name: ChannelType = 'douyin';

  async publish(content: ContentPiece, credentials: PlatformCredentials): Promise<{ postId: string; url: string }> {
    console.log(`[Douyin] Publishing: ${content.title}`);
    return {
      postId: `dy-${Date.now()}`,
      url: `https://www.douyin.com/video/${Math.random().toString(36).slice(2, 10)}`,
    };
  }

  async getPerformance(postId: string, credentials: PlatformCredentials): Promise<ContentPerformance> {
    return {
      views: Math.floor(Math.random() * 100000),
      likes: Math.floor(Math.random() * 5000),
      comments: Math.floor(Math.random() * 500),
      shares: Math.floor(Math.random() * 1000),
      saves: Math.floor(Math.random() * 500),
      clicks: Math.floor(Math.random() * 100),
      leads: Math.floor(Math.random() * 50),
      engagementRate: Math.random() * 0.2,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 内容分发系统
// ═══════════════════════════════════════════════════════════

export class ContentDistributionSystem extends EventEmitter {
  private jobs: Map<string, DistributionJob> = new Map();
  private adapters: Map<ChannelType, PlatformAdapter> = new Map();
  private scheduleQueue: DistributionSchedule[] = [];

  constructor() {
    super();
    this.initializeAdapters();
    this.startScheduler();
  }

  private initializeAdapters(): void {
    this.adapters.set('wechat', new WeChatAdapter());
    this.adapters.set('xiaohongshu', new XiaohongshuAdapter());
    this.adapters.set('douyin', new DouyinAdapter());
  }

  /**
   * 启动定时调度器
   */
  private startScheduler(): void {
    setInterval(() => {
      this.processScheduledJobs();
    }, 60000); // 每分钟检查一次
  }

  /**
   * 适配内容到不同平台
   */
  adaptContent(content: ContentPiece): ContentAdaptation {
    const adaptedContent: Record<ChannelType, ContentPiece> = {} as any;

    // 微信适配 - 长文，专业
    adaptedContent.wechat = {
      ...content,
      content: this.adaptForWeChat(content.content),
    };

    // 小红书适配 - 短笔记，emoji
    adaptedContent.xiaohongshu = {
      ...content,
      content: this.adaptForXiaohongshu(content.content),
      title: content.title.slice(0, 20), // 小红书标题短
    };

    // 抖音适配 - 视频脚本
    adaptedContent.douyin = {
      ...content,
      content: this.adaptForDouyin(content.content),
      type: 'short',
    };

    return {
      originalContent: content,
      adaptedContent,
    };
  }

  private adaptForWeChat(content: string): string {
    // 添加公众号格式
    return `<article>\n<h1>${content.slice(0, 50)}</h1>\n<p>${content}</p>\n</article>`;
  }

  private adaptForXiaohongshu(content: string): string {
    // 添加emoji，分段
    return content
      .split('\n')
      .map(line => `✨ ${line}`)
      .join('\n\n') + '\n\n#小红书 #分享';
  }

  private adaptForDouyin(content: string): string {
    // 转换为视频脚本格式
    return `[视频脚本]\n开场钩子: ${content.slice(0, 30)}...\n正文: ${content.slice(0, 100)}\n结尾CTA: 点赞关注，了解更多！`;
  }

  /**
   * 分发内容到单个平台
   */
  async distribute(
    content: ContentPiece,
    channel: ChannelType,
    credentials: PlatformCredentials,
    scheduledAt?: number
  ): Promise<DistributionJob> {
    const job: DistributionJob = {
      id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      contentId: content.id,
      channel,
      status: scheduledAt ? 'pending' : 'processing',
      scheduledAt,
    };

    this.jobs.set(job.id, job);

    if (!scheduledAt || scheduledAt <= Date.now()) {
      // 立即发布
      await this.executePublish(job, content, credentials);
    } else {
      // 加入调度队列
      this.scheduleQueue.push({
        contentId: content.id,
        distributions: [{ channel, scheduledAt, credentials }],
      });
    }

    return job;
  }

  /**
   * 批量分发到多个平台
   */
  async distributeToMultiple(
    content: ContentPiece,
    targets: Array<{ channel: ChannelType; credentials: PlatformCredentials; scheduledAt?: number }>
  ): Promise<DistributionJob[]> {
    const adapted = this.adaptContent(content);
    const jobs: DistributionJob[] = [];

    for (const target of targets) {
      const adaptedContent = adapted.adaptedContent[target.channel];
      const job = await this.distribute(
        adaptedContent,
        target.channel,
        target.credentials,
        target.scheduledAt
      );
      jobs.push(job);
    }

    this.emit('content:distributed', { contentId: content.id, jobs });

    return jobs;
  }

  /**
   * 执行发布
   */
  private async executePublish(
    job: DistributionJob,
    content: ContentPiece,
    credentials: PlatformCredentials
  ): Promise<void> {
    const adapter = this.adapters.get(job.channel);
    if (!adapter) {
      job.status = 'failed';
      job.error = `不支持的平台: ${job.channel}`;
      return;
    }

    try {
      job.status = 'processing';
      const result = await adapter.publish(content, credentials);
      
      job.status = 'published';
      job.publishedAt = Date.now();
      job.platformPostId = result.postId;
      job.platformUrl = result.url;

      this.emit('job:published', job);
    } catch (error: any) {
      job.status = 'failed';
      job.error = error.message;
      this.emit('job:failed', job);
    }
  }

  /**
   * 处理定时任务
   */
  private async processScheduledJobs(): Promise<void> {
    const now = Date.now();
    const dueSchedules = this.scheduleQueue.filter(
      s => s.distributions.some(d => d.scheduledAt && d.scheduledAt <= now)
    );

    for (const schedule of dueSchedules) {
      for (const dist of schedule.distributions) {
        if (dist.scheduledAt && dist.scheduledAt <= now) {
          // 找到对应的job并执行
          const job = Array.from(this.jobs.values()).find(
            j => j.contentId === schedule.contentId && j.channel === dist.channel
          );
          if (job && job.status === 'pending') {
            // 这里需要重新获取content，简化处理
            job.status = 'processing';
          }
        }
      }
    }

    // 清理已执行的调度
    this.scheduleQueue = this.scheduleQueue.filter(
      s => s.distributions.some(d => d.scheduledAt && d.scheduledAt > now)
    );
  }

  /**
   * 获取内容表现数据
   */
  async fetchPerformance(jobId: string, credentials: PlatformCredentials): Promise<ContentPerformance | null> {
    const job = this.jobs.get(jobId);
    if (!job || !job.platformPostId) {
      return null;
    }

    const adapter = this.adapters.get(job.channel);
    if (!adapter) {
      return null;
    }

    try {
      const performance = await adapter.getPerformance(job.platformPostId, credentials);
      this.emit('performance:updated', { jobId, performance });
      return performance;
    } catch (error) {
      console.error('[Distribution] 获取表现数据失败:', error);
      return null;
    }
  }

  /**
   * 获取分发报告
   */
  getDistributionReport(contentId: string): {
    totalJobs: number;
    published: number;
    failed: number;
    pending: number;
    totalReach: number;
    totalEngagement: number;
  } {
    const jobs = Array.from(this.jobs.values()).filter(j => j.contentId === contentId);

    return {
      totalJobs: jobs.length,
      published: jobs.filter(j => j.status === 'published').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      pending: jobs.filter(j => j.status === 'pending').length,
      totalReach: jobs.length * 1000, // 模拟数据
      totalEngagement: jobs.length * 100, // 模拟数据
    };
  }

  /**
   * 取消定时发布
   */
  cancelScheduledJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending') {
      return false;
    }

    // 从调度队列中移除
    this.scheduleQueue = this.scheduleQueue.filter(
      s => s.contentId !== job.contentId
    );

    job.status = 'failed';
    job.error = '已取消';

    return true;
  }
}

// 单例导出
let distributionSystem: ContentDistributionSystem | null = null;

export function getContentDistributionSystem(): ContentDistributionSystem {
  if (!distributionSystem) {
    distributionSystem = new ContentDistributionSystem();
  }
  return distributionSystem;
}
