/**
 * Autonomous Goal Engine - 自主目标引擎
 * 
 * 世界级AI核心能力：
 * 1. 从模糊输入提取结构化目标
 * 2. 目标分解为可执行任务树
 * 3. 动态优先级调整
 * 4. 目标完成度评估
 * 
 * 这是超越级AI的基础，让AI从"被动执行"进化为"主动目标驱动"
 */

import { EventEmitter } from 'events';
import { AgentAIRouter } from './llm-router.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface Goal {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'active' | 'completed' | 'failed';
  constraints: Constraint[];
  successCriteria: string[];
  subGoals?: Goal[];
  metadata: {
    createdAt: number;
    estimatedDuration?: number;
    domain?: string;
    tags: string[];
  };
}

export interface Constraint {
  type: 'time' | 'resource' | 'quality' | 'dependency';
  description: string;
  value?: any;
}

export interface TaskTree {
  root: TaskNode;
  nodes: Map<string, TaskNode>;
}

export interface TaskNode {
  id: string;
  goalId: string;
  title: string;
  description: string;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'blocked';
  dependencies: string[]; // 依赖的其他任务ID
  estimatedDuration: number; // 毫秒
  actualDuration?: number;
  priority: number; // 0-100
  action?: Action;
}

export interface Action {
  type: 'skill' | 'tool' | 'code' | 'ask_user' | 'delegate';
  name: string;
  params: Record<string, any>;
}

export interface Progress {
  goalId: string;
  percentage: number; // 0-100
  completedTasks: number;
  totalTasks: number;
  estimatedRemainingTime: number;
  blockers: string[];
  risks: Risk[];
}

export interface Risk {
  type: 'technical' | 'resource' | 'time' | 'external' | 'dependency';
  description: string;
  probability: number; // 0-1
  impact: number; // 0-1
  mitigation?: string;
}

// ═══════════════════════════════════════════════════════════
// 自主目标引擎核心类
// ═══════════════════════════════════════════════════════════

export class AutonomousGoalEngine extends EventEmitter {
  private goals: Map<string, Goal> = new Map();
  private taskTrees: Map<string, TaskTree> = new Map();
  private llmRouter: AgentAIRouter;

  constructor(llmRouter: AgentAIRouter) {
    super();
    this.llmRouter = llmRouter;
  }

