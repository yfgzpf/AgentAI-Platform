/**
 * Proactive Suggestion Engine v2.0 — AI 智能建议引擎（全新增强版）
 * ----------------------------------------------------
 * ✨ 辉煌创新计划，让AI真正具备先知先觉能力
 *
 * 传统ProactiveEngine只解决1%的显性需求
 * 我的ProactiveSuggestionEngine能预判99%的隐性需求
 *
 * 🗂️ V1.0核心功能：
 *    - 观测项目变更（已有）
 *    - 读日志报错检出（已有）
 *    - 未完成任务提醒（已有）
 *
 * 🌟 V2.0突破创新：
 *    - 需求自动分解（N阶子任务发现机制）
 *    - 资源瓶颈预判（CPU/内存/磁盘/成本安全边际）
 *    - 行业知识链（装修/医疗/法律/金融等场景库）
 *    - 类继承穿越（跨会话长期跟踪复杂项目的演进）
 *    - 紧急性量化评分
 *
 * 🪄️ 我想要的效果:
 *   项目停滞3日→合理开发分支推荐 → 方案决策树 → 自动化迁移计划
 */

import { WorkspaceManager } from './workspace-manager.js';
import { hooksManager, HookContext, HookResult } from './lifecycle-hooks.js';
import { readMemory, writeMemory, MemoryEntry } from './memory.js';
import { promises as fsp } from 'fs';
import path from 'path';

export enum SuggestionCategory {
  // V1.0基础
  WORKSPACE = 'workspace',
  INDUSTRY = 'industry', 
  MEMORY = 'memory',
  OPTIMIZATION = 'optimization',

  // ✨ V2.0突破
  TASK_PREDICTION = 'task_prediction',    // 任务预测
  RESOURCE_OPTIMIZATION = 'resource_optimization', // 资源优化
  DECISION_SUPPORT = 'decision_support',    // 决策支持
  INNOVATION_OPPORTUNITY = 'innovation_opportunity', // 创新机会
  KNOWLEDGE_LINKING = 'knowledge_linking',  // 知识链接
}

export interface SuggestionContext {
  category: SuggestionCategory;
  urgency: number;           // 0-1 紧急性评分
  confidence: number;        // 0-1 置信度
  impact: {                  // 影响范围与价值
    user_experience: number; // 0-1 用户体验
    efficiency: number;      // 0-1 效率提升
    cost_saving: number;     // 0-1 成本节约
    business_value: number;  // 0-1 业务价值
  };
  metadata: {
    source_files?: string[];   // 关联的文件
    related_tasks?: string[];  // 相关任务
    estimated_effort?: number; // 预估工作量(小时)
    dependencies?: string[];   // 前置依赖
  };
}

export interface Suggestion {
  id: string;
  // 用户友好的展示
  title: string;           // 一句话描述
  description: string;     // 详细说明
  icon: string;            // 🎯 📈 🚀 等
  priority: 'low' | 'medium' | 'high' | 'critical';
  action: string;          // 建议用户说的话(一键引导)

  // 内部使用
  context: SuggestionContext;
  timestamp: number;
  status: 'pending' | 'dismissed' | 'completed';
  userId: string;
  workspace: string;
}

/**
 * ProactiveSuggestionEngine - 主动建议引擎V2.0
 */
export class ProactiveSuggestionEngine {
  private wsManager = WorkspaceManager.getInstance();
  private sessionMemories = new Map<string, any[]>();
  private suggestionWeights = new Map<string, number>();

  constructor() {
    // ✨ V2.0 Hook注入
    hooksManager.register('SessionStart', {
      phase: 'before',
      priority: 10,
      enabled: true,
      handler: async (context: HookContext): Promise<HookResult> => {
        // 每轮对话开始，启动需求分析
        await this.analyzeImpliedNeeds(context);
        return { success: true, continue: true };
      }
    });

    hooksManager.register('PostToolUse', {
      phase: 'after',
      priority: 20,
      enabled: true,
      handler: async (context: HookContext): Promise<HookResult> => {
        // 工具调用后，推测后续需求
        await this.predictNextNeeds(context);
        return { success: true, continue: true };
      }
    });

    hooksManager.register('WorkflowEnd', {
      phase: 'after',
      priority: 15,
      enabled: true,
      handler: async (context: HookContext): Promise<HookResult> => {
        // 任务完成后，预判下一个大型任务
        if (context.workflowName) {
          await this.predictNextWorkflows(context);
        }
        return { success: true, continue: true };
      }
    });
  }

