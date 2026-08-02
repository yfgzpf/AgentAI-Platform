/**
 * team-orchestrator.ts — AI 团队编排器
 * --------------------------------------------------
 * 启动预设团队, 管理多 Agent 协作, 综合输出结果
 * 支持三种工作流: parallel (并行) / sequential (串行) / review (先并行再综合)
 */

import type { AgentAIRouter } from './llm-router.js';
import type { ToolRegistry } from './tool-registry.js';
import { runSubagent } from './subagent.js';
import { getTeamPreset, type TeamPreset, type TeamMember } from './team-presets.js';

/** 单个成员的执行结果 */
export interface MemberResult {
  role: string;
  name: string;
  success: boolean;
  output: string;
  duration: number;
}

/** 团队执行结果 */
export interface TeamResult {
  teamId: string;
  teamName: string;
  workflow: string;
  task: string;
  results: MemberResult[];
  summary: string;
  totalDuration: number;
}

/**
 * 启动 AI 团队执行任务
 * @param teamId 团队预设 ID (如 'code-review', 'feature-dev')
 * @param task 任务描述
 * @param router LLM 路由器
 * @param registry 工具注册表
 * @param userId 用户 ID
 * @param workspace 工作目录
 * @param parentModel 父模型 (可选, 默认用 agentai)
 */
export async function runTeam(
  teamId: string,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<TeamResult> {
  const team = getTeamPreset(teamId);
  if (!team) {
    return {
      teamId,
      teamName: '未知',
      workflow: 'none',
      task,
      results: [],
      summary: `❌ 团队 ${teamId} 不存在。可用团队: code-review, feature-dev, docs, debug, security-audit, refactor`,
      totalDuration: 0,
    };
  }

  const startTime = Date.now();
  let results: MemberResult[] = [];

  switch (team.workflow) {
    case 'parallel':
      results = await runParallel(team, task, router, registry, userId, workspace, parentModel);
      break;
    case 'sequential':
      results = await runSequential(team, task, router, registry, userId, workspace, parentModel);
      break;
    case 'review':
      results = await runReview(team, task, router, registry, userId, workspace, parentModel);
      break;
  }

  const summary = synthesizeResults(team, task, results);
  const totalDuration = Date.now() - startTime;

  return {
    teamId: team.id,
    teamName: team.name,
    workflow: team.workflow,
    task,
    results,
    summary,
    totalDuration,
  };
}

/** 并行模式: 所有成员同时执行 */
async function runParallel(
  team: TeamPreset,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<MemberResult[]> {
  const promises = team.members.map(member =>
    runMember(member, task, router, registry, userId, workspace, parentModel),
  );
  return Promise.all(promises);
}

/** 串行模式: 成员按顺序执行, 后续成员能看到前面的结果 */
async function runSequential(
  team: TeamPreset,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<MemberResult[]> {
  const results: MemberResult[] = [];
  let accumulatedContext = task;

  for (const member of team.members) {
    // 将前面成员的输出附加到任务描述中
    const memberTask = results.length > 0
      ? `${accumulatedContext}\n\n--- 前序成员输出 (${results.map(r => r.name).join(' → ')}) ---\n${results.map(r => `[${r.name}]:\n${r.output.slice(0, 800)}`).join('\n\n')}\n--- 请基于以上内容继续 ---`
      : task;

    const result = await runMember(member, memberTask, router, registry, userId, workspace, parentModel);
    results.push(result);
    accumulatedContext = task;
  }

  return results;
}

/** 审查模式: 先并行执行, 再综合所有结果 */
async function runReview(
  team: TeamPreset,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<MemberResult[]> {
  // 第一阶段: 并行执行
  const parallelResults = await runParallel(team, task, router, registry, userId, workspace, parentModel);

  // 第二阶段: 综合审查 (使用 review 角色)
  const synthesizer: TeamMember = {
    role: 'review',
    name: '综合审查',
    description: '综合所有成员的发现, 生成最终报告',
  };

  const synthTask = `请综合以下团队成员的审查结果, 生成一份结构化报告:\n\n原始任务: ${task}\n\n${parallelResults.map(r => `=== ${r.name} ===\n${r.output.slice(0, 1000)}`).join('\n\n')}\n\n--- 请生成综合报告: 汇总关键发现 → 按优先级排序 → 给出行动建议 ---`;

  const synthResult = await runMember(synthesizer, synthTask, router, registry, userId, workspace, parentModel);

  return [...parallelResults, synthResult];
}

/** 执行单个成员的任务 */
async function runMember(
  member: TeamMember,
  task: string,
  router: AgentAIRouter,
  registry: ToolRegistry,
  userId: string,
  workspace: string,
  parentModel?: string,
): Promise<MemberResult> {
  const startTime = Date.now();
  try {
    const output = await runSubagent(
      member.role,
      task,
      router,
      registry,
      userId,
      workspace,
      parentModel,
    );
    return {
      role: member.role,
      name: member.name,
      success: true,
      output: output || '(无输出)',
      duration: Date.now() - startTime,
    };
  } catch (e: any) {
    return {
      role: member.role,
      name: member.name,
      success: false,
      output: `执行失败: ${e.message || String(e)}`,
      duration: Date.now() - startTime,
    };
  }
}

/** 综合所有成员的结果, 生成摘要 */
function synthesizeResults(team: TeamPreset, task: string, results: MemberResult[]): string {
  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  const lines: string[] = [
    `┌─────────────────────────────────────────────┐`,
    `│  🏆 ${team.name} 执行报告                    │`,
    `├─────────────────────────────────────────────┤`,
    `│  任务: ${task.slice(0, 60)}${task.length > 60 ? '...' : ''}`,
    `│  模式: ${team.workflow} | 成员: ${results.length} | 成功: ${successCount} | 失败: ${failedCount}`,
    `│  总耗时: ${(totalDuration / 1000).toFixed(1)}s`,
    `└─────────────────────────────────────────────┘`,
    ``,
  ];

  for (const r of results) {
    const status = r.success ? '✅' : '❌';
    const duration = `${(r.duration / 1000).toFixed(1)}s`;
    lines.push(`${status} [${r.name}] (${duration})`);
    // 截取每个成员输出的前 300 字符
    const preview = r.output.slice(0, 300);
    lines.push(preview);
    if (r.output.length > 300) lines.push(`... (${r.output.length - 300} 字符省略)`);
    lines.push(``);
  }

  return lines.join('\n');
}
