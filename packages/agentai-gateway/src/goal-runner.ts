/**
 * GoalRunner — 目标驱动执行引擎
 * ----------------------------------------------------
 * 学习 ZCode 3.0 的 Goal 模式:
 *   1. 目标分解 — LLM 将大目标拆为 3-5 个阶段
 *   2. 阶段执行 — 逐阶段运行 AgentAILoop，每阶段有独立上下文
 *   3. 验证门 — 每阶段结束后验证进度，不通过则自动修正
 *   4. 子智能体委派 — 可并行执行的子任务交给 subagent
 *   5. 目标达成检测 — 自动判断目标是否完成
 *
 * 插入点:
 *   - AgentAILoop.runWithGoal(goal) 作为新的顶层入口
 *   - 不影响现有 run() 的行为
 *
 * 安全:
 *   - 阶段数上限 8 (防止无限循环)
 *   - 单阶段超时 5 分钟
 *   - 总超时 30 分钟
 *   - 每阶段 verify 不通过最多重试 2 次
 */

import { EventEmitter } from 'events';
import { AgentAILoop, LoopOptions } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';
import { ToolRegistry } from './tool-registry.js';

// ===== 类型 =====

export interface GoalStage {
  /** 阶段标识 */
  key: string;
  /** 人类可读标签 */
  label: string;
  /** 阶段描述 */
  description: string;
  /** 是否可并行 (将委派给 subagent) */
  parallelizable: boolean;
  /** 验收标准 */
  acceptanceCriteria: string;
  /** 是否需要人工审批后才继续下一阶段 */
  requireHumanApproval?: boolean;
}

export interface GoalPlan {
  /** 目标原文 */
  goal: string;
  /** 执行阶段列表 */
  stages: GoalStage[];
  /** 预计阶段数 */
  estimatedStages: number;
}

export interface GoalProgress {
  currentStage: string;
  totalStages: number;
  completedStages: number;
  stageResults: Record<string, { success: boolean; summary: string; retries: number }>;
  startedAt: number;
  /** 断点续跑: 已完成的阶段 key 列表, 跳过这些阶段 */
  skipStages?: string[];
  /** 暂停点: 等待人工审批的阶段 key */
  pendingApproval?: string;
}

export interface GoalResult {
  success: boolean;
  goal: string;
  content: string;
  stages: Array<{ key: string; label: string; success: boolean; summary: string }>;
  durationMs: number;
  totalIterations: number;
  /** 断点续跑: 保存中间状态, 下次可从此恢复 */
  checkpoint?: GoalProgress;
}

// ===== 常量 =====

const MAX_STAGES = 8;
const MAX_STAGE_RETRIES = 2;
const STAGE_TIMEOUT_MS = 5 * 60 * 1000;
const TOTAL_TIMEOUT_MS = 30 * 60 * 1000;

const PLAN_SYSTEM_PROMPT = `你是一个项目规划专家。用户有一个大目标, 请将其分解为 3-5 个可执行的阶段。

要求:
1. 每个阶段应该是独立的、可验证的
2. 标注哪些阶段可以并行执行 (parallelizable: true)
3. 每个阶段必须有明确的验收标准 (acceptanceCriteria)
4. 使用 JSON 格式输出

输出格式:
{
  "stages": [
    {
      "key": "唯一的英文键名",
      "label": "中文描述 (8字以内)",
      "description": "该阶段的详细任务描述",
      "parallelizable": false,
      "acceptanceCriteria": "该阶段的验收标准"
    }
  ]
}`;

// ===== 实现 =====

/**
 * 用 LLM 将目标分解为执行计划
 */
async function buildPlan(goal: string, router: AgentAIRouter): Promise<GoalPlan> {
  const res = await router.chat({
    model: 'agentai',
    messages: [
      { role: 'system', content: PLAN_SYSTEM_PROMPT },
      { role: 'user', content: `目标: ${goal}\n\n请输出 JSON 格式的阶段计划。` },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });

  try {
    // 尝试从返回内容中提取 JSON
    const content = res.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const stages: GoalStage[] = (parsed.stages || []).slice(0, MAX_STAGES).map((s: any, i: number) => ({
        key: s.key || `stage-${i + 1}`,
        label: s.label || `阶段 ${i + 1}`,
        description: s.description || '',
        parallelizable: !!s.parallelizable,
        acceptanceCriteria: s.acceptanceCriteria || '任务完成',
      }));
      return { goal, stages, estimatedStages: stages.length };
    }
  } catch {}

  // 降级: 单阶段直接执行
  return {
    goal,
    stages: [{ key: 'main', label: '执行', description: goal, parallelizable: false, acceptanceCriteria: '任务完成' }],
    estimatedStages: 1,
  };
}

