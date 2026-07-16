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
  /** 技能名称 */
  skill: string;
  /** 上游输出变量名 (可选, 不指定则使用上一个 stage 的输出) */
  input?: string;
  /** 本阶段输出变量名 */
  output: string;
  /** 可选: 参数模板 (支持变量引用) */
  params?: Record<string, any>;
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
   * 执行工作流
   * 串联执行所有 stage, 上一个 stage 的输出作为下一个的输入
   */
  async execute(workflow: WorkflowTemplate, userInput: string): Promise<WorkflowResult> {
    const startTime = Date.now();
    const results = new Map<string, any>();
    const stageResults: WorkflowResult['stages'] = [];

    console.log(`[workflow] executing: ${workflow.name}`);

    for (let i = 0; i < workflow.stages.length; i++) {
      const stage = workflow.stages[i]!;
      const stageNum = i + 1;

      try {
        // 1. 准备输入: 解析变量引用
        let input = userInput;
        if (stage.input) {
          const prevResult = results.get(stage.input);
          if (prevResult) {
            input = typeof prevResult === 'string' ? prevResult : JSON.stringify(prevResult);
          }
        }

        // 2. 构建参数: 合并用户输入 + 上游输出
        const params: Record<string, any> = { input };
        if (stage.params) {
          for (const [key, value] of Object.entries(stage.params)) {
            // 支持变量引用: {{output_var}}
            if (typeof value === 'string' && value.includes('{{')) {
              const resolved = value.replace(/\{\{(\w+)\}\}/g, (_, varName) => {
                const varValue = results.get(varName);
                return varValue ? (typeof varValue === 'string' ? varValue : JSON.stringify(varValue)) : '';
              });
              params[key] = resolved;
            } else {
              params[key] = value;
            }
          }
        }

        // 3. 执行技能
        const skillResult = await this.skillExecutor(stage.skill, params);

        // 4. 保存输出
        results.set(stage.output, skillResult);
        stageResults.push({
          skill: stage.skill,
          success: skillResult.success,
          output: String(skillResult.output || '').slice(0, 500), // 截断保存
        });

        console.log(`[workflow] stage ${stageNum}/${workflow.stages.length}: ${stage.skill} ✓`);
      } catch (e: any) {
        stageResults.push({
          skill: stage.skill,
          success: false,
          output: '',
          error: e.message,
        });
        console.error(`[workflow] stage ${stageNum} failed: ${stage.skill} - ${e.message}`);

        // 失败中断
        return {
          success: false,
          stages: stageResults,
          finalOutput: `工作流执行失败: ${stage.skill} 阶段出错 - ${e.message}`,
          totalTimeMs: Date.now() - startTime,
        };
      }
    }

    // 5. 聚合结果
    let finalOutput = '';
    if (workflow.aggregator) {
      finalOutput = workflow.aggregator(results);
    } else {
      // 默认: 取最后一个 stage 的输出
      const lastStage = workflow.stages[workflow.stages.length - 1]!;
      const lastResult = results.get(lastStage.output);
      finalOutput = lastResult ? (typeof lastResult === 'string' ? lastResult : JSON.stringify(lastResult)) : '';
    }

    console.log(`[workflow] completed: ${workflow.name} in ${Date.now() - startTime}ms`);

    return {
      success: true,
      stages: stageResults,
      finalOutput: finalOutput.slice(0, 10000),
      totalTimeMs: Date.now() - startTime,
    };
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
      { skill: 'read_excel', output: 'raw_data' },
      { skill: 'analyze_data', input: 'raw_data', output: 'analysis' },
      { skill: 'generate_word', input: 'analysis', output: 'word_report' },
      { skill: 'generate_ppt', input: 'analysis', output: 'final_pptx' },
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
      { skill: 'web_search', output: 'search_results' },
      { skill: 'aggregate_info', input: 'search_results', output: 'aggregated' },
      { skill: 'cross_validate', input: 'aggregated', output: 'validated' },
      { skill: 'generate_report', input: 'validated', output: 'research_report' },
    ],
    aggregator: (results) => {
      const report = results.get('research_report');
      return `## 深度研究报告生成完成\n\n${typeof report === 'string' ? report.slice(0, 2000) : '报告已生成'}`;
    },
  },
];
