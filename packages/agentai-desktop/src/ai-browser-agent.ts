/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Browser Agent - AI视觉驱动浏览器自动化
 * 
 * 核心能力：
 * 1. AI看屏幕截图，理解界面状态
 * 2. AI决策下一步操作
 * 3. 执行操作（点击、输入、滚动等）
 * 4. 循环直到完成任务
 * 5. 自动记录到医案系统
 * 
 * 优势：
 * - 不依赖DOM选择器，像人一样看界面
 * - 自适应页面变化
 * - 操作节奏自然，不易被检测
 */

import { chromium, Browser, Page } from 'playwright';
import OpenAI from 'openai';
import { writeFileSync } from 'fs';

interface AIAction {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'press' | 'screenshot';
  target?: string;
  coordinates?: { x: number; y: number };
  value?: string;
  reason: string;
}

interface AIDecision {
  thought: string;
  action: AIAction;
  expectedOutcome: string;
  isComplete: boolean;
  result?: any;
}

interface Lead {
  id: string;
  username: string;
  comment: string;
  videoTitle: string;
  platform: string;
  intentScore: number;
  timestamp: string;
  screenshot?: string;
}

export class AIBrowserAgent {
  private openai: OpenAI;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private taskLog: string[] = [];
  private leads: Lead[] = [];

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    });
  }

  /**
   * 初始化浏览器
   */
  async init(headless = false) {
    this.browser = await chromium.launch({
      headless,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    this.page = await this.browser.newPage({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // 隐藏自动化特征
    await this.page.evaluate(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    this.log('浏览器初始化完成');
  }

  /**
   * 执行获客任务
   */
  async executeLeadGenerationTask(config: {
    platform: 'douyin' | 'xiaohongshu';
    keyword: string;
    location?: string;
    maxLeads: number;
  }): Promise<Lead[]> {
    this.log(`开始获客任务: ${config.platform} - ${config.keyword}`);
    this.leads = [];

    try {
      // 1. 打开平台
      await this.navigateToPlatform(config.platform);

      // 2. 搜索关键词
      await this.searchKeyword(config.keyword);

      // 3. 筛选高互动视频
      const videos = await this.findHighEngagementVideos(5);

      // 4. 逐个视频采集
      for (const video of videos) {
        if (this.leads.length >= config.maxLeads) break;

        await this.processVideo(video, config);

        // 随机延迟，模拟真人
        await this.randomDelay(3, 8);
      }

      this.log(`任务完成，采集到 ${this.leads.length} 条线索`);
      return this.leads;

    } catch (error: any) {
      this.log(`任务失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * AI核心循环：观察 → 思考 → 行动
   */
  private async aiLoop(
    taskDescription: string,
    maxSteps = 30
  ): Promise<boolean> {
    for (let step = 0; step < maxSteps; step++) {
      // 1. 观察：截图
      const screenshot = await this.takeScreenshot();

      // 2. 思考：AI决策
      const decision = await this.getAIDecision(screenshot, taskDescription);
      this.log(`[Step ${step + 1}] ${decision.thought}`);

      // 3. 检查是否完成
      if (decision.isComplete) {
        return true;
      }

      // 4. 行动：执行操作
      await this.executeAction(decision.action);

      // 5. 等待页面响应
      await this.randomDelay(1, 3);
    }

    return false;
  }

  /**
   * 获取AI决策
   */
  private async getAIDecision(
    screenshot: string,
    task: string
  ): Promise<AIDecision> {
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini', // 使用视觉模型
      messages: [
        {
          role: 'system',
          content: `你是浏览器自动化助手。你的任务是通过观察网页截图，理解当前状态，并决定下一步操作。

规则：
1. 像人一样思考，理解界面元素的位置和含义
2. 操作要自然，有明确的目标
3. 如果任务完成，设置 isComplete = true
4. 坐标要精确，基于 1280x800 分辨率

可用操作类型：
- click: 点击指定坐标
- type: 在指定位置输入文本
- scroll: 滚动页面
- press: 按键（如 Enter, Escape）
- wait: 等待加载
- screenshot: 截图（用于验证）`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `当前任务: ${task}

请分析当前截图，决定下一步操作。以JSON格式返回：
{
  "thought": "你的思考过程",
  "action": {
    "type": "click|type|scroll|wait|press",
    "coordinates": {"x": 100, "y": 200},
    "value": "输入的值（如有）",
    "reason": "为什么做这个操作"
  },
  "expectedOutcome": "预期结果",
  "isComplete": false,
  "result": null
}`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${screenshot}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as AIDecision;
  }

  /**
   * 执行AI操作
   */
  private async executeAction(action: AIAction) {
    if (!this.page) throw new Error('Page not initialized');

    switch (action.type) {
      case 'click':
        if (action.coordinates) {
          await this.page.mouse.click(action.coordinates.x, action.coordinates.y);
          this.log(`点击坐标 (${action.coordinates.x}, ${action.coordinates.y})`);
        }
        break;

      case 'type':
        if (action.coordinates && action.value) {
          await this.page.mouse.click(action.coordinates.x, action.coordinates.y);
          await this.page.keyboard.type(action.value, { delay: 100 });
          this.log(`输入: ${action.value}`);
        }
        break;

      case 'scroll':
        await this.page.mouse.wheel(0, 500);
        this.log('向下滚动');
        break;

      case 'press':
        if (action.value) {
          await this.page.keyboard.press(action.value);
          this.log(`按键: ${action.value}`);
        }
        break;

      case 'wait':
        await this.page.waitForTimeout(2000);
        this.log('等待2秒');
        break;
    }
  }

  /**
   * 导航到平台
   */
  private async navigateToPlatform(platform: string) {
    const urls: Record<string, string> = {
      douyin: 'https://www.douyin.com',
      xiaohongshu: 'https://www.xiaohongshu.com',
    };

    await this.page!.goto(urls[platform], { waitUntil: 'networkidle' });
    this.log(`打开 ${platform}`);

    // 等待AI确认页面加载完成
    await this.aiLoop('等待页面完全加载，如果有登录框或弹窗需要处理');
  }

  /**
   * 搜索关键词
   */
  private async searchKeyword(keyword: string) {
    this.log(`搜索关键词: ${keyword}`);

    await this.aiLoop(`
      任务：在搜索框输入"${keyword}"并搜索
      步骤：
      1. 找到搜索框（通常在页面顶部）
      2. 点击搜索框
      3. 输入关键词"${keyword}"
      4. 按Enter或点击搜索按钮
    `);
  }

  /**
   * 找到高互动视频
   */
  private async findHighEngagementVideos(count: number): Promise<any[]> {
    this.log('寻找高互动视频');

    // 滚动加载更多视频
    for (let i = 0; i < 3; i++) {
      await this.page!.mouse.wheel(0, 800);
      await this.randomDelay(1, 2);
    }

    // 提取视频信息（通过AI分析截图）
    const screenshot = await this.takeScreenshot();
    const analysis = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '分析当前页面，找出所有视频的标题和互动数据（点赞、评论数）。返回JSON数组：{"videos": [{"title": "标题", "engagement": "互动数据", "position": {"x": 100, "y": 200}}]}',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshot}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(analysis.choices[0]?.message?.content || '{}');
    return result.videos?.slice(0, count) || [];
  }

  /**
   * 处理单个视频
   */
  private async processVideo(video: any, config: any) {
    this.log(`处理视频: ${video.title}`);

    // 点击进入视频
    await this.page!.mouse.click(video.position.x, video.position.y);
    await this.randomDelay(2, 4);

    // 滚动到评论区
    await this.aiLoop('滚动到评论区，找到用户评论');

    // 采集评论
    const comments = await this.extractComments();

    // 筛选高意向评论
    for (const comment of comments) {
      const intentScore = this.calculateIntentScore(comment.text);
      if (intentScore >= 7) {
        this.leads.push({
          id: `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          username: comment.username,
          comment: comment.text,
          videoTitle: video.title,
          platform: config.platform,
          intentScore,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  /**
   * 提取评论
   */
  private async extractComments(): Promise<any[]> {
    const screenshot = await this.takeScreenshot();

    const analysis = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '提取当前页面的所有用户评论。返回JSON：{"comments": [{"username": "用户名", "text": "评论内容"}]}',
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${screenshot}` },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(analysis.choices[0]?.message?.content || '{}');
    return result.comments || [];
  }

  /**
   * 计算意向分数
   */
  private calculateIntentScore(comment: string): number {
    const highIntentKeywords = ['求推荐', '哪家好', '多少钱', '联系', '想做', '准备装修'];
    const mediumIntentKeywords = ['不错', '参考', '看看', '了解一下'];

    let score = 5;

    for (const kw of highIntentKeywords) {
      if (comment.includes(kw)) score += 2;
    }

    for (const kw of mediumIntentKeywords) {
      if (comment.includes(kw)) score += 1;
    }

    return Math.min(score, 10);
  }

  /**
   * 截图
   */
  private async takeScreenshot(): Promise<string> {
    if (!this.page) throw new Error('Page not initialized');
    const buffer = await this.page.screenshot({ encoding: 'base64' });
    return buffer as string;
  }

  /**
   * 随机延迟
   */
  private async randomDelay(min: number, max: number) {
    const delay = Math.floor(Math.random() * (max - min + 1) + min) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 记录日志
   */
  private log(message: string) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    this.taskLog.push(logEntry);
    console.log(logEntry);
  }

  /**
   * 保存结果
   */
  async saveResults(outputPath: string) {
    const result = {
      timestamp: new Date().toISOString(),
      leads: this.leads,
      logs: this.taskLog,
    };

    writeFileSync(outputPath, JSON.stringify(result, null, 2));
    this.log(`结果已保存: ${outputPath}`);
  }

  /**
   * 关闭浏览器
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.log('浏览器已关闭');
    }
  }
}

// 导出单例
export const aiBrowserAgent = new AIBrowserAgent();
