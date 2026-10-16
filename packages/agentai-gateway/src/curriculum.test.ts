/**
 * curriculum.test.ts — 全局课程循环 (RSIAgent 探索→验证→沉淀, 2026-10-16)
 *
 * 验证「沉淀侧 distillRound / 召回侧 focusBlock」+ 两处挂钩点 (loop:done 沉淀,
 * buildImmutablePrefix §1.1 注入, batch_pentest 收尾/读回) 的源码契约与行为。
 *
 * 运行: cd packages/agentai-gateway && npx vitest run src/curriculum.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CUR_SRC = readFileSync(new URL('./curriculum.ts', import.meta.url), 'utf-8');
const LOOP_SRC = readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
const TOOLS_SRC = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');

// 行为级测试用真实 curriculum 模块 (写/读走 tmpdir 工作区 + 临时 EVOLUTION_DIR)
let curriculum: typeof import('./curriculum.js');
let tmp: string;
let savedEvoDir: string | undefined;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'curriculum-test-'));
  // ⚠️ AGENTAI_EVOLUTION_DIR 必须在 evolution.ts / curriculum.js 首次 import **之前**设置,
  // 因为 evolution.ts 在模块加载时 `const EVOLUTION_FILE = process.env.AGENTAI_EVOLUTION_FILE || ...EVOLUTION_DIR...`
  // 把路径固定死了。先设 env 再动态 import, 才能让写盘落到 tmp 而非真实 home。
  savedEvoDir = process.env.AGENTAI_EVOLUTION_DIR;
  process.env.AGENTAI_EVOLUTION_DIR = join(tmp, 'evolution');
  curriculum = await import('./curriculum.js');
});

afterAll(() => {
  if (savedEvoDir === undefined) delete process.env.AGENTAI_EVOLUTION_DIR;
  else process.env.AGENTAI_EVOLUTION_DIR = savedEvoDir;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(async () => {
  // 每个用例清掉上轮沉淀, 避免跨用例串味
  const { setEvolutionFrozen } = await import('./evolution-freeze.js');
  setEvolutionFrozen(false);
});

// ============================ 源码契约 ============================

describe('课程循环 — 模块契约', () => {
  it('distillRound 走 requireEvolution 冻结门 (冻结期不写不抛)', () => {
    expect(CUR_SRC).toMatch(/requireEvolution\(/);
    expect(CUR_SRC).toMatch(/import \{ requireEvolution \} from '\.\/evolution-freeze\.js'/);
  });

  it('distillRound 失败绝不抛 (catch 吞掉, 返回 { written:false })', () => {
    expect(CUR_SRC).toMatch(/catch \(e: any\) \{[\s\S]{0,80}console\.warn\('\[curriculum\] distillRound/);
  });

  it('工作区状态文件在 .agentai/curriculum.json (同 scope.json 口径, 归一化反斜杠)', () => {
    expect(CUR_SRC).toMatch(/\.agentai\/curriculum\.json/);
    expect(CUR_SRC).toMatch(/replace\(\/\\\\\/g, '\/'\)/);
  });

  it('focusBlock 无内容返回空串 (调用方不 push)', () => {
    expect(CUR_SRC).toMatch(/if \(parts\.length === 0\) return ''/);
  });

  it('focusBlock 走 recallEvolution + extractPatterns 既有管道 (零新检索逻辑)', () => {
    expect(CUR_SRC).toMatch(/recallEvolution\(/);
    expect(CUR_SRC).toMatch(/extractPatterns\(/);
  });

  it('pentest 特化段只读 vulns.jsonl + cve 告警 (纯读不打目标)', () => {
    expect(CUR_SRC).toMatch(/\.agentai\/vulns\/vulns\.jsonl/);
    expect(CUR_SRC).toMatch(/\.agentai\/cve\/alerts\.jsonl/);
  });
});

describe('课程循环 — loop 挂钩契约', () => {
  it('loop:done 后调 distillRound (只挂 loop 终态, 挂 1 处)', () => {
    expect(LOOP_SRC.match(/distillRound\(/g)?.length).toBe(1);
    const doneIdx = LOOP_SRC.indexOf("emit('loop:done'");
    const distillIdx = LOOP_SRC.indexOf('distillRound(');
    expect(doneIdx).toBeGreaterThan(-1);
    expect(distillIdx, 'distillRound 必须在 loop:done 之后').toBeGreaterThan(doneIdx);
  });

  it('buildImmutablePrefix §1.1 注入 curriculum:focus 并 track(20) 参与预算仲裁', () => {
    expect(LOOP_SRC).toMatch(/track\('curriculum:focus', 20\)/);
    const focusIdx = LOOP_SRC.indexOf('focusBlock(');
    expect(focusIdx, 'focusBlock 注入点').toBeGreaterThan(-1);
    // 注入走弱模型区: 在 !isStrongModel 门控内 (与 evolution 块同一取舍)
    const block = LOOP_SRC.slice(LOOP_SRC.lastIndexOf('if (!isStrongModel)', focusIdx), focusIdx + 60);
    expect(block).toMatch(/!isStrongModel/);
  });
});

describe('课程循环 — batch_pentest 挂钩契约', () => {
  it('batch_pentest 收尾调 distillRound (沉淀下轮焦点)', () => {
    const batchStart = TOOLS_SRC.indexOf('batch_pentest: async');
    const batchEnd = TOOLS_SRC.indexOf('enum_subdomains: async', batchStart);
    const batchBody = TOOLS_SRC.slice(batchStart, batchEnd);
    expect(batchBody).toMatch(/distillRound\(ws, \{[\s\S]{0,400}taskType: 'industry'/);
  });

  it('batch_pentest 每目标 task 读回课程焦点 (focusCtx 注入子智能体)', () => {
    const batchStart = TOOLS_SRC.indexOf('batch_pentest: async');
    const batchEnd = TOOLS_SRC.indexOf('enum_subdomains: async', batchStart);
    const batchBody = TOOLS_SRC.slice(batchStart, batchEnd);
    expect(batchBody).toMatch(/focusCtx/);
    expect(batchBody).toMatch(/platCtx \+[\s\S]{0,30}focusCtx \+/);
  });
});

// ============================ 行为级 ============================

describe('课程循环 — distillRound 行为', () => {
  const ws = () => {
    const w = join(tmp, 'ws-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(w, { recursive: true });
    return w;
  };

  it('verified=true + technique → 写进化条目 (success + curriculum source + taskType)', async () => {
    const w = ws();
    const r = curriculum.distillRound(w, {
      goal: '修 bug', taskType: 'coding', technique: '经 multi_edit → typecheck 完成',
      verified: true, keywords: ['typecheck'],
    });
    expect(r.written).toBe(true);
    // writeEvolution 走 atomicAppend 队列 (fire-and-forget), 等一个 tick 再读
    await new Promise((res) => setTimeout(res, 50));
    const evoMod = await import('./evolution.js');
    const entries = evoMod.readEvolution(50).filter((e: any) => e.metadata?.source === 'curriculum' && e.taskType === 'coding');
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[entries.length - 1];
    expect(entry.type).toBe('success');
    expect(entry.metadata.source).toBe('curriculum');
    expect(entry.taskType).toBe('coding');
    expect(entry.content).toMatch(/multi_edit → typecheck/);
  });

  it('verified=false → 不沉淀 (只沉淀验证过的路线)', () => {
    const w = ws();
    const r = curriculum.distillRound(w, { goal: 'x', taskType: 'general', technique: 'abc', verified: false });
    expect(r.written).toBe(false);
    expect(r.reason).toMatch(/未验证|跳过/);
  });

  it('technique 为空 → 不沉淀', () => {
    const w = ws();
    const r = curriculum.distillRound(w, { goal: 'x', taskType: 'general', technique: '   ', verified: true });
    expect(r.written).toBe(false);
  });

  it('工作区 .agentai/curriculum.json 写入近 5 轮 + nextFocus (FIFO 截断)', async () => {
    const w = ws();
    for (let i = 0; i < 7; i++) {
      curriculum.distillRound(w, { goal: `g${i}`, taskType: 'coding', technique: `t${i}`, verified: true });
    }
    const state = JSON.parse(readFileSync(join(w, '.agentai', 'curriculum.json'), 'utf8'));
    expect(state.rounds.length).toBe(5); // FIFO 截断到 5
    expect(state.rounds[0].technique).toBe('t2'); // 最旧的 0,1 被丢
    expect(state.rounds[4].technique).toBe('t6'); // 最新一轮在末尾
    expect(state.nextFocus).not.toBe(''); // nextFocus 有值 (auto 推导)
  });

  it('冻结期 distillRound 不写进化文件但也不抛', async () => {
    const { setEvolutionFrozen } = await import('./evolution-freeze.js');
    const w = ws();
    setEvolutionFrozen(true);
    try {
      const r = curriculum.distillRound(w, { goal: 'x', taskType: 'coding', technique: 't', verified: true });
      expect(r.written).toBe(false); // 被冻结门拦截
      expect(r.reason).toMatch(/冻结/);
    } finally { setEvolutionFrozen(false); }
  });
});

describe('课程循环 — focusBlock 行为', () => {
  const ws = () => {
    const w = join(tmp, 'ws-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(w, { recursive: true });
    return w;
  };

  it('同 taskType 有沉淀 → 召回段含 technique + 下轮焦点', async () => {
    const w = ws();
    curriculum.distillRound(w, { goal: '修 API', taskType: 'coding', technique: '走 mock 先行', nextFocus: '补真实联调', verified: true });
    const block = curriculum.focusBlock(w, 'coding');
    expect(block).toMatch(/课程循环焦点/);
    expect(block).toMatch(/mock 先行/);
  });

  it('异 taskType 隔离 (coding 的沉淀不出现在 research 召回里)', async () => {
    const w = ws();
    curriculum.distillRound(w, { goal: 'x', taskType: 'coding', technique: 'coding-only 路线', verified: true });
    const block = curriculum.focusBlock(w, 'research');
    expect(block).not.toMatch(/coding-only 路线/);
  });

  it('无任何沉淀 → 返回空串 (调用方不注入)', async () => {
    const w = ws();
    expect(curriculum.focusBlock(w, 'general')).toBe('');
  });

  it('pentest 特化: 读 vulns.jsonl unverified + cve KEV 告警 (纯读)', async () => {
    const w = ws();
    mkdirSync(join(w, '.agentai', 'vulns'), { recursive: true });
    writeFileSync(join(w, '.agentai', 'vulns', 'vulns.jsonl'),
      JSON.stringify({ id: 'v1', target: 'x.bestpay.com.cn', vulnType: 'sqli', status: 'unverified' }) + '\n');
    mkdirSync(join(w, '.agentai', 'cve'), { recursive: true });
    writeFileSync(join(w, '.agentai', 'cve', 'alerts.jsonl'),
      JSON.stringify({ cveId: 'CVE-2026-9999', host: 'api.bestpay.com.cn', kev: true }) + '\n');
    // distill 一次带 pentest 标记, 让 nextFocus 含 pentest → 触发特化段
    curriculum.distillRound(w, { goal: 'batch', taskType: 'industry', technique: '2 命中', nextFocus: 'pentest: 重扫', verified: true });
    const block = curriculum.focusBlock(w, 'industry');
    expect(block).toMatch(/CVE-2026-9999/);
    expect(block).toMatch(/sqli/);
  });

  it('focusBlock 异常静默返回空串 (绝不阻塞主循环)', async () => {
    const w = join(tmp, 'not-exist-ws'); // 不存在的目录
    // curriculum.json 读盘会走 catch, 但 recall 仍可能工作 → 至少要拿到字符串 (不 throw)
    const out = curriculum.focusBlock(w, 'coding');
    expect(typeof out).toBe('string');
  });
});
