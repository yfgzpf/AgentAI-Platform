/**
 * AI Autonomous Marketing - AI自主营销系统
 * 
 * 核心设计：用户只需一句话，LLM自动理解意图，自主完成所有营销操作
 * 
 * 示例：
 * 用户说："帮我发一条朋友圈，推广装修服务"
 * AI自动：
 * 1. 理解意图（朋友圈营销）
 * 2. 生成内容（AI写文案+选图）
 * 3. 登录微信（自动扫码）
 * 4. 发布朋友圈（自动操作）
 * 5. 报告结果（完成截图）
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';
import { getWeChatAutomationAdapter } from './wechat-automation-adapter.js';

// ═══════════════════════════════════════════════════════════
// AI自主营销系统
// ═══════════════════════════════════════════════════════════

export class AIAutonomousMarketing extends EventEmitter {
  private llmRouter: AgentAIRouter;
  private wechatAdapter = getWeChatAutomationAdapter({ dataPath: './wechat-data' });
  private isRunning = false;

  constructor(llmRouter: AgentAIRouter) {
    super();
    this.llmRouter = llmRouter;
  }

  /**
   * 核心入口：用户一句话，AI自主执行
   */
  async execute(userCommand: string): Promise<{
    success: boolean;
    action: string;
    result: string;
    details: any;
  }> {
    console.log(`\n🎯 用户指令: "${userCommand}"`);
    console.log('='.repeat(60));

    // 步骤1: LLM理解意图
    const intent = await this.understandIntent(userCommand);
    console.log(`\n[步骤1] AI理解意图: ${intent.action}`);
    console.log(`   置信度: ${intent.confidence}`);
    console.log(`   参数: ${JSON.stringify(intent.params)}`);

    // 步骤2: 根据意图执行相应操作
    switch (intent.action) {
      case 'post_moments':
        return this.autonomousPostMoments(intent.params);
      
      case 'send_mass_message':
        return this.autonomousSendMassMessage(intent.params);
      
      case 'add_friend':
        return this.autonomousAddFriend(intent.params);
      
      case 'reply_messages':
        return this.autonomousReplyMessages(intent.params);
      
      case 'marketing_campaign':
        return this.autonomousMarketingCampaign(intent.params);
      
      default:
        return {
          success: false,
          action: 'unknown',
          result: '无法理解该指令',
          details: { intent },
        };
    }
  }

  /**
   * LLM理解用户意图（增强版，包含关键词匹配）
   */
  private async understandIntent(command: string): Promise<{
    action: string;
    confidence: number;
    params: any;
  }> {
    // 先进行关键词匹配（更可靠）
    const lowerCmd = command.toLowerCase();
    
    // 朋友圈相关
    if (lowerCmd.includes('朋友圈') || lowerCmd.includes('发圈') || lowerCmd.includes('动态')) {
      return {
        action: 'post_moments',
        confidence: 0.95,
        params: { 
          content_type: 'auto', 
          topic: command.replace(/朋友圈|发圈|发一条|帮我/g, '').trim() 
        },
      };
    }
    
    // 群发相关
    if (lowerCmd.includes('群发') || lowerCmd.includes(' broadcast') || (lowerCmd.includes('发') && lowerCmd.includes('所有'))) {
      return {
        action: 'send_mass_message',
        confidence: 0.95,
        params: { 
          topic: command.replace(/群发|给所有|发/g, '').trim() 
        },
      };
    }
    
    // 添加好友
    if (lowerCmd.includes('添加') && (lowerCmd.includes('好友') || lowerCmd.includes('微信') || lowerCmd.includes('手机'))) {
      const phones = command.match(/\d{11}/g) || ['13800138001'];
      return {
        action: 'add_friend',
        confidence: 0.95,
        params: { phones },
      };
    }
    
    // 自动回复
    if (lowerCmd.includes('自动回复') || lowerCmd.includes('回复消息') || lowerCmd.includes('托管')) {
      return {
        action: 'reply_messages',
        confidence: 0.95,
        params: { 
          role: command.includes('装修') ? '装修顾问' : '客服' 
        },
      };
    }
    
    // 营销活动
    if (lowerCmd.includes('活动') || lowerCmd.includes('推广') || lowerCmd.includes('营销') || lowerCmd.includes('campaign')) {
      return {
        action: 'marketing_campaign',
        confidence: 0.95,
        params: { 
          topic: command.replace(/执行|活动|推广|营销/g, '').trim() 
        },
      };
    }

    // 如果关键词匹配失败，尝试LLM理解
    const prompt = `分析用户指令，提取营销意图：

用户指令: "${command}"

可选动作:
1. post_moments - 发布朋友圈
2. send_mass_message - 群发消息
3. add_friend - 添加好友
4. reply_messages - 自动回复消息
5. marketing_campaign - 执行营销活动

请输出JSON格式:
{
  "action": "动作名称",
  "confidence": 0.95,
  "params": {"topic": "主题"}
}`;

    try {
      const response = await this.llmRouter.chat({
        model: 'deepseek',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 200,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // 提取JSON
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.action && parsed.action !== 'unknown') {
            return parsed;
          }
        } catch (e) {
          // JSON解析失败，继续用默认
        }
      }

      return { action: 'unknown', confidence: 0, params: {} };
    } catch (error) {
      console.error('意图理解失败:', error);
      return { action: 'unknown', confidence: 0, params: {} };
    }
  }

  /**
   * 自主发布朋友圈
   */
  private async autonomousPostMoments(params: any): Promise<any> {
    console.log('\n[步骤2] AI自主生成朋友圈内容...');

    // AI生成内容
    const content = await this.generateMomentsContent(params);
    console.log(`   生成文案: ${content.text.slice(0, 50)}...`);
    console.log(`   建议图片: ${content.images?.length || 0}张`);

    // 确认是否发布
    console.log('\n[步骤3] 准备发布到微信朋友圈...');
    
    // 启动微信自动化
    console.log('   启动微信自动化服务...');
    const started = await this.wechatAdapter.start();
    if (!started) {
      return {
        success: false,
        action: 'post_moments',
        result: '微信自动化启动失败',
        details: { content },
      };
    }

    // 执行发布
    console.log('   正在发布朋友圈...');
    const posted = await this.wechatAdapter.postToMoments(
      content.text,
      content.images
    );

    if (posted) {
      console.log('   ✅ 朋友圈发布成功！');
      this.emit('moments:posted', content);
    } else {
      console.log('   ❌ 朋友圈发布失败');
    }

    return {
      success: posted,
      action: 'post_moments',
      result: posted ? '朋友圈发布成功' : '发布失败',
      details: { content, posted },
    };
  }

  /**
   * AI生成朋友圈内容
   */
  private async generateMomentsContent(params: any): Promise<{
    text: string;
    images?: string[];
  }> {
    const prompt = `为${params.topic || '装修服务'}生成一条朋友圈文案：

要求：
1. 生活化、不硬广
2. 有吸引力，能引起互动
3. 适当使用emoji
4. 100字以内
5. 包含行动号召

输出JSON格式：
{
  "text": "朋友圈文案",
  "suggested_images": ["图片描述1", "图片描述2"]
}`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          text: parsed.text,
          images: parsed.suggested_images,
        };
      }

      // 默认内容
      return {
        text: `🏠 装修小分享\n\n最近帮一位业主完成了120平米的现代简约风装修，从设计到施工全程跟进，业主超级满意！\n\n💡 如果你也在考虑装修，欢迎随时找我聊聊，免费量房+设计方案~\n\n#装修 #现代简约 #家装设计`,
        images: ['装修完工图'],
      };
    } catch (error) {
      return {
        text: '装修服务推广',
        images: [],
      };
    }
  }

  /**
   * 自主群发消息
   */
  private async autonomousSendMassMessage(params: any): Promise<any> {
    console.log('\n[步骤2] AI生成群发消息...');

    const message = await this.generateMassMessage(params);
    console.log(`   生成消息: ${message.slice(0, 50)}...`);

    // 获取好友列表（模拟）
    const targetFriends = ['客户A', '客户B', '客户C', '潜在客户1', '潜在客户2'];
    console.log(`   目标好友: ${targetFriends.length}人`);

    // 启动微信
    await this.wechatAdapter.start();

    // 逐个发送
    console.log('\n[步骤3] 开始群发...');
    const results = [];
    for (const friend of targetFriends) {
      const result = await this.wechatAdapter.sendMessage(friend, message);
      results.push({ friend, success: result.success });
      console.log(`   ${friend}: ${result.success ? '✅' : '❌'}`);
      
      // 间隔3秒，避免频繁
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const successCount = results.filter(r => r.success).length;
    
    return {
      success: successCount > 0,
      action: 'send_mass_message',
      result: `群发完成: ${successCount}/${targetFriends.length}人成功`,
      details: { message, results },
    };
  }

  /**
   * 生成群发消息
   */
  private async generateMassMessage(params: any): Promise<string> {
    const prompt = `生成一条微信群发消息，主题：${params.topic || '装修优惠'}

要求：
1. 亲切自然，不像广告
2. 突出价值/优惠
3. 引导回复或咨询
4. 50字以内

直接输出消息内容：`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      return content.trim();
    } catch (error) {
      return '您好！最近有装修优惠活动，欢迎咨询了解详情~';
    }
  }

  /**
   * 自主添加好友
   */
  private async autonomousAddFriend(params: any): Promise<any> {
    console.log('\n[步骤2] 准备添加微信好友...');

    const phoneNumbers = params.phones || ['13800138001', '13900139002'];
    const greeting = params.greeting || '您好，我是装修顾问，想为您提供专业服务';

    console.log(`   目标手机号: ${phoneNumbers.length}个`);
    console.log(`   验证消息: ${greeting}`);

    // 启动微信
    await this.wechatAdapter.start();

    // 逐个添加
    console.log('\n[步骤3] 开始添加好友...');
    const results = [];
    for (const phone of phoneNumbers) {
      const result = await this.wechatAdapter.sendFriendRequest(phone, greeting);
      results.push({ phone, success: result.success });
      console.log(`   ${phone}: ${result.success ? '✅ 已发送申请' : '❌ 发送失败'}`);
      
      // 间隔5秒
      await new Promise(resolve => setTimeout(resolve, 5000));
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: successCount > 0,
      action: 'add_friend',
      result: `好友申请发送: ${successCount}/${phoneNumbers.length}人`,
      details: { greeting, results },
    };
  }

  /**
   * 自主回复消息
   */
  private async autonomousReplyMessages(params: any): Promise<any> {
    console.log('\n[步骤2] 启动自动回复模式...');

    // 启动微信
    await this.wechatAdapter.start();

    // 配置自动回复
    await this.wechatAdapter.configureAutoReply({
      enabled: true,
      welcomeMessage: '您好！我是AI助手，正在为您服务...',
      replyDelay: 2000,
    });

    console.log('   ✅ 自动回复已启用');
    console.log('   AI将自动回复 incoming 消息');

    // 监听消息并AI回复
    this.wechatAdapter.on('message', async (msg) => {
      console.log(`\n[收到消息] ${msg.from}: ${msg.content}`);

      // AI生成回复
      const reply = await this.generateReply(msg.content, msg.from);
      console.log(`[AI回复] ${reply.slice(0, 50)}...`);

      // 发送回复
      await this.wechatAdapter.sendMessage(msg.from, reply);
    });

    return {
      success: true,
      action: 'reply_messages',
      result: '自动回复模式已启动',
      details: { mode: 'auto_reply' },
    };
  }

  /**
   * AI生成回复
   */
  private async generateReply(message: string, from: string): Promise<string> {
    const prompt = `用户消息: "${message}"

你是专业的装修顾问，请给出友好、专业的回复。回复要简洁（50字以内），并引导下一步行动。

直接输出回复内容：`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      return content.trim();
    } catch (error) {
      return '感谢您的咨询！我会尽快为您详细解答，也可以电话沟通更方便：138-xxxx-xxxx';
    }
  }

  /**
   * 自主执行营销活动
   */
  private async autonomousMarketingCampaign(params: any): Promise<any> {
    console.log('\n[步骤2] AI规划营销活动...');

    // AI生成营销方案
    const campaign = await this.planCampaign(params);
    console.log(`   活动名称: ${campaign.name}`);
    console.log(`   执行步骤: ${campaign.steps.length}步`);

    // 逐步执行
    console.log('\n[步骤3] 开始执行营销活动...');
    const results = [];

    for (let i = 0; i < campaign.steps.length; i++) {
      const step = campaign.steps[i];
      console.log(`\n   步骤${i + 1}: ${step.name}`);
      
      const result = await this.executeCampaignStep(step);
      results.push({ step: step.name, success: result.success });
      
      console.log(`   结果: ${result.success ? '✅ 成功' : '❌ 失败'}`);
      
      // 步骤间间隔
      if (i < campaign.steps.length - 1) {
        console.log('   等待10秒...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    const successCount = results.filter(r => r.success).length;

    return {
      success: successCount === campaign.steps.length,
      action: 'marketing_campaign',
      result: `营销活动执行: ${successCount}/${campaign.steps.length}步成功`,
      details: { campaign, results },
    };
  }

  /**
   * AI规划营销活动
   */
  private async planCampaign(params: any): Promise<{
    name: string;
    steps: Array<{ name: string; action: string; params: any }>;
  }> {
    const prompt = `规划一个微信营销活动，主题：${params.topic || '装修推广'}

要求：
1. 包含朋友圈发布
2. 包含群发消息
3. 包含添加潜在客户
4. 步骤要具体可执行

输出JSON格式：
{
  "name": "活动名称",
  "steps": [
    {"name": "步骤名称", "action": "post_moments", "params": {}},
    {"name": "步骤名称", "action": "send_mass_message", "params": {}}
  ]
}`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      // 使用默认方案
    }

    // 默认营销活动
    return {
      name: '装修服务推广活动',
      steps: [
        { name: '发布朋友圈案例', action: 'post_moments', params: { topic: '装修案例分享' } },
        { name: '群发优惠活动', action: 'send_mass_message', params: { topic: '限时优惠' } },
        { name: '添加潜在客户', action: 'add_friend', params: { phones: ['13800138001'] } },
      ],
    };
  }

  /**
   * 执行营销活动步骤
   */
  private async executeCampaignStep(step: any): Promise<{ success: boolean }> {
    switch (step.action) {
      case 'post_moments':
        const result1 = await this.autonomousPostMoments(step.params);
        return { success: result1.success };
      
      case 'send_mass_message':
        const result2 = await this.autonomousSendMassMessage(step.params);
        return { success: result2.success };
      
      case 'add_friend':
        const result3 = await this.autonomousAddFriend(step.params);
        return { success: result3.success };
      
      default:
        return { success: false };
    }
  }

  /**
   * 停止所有自动化
   */
  async stop(): Promise<void> {
    console.log('\n🛑 停止AI自主营销系统...');
    await this.wechatAdapter.stop();
    this.isRunning = false;
    console.log('✅ 已停止');
  }
}

// 单例导出
let autonomousMarketing: AIAutonomousMarketing | null = null;

export function getAIAutonomousMarketing(llmRouter: AgentAIRouter): AIAutonomousMarketing {
  if (!autonomousMarketing) {
    autonomousMarketing = new AIAutonomousMarketing(llmRouter);
  }
  return autonomousMarketing;
}
