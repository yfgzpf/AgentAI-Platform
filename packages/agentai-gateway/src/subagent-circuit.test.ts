/**
 * 模型级熔断器测试 — 2026-10-21 晚 (富哥: "模型能力不行就不给它")
 * ----------------------------------------------------------------
 * 富哥原话: 「如果检测到有的模型子智能调用老是用不好/失败/乱派发/没有精简派发,
 * 老是超时, 可以不再派发子智能体工具给它。系统的监督作用就要发挥出来, 模型能力
 * 不行就不给它, 因为会导致任务动不动就中断了。」
 *
 * 熔断器三态 (closed → open → half-open):
 *   closed    正常 — spawn_subagent 在工具列表里
 *   open      摘工具 — 该模型的委托坏结局率/无理由率超阈值 (样本≥3)
 *   half-open TTL (30min) 到 → 放 1 次试跑: 又坏 → 重新 open; 好 → closed 清零
 * 坏结局 = failed/timeout/gated (被策略拦=不看规则); noReason (不传理由) 是独立的
 *   乱派发信号, 单独计率; 半开时 1 次坏 (含 noReason) 即重新 open。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  recordSpawnOutcome, modelSubagentHealth, shouldStripSubagentForModel,
  resetModelCircuitForTest, CIRCUIT_MIN_SAMPLES, CIRCUIT_BAD_RATE,
  CIRCUIT_NO_REASON_RATE, CIRCUIT_TTL_MS,
} from './subagent-schema.js';

const loopSrc = fs.readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');

beforeEach(() => {
  resetModelCircuitForTest();
  vi.useFakeTimers({ toFake: ['Date'] }); // 只 mock Date.now, 不掐 setTimeout
  vi.setSystemTime(new Date('2026-10-21T15:00:00+08:00'));
});
afterEach(() => {
  vi.useRealTimers();
  resetModelCircuitForTest();
});

describe('模型级熔断: 判据 (closed → open)', () => {
  it('① 样本不足不判: 2 次失败也不熔 (防偶然误伤, 方案级 MIN_SAMPLES=3)', () => {
    recordSpawnOutcome('agnes', 'failed');
    recordSpawnOutcome('agnes', 'failed');
    expect(modelSubagentHealth('agnes').tripped).toBe(false);
    expect(shouldStripSubagentForModel('agnes')).toBe(false);
    expect(modelSubagentHealth('agnes').total).toBe(2);
  });

  it('② 3 次 failed (100% 坏结局) → 熔断 + 摘工具', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    const h = modelSubagentHealth('agnes');
    expect(h.tripped).toBe(true);
    expect(h.badRate).toBe(1);
    expect(shouldStripSubagentForModel('agnes')).toBe(true);
  });

  it('③ success/partial 不算坏: 2 success + 1 failed (33%) → 不熔', () => {
    recordSpawnOutcome('deepseek', 'success');
    recordSpawnOutcome('deepseek', 'partial');
    recordSpawnOutcome('deepseek', 'failed');
    expect(modelSubagentHealth('deepseek').tripped).toBe(false);
    expect(shouldStripSubagentForModel('deepseek')).toBe(false);
  });

  it('④ gated (被策略拦=不看规则) 计入坏结局: 3 次 gated → 熔断', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('bad-model', 'gated');
    expect(modelSubagentHealth('bad-model').tripped).toBe(true);
    expect(shouldStripSubagentForModel('bad-model')).toBe(true);
  });

  it('⑤ timeout 计入坏结局: 3 次 timeout → 熔断', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('slow-model', 'timeout');
    expect(modelSubagentHealth('slow-model').tripped).toBe(true);
  });

  it('⑥ 乱派发信号: noReason 率 ≥60% 也熔 (3 noReason + 1 success)', () => {
    recordSpawnOutcome('noisy', 'noReason');
    recordSpawnOutcome('noisy', 'noReason');
    recordSpawnOutcome('noisy', 'noReason');
    recordSpawnOutcome('noisy', 'success');
    const h = modelSubagentHealth('noisy');
    expect(h.noReason).toBe(3);
    expect(h.total).toBe(4); // noReason 也进 total (样本证据), 否则纯乱派发攒不够样本
    expect(h.tripped).toBe(true); // 无理由率 3/4 = 75% ≥ 60%
    expect(shouldStripSubagentForModel('noisy')).toBe(true);
  });

  it('⑦ 阈值边界 (实时累计语义): 前缀爬到 60% 即熔; 前缀始终 <60% 不熔', () => {
    // m1: good,good,bad,bad,bad — 前缀 0%,0%,33%,50%,60% → 第 5 次恰好命中 ≥ 熔
    const m1 = 'edge-60';
    recordSpawnOutcome(m1, 'success'); recordSpawnOutcome(m1, 'success');
    recordSpawnOutcome(m1, 'failed'); recordSpawnOutcome(m1, 'failed'); recordSpawnOutcome(m1, 'timeout');
    expect(modelSubagentHealth(m1).badRate).toBeCloseTo(0.6, 5);
    expect(modelSubagentHealth(m1).tripped).toBe(true); // ≥ 阈值命中
    // m2: good,good,good,bad,bad — 前缀 0%,0%,0%,25%,40% → 全程 <60% 不熔
    //   (注意: 若 bad 出现在前缀前段 (如 failed,timeout,success), 第三次就到 67%
    //    实时熔断 — 那是期望行为: 连坏两次就该拦, 不等第五次)
    const m2 = 'edge-40';
    recordSpawnOutcome(m2, 'success'); recordSpawnOutcome(m2, 'success'); recordSpawnOutcome(m2, 'partial');
    recordSpawnOutcome(m2, 'failed'); recordSpawnOutcome(m2, 'timeout');
    expect(modelSubagentHealth(m2).badRate).toBeCloseTo(0.4, 5);
    expect(modelSubagentHealth(m2).tripped).toBe(false);
  });

  it('⑧ 模型维度隔离: agnes 熔断不影响 deepseek', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    recordSpawnOutcome('deepseek', 'success');
    expect(shouldStripSubagentForModel('agnes')).toBe(true);
    expect(shouldStripSubagentForModel('deepseek')).toBe(false);
    expect(modelSubagentHealth('deepseek').tripped).toBe(false);
  });
});

describe('模型级熔断: 半开恢复 (open → half-open → closed/open)', () => {
  it('① TTL 内持续摘工具, remainingMs 递减', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    const h0 = modelSubagentHealth('agnes');
    expect(h0.remainingMs).toBeGreaterThan(CIRCUIT_TTL_MS - 5000);
    vi.setSystemTime(Date.now() + 10 * 60 * 1000); // +10 分钟
    expect(shouldStripSubagentForModel('agnes')).toBe(true); // 还在熔断期
    const h1 = modelSubagentHealth('agnes');
    expect(h1.remainingMs).toBeLessThan(h0.remainingMs);
    expect(h1.remainingMs).toBeGreaterThan(0);
  });

  it('② TTL 到 → 半开放 1 次试跑 (不摘工具, halfOpen=true)', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    vi.setSystemTime(Date.now() + CIRCUIT_TTL_MS + 1000); // 过半开 TTL
    expect(shouldStripSubagentForModel('agnes')).toBe(false); // 放行
    const h = modelSubagentHealth('agnes');
    expect(h.halfOpen).toBe(true);
    expect(h.tripped).toBe(false); // tripped 清掉 (handler 双保险不误拒)
    expect(h.total).toBe(0); // 计数归零, 试跑结局重新累计
  });

  it('③ 半开后 1 次坏结局 → 立即重新 open (不用再攒 3 次)', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    vi.setSystemTime(Date.now() + CIRCUIT_TTL_MS + 1000);
    shouldStripSubagentForModel('agnes'); // 触发半开转换
    recordSpawnOutcome('agnes', 'failed'); // 试跑又坏
    const h = modelSubagentHealth('agnes');
    expect(h.tripped).toBe(true);
    expect(h.halfOpen).toBe(false);
    expect(shouldStripSubagentForModel('agnes')).toBe(true); // 重新摘
  });

  it('④ 半开时 1 次 noReason 也算坏 → 重新 open (试跑仍不学 a/b/c)', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('noisy', 'noReason');
    vi.setSystemTime(Date.now() + CIRCUIT_TTL_MS + 1000);
    shouldStripSubagentForModel('noisy');
    recordSpawnOutcome('noisy', 'noReason');
    expect(modelSubagentHealth('noisy').tripped).toBe(true);
  });

  it('⑤ 半开后 1 次成功 → closed 清零恢复 (模型改过自新)', () => {
    for (let i = 0; i < 3; i++) recordSpawnOutcome('agnes', 'failed');
    vi.setSystemTime(Date.now() + CIRCUIT_TTL_MS + 1000);
    shouldStripSubagentForModel('agnes');
    recordSpawnOutcome('agnes', 'success');
    const h = modelSubagentHealth('agnes');
    expect(h.tripped).toBe(false);
    expect(h.halfOpen).toBe(false);
    expect(h.total).toBe(1);
    expect(h.bad).toBe(0);
    expect(shouldStripSubagentForModel('agnes')).toBe(false);
    // 恢复后重新累计: 1 次失败不熔 (样本不足, 不一棒子打死); 连坏到 67% 再熔 (实时语义)
    recordSpawnOutcome('agnes', 'failed');
    expect(modelSubagentHealth('agnes').tripped).toBe(false); // 1/2 = 50%, 样本也不足 3
    recordSpawnOutcome('agnes', 'failed');
    expect(modelSubagentHealth('agnes').tripped).toBe(true); // 2/3 = 67% ≥ 60% → 再熔
  });
});

describe('模型级熔断: 主循环接入 (源码级, 同预算/短路第三道闸门)', () => {
  it('① 工具列表构造前摘除 (filterToolsByIntent 第三道 hideSpawn 条件)', () => {
    const scIdx = loopSrc.indexOf('shouldShortCircuitSubagent(message)');
    expect(scIdx).toBeGreaterThan(0);
    const around = loopSrc.slice(scIdx - 300, scIdx + 900);
    expect(around).toContain('shouldStripSubagentForModel');
    expect(around).toContain('modelCircuitOpen');
    expect(around).toContain("getName(t) !== 'spawn_subagent'");
    // 日志标注原因 (人看得到为什么摘)
    expect(loopSrc).toContain('模型熔断: 该模型委托失败率过高, 无 spawn_subagent');
  });

  it('② handler 双保险: 熔断中模型硬调也吃闭门羹 (文本告知原因)', () => {
    expect(loopSrc).toContain('modelSubagentHealth(String(this.opts.model');
    expect(loopSrc).toContain('[模型委托熔断]');
    expect(loopSrc).toContain('系统已临时摘除该能力');
  });

  it('③ 五处埋点齐: success/failed/timeout/gated/noReason 都记 (监督无盲区)', () => {
    expect(loopSrc).toContain("recordSpawnOutcome(String(this.opts.model || ''), 'success')");
    expect(loopSrc).toContain("recordSpawnOutcome(String(this.opts.model || ''), 'failed')");
    expect(loopSrc).toContain("recordSpawnOutcome(String(this.opts.model || ''), 'timeout')");
    expect(loopSrc).toContain("recordSpawnOutcome(String(this.opts.model || ''), 'gated')");
    expect(loopSrc).toContain("recordSpawnOutcome(String(this.opts.model || ''), 'noReason')");
  });

  it('③b 双记防护: 回合内已记 timeout 的子任务, IIFE 后来完成不再记 (一任务一记)', () => {
    // 超时转后台的子任务 IIFE 仍在跑, 完成时若再记 success 会稀释坏结局率
    const succIdx = loopSrc.indexOf("recordSpawnOutcome(String(this.opts.model || ''), 'success')");
    expect(succIdx).toBeGreaterThan(0);
    const before = loopSrc.slice(succIdx - 200, succIdx);
    expect(before).toContain('if (!spawnEntry.timedOutInTurn)');
    const failIdx = loopSrc.indexOf("recordSpawnOutcome(String(this.opts.model || ''), 'failed')");
    expect(failIdx).toBeGreaterThan(0);
    const beforeFail = loopSrc.slice(failIdx - 200, failIdx);
    expect(beforeFail).toContain('if (!spawnEntry.timedOutInTurn)');
  });

  it('④ 阈值常量可查 (方案级默认值, 防被无意改松)', () => {
    expect(CIRCUIT_MIN_SAMPLES).toBe(3);
    expect(CIRCUIT_BAD_RATE).toBe(0.6);
    expect(CIRCUIT_NO_REASON_RATE).toBe(0.6);
    expect(CIRCUIT_TTL_MS).toBe(30 * 60 * 1000);
  });
});
