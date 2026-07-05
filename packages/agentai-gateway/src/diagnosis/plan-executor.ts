/**
 * 计划执行器
 * ALTES | 岐黄 - 执行治疗计划并验证
 *
 * 职责：
 * 1. 按步骤执行治疗计划
 * 2. 每步验证结果
 * 3. 失败时调整方案或重试
 *
 * @module diagnosis/plan-executor
 */

import { AgentAILoop } from '../agentai-loop.js';
import type { AgentAIRouter } from '../llm-router.js';
import type { ToolRegistry } from '../tool-registry.js';
import {
  TreatmentPlan,
  TreatmentStep,
  DiagnosisState,
  StepVerificationResult,
  DiagnosisContext,
} from '../types/diagnosis.js';
import { verifyStep } from './step-verifier.js';
import { adjustPlan } from './plan-assembler.js';

// ═══════════════════════════════════════════════════════════
// 执行结果
// ═══════════════════════════════════════════════════════════

export interface PlanExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  finalOutput: any;
  verificationResults: StepVerificationResult[];
  adjustmentsMade: number;
  error?: string;
}

export interface StepExecutionResult {
  step: TreatmentStep;
  output: any;
  verification: StepVerificationResult;
  executionTime: number;
}

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 执行治疗计划
 *
 * 对应中医"施治"：
 * - 按方抓药 → 按步骤执行
 * - 观察药效 → 验证结果
 * - 调整药方 → 失败时调整方案
 */
export async function executePlan(
  plan: TreatmentPlan,
  diagnosisState: DiagnosisState,
  context: DiagnosisContext,
  deps: {
    router: AgentAIRouter;
    registry: ToolRegistry;
    sendEvent?: (event: string, data: any) => void;
  }
): Promise<PlanExecutionResult> {
  const { router, registry, sendEvent } = deps;
  
  let currentPlan = plan;
  let currentStepIndex = 0;
  const verificationResults: StepVerificationResult[] = [];
  const stepResults: StepExecutionResult[] = [];
  let adjustmentsMade = 0;
  
  console.log(`[plan-executor] 🚀 开始执行治疗计划 | planId=${plan.id} steps=${plan.steps.length}`);
  
  // 遍历执行每个步骤
  while (currentStepIndex < currentPlan.steps.length) {
    const step = currentPlan.steps[currentStepIndex];
    
    console.log(`[plan-executor] ▶️ 执行步骤 ${step.order}/${currentPlan.steps.length}: ${step.description}`);
    
    // 发送步骤开始事件
    sendEvent?.('diagnosis', {
      type: 'step_started',
      data: {
        stepId: step.id,
        stepOrder: step.order,
        description: step.description,
        progress: `${currentStepIndex + 1}/${currentPlan.steps.length}`,
      },
    });
    
    // 执行步骤
    const startTime = Date.now();
    let output: any;
    
    try {
      output = await executeStep(step, context, { router, registry });
    } catch (err: any) {
      console.error(`[plan-executor] ❌ 步骤执行失败: ${err.message}`);
      
      // 验证失败结果
      const verification: StepVerificationResult = {
        passed: false,
        score: 0,
        issues: [`执行异常: ${err.message}`],
        suggestion: step.rollbackAction || '重试此步骤',
        needsRetry: true,
        needsPlanAdjustment: false,
      };
      
      verificationResults.push(verification);
      
      // 发送验证失败事件
      sendEvent?.('diagnosis', {
        type: 'step_verification_completed',
        data: {
          stepId: step.id,
          passed: false,
          score: 0,
          issues: verification.issues,
          suggestion: verification.suggestion,
        },
      });
      
      // 尝试重试或调整
      const shouldContinue = await handleStepFailure(
        currentPlan,
        step,
        verification,
        context,
        { sendEvent }
      );
      
      if (!shouldContinue) {
        return {
          success: false,
          completedSteps: currentStepIndex,
          totalSteps: currentPlan.steps.length,
          finalOutput: null,
          verificationResults,
          adjustmentsMade,
          error: `步骤 ${step.order} 执行失败且无法恢复`,
        };
      }
      
      // 重试当前步骤
      continue;
    }
    
    const executionTime = Date.now() - startTime;
    
    // 验证步骤结果
    console.log(`[plan-executor] 🔍 验证步骤结果`);
    const verification = await verifyStep(step, output, context);
    verificationResults.push(verification);
    
    // 发送验证完成事件
    sendEvent?.('diagnosis', {
      type: 'step_verification_completed',
      data: {
        stepId: step.id,
        passed: verification.passed,
        score: verification.score,
        issues: verification.issues,
        suggestion: verification.suggestion,
      },
    });
    
    // 记录步骤结果
    stepResults.push({
      step,
      output,
      verification,
      executionTime,
    });
    
    // 检查验证结果
    if (!verification.passed) {
      console.log(`[plan-executor] ⚠️ 步骤验证未通过 | score=${verification.score.toFixed(2)}`);
      
      // 需要调整方案
      if (verification.needsPlanAdjustment) {
        console.log(`[plan-executor] 🔄 调整治疗方案`);
        
        const adjustedPlan = adjustPlan(
          currentPlan,
          step.id,
          verification.issues.join(', ')
        );
        
        currentPlan = adjustedPlan;
        adjustmentsMade++;
        
        // 发送方案调整事件
        sendEvent?.('diagnosis', {
          type: 'treatment_plan_adjusted',
          data: {
            reason: verification.issues.join(', '),
            newStepCount: currentPlan.steps.length,
            version: currentPlan.version,
          },
        });
        
        // 从调整后的步骤继续
        continue;
      }
      
      // 需要重试
      if (verification.needsRetry) {
        console.log(`[plan-executor] 🔄 重试步骤 ${step.order}`);
        
        // 最多重试3次
        const retryCount = stepResults.filter(r => r.step.id === step.id).length;
        if (retryCount >= 3) {
          console.log(`[plan-executor] ❌ 步骤重试次数超限`);
          
          return {
            success: false,
            completedSteps: currentStepIndex,
            totalSteps: currentPlan.steps.length,
            finalOutput: output,
            verificationResults,
            adjustmentsMade,
            error: `步骤 ${step.order} 重试3次后仍失败`,
          };
        }
        
        // 重试当前步骤
        continue;
      }
      
      // 验证失败但不重试/调整，继续执行
      console.log(`[plan-executor] ⚠️ 继续执行后续步骤`);
    } else {
      console.log(`[plan-executor] ✅ 步骤验证通过 | score=${verification.score.toFixed(2)}`);
    }
    
    // 进入下一步
    currentStepIndex++;
  }
  
  // 所有步骤执行完成
  console.log(`[plan-executor] ✨ 治疗计划执行完成 | completed=${currentStepIndex} adjustments=${adjustmentsMade}`);
  
  // 发送完成事件
  sendEvent?.('diagnosis', {
    type: 'treatment_completed',
    data: {
      success: true,
      completedSteps: currentStepIndex,
      totalSteps: currentPlan.steps.length,
      adjustmentsMade,
    },
  });
  
  // 汇总最终结果
  const finalOutput = stepResults.length > 0
    ? stepResults[stepResults.length - 1].output
    : null;
  
  return {
    success: true,
    completedSteps: currentStepIndex,
    totalSteps: currentPlan.steps.length,
    finalOutput,
    verificationResults,
    adjustmentsMade,
  };
}

