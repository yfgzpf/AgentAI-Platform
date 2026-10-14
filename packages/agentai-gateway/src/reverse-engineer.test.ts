/**
 * reverse-engineer + design-review 子智能体 — 回归测试 (2026-10-14)
 * ===================================================================
 * 对应 4 篇公众号文章落地方案里的 P0 (REA 复刻工作流) 与 P2 (Impeccable 设计反模式)。
 * 两层:
 *   契约: subagent.ts 里两个类型存在 + 工具集**不含写工具** (信息隔离) +
 *         spawn_subagent 枚举已加 2 个新类型。
 *   行为: 打桩 AgentAILoop, 调 runSubagent('reverse-engineer') 验证模型继承 +
 *         未知类型仍返回 "Unknown subagent type"。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runSubagent } from './subagent.js';

const src = (rel: string) => readFileSync(new URL(`./${rel}`, import.meta.url), 'utf-8');
const subagentSrc = src('subagent.ts');
const toolsSrc = src('tools.ts');

/** 去注释 — 保留可执行代码 (与 video-pipeline.test.ts 同款, 防匹配到注释里旧实现说明) */
function codeOnly(s: string): string {
  const NL = String.fromCharCode(10);
  return s.split(NL).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(NL);
}
const codeSrc = codeOnly(subagentSrc);
const toolsCode = codeOnly(toolsSrc);

const WRITE_TOOLS = ['write_file', 'multi_edit', 'apply_edit', 'create_tool'];

function toolBlock(key: string): string | undefined {
  const m = codeSrc.match(new RegExp(`['"]${key}['"]:\\s*\\[([^\\]]+)\\]`));
  return m?.[1];
}

const h = vi.hoisted(() => ({ captured: [] as any[] }));
vi.mock('./agentai-loop.js', () => ({
  AgentAILoop: class {
    constructor(_router: any, _registry: any, _tools: any, opts: any) {
      h.captured.push(opts);
    }
    async run() {
      return { content: 'stub-output' };
    }
  },
}));
const fakeRegistry = { list: () => [], register: () => {} } as any;
const quietRouter = { providers: new Map() } as any;

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: reverse-engineer + design-review 子智能体类型', () => {
  it('SUBAGENT_PROMPTS 有 reverse-engineer 条目 (REA 工作流)', () => {
    expect(codeSrc).toMatch(/['"]reverse-engineer['"]:\s*`/);
  });

  it('SUBAGENT_PROMPTS 有 design-review 条目 (Impeccable 59 条)', () => {
    expect(codeSrc).toMatch(/['"]design-review['"]:\s*`/);
  });

  it('SUBAGENT_TOOLS 有 reverse-engineer, 且**不含任何写工具** (信息隔离)', () => {
    const block = toolBlock('reverse-engineer');
    expect(block, 'reverse-engineer 工具集段缺失').toBeTruthy();
    for (const tool of WRITE_TOOLS) {
      expect(block, `reverse-engineer 工具集不得含写工具 ${tool}`).not.toContain(tool);
    }
  });

  it('reverse-engineer 工具集含 rea:* MCP 工具 (复刻工作流的核心)', () => {
    const block = toolBlock('reverse-engineer');
    expect(block).toMatch(/rea:/);
    expect(block).toContain('explore_project');
    expect(block).toContain('search_codebase');
  });

  it('SUBAGENT_TOOLS 有 design-review, 且**不含任何写工具** (设计审查者只指出问题)', () => {
    const block = toolBlock('design-review');
    expect(block, 'design-review 工具集段缺失').toBeTruthy();
    for (const tool of WRITE_TOOLS) {
      expect(block, `design-review 工具集不得含写工具 ${tool}`).not.toContain(tool);
    }
  });

  it('design-review 工具集含 7 个只读工具 (不含写工具)', () => {
    const block = toolBlock('design-review');
    expect(block).toContain('list_directory');
    expect(block).toContain('read_file');
    expect(block).toContain('search_content');
    expect(block).toContain('get_file_info');
    expect(block).toContain('directory_tree');
  });

  it('spawn_subagent 工具声明的 type enum 含 reverse-engineer 和 design-review', () => {
    expect(toolsCode).toMatch(/enum:\s*\[[^\]]*'reverse-engineer'/);
    expect(toolsCode).toMatch(/enum:\s*\[[^\]]*'design-review'/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — 强模型调 reverse-engineer 子智能体, 模型继承正确
// ════════════════════════════════════════════════════════════════════════
describe('行为: reverse-engineer 子智能体模型继承', () => {
  it('强模型 (deepseek) 调 reverse-engineer → 子 loop 拿到父 provider + 父精确模型名', async () => {
    h.captured.length = 0;
    await runSubagent(
      'reverse-engineer',
      '搞懂 Chrome 断网小恐龙, 用 HTML+JS 复刻',
      quietRouter, fakeRegistry, 'user1', '/tmp/ws',
      'deepseek', 'deepseek-flash',
    );
    expect(h.captured).toHaveLength(1);
    expect(h.captured[0].model).toBe('deepseek');
    expect(h.captured[0].modelName).toBe('deepseek-flash');
  });

  it('强模型 (openai/gpt-4o) 调 design-review → 模型继承同样正确', async () => {
    h.captured.length = 0;
    await runSubagent(
      'design-review',
      '审查 packages/agentai-gui/src/components/ 的落地页设计',
      quietRouter, fakeRegistry, 'u', '/tmp',
      'openai', 'gpt-4o',
    );
    expect(h.captured[0].model).toBe('openai');
    expect(h.captured[0].modelName).toBe('gpt-4o');
  });

  it('未知类型仍返回 "Unknown subagent type" 且**不构造 loop**', async () => {
    h.captured.length = 0;
    const out = await runSubagent('not-a-type', 'x', quietRouter, fakeRegistry, 'u', '/tmp');
    expect(out).toBe('Unknown subagent type: not-a-type');
    expect(h.captured).toHaveLength(0);
  });
});
