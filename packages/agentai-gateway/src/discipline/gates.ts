/**
 * Discipline — 不可逆动作闸门 (Irreversible Action Gate)
 * ----------------------------------------------------
 * 有故无死：动手之前先立规矩。
 *
 * 核心问题（2026-10-09 实测）：
 *   approval-policy.ts 管的是「改什么要审批」，
 *   管不了「删之前能不能先看一眼」「有没有回滚点」。
 *   → 系统缺少「不可逆动作前置纪律」这一环。
 *
 * 本模块把资深工程师的删除纪律固化为硬闸门：
 *   1. 删文件前必须逐个验证零引用
 *   2. 不可逆动作前必须有回滚锚点
 *   3. 高危动作（git reset/clean、对外发送）必须人工确认
 *
 * 设计要点：
 *   - 硬拒绝而非软提示：未建锚点就 delete → 直接返回 denied
 *   - 锚点自动可建：提供 createAnchor() 帮调用方一键建 git 锚点
 *   - 与断言层解耦：本模块只做「能不能做」的判断，不执行动作
 */

import { execSync } from 'child_process';
import * as fs from 'fs';

// ===== 类型定义 =====

export type IrreversibleKind =
  | 'delete-file'
  | 'delete-dir'
  | 'overwrite'
  | 'git-reset'
  | 'git-clean'
  | 'db-migrate'
  | 'publish'
  | 'external-send'
  | 'force-push'
  | 'kill-process';

export interface IrreversibleRule {
  kind: IrreversibleKind;
  /** 是否必须先建回滚锚点 */
  requiresAnchor: boolean;
  /** 是否必须先预演 */
  requiresDryRun: boolean;
  /** 是否需要人工确认 */
  requiresApproval: boolean;
  /** 预演命令（返回受影响的文件清单/影响范围） */
  dryRunCmd?: string;
  /** 风险说明（展示给人看的） */
  riskNote: string;
}

// ===== 闸门输入输出 =====

export interface ActionItem {
  kind: IrreversibleKind;
  /** 目标路径或描述 */
  target: string;
  /** 补充说明 */
  note?: string;
}

export interface ActionPlan {
  /** 本次要执行的动作列表 */
  actions: ActionItem[];
  /** 已有的回滚锚点（commit sha / 备份路径） */
  anchors?: Anchor[];
  /** 人工是否已批准 */
  approved?: boolean;
  /** 审批人 */
  approver?: string;
}

export interface Anchor {
  type: 'commit' | 'backup' | 'snapshot';
  /** commit sha 或备份路径 */
  ref: string;
  description: string;
  createdAt: number;
}

export interface GateCheck {
  action: ActionItem;
  rule: IrreversibleRule;
  /** 是否通过 */
  allowed: boolean;
  /** 缺失的前置条件 */
  missing: string[];
  /** 预演输出（若执行了 dry run） */
  dryRunOutput?: string;
}

export interface GateDecision {
  /** 是否允许执行 */
  allowed: boolean;
  checks: GateCheck[];
  /** 所有被拒绝的动作 */
  denied: ActionItem[];
  /** 拒绝原因汇总 */
  reasons: string[];
  /** 建议的下一步 */
  nextSteps: string[];
}

export interface GateContext {
  cwd?: string;
  /** 是否跳过人工审批（用于自动化测试/CI） */
  autoApprove?: boolean;
  /** 是否实际执行预演命令（默认 true） */
  runDryRun?: boolean;
}

// ===== 默认规则表 =====

export const DEFAULT_RULES: Record<IrreversibleKind, IrreversibleRule> = {
  'delete-file': {
    kind: 'delete-file',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: false,
    dryRunCmd: 'git grep -l',
    riskNote: '删除文件不可撤销。必须先验证零引用 + 有回滚锚点。',
  },
  'delete-dir': {
    kind: 'delete-dir',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: true,
    dryRunCmd: 'git ls-files',
    riskNote: '删除目录影响面大，必须人工确认范围。',
  },
  overwrite: {
    kind: 'overwrite',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: false,
    dryRunCmd: 'git diff',
    riskNote: '覆写已有文件会丢失原内容，需可回滚。',
  },
  'git-reset': {
    kind: 'git-reset',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: true,
    dryRunCmd: 'git status --short',
    riskNote: 'git reset 会丢弃未提交改动，高危，必须人工确认。',
  },
  'git-clean': {
    kind: 'git-clean',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: true,
    dryRunCmd: 'git status --short',
    riskNote: 'git clean 会永久删除未跟踪文件，极高危，必须人工确认。',
  },
  'db-migrate': {
    kind: 'db-migrate',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: true,
    riskNote: '数据库迁移不可逆，必须先备份 + dry-run + 人工确认。',
  },
  publish: {
    kind: 'publish',
    requiresAnchor: false,
    requiresDryRun: true,
    requiresApproval: true,
    riskNote: '发布是对外行为，内容一旦流出无法撤回，必须人工确认。',
  },
  'external-send': {
    kind: 'external-send',
    requiresAnchor: false,
    requiresDryRun: true,
    requiresApproval: true,
    riskNote: '对外发送（QQ/微信/公众号）内容不可撤回，必须人工确认。',
  },
  'force-push': {
    kind: 'force-push',
    requiresAnchor: true,
    requiresDryRun: true,
    requiresApproval: true,
    riskNote: '强制推送会覆盖远端历史，极高危，必须人工确认。',
  },
  'kill-process': {
    kind: 'kill-process',
    requiresAnchor: false,
    requiresDryRun: false,
    requiresApproval: false,
    riskNote: '结束进程通常可恢复，无需锚点。',
  },
};

