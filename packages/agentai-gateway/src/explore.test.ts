/**
 * 广度→深度探索器 (BRS/DRS) — 回归测试 (2026-10-14 P3)
 * ===================================================================
 * RSIAgent Curriculum + BRS/DRS 两阶段, 纯数据驱动 (不接 LLM, 弱模型也能用)。
 * 三层:
 *   契约: explore.ts 有 5 个 probe 函数 + broadExplore/deepExplore 导出 +
 *         tools.ts 有 explore_project_deep 工具 + subagent.ts 有 explorer 类型。
 *   行为: 在真实 workspace 跑 BRS/DRS, 验证 probes 数量 + 弱标点 + nextAction;
 *         工具入口: 不传 focus → BRS (返回 topWeakSpots), 传 focus → DRS (返回 nextAction)。
 *   隔离: explorer 子智能体工具集**不含写工具** (与 P0/P2 信息隔离原则一致)。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import { broadExplore, deepExplore } from './explore.js';
import { EXTRA_HANDLERS } from './tools.js';

const src = (rel: string) => readFileSync(new URL(`./${rel}`, import.meta.url), 'utf-8');
const exploreSrc = src('explore.ts');
const toolsSrc = src('tools.ts');
const subagentSrc = src('subagent.ts');

function codeOnly(s: string): string {
  const NL = String.fromCharCode(10);
  return s.split(NL).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(NL);
}
const exploreCode = codeOnly(exploreSrc);
const toolsCode = codeOnly(toolsSrc);
const subagentCode = codeOnly(subagentSrc);

// 用 gateway 包根目录做测试 (有 package.json + src/), 避免拉全 monorepo
// 测试文件在 src/ 下, 所以 TEST_WS 要 resolve 到上一级 (gateway 包根)
// 用 __dirname 而非 new URL (Windows 下 new URL 生成 file:/// 路径, path.join 会出错)
const TEST_WS = nodePath.resolve(__dirname, '..');

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: explore.ts 模块 + explore_project_deep 工具 + explorer 子智能体', () => {
  it('explore.ts 有 5 个 BRS probe + broadExplore / deepExplore 导出', () => {
    expect(exploreCode).toMatch(/function probeStructure/);
    expect(exploreCode).toMatch(/function probeTechStack/);
    expect(exploreCode).toMatch(/function probeRecentChanges/);
    expect(exploreCode).toMatch(/function probeFailureHistory/);
    expect(exploreCode).toMatch(/function probeUnexplored/);
    expect(exploreCode).toMatch(/export async function broadExplore/);
    expect(exploreCode).toMatch(/export async function deepExplore/);
  });

  it('tools.ts 有 explore_project_deep 声明 + handler', () => {
    expect(toolsCode).toMatch(/'explore_project_deep'/);
    expect(toolsCode).toMatch(/explore_project_deep:\s*async/);
  });

  it('subagent.ts 有 explorer 类型 (提示词 + 工具集 + spawn 枚举)', () => {
    expect(subagentCode).toMatch(/['"]explorer['"]:\s*`/);
    expect(subagentCode).toMatch(/['"]explorer['"]:\s*\[/);
    expect(toolsCode).toMatch(/enum:\s*\[[^\]]*'explorer'/);
  });

  it('explorer 子智能体工具集**不含任何写工具** (信息隔离)', () => {
    const WRITE_TOOLS = ['write_file', 'multi_edit', 'apply_edit', 'create_tool'];
    const m = subagentCode.match(/['"]explorer['"]:\s*\[([^\]]+)\]/);
    expect(m, 'explorer 工具集段缺失').toBeTruthy();
    const block = m![1];
    for (const tool of WRITE_TOOLS) {
      expect(block, `explorer 工具集不得含写工具 ${tool}`).not.toContain(tool);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — BRS / DRS
// ════════════════════════════════════════════════════════════════════════
describe('行为: broadExplore + deepExplore', () => {
  it('BRS: 5 个 probe 并行 + topWeakSpots 最多 3 条', async () => {
    const r = await broadExplore(TEST_WS);
    expect(r.probes).toHaveLength(5);
    const probeNames = r.probes.map(p => p.probe);
    expect(probeNames).toEqual(expect.arrayContaining(['structure', 'tech-stack', 'recent-changes', 'failure-history', 'unexplored']));
    expect(r.topWeakSpots.length).toBeLessThanOrEqual(3);
  });

  it('BRS: 在 Node 项目里 tech-stack 应识别到 "Node/JS/TS"', async () => {
    const r = await broadExplore(TEST_WS);
    const tech = r.probes.find(p => p.probe === 'tech-stack');
    expect(tech?.summary).toMatch(/Node|TS|JS|pnpm/);
  });

  it('DRS: 针对一个关键词跑 5 个 probe + 给 nextAction', async () => {
    const r = await deepExplore(TEST_WS, 'evolution');
    expect(r.probes.length).toBeGreaterThanOrEqual(4); // 至少 4 个 probe 成功
    expect(r.nextAction).toBeTruthy();
    // "evolution" 是 gateway 里有的模块, 源码 probe 应报告数字
    const sourceProbe = r.probes.find(p => p.probe === 'dr-1-source');
    expect(sourceProbe?.summary).toMatch(/个含 "evolution" 的源码文件/);
  });

  it('DRS: 不存在的关键词 nextAction 应是"未发现明显弱点" (关键词错不算项目弱点)', async () => {
    const r = await deepExplore(TEST_WS, 'definitely-not-exist-zzz-9999');
    // 关键词不存在时: 源码 0 + 测试 0 + 调用方 0 + 历史 0 → 无 weakSpot → nextAction = 未发现明显弱点
    expect(r.nextAction).toMatch(/未发现明显弱点|探索完成/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 工具入口层 — explore_project_deep 不传 focus → BRS, 传 focus → DRS
// ════════════════════════════════════════════════════════════════════════
describe('工具: explore_project_deep 入口分发', () => {
  it('不传 focus → 跑 BRS (输出含 "广度探索" + topWeakSpots)', async () => {
    const ctx = { userId: 'u', workspace: TEST_WS, abortSignal: new AbortController().signal } as any;
    const out = await EXTRA_HANDLERS['explore_project_deep']({}, ctx);
    expect(out.success).toBe(true);
    expect(out.output).toContain('广度探索');
    expect(out.output).toMatch(/弱点|✅/);
    expect(out.data).toHaveProperty('probes');
    expect(out.data).toHaveProperty('topWeakSpots');
  });

  it('传 focus → 跑 DRS (输出含 "深度探索" + nextAction)', async () => {
    const ctx = { userId: 'u', workspace: TEST_WS, abortSignal: new AbortController().signal } as any;
    const out = await EXTRA_HANDLERS['explore_project_deep']({ focus: 'evolution' }, ctx);
    expect(out.success).toBe(true);
    expect(out.output).toContain('深度探索');
    expect(out.output).toMatch(/下一步|探索完成/);
    expect(out.data).toHaveProperty('focus');
    expect(out.data).toHaveProperty('probes');
  });
});
