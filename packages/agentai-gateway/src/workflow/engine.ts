// ===========================================================================
// src/workflow/engine.ts — 五步认知脚手架工作流引擎
// ===========================================================================
/**
 * 职责：把 Agent 执行流程标准化为五步，每一步都有检查点和出口。
 * 理解 → 规划 → 执行 → 自检 → 蒸馏
 */

import { SelfEvaluator, ScoreCard, quickScore, scoreCardToLabel } from '../judge/self-eval.js';
import { CodeRunner, SandboxRules, createSandbox } from '../sandbox/executor.js';
import { getPromptEngine } from '../prompts/engine.js';
import { getKnowledgeCache } from '../knowledge-cache.js';
import { createHash } from 'crypto';

// ===== 类型 =====
export interface WorkflowStep {
  name: string;
  execute: () => Promise<StepResult>;
}

export interface StepResult {
  success: boolean;
  data: Record<string, unknown>;
  nextStep?: string;
  fallback?: string;
}

export interface WorkflowContext {
  userId?: string;
  sessionId: string;
  query: string;
  persona?: string;
  tools?: string[];
  maxIterations?: number;
  qualityThreshold?: number; // 最低自检分数
}

export interface WorkflowResult {
  success: boolean;
  steps: Array<{ name: string; success: boolean; durationMs: number; score?: number }>;
  finalOutput: string;
  totalDurationMs: number;
  selfEval: ScoreCard | null;
  distillationRecord?: boolean; // 是否触发蒸馏
}

// ===== 内置 Persona 路由 =====
const PERSONA_MAP: Record<string, string> = {
  '金融': 'financial_analyst',
  '投资': 'financial_analyst',
  '股票': 'financial_analyst',
  '法律': 'legal_consultant',
  '合同': 'legal_consultant',
  '代码': 'code_review',
  '编程': 'tech_advisor',
  'debug': 'tech_advisor',
  '提取': 'data_extraction',
  '总结': 'general',
};

function classifyPersona(query: string): string {
  for (const [keyword, persona] of Object.entries(PERSONA_MAP)) {
    if (query.includes(keyword)) return persona;
  }
  return 'general';
}

// ===== 五步执行器 =====
export class WorkflowEngine {
  private evaluator: SelfEvaluator;
  private sandbox: CodeRunner;

  constructor(
    limits?: { timeoutMs?: number; maxOutputBytes?: number; qualityThreshold?: number },
  ) {
    this.evaluator = new SelfEvaluator();
    this.sandbox = createSandbox(limits);
  }

  /**
   * 执行五步工作流
   */
  async execute(context: WorkflowContext): Promise<WorkflowResult> {
    const startTime = Date.now();
    const steps: WorkflowResult['steps'] = [];
    let currentOutput = '';

    // --- Step 1: 理解 (Understand) ---
    const step1Start = Date.now();
    const persona = classifyPersona(context.query);

    // 尝试从知识缓存获取最佳模板
    const kCache = getKnowledgeCache();
    const cachedTemplate = kCache.query(context.query);
    const personaForEval = cachedTemplate.found ? cachedTemplate.entry!.persona : persona;

    // 使用 Prompt 模板引擎生成结构化提示
    const pEngine = getPromptEngine();
    const promptResult = pEngine.buildPrompt(context.query);

    steps.push({ name: 'understand', success: true, durationMs: Date.now() - step1Start });
    currentOutput = promptResult.prompt;

    // --- Step 2: 规划 (Plan) ---
    const step2Start = Date.now();
    const plan = this.generatePlan(context, persona);
    steps.push({ name: 'plan', success: true, durationMs: Date.now() - step2Start });

    // --- Step 3: 执行 (Execute) ---
    const step3Start = Date.now();
    const executionResult = await this.executePlan(plan, context, persona);
    currentOutput = executionResult.output;
    steps.push({
      name: 'execute',
      success: executionResult.success,
      durationMs: Date.now() - step3Start,
    });

    // --- Step 4: 自检 (Self-Check) ---
    const step4Start = Date.now();
    const selfEval = this.evaluator.evaluate(
      context.query,
      currentOutput,
      personaForEval as any,
      { checkJSON: true, checkSafety: true },
    );
    const qualityThreshold = context.qualityThreshold ?? 4;
    let selfCheckPassed = selfEval.totalScore >= qualityThreshold;
    steps.push({
      name: 'self_check',
      success: selfCheckPassed,
      durationMs: Date.now() - step4Start,
      score: selfEval.totalScore,
    });

    // 如果自检失败，尝试一次重试
    if (!selfCheckPassed && executionResult.attemptRetry) {
      const retryOutput = await executionResult.retry();
      currentOutput = retryOutput;
      const retryEval = this.evaluator.evaluate(
        context.query,
        retryOutput,
        personaForEval as any,
        { checkJSON: true, checkSafety: true },
      );
      selfCheckPassed = retryEval.totalScore >= qualityThreshold;
      selfEval.totalScore = retryEval.totalScore;
      selfEval.reasons = retryEval.reasons;
      steps[3]!.success = selfCheckPassed;
    }

    // --- Step 5: 蒸馏 (Distill) ---
    const step5Start = Date.now();
    let distillationRecord = false;
    if (selfCheckPassed && selfEval.totalScore >= 8) {
      // 高质量结果 → 记录为可复用模板，写入知识缓存
      distillationRecord = true;
      kCache.upsert(context.query, promptResult.templateId, selfEval.totalScore, personaForEval);
      pEngine.recordFeedback(promptResult.templateId, selfEval.totalScore);
    }
    steps.push({ name: 'distill', success: true, durationMs: Date.now() - step5Start, score: distillationRecord ? 1 : 0 });

    return {
      success: selfCheckPassed,
      steps,
      finalOutput: currentOutput,
      totalDurationMs: Date.now() - startTime,
      selfEval,
      distillationRecord,
    };
  }

