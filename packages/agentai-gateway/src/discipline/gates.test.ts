/**
 * Discipline — 不可逆闸门单元测试
 * 纪律必须自己先被验证，否则纪律不可信
 */

import { describe, it, expect } from 'vitest';
import {
  gateActionPlan,
  gateAction,
  DEFAULT_RULES,
  listAnchors,
  formatGateDecision,
  canDeleteFiles,
  type ActionItem,
  type Anchor,
} from './gates.js';

const CWD = process.cwd();

/**
 * 生成一个仓库内必然不存在的字符串。
 * 不能写死魔法字符串 —— 本文件自身一旦入库，写死的字符串就会被 git grep 命中，
 * 导致「零引用」用例自我污染（这是实际踩过的坑）。
 */
function uniqTarget(): string {
  return `__no_ref_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}__`;
}

/** 依赖 git grep 调用的用例在 Windows 并发下可能超过默认 10s */
const GIT_TIMEOUT = 60_000;

describe('gates · 规则表完整性', () => {
  it('每种不可逆动作都有规则定义', GIT_TIMEOUT, () => {
    const kinds: Array<keyof typeof DEFAULT_RULES> = [
      'delete-file', 'delete-dir', 'overwrite', 'git-reset', 'git-clean',
      'db-migrate', 'publish', 'external-send', 'force-push', 'kill-process',
    ];
    for (const k of kinds) {
      expect(DEFAULT_RULES[k]).toBeDefined();
      expect(DEFAULT_RULES[k].riskNote.length).toBeGreaterThan(0);
    }
  });

  it('高危动作全部要求人工审批', GIT_TIMEOUT, () => {
    const highRisk: Array<keyof typeof DEFAULT_RULES> = ['git-reset', 'git-clean', 'force-push', 'db-migrate', 'publish', 'external-send', 'delete-dir'];
    for (const k of highRisk) {
      expect(DEFAULT_RULES[k].requiresApproval).toBe(true);
    }
  });

  it('不可逆动作全部要求锚点（kill-process 除外）', GIT_TIMEOUT, () => {
    const needAnchor: Array<keyof typeof DEFAULT_RULES> = ['delete-file', 'delete-dir', 'overwrite', 'git-reset', 'git-clean', 'db-migrate', 'force-push'];
    for (const k of needAnchor) {
      expect(DEFAULT_RULES[k].requiresAnchor).toBe(true);
    }
    expect(DEFAULT_RULES['kill-process'].requiresAnchor).toBe(false);
  });
});

describe('gates · 硬拒绝语义', () => {
  it('无锚点的删除动作被拒绝', GIT_TIMEOUT, () => {
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'definitely-not-exists.ts' }],
      anchors: [],
    }, { cwd: CWD, runDryRun: false });
    expect(d.allowed).toBe(false);
    expect(d.reasons.some(r => r.includes('缺少回滚锚点'))).toBe(true);
  });

  it('有锚点但未预演时仍被拒绝', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'definitely-not-exists.ts' }],
      anchors,
    }, { cwd: CWD, runDryRun: false });
    expect(d.allowed).toBe(false);
    expect(d.reasons.some(r => r.includes('dry run'))).toBe(true);
  });

  it('锚点+预演齐备且无需审批的删除动作被放行', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: uniqTarget() }],
      anchors,
    }, { cwd: CWD });
    expect(d.allowed).toBe(true);
  });

  it('需审批的动作在未审批时拒绝', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'git-clean', target: '' }],
      anchors,
    }, { cwd: CWD });
    expect(d.allowed).toBe(false);
    expect(d.reasons.some(r => r.includes('人工审批'))).toBe(true);
  });

  it('审批后放行', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'git-clean', target: '' }],
      anchors,
      approved: true,
    }, { cwd: CWD });
    expect(d.allowed).toBe(true);
  });

  it('autoApprove 等效于已审批', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'git-clean', target: '' }],
      anchors,
    }, { cwd: CWD, autoApprove: true });
    expect(d.allowed).toBe(true);
  });
});

