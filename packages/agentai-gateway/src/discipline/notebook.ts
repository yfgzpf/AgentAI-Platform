/**
 * Discipline — 执行记事本 (Run Notebook)
 * ----------------------------------------------------
 * 察其所由：把「为什么这么做」落盘，让执行可跨会话、可审计、可恢复。
 *
 * 核心问题（2026-10-09 实测）：
 *   goal-runner 的 GoalProgress 只存在于内存，进程重启即丢。
 *   task-scheduler / task-ledger 在，但缺「谁在第几步、卡在哪、为何卡、
 *   上次验证结果」的持久视图。
 *   → 中断后只能靠模型自己回忆，条理性就丢了。
 *
 * 本模块同时解决审计发现的 P0 缺口「处方-执行断链」：
 *   GoalPlan（处方）  ←→  RunNotebook（执行）
 *   两者用 runId 关联，形成「望闻问切 → 辨证论治 → 用药施治 → 随访」完整链路。
 *
 * 设计要点：
 *   - 每次落盘即完成一次 checkIn（append-only 语义，避免并发覆盖丢记录）
 *   - 决策留痕含证据（decision + evidence），这是「可审计」的核心
 *   - resumeFrom 生成恢复计划，明确「从哪继续、还剩什么、为什么卡」
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Anchor } from './gates.js';
import type { GateResult } from './assertions.js';

// ===== 类型定义 =====

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked' | 'skipped';

export interface DecisionEntry {
  at: number;
  /** 决策内容：「删 W1 前先建锚点，因为工作区有 335 个未提交改动」 */
  decision: string;
  /** 支撑证据：['git status: 335 files', 'tsc baseline: 0 errors'] */
  evidence?: string[];
  /** 是否可逆 */
  reversible?: boolean;
  /** 关联阶段 */
  stageKey?: string;
}

export interface StageRecord {
  key: string;
  label: string;
  status: StageStatus;
  startedAt?: number;
  endedAt?: number;
  /** 机器验收结果 */
  gateResult?: GateResult;
  /** 失败/阻塞原因 */
  failureReason?: string;
  /** 摘要（LLM 或子流程产出） */
  summary?: string;
  /** 重试次数 */
  retries?: number;
}

export interface RunNotebook {
  runId: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  /** 状态 */
  status: 'planning' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
  /** 决策留痕（append-only） */
  decisionLog: DecisionEntry[];
  /** 阶段记录 */
  stages: StageRecord[];
  /** 锚点链 */
  anchors: Anchor[];
  /** 闸门拒绝记录 */
  gateDenials: Array<{ at: number; reasons: string[] }>;
  /** 人工决策记录 */
  humanDecisions: Array<{ at: number; decision: string; by?: string }>;
  /** 关联的处方（GoalPlan 摘要） */
  prescription?: {
    goal: string;
    stageKeys: string[];
    createdAt: number;
  };
}

// ===== 恢复计划 =====

export interface ResumePlan {
  runId: string;
  /** 应跳过的阶段（已完成） */
  skipStages: string[];
  /** 应重试的阶段（失败可重试） */
  retryStages: string[];
  /** 阻塞待人工处理 */
  blockedStages: string[];
  /** 恢复上下文（给模型看的自然语言摘要） */
  context: string;
  /** 是否可直接恢复（无阻塞项且有可跳过阶段） */
  resumable: boolean;
}

// ===== 路径管理 =====

