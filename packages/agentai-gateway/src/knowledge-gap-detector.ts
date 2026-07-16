/**
 * KnowledgeGapDetector - 认知负债检测与主动学习
 * 
 * 创新理念：AI执行时自动识别知识盲区 → 生成学习计划 → 空闲时主动补课
 * 从被动响应 → 主动进化
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface KnowledgeGap {
  id: string;
  /** 缺口类型 */
  type: 'skill' | 'concept' | 'pattern' | 'domain';
  /** 描述 */
  description: string;
  /** 相关任务 */
  relatedTasks: string[];
  /** 紧急程度 */
  urgency: 'low' | 'medium' | 'high' | 'critical';
  /** 发现时间 */
  discoveredAt: number;
  /** 状态 */
  status: 'pending' | 'learning' | 'resolved' | 'dismissed';
  /** 学习计划 */
  learningPlan?: LearningPlan;
}

export interface LearningPlan {
  gapId: string;
  /** 学习资源 */
  resources: LearningResource[];
  /** 预计学习时间(分钟) */
  estimatedMinutes: number;
  /** 学习步骤 */
  steps: LearningStep[];
  /** 完成标准 */
  completionCriteria: string;
}

export interface LearningResource {
  type: 'documentation' | 'code_example' | 'tutorial' | 'best_practice' | 'research';
  title: string;
  source: string;
  relevance: number; // 0-1
}

export interface LearningStep {
  order: number;
  description: string;
  type: 'read' | 'practice' | 'implement' | 'test';
  estimatedMinutes: number;
  completed?: boolean;
}

export interface LearningSession {
  id: string;
  gapId: string;
  startedAt: number;
  completedAt?: number;
  stepsCompleted: number;
  totalSteps: number;
  notes: string;
  outcome: 'success' | 'partial' | 'failed';
}

// ═══════════════════════════════════════════════════════════
// 认知负债检测器
// ═══════════════════════════════════════════════════════════

export class KnowledgeGapDetector extends EventEmitter {
  private gaps: Map<string, KnowledgeGap> = new Map();
  private sessions: Map<string, LearningSession> = new Map();
  private llmRouter: AgentAIRouter;
  
  // 学习队列
  private learningQueue: string[] = [];
  private isLearning = false;

  constructor(llmRouter: AgentAIRouter) {
    super();
    this.llmRouter = llmRouter;
  }

  /**
   * 分析执行结果，检测知识缺口
   */
  async detectGap(execution: {
    taskType: string;
    input: string;
    output: string;
    success: boolean;
    error?: string;
    toolsUsed: string[];
    durationMs: number;
  }): Promise<KnowledgeGap | null> {
    // 失败任务可能表明知识缺口
    if (!execution.success) {
      return await this.analyzeFailure(execution);
    }
    
    // 耗时过长的任务可能表明效率缺口
    if (execution.durationMs > 60000) {
      return await this.analyzeEfficiencyGap(execution);
    }
    
    // 使用了过多工具可能表明流程优化缺口
    if (execution.toolsUsed.length > 5) {
      return await this.analyzeProcessGap(execution);
    }
    
    return null;
  }

  /**
   * 分析失败原因
   */
  private async analyzeFailure(execution: any): Promise<KnowledgeGap | null> {
    const prompt = `分析以下任务失败原因，判断是否是知识缺口：

任务类型: ${execution.taskType}
输入: ${execution.input}
错误: ${execution.error || '未知错误'}
使用工具: ${execution.toolsUsed.join(', ')}

如果是知识缺口，请描述：
1. 缺少什么知识/技能
2. 紧急程度 (low/medium/high/critical)
3. 建议的学习方向

如果不是知识缺口（如外部依赖问题），请回答"不是知识缺口"。`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      if (content.includes('不是知识缺口')) {
        return null;
      }

      // 解析缺口信息
      const gap: KnowledgeGap = {
        id: `gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: this.inferGapType(content),
        description: this.extractDescription(content),
        relatedTasks: [execution.taskType],
        urgency: this.extractUrgency(content),
        discoveredAt: Date.now(),
        status: 'pending',
      };

      this.gaps.set(gap.id, gap);
      this.emit('gap:detected', gap);
      
      return gap;
    } catch (error) {
      console.error('[KnowledgeGapDetector] 分析失败:', error);
      return null;
    }
  }

  /**
   * 分析效率缺口
   */
  private async analyzeEfficiencyGap(execution: any): Promise<KnowledgeGap | null> {
    const gap: KnowledgeGap = {
      id: `gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'pattern',
      description: `任务执行时间过长(${Math.round(execution.durationMs / 1000)}秒)，可能存在更高效的实现方式`,
      relatedTasks: [execution.taskType],
      urgency: 'medium',
      discoveredAt: Date.now(),
      status: 'pending',
    };

    this.gaps.set(gap.id, gap);
    this.emit('gap:detected', gap);
    
    return gap;
  }