describe('gates · 删除前引用校验（核心纪律）', () => {
  it('删除仍被引用的文件会被拒绝', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    // goal-runner 被 agentai-loop / routes/goal 引用，属于「仍被引用」
    // 注意：cwd 必须用真实存在的路径。用 process.cwd()（网关包目录），
    // git grep 会向上找到仓库根，仍能检出 src 内的引用。
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'goal-runner' }],
      anchors,
    }, { cwd: process.cwd() });
    expect(d.allowed).toBe(false);
    expect(d.reasons.some(r => r.includes('禁止删除'))).toBe(true);
  });

  it('删除零引用文件被放行', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: uniqTarget() }],
      anchors,
    }, { cwd: process.cwd() });
    expect(d.allowed).toBe(true);
  });

  it('预演失败时拒绝放行（未知状态不等于安全）', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    // 传入不存在的目录 → git grep 无法正常执行 → 必须拒绝而非静默放行
    const d = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'some-file' }],
      anchors,
    }, { cwd: '/绝对不存在的目录xyz' });
    expect(d.allowed).toBe(false);
  });
});

describe('gates · 批量计划', () => {
  it('任一动作被拒则整份计划拒绝', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const actions: ActionItem[] = [
      { kind: 'delete-file', target: uniqTarget() },
      { kind: 'force-push', target: 'main' },  // 未审批 → 拒绝
    ];
    const d = gateActionPlan({ actions, anchors }, { cwd: CWD });
    expect(d.allowed).toBe(false);
    expect(d.denied.length).toBe(1);
    expect(d.denied[0]!.kind).toBe('force-push');
  });

  it('空计划放行', GIT_TIMEOUT, () => {
    const d = gateActionPlan({ actions: [] }, { cwd: CWD });
    expect(d.allowed).toBe(true);
  });
});

describe('gates · 单动作便捷接口', () => {
  it('gateAction 与批量接口结论一致', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const single = gateAction({ kind: 'delete-file', target: uniqTarget() }, { cwd: CWD, anchors });
    const batch = gateActionPlan({ actions: [{ kind: 'delete-file', target: uniqTarget() }], anchors }, { cwd: CWD });
    expect(single.allowed).toBe(batch.allowed);
  });
});

describe('gates · 锚点查询', () => {
  it('能从 git 历史列出锚点', GIT_TIMEOUT, () => {
    const anchors = listAnchors(3, { cwd: CWD });
    expect(Array.isArray(anchors)).toBe(true);
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors[0]!.ref).toBeTruthy();
  });
});

describe('gates · 报告生成', () => {
  it('拒绝时报告含拒绝原因与下一步', GIT_TIMEOUT, () => {
    const d = gateActionPlan({
      actions: [{ kind: 'git-clean', target: '' }],
      anchors: [],
    }, { cwd: CWD });
    const text = formatGateDecision(d);
    expect(text).toContain('拒绝');
    expect(text).toContain('建议下一步');
  });

  it('放行时报告标记放行', GIT_TIMEOUT, () => {
    const d = gateActionPlan({ actions: [] }, { cwd: CWD });
    expect(formatGateDecision(d)).toContain('放行');
  });
});

describe('gates · 删除文件标准流程', () => {
  it('dry-run 模式下不建锚点也不放行', GIT_TIMEOUT, () => {
    const r = canDeleteFiles([uniqTarget()], {
      cwd: CWD,
      runDryRun: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.anchor).toBeUndefined();
  });

  it('提供锚点且目标零引用时放行', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'abc1234', description: 'test', createdAt: Date.now() }];
    const r = canDeleteFiles([uniqTarget()], {
      cwd: process.cwd(),
      anchors,
      runDryRun: true,
      autoApprove: true,
    });
    expect(r.allowed).toBe(true);
    expect(r.message).toContain('放行');
  });
});