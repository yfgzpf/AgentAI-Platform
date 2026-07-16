/**
 * Distillation On Demand - 按需蒸馏系统
 * ----------------------------------------------------
 * 实现您设想的功能：当AI在某个问题上卡住时主动向强模型提问
 *
 * 工作流程：
 * 1. Hook系统监测到多次工具调用失败/循环困境
 * 2. PreModelCall触发callStrongerModel
 * 3. 智能切换评估任务难度与紧急性  
 * 4. 流式生成强模型完整推理过程
 * 5. 小模型学习强大模型策略后处理剩余任务
 */

import { hooksManager } from './lifecycle-hooks.js';
import { SmartModelSwitcher, ModelSwitchDecision } from './smart-model-switcher.js';
import { ToolContext } from './tool-registry.js';

export enum StuckLevel {
  NONE = 'none',        // 正常执行
  REPEATING = 'repeating',  // 重复调用相似工具
  FAILING = 'failing',      // 多个工具调用失败
  CIRCULAR = 'circular',    // 循环思维困境
  CRITICAL = 'critical'     // 长时间卡住影响用户体验
}

export interface StuckDetection {
  level: StuckLevel;
  reason: string;
  attempts: number;
  timestamp: number;
  context: {
    recentTools: string[];
    recentErrors: string[];
    timeInTask: number;
    taskComplexity: 'simple' | 'medium' | 'complex';
  };
}

export interface StrongModelSession {
  id: string;
  problem: string;
  startTime: number;
  strongModel: string;
  advice: string;
  learned: boolean;
}

/**
 * Deep-Routine 复杂问题解决路线
 * 小模型遇到困难时呼叫更强大模型帮助规划和计算
 */
export class DistillationOnDemand {
  private modelSwitcher = new SmartModelSwitcher();
  private stuckTracker = new Map<string, StuckDetection>();
  private strongModelSessions = new Map<string, StrongModelSession>();
  
  constructor() {}

  /**
   * 监测执行状态，检测是否"卡住"
   */
  analyzeStuckState(sessionId: string, context: ToolContext, toolResult?: any): StuckDetection {
    const currentTime = Date.now();
    const existing = this.stuckTracker.get(sessionId);
    
    // 获取最近工具调用历史
    const recentMessages = context.priorMessages?.slice(-10) || [];
    const recentTools = recentMessages
      .filter(m => m.role === 'tool')
      .map(m => (m as any).name)
      .slice(-5);
    
    // 获取最近错误模式
    const recentErrors = recentMessages
      .filter(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('Error:'))
      .map(m => m.content.slice(0, 200))
      .slice(-3);
    
    let timeInTask = existing?.context.timeInTask || 0;
    let level = StuckLevel.NONE;
    let reason = 'Normal execution';
    let attempts = existing?.attempts || 0;
    
    attempts++;
    timeInTask += 30000; // 假设每30秒检测一次
    
    // 🔍 1. 检查重复调用模式
    const uniqueTools = new Set(recentTools);
    if (recentTools.length >= 3 && uniqueTools.size <= 2) {
      level = StuckLevel.REPEATING;
      reason = `Tool repetition detected: ${Array.from(uniqueTools).join(', ')}`;
    }
    
    // 🔍 2. 检查连续错误
    if (recentErrors.length >= 3) {
      level = StuckLevel.FAILING;
      reason = `Consecutive errors: ${recentErrors.length} failures`;
    }
    
    // 🔍 3. 检查思维循环
    const modelCalls = recentMessages.filter(m => m.role === 'assistant' && (m as any).tool_calls);
    if (modelCalls.length >= 3) {
      const callPatterns = modelCalls.map(m => 
        (m as any).tool_calls.map((tc: any) => tc.name).join(',')
      );
      const uniquePatterns = new Set(callPatterns);
      if (uniquePatterns.size === 1 && callPatterns.length >= 3) {
        level = StuckLevel.CIRCULAR;
        reason = `Circular reasoning: same tool pattern repeated`;
      }
    }
    
    // 🔍 4. 检查长时间困境
    if (timeInTask > 300000) { // 5分钟无进展
      level = StuckLevel.CRITICAL;
      reason = `Long time stuck: ${Math.floor(timeInTask / 60000)} minutes with no progress`;
    }
    
    // 计算任务复杂度
    const complexity: 'simple' | 'medium' | 'complex' = timeInTask > 180000 ? 'complex' : 
                                                     timeInTask > 60000 ? 'medium' : 'simple';
    
    const detection: StuckDetection = {
      level,
      reason,
      attempts,
      timestamp: currentTime,
      context: {
        recentTools,
        recentErrors,
        timeInTask,
        taskComplexity: complexity
      }
    };
    
    this.stuckTracker.set(sessionId, detection);
    
    return detection;
  }