  /**
   * 分析流程缺口
   */
  private async analyzeProcessGap(execution: any): Promise<KnowledgeGap | null> {
    const gap: KnowledgeGap = {
      id: `gap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'pattern',
      description: `使用了${execution.toolsUsed.length}个工具，流程可能可以优化简化`,
      relatedTasks: [execution.taskType],
      urgency: 'low',
      discoveredAt: Date.now(),
      status: 'pending',
    };

    this.gaps.set(gap.id, gap);
    this.emit('gap:detected', gap);
    
    return gap;
  }

  /**
   * 生成学习计划
   */
  async generateLearningPlan(gap: KnowledgeGap): Promise<LearningPlan> {
    const prompt = `为以下知识缺口生成学习计划：

缺口类型: ${gap.type}
描述: ${gap.description}
紧急程度: ${gap.urgency}

请提供：
1. 需要学习的具体知识点
2. 推荐的学习资源（文档、代码示例、最佳实践）
3. 学习步骤（阅读→实践→测试）
4. 预计学习时间
5. 完成标准`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // 解析学习计划
      const plan: LearningPlan = {
        gapId: gap.id,
        resources: this.extractResources(content),
        estimatedMinutes: this.extractEstimatedTime(content),
        steps: this.extractSteps(content),
        completionCriteria: this.extractCompletionCriteria(content),
      };

      gap.learningPlan = plan;
      gap.status = 'learning';
      this.gaps.set(gap.id, gap);

      this.emit('plan:generated', { gap, plan });
      
      return plan;
    } catch (error) {
      console.error('[KnowledgeGapDetector] 生成计划失败:', error);
      // 返回默认计划
      return this.getDefaultPlan(gap);
    }
  }

  /**
   * 将缺口加入学习队列
   */
  enqueueLearning(gapId: string): void {
    if (!this.learningQueue.includes(gapId)) {
      const gap = this.gaps.get(gapId);
      if (gap && gap.status === 'pending') {
        // 按紧急程度排序
        const urgencyScore = { low: 1, medium: 2, high: 3, critical: 4 };
        const score = urgencyScore[gap.urgency];
        
        // 找到合适的位置插入
        let insertIndex = this.learningQueue.length;
        for (let i = 0; i < this.learningQueue.length; i++) {
          const otherGap = this.gaps.get(this.learningQueue[i]);
          if (otherGap && urgencyScore[otherGap.urgency] < score) {
            insertIndex = i;
            break;
          }
        }
        
        this.learningQueue.splice(insertIndex, 0, gapId);
        this.emit('learning:enqueued', gap);
      }
    }
  }

  /**
   * 执行学习（在空闲时调用）
   */
  async executeLearning(maxDurationMinutes: number = 30): Promise<LearningSession | null> {
    if (this.isLearning || this.learningQueue.length === 0) {
      return null;
    }

    this.isLearning = true;
    const gapId = this.learningQueue.shift()!;
    const gap = this.gaps.get(gapId);

    if (!gap) {
      this.isLearning = false;
      return null;
    }

    // 生成学习计划（如果没有）
    if (!gap.learningPlan) {
      await this.generateLearningPlan(gap);
    }

    const plan = gap.learningPlan!;
    const session: LearningSession = {
      id: `session-${Date.now()}`,
      gapId,
      startedAt: Date.now(),
      stepsCompleted: 0,
      totalSteps: plan.steps.length,
      notes: '',
      outcome: 'partial',
    };

    this.emit('learning:started', session);

    // 模拟学习过程（实际实现中这里会执行具体学习步骤）
    const startTime = Date.now();
    for (const step of plan.steps) {
      // 检查是否超时
      if ((Date.now() - startTime) > maxDurationMinutes * 60 * 1000) {
        session.notes += `\n时间限制，完成 ${session.stepsCompleted}/${plan.steps.length} 步`;
        break;
      }

      // 执行学习步骤
      await this.executeLearningStep(step);
      step.completed = true;
      session.stepsCompleted++;
      
      this.emit('learning:progress', { session, step });
    }

    session.completedAt = Date.now();
    session.outcome = session.stepsCompleted === session.totalSteps ? 'success' : 'partial';
    
    // 更新缺口状态
    if (session.outcome === 'success') {
      gap.status = 'resolved';
    }
    this.gaps.set(gapId, gap);

    this.sessions.set(session.id, session);
    this.isLearning = false;

    this.emit('learning:completed', session);
    
    return session;
  }

  /**
   * 获取待学习缺口列表
   */
  getPendingGaps(): KnowledgeGap[] {
    return Array.from(this.gaps.values())
      .filter(g => g.status === 'pending' || g.status === 'learning')
      .sort((a, b) => {
        const urgencyScore = { critical: 4, high: 3, medium: 2, low: 1 };
        return urgencyScore[b.urgency] - urgencyScore[a.urgency];
      });
  }

  /**
   * 获取学习统计
   */
  getStats(): {
    totalGaps: number;
    resolved: number;
    pending: number;
    learning: number;
    dismissed: number;
    totalLearningTime: number;
  } {
    const gaps = Array.from(this.gaps.values());
    const sessions = Array.from(this.sessions.values());
    
    return {
      totalGaps: gaps.length,
      resolved: gaps.filter(g => g.status === 'resolved').length,
      pending: gaps.filter(g => g.status === 'pending').length,
      learning: gaps.filter(g => g.status === 'learning').length,
      dismissed: gaps.filter(g => g.status === 'dismissed').length,
      totalLearningTime: sessions.reduce((sum, s) => {
        if (s.completedAt) {
          return sum + (s.completedAt - s.startedAt);
        }
        return sum;
      }, 0),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private inferGapType(content: string): KnowledgeGap['type'] {
    if (content.includes('技能') || content.includes('tool')) return 'skill';
    if (content.includes('概念') || content.includes('原理')) return 'concept';
    if (content.includes('模式') || content.includes('pattern')) return 'pattern';
    return 'domain';
  }

  private extractDescription(content: string): string {
    const match = content.match(/(?:缺口描述|Description)[：:]\s*([^\n]+)/i);
    return match ? match[1].trim() : content.slice(0, 200);
  }

  private extractUrgency(content: string): KnowledgeGap['urgency'] {
    if (content.includes('critical') || content.includes('严重')) return 'critical';
    if (content.includes('high') || content.includes('高')) return 'high';
    if (content.includes('low') || content.includes('低')) return 'low';
    return 'medium';
  }

  private extractResources(content: string): LearningResource[] {
    const resources: LearningResource[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.includes('文档') || line.includes('documentation')) {
        resources.push({ type: 'documentation', title: line.trim(), source: 'auto', relevance: 0.9 });
      } else if (line.includes('示例') || line.includes('example')) {
        resources.push({ type: 'code_example', title: line.trim(), source: 'auto', relevance: 0.8 });
      } else if (line.includes('教程') || line.includes('tutorial')) {
        resources.push({ type: 'tutorial', title: line.trim(), source: 'auto', relevance: 0.7 });
      }
    }
    
    return resources;
  }

  private extractEstimatedTime(content: string): number {
    const match = content.match(/(\d+)\s*(分钟|min|小时|hour)/i);
    if (match) {
      const num = parseInt(match[1]);
      if (content.includes('小时') || content.includes('hour')) {
        return num * 60;
      }
      return num;
    }
    return 30; // 默认30分钟
  }

  private extractSteps(content: string): LearningStep[] {
    const steps: LearningStep[] = [];
    const lines = content.split('\n');
    let order = 1;
    
    for (const line of lines) {
      if (line.match(/^\d+\.|^\-|^(阅读|实践|实现|测试)/)) {
        steps.push({
          order: order++,
          description: line.replace(/^\d+\.|^\-/, '').trim(),
          type: line.includes('阅读') ? 'read' : 
                line.includes('实践') ? 'practice' :
                line.includes('实现') ? 'implement' : 'test',
          estimatedMinutes: 10,
        });
      }
    }
    
    if (steps.length === 0) {
      // 默认步骤
      steps.push(
        { order: 1, description: '阅读相关文档', type: 'read', estimatedMinutes: 10 },
        { order: 2, description: '查看代码示例', type: 'read', estimatedMinutes: 10 },
        { order: 3, description: '实践练习', type: 'practice', estimatedMinutes: 10 },
      );
    }
    
    return steps;
  }

  private extractCompletionCriteria(content: string): string {
    const match = content.match(/(?:完成标准|Completion)[：:]\s*([^\n]+)/i);
    return match ? match[1].trim() : '能够独立完成任务';
  }

  private getDefaultPlan(gap: KnowledgeGap): LearningPlan {
    return {
      gapId: gap.id,
      resources: [
        { type: 'documentation', title: '相关文档', source: 'auto', relevance: 0.8 },
      ],
      estimatedMinutes: 30,
      steps: [
        { order: 1, description: '学习相关知识', type: 'read', estimatedMinutes: 15 },
        { order: 2, description: '实践练习', type: 'practice', estimatedMinutes: 15 },
      ],
      completionCriteria: '能够独立完成任务',
    };
  }

  private async executeLearningStep(step: LearningStep): Promise<void> {
    // 模拟学习步骤执行
    await new Promise(resolve => setTimeout(resolve, step.estimatedMinutes * 100));
    
    // 实际实现中，这里会：
    // - read: 读取文档、搜索知识
    // - practice: 执行示例代码
    // - implement: 实现练习任务
    // - test: 验证学习成果
  }
}

// 单例导出
let detectorInstance: KnowledgeGapDetector | null = null;

export function getKnowledgeGapDetector(llmRouter: AgentAIRouter): KnowledgeGapDetector {
  if (!detectorInstance) {
    detectorInstance = new KnowledgeGapDetector(llmRouter);
  }
  return detectorInstance;
}
