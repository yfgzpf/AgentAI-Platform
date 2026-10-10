/**
 * Discipline — 端到端验证（D5）
 * ----------------------------------------------------
 * 用真实场景证明纪律层会真的拦住问题，而不是纸面设计。
 *
 * 场景复刻：2026-10-09 删除 41 个网关孤儿文件的真实工作流
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { gateActionPlan, canDeleteFiles, type Anchor } from './gates.js';
import { verifyStage, formatGateResult, type StageGate } from './assertions.js';
import { DisciplineRun, loadNotebook } from './notebook.js';
import { guardzoneUntouched, typecheckClean } from './builtin.js';

/** 依赖 git grep 调用的用例在并发下可能超过默认 10s 超时 */
const GIT_TIMEOUT = 60_000;

const RUN_ID = 'e2e-discipline-001';

describe('D5 · 端到端：复刻「删除网关孤儿文件」真实工作流', () => {
  it('场景：模型想在没有锚点的情况下删文件 → 闸门必须拦住', GIT_TIMEOUT, () => {
    const run = new DisciplineRun('清除网关孤儿文件', { runId: 'e2e-test-001' });
    run.recordDecision('准备删除孤儿文件', { evidence: ['全仓 git grep 验证 41 个文件零引用'] });

    // 模型直接提交删除动作，没建锚点
    const decision = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'ab-testing.ts' }],
      anchors: [],
    }, { cwd: process.cwd() });

    run.recordDenial(decision.reasons);

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some(r => r.includes('锚点'))).toBe(true);
    expect(run.notebook.gateDenials).toHaveLength(1);
  });

  it('场景：删除仍被引用的文件 → 引用校验必须拦住', GIT_TIMEOUT, () => {
    const anchors: Anchor[] = [{ type: 'commit', ref: 'HEAD', description: '模拟已有锚点', createdAt: Date.now() }];
    // goal-runner 确实被 agentai-loop 引用
    const decision = gateActionPlan({
      actions: [{ kind: 'delete-file', target: 'goal-runner' }],
      anchors,
    }, { cwd: process.cwd() });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons.some(r => r.includes('禁止删除'))).toBe(true);
  });

  it('场景：机器验收发现类型错误 → 阶段判失败并落盘', async () => {
    const run = new DisciplineRun('端到端验收验证', { runId: 'e2e-test-002' });
    run.recordDecision('执行重构并验收', { evidence: ['预期 tsc 会报错'] });

    // 故意给一个必然失败的断言
    const result = await run.runStage('refactor', '重构阶段', async () => '假装做了重构', {
      asserts: [{ kind: 'fileExists', path: '/这个文件绝对不存在-e2e' }],
    });

    expect(result.passed).toBe(false);
    expect(result.gateResult!.failedCount).toBe(1);

    // 落盘验证
    const nb = loadNotebook('e2e-test-002');
    expect(nb).not.toBeNull();
    expect(nb!.status).toBe('failed');
    expect(nb!.stages[0]!.gateResult!.passed).toBe(false);
  });

  it('场景：中断后恢复 → 能明确说出已完成/待执行/为何失败', async () => {
    const run = new DisciplineRun('断点续跑验证', { runId: 'e2e-test-003' });
    run.recordDecision('阶段一先做锚点', { evidence: ['工作区有 335 改动'], reversible: true });

    await run.runStage('s1', '建立锚点', async () => '锚点已建 HEAD', {
      asserts: [{ kind: 'command', cmd: 'git --version', expect: 'exit0' }],
    });

    await run.runStage('s2', '删除文件', async () => '删了一部分', {
      asserts: [{ kind: 'fileExists', path: '/不存在-e2e' }],
    });

    const plan = run.resumePlan();

    expect(plan.skipStages).toContain('s1');
    expect(plan.retryStages).toContain('s2');
    expect(plan.context).toContain('建立锚点');
    expect(plan.context).toContain('机器验收');
    expect(plan.context).toContain('恢复指令');
    expect(plan.resumable).toBe(true);

    // 清理
    const p = path.join(process.cwd(), '.workbuddy/runs/e2e-test-003.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  it('场景：绿区保护断言能拦住误伤', async () => {
    // 绿区未被改动时全部通过
    const asserts = guardzoneUntouched('HEAD');
    expect(asserts.length).toBe(6);

    const result = await verifyStage({ stageKey: 'guardzone', asserts }, { cwd: process.cwd() });
    // 当前 HEAD 是纪律层开发前的状态，绿区应干净
    expect(result.passed).toBe(true);
  });

  it('场景：闸门拒绝记录可审计', GIT_TIMEOUT, () => {
    const run = new DisciplineRun('审计验证', { runId: 'e2e-test-004' });
    run.recordDenial(['[delete-file] x.ts: 缺少回滚锚点']);
    run.recordDenial(['[force-push] main: 需要人工审批']);

    expect(run.notebook.gateDenials).toHaveLength(2);
    const ctx = run.resumePlan().context;
    expect(ctx).toContain('被闸门拦下的动作');
    expect(ctx).toContain('force-push');

    const p = path.join(process.cwd(), '.workbuddy/runs/e2e-test-004.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

describe('D5 · 清理', () => {
  it('清理 e2e 测试产物', GIT_TIMEOUT, () => {
    const dir = path.join(process.cwd(), '.workbuddy/runs');
    for (const f of ['e2e-test-001.json', 'e2e-test-002.json', 'e2e-test-003.json', 'e2e-test-004.json']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    expect(true).toBe(true);
  });
});