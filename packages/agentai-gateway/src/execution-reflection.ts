/**
 * Execution Reflection - 执行反思机制
 * 
 * 世界级AI核心能力：
 * 1. 分析执行过程，识别问题
 * 2. 生成改进建议
 * 3. 更新执行策略
 * 4. 积累经验教训
 * 
 * 这是超越级AI的关键，让AI从"执行"进化为"学习执行"
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface ExecutionResult {
  id: string;
  taskId: string;
  taskType: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  steps: ExecutionStep[];
  context: ExecutionContext;
}

export interface ExecutionStep {
  id: string;
  type: 'thinking' | 'tool_call' | 'skill_call' | 'user_interaction' | 'error';
  description: string;
  durationMs: number;
  input?: any;
  output?: any;
  error?: string;
}

export interface ExecutionContext {
  userMessage: string;
  systemPrompt: string;
  toolsUsed: string[];
  skillsUsed: string[];
  iterations: number;
  tokenUsage: {
    prompt: number;
    completion: number;
  };
}

export interface Reflection {
  executionId: string;
  timestamp: number;
  analysis: {
    whatWorked: string[];
    whatFailed: string[];
    whatCouldBeBetter: string[];
  };
  rootCauses: RootCause[];
  recommendations: Recommendation[];
  strategyUpdates: StrategyUpdate[];
  lessons: Lesson[];
}

export interface RootCause {
  category: 'planning' | 'execution' | 'knowledge' | 'tool' | 'environment';
  description: string;
  evidence: string[];
  confidence: number;
}

export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  action: string;
  expectedImpact: string;
}

export interface StrategyUpdate {
  aspect: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export interface Lesson {
  id: string;
  category: string;
  situation: string;
  lesson: string;
  applyTo: string[];
  confidence: number;
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════
// 执行反思引擎
// ═══════════════════════════════════════════════════════════

export class ExecutionReflection extends EventEmitter {
  private llmRouter: AgentAIRouter;
  private lessons: Map<string, Lesson> = new Map();
  private strategies: Map<string, any> = new Map();

  constructor(llmRouter: AgentAIRouter) {
    super();
    this.llmRouter = llmRouter;
  }

  /**
   * 反思执行过程
   * 
   * 深度分析执行结果，生成改进建议
   */
  async reflect(execution: ExecutionResult): Promise<Reflection> {
    console.log(`[Reflection] 反思执行: ${execution.id}`);

    // 1. 分析执行步骤
    const stepAnalysis = this.analyzeSteps(execution.steps);

    // 2. 使用LLM深度反思
    const llmReflection = await this.llmReflect(execution);

    // 3. 整合分析结果
    const reflection: Reflection = {
      executionId: execution.id,
      timestamp: Date.now(),
      analysis: {
        whatWorked: stepAnalysis.whatWorked,
        whatFailed: stepAnalysis.whatFailed,
        whatCouldBeBetter: llmReflection.improvements,
      },
      rootCauses: llmReflection.rootCauses,
      recommendations: llmReflection.recommendations,
      strategyUpdates: [],
      lessons: [],
    };

    // 4. 生成策略更新
    reflection.strategyUpdates = this.generateStrategyUpdates(reflection);

    // 5. 提取经验教训
    reflection.lessons = this.extractLessons(reflection);

    // 6. 应用策略更新
    this.applyStrategyUpdates(reflection.strategyUpdates);

    // 7. 存储经验教训
    for (const lesson of reflection.lessons) {
      this.lessons.set(lesson.id, lesson);
    }

    console.log(`[Reflection] 生成 ${reflection.recommendations.length} 条建议, ${reflection.lessons.length} 条经验`);
    this.emit('reflection:completed', reflection);

    return reflection;
  }

  /**
   * 批量反思多个执行
   */
  async reflectBatch(executions: ExecutionResult[]): Promise<Reflection[]> {
    const reflections: Reflection[] = [];
    
    for (const execution of executions) {
      const reflection = await this.reflect(execution);
      reflections.push(reflection);
    }

    // 生成综合改进建议
    const comprehensive = this.generateComprehensiveImprovements(reflections);
    this.emit('reflection:comprehensive', comprehensive);

    return reflections;
  }

  /**
   * 获取相关经验教训
   */
  getRelevantLessons(context: {
    taskType?: string;
    tools?: string[];
    errorPattern?: string;
  }): Lesson[] {
    const relevant: Lesson[] = [];

    for (const lesson of this.lessons.values()) {
      let score = 0;

      // 任务类型匹配
      if (context.taskType && lesson.applyTo.includes(context.taskType)) {
        score += 3;
      }

      // 工具匹配
      if (context.tools) {
        for (const tool of context.tools) {
          if (lesson.applyTo.includes(tool)) {
            score += 2;
          }
        }
      }

      // 错误模式匹配
      if (context.errorPattern && 
          lesson.situation.includes(context.errorPattern)) {
        score += 5;
      }

      if (score > 0) {
        relevant.push({ ...lesson, confidence: score });
      }
    }

    // 按相关度排序
    return relevant
      .sort((a, b) => (b.confidence as number) - (a.confidence as number))
      .slice(0, 5);
  }

  /**
   * 获取当前策略
   */
  getStrategy(aspect: string): any {
    return this.strategies.get(aspect);
  }

  /**
   * 获取所有经验教训
   */
  getAllLessons(): Lesson[] {
    return Array.from(this.lessons.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 生成反思报告
   */
  generateReport(): string {
    const lessons = this.getAllLessons();
    const strategies = Array.from(this.strategies.entries());

    let report = '# 执行反思报告\n\n';
    
    report += '## 策略更新\n';
    for (const [aspect, value] of strategies) {
      report += `- ${aspect}: ${JSON.stringify(value)}\n`;
    }
    
    report += '\n## 经验教训\n';
    for (const lesson of lessons.slice(0, 10)) {
      report += `### ${lesson.category}\n`;
      report += `- 情境: ${lesson.situation}\n`;
      report += `- 教训: ${lesson.lesson}\n`;
      report += `- 应用: ${lesson.applyTo.join(', ')}\n\n`;
    }

    return report;
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private analyzeSteps(steps: ExecutionStep[]): {
    whatWorked: string[];
    whatFailed: string[];
  } {
    const whatWorked: string[] = [];
    const whatFailed: string[] = [];

    for (const step of steps) {
      if (step.error) {
        whatFailed.push(`${step.type}: ${step.description} - ${step.error}`);
      } else {
        whatWorked.push(`${step.type}: ${step.description}`);
      }
    }

    return { whatWorked, whatFailed };
  }

  private async llmReflect(execution: ExecutionResult): Promise<{
    improvements: string[];
    rootCauses: RootCause[];
    recommendations: Recommendation[];
  }> {
    const prompt = `你是一个专业的执行分析专家。请分析以下执行过程，提供深度反思。

执行结果:
- 成功: ${execution.success}
- 耗时: ${execution.durationMs}ms
- 步骤数: ${execution.steps.length}
- 错误: ${execution.error || '无'}

执行步骤:
${execution.steps.map((s, i) => `${i + 1}. [${s.type}] ${s.description} (${s.durationMs}ms)${s.error ? ' - 错误: ' + s.error : ''}`).join('\n')}

输出JSON格式:
{
  "improvements": ["可以改进的地方1", "可以改进的地方2"],
  "rootCauses": [
    {
      "category": "planning|execution|knowledge|tool|environment",
      "description": "根本原因描述",
      "evidence": ["证据1", "证据2"],
      "confidence": 0.8
    }
  ],
  "recommendations": [
    {
      "priority": "critical|high|medium|low",
      "description": "建议描述",
      "action": "具体行动",
      "expectedImpact": "预期效果"
    }
  ]
}`;

    try {
      const response = await this.llmRouter.chat({
        model: 'agentai',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                       content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        return this.fallbackReflection(execution);
      }

      return JSON.parse(jsonMatch[1] || jsonMatch[0]);
    } catch (error) {
      return this.fallbackReflection(execution);
    }
  }

  private fallbackReflection(execution: ExecutionResult): {
    improvements: string[];
    rootCauses: RootCause[];
    recommendations: Recommendation[];
  } {
    const improvements: string[] = [];
    const rootCauses: RootCause[] = [];
    const recommendations: Recommendation[] = [];

    if (!execution.success) {
      improvements.push('需要更好的错误处理');
      rootCauses.push({
        category: 'execution',
        description: execution.error || '未知错误',
        evidence: [execution.error || ''],
        confidence: 0.8,
      });
      recommendations.push({
        priority: 'high',
        description: '添加重试机制',
        action: '在失败时自动重试',
        expectedImpact: '提高成功率',
      });
    }

    if (execution.durationMs > 60000) {
      improvements.push('执行时间过长，需要优化');
      recommendations.push({
        priority: 'medium',
        description: '优化执行效率',
        action: '并行执行独立任务',
        expectedImpact: '减少执行时间',
      });
    }

    return { improvements, rootCauses, recommendations };
  }

  private generateStrategyUpdates(reflection: Reflection): StrategyUpdate[] {
    const updates: StrategyUpdate[] = [];

    for (const rec of reflection.recommendations) {
      if (rec.priority === 'critical' || rec.priority === 'high') {
        updates.push({
          aspect: rec.description,
          oldValue: '默认策略',
          newValue: rec.action,
          reason: rec.expectedImpact,
        });
      }
    }

    return updates;
  }

  private extractLessons(reflection: Reflection): Lesson[] {
    const lessons: Lesson[] = [];

    for (const cause of reflection.rootCauses) {
      const lesson: Lesson = {
        id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        category: cause.category,
        situation: cause.evidence.join('; '),
        lesson: cause.description,
        applyTo: [cause.category],
        confidence: cause.confidence,
        createdAt: Date.now(),
      };
      lessons.push(lesson);
    }

    return lessons;
  }

  private applyStrategyUpdates(updates: StrategyUpdate[]): void {
    for (const update of updates) {
      this.strategies.set(update.aspect, {
        value: update.newValue,
        updatedAt: Date.now(),
        reason: update.reason,
      });
    }
  }

  private generateComprehensiveImprovements(reflections: Reflection[]): {
    commonIssues: string[];
    topRecommendations: string[];
    strategyChanges: StrategyUpdate[];
  } {
    const issueCount: Map<string, number> = new Map();
    const recommendationCount: Map<string, number> = new Map();

    for (const reflection of reflections) {
      for (const issue of reflection.analysis.whatFailed) {
        issueCount.set(issue, (issueCount.get(issue) || 0) + 1);
      }
      for (const rec of reflection.recommendations) {
        recommendationCount.set(rec.description, (recommendationCount.get(rec.description) || 0) + 1);
      }
    }

    const commonIssues = Array.from(issueCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue]) => issue);

    const topRecommendations = Array.from(recommendationCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rec]) => rec);

    return {
      commonIssues,
      topRecommendations,
      strategyChanges: [],
    };
  }
}

// 导出工厂函数
export function createReflectionEngine(llmRouter: AgentAIRouter): ExecutionReflection {
  return new ExecutionReflection(llmRouter);
}