// ═══════════════════════════════════════════════════════════
// 步骤执行
// ═══════════════════════════════════════════════════════════

/**
 * 执行单个步骤
 */
async function executeStep(
  step: TreatmentStep,
  context: DiagnosisContext,
  deps: {
    router: AgentAIRouter;
    registry: ToolRegistry;
  }
): Promise<any> {
  const { router, registry } = deps;
  
  // 构建步骤执行提示
  const prompt = buildStepPrompt(step, context);
  
  // 使用 AgentAILoop 执行
  const messages = [
    { role: 'system', content: '你是一个专业的任务执行助手，请按照要求完成指定步骤。' },
    { role: 'user', content: prompt },
  ];
  
  // 创建临时 loop 执行单步
  const loop = new AgentAILoop(
    router,
    registry,
    messages,
    {
      maxIterations: 5,
      enableToolLoop: true,
    }
  );
  
  // 执行并获取结果
  const result = await loop.run();
  
  return result;
}

/**
 * 构建步骤执行提示
 */
function buildStepPrompt(step: TreatmentStep, context: DiagnosisContext): string {
  return `
## 任务步骤

**步骤描述**: ${step.description}

**预期输出**: ${step.expectedOutput}

**验证方法**: ${step.verificationMethod}

**上下文**:
- 会话ID: ${context.sessionId}
- 用户ID: ${context.userId}
- 项目路径: ${context.projectPath || '未指定'}

请完成上述步骤，确保输出符合预期。
`;
}

// ═══════════════════════════════════════════════════════════
// 失败处理
// ═══════════════════════════════════════════════════════════

/**
 * 处理步骤失败
 * @returns 是否继续执行
 */
async function handleStepFailure(
  plan: TreatmentPlan,
  step: TreatmentStep,
  verification: StepVerificationResult,
  context: DiagnosisContext,
  deps: {
    sendEvent?: (event: string, data: any) => void;
  }
): Promise<boolean> {
  const { sendEvent } = deps;
  
  console.log(`[plan-executor] 🩹 处理步骤失败 | step=${step.order}`);
  
  // 发送失败事件
  sendEvent?.('diagnosis', {
    type: 'step_failed',
    data: {
      stepId: step.id,
      issues: verification.issues,
      willRetry: verification.needsRetry,
      willAdjust: verification.needsPlanAdjustment,
    },
  });
  
  // 根据失败原因决定处理方式
  if (verification.needsPlanAdjustment) {
    // 需要调整方案，返回 true 让上层调整
    return true;
  }
  
  if (verification.needsRetry) {
    // 需要重试，返回 true
    return true;
  }
  
  // 无法恢复的错误
  return false;
}

// ═══════════════════════════════════════════════════════════
// 快捷执行函数
// ═══════════════════════════════════════════════════════════

/**
 * 快速执行（单步直接执行，不生成完整计划）
 */
export async function quickExecute(
  description: string,
  expectedOutput: string,
  context: DiagnosisContext,
  deps: {
    router: AgentAIRouter;
    registry: ToolRegistry;
  }
): Promise<any> {
  const step: TreatmentStep = {
    id: 'quick-step',
    order: 1,
    description,
    expectedOutput,
    verificationMethod: '检查结果是否符合预期',
    estimatedTokens: 2000,
    parallelizable: false,
  };
  
  return executeStep(step, context, deps);
}