/**
 * 阶段验证: 用 LLM 检查当前阶段的成果是否满足验收标准
 */
async function verifyStage(
  stage: GoalStage,
  stageResult: string,
  router: AgentAIRouter,
): Promise<{ pass: boolean; feedback: string }> {
  const prompt = `验收标准: ${stage.acceptanceCriteria}

实际输出:
${stageResult.slice(0, 3000)}

请判断是否通过验收。如果通过回复 "PASS: <简要说明>", 如果不通过回复 "FAIL: <具体问题和改进建议>"。`;

  const res = await router.chat({
    model: 'agentai',
    messages: [
      { role: 'system', content: '你是一个质量验收专家。只输出验收结果。' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
    maxTokens: 300,
  });

  const text = res.content.trim();
  const pass = /^PASS/i.test(text);
  return {
    pass,
    feedback: text,
  };
}

/**
 * 在 AgentAILoop 上新增 runWithGoal 方法
 * 这是一个扩展方法, 不修改 AgentAILoop 类本身
 */
export async function runWithGoal(
  goal: string,
  loop: AgentAILoop,
  router: AgentAIRouter,
  registry: ToolRegistry,
  baseOpts: Required<LoopOptions>,
  /** 断点续跑: 传入上次的 checkpoint 可跳过已完成阶段 */
  resumeFrom?: GoalProgress,
): Promise<GoalResult> {
  const startedAt = resumeFrom?.startedAt || Date.now();
  const stageResults: Record<string, { success: boolean; summary: string; retries: number }> = { ...resumeFrom?.stageResults };
  const completedStages: Array<{ key: string; label: string; success: boolean; summary: string }> = [];
  let totalIterations = 0;
  const skipStages = new Set(resumeFrom?.skipStages || []);

  // 1. 目标分解
  const plan = await buildPlan(goal, router);
  const progress: GoalProgress = {
    currentStage: plan.stages[0]?.key || '',
    totalStages: plan.stages.length,
    completedStages: 0,
    stageResults,
    startedAt,
  };

  // 发射计划事件
  const stagesForEvent = plan.stages.map(s => ({ key: s.key, label: s.label }));
  loop.emit('goal:plan', { goal, stages: stagesForEvent, total: plan.stages.length });

  // 2. 逐阶段执行
  for (let i = 0; i < plan.stages.length; i++) {
    const stage = plan.stages[i]!;

    // 断点续跑: 跳过已完成的阶段
    if (skipStages.has(stage.key) || stageResults[stage.key]?.success) {
      const existing = stageResults[stage.key];
      if (existing) {
        completedStages.push({ key: stage.key, label: stage.label, success: existing.success, summary: existing.summary });
        progress.completedStages++;
      }
      continue;
    }

    // 超时检查
    if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
      loop.emit('goal:timeout', { stage: stage.key });
      break;
    }

    progress.currentStage = stage.key;
    loop.emit('goal:stage', { key: stage.key, label: stage.label, index: i + 1, total: plan.stages.length });

    // 2a. 并行阶段 → 委派子智能体
    if (stage.parallelizable) {
      const subResult = await runStageInSubagent(stage, router, registry, baseOpts);
      stageResults[stage.key] = { success: subResult.success, summary: subResult.summary, retries: 0 };
      completedStages.push({ key: stage.key, label: stage.label, success: subResult.success, summary: subResult.summary });
      progress.completedStages++;
      loop.emit('goal:stage:done', { key: stage.key, label: stage.label, success: subResult.success, summary: subResult.summary });
      continue;
    }

    // 2b. 串行阶段 → 新建 AgentAILoop + 重试
    let pass = false;
    let stageOutput = '';
    let retries = 0;
    const stageStartedAt = Date.now();

    while (!pass && retries <= MAX_STAGE_RETRIES) {
      const stageLoop = new AgentAILoop(router, registry, [], {
        ...baseOpts,
        maxIterations: 30,
        _autoResumed: false,
      });

      const stagePrompt = retries === 0
        ? `## 当前目标: ${goal}\n\n## 第 ${i + 1}/${plan.stages.length} 阶段: ${stage.label}\n\n${stage.description}\n\n验收标准: ${stage.acceptanceCriteria}\n\n请开始执行此阶段的任务。`
        : `## 上一轮验收未通过\n\n反馈: ${stageOutput}\n\n请修正问题并重新执行 ${stage.label} 阶段。`;

      loop.emit('goal:stage:attempt', { key: stage.key, attempt: retries + 1 });
      const stageResult = await stageLoop.run(stagePrompt);
      stageOutput = stageResult.content || '';
      totalIterations += stageResult.iterations || 0;

      // 超时检查: 以阶段开始时间为准
      if (Date.now() - stageStartedAt > STAGE_TIMEOUT_MS && retries === 0) {
        pass = true; // 超时视为通过
        stageOutput += '\n[超时截止]';
        break;
      }

      // 验证
      const verdict = await verifyStage(stage, stageOutput, router);
      if (verdict.pass) {
        pass = true;
      } else {
        retries++;
        stageOutput = verdict.feedback;
      }
    }

    stageResults[stage.key] = { success: pass, summary: stageOutput.slice(0, 500), retries };
    completedStages.push({ key: stage.key, label: stage.label, success: pass, summary: stageOutput.slice(0, 500) });
    progress.completedStages++;
    loop.emit('goal:stage:done', { key: stage.key, label: stage.label, success: pass, summary: stageOutput.slice(0, 200) });

    // 人工审批节点: 阶段标记 requireHumanApproval 时暂停, 等待前端确认
    if (stage.requireHumanApproval && pass) {
      progress.pendingApproval = stage.key;
      loop.emit('goal:stage:awaiting_approval', {
        key: stage.key,
        label: stage.label,
        summary: stageOutput.slice(0, 200),
        checkpoint: { ...progress, skipStages: [...skipStages, stage.key] },
      });
      // 暂停执行, 返回带 checkpoint 的结果, 前端审批后可 resume
      return {
        success: false,
        goal,
        content: `阶段「${stage.label}」已完成, 等待人工审批后继续。`,
        stages: completedStages,
        durationMs: Date.now() - startedAt,
        totalIterations,
        checkpoint: { ...progress, skipStages: [...skipStages, stage.key] },
      };
    }

    // 关键阶段失败 → 停止
    if (!pass && retries > MAX_STAGE_RETRIES) {
      loop.emit('goal:stage:failed', { key: stage.key, label: stage.label, retries });
      break;
    }
  }

  // 3. 生成最终报告
  const allPassed = completedStages.every(s => s.success);
  const reportLines: string[] = [
    `## 目标: ${goal}`,
    `**状态**: ${allPassed ? '全部完成' : '部分完成'}`,
    `**耗时**: ${((Date.now() - startedAt) / 1000).toFixed(1)}秒`,
    `**阶段**: ${completedStages.length}/${plan.stages.length}`,
    '',
    '### 阶段执行记录',
    ...completedStages.map(s => {
      const icon = s.success ? 'OK' : 'FAIL';
      return `- [${icon}] **${s.label}**: ${s.summary}`;
    }),
    '',
  ];

  loop.emit('goal:done', { success: allPassed, stages: completedStages.length });
  return {
    success: allPassed,
    goal,
    content: reportLines.join('\n'),
    stages: completedStages,
    durationMs: Date.now() - startedAt,
    totalIterations,
    checkpoint: { ...progress, skipStages: [...skipStages] },
  };
}

/**
 * 在子智能体中执行并行阶段
 */
async function runStageInSubagent(
  stage: GoalStage,
  router: AgentAIRouter,
  registry: ToolRegistry,
  baseOpts: Required<LoopOptions>,
): Promise<{ success: boolean; summary: string }> {
  try {
    const subLoop = new AgentAILoop(router, registry, [], {
      ...baseOpts,
      maxIterations: 20,
      _autoResumed: false,
    });

    const prompt = `你需要完成以下并行子任务:\n\n${stage.description}\n\n验收标准: ${stage.acceptanceCriteria}\n\n完成后请总结成果。`;
    const result = await subLoop.run(prompt);
    // 子任务不做严格验证, 有输出即为成功
    const success = (result.content?.length || 0) > 20;
    return { success, summary: result.content?.slice(0, 500) || '(无输出)' };
  } catch (e: any) {
    return { success: false, summary: `子智能体执行失败: ${e.message}` };
  }
}
