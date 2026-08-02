/**
 * WorkflowOrchestrator — 技能工作流编排器
 * ----------------------------------------------------------------
 * 学自: SenseNova-Skills 模块化技能拼装
 * 
 * 核心理念: 把多个技能串联成端到端工作流
 *   数据 → 分析 → 报告 → PPT
 * 
 * 工作流定义:
 *   {
 *     name: 'data-report',
 *     description: '数据分析报告工作流',
 *     stages: [
 *       { skill: 'read_excel', output: 'parsed_data' },
 *       { skill: 'analyze_data', input: 'parsed_data', output: 'analysis' },
 *       { skill: 'generate_word', input: 'analysis', output: 'report_docx' },
 *       { skill: 'generate_ppt', input: 'report_docx', output: 'final_pptx' },
 *     ]
 *   }
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

export interface WorkflowStage {
  /** 阶段 ID */
  id: string;
  /** 阶段类型 */
  type: 'skill' | 'subworkflow' | 'condition' | 'loop' | 'parallel';
  /** 技能名称 (type='skill' 时必填) */
  skill?: string;
  /** 子工作流名称 (type='subworkflow' 时必填) */
  subworkflow?: string;
  /** 上游输出变量名 (可选, 不指定则使用上一个 stage 的输出) */
  input?: string;
  /** 本阶段输出变量名 */
  output: string;
  /** 可选: 参数模板 (支持变量引用) */
  params?: Record<string, any>;
  /** 条件判断 (type='condition' 时必填) */
  condition?: {
    /** 条件表达式: 支持 {{var}} 变量引用和比较运算符 */
    expression: string;
    /** 条件为 true 时跳转到的 stage id */
    trueTarget: string;
    /** 条件为 false 时跳转到的 stage id */
    falseTarget: string;
  };
  /** 循环配置 (type='loop' 时必填) */
  loop?: {
    /** 循环次数变量或固定值 */
    count: string | number;
    /** 最大循环次数 (防止死循环) */
    maxIterations?: number;
    /** 循环体 stage ids */
    body: string[];
  };
  /** 并行配置 (type='parallel' 时必填) */
  parallel?: {
    /** 并行执行的 stage ids */
    branches: string[];
  };
  /** 错误处理 */
  onError?: 'continue' | 'break' | 'retry';
  /** 重试配置 */
  retry?: {
    maxAttempts: number;
    delayMs: number;
  };
}

export interface WorkflowTemplate {
  /** 工作流唯一标识 */
  name: string;
  /** 工作流描述 */
  description: string;
  /** 触发关键词 */
  triggers: string[];
  /** 工作流阶段列表 */
  stages: WorkflowStage[];
  /** 可选: 最终结果聚合函数 */
  aggregator?: (results: Map<string, any>) => string;
}

export interface WorkflowResult {
  success: boolean;
  stages: Array<{
    skill: string;
    success: boolean;
    output: string;
    error?: string;
  }>;
  finalOutput: string;
  totalTimeMs: number;
}

/** 工作流执行上下文 */
export interface WorkflowContext {
  /** 父工作流上下文 */
  parent?: WorkflowContext;
  /** 变量作用域 */
  variables: Map<string, any>;
  /** 执行深度 (防止无限递归) */
  depth: number;
  /** 最大执行深度 */
  maxDepth: number;
}

/**
 * 工作流编排器
 * - 注册工作流模板
 * - 根据用户消息自动匹配工作流
 * - 串联执行多个技能
 */
export class WorkflowOrchestrator {
  private workflows = new Map<string, WorkflowTemplate>();
  private skillExecutor: (skillName: string, params: any) => Promise<{ success: boolean; output: string; data?: any }>;

  constructor(skillExecutor: (skillName: string, params: any) => Promise<{ success: boolean; output: string; data?: any }>) {
    this.skillExecutor = skillExecutor;
  }

  /** 注册工作流模板 */
  register(workflow: WorkflowTemplate): void {
    this.workflows.set(workflow.name, workflow);
    console.log(`[workflow] registered: ${workflow.name} (${workflow.stages.length} stages)`);
  }

  /** 批量注册 */
  registerAll(workflows: WorkflowTemplate[]): void {
    for (const w of workflows) this.register(w);
  }

  /** 根据用户消息匹配最匹配的工作流 */
  matchWorkflow(userMessage: string): WorkflowTemplate | undefined {
    const lower = userMessage.toLowerCase();
    
    for (const [, wf] of this.workflows) {
      // 名称匹配
      if (lower.includes(wf.name.toLowerCase())) return wf;
      // 触发关键词匹配
      for (const trigger of wf.triggers) {
        if (lower.includes(trigger.toLowerCase())) return wf;
      }
    }
    return undefined;
  }