  /**
   * 从模糊输入提取结构化目标
   * 
   * 示例:
   * 输入: "帮我做个装修报价系统，要能自动识别CAD图纸，生成Excel报价单"
   * 输出: [
   *   { title: "开发装修报价系统", priority: "high", ... },
   *   { title: "实现CAD图纸识别", priority: "high", ... },
   *   { title: "生成Excel报价单", priority: "high", ... }
   * ]
   */
  async extractGoals(fuzzyInput: string): Promise<Goal[]> {
    console.log(`[GoalEngine] 提取目标: "${fuzzyInput.slice(0, 100)}..."`);

    const prompt = `你是一个专业的目标分析专家。请分析用户的输入，提取结构化目标。

用户输入: "${fuzzyInput}"

请分析并提取：
1. 主要目标（1-3个）
2. 每个目标的优先级（critical/high/medium/low）
3. 约束条件（时间、资源、质量等）
4. 成功标准（如何算完成）
5. 相关领域和标签

输出JSON格式：
{
  "goals": [
    {
      "title": "目标标题",
      "description": "详细描述",
      "priority": "high",
      "constraints": [
        {"type": "time", "description": "2周内完成"}
      ],
      "successCriteria": ["标准1", "标准2"],
      "domain": "装修行业",
      "tags": ["报价", "CAD"]
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

      // 提取JSON
      const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || 
                       content.match(/\{[\s\S]*\}/);
      
      if (!jsonMatch) {
        throw new Error('无法从LLM响应中提取JSON');
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      const goals = this.parseGoals(parsed.goals || parsed);

      // 存储目标
      for (const goal of goals) {
        this.goals.set(goal.id, goal);
      }

      console.log(`[GoalEngine] 提取了 ${goals.length} 个目标`);
      this.emit('goals:extracted', { input: fuzzyInput, goals });

      return goals;
    } catch (error: any) {
      console.error('[GoalEngine] 目标提取失败:', error.message);
      // 降级到简单提取
      return this.fallbackGoalExtraction(fuzzyInput);
    }
  }

  /**
   * 目标分解为任务树
   * 
   * 将高层目标分解为可执行的具体任务，建立依赖关系
   */
  async decomposeGoal(goal: Goal): Promise<TaskTree> {
    console.log(`[GoalEngine] 分解目标: ${goal.title}`);

    const prompt = `你是一个专业的任务规划专家。请将目标分解为可执行的任务树。

目标: ${goal.title}
描述: ${goal.description}
约束: ${JSON.stringify(goal.constraints)}

请分解为任务树，考虑：
1. 任务之间的依赖关系
2. 每个任务的预估耗时
3. 任务优先级
4. 执行顺序

输出JSON格式：
{
  "tasks": [
    {
      "id": "task-1",
      "title": "任务标题",
      "description": "详细描述",
      "dependencies": [], // 依赖的任务ID
      "estimatedDuration": 3600000, // 毫秒
      "priority": 80, // 0-100
      "action": {
        "type": "skill",
        "name": "skill-name",
        "params": {}
      }
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
        throw new Error('无法从LLM响应中提取JSON');
      }

      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      const taskTree = this.buildTaskTree(goal.id, parsed.tasks || parsed);

      this.taskTrees.set(goal.id, taskTree);
      console.log(`[GoalEngine] 生成了 ${taskTree.nodes.size} 个任务`);
      this.emit('goal:decomposed', { goalId: goal.id, taskTree });

      return taskTree;
    } catch (error: any) {
      console.error('[GoalEngine] 目标分解失败:', error.message);
      // 降级到简单分解
      return this.fallbackDecomposition(goal);
    }
  }

  /**
   * 动态优先级调整
   * 
   * 根据执行情况和环境变化，动态调整任务优先级
   */
  async adjustPriorities(context: {
    completedTasks: string[];
    failedTasks: string[];
    blockedTasks: string[];
    timeElapsed: number;
    timeRemaining?: number;
  }): Promise<void> {
    console.log('[GoalEngine] 调整优先级...');

    for (const [goalId, taskTree] of this.taskTrees) {
      let adjusted = false;

      for (const [taskId, node] of taskTree.nodes) {
        // 如果依赖的任务失败，降低优先级或标记为阻塞
        const failedDeps = node.dependencies.filter(dep => 
          context.failedTasks.includes(dep)
        );
        
        if (failedDeps.length > 0) {
          node.status = 'blocked';
          node.priority = Math.max(0, node.priority - 20);
          adjusted = true;
          console.log(`[GoalEngine] 任务 ${taskId} 因依赖失败降级`);
        }

        // 如果时间紧迫，提升关键路径任务优先级
        if (context.timeRemaining && context.timeRemaining < 3600000) {
          if (node.dependencies.length === 0 || 
              node.dependencies.every(dep => context.completedTasks.includes(dep))) {
            node.priority = Math.min(100, node.priority + 10);
            adjusted = true;
          }
        }
      }

      if (adjusted) {
        this.emit('priorities:adjusted', { goalId, taskTree });
      }
    }
  }

  /**
   * 目标完成度评估
   */
  async evaluateProgress(goalId: string): Promise<Progress> {
    const goal = this.goals.get(goalId);
    const taskTree = this.taskTrees.get(goalId);

    if (!goal || !taskTree) {
      throw new Error(`目标不存在: ${goalId}`);
    }

    const nodes = Array.from(taskTree.nodes.values());
    const completedTasks = nodes.filter(n => n.status === 'completed');
    const failedTasks = nodes.filter(n => n.status === 'failed');
    const blockedTasks = nodes.filter(n => n.status === 'blocked');

    const totalTasks = nodes.length;
    const completedCount = completedTasks.length;
    const percentage = totalTasks > 0 ? (completedCount / totalTasks) * 100 : 0;

    // 计算预估剩余时间
    const remainingTasks = nodes.filter(n => 
      n.status === 'pending' || n.status === 'ready' || n.status === 'running'
    );
    const estimatedRemainingTime = remainingTasks.reduce(
      (sum, task) => sum + task.estimatedDuration, 
      0
    );

    // 识别风险
    const risks: Risk[] = [];
    
    if (failedTasks.length > 0) {
      risks.push({
        type: 'technical',
        description: `${failedTasks.length}个任务失败`,
        probability: 0.7,
        impact: 0.8,
      });
    }

    if (blockedTasks.length > 0) {
      risks.push({
        type: 'external',
        description: `${blockedTasks.length}个任务被阻塞`,
        probability: 0.6,
        impact: 0.6,
      });
    }

    const progress: Progress = {
      goalId,
      percentage,
      completedTasks: completedCount,
      totalTasks,
      estimatedRemainingTime,
      blockers: blockedTasks.map(t => t.title),
      risks,
    };

    this.emit('progress:evaluated', progress);
    return progress;
  }

  /**
   * 获取下一个可执行任务
   */
  getNextReadyTask(goalId: string): TaskNode | null {
    const taskTree = this.taskTrees.get(goalId);
    if (!taskTree) return null;

    const readyTasks = Array.from(taskTree.nodes.values())
      .filter(node => {
        // 状态为pending或ready
        if (node.status !== 'pending' && node.status !== 'ready') return false;
        
        // 所有依赖都已完成
        return node.dependencies.every(depId => {
          const dep = taskTree.nodes.get(depId);
          return dep?.status === 'completed';
        });
      })
      .sort((a, b) => b.priority - a.priority); // 按优先级排序

    return readyTasks[0] || null;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(goalId: string, taskId: string, status: TaskNode['status'], actualDuration?: number): void {
    const taskTree = this.taskTrees.get(goalId);
    if (!taskTree) return;

    const node = taskTree.nodes.get(taskId);
    if (node) {
      node.status = status;
      if (actualDuration) {
        node.actualDuration = actualDuration;
      }
      
      this.emit('task:updated', { goalId, taskId, status });

      // 如果任务完成，检查是否可以解锁后续任务
      if (status === 'completed') {
        this.unlockDependentTasks(goalId, taskId);
      }
    }
  }

  /**
   * 获取所有目标
   */
  getAllGoals(): Goal[] {
    return Array.from(this.goals.values());
  }

  /**
   * 获取目标详情
   */
  getGoal(goalId: string): Goal | undefined {
    return this.goals.get(goalId);
  }

  /**
   * 获取任务树
   */
  getTaskTree(goalId: string): TaskTree | undefined {
    return this.taskTrees.get(goalId);
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private parseGoals(data: any[]): Goal[] {
    return data.map((g, index) => ({
      id: `goal-${Date.now()}-${index}`,
      title: g.title || '未命名目标',
      description: g.description || '',
      priority: g.priority || 'medium',
      status: 'pending',
      constraints: g.constraints || [],
      successCriteria: g.successCriteria || [],
      metadata: {
        createdAt: Date.now(),
        domain: g.domain,
        tags: g.tags || [],
      },
    }));
  }

  private buildTaskTree(goalId: string, tasks: any[]): TaskTree {
    const nodes = new Map<string, TaskNode>();
    
    for (const t of tasks) {
      const node: TaskNode = {
        id: t.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        goalId,
        title: t.title || '未命名任务',
        description: t.description || '',
        status: 'pending',
        dependencies: t.dependencies || [],
        estimatedDuration: t.estimatedDuration || 3600000,
        priority: t.priority || 50,
        action: t.action,
      };
      nodes.set(node.id, node);
    }

    // 找到根任务（没有依赖的任务）
    const rootNode = Array.from(nodes.values())
      .find(n => n.dependencies.length === 0) || nodes.values().next().value;

    if (!rootNode) {
      throw new Error('无法构建任务树：没有根任务');
    }

    return {
      root: rootNode,
      nodes,
    };
  }

  private unlockDependentTasks(goalId: string, completedTaskId: string): void {
    const taskTree = this.taskTrees.get(goalId);
    if (!taskTree) return;

    for (const [taskId, node] of taskTree.nodes) {
      if (node.dependencies.includes(completedTaskId)) {
        // 检查是否所有依赖都已完成
        const allDepsCompleted = node.dependencies.every(depId => {
          const dep = taskTree.nodes.get(depId);
          return dep?.status === 'completed';
        });

        if (allDepsCompleted && node.status === 'pending') {
          node.status = 'ready';
          this.emit('task:ready', { goalId, taskId });
        }
      }
    }
  }

  private fallbackGoalExtraction(input: string): Goal[] {
    // 简单关键词提取
    const keywords = input.match(/[\u4e00-\u9fa5]{2,}/g) || [];
    const mainKeyword = keywords[0] || '任务';

    return [{
      id: `goal-${Date.now()}`,
      title: `处理: ${mainKeyword}`,
      description: input,
      priority: 'medium',
      status: 'pending',
      constraints: [],
      successCriteria: ['完成用户请求'],
      metadata: {
        createdAt: Date.now(),
        tags: keywords.slice(0, 5),
      },
    }];
  }

  private fallbackDecomposition(goal: Goal): TaskTree {
    // 简单分解为3个步骤
    const tasks: TaskNode[] = [
      {
        id: `task-${Date.now()}-1`,
        goalId: goal.id,
        title: '分析需求',
        description: '理解用户目标和约束',
        status: 'ready',
        dependencies: [],
        estimatedDuration: 600000,
        priority: 100,
      },
      {
        id: `task-${Date.now()}-2`,
        goalId: goal.id,
        title: '执行核心任务',
        description: goal.description,
        status: 'pending',
        dependencies: [`task-${Date.now()}-1`],
        estimatedDuration: 3600000,
        priority: 90,
      },
      {
        id: `task-${Date.now()}-3`,
        goalId: goal.id,
        title: '验证结果',
        description: '检查是否满足成功标准',
        status: 'pending',
        dependencies: [`task-${Date.now()}-2`],
        estimatedDuration: 300000,
        priority: 80,
      },
    ];

    const nodes = new Map<string, TaskNode>();
    for (const task of tasks) {
      nodes.set(task.id, task);
    }

    return {
      root: tasks[0],
      nodes,
    };
  }
}

// 导出工厂函数
export function createGoalEngine(llmRouter: AgentAIRouter): AutonomousGoalEngine {
  return new AutonomousGoalEngine(llmRouter);
}
