/**
 * 计划组装器
 * ALTES | 岐黄 - 因证施治之"治"
 *
 * 职责：
 * 1. 根据诊断结果生成治疗计划
 * 2. 拆解任务为可执行步骤
 * 3. 制定验证点和回滚策略
 *
 * @module diagnosis/plan-assembler
 */

import {
  TaskPerceptionReport,
  DiagnosisReport,
  TreatmentPlan,
  TreatmentStep,
  TreatmentApproach,
  DiagnosisContext,
} from '../types/diagnosis.js';

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 组装治疗计划
 *
 * 对应中医"开方"：
 * - 根据诊断结果制定治疗方案
 * - 拆解为具体执行步骤
 * - 设定验证点和回滚策略
 */
export function assemblePlan(
  diagnosis: DiagnosisReport,
  perception: TaskPerceptionReport,
  context: DiagnosisContext
): TreatmentPlan {
  // 1. 拆解步骤
  const steps = decomposeSteps(perception, diagnosis);
  
  // 2. 生成验证点
  const verificationPoints = generateVerificationPoints(steps);
  
  // 3. 制定回滚策略
  const rollbackStrategy = generateRollbackStrategy(steps, perception);
  
  // 4. 计算预估资源
  const estimatedTokens = estimateTokens(steps);
  const estimatedDuration = estimateDuration(steps);
  
  return {
    id: generatePlanId(),
    version: 1,
    steps,
    verificationPoints,
    rollbackStrategy,
    estimatedTotalTokens: estimatedTokens,
    estimatedDuration,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════
// 步骤拆解
// ═══════════════════════════════════════════════════════════

/**
 * 拆解任务为步骤
 */
function decomposeSteps(
  perception: TaskPerceptionReport,
  diagnosis: DiagnosisReport
): TreatmentStep[] {
  const steps: TreatmentStep[] = [];
  const approach = diagnosis.recommendedApproach;
  
  switch (approach) {
    case 'direct':
      // 单刀直入：单步执行
      steps.push(createDirectStep(perception));
      break;
      
    case 'planning':
      // 先诊后治：规划 + 执行
      steps.push(createPlanningStep(perception));
      steps.push(createExecutionStep(perception));
      break;
      
    case 'exploratory':
      // 探索式：调研 + 方案 + 执行
      steps.push(createResearchStep(perception));
      steps.push(createDesignStep(perception));
      steps.push(createExecutionStep(perception));
      break;
      
    case 'multi_step':
      // 分阶段：根据任务类型拆解
      steps.push(...decomposeMultiStep(perception, diagnosis));
      break;
  }
  
  // 为步骤分配序号和ID
  return steps.map((step, index) => ({
    ...step,
    id: `step-${index + 1}`,
    order: index + 1,
  }));
}

/**
 * 创建直接执行步骤
 */
function createDirectStep(perception: TaskPerceptionReport): TreatmentStep {
  return {
    id: '',
    order: 0,
    description: `直接执行: ${perception.intentSummary}`,
    expectedOutput: getExpectedOutput(perception.taskType),
    verificationMethod: '检查结果是否符合预期',
    rollbackAction: '重新分析需求',
    estimatedTokens: 2000,
    parallelizable: false,
  };
}

/**
 * 创建规划步骤
 */
function createPlanningStep(perception: TaskPerceptionReport): TreatmentStep {
  return {
    id: '',
    order: 0,
    description: '分析需求并制定执行计划',
    expectedOutput: '详细的执行步骤和预期结果',
    verificationMethod: '检查计划是否完整覆盖需求',
    rollbackAction: '简化计划，先解决核心问题',
    estimatedTokens: 1500,
    parallelizable: false,
  };
}

/**
 * 创建调研步骤
 */
function createResearchStep(perception: TaskPerceptionReport): TreatmentStep {
  return {
    id: '',
    order: 0,
    description: '调研技术方案和最佳实践',
    expectedOutput: '技术选型报告和方案对比',
    verificationMethod: '检查方案是否满足约束条件',
    rollbackAction: '使用保守的成熟方案',
    estimatedTokens: 2000,
    parallelizable: true,
  };
}

/**
 * 创建设计步骤
 */
function createDesignStep(perception: TaskPerceptionReport): TreatmentStep {
  return {
    id: '',
    order: 0,
    description: '设计具体实现方案',
    expectedOutput: '详细设计文档和接口定义',
    verificationMethod: '检查设计是否满足需求',
    rollbackAction: '简化设计，先实现MVP',
    estimatedTokens: 2000,
    parallelizable: false,
  };
}

/**
 * 创建执行步骤
 */
function createExecutionStep(perception: TaskPerceptionReport): TreatmentStep {
  return {
    id: '',
    order: 0,
    description: `执行: ${perception.intentSummary}`,
    expectedOutput: getExpectedOutput(perception.taskType),
    verificationMethod: getVerificationMethod(perception.taskType),
    rollbackAction: '回滚到上一步，重新分析',
    estimatedTokens: 3000,
    parallelizable: false,
  };
}

/**
 * 多步骤拆解
 */
function decomposeMultiStep(
  perception: TaskPerceptionReport,
  diagnosis: DiagnosisReport
): TreatmentStep[] {
  const steps: TreatmentStep[] = [];
  
  // 根据任务类型定制拆解
  switch (perception.taskType) {
    case 'coding':
      steps.push(
        { ...createPlanningStep(perception), description: '分析需求，确定接口和依赖' },
        { ...createExecutionStep(perception), description: '编写核心逻辑代码' },
        { ...createExecutionStep(perception), description: '添加错误处理和边界情况' },
        { ...createExecutionStep(perception), description: '编写单元测试' }
      );
      break;
      
    case 'debugging':
      steps.push(
        { ...createPlanningStep(perception), description: '复现问题，收集错误信息' },
        { ...createExecutionStep(perception), description: '定位问题根因' },
        { ...createExecutionStep(perception), description: '修复问题' },
        { ...createExecutionStep(perception), description: '验证修复效果' }
      );
      break;
      
    case 'refactoring':
      steps.push(
        { ...createPlanningStep(perception), description: '分析现有代码，确定重构范围' },
        { ...createExecutionStep(perception), description: '添加测试覆盖（如无）' },
        { ...createExecutionStep(perception), description: '执行重构' },
        { ...createExecutionStep(perception), description: '验证功能无损' }
      );
      break;
      
    case 'analysis':
      steps.push(
        { ...createPlanningStep(perception), description: '确定分析维度和目标' },
        { ...createExecutionStep(perception), description: '收集相关数据' },
        { ...createExecutionStep(perception), description: '执行分析' },
        { ...createExecutionStep(perception), description: '生成分析报告' }
      );
      break;
      
    default:
      // 通用拆解
      steps.push(
        createPlanningStep(perception),
        createExecutionStep(perception),
        { ...createExecutionStep(perception), description: '验证结果' }
      );
  }
  
  return steps;
}

// ═══════════════════════════════════════════════════════════
// 验证点和回滚策略
// ═══════════════════════════════════════════════════════════

/**
 * 生成验证点
 */
function generateVerificationPoints(steps: TreatmentStep[]): string[] {
  const points: string[] = [];
  
  // 每个步骤的验证方法
  for (const step of steps) {
    points.push(`Step ${step.order}: ${step.verificationMethod}`);
  }
  
  // 整体验证
  points.push('最终结果是否符合用户原始需求');
  points.push('是否有副作用或回归问题');
  
  return points;
}

/**
 * 生成回滚策略
 */
function generateRollbackStrategy(
  steps: TreatmentStep[],
  perception: TaskPerceptionReport
): string {
  const strategies: string[] = [];
  
  // 文件备份
  if (perception.taskType === 'coding' || perception.taskType === 'refactoring') {
    strategies.push('修改前自动备份文件，出错时一键恢复');
  }
  
  // 分步回滚
  strategies.push(`分${steps.length}步执行，每步验证通过后再进行下一步`);
  
  // 失败处理
  strategies.push('任一步骤失败时，根据fallbackAction处理');
  
  return strategies.join('；');
}

// ═══════════════════════════════════════════════════════════
// 资源估算
// ═══════════════════════════════════════════════════════════

/**
 * 估算总 token 数
 */
function estimateTokens(steps: TreatmentStep[]): number {
  return steps.reduce((sum, step) => sum + (step.estimatedTokens || 2000), 0);
}

/**
 * 预估执行时间（秒）
 */
function estimateDuration(steps: TreatmentStep[]): number {
  // 假设每 1000 tokens 需要 10 秒
  const tokens = estimateTokens(steps);
  return Math.ceil(tokens / 1000 * 10);
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 获取预期输出
 */
function getExpectedOutput(taskType: string): string {
  const outputs: Record<string, string> = {
    coding: '可运行的代码和必要的注释',
    debugging: '修复后的代码和问题根因说明',
    refactoring: '重构后的代码和变更说明',
    analysis: '分析报告和关键发现',
    writing: '完成的文档内容',
    creative: '创意产出物',
    general: '满意的回答',
  };
  return outputs[taskType] || '符合预期的结果';
}

/**
 * 获取验证方法
 */
function getVerificationMethod(taskType: string): string {
  const methods: Record<string, string> = {
    coding: '代码能否通过编译/解释，测试是否通过',
    debugging: '问题是否解决，是否有回归',
    refactoring: '功能是否保持，代码质量是否提升',
    analysis: '分析结论是否有数据支撑',
    writing: '内容是否完整、准确',
    creative: '产出是否符合创意方向',
    general: '回答是否解决用户问题',
  };
  return methods[taskType] || '检查结果是否符合预期';
}

/**
 * 生成计划 ID
 */
function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ═══════════════════════════════════════════════════════════
// 方案调整
// ═══════════════════════════════════════════════════════════

/**
 * 调整计划
 */
export function adjustPlan(
  plan: TreatmentPlan,
  failedStepId: string,
  reason: string
): TreatmentPlan {
  const adjustedSteps = [...plan.steps];
  const failedIndex = adjustedSteps.findIndex(s => s.id === failedStepId);
  
  if (failedIndex === -1) {
    return plan;
  }
  
  const failedStep = adjustedSteps[failedIndex]!;
  
  // 根据失败原因调整
  if (reason.includes('too complex')) {
    // 步骤太复杂，拆分为更小的步骤
    const subSteps = splitStep(failedStep);
    adjustedSteps.splice(failedIndex, 1, ...subSteps);
  } else if (reason.includes('missing info')) {
    // 缺少信息，在当前步骤前添加调研步骤
    const researchStep: TreatmentStep = {
      id: '',
      order: 0,
      description: `补充调研: ${failedStep.description}`,
      expectedOutput: '补充必要的信息和上下文',
      verificationMethod: '检查信息是否足够',
      rollbackAction: '简化需求，先解决核心问题',
      estimatedTokens: 1000,
      parallelizable: false,
    };
    adjustedSteps.splice(failedIndex, 0, researchStep);
  }
  
  // 重新分配序号
  const reorderedSteps = adjustedSteps.map((step, index) => ({
    ...step,
    id: `step-${index + 1}`,
    order: index + 1,
  }));
  
  return {
    ...plan,
    version: plan.version + 1,
    steps: reorderedSteps,
    updatedAt: Date.now(),
  };
}

/**
 * 拆分步骤
 */
function splitStep(step: TreatmentStep): TreatmentStep[] {
  // 将一个复杂步骤拆分为两个简单步骤
  return [
    {
      ...step,
      id: '',
      order: 0,
      description: `${step.description} (Part 1)`,
      expectedOutput: `${step.expectedOutput} (初步)`,
      estimatedTokens: Math.floor((step.estimatedTokens || 2000) / 2),
    },
    {
      ...step,
      id: '',
      order: 0,
      description: `${step.description} (Part 2)`,
      expectedOutput: `${step.expectedOutput} (完善)`,
      estimatedTokens: Math.floor((step.estimatedTokens || 2000) / 2),
    },
  ];
}

// ═══════════════════════════════════════════════════════════
// 导出测试函数
// ═══════════════════════════════════════════════════════════

export function testPlanAssembler(): void {
  const perception = {
    taskType: 'coding' as const,
    complexity: 'complex' as const,
    ambiguity: 0.3,
    gapList: [],
    suggestedAction: 'proceed' as const,
    intentSummary: '实现用户登录功能',
  };
  
  const diagnosis = {
    confidence: 0.8,
    riskLevel: 'medium' as const,
    recommendedApproach: 'multi_step' as const,
    estimatedSteps: 4,
    potentialBlockers: [],
    successProbability: 0.85,
  };
  
  const context = { sessionId: 'test', userId: 'test' };
  
  const plan = assemblePlan(diagnosis, perception, context);
  
  console.log('治疗计划:');
  console.log(`ID: ${plan.id}`);
  console.log(`步骤数: ${plan.steps.length}`);
  console.log(`预估Token: ${plan.estimatedTotalTokens}`);
  console.log(`预估时间: ${plan.estimatedDuration}秒`);
  console.log('步骤:');
  plan.steps.forEach(s => {
    console.log(`  ${s.order}. ${s.description}`);
  });
}