function getNotebookDir(): string {
  // 优先用项目内 .workbuddy/runs，回退到用户目录
  const projectDir = path.resolve(process.cwd(), '.workbuddy/runs');
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    return projectDir;
  } catch {
    const fallback = path.join(require('os').homedir(), '.agentai', 'runs');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

function notebookPath(runId: string): string {
  const safeId = runId.replace(/[^\w-]/g, '_');
  return path.join(getNotebookDir(), `${safeId}.json`);
}

// ===== 创建 =====

export function newRunId(prefix = 'run'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 创建新记事本
 */
export function createNotebook(
  goal: string,
  runId?: string,
): RunNotebook {
  const now = Date.now();
  return {
    runId: runId || newRunId(),
    goal,
    createdAt: now,
    updatedAt: now,
    status: 'planning',
    decisionLog: [],
    stages: [],
    anchors: [],
    gateDenials: [],
    humanDecisions: [],
  };
}

// ===== 落盘 =====

/**
 * 保存记事本。写入采用「临时文件 + 原子重命名」，避免中途崩溃产生半截文件。
 */
export function saveNotebook(nb: RunNotebook): { ok: boolean; path: string; error?: string } {
  try {
    nb.updatedAt = Date.now();
    const p = notebookPath(nb.runId);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(nb, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return { ok: true, path: p };
  } catch (e: any) {
    return { ok: false, path: '', error: e?.message || String(e) };
  }
}

export function loadNotebook(runId: string): RunNotebook | null {
  try {
    const p = notebookPath(runId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as RunNotebook;
  } catch {
    return null;
  }
}

/**
 * 列出最近的记事本
 */
export function listNotebooks(limit = 10): Array<{ runId: string; goal: string; status: string; updatedAt: number; stageCount: number }> {
  try {
    const dir = getNotebookDir();
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => {
        try {
          const nb = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as RunNotebook;
          return { runId: nb.runId, goal: nb.goal, status: nb.status, updatedAt: nb.updatedAt, stageCount: nb.stages.length };
        } catch { return null; }
      })
      .filter(Boolean) as Array<{ runId: string; goal: string; status: string; updatedAt: number; stageCount: number }>;
    return files.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  } catch {
    return [];
  }
}

// ===== 阶段管理 =====

/**
 * 登记阶段（幂等：已存在则更新）
 */
export function upsertStage(nb: RunNotebook, stage: StageRecord): RunNotebook {
  const idx = nb.stages.findIndex(s => s.key === stage.key);
  if (idx >= 0) {
    nb.stages[idx] = { ...nb.stages[idx], ...stage };
  } else {
    nb.stages.push(stage);
  }
  return nb;
}

export function getStage(nb: RunNotebook, key: string): StageRecord | undefined {
  return nb.stages.find(s => s.key === key);
}

/**
 * 阶段开始
 */
export function startStage(nb: RunNotebook, key: string, label: string): RunNotebook {
  upsertStage(nb, { key, label, status: 'running', startedAt: Date.now() });
  nb.status = 'running';
  return nb;
}

/**
 * 阶段完成（带机器验收结果）
 */
export function finishStage(
  nb: RunNotebook,
  key: string,
  passed: boolean,
  opts: { gateResult?: GateResult; summary?: string; failureReason?: string; retries?: number } = {},
): RunNotebook {
  upsertStage(nb, {
    key,
    label: getStage(nb, key)?.label || key,
    status: passed ? 'passed' : 'failed',
    endedAt: Date.now(),
    gateResult: opts.gateResult,
    summary: opts.summary,
    failureReason: opts.failureReason,
    retries: opts.retries,
  });
  if (!passed) nb.status = 'failed';
  return nb;
}

/**
 * 阶段阻塞（等待人工审批）
 */
export function blockStage(nb: RunNotebook, key: string, reason: string): RunNotebook {
  upsertStage(nb, {
    key,
    label: getStage(nb, key)?.label || key,
    status: 'blocked',
    failureReason: reason,
  });
  nb.status = 'paused';
  return nb;
}

// ===== 留痕 =====

/**
 * 记录决策。这是「可审计」的核心。
 */
export function recordDecision(
  nb: RunNotebook,
  decision: string,
  opts: { evidence?: string[]; reversible?: boolean; stageKey?: string } = {},
): RunNotebook {
  nb.decisionLog.push({
    at: Date.now(),
    decision,
    evidence: opts.evidence,
    reversible: opts.reversible,
    stageKey: opts.stageKey,
  });
  return nb;
}

/**
 * 登记锚点
 */
export function addAnchor(nb: RunNotebook, anchor: Anchor): RunNotebook {
  nb.anchors.push(anchor);
  return nb;
}

/**
 * 记录闸门拒绝（审计用：哪些动作被拦下来了）
 */
export function recordGateDenial(nb: RunNotebook, reasons: string[]): RunNotebook {
  if (reasons.length === 0) return nb;
  nb.gateDenials.push({ at: Date.now(), reasons });
  return nb;
}

/**
 * 记录人工决策
 */
export function recordHumanDecision(nb: RunNotebook, decision: string, by?: string): RunNotebook {
  nb.humanDecisions.push({ at: Date.now(), decision, by });
  return nb;
}

/**
 * 关联处方（打通处方-执行断链）
 */
export function linkPrescription(
  nb: RunNotebook,
  prescription: { goal: string; stageKeys: string[] },
): RunNotebook {
  nb.prescription = { ...prescription, createdAt: Date.now() };
  return nb;
}

// ===== 恢复 =====

/**
 * 从记事本生成恢复计划。
 * 这是「连续状态监控」的核心：断了能自己接上。
 */
export function resumeFrom(nb: RunNotebook): ResumePlan {
  const skipStages = nb.stages.filter(s => s.status === 'passed' || s.status === 'skipped').map(s => s.key);
  const retryStages = nb.stages.filter(s => s.status === 'failed').map(s => s.key);
  const blockedStages = nb.stages.filter(s => s.status === 'blocked').map(s => s.key);
  const pendingStages = nb.stages.filter(s => s.status === 'pending').map(s => s.key);
  const runningStages = nb.stages.filter(s => s.status === 'running').map(s => s.key);

  const lines: string[] = [];
  lines.push(`## 执行恢复上下文 (runId: ${nb.runId})`);
  lines.push(`**原目标**: ${nb.goal}`);
  lines.push(`**当前状态**: ${nb.status}`);
  lines.push(`**最后更新**: ${new Date(nb.updatedAt).toLocaleString('zh-CN')}`);
  lines.push('');

  lines.push('### 阶段进度');
  for (const s of nb.stages) {
    const icon = { passed: 'OK', failed: 'FAIL', blocked: 'BLOCK', running: 'RUN', pending: 'TODO', skipped: 'SKIP' }[s.status];
    lines.push(`- [${icon}] ${s.label || s.key}${s.failureReason ? ` — ${s.failureReason}` : ''}`);
    if (s.gateResult) {
      lines.push(`      机器验收: ${s.gateResult.passed ? '通过' : '未通过'} (${s.gateResult.results.length - s.gateResult.failedCount}/${s.gateResult.results.length})`);
      for (const r of s.gateResult.results.filter(r => !r.passed)) {
        lines.push(`      - FAIL: ${r.label}${r.reason ? ` (${r.reason})` : ''}`);
      }
    }
  }
  lines.push('');

  if (nb.decisionLog.length > 0) {
    lines.push('### 关键决策留痕（不要重复已做过的判断）');
    for (const d of nb.decisionLog.slice(-10)) {
      lines.push(`- [${d.reversible === false ? '不可逆' : '可逆'}] ${d.decision}`);
      if (d.evidence?.length) lines.push(`      证据: ${d.evidence.join('; ')}`);
    }
    lines.push('');
  }

  if (nb.gateDenials.length > 0) {
    lines.push('### 被闸门拦下的动作（这些前置条件未满足）');
    for (const g of nb.gateDenials.slice(-5)) {
      for (const r of g.reasons) lines.push(`- ${r}`);
    }
    lines.push('');
  }

  if (nb.humanDecisions.length > 0) {
    lines.push('### 人工决策记录');
    for (const h of nb.humanDecisions) {
      lines.push(`- ${h.decision}${h.by ? ` (by ${h.by})` : ''}`);
    }
    lines.push('');
  }

  if (nb.anchors.length > 0) {
    lines.push('### 回滚锚点（可回到任一状态）');
    for (const a of nb.anchors) {
      lines.push(`- ${a.ref} — ${a.description}`);
    }
    lines.push('');
  }

  lines.push('### 恢复指令');
  if (skipStages.length > 0) lines.push(`- 跳过已完成阶段: ${skipStages.join(', ')}`);
  if (retryStages.length > 0) lines.push(`- 重试失败阶段: ${retryStages.join(', ')}`);
  if (blockedStages.length > 0) lines.push(`- 阻塞待人工: ${blockedStages.join(', ')}`);
  if (pendingStages.length > 0) lines.push(`- 待执行: ${pendingStages.join(', ')}`);
  if (runningStages.length > 0) lines.push(`- 中断时正在跑（需重新执行）: ${runningStages.join(', ')}`);

  return {
    runId: nb.runId,
    skipStages,
    retryStages,
    blockedStages,
    context: lines.join('\n'),
    resumable: blockedStages.length === 0,
  };
}

// ===== 便捷封装 =====

/**
 * 高层执行上下文：把记事本 + 阶段执行 + 断言 + 闸门串起来。
 *
 * 用法：
 *   const ex = new DisciplineRun('重构前端');
 *   ex.recordDecision('先建锚点', { evidence: ['工作区 335 改动'] });
 *   await ex.runStage('cleanup', '清除死代码', async () => {
 *     // 实际执行
 *   }, { asserts: postDeleteStandard() });
 */
export class DisciplineRun {
  private nb: RunNotebook;
  private cwd: string;

  constructor(goal: string, opts: { runId?: string; cwd?: string } = {}) {
    this.nb = createNotebook(goal, opts.runId);
    this.cwd = opts.cwd || process.cwd();
  }

  get notebook(): RunNotebook { return this.nb; }
  get runId(): string { return this.nb.runId; }

  /** 关联处方 */
  linkPrescription(stageKeys: string[]): void {
    linkPrescription(this.nb, { goal: this.nb.goal, stageKeys });
    this.flush();
  }

  /** 记录决策 */
  recordDecision(decision: string, opts: { evidence?: string[]; reversible?: boolean; stageKey?: string } = {}): void {
    recordDecision(this.nb, decision, opts);
    this.flush();
  }

  /** 登记锚点 */
  addAnchor(anchor: Anchor): void {
    addAnchor(this.nb, anchor);
    this.flush();
  }

  /** 落盘 */
  flush(): void {
    saveNotebook(this.nb);
  }

  /** 标记阶段开始（只登记状态，不执行） */
  markStageStart(key: string, label: string): void {
    startStage(this.nb, key, label);
    this.flush();
  }

  /** 标记阶段完成（只登记结果，不执行） */
  markStageEnd(key: string, passed: boolean, opts: { gateResult?: GateResult; summary?: string; failureReason?: string; retries?: number } = {}): void {
    finishStage(this.nb, key, passed, opts);
    this.flush();
  }

  /**
   * 执行一个带纪律的阶段。
   * 流程：登记开始 → 执行 → 机器验收 → 记录结果 → 落盘
   */
  async runStage(
    key: string,
    label: string,
    executor: () => Promise<string>,
    opts: {
      asserts?: import('./assertions.js').AcceptanceAssert[];
      judgeContent?: string;
      llmJudge?: import('./assertions.js').RunContext['llmJudge'];
      maxRetries?: number;
    } = {},
  ): Promise<{ passed: boolean; summary: string; gateResult?: import('./assertions.js').GateResult }> {
    startStage(this.nb, key, label);
    this.flush();

    const maxRetries = opts.maxRetries ?? 0;
    let lastSummary = '';
    let lastGate: import('./assertions.js').GateResult | undefined;
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        lastSummary = await executor();
      } catch (e: any) {
        lastSummary = `执行异常: ${e?.message || e}`;
      }

      if (opts.asserts && opts.asserts.length > 0) {
        const { verifyStage } = await import('./assertions.js');
        lastGate = await verifyStage(
          { stageKey: key, asserts: opts.asserts },
          { cwd: this.cwd, judgeContent: opts.judgeContent ?? lastSummary, llmJudge: opts.llmJudge },
        );
        if (lastGate.passed) break;
        retries++;
      } else {
        break;
      }
    }

    const passed = lastGate ? lastGate.passed : true;
    finishStage(this.nb, key, passed, {
      gateResult: lastGate,
      summary: lastSummary.slice(0, 1000),
      failureReason: passed ? undefined : `${lastGate?.failedCount} 项机器断言未通过`,
      retries,
    });
    this.flush();

    return { passed, summary: lastSummary, gateResult: lastGate };
  }

  /** 标记阻塞（等人工） */
  block(key: string, reason: string): void {
    blockStage(this.nb, key, reason);
    this.flush();
  }

  /** 记录闸门拒绝 */
  recordDenial(reasons: string[]): void {
    recordGateDenial(this.nb, reasons);
    this.flush();
  }

  /** 记录人工决策 */
  recordHuman(decision: string, by?: string): void {
    recordHumanDecision(this.nb, decision, by);
    this.flush();
  }

  /** 完成 */
  complete(): void {
    this.nb.status = 'completed';
    this.flush();
  }

  /** 中止 */
  abort(reason: string): void {
    this.nb.status = 'aborted';
    recordDecision(this.nb, `中止: ${reason}`, { reversible: true });
    this.flush();
  }

  /** 生成恢复计划 */
  resumePlan(): ResumePlan {
    return resumeFrom(this.nb);
  }
}

/**
 * 从已有记事本恢复一个执行上下文
 */
export function resumeRun(runId: string, opts: { cwd?: string } = {}): DisciplineRun | null {
  const nb = loadNotebook(runId);
  if (!nb) return null;
  const run = new DisciplineRun(nb.goal, { runId: nb.runId, cwd: opts.cwd });
  // 用落盘的数据覆盖新建的空记事本
  (run as any).nb = nb;
  return run;
}