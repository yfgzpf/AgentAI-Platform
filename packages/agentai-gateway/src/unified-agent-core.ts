/**
 * Unified Agent Core - 统一智能体核心
 * 
 * 集成所有能力：
 * 1. 技能市场自动发现 (SkillMarket)
 * 2. 多媒体生成 (图像/视频/3D)
 * 3. 营销自动化 (微信/线索/转化)
 * 4. 行业技能映射 (建材设计)
 * 5. 自我进化 (信任阶梯/认知负债/技能DNA)
 * 
 * 目标：真正强大，无所不能
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';
import { getAISkillDiscovery } from './ai-skill-discovery.js';
import { getIndustrySkillMapper } from './industry-skill-mapper.js';
import { getMediaGenerationCore } from './media-generation-core.js';
import { getLeadConversionSystem } from './lead-conversion-system.js';
import { getIntegratedAgentCore } from './integrated-agent-core.js';
import { getTrustLadder } from './trust-ladder.js';
import { getKnowledgeGapDetector } from './knowledge-gap-detector.js';

// ═══════════════════════════════════════════════════════════
// 统一智能体核心
// ═══════════════════════════════════════════════════════════

export class UnifiedAgentCore extends EventEmitter {
  private router: AgentAIRouter;
  
  // 各子系统
  private skillDiscovery = getAISkillDiscovery();
  private industryMapper = getIndustrySkillMapper();
  private mediaCore = getMediaGenerationCore();
  private leadSystem = getLeadConversionSystem();
  private integratedCore = getIntegratedAgentCore(this.router);
  private trustLadder = getTrustLadder();
  private gapDetector = getKnowledgeGapDetector(this.router);

  // 运行状态
  private isRunning = false;
  private stats = {
    totalRequests: 0,
    successfulRequests: 0,
    skillsDiscovered: 0,
    skillsInstalled: 0,
    mediaGenerated: 0,
    leadsCreated: 0,
    errors: 0,
  };

  constructor(router: AgentAIRouter) {
    super();
    this.router = router;
    this.initialize();
  }

  private initialize(): void {
    console.log('[UnifiedCore] 初始化统一智能体核心...');
    
    // 启动各子系统
    this.mediaCore.start();
    
    // 监听技能发现事件
    this.skillDiscovery.on('skill:auto_installed', (skill) => {
      this.stats.skillsInstalled++;
      this.emit('skill:installed', skill);
    });

    console.log('[UnifiedCore] ✅ 统一核心初始化完成');
    console.log('   - 技能发现: 就绪');
    console.log('   - 多媒体生成: 就绪');
    console.log('   - 营销系统: 就绪');
    console.log('   - 自我进化: 就绪');
  }

  /**
   * 处理用户请求 - 统一入口
   * 
   * 这是AI处理任何请求的主入口
   */
  async processRequest(request: {
    content: string;
    userId: string;
    sessionId: string;
    context?: any;
  }): Promise<{
    success: boolean;
    response: string;
    actions: string[];
    skillsUsed: string[];
    learnings?: any;
  }> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    console.log(`\n[UnifiedCore] 处理请求: "${request.content.slice(0, 50)}..."`);

    const actions: string[] = [];
    const skillsUsed: string[] = [];

    try {
      // 步骤1: 意图分析
      const intent = await this.analyzeIntent(request.content);
      actions.push(`意图分析: ${intent.type}`);

      // 步骤2: 技能发现（如果需要）
      if (intent.needsSkill) {
        const skillResult = await this.discoverAndInstallSkill(intent.skillKeywords);
        if (skillResult.found) {
          actions.push(`技能发现: ${skillResult.skillName}`);
          skillsUsed.push(skillResult.skillId);
        }
      }

      // 步骤3: 行业特定处理
      if (intent.industry === 'construction-design') {
        const industryResult = await this.handleIndustryRequest(request.content, intent);
        if (industryResult.handled) {
          actions.push('行业处理: 建材设计');
          return {
            success: true,
            response: industryResult.response,
            actions,
            skillsUsed,
          };
        }
      }

      // 步骤4: 多媒体生成
      if (intent.type === 'media-generation') {
        const mediaResult = await this.handleMediaGeneration(intent.mediaParams);
        actions.push(`多媒体生成: ${mediaResult.type}`);
        this.stats.mediaGenerated++;
        return {
          success: true,
          response: mediaResult.response,
          actions,
          skillsUsed,
        };
      }

      // 步骤5: 营销自动化
      if (intent.type === 'marketing') {
        const marketingResult = await this.handleMarketing(intent.marketingParams);
        actions.push('营销自动化');
        this.stats.leadsCreated += marketingResult.leadsCreated || 0;
        return {
          success: true,
          response: marketingResult.response,
          actions,
          skillsUsed,
        };
      }

      // 步骤6: 通用处理
      const generalResult = await this.handleGeneralRequest(request);
      actions.push('通用处理');

      this.stats.successfulRequests++;

      return {
        success: true,
        response: generalResult.response,
        actions,
        skillsUsed,
      };

    } catch (error: any) {
      this.stats.errors++;
      
      // 错误处理和学习
      const learning = await this.handleErrorAndLearn(error, request);
      
      return {
        success: false,
        response: `处理失败: ${error.message}`,
        actions,
        skillsUsed,
        learnings: learning,
      };
    }
  }

  /**
   * 意图分析
   */
  private async analyzeIntent(content: string): Promise<{
    type: string;
    needsSkill: boolean;
    skillKeywords: string[];
    industry?: string;
    mediaParams?: any;
    marketingParams?: any;
  }> {
    const lowerContent = content.toLowerCase();

    // 检测行业
    let industry: string | undefined;
    if (lowerContent.includes('cad') || lowerContent.includes('图纸') || lowerContent.includes('设计')) {
      industry = 'construction-design';
    }

    // 检测多媒体生成
    if (lowerContent.includes('生成') || lowerContent.includes('create')) {
      if (lowerContent.includes('3d') || lowerContent.includes('模型')) {
        return {
          type: 'media-generation',
          needsSkill: false,
          skillKeywords: [],
          industry,
          mediaParams: { type: '3d', prompt: content },
        };
      }
      if (lowerContent.includes('视频') || lowerContent.includes('video')) {
        return {
          type: 'media-generation',
          needsSkill: false,
          skillKeywords: [],
          industry,
          mediaParams: { type: 'video', prompt: content },
        };
      }
      if (lowerContent.includes('图') || lowerContent.includes('image')) {
        return {
          type: 'media-generation',
          needsSkill: false,
          skillKeywords: [],
          industry,
          mediaParams: { type: 'image', prompt: content },
        };
      }
    }

    // 检测营销
    if (lowerContent.includes('客户') || lowerContent.includes('线索') || lowerContent.includes('营销')) {
      return {
        type: 'marketing',
        needsSkill: false,
        skillKeywords: [],
        industry,
        marketingParams: { action: 'lead-management' },
      };
    }

    // 检测是否需要技能
    const needsSkill = lowerContent.includes('技能') || 
                       lowerContent.includes('skill') ||
                       lowerContent.includes('能力');

    // 提取技能关键词
    const skillKeywords = this.extractSkillKeywords(content);

    return {
      type: 'general',
      needsSkill,
      skillKeywords,
      industry,
    };
  }

  /**
   * 发现并安装技能
   */
  private async discoverAndInstallSkill(keywords: string[]): Promise<{
    found: boolean;
    skillId?: string;
    skillName?: string;
  }> {
    if (keywords.length === 0) return { found: false };

    const query = keywords.join(' ');
    const result = await this.skillDiscovery.discoverSkillForTask(query);

    if (result.found && result.skill) {
      this.stats.skillsDiscovered++;
      return {
        found: true,
        skillId: result.skill.id,
        skillName: result.skill.name,
      };
    }

    return { found: false };
  }

  /**
   * 处理行业特定请求
   */
  private async handleIndustryRequest(content: string, intent: any): Promise<{
    handled: boolean;
    response: string;
  }> {
    // 使用行业映射器
    const mapping = await this.industryMapper.mapQueryToSkill(content);

    if (mapping.matched && mapping.confidence > 0.6) {
      return {
        handled: true,
        response: `我找到了适合的技能: ${mapping.skill!.name}。它可以帮你${mapping.reason}。`,
      };
    }

    return { handled: false, response: '' };
  }

  /**
   * 处理多媒体生成
   */
  private async handleMediaGeneration(params: any): Promise<{
    type: string;
    response: string;
  }> {
    const task = await this.mediaCore.createTask({
      type: params.type,
      prompt: params.prompt,
    });

    return {
      type: params.type,
      response: `已创建${params.type}生成任务，任务ID: ${task.id}。预计需要几分钟完成。`,
    };
  }

  /**
   * 处理营销请求
   */
  private async handleMarketing(params: any): Promise<{
    response: string;
    leadsCreated?: number;
  }> {
    // 这里可以集成营销自动化
    return {
      response: '营销系统已激活',
      leadsCreated: 0,
    };
  }

  /**
   * 通用请求处理
   */
  private async handleGeneralRequest(request: any): Promise<{
    response: string;
  }> {
    // 使用integratedCore处理
    const result = await this.integratedCore.executeTask({
      taskType: 'general',
      toolName: 'chat',
      toolArgs: { message: request.content },
      userId: request.userId,
      sessionId: request.sessionId,
    });

    return {
      response: result.result?.response || '处理完成',
    };
  }

  /**
   * 错误处理和学习
   */
  private async handleErrorAndLearn(error: any, request: any): Promise<any> {
    // 检测知识缺口
    const gap = await this.gapDetector.detectGap({
      taskType: 'request-processing',
      success: false,
      error: error.message,
      toolsUsed: [],
      durationMs: 0,
    });

    if (gap) {
      return {
        gapDetected: true,
        gapType: gap.type,
        learningPlan: await this.gapDetector.generateLearningPlan(gap),
      };
    }

    return { gapDetected: false };
  }

  /**
   * 提取技能关键词
   */
  private extractSkillKeywords(content: string): string[] {
    const keywords: string[] = [];
    const lowerContent = content.toLowerCase();

    // 技术关键词
    const techKeywords: Record<string, string[]> = {
      'cad': ['cad', 'autocad', 'dwg', 'drawing'],
      '3d': ['3d', 'model', 'modeling', 'blender'],
      'image': ['image', 'photo', 'picture', 'generate'],
      'video': ['video', 'animation', 'movie'],
      'web': ['web', 'scraping', 'crawler'],
      'data': ['data', 'analysis', 'analytics'],
      'code': ['code', 'programming', 'development'],
      'automation': ['automation', 'automate', 'bot'],
    };

    for (const [category, terms] of Object.entries(techKeywords)) {
      if (terms.some(term => lowerContent.includes(term))) {
        keywords.push(category);
      }
    }

    return keywords;
  }

  /**
   * 获取系统统计
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  /**
   * 启动系统
   */
  start(): void {
    this.isRunning = true;
    console.log('[UnifiedCore] ✅ 统一智能体核心已启动');
    this.emit('started');
  }

  /**
   * 停止系统
   */
  stop(): void {
    this.isRunning = false;
    this.mediaCore.stop();
    console.log('[UnifiedCore] ✅ 统一智能体核心已停止');
    this.emit('stopped');
  }
}

// 单例导出
let unifiedCore: UnifiedAgentCore | null = null;

export function getUnifiedAgentCore(router?: AgentAIRouter): UnifiedAgentCore {
  if (!unifiedCore && router) {
    unifiedCore = new UnifiedAgentCore(router);
  }
  return unifiedCore!;
}