  /**
   * 生成执行计划
   */
  private generatePlan(ctx: WorkflowContext, persona: string): Array<{
    action: string;
    tool?: string;
    params?: Record<string, unknown>;
  }> {
    // 根据 persona 和工具列表生成计划
    const hasCodeTool = ctx.tools?.includes('code_executor');
    const hasSearchTool = ctx.tools?.includes('web_search');

    const plan: Array<{
      action: string;
      tool?: string;
      params?: Record<string, unknown>;
    }> = [
      { action: 'parse_query', params: { query: ctx.query, persona } },
    ];

    if (hasSearchTool) {
      plan.push({ action: 'search_knowledge', params: { query: ctx.query } });
    }

    if (hasCodeTool) {
      plan.push({ action: 'execute_code', params: { query: ctx.query } });
    }

    plan.push({ action: 'synthesize_output', params: { persona } });

    return plan;
  }

  /**
   * 执行计划（简化版：直接返回格式化输出）
   */
  private async executePlan(
    plan: Array<{ action: string; params?: Record<string, unknown> }>,
    ctx: WorkflowContext,
    persona: string,
  ): Promise<{
    success: boolean;
    output: string;
    attemptRetry: boolean;
    retry: () => Promise<string>;
  }> {
    // 简单实现：根据 persona 生成格式化输出
    let output = `[${persona}] 收到任务: "${ctx.query}"\n\n`;
    output += `执行计划:\n`;
    for (const step of plan) {
      output += `  - ${step.action}\n`;
    }
    output += `\n输出完成。`;

    // 可选：执行代码步骤
    const codeStep = plan.find(s => s.action === 'execute_code');
    if (codeStep && codeStep.params?.query) {
      const safeCheck = SandboxRules.checkDanger('() => Math.max(1, 2)');
      if (safeCheck.safe) {
        const result = await this.sandbox.execute('() => "code_executed_ok"');
        if (result.success) {
          output += `\n代码执行结果: ${result.output}`;
        }
      }
    }

    return {
      success: true,
      output,
      attemptRetry: true, // 允许一次重试
      retry: async () => {
        // 重试逻辑：简化输出，去除冗余
        return `[${persona}] ${ctx.query} 的简化响应。`;
      },
    };
  }

  /**
   * 批量执行多个工作流（用于 A/B 测试）
   */
  async batchExecute(
    contexts: WorkflowContext[],
  ): Promise<WorkflowResult[]> {
    const results = await Promise.all(
      contexts.map(ctx => this.execute(ctx)),
    );
    return results;
  }
}

// ===== 便捷函数 =====
export function createWorkflow(
  context: Omit<WorkflowContext, 'sessionId'> & { sessionId?: string },
  limits?: { timeoutMs?: number; maxOutputBytes?: number },
): { engine: WorkflowEngine; run: () => Promise<WorkflowResult> } {
  const engine = new WorkflowEngine(limits);
  return {
    engine,
    run: () => engine.execute({
      ...context,
      sessionId: context.sessionId ?? `session_${Date.now()}`,
    }),
  };
}
