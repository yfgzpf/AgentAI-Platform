/**
 * 专家团编排器
 * =============
 * 对标 WorkBuddy 专家团: 调度-执行模式 (Orchestrator Pattern)
 *
 * 核心规则:
 *   1. 主理人只做编排，不代写专业产出
 *   2. 成员之间不直接通信，所有信息经主理人中转
 *   3. 派发前必须做能力匹配预检
 *   4. 超时和失败有明确终止机制
 */

import { EXPERT_LIBRARY, getExpertPrompt } from './experts.js';
import type { ExpertDefinition } from './expert-prompt.js';  // v3.2 修复: ExpertDefinition 定义在 expert-prompt.ts
import type { AgentAIRouter } from './llm-router.js';
import type { ToolRegistry } from './tool-registry.js';
import { runSubagent } from './subagent.js';

/** 专家团任务定义 */
export interface ExpertTask {
  /** 任务 ID */
  id: string;
  /** 任务描述 */
  description: string;
  /** 指派给哪个专家 */
  assignedTo: string;
  /** 任务状态 */
  status: 'pending' | 'dispatched' | 'running' | 'done' | 'failed';
  /** 开始时间 */
  dispatchedAt?: number;
  /** 完成时间 */
  completedAt?: number;
  /** 输出结果 */
  output?: string;
  /** 错误信息 */
  error?: string;
}

/** 专家团定义 */
export interface ExpertTeamConfig {
  /** 团队名称 */
  name: string;
  /** 主理人 (调度者) */
  orchestrator: string;
  /** 团队成员 */
  members: Array<{
    expertId: string;
    displayName: string;
    responsibilities: string[];
  }>;
  /** 预设工作流 */
  workflows?: Record<string, {
    trigger: string;
    phases: Array<{ expertId: string; task: string }>;
  }>;
}

/** 能力速查表 — 防止误派 */
interface CapabilityCheck {
  intent: string;
  capable: boolean;
  memberHint?: string;
  fallbackMsg?: string;
}

/**
 * 专家团主类
 */
export class ExpertTeam {
  name: string;
  private config: ExpertTeamConfig;
  private tasks: Map<string, ExpertTask> = new Map();
  private workspace: string;
  private router: AgentAIRouter;
  private registry: ToolRegistry;
  private userId: string;

  constructor(
    config: ExpertTeamConfig,
    workspace: string,
    router: AgentAIRouter,
    registry: ToolRegistry,
    userId: string,
  ) {
    this.name = config.name;
    this.config = config;
    this.workspace = workspace;
    this.router = router;
    this.registry = registry;
    this.userId = userId;
  }

  /** 获取团队成员列表 */
  get members() {
    return this.config.members;
  }

  /**
   * 任务分配预检 — 防止把不会的任务派给专家
   */
  capabilityCheck(description: string): CapabilityCheck[] {
    const checks: CapabilityCheck[] = [];
    const lower = description.toLowerCase();

    for (const member of this.config.members) {
      const expert = EXPERT_LIBRARY[member.expertId];
      if (!expert) continue;

      // 基于专家类别和职责的简单匹配
      const matchesResponsibility = member.responsibilities.some(r =>
        lower.includes(r.toLowerCase().slice(0, 4))
      );

      checks.push({
        intent: description,
        capable: expert.category === 'code' ? lower.includes('代码') || lower.includes('code') || matchesResponsibility : true,
        memberHint: member.expertId,
        fallbackMsg: matchesResponsibility ? undefined : `"${member.displayName}" 不适合此任务 (领域: ${expert.category})`,
      });
    }

    return checks;
  }

  /**
   * 调度-执行: 按相位逐步执行
   */
  async execute(workflowName: string, input: Record<string, any>): Promise<{
    success: boolean;
    output: string;
    taskLog: ExpertTask[];
  }> {
    const workflow = this.config.workflows?.[workflowName];
    if (!workflow) {
      return { success: false, output: `未找到工作流: ${workflowName}`, taskLog: [] };
    }

    const taskLog: ExpertTask[] = [];
    const outputs: Record<string, string> = {};

    for (const phase of workflow.phases) {
      const taskId = `${workflowName}-${phase.expertId}-${Date.now()}`;

      // === 预检 ===
      const checks = this.capabilityCheck(phase.task);
      const canDo = checks.find(c => c.memberHint === phase.expertId);
      if (canDo && !canDo.capable) {
        const task: ExpertTask = {
          id: taskId, description: phase.task, assignedTo: phase.expertId,
          status: 'failed', error: canDo.fallbackMsg || '能力不匹配',
        };
        taskLog.push(task);
        return { success: false, output: `分配失败: ${task.error}`, taskLog };
      }

      // === 调度执行 ===
      const task: ExpertTask = { id: taskId, description: phase.task, assignedTo: phase.expertId, status: 'dispatched', dispatchedAt: Date.now() };
      taskLog.push(task);

      try {
        // 获取专家系统提示词
        const expertCtx = getExpertPrompt(phase.expertId);
        const fullTask = expertCtx
          ? `${expertCtx}\n\n---\n\n## 当前任务\n${phase.task}\n\n## 上下文\n${JSON.stringify(input, null, 2)}\n\n## 前置产出\n${JSON.stringify(outputs, null, 2)}`
          : phase.task;

        // 注入上下文到 outputs
        if (Object.keys(outputs).length > 0) {
          input._previousOutputs = outputs;
        }

        task.status = 'running';
        const result = await runSubagent(
          'explore',
          fullTask,
          this.router,
          this.registry,
          this.userId,
          this.workspace,
        );

        task.status = 'done';
        task.completedAt = Date.now();
        task.output = result;
        outputs[phase.expertId] = result;
      } catch (e: any) {
        task.status = 'failed';
        task.error = e.message;
        return {
          success: false,
          output: `阶段 "${phase.task}" 失败 (${phase.expertId}): ${e.message}`,
          taskLog,
        };
      }
    }

    // 汇总所有产出
    const summary = Object.entries(outputs)
      .map(([expertId, output]) => `### ${expertId}\n${output.slice(0, 500)}`)
      .join('\n\n');

    return {
      success: true,
      output: `专家团 "${this.name}" 完成 (${taskLog.length} 个任务):\n\n${summary}`,
      taskLog,
    };
  }
}

/** 预置专家团配置 */
export const EXPERT_TEAM_CONFIGS: Record<string, ExpertTeamConfig> = {
  'content-creation': {
    name: '内容创作专家团',
    orchestrator: 'orchestrator',
    members: [
      { expertId: 'doc-writer', displayName: '长文档写手', responsibilities: ['文档写作', '长文改稿', '章节结构设计', '内容整理'] },
      { expertId: 'data-analyst', displayName: '数据分析师', responsibilities: ['数据洞察', '图表生成', '统计报告'] },
    ],
    workflows: {
      'research-report': {
        trigger: '用户需要调研报告',
        phases: [
          { expertId: 'data-analyst', task: '分析用户提供的材料，提取关键数据和趋势' },
          { expertId: 'doc-writer', task: '基于数据分析结果，撰写结构化调研报告' },
        ],
      },
    },
  },
  'code-quality': {
    name: '代码质量专家团',
    orchestrator: 'orchestrator',
    members: [
      { expertId: 'code-reviewer', displayName: '代码审查专家', responsibilities: ['代码审查', '安全检查', '漏洞扫描', '架构评估'] },
      { expertId: 'architect-ux', displayName: 'UX 架构师', responsibilities: ['UI/UX 设计', 'CSS 架构', '组件系统设计', '前端基础建设'] },
    ],
  },
};