  /**
   * 判断是否需要向强模型求助
   */
  shouldCallStrongerModel(stuck: StuckDetection, urgency: 'low' | 'medium' | 'high' = 'medium'): {
    should: boolean;
    reason: string;
    confidence: number;
  } {
    let should = false;
    let reason = '';
    let confidence = 0.0;
    
    switch (stuck.level) {
      case StuckLevel.REPEATING:
        should = stuck.attempts >= 3;
        reason = should ? 'High repetition indicates systematic failure' : 'Low repetition, continue trying';
        confidence = 0.6;
        break;
        
      case StuckLevel.FAILING:
        should = stuck.attempts >= 2;
        reason = should ? 'Multiple tool failures detected' : 'Few failures, not critical yet';
        confidence = 0.7;
        break;
        
      case StuckLevel.CIRCULAR:
        should = true;
        reason = 'Circular reasoning detected - strong model intervention needed';
        confidence = 0.8;
        break;
        
      case StuckLevel.CRITICAL:
        should = true;
        reason = 'Critical stuck state - user likely frustrated';
        confidence = 0.9;
        break;
        
      default:
        reason = 'Normal execution - no need for external help';
        confidence = 0.0;
    }
    
    // 紧急性调整
    if (urgency === 'high') {
      confidence += 0.2;
      should = should || stuck.level !== StuckLevel.NONE;
    }
    
    return { should, reason, confidence };
  }

