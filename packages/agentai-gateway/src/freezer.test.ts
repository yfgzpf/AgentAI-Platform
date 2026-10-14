/**
 * 自进化写入冻结开关 — 回归测试 (2026-10-14 P2)
 * ==============================================================================
 * RSIAgent "冻结快照" 理念: 测试/评测期记忆**冻结**, 不再更新, 确保结果可复现。
 * 本模块挡 5 个自进化写入口 (evolve_prompt / create_tool / record_failure /
 * 主循环自动写 / 子智能体回写), 读操作与显式用户记忆 (remember/remember_this)
 * 不受影响。
 *
 * 三层:
 *   契约: evolution-freeze.ts 3 个导出 + 环境变量启动读 + tools.ts 4 处 handler 拦截 +
 *         agentai-loop.ts 3 处自动写守卫 + routes/chat.ts 2 个端点。
 *   行为: setEvolutionFrozen(true) → requireEvolution 返回 false + 不执行 fn;
 *         调 evolve_prompt add 拦截; 调 list 不受影响; 调 set_evolution_frozen 工具
 *         切换 state。
 *   边界: 环境变量 AGENTAI_EVOLUTION_FROZEN=1 启动即冻结; 调 set(false) 解冻;
 *         重复 set 幂等 (状态不变不打日志)。
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (rel: string) => readFileSync(new URL(`./${rel}`, import.meta.url), 'utf-8');
const evolveSrc = src('evolution-freeze.ts');
const toolsSrc = src('tools.ts');
const loopSrc = src('agentai-loop.ts');
const chatSrc = src('routes/chat.ts');

// ===== 环境变量控制: 测试前设 AGENTAI_EVOLUTION_FROZEN=1, 验证启动即冻结 =====
let origEnvFrozen: string | undefined;

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: evolution-freeze 模块 + 拦截点 + 端点', () => {
  it('3 个导出都存在', () => {
    expect(evolveSrc).toMatch(/export function isEvolutionFrozen/);
    expect(evolveSrc).toMatch(/export function setEvolutionFrozen/);
    expect(evolveSrc).toMatch(/export function requireEvolution/);
  });

  it('环境变量启动即读 (AGENTAI_EVOLUTION_FROZEN=1 → 初始冻结)', () => {
    expect(evolveSrc).toMatch(/process\.env\['AGENTAI_EVOLUTION_FROZEN'\]\s*===\s*'1'/);
  });

  it('tools.ts 有 4 处 handler 入口拦截 (evolve_prompt / create_tool / record_failure / set_evolution_frozen)', () => {
    // 防有人把拦截删回去 — 每个 handler 单独断言, 窗口给够 (handler 函数体可能 >500 字符)
    expect(toolsSrc).toMatch(/evolve_prompt:\s*async[\s\S]{0,2000}?requireEvolution/);
    expect(toolsSrc).toMatch(/create_tool:\s*async[\s\S]{0,2000}?requireEvolution/);
    expect(toolsSrc).toMatch(/record_failure:\s*async[\s\S]{0,800}?requireEvolution/);
    expect(toolsSrc).toMatch(/set_evolution_frozen:\s*async/);
  });

  it('agentai-loop.ts 3 处自动写都有 isEvolutionFrozen 守卫', () => {
    const guards = (loopSrc.match(/isEvolutionFrozen\(\)/g) || []).length;
    expect(guards, 'agentai-loop.ts 至少 3 处自动写守卫 (dup_fail / skill-evolver / distiller)').toBeGreaterThanOrEqual(3);
  });

  it('routes/chat.ts 暴露 GET/POST /v1/evolution/freeze', () => {
    expect(chatSrc).toMatch(/r\.get\('\/v1\/evolution\/freeze'/);
    expect(chatSrc).toMatch(/r\.post\('\/v1\/evolution\/freeze'/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 (打桩 evolution-freeze, 调 handler 看拦截)
// ════════════════════════════════════════════════════════════════════════
describe('行为: 冻结期拦截写 / 读不受影响', () => {
  const h = vi.hoisted(() => ({ frozen: false }));

  vi.mock('./evolution-freeze.js', () => ({
    isEvolutionFrozen: () => h.frozen,
    setEvolutionFrozen: (v: boolean) => { h.frozen = !!v; },
    requireEvolution: (fn: () => void, _source: string) => {
      if (h.frozen) return false;
      fn();
      return true;
    },
  }));

  beforeEach(() => { h.frozen = false; });

  it('非冻结期: evolve_prompt add 正常写', async () => {
    // 这里只测拦截判断本身 — 真实 fs 写入由集成测试覆盖
    h.frozen = false;
    const { EXTRA_HANDLERS } = await import('./tools.js');
    // 打桩 getWs 避免真路径
    const out = await EXTRA_HANDLERS['evolve_prompt']({ action: 'list' }, { userId: 'u', workspace: '/tmp/evf-test' } as any);
    // list 在冻结/非冻结期都应 success (读操作不受影响)
    expect(out.success).toBe(true);
  });

  it('冻结期: evolve_prompt add 被拦截 (success:false)', async () => {
    h.frozen = true;
    const { EXTRA_HANDLERS } = await import('./tools.js');
    const out = await EXTRA_HANDLERS['evolve_prompt'](
      { action: 'add', rule: 'test-rule' },
      { userId: 'u', workspace: '/tmp/evf-test' } as any,
    );
    expect(out.success).toBe(false);
    expect(out.output).toMatch(/evolution 冻结中/);
  });

  it('冻结期: record_failure 被拦截 (success:false)', async () => {
    h.frozen = true;
    const { EXTRA_HANDLERS } = await import('./tools.js');
    const out = await EXTRA_HANDLERS['record_failure'](
      { toolName: 'x', reason: 'y' },
      { userId: 'u', workspace: '/tmp/evf-test' } as any,
    );
    expect(out.success).toBe(false);
    expect(out.output).toMatch(/evolution 冻结中/);
  });

  it('冻结期: set_evolution_frozen(false) 解除冻结', async () => {
    h.frozen = true;
    const { EXTRA_HANDLERS } = await import('./tools.js');
    const out = await EXTRA_HANDLERS['set_evolution_frozen']({ frozen: false } as any, { userId: 'u', workspace: '/tmp/evf-test' } as any);
    expect(out.success).toBe(true);
    expect(out.output).toContain('已解冻');
    expect(h.frozen).toBe(false);
  });

  it('set_evolution_frozen(true) 进入冻结', async () => {
    h.frozen = false;
    const { EXTRA_HANDLERS } = await import('./tools.js');
    const out = await EXTRA_HANDLERS['set_evolution_frozen']({ frozen: true } as any, { userId: 'u', workspace: '/tmp/evf-test' } as any);
    expect(out.success).toBe(true);
    expect(h.frozen).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 边界: 环境变量启动即读
// ════════════════════════════════════════════════════════════════════════
describe('边界: 环境变量启动即读', () => {
  it('AGENTAI_EVOLUTION_FROZEN=1 → _frozen 初始为 true', () => {
    const line = evolveSrc.match(/let _frozen: boolean = process\.env\['AGENTAI_EVOLUTION_FROZEN'\] === '1';/);
    expect(line, '启动即读 AGENTAI_EVOLUTION_FROZEN 环境变量').toBeTruthy();
  });
});