// ===== 工具 =====

function hasAnchor(anchors: Anchor[] | undefined, kind: IrreversibleKind): boolean {
  if (!anchors || anchors.length === 0) return false;
  // 有任意有效锚点即可（git commit 锚点最通用）
  return anchors.some(a => !!a.ref);
}

function runDryRun(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
    });
    return { ok: true, output: output.trim() };
  } catch (e: any) {
    return { ok: false, output: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
  }
}

/** 删除类预演：返回引用数/文件数（无管道版 — Windows 不支持 `| wc -l`，JS 侧计数）。
 *  git grep exit 1 = 无匹配 → 0 引用是有效结果，不是失败。 */
function runDryRunCount(cmd: string, cwd: string): { ok: boolean; count: number | null; raw: string } {
  try {
    const raw = execSync(
      cmd,
      {
        cwd,
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 4 * 1024 * 1024,
      },
    ).trim();
    return { ok: true, count: raw === '' ? 0 : raw.split(/\r?\n/).length, raw };
  } catch (e: any) {
    // git grep: exit 1 = 无匹配 → 0 引用；exit >= 2 或命令本身失败 → 真失败
    if (e.status === 1) {
      return { ok: true, count: 0, raw: '' };
    }
    return { ok: false, count: null, raw: `${e.stdout || ''}`.trim() || e.message };
  }
}

function truncate(s: string, max = 800): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

// ===== 核心：闸门判定 =====

/**
 * 判定一份动作计划是否允许执行。
 *
 * 硬拒绝语义：只要有一个动作缺前置条件，整份计划被拒。
 * 这是纪律的核心 —— 「想都别想」，而不是「提示一下」。
 */
export function gateActionPlan(plan: ActionPlan, ctx: GateContext = {}): GateDecision {
  const cwd = ctx.cwd || process.cwd();
  const shouldRunDry = ctx.runDryRun !== false;
  const approved = plan.approved === true || ctx.autoApprove === true;

  const checks: GateCheck[] = [];
  const denied: ActionItem[] = [];
  const reasons: string[] = [];
  const nextSteps: string[] = [];

  for (const action of plan.actions) {
    const rule = DEFAULT_RULES[action.kind];
    const missing: string[] = [];

    // 1. 锚点检查
    if (rule.requiresAnchor && !hasAnchor(plan.anchors, action.kind)) {
      missing.push('缺少回滚锚点');
    }

    // 2. 预演检查
    let dryRunOutput: string | undefined;
    if (rule.requiresDryRun) {
      if (!shouldRunDry) {
        missing.push('未执行预演（dry run）');
      } else if (action.kind === 'delete-file' || action.kind === 'delete-dir') {
        // 删除类动作：预演就是「查引用」/「列文件」（无管道版，JS 侧计数）
        const cmd = action.kind === 'delete-file'
          ? `git grep -l "${action.target}" -- .`
          : `git ls-files "${action.target}"`;
        const r = runDryRunCount(cmd, cwd);

        // 安全底线：预演失败/无法计数 ≠ 通过。宁可拒绝也不放行未知状态。
        if (!r.ok || r.count === null) {
          missing.push(
            !r.ok
              ? `预演执行失败，无法确认影响范围（${truncate(r.raw, 120) || '无输出'}）`
              : '预演未返回可解析的计数，禁止在未知状态下删除',
          );
        } else {
          dryRunOutput = `引用数/文件数: ${r.count}`;
          if (action.kind === 'delete-file' && r.count > 0) {
            missing.push(`目标仍被引用 ${r.count} 处，禁止删除`);
          }
        }
      } else {
        const cmd = rule.dryRunCmd
          ? `${rule.dryRunCmd} ${action.kind === 'git-reset' || action.kind === 'git-clean' ? '' : action.target}`.trim()
          : 'git status --short';
        const r = runDryRun(cmd, cwd);
        dryRunOutput = truncate(r.output) || '(无变更)';
      }
    }

    // 3. 人工审批检查
    if (rule.requiresApproval && !approved) {
      missing.push('需要人工审批');
    }

    const allowed = missing.length === 0;
    checks.push({ action, rule, allowed, missing, dryRunOutput });

    if (!allowed) {
      denied.push(action);
      reasons.push(`[${action.kind}] ${action.target}: ${missing.join('；')}`);
    }
  }

  // 生成建议
  if (denied.length > 0) {
    if (denied.some(a => DEFAULT_RULES[a.kind].requiresAnchor)) {
      nextSteps.push('① 先建回滚锚点：createAnchor() 或 git add -A && git commit -m "checkpoint"');
    }
    if (denied.some(a => DEFAULT_RULES[a.kind].requiresApproval)) {
      nextSteps.push('② 提交人工审批，附上 dry-run 输出作为依据');
    }
    if (denied.some(a => DEFAULT_RULES[a.kind].requiresDryRun)) {
      nextSteps.push('③ 确认预演输出无异常后重试');
    }
  }

  return {
    allowed: denied.length === 0,
    checks,
    denied,
    reasons,
    nextSteps,
  };
}