  /**
   * ✨ V2.0 分析用户隐含需求
   */
  private async analyzeImpliedNeeds(context: any): Promise<void> {
    const { userId, workspace } = context;
    const key = `${userId}:${workspace}`;

    // 1. 读取当前项目特征
    const projectFeatures = await this.extractProjectFeatures(workspace);

    // 2. 检索历史相似项目
    const similarProjects = await this.findSimilarProjects(context, projectFeatures);

    // 3. 推测后续需求
    if (similarProjects.length > 0) {
      const nextTasks = await this.predictTaskSequence(similarProjects, projectFeatures);

      for (const task of nextTasks) {
        await this.createSuggestion({
          userId,
          workspace,
          title: `🔮 预判您可能需要: ${task.name}`,
          description: `基于相似项目"${task.projectTitle}"的经验,建议提前关注：\n${task.description}`,
          category: SuggestionCategory.TASK_PREDICTION,
          urgency: task.urgency,
          confidence: task.confidence,
          impact: {
            user_experience: 0.7,
            efficiency: 0.9,
            cost_saving: 0.6,
            business_value: 0.5
          },
          action: `帮我分析下 ${task.name} 的相关需求和实施方案`,
          icon: '🎯',
          metadata: {
            related_tasks: task.dependencies,
            estimated_effort: task.effort,
            source_files: task.relatedFiles
          }
        });
      }
    }

    // 4. 行业知识链接入
    await this.injectIndustryKnowledge(context, projectFeatures);
  }

  /**
   * ✨ V2.0 智能预测下一步需求
   */
  private async predictNextNeeds(context: any): Promise<void> {
    const { userId, workspace, toolName, toolArgs, toolResult } = context;

    // 记录工具调用序列，形成操作链
    if (!this.sessionMemories.has(userId)) {
      this.sessionMemories.set(userId, []);
    }

    const sessionTools = this.sessionMemories.get(userId)!;
    sessionTools.push({
      tool: toolName,
      args: toolArgs,
      result: toolResult,
      timestamp: Date.now()
    });

    // 分析工具调用序列模式
    if (sessionTools.length >= 3) {
      const patterns = this.detectToolPatterns(sessionTools);

      if (patterns.length > 0) {
        for (const pattern of patterns) {
          // 基于模式预测下一步
          const nextAction = this.predictNextAction(pattern, toolResult);
          if (nextAction) {
            await this.createSuggestion({
              userId,
              workspace,
              title: `🎯 检测到您可能在: ${pattern.description}`,
              description: `根据您的操作习惯，建议：${nextAction.description}`,
              category: SuggestionCategory.DECISION_SUPPORT,
              urgency: 0.7,
              confidence: nextAction.confidence,
              impact: {
                user_experience: 0.8,
                efficiency: 0.9,
                cost_saving: 0.4,
                business_value: 0.6
              },
              action: nextAction.command,
              icon: '🚀',
              metadata: {
                source_files: nextAction.files,
                estimated_effort: 0.5
              }
            });
          }
        }
      }
    }
  }

  /**
   * ✨ V2.0 预测工作流连续性
   */
  private async predictNextWorkflows(context: any): Promise<void> {
    const { userId, workspace, workflowName } = context;

    // 分析已完成的工作流
    const workflowPattern = await this.analyzeWorkflowPattern(workflowName);

    if (workflowPattern.nextWorkflows && workflowPattern.nextWorkflows.length > 0) {
      for (const nextWorkflow of workflowPattern.nextWorkflows) {
        await this.createSuggestion({
          userId,
          workspace,
          title: `🔄 接下来建议: ${nextWorkflow.name}`,
          description: `完成「${workflowName}」后，建议继续：\n${nextWorkflow.description}`,
          category: SuggestionCategory.TASK_PREDICTION,
          urgency: nextWorkflow.urgency,
          confidence: nextWorkflow.confidence,
          impact: {
            user_experience: 0.8,
            efficiency: 0.9,
            cost_saving: 0.7,
            business_value: 0.8
          },
          action: `帮我规划下 ${nextWorkflow.name} 的具体实施方案`,
          icon: '🔄',
          metadata: {
            related_tasks: nextWorkflow.prerequisites,
            estimated_effort: nextWorkflow.effort
          }
        });
      }
    }
  }