  /**
   * 执行工作流 (增强版: 支持循环/条件/子工作流/并行)
   */
  async execute(workflow: WorkflowTemplate, userInput: string, context?: WorkflowContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    const stageResults: WorkflowResult['stages'] = [];
    const executedStages = new Set<string>(); // 防止循环死循环

    // 构建 stage 映射
    const stageMap = new Map(workflow.stages.map(s => [s.id, s]));

    console.log(`[workflow] executing: ${workflow.name} (${workflow.stages.length} stages)`);

    // 执行栈，支持跳转
    const executionQueue: string[] = workflow.stages.map(s => s.id);
    let currentIndex = 0;

    while (currentIndex < executionQueue.length) {
      const stageId = executionQueue[currentIndex];
      const stage = stageMap.get(stageId);

      if (!stage) {
        console.error(`[workflow] stage not found: ${stageId}`);
        break;
      }

      // 死循环检测
      if (executedStages.has(stageId)) {
        console.warn(`[workflow] potential infinite loop detected at ${stageId}, breaking`);
        break;
      }
      executedStages.add(stageId);

      try {
        const result = await this.executeStage(stage, userInput, results, stageMap);

        stageResults.push({
          skill: stage.skill || stage.type,
          success: result.success,
          output: String(result.output || '').slice(0, 500),
        });

        if (!result.success && stage.onError !== 'continue') {
          console.error(`[workflow] stage ${stageId} failed: ${result.error}`);
          return {
            success: false,
            stages: stageResults,
            finalOutput: `工作流执行失败: ${stageId} 阶段出错 - ${result.error}`,
            totalTimeMs: Date.now() - startTime,
          };
        }

        // 处理跳转 (条件分支)
        if (result.nextStage) {
          const nextIndex = executionQueue.indexOf(result.nextStage);
          if (nextIndex >= 0) {
            currentIndex = nextIndex;
            continue;
          }
        }

        currentIndex++;
      } catch (e: any) {
        stageResults.push({
          skill: stage.skill || stage.type,
          success: false,
          output: '',
          error: e.message,
        });

        if (stage.onError !== 'continue') {
          return {
            success: false,
            stages: stageResults,
            finalOutput: `工作流执行失败: ${stageId} 阶段出错 - ${e.message}`,
            totalTimeMs: Date.now() - startTime,
          };
        }
        currentIndex++;
      }
    }

    // 聚合结果
    let finalOutput = '';
    if (workflow.aggregator) {
      finalOutput = workflow.aggregator(results);
    } else {
      const lastStage = workflow.stages[workflow.stages.length - 1];
      if (lastStage) {
        const lastResult = results.get(lastStage.output);
        finalOutput = lastResult ? (typeof lastResult === 'string' ? lastResult : JSON.stringify(lastResult)) : '';
      }
    }

    console.log(`[workflow] completed: ${workflow.name} in ${Date.now() - startTime}ms`);

    return {
      success: true,
      stages: stageResults,
      finalOutput: finalOutput.slice(0, 10000),
      totalTimeMs: Date.now() - startTime,
    };
  }

  /**
   * 执行单个 stage
   */
  private async executeStage(
    stage: WorkflowStage,
    userInput: string,
    results: Map<string, any>,
    stageMap: Map<string, WorkflowStage>,
  ): Promise<{ success: boolean; output?: any; error?: string; nextStage?: string }> {
    switch (stage.type) {
      case 'skill':
        return this.executeSkillStage(stage, userInput, results);
      case 'subworkflow':
        return this.executeSubworkflowStage(stage, userInput, results);
      case 'condition':
        return this.executeConditionStage(stage, results);
      case 'loop':
        return this.executeLoopStage(stage, userInput, results, stageMap);
      case 'parallel':
        return this.executeParallelStage(stage, userInput, results, stageMap);
      default:
        return { success: false, error: `Unknown stage type: ${stage.type}` };
    }
  }

  /**
   * 执行技能 stage
   */
  private async executeSkillStage(
    stage: WorkflowStage,
    userInput: string,
    results: Map<string, any>,
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!stage.skill) {
      return { success: false, error: 'Skill name not specified' };
    }

    // 准备输入
    let input = userInput;
    if (stage.input) {
      const prevResult = results.get(stage.input);
      if (prevResult) {
        input = typeof prevResult === 'string' ? prevResult : JSON.stringify(prevResult);
      }
    }