/**
 * 便捷判定：单个动作是否允许
 */
export function gateAction(action: ActionItem, ctx: GateContext & { anchors?: Anchor[]; approved?: boolean } = {}): GateDecision {
  return gateActionPlan({ actions: [action], anchors: ctx.anchors, approved: ctx.approved }, ctx);
}

// ===== 锚点管理 =====

/**
 * 建 git 回滚锚点。这是纪律的第一步，也是最容易被跳过的一步。
 * 注意：只提交，不推送；不执行任何破坏性 git 操作。
 */
export function createAnchor(
  description: string,
  ctx: { cwd?: string; dryRun?: boolean } = {},
): { ok: boolean; anchor?: Anchor; output: string } {
  const cwd = ctx.cwd || process.cwd();

  if (ctx.dryRun) {
    const status = runDryRun('git status --short', cwd);
    return {
      ok: false,
      output: `[预演] 当前有 ${status.output.split('\n').filter(Boolean).length} 处变更，未执行提交：\n${truncate(status.output)}`,
    };
  }

  try {
    execSync('git add -A', { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    execSync('git commit -q --no-verify -m "checkpoint: ' + description + '"', {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    const sha = execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8' }).trim();
    return {
      ok: true,
      anchor: { type: 'commit', ref: sha, description, createdAt: Date.now() },
      output: `锚点已建立: ${sha} (${description})`,
    };
  } catch (e: any) {
    return { ok: false, output: `建锚点失败: ${e.message}` };
  }
}

/**
 * 从 git 历史查最近 N 个锚点（用于断点续跑时恢复上下文）
 */
export function listAnchors(limit = 5, ctx: { cwd?: string } = {}): Anchor[] {
  const cwd = ctx.cwd || process.cwd();
  try {
    const out = execSync(`git log --oneline -${limit}`, { cwd, encoding: 'utf8', timeout: 10_000 });
    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [sha, ...rest] = line.split(/\s+/);
        return {
          type: 'commit' as const,
          ref: sha || '',
          description: rest.join(' '),
          createdAt: Date.now(),
        };
      });
  } catch {
    return [];
  }
}

// ===== 报告生成 =====

/**
 * 生成人类可读的闸门报告（展示给用户确认时用）
 */
export function formatGateDecision(d: GateDecision): string {
  const lines: string[] = [];
  lines.push(`动作闸门判定: ${d.allowed ? '✅ 放行' : '⛔ 拒绝'}`);
  lines.push('');

  for (const c of d.checks) {
    const icon = c.allowed ? '✅' : '⛔';
    lines.push(`${icon} [${c.action.kind}] ${c.action.target}`);
    lines.push(`   风险: ${c.rule.riskNote}`);
    if (c.dryRunOutput) {
      lines.push(`   预演: ${truncate(c.dryRunOutput, 300)}`);
    }
    if (c.missing.length > 0) {
      lines.push(`   缺失: ${c.missing.join('；')}`);
    }
    lines.push('');
  }

  if (!d.allowed) {
    lines.push('拒绝原因:');
    for (const r of d.reasons) lines.push(`  - ${r}`);
    lines.push('');
    lines.push('建议下一步:');
    for (const s of d.nextSteps) lines.push(`  ${s}`);
  }

  return lines.join('\n');
}

// ===== 便捷封装 =====

/**
 * 删除文件的标准流程：先建锚点 → 过闸门 → 才允许删
 * 返回 false 表示被闸门拒绝，调用方必须停止。
 */
export function canDeleteFiles(
  files: string[],
  ctx: GateContext & { anchorDescription?: string; anchors?: Anchor[]; approved?: boolean } = {},
): { allowed: boolean; decision: GateDecision; anchor?: Anchor; message: string } {
  // 1. 复用调用方已提供的锚点，否则自动建一个
  const existing = ctx.anchors;
  let anchor: Anchor | undefined;

  if ((!existing || existing.length === 0) && ctx.runDryRun !== true) {
    const r = createAnchor(ctx.anchorDescription || '删除文件前锚点', { cwd: ctx.cwd });
    if (r.ok && r.anchor) anchor = r.anchor;
  }

  // 2. 过闸门
  const decision = gateActionPlan(
    {
      actions: files.map(f => ({ kind: 'delete-file' as const, target: f })),
      anchors: existing || (anchor ? [anchor] : undefined),
      approved: ctx.autoApprove,
    },
    ctx,
  );

  return {
    allowed: decision.allowed,
    decision,
    anchor,
    message: formatGateDecision(decision),
  };
}