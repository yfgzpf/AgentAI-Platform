/**
 * Discipline — 执行记事本单元测试
 * 验证「决策留痕 + 断点恢复 + 处方-执行关联」三条核心链路
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createNotebook,
  newRunId,
  saveNotebook,
  loadNotebook,
  listNotebooks,
  startStage,
  finishStage,
  blockStage,
  recordDecision,
  addAnchor,
  recordGateDenial,
  recordHumanDecision,
  linkPrescription,
  resumeFrom,
  getStage,
  DisciplineRun,
  resumeRun,
} from './notebook.js';

describe('notebook · 基础生命周期', () => {
  it('新记事本初始状态正确', () => {
    const nb = createNotebook('测试目标');
    expect(nb.goal).toBe('测试目标');
    expect(nb.status).toBe('planning');
    expect(nb.stages).toHaveLength(0);
    expect(nb.runId).toMatch(/^run-/);
  });

  it('runId 唯一', () => {
    const ids = new Set([newRunId(), newRunId(), newRunId()]);
    expect(ids.size).toBe(3);
  });
});

describe('notebook · 阶段状态机', () => {
  it('阶段流转：running → passed', () => {
    const nb = createNotebook('t');
    startStage(nb, 's1', '阶段一');
    expect(getStage(nb, 's1')!.status).toBe('running');
    expect(nb.status).toBe('running');

    finishStage(nb, 's1', true, { summary: '完成' });
    expect(getStage(nb, 's1')!.status).toBe('passed');
    expect(nb.status).not.toBe('failed');
  });

  it('阶段失败时整体标记为 failed', () => {
    const nb = createNotebook('t');
    startStage(nb, 's1', '阶段一');
    finishStage(nb, 's1', false, { failureReason: '断言未通过' });
    expect(getStage(nb, 's1')!.status).toBe('failed');
    expect(nb.status).toBe('failed');
  });

  it('阶段阻塞时状态为 paused', () => {
    const nb = createNotebook('t');
    startStage(nb, 's1', '阶段一');
    blockStage(nb, 's1', '等待人工审批');
    expect(getStage(nb, 's1')!.status).toBe('blocked');
    expect(nb.status).toBe('paused');
  });

  it('upsertStage 幂等：不产生重复阶段', () => {
    const nb = createNotebook('t');
    startStage(nb, 's1', '阶段一');
    startStage(nb, 's1', '阶段一改');
    expect(nb.stages.filter(s => s.key === 's1')).toHaveLength(1);
  });
});

describe('notebook · 决策留痕（可审计）', () => {
  it('记录决策含证据与可逆性', () => {
    const nb = createNotebook('t');
    recordDecision(nb, '删文件前先建锚点', {
      evidence: ['git status: 335 改动'],
      reversible: true,
      stageKey: 'cleanup',
    });
    expect(nb.decisionLog).toHaveLength(1);
    expect(nb.decisionLog[0]!.decision).toContain('锚点');
    expect(nb.decisionLog[0]!.evidence).toHaveLength(1);
    expect(nb.decisionLog[0]!.reversible).toBe(true);
  });

  it('决策日志只追加不覆盖', () => {
    const nb = createNotebook('t');
    recordDecision(nb, '决策1');
    recordDecision(nb, '决策2');
    recordDecision(nb, '决策3');
    expect(nb.decisionLog.map(d => d.decision)).toEqual(['决策1', '决策2', '决策3']);
  });

  it('闸门拒绝被记录供审计', () => {
    const nb = createNotebook('t');
    recordGateDenial(nb, ['[delete-file] a.ts: 缺少回滚锚点']);
    expect(nb.gateDenials).toHaveLength(1);
    expect(nb.gateDenials[0]!.reasons[0]).toContain('锚点');
  });

  it('空拒绝列表不入库', () => {
    const nb = createNotebook('t');
    recordGateDenial(nb, []);
    expect(nb.gateDenials).toHaveLength(0);
  });

  it('人工决策与锚点均可记录', () => {
    const nb = createNotebook('t');
    recordHumanDecision(nb, '同意执行 W1', 'fu');
    addAnchor(nb, { type: 'commit', ref: 'abc1234', description: '锚点', createdAt: Date.now() });
    expect(nb.humanDecisions[0]!.by).toBe('fu');
    expect(nb.anchors[0]!.ref).toBe('abc1234');
  });
});

describe('notebook · 处方-执行关联（打通断链）', () => {
  it('关联处方后阶段 key 可追溯', () => {
    const nb = createNotebook('重构前端');
    linkPrescription(nb, { goal: '重构前端', stageKeys: ['anchor', 'w1', 'verify'] });
    expect(nb.prescription!.stageKeys).toHaveLength(3);
    expect(nb.prescription!.goal).toBe('重构前端');
  });
});

describe('notebook · 断点恢复', () => {
  it('已完成阶段进入 skip，已失败进入 retry', () => {
    const nb = createNotebook('t');
    startStage(nb, 'done', '已完成'); finishStage(nb, 'done', true);
    startStage(nb, 'fail', '失败'); finishStage(nb, 'fail', false);
    const plan = resumeFrom(nb);
    expect(plan.skipStages).toContain('done');
    expect(plan.retryStages).toContain('fail');
  });

  it('阻塞阶段导致不可直接恢复', () => {
    const nb = createNotebook('t');
    startStage(nb, 'blocked', '阻塞'); blockStage(nb, 'blocked', '等审批');
    const plan = resumeFrom(nb);
    expect(plan.blockedStages).toContain('blocked');
    expect(plan.resumable).toBe(false);
  });

  it('恢复上下文包含阶段进度与决策留痕', () => {
    const nb = createNotebook('目标X');
    recordDecision(nb, '先建锚点', { evidence: ['335 改动'], reversible: false });
    startStage(nb, 's1', '阶段一');
    finishStage(nb, 's1', true);
    const plan = resumeFrom(nb);
    expect(plan.context).toContain('目标X');
    expect(plan.context).toContain('关键决策留痕');
    expect(plan.context).toContain('先建锚点');
    expect(plan.context).toContain('不可逆');
  });

  it('恢复上下文列出锚点便于回滚', () => {
    const nb = createNotebook('t');
    addAnchor(nb, { type: 'commit', ref: 'sha9999', description: '清理前锚点', createdAt: Date.now() });
    const plan = resumeFrom(nb);
    expect(plan.context).toContain('sha9999');
    expect(plan.context).toContain('清理前锚点');
  });

  it('恢复上下文包含失败断言明细', () => {
    const nb = createNotebook('t');
    startStage(nb, 's1', '阶段一');
    finishStage(nb, 's1', false, {
      failureReason: '2 项未通过',
      gateResult: {
        passed: false,
        failedCount: 1,
        skippedCount: 0,
        totalMs: 10,
        results: [
          { label: 'tsc 零错误', passed: false, observed: '', reason: '发现 2 个错误', durationMs: 5 },
          { label: '绿区未动', passed: true, observed: '无改动', durationMs: 1 },
        ],
      },
    });
    const plan = resumeFrom(nb);
    expect(plan.context).toContain('tsc 零错误');
    expect(plan.context).toContain('发现 2 个错误');
  });
});

describe('notebook · 落盘与恢复', () => {
  it('保存后可加载且内容一致', () => {
    const nb = createNotebook('持久化测试', 'test-persist-001');
    recordDecision(nb, '决策A', { evidence: ['e1'] });
    const r = saveNotebook(nb);
    expect(r.ok).toBe(true);

    const loaded = loadNotebook('test-persist-001');
    expect(loaded).not.toBeNull();
    expect(loaded!.goal).toBe('持久化测试');
    expect(loaded!.decisionLog[0]!.decision).toBe('决策A');
  });

  it('加载不存在的 runId 返回 null', () => {
    expect(loadNotebook('绝对不存在的-run-xyz')).toBeNull();
  });

  it('落盘为合法 JSON 且无临时文件残留', () => {
    const nb = createNotebook('原子写测试', 'test-atomic-001');
    saveNotebook(nb);
    const p = path.join(process.cwd(), '.workbuddy/runs/test-atomic-001.json');
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.existsSync(`${p}.tmp`)).toBe(false);
    JSON.parse(fs.readFileSync(p, 'utf8'));
    fs.unlinkSync(p);
  });

  it('listNotebooks 返回最近记事本', () => {
    const nb = createNotebook('列表测试', 'test-list-001');
    saveNotebook(nb);
    const list = listNotebooks(20);
    expect(list.some(x => x.runId === 'test-list-001')).toBe(true);
    const p = path.join(process.cwd(), '.workbuddy/runs/test-list-001.json');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });
});

describe('DisciplineRun · 高层封装', () => {
  it('runStage 无断言时以执行成功为准', async () => {
    const run = new DisciplineRun('封装测试', { runId: 'test-run-001' });
    const r = await run.runStage('s1', '阶段一', async () => '做完了');
    expect(r.passed).toBe(true);
    expect(r.summary).toBe('做完了');
    expect(run.notebook.status).not.toBe('failed');
  });

  it('runStage 执行抛异常时记为失败而非崩溃', async () => {
    const run = new DisciplineRun('异常测试', { runId: 'test-run-002' });
    const r = await run.runStage('s1', '阶段一', async () => { throw new Error('boom'); });
    expect(r.summary).toContain('boom');
  });

  it('runStage 带机器断言时不通过则标记失败', async () => {
    const run = new DisciplineRun('断言测试', { runId: 'test-run-003' });
    const r = await run.runStage('s1', '阶段一', async () => '做完', {
      asserts: [{ kind: 'fileExists', path: '/绝对不存在的路径xyz' }],
    });
    expect(r.passed).toBe(false);
    expect(r.gateResult!.failedCount).toBe(1);
    expect(run.notebook.status).toBe('failed');
  });

  it('runStage 断言通过时标记成功', async () => {
    const run = new DisciplineRun('断言通过', { runId: 'test-run-004' });
    const r = await run.runStage('s1', '阶段一', async () => '做完', {
      asserts: [{ kind: 'fileExists', path: __filename }],
    });
    expect(r.passed).toBe(true);
    expect(run.notebook.status).not.toBe('failed');
  });

  it('complete / abort 改变状态', () => {
    const run = new DisciplineRun('状态测试', { runId: 'test-run-005' });
    run.complete();
    expect(run.notebook.status).toBe('completed');

    const run2 = new DisciplineRun('中止测试', { runId: 'test-run-006' });
    run2.abort('外部条件不满足');
    expect(run2.notebook.status).toBe('aborted');
    expect(run2.notebook.decisionLog[0]!.decision).toContain('中止');
  });

  it('resumeRun 从落盘记事本恢复', async () => {
    const run = new DisciplineRun('续跑测试', { runId: 'test-run-007' });
    run.recordDecision('决策：先删死代码', { evidence: ['零引用'] });
    await run.runStage('s1', '阶段一', async () => '完成');
    run.block('s2', '等待审批');
    run.complete();

    const resumed = resumeRun('test-run-007');
    expect(resumed).not.toBeNull();
    expect(resumed!.notebook.goal).toBe('续跑测试');
    expect(resumed!.resumePlan().skipStages).toContain('s1');
  });

  it('resumeRun 对不存在的 runId 返回 null', () => {
    expect(resumeRun('绝对不存在的-run-xyz')).toBeNull();
  });

  it('决策与证据全程落盘可查', async () => {
    const run = new DisciplineRun('留痕测试', { runId: 'test-run-008' });
    run.recordDecision('建锚点', { evidence: ['git status: 335'], reversible: true });
    run.addAnchor({ type: 'commit', ref: 'deadbee', description: '锚点', createdAt: Date.now() });

    const loaded = loadNotebook('test-run-008');
    expect(loaded!.decisionLog[0]!.evidence![0]).toBe('git status: 335');
    expect(loaded!.anchors[0]!.ref).toBe('deadbee');
  });
});

describe('cleanup', () => {
  it('清理测试产生的记事本', () => {
    const dir = path.join(process.cwd(), '.workbuddy/runs');
    for (const f of ['test-persist-001.json', 'test-run-001.json', 'test-run-002.json',
                     'test-run-003.json', 'test-run-004.json', 'test-run-005.json',
                     'test-run-006.json', 'test-run-007.json', 'test-run-008.json']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    expect(true).toBe(true);
  });
});