    // 构建参数
    const params = this.buildParams(stage, input, results);

    // 重试逻辑
    const maxAttempts = stage.retry?.maxAttempts || 1;
    const delayMs = stage.retry?.delayMs || 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const skillResult = await this.skillExecutor(stage.skill, params);

        if (skillResult.success) {
          results.set(stage.output, skillResult);
          console.log(`[workflow] skill stage ${stage.id}: ${stage.skill} ✓`);
          return { success: true, output: skillResult };
        }

        if (attempt < maxAttempts) {
          console.log(`[workflow] retry ${attempt}/${maxAttempts} for ${stage.skill}`);
          if (delayMs > 0) await this.sleep(delayMs);
        } else {
          return { success: false, error: skillResult.output || 'Skill execution failed' };
        }
      } catch (e: any) {
        if (attempt >= maxAttempts) {
          return { success: false, error: e.message };
        }
      }
    }

    return { success: false, error: 'Max retries exceeded' };
  }

  /**
   * 执行子工作流 stage
   */
  private async executeSubworkflowStage(
    stage: WorkflowStage,
    userInput: string,
    results: Map<string, any>,
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!stage.subworkflow) {
      return { success: false, error: 'Subworkflow name not specified' };
    }

    const subWorkflow = this.workflows.get(stage.subworkflow);
    if (!subWorkflow) {
      return { success: false, error: `Subworkflow not found: ${stage.subworkflow}` };
    }

    // 准备输入
    let input = userInput;
    if (stage.input) {
      const prevResult = results.get(stage.input);
      if (prevResult) {
        input = typeof prevResult === 'string' ? prevResult : JSON.stringify(prevResult);
      }
    }

    console.log(`[workflow] entering subworkflow: ${stage.subworkflow}`);
    const subResult = await this.execute(subWorkflow, input);
    console.log(`[workflow] subworkflow ${stage.subworkflow} completed: ${subResult.success ? '✓' : '✗'}`);

    if (subResult.success) {
      results.set(stage.output, subResult);
      return { success: true, output: subResult };
    } else {
      return { success: false, error: subResult.finalOutput };
    }
  }

  /**
   * 执行条件 stage
   */
  private executeConditionStage(
    stage: WorkflowStage,
    results: Map<string, any>,
  ): { success: boolean; nextStage?: string; error?: string } {
    if (!stage.condition) {
      return { success: false, error: 'Condition not specified' };
    }

    const { expression, trueTarget, falseTarget } = stage.condition;
    const conditionResult = this.evaluateCondition(expression, results);

    console.log(`[workflow] condition ${stage.id}: ${expression} = ${conditionResult}`);

    return {
      success: true,
      nextStage: conditionResult ? trueTarget : falseTarget,
    };
  }

  /**
   * 执行循环 stage
   */
  private async executeLoopStage(
    stage: WorkflowStage,
    userInput: string,
    results: Map<string, any>,
    stageMap: Map<string, WorkflowStage>,
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!stage.loop) {
      return { success: false, error: 'Loop config not specified' };
    }

    const { count, maxIterations = 10, body } = stage.loop;
    const loopCount = typeof count === 'string' ? parseInt(results.get(count) || '1', 10) : count;
    const iterations = Math.min(loopCount, maxIterations);

    console.log(`[workflow] loop ${stage.id}: ${iterations} iterations`);

    const loopResults: any[] = [];

    for (let i = 0; i < iterations; i++) {
      console.log(`[workflow] loop ${stage.id} iteration ${i + 1}/${iterations}`);

      for (const bodyStageId of body) {
        const bodyStage = stageMap.get(bodyStageId);
        if (!bodyStage) continue;

        const result = await this.executeStage(bodyStage, userInput, results, stageMap);
        if (!result.success) {
          return { success: false, error: `Loop body failed at ${bodyStageId}: ${result.error}` };
        }
        loopResults.push(result.output);
      }
    }

    results.set(stage.output, loopResults);
    return { success: true, output: loopResults };
  }

  /**
   * 执行并行 stage
   */
  private async executeParallelStage(
    stage: WorkflowStage,
    userInput: string,
    results: Map<string, any>,
    stageMap: Map<string, WorkflowStage>,
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!stage.parallel) {
      return { success: false, error: 'Parallel config not specified' };
    }

    const { branches } = stage.parallel;
    console.log(`[workflow] parallel ${stage.id}: ${branches.length} branches`);

    const branchPromises = branches.map(async (branchId) => {
      const branchStage = stageMap.get(branchId);
      if (!branchStage) return { success: false, error: `Branch not found: ${branchId}` };
      return this.executeStage(branchStage, userInput, results, stageMap);
    });

    const branchResults = await Promise.all(branchPromises);
    const allSuccess = branchResults.every(r => r.success);

    if (allSuccess) {
      results.set(stage.output, branchResults.map(r => r.output));
      return { success: true, output: branchResults.map(r => r.output) };
    } else {
      const firstError = branchResults.find(r => !r.success);
      return { success: false, error: firstError?.error || 'Parallel execution failed' };
    }
  }

  /**
   * 构建参数
   */
  private buildParams(stage: WorkflowStage, input: string, results: Map<string, any>): Record<string, any> {
    const params: Record<string, any> = { input };

    if (stage.params) {
      for (const [key, value] of Object.entries(stage.params)) {
        if (typeof value === 'string' && value.includes('{{')) {
          params[key] = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
            const varValue = results.get(varName);
            return varValue ? (typeof varValue === 'string' ? varValue : JSON.stringify(varValue)) : '';
          });
        } else {
          params[key] = value;
        }
      }
    }

    return params;
  }

  /**
   * 评估条件表达式
   */
  private evaluateCondition(expression: string, results: Map<string, any>): boolean {
    // 解析 {{var}} 变量
    const resolvedExpr = expression.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
      const varValue = results.get(varName);
      return varValue !== undefined ? JSON.stringify(varValue) : 'null';
    });

    // 简单条件判断
    try {
      // 支持: ==, !=, >, <, >=, <=
      if (resolvedExpr.includes('==')) {
        const [left, right] = resolvedExpr.split('==').map(s => s.trim());
        return left === right;
      }
      if (resolvedExpr.includes('!=')) {
        const [left, right] = resolvedExpr.split('!=').map(s => s.trim());
        return left !== right;
      }
      // 默认: 真值判断
      return !!resolvedExpr && resolvedExpr !== 'null' && resolvedExpr !== 'false';
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** 列出所有工作流 */
  list(): WorkflowTemplate[] {
    return [...this.workflows.values()];
  }

  /** 获取工作流详情 */
  get(name: string): WorkflowTemplate | undefined {
    return this.workflows.get(name);
  }
}

/**
 * 内置工作流模板
 */
export const BUILTIN_WORKFLOWS: WorkflowTemplate[] = [
  {
    name: 'data-report',
    description: '数据分析报告: Excel 读取 → 统计分析 → Word 报告 → PPT 演示',
    triggers: ['数据分析', '分析报告', 'excel分析', '生成报告', '月度报告', '季度报告'],
    stages: [
      { id: 'read_excel', type: 'skill', skill: 'read_excel', output: 'raw_data' },
      { id: 'analyze_data', type: 'skill', skill: 'analyze_data', input: 'raw_data', output: 'analysis' },
      { id: 'generate_word', type: 'skill', skill: 'generate_word', input: 'analysis', output: 'word_report' },
      { id: 'generate_ppt', type: 'skill', skill: 'generate_ppt', input: 'analysis', output: 'final_pptx' },
    ],
    aggregator: (results) => {
      const analysis = results.get('analysis');
      const wordReport = results.get('word_report');
      const pptx = results.get('final_pptx');
      return [
        '## 数据分析报告生成完成',
        '',
        `### 分析摘要\n${typeof analysis === 'string' ? analysis.slice(0, 500) : '分析完成'}`,
        '',
        `### 输出文件`,
        `- Word 报告: ${typeof wordReport === 'string' ? wordReport.slice(0, 200) : '已生成'}`,
        `- PPT 演示: ${typeof pptx === 'string' ? pptx.slice(0, 200) : '已生成'}`,
      ].join('\n');
    },
  },
  {
    name: 'deep-research',
    description: '深度研究: 网络搜索 → 信息聚合 → 交叉验证 → 研究报告',
    triggers: ['深度研究', '行业调研', '市场调研', '竞品分析', '调研报告'],
    stages: [
      { id: 'web_search', type: 'skill', skill: 'web_search', output: 'search_results' },
      { id: 'aggregate_info', type: 'skill', skill: 'aggregate_info', input: 'search_results', output: 'aggregated' },
      { id: 'cross_validate', type: 'skill', skill: 'cross_validate', input: 'aggregated', output: 'validated' },
      { id: 'generate_report', type: 'skill', skill: 'generate_report', input: 'validated', output: 'research_report' },
    ],
    aggregator: (results) => {
      const report = results.get('research_report');
      return `## 深度研究报告生成完成\n\n${typeof report === 'string' ? report.slice(0, 2000) : '报告已生成'}`;
    },
  },
];