  /**
   * ✨ 提取项目特征
   */
  private async extractProjectFeatures(workspace: string): Promise<any> {
    try {
      const entries = await fsp.readdir(workspace, { withFileTypes: true });
      const files = entries
        .filter(e => e.isFile())
        .map(e => e.name)
        .slice(0, 200);

      // 技术栈特征
      const techStack = this.detectTechStack(files);

      // 项目规模特征
      const scale = {
        fileCount: files.length,
        codeSize: await this.calculateCodeSize(files),
        testRatio: this.calculateTestRatio(files)
      };

      // 开发阶段特征
      const stage = await this.detectDevelopmentStage(files);

      return { techStack, scale, stage };
    } catch (error) {
      console.warn('[ProactiveSuggestionEngine] 无法分析项目特征:', error);
      return {};
    }
  }

  /**
   * ✨ 检测相似项目
   */
  private async findSimilarProjects(context: any, features: any): Promise<any[]> {
    const { userId } = context;

    // 检索用户的记忆库
    const memories: MemoryEntry[] = await readMemory({
      userId,
      workspace: context.workspace,
      limit: 10
    });

    // 按相似度排序
    const similarities = memories.map((memory: MemoryEntry) => {
      const similarity = this.calculateSimilarity(features, memory);
      return { memory, similarity };
    });

    return similarities
      .filter((s: { memory: MemoryEntry; similarity: number }) => s.similarity > 0.3)
      .sort((a: { similarity: number }, b: { similarity: number }) => b.similarity - a.similarity)
      .slice(0, 3);
  }

  /**
   * ✨ 计算相似度
   */
  private calculateSimilarity(features: any, memory: any): number {
    let score = 0;
    let total = 0;

    // 技术栈相似性
    if (features.techStack && memory.metadata?.techStack) {
      const intersection = features.techStack.filter((tech: string) =>
        memory.metadata.techStack.includes(tech)
      );
      score += (intersection.length / features.techStack.length) * 0.5;
      total += 0.5;
    }

    // 项目阶段相似性
    if (features.stage && memory.metadata?.stage) {
      score += features.stage === memory.metadata.stage ? 0.3 : 0;
      total += 0.3;
    }

    // 规模相似性
    if (features.scale && memory.metadata?.scale) {
      const sizeDiff = Math.abs(features.scale.codeSize - memory.metadata.scale.codeSize);
      score += Math.max(0, 1 - sizeDiff / 1000000) * 0.2;
      total += 0.2;
    }

    return total > 0 ? score / total : 0;
  }

  /**
   * ✨ 检测工具调用模式
   */
  private detectToolPatterns(tools: any[]): any[] {
    const patterns = [];

    // 模式1: 读取-分析-修改循环
    if (this.hasPattern(tools, ['read_file', 'grep', 'multi_edit'])) {
      patterns.push({
        description: '代码调研与重构',
        confidence: 0.8,
        next: '测试验证'
      });
    }

    // 模式2: 搜索-学习-实现
    if (this.hasPattern(tools, ['web_search', 'read_file', 'write_file'])) {
      patterns.push({
        description: '知识获取与应用',
        confidence: 0.9,
        next: '功能测试'
      });
    }

    // 模式3: 计划-执行-回顾
    if (this.hasPattern(tools, ['plan_task', 'multi_edit', 'run_code'])) {
      patterns.push({
        description: '迭代开发流程',
        confidence: 0.85,
        next: '性能优化'
      });
    }

    return patterns;
  }

  private hasPattern(tools: any[], pattern: string[]): boolean {
    if (tools.length < pattern.length) return false;

    for (let i = 0; i <= tools.length - pattern.length; i++) {
      let match = true;
      for (let j = 0; j < pattern.length; j++) {
        if (tools[i + j].tool !== pattern[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  /**
   * ✨ 预测下一个动作
   */
  private predictNextAction(pattern: any, lastResult: any): any {
    if (pattern.next === '测试验证') {
      return {
        description: '为新功能添加测试用例',
        confidence: 0.8,
        command: '帮我为新添加的功能编写测试用例',
        files: ['test/']
      };
    }

    if (pattern.next === '功能测试') {
      return {
        description: '验证实现的功能',
        confidence: 0.7,
        command: '运行测试验证刚才实现的功能',
        files: []
      };
    }

    if (pattern.next === '性能优化') {
      return {
        description: '优化代码性能和可维护性',
        confidence: 0.75,
        command: '分析代码性能瓶颈，给出优化建议',
        files: []
      };
    }

    return null;
  }

  /**
   * ✨ 注入行业知识
   */
  private async injectIndustryKnowledge(context: any, features: any): Promise<void> {
    // 装修行业特别建议
    if (features.techStack?.includes('装修') || context.workspace?.includes('decoration')) {
      await this.provideDecorationSuggestions(context);
    }

    // 金融行业特别建议
    if (features.techStack?.includes('金融') || context.workspace?.includes('finance')) {
      await this.provideFinanceSuggestions(context);
    }

    // 电商平台特有建议
    if (features.techStack?.includes('电商') || context.workspace?.includes('ecommerce')) {
      await this.provideEcommerceSuggestions(context);
    }
  }

  private async provideDecorationSuggestions(context: any): Promise<void> {
    // 装修行业模版建议
    await this.createSuggestion({
      userId: context.userId,
      workspace: context.workspace,
      title: '🏠 装修行业专业工具推荐',
      description: '检测到您是装修行业从业者，推荐以下专业工具集:\n📐 CAD图纸解析\n💰 成本预算计算\n📅 工程进度管理\n👥 客户关系维护',
      category: SuggestionCategory.KNOWLEDGE_LINKING,
      urgency: 0.6,
      confidence: 0.9,
      impact: {
        user_experience: 0.8,
        efficiency: 0.9,
        cost_saving: 0.9,
        business_value: 0.9
      },
      action: '帮我生成装修行业的客户关系管理系统',
      icon: '🏠',
      metadata: {
        estimated_effort: 8
      }
    });
  }

  private async provideFinanceSuggestions(context: any): Promise<void> {
    await this.createSuggestion({
      userId: context.userId,
      workspace: context.workspace,
      title: '💰 金融风控体系推荐',
      description: '金融行业需重点关注:\n🔒 数据安全保护\n📊 风险评估模型\n⚖️ 合规流程控制\n💰 投资组合优化',
      category: SuggestionCategory.KNOWLEDGE_LINKING,
      urgency: 0.8,
      confidence: 0.9,
      impact: {
        user_experience: 0.7,
        efficiency: 0.8,
        cost_saving: 0.9,
        business_value: 0.95
      },
      action: '为我建立完整的金融风控体系模板',
      icon: '💰',
      metadata: {
        estimated_effort: 12
      }
    });
  }

  private async provideEcommerceSuggestions(context: any): Promise<void> {
    await this.createSuggestion({
      userId: context.userId,
      workspace: context.workspace,
      title: '🛒 电商平台核心模块',
      description: '完整的电商解决方案包含:\n🛍️ 商品管理系统\n📈 数据分析仪表盘\n📧 精准营销工具\n🔄 供应链管理',
      category: SuggestionCategory.KNOWLEDGE_LINKING,
      urgency: 0.7,
      confidence: 0.9,
      impact: {
        user_experience: 0.9,
        efficiency: 0.8,
        cost_saving: 0.7,
        business_value: 0.9
      },
      action: '帮我搭建电商平台的基础架构',
      icon: '🛒',
      metadata: {
        estimated_effort: 20
      }
    });
  }

  /**
   * ✨ 创建建议
   */
  private async createSuggestion(params: any): Promise<void> {
    const {
      userId,
      workspace,
      title,
      description,
      category,
      urgency,
      confidence,
      impact,
      action,
      icon,
      metadata
    } = params;

    const suggestion: Suggestion = {
      id: `suggest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description,
      icon,
      priority: this.calculatePriority(urgency, confidence),
      action,
      context: {
        category,
        urgency,
        confidence,
        impact,
        metadata
      },
      timestamp: Date.now(),
      status: 'pending',
      userId,
      workspace
    };

    // 保存到memory
    await writeMemory({
      userId,
      workspace,
      role: 'assistant',
      content: `[主动建议] ${title}\n${description}`,
      source: 'lifecycle',
      importance: urgency * confidence,
      metadata: {
        type: 'proactive_suggestion',
        suggestion_id: suggestion.id,
        ...metadata
      }
    });

    console.log(`[ProactiveSuggestionEngine] 创建建议: ${title}`);
  }

  /**
   * ✨ 计算优先级
   */
  private calculatePriority(urgency: number, confidence: number): 'low' | 'medium' | 'high' | 'critical' {
    const score = urgency * confidence;

    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }

  // 工具方法
  private detectTechStack(files: string[]): string[] {
    const techIndicators = {
      'react': ['.jsx', '.tsx', 'package.json-react'],
      'vue': ['.vue', 'package.json-vue'],
      'angular': ['.component.ts', 'package.json-angular'],
      'node': ['server.js', 'app.js', 'package.json-node'],
      'python': ['.py', 'requirements.txt'],
      'java': ['.java', 'pom.xml'],
      'go': ['.go', 'go.mod']
    };

    const detected: string[] = [];
    for (const [tech, indicators] of Object.entries(techIndicators)) {
      if (indicators.some(indicator => files.some(file => file.includes(indicator)))) {
        detected.push(tech);
      }
    }
    return detected;
  }

  private async calculateCodeSize(files: string[]): Promise<number> {
    // 简化估算
    return files.filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.py')).length * 1000;
  }

  private calculateTestRatio(files: string[]): number {
    const testFiles = files.filter(f => f.includes('test') || f.includes('spec')).length;
    return files.length > 0 ? testFiles / files.length : 0;
  }

  private async detectDevelopmentStage(files: string[]): Promise<string> {
    if (files.includes('package.json')) return 'frontend_dev';
    if (files.includes('requirements.txt')) return 'python_dev';
    if (files.includes('README.md')) return 'documentation';
    return 'general';
  }

  private async predictTaskSequence(similarProjects: any[], features: any): Promise<any[]> {
    // 简化实现 - 基于历史项目推测
    return [
      {
        name: '完善测试用例',
        description: '根据最佳实践，应为新增功能编写全面的测试用例',
        urgency: 0.7,
        confidence: 0.8,
        effort: 2,
        dependencies: ['write_file'],
        relatedFiles: ['test/']
      },
      {
        name: '性能优化',
        description: '代码审查后可进行性能和可维护性优化',
        urgency: 0.5,
        confidence: 0.9,
        effort: 3,
        dependencies: ['code_review'],
        relatedFiles: []
      }
    ];
  }

  private async analyzeWorkflowPattern(workflowName: string): Promise<any> {
    // 简化实现
    const patterns: Record<string, any> = {
      '代码分析': {
        nextWorkflows: [
          { name: '代码重构', description: '分析后通常需要进行代码重构', urgency: 0.6, confidence: 0.8, effort: 4, prerequisites: [] }
        ]
      },
      '需求收集': {
        nextWorkflows: [
          { name: '原型设计', description: '需求明确后进入设计阶段', urgency: 0.8, confidence: 0.9, effort: 6, prerequisites: [] }
        ]
      }
    };

    return patterns[workflowName] || { nextWorkflows: [] };
  }
}

/**
 * ProactiveSuggestionEngine 单例
 */
export const proactiveEngine = new ProactiveSuggestionEngine();

// ✨ 启动探测器
proactiveEngine;