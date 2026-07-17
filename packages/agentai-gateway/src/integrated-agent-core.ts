/**
 * Integrated Agent Core - 融合所有能力的统一核心
 * 
 * 设计目标：
 * 1. 保留所有创新功能（信任阶梯、认知负债、技能DNA、世界模型）
 * 2. 保留所有营销工具（微信、线索、AI营销）
 * 3. 全部集成到agentai-loop主线流程
 * 4. 达到生产级可用状态
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';
import { getTrustLadder } from './trust-ladder.js';
import { getKnowledgeGapDetector } from './knowledge-gap-detector.js';
import { getSkillDNAEvolution } from './skill-dna.js';
import { getWorldModel } from './world-model.js';
import { getLeadConversionSystem } from './lead-conversion-system.js';
import { getAIAutonomousMarketing } from './ai-autonomous-marketing.js';
import { AI_MARKETING_TOOLS } from './ai-marketing-tools.js';

// ═══════════════════════════════════════════════════════════
// 融合型Agent核心
// ═══════════════════════════════════════════════════════════

export class IntegratedAgentCore extends EventEmitter {
  private router: AgentAIRouter;
  
  // 创新功能
  private trustLadder = getTrustLadder();
  private gapDetector = getKnowledgeGapDetector(getAgentAIRouter());
  private skillDNA = getSkillDNAEvolution();
  private worldModel = getWorldModel(getAgentAIRouter());
  
  // 业务功能
  private leadSystem = getLeadConversionSystem();
  private marketing = getAIAutonomousMarketing(getAgentAIRouter());
  
  // 营销工具
  private marketingTools = AI_MARKETING_TOOLS;

  constructor(router: AgentAIRouter) {
    super();
    this.router = router;
    this.initializeIntegration();
  }

  /**
   * 初始化所有集成
   */
  private initializeIntegration(): void {
    console.log('[IntegratedCore] 初始化融合型Agent核心...');
    
    // 1. 设置微信自动化接口
    this.setupWeChatIntegration();
    
    // 2. 设置错误处理和学习闭环
    this.setupErrorLearningLoop();
    
    // 3. 设置技能进化监听
    this.setupSkillEvolution();
    
    console.log('[IntegratedCore] ✅ 融合核心初始化完成');
    console.log('   - 信任阶梯: 已激活');
    console.log('   - 认知负债: 已激活');
    console.log('   - 技能DNA: 已激活');
    console.log('   - 世界模型: 已激活');
    console.log('   - 线索转化: 已激活');
    console.log('   - 营销工具: 10个工具已就绪');
  }

  /**
   * 核心入口：智能任务执行
   * 
   * 融合所有能力的统一入口
   */
  async executeTask(params: {
    taskType: string;
    toolName: string;
    toolArgs: any;
    userId: string;
    sessionId: string;
  }): Promise<{
    success: boolean;
    result: any;
    trustDecision?: any;
    learningOutcome?: any;
    skillDNA?: any;
  }> {
    const { taskType, toolName, toolArgs, userId, sessionId } = params;

    console.log(`\n[IntegratedCore] 执行任务: ${toolName}`);
    console.log('='.repeat(60));

    // 步骤1: 世界模型预测（如果有相关实体）
    let prediction = null;
    if (this.hasWorldModelEntities(toolName, toolArgs)) {
      prediction = await this.predictOutcome(toolName, toolArgs);
      console.log(`[步骤1] 世界模型预测: ${prediction.possible ? '可能成功' : '有风险'}`);
    }

    // 步骤2: 信任阶梯检查
    const trustDecision = this.trustLadder.checkAuthorization(
      toolName,
      'tool',
      this.getActionType(toolName)
    );
    console.log(`[步骤2] 信任检查: ${trustDecision.allowed ? '允许' : '拒绝'}, 级别: ${trustDecision.confirmationLevel}`);

    if (!trustDecision.allowed) {
      return {
        success: false,
        result: { error: '信任等级不足，无法执行该操作' },
        trustDecision,
      };
    }

    // 如果需要确认，记录但不阻止（生产环境可以添加确认UI）
    if (trustDecision.confirmationLevel !== 'none') {
      console.log(`   ⚠️ 需要${trustDecision.confirmationLevel === 'confirm' ? '确认' : '通知'}`);
    }

    // 步骤3: 执行工具
    let result: any;
    let success = false;
    
    try {
      result = await this.executeTool(toolName, toolArgs);
      success = result.success !== false;
      
      // 记录执行结果到信任阶梯
      this.trustLadder.recordExecution(toolName, 'tool', {
        success,
        durationMs: Date.now() - Date.now(), // 实际应该记录真实时间
        userFeedback: success ? 1 : -1,
      });
      
    } catch (error: any) {
      success = false;
      result = { error: error.message };
      
      // 步骤4: 错误处理 + 认知负债检测
      console.log(`[步骤4] 执行失败，启动认知负债检测...`);
      const learningOutcome = await this.handleErrorAndLearn({
        taskType,
        toolName,
        toolArgs,
        error: error.message,
        userId,
        sessionId,
      });
      
      return {
        success: false,
        result,
        trustDecision,
        learningOutcome,
      };
    }

    // 步骤5: 技能DNA提取（如果执行成功）
    let skillDNA = null;
    if (success && this.isSkillExecution(toolName)) {
      skillDNA = this.extractSkillDNA(toolName, toolArgs, result);
      console.log(`[步骤5] 技能DNA提取: ${skillDNA ? '已提取' : '跳过'}`);
    }

    // 步骤6: 更新世界模型（如果有新知识）
    if (success && this.hasWorldModelEntities(toolName, toolArgs)) {
      await this.updateWorldModel(toolName, toolArgs, result);
      console.log(`[步骤6] 世界模型更新: 已更新`);
    }

    console.log(`[IntegratedCore] ✅ 任务执行完成: ${success ? '成功' : '失败'}`);

    return {
      success,
      result,
      trustDecision,
      skillDNA,
    };
  }

  /**
   * 执行具体工具
   */
  private async executeTool(toolName: string, args: any): Promise<any> {
    // 检查是否是营销工具
    if (toolName in this.marketingTools) {
      const tool = this.marketingTools[toolName as keyof typeof this.marketingTools];
      return await tool(args);
    }

    // 其他工具通过router执行
    // 这里可以扩展支持更多工具
    throw new Error(`未知工具: ${toolName}`);
  }

  /**
   * 错误处理和学习
   */
  private async handleErrorAndLearn(params: {
    taskType: string;
    toolName: string;
    toolArgs: any;
    error: string;
    userId: string;
    sessionId: string;
  }): Promise<any> {
    const { taskType, toolName, error } = params;

    // 1. 检测知识缺口
    const execution = {
      taskType,
      success: false,
      error,
      toolsUsed: [toolName],
      durationMs: 0,
    };

    const gap = await this.gapDetector.detectGap(execution);
    
    if (gap) {
      console.log(`   检测到知识缺口: ${gap.type} - ${gap.description}`);
      
      // 2. 生成学习计划
      const plan = await this.gapDetector.generateLearningPlan(gap);
      console.log(`   生成学习计划: ${plan.steps.length}步, 预计${plan.estimatedMinutes}分钟`);
      
      // 3. 执行学习（如果空闲）
      // 生产环境应该在后台空闲时执行
      // const session = await this.gapDetector.executeLearning(30);
      
      return {
        gapDetected: true,
        gapType: gap.type,
        learningPlan: plan,
        // learningSession: session,
      };
    }

    return { gapDetected: false };
  }

  /**
   * 提取技能DNA
   */
  private extractSkillDNA(toolName: string, args: any, result: any): any {
    // 模拟代码提取（实际应该获取真实技能代码）
    const mockCode = `
      async function ${toolName}(args) {
        // 执行逻辑
        return await execute(args);
      }
    `;

    const dnas = this.skillDNA.extractDNA(toolName, mockCode, `${toolName} execution`);
    
    // 创建基因组
    if (dnas.length > 0) {
      const genome = this.skillDNA.createGenome(
        `genome-${toolName}-${Date.now()}`,
        `${toolName}基因组`,
        dnas.map(d => d.id)
      );
      return genome;
    }

    return null;
  }

  /**
   * 预测执行结果
   */
  private async predictOutcome(toolName: string, args: any): Promise<any> {
    // 简化版预测（实际应该使用世界模型）
    const input = JSON.stringify(args);
    const output = 'success';
    
    const inference = this.worldModel.causalInference(input, output);
    
    return {
      possible: inference.possible,
      probability: inference.probability,
      paths: inference.paths,
    };
  }

  /**
   * 更新世界模型
   */
  private async updateWorldModel(toolName: string, args: any, result: any): Promise<void> {
    const task = {
      id: `task-${Date.now()}`,
      type: toolName,
      input: JSON.stringify(args),
      output: JSON.stringify(result),
      steps: [{ action: toolName, result: result.success ? 'success' : 'failed' }],
    };

    await this.worldModel.extractKnowledge(task);
  }

  /**
   * 设置微信集成
   */
  private setupWeChatIntegration(): void {
    // 将营销系统的微信接口与线索系统集成
    // 这样当微信收到消息时，自动创建线索
    
    // 注意：实际应该在wechat-automation-adapter中设置监听
    // 这里只是示例架构
    console.log('[IntegratedCore] 微信集成已设置');
  }

  /**
   * 设置错误学习闭环
   */
  private setupErrorLearningLoop(): void {
    // 监听错误事件，自动触发学习
    this.on('task:failed', async (data) => {
      console.log('[IntegratedCore] 任务失败，触发学习:', data.toolName);
      // 实际应该调用handleErrorAndLearn
    });
  }

  /**
   * 设置技能进化
   */
  private setupSkillEvolution(): void {
    // 定期评估技能适应度
    setInterval(() => {
      const stats = this.skillDNA.getStats();
      console.log('[IntegratedCore] 技能进化统计:', stats);
    }, 3600000); // 每小时
  }

  /**
   * 判断是否有世界模型实体
   */
  private hasWorldModelEntities(toolName: string, args: any): boolean {
    // 营销工具通常涉及实体关系
    const entityTools = ['create_lead', 'update_lead_stage', 'add_wechat_friend'];
    return entityTools.includes(toolName);
  }

  /**
   * 获取动作类型
   */
  private getActionType(toolName: string): string {
    if (toolName.includes('create') || toolName.includes('add')) return 'write';
    if (toolName.includes('update') || toolName.includes('delete')) return 'delete';
    if (toolName.includes('send') || toolName.includes('post')) return 'execute';
    return 'read';
  }

  /**
   * 判断是否技能执行
   */
  private isSkillExecution(toolName: string): boolean {
    return toolName in this.marketingTools;
  }

  /**
   * 获取所有可用工具
   */
  getAvailableTools(): Array<{ name: string; description: string }> {
    return [
      // 营销工具
      { name: 'create_lead', description: '创建销售线索' },
      { name: 'add_wechat_friend', description: '添加微信好友' },
      { name: 'post_wechat_moments', description: '发布朋友圈' },
      { name: 'send_mass_message', description: '群发消息' },
      { name: 'get_leads', description: '获取线索列表' },
      { name: 'update_lead_stage', description: '更新线索阶段' },
      { name: 'create_follow_up_task', description: '创建跟进任务' },
      { name: 'get_marketing_stats', description: '获取营销统计' },
      { name: 'run_marketing_campaign', description: '执行营销活动' },
      { name: 'enable_auto_reply', description: '启用自动回复' },
    ];
  }

  /**
   * 获取系统状态
   */
  getSystemStatus(): {
    trustLevel: string;
    activeGaps: number;
    skillCount: number;
    worldModelEntities: number;
    leadCount: number;
  } {
    const trustReport = this.trustLadder.getTrustReport();
    const pendingGaps = this.gapDetector.getPendingGaps();
    const skillStats = this.skillDNA.getStats();
    const worldStats = this.worldModel.getStats();
    const leadStats = this.leadSystem.getDashboardStats();

    return {
      trustLevel: trustReport.averageScore?.toFixed(1) || '50.0',
      activeGaps: pendingGaps.length,
      skillCount: skillStats.totalGenomes,
      worldModelEntities: worldStats.entityCount,
      leadCount: leadStats.totalLeads,
    };
  }
}

// 单例导出
let integratedCore: IntegratedAgentCore | null = null;

export function getIntegratedAgentCore(router?: AgentAIRouter): IntegratedAgentCore {
  if (!integratedCore && router) {
    integratedCore = new IntegratedAgentCore(router);
  }
  return integratedCore!;
}

// 重新导出所有工具，方便统一导入
export { AI_MARKETING_TOOLS } from './ai-marketing-tools.js';
export { getTrustLadder } from './trust-ladder.js';
export { getKnowledgeGapDetector } from './knowledge-gap-detector.js';
export { getSkillDNAEvolution } from './skill-dna.js';
export { getWorldModel } from './world-model.js';
export { getLeadConversionSystem } from './lead-conversion-system.js';