  /**
   * 呼叫强模型 - 核心蒸馏机制
   */
  async callStrongerModel(
    sessionId: string,
    problemDescription: string,
    context: ToolContext,
    stuck: StuckDetection
  ): Promise<string> {
    const strongSessionId = `strong-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(`[DistillationOnDemand] Session ${sessionId} calling strong model: ${strongSessionId}`);
    
    try {
      // 1. 决策应该切换到哪个强模型
      const weakProvider = this.getCurrentProvider(context);
      const switchDecision = this.modelSwitcher.analyzeSwitchNeed(
        weakProvider,
        { isLimited: false, provider: weakProvider, remainingRequests: 100, resetTime: '', waitTime: 0 },
        stuck.context.taskComplexity,
        stuck.level === StuckLevel.CRITICAL ? 'high' : 'medium'
      );
      
      if (!switchDecision.shouldSwitch) {
        throw new Error(`Cannot get stronger model: ${switchDecision.reason}`);
      }
      
      // 2. 构建求助prompt
      const helpPrompt = this.buildHelpPrompt(problemDescription, stuck, context);
      
      // 3. 调用强模型
      const strongModel = switchDecision.targetProvider;
      const { AgentAIRouter } = await import('./llm-router.js');
      const router = new AgentAIRouter();
      
      const advice = await router.chat({
        messages: [{ role: 'user', content: helpPrompt }],
        model: strongModel,
        userId: context.userId,
        workspace: context.workspace,
        stream: false
      });
      
      // 4. 记录强模型会话
      const session: StrongModelSession = {
        id: strongSessionId,
        problem: problemDescription,
        startTime: Date.now(),
        strongModel,
        advice: advice.content || '',
        learned: false
      };
      
      this.strongModelSessions.set(strongSessionId, session);
      
      console.log(`[DistillationOnDemand] Strong model advice received (${strongModel}): ${advice.content?.slice(0, 200)}...`);
      
      return advice.content || 'No advice received';
      
    } catch (error) {
      console.error(`[DistillationOnDemand] Failed to call strong model:`, error);
      throw new Error(`Distillation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 构建向强模型求助的prompt
   */
  private buildHelpPrompt(problemDescription: string, stuck: StuckDetection, context: ToolContext): string {
    return `🤖 Intelligence Distiller Call

I'm a smaller AI model (${this.getCurrentProvider(context)}) currently stuck on a ${stuck.context.taskComplexity} complexity task.

**Problem Diagnosis:**
${stuck.reason}

**Stuck Level:** ${stuck.level.toUpperCase()}
**Attempts Made:** ${stuck.attempts}
**Time Spent:** ${Math.floor(stuck.context.timeInTask / 1000)}s

**Original Task:**
${problemDescription}

**Recent Tool Calls:**
${stuck.context.recentTools.map((tool, i) => `${i + 1}. ${tool}`).join('\n')}

**Recent Errors:**
${stuck.context.recentErrors.map((err, i) => `${i + 1}. ${err}`).join('\n') || 'None'}

**My Surrounding Context:**
- User ID: ${context.userId}
- Workspace: ${context.workspace}
- Recent conversation: ${context.priorMessages?.slice(-3).map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content.slice(0, 100) : 'non-text'}`).join('\n') || 'Limited context'}

🔍 **Your Role:**
You are a stronger, more capable AI model. I need your strategic guidance to:

1. **Analysis**: Diagnose why I'm stuck and what's wrong with my approach
2. **Strategy**: Outline a step-by-step solution plan
3. **Tool Selection**: Recommend which tools to use and in what order
4. **Avoid Pitfalls**: Warn me about common mistakes in this scenario
5. **Optimization**: Suggest efficiency improvements

📊 **Expected Output Format:**
<strong_model_advice>
<analysis>
[Your diagnosis of my situation]
</analysis>

<solution_steps>
1. First, [action]
2. Then, [action]
3. Finally, [action]
</solution_steps>

<tools_recommended>
- [tool1]: [when and how to use]
- [tool2]: [when and how to use]
</tools_recommended>

<warnings>
⚠️ [common mistake to avoid]
⚠️ [performance consideration]
</warnings>

<confidence>0-100</confidence>
</strong_model_advice>

Please be specific, actionable, and focus on breaking this down into concrete steps I can execute. The goal is for me to learn your reasoning and successfully complete the task.`;
  }

  /**
   * 从小模型配置获取当前提供者
   */
  private getCurrentProvider(context: ToolContext): string {
    // 从上下文尝试推断当前模型提供者
    const priorMsgs = context.priorMessages || [];
    for (const msg of priorMsgs.slice(-5)) {
      if ((msg as any).provider) {
        return (msg as any).provider;
      }
    }
    return 'agentai'; // 默认回退
  }

  /**
   * 提取强模型建议中的可执行步骤
   */
  parseAdvice(advice: string): {
    analysis: string;
    steps: string[];
    tools: string[];
    warnings: string[];
    confidence: number;
  } {
    const result = {
      analysis: '',
      steps: [] as string[],
      tools: [] as string[],
      warnings: [] as string[],
      confidence: 50
    };
    
    try {
      // 简单的XML解析
      const analysisMatch = advice.match(/<analysis>(.*?)<\/analysis>/s);
      result.analysis = analysisMatch?.[1]?.trim() || '';
      
      const stepsMatch = advice.match(/<solution_steps>(.*?)<\/solution_steps>/s);
      if (stepsMatch?.[1]) {
        result.steps = stepsMatch[1]
          .split(/\n/)
          .map(s => s.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean);
      }
      
      const toolsMatch = advice.match(/<tools_recommended>(.*?)<\/tools_recommended>/s);
      if (toolsMatch?.[1]) {
        result.tools = toolsMatch[1]
          .split(/\n/)
          .map(s => s.replace(/^-\s*/, '').trim())
          .filter(Boolean);
      }
      
      const warningsMatch = advice.match(/<warnings>(.*?)<\/warnings>/s);
      if (warningsMatch?.[1]) {
        result.warnings = warningsMatch[1]
          .split(/\n/)
          .map(s => s.replace(/^⚠️\s*/, '').trim())
          .filter(Boolean);
      }
      
      const confidenceMatch = advice.match(/<confidence>(\d+)<\/confidence>/);
      result.confidence = parseInt(confidenceMatch?.[1] || '50', 10);
      
    } catch (error) {
      console.warn('[DistillationOnDemand] Failed to parse advice XML:', error);
      // 回退到简单文本解析
      result.steps = advice.split(/\n/).slice(0, 5).filter(s => s.trim());
    }
    
    return result;
  }

  /**
   * 应用强模型建议到当前上下文
   */
  applyAdvice(sessionId: string, advice: string, context: ToolContext): void {
    const session = this.strongModelSessions.get(sessionId);
    if (!session) return;
    
    const parsed = this.parseAdvice(advice);
    
    // 将建议注入到后续system prompt中
    const guidanceText = `## 🧠 Intelligence Distillation Applied

**From Strong Model (${session.strongModel}):**

**Analysis:** ${parsed.analysis}

**Action Plan:**
${parsed.steps.map(s => `- ${s}`).join('\n')}

**Recommended Tools:**
${parsed.tools.map(t => `- ${t}`).join('\n')}

**Confidence:** ${parsed.confidence}%

Please apply this distilled wisdom to complete the current task efficiently.`;
    
    // 添加到上下文记忆中
    import('./memory.js').then(({ writeMemory }) => {
      writeMemory({
        userId: context.userId,
        workspace: context.workspace,
        role: 'system',
        content: guidanceText,
        source: 'lifecycle',
        importance: 0.8,
        metadata: {
          distillationSession: sessionId,
          strongModelProvider: session.strongModel,
          confidence: parsed.confidence
        }
      });
    }).catch(console.error);
    
    // 标记已学习
    session.learned = true;
    console.log(`[DistillationOnDemand] Session ${sessionId} marked as learned`);
  }

  /**
   * 清理会话状态
   */
  cleanupSession(sessionId: string): void {
    this.stuckTracker.delete(sessionId);
    // 保留强模型会话用于分析
  }

  /**
   * 获取蒸馏统计信息
   */
  getStats(): {
    stuckSessions: number;
    strongSessions: number;
    learnRate: number;
  } {
    const learned = Array.from(this.strongModelSessions.values()).filter(s => s.learned).length;
    return {
      stuckSessions: this.stuckTracker.size,
      strongSessions: this.strongModelSessions.size,
      learnRate: this.strongModelSessions.size > 0 ? learned / this.strongModelSessions.size : 0
    };
  }
}

/**
 * 按需蒸馏系统单例
 */
export const distilationOnDemand = new DistillationOnDemand();

// 🌟 自动注册Hook处理器
hooksManager.register('PreModelCall', {
  phase: 'before',
  priority: 50,
  enabled: true,
  handler: async (context) => {
    // 只在小模型调用时检测是否应该向大模型请教
    const modelName = context.modelName || 'agentai';
    const provider = modelName.split('/')[0];
    const isWeakModel = !context.modelName || provider === 'agentai' || provider === 'zhipu';
    if (!isWeakModel) {
      return { success: true, continue: true };
    }
    
    const sessionId = context.sessionId;
    const weakContext: ToolContext = context.originalContext || {
      userId: context.userId,
      workspace: context.workspace,
      abortSignal: new AbortController().signal,
      priorMessages: []
    };
    
    // 分析当前是否卡住
    const stuck = distilationOnDemand.analyzeStuckState(sessionId, weakContext);
    
    if (stuck.level === StuckLevel.NONE) {
      return { success: true, continue: true };
    }
    
    const { should, reason, confidence } = distilationOnDemand.shouldCallStrongerModel(stuck, 'medium');
    
    if (should && confidence > 0.7) {
      console.log(`[DistillationOnDemand] Session ${sessionId} detected stuck (${stuck.level}), calling strong model...`);
      
      try {
        const problem = `Session task requiring assistance. Detected ${stuck.level} state after ${stuck.attempts} attempts.`;
        const advice = await distilationOnDemand.callStrongerModel(
          sessionId,
          problem,
          weakContext,
          stuck
        );
        
        // 应用建议
        distilationOnDemand.applyAdvice(sessionId, advice, weakContext);
        
        console.log(`[DistillationOnDemand] Strong model guidance applied successfully`);
      } catch (error) {
        console.error(`[DistillationOnDemand] Failed to get help from strong model:`, error);
      }
    }
    
    return { success: true, continue: true };
  }
});

hooksManager.register('ErrorOccurred', {
  phase: 'error',
  priority: 30,
  enabled: true,
  handler: async (context) => {
    if (!context.error) return { success: true, continue: true };
    
    const sessionId = context.sessionId;
    const weakContext: ToolContext = context.originalContext || {
      userId: context.userId,
      workspace: context.workspace,
      abortSignal: new AbortController().signal,
      priorMessages: []
    };
    
    // 错误时特别检查是否需要强模型帮助
    const stuck = distilationOnDemand.analyzeStuckState(sessionId, weakContext);
    const { should, reason, confidence } = distilationOnDemand.shouldCallStrongerModel(stuck, 'high');
    
    if (should && confidence > 0.6) {
      console.log(`[DistillationOnDemand] Error detected, considering strong model consultation...`);
      
      try {
        const problem = `Repeated errors in session: ${context.error.message}`;
        const advice = await distilationOnDemand.callStrongerModel(
          sessionId,
          problem,
          weakContext,
          stuck
        );
        
        distilationOnDemand.applyAdvice(sessionId, advice, weakContext);
        
      } catch (error) {
        console.error(`[DistillationOnDemand] Error consultation failed:`, error);
      }
    }
    
    return { success: true, continue: true };
  }
});