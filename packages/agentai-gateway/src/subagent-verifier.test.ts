/**
 * 独立验证者 (verifier) 子智能体 — 回归测试 (2026-10-14)
 * ===================================================================
 * 灵感来源: RSIAgent (AetherLabsAI/RSIAgent) 三智能体架构里的独立 Verifier ——
 * 核心机制 = **信息隔离**: 验证者看不到 Actor 的私有推理/对话/笔记, 只能拿
 * ① 验收条件 ② 客观环境状态, 且**工具集刻意不含写工具**, 结构上杜绝
 * "验证者替 actor 改错" 的可能性, 防自我欺骗式学习。
 *
 * 本文件三层:
 *   契约层: SUBAGENT_PROMPTS['verifier'] / SUBAGENT_TOOLS['verifier'] 存在 +
 *           工具集**不含任何写工具** (核心约束) + spawn_subagent 枚举已加 'verifier'。
 *   行为层: 打桩 AgentAILoop, 调 runSubagent('verifier', …) 验证子 loop 拿到的
 *           opts 正确 (model/modelName 继承父模型, 与其他子智能体一致)。
 *   提示词层: verifier prompt 含 3 个要素 (verdict / 逐条核对 / 证据 + 隔离原则)。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runSubagent } from './subagent.js';

// ===== 源码契约 (防回归: 有人把修复删回去) =====
const src = (rel: string) =>
  readFileSync(new URL(`./${rel}`, import.meta.url), 'utf-8');

const subagentSrc = src('subagent.ts');
const toolsSrc = src('tools.ts');

/** 写工具黑名单 — verifier 结构上**不能**出现这些 (信息隔离核心) */
const WRITE_TOOLS = ['write_file', 'multi_edit', 'run_code', 'apply_edit', 'create_tool'];

// ===== 打桩 AgentAILoop: 捕获子智能体 loop 实际收到的 opts =====
const h = vi.hoisted(() => ({ captured: [] as any[] }));
vi.mock('./agentai-loop.js', () => ({
  AgentAILoop: class {
    constructor(_router: any, _registry: any, _tools: any, opts: any) {
      h.captured.push(opts);
    }
    async run() {
      return { content: 'stub-verifier-output' };
    }
  },
}));

/** 只实现 runSubagent 会用到的最小接口 (list + register) */
const fakeRegistry = { list: () => [], register: () => {} } as any;
/** providers 为空 Map → 不会触发熔断降级分支 */
const quietRouter = { providers: new Map() } as any;

/** 找到 SUBAGENT_TOOLS 里独立的 verifier 条目 (排除 `fix-verifier` 里含 verifier 子串的干扰) */
function verifierToolBlock(): string | undefined {
  // SUBAGENT_TOOLS 里 key 是 `'verifier':` (带引号), 且后面直接接 `[`;
  // 排除 'fix-verifier' 的写法是 'fix-verifier': [ ... ]
  const m = subagentSrc.match(/['"]verifier['"]:\s*\[([^\]]+)\]/);
  return m?.[1];
}

// ════════════════════════════════════════════════════════════════════════
// 契约层 — verifier 类型存在 + 工具集隔离 + 工具声明枚举
// ════════════════════════════════════════════════════════════════════════
describe('契约: verifier 子智能体类型', () => {
  it('SUBAGENT_PROMPTS 有独立 verifier 条目 (非 fix-verifier)', () => {
    // 精确 key 'verifier' (带引号 + 冒号 + 反引号起头)
    expect(subagentSrc).toMatch(/['"]verifier['"]:\s*`/);
  });

  it('SUBAGENT_TOOLS 有独立 verifier 条目, 且**不含任何写工具** (信息隔离核心)', () => {
    const block = verifierToolBlock();
    expect(block, 'SUBAGENT_TOOLS.verifier 段缺失').toBeTruthy();
    for (const tool of WRITE_TOOLS) {
      expect(block, `verifier 工具集不得含写工具 ${tool}`).not.toContain(tool);
    }
  });

  it('verifier 工具集含 read_file + run_tests + typecheck (能复现证据)', () => {
    const block = verifierToolBlock();
    expect(block, 'SUBAGENT_TOOLS.verifier 段缺失').toBeTruthy();
    expect(block).toContain('read_file');
    expect(block).toContain('run_tests');
    expect(block).toContain('typecheck');
  });

  it('spawn_subagent 工具声明的 type enum 含 verifier', () => {
    // tools.ts 里 spawn_subagent 的参数 enum 数组
    expect(toolsSrc).toMatch(/enum:\s*\[[^\]]*'verifier'/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 提示词层 — verifier 系统提示词含关键要素
// ════════════════════════════════════════════════════════════════════════
describe('提示词: verifier 系统提示词 3 要素', () => {
  it('声明信息隔离原则 (看不到 actor 推理)', () => {
    expect(subagentSrc).toContain('你看不到执行者');
  });

  it('声明结构化回执 (verdict: PASS/FAIL/UNRESOLVED)', () => {
    expect(subagentSrc).toMatch(/verdict:\s*PASS\s*\|\s*FAIL\s*\|\s*UNRESOLVED/);
  });

  it('要求证据级核对 (逐条核对 + file:line)', () => {
    expect(subagentSrc).toContain('逐条核对');
    expect(subagentSrc).toMatch(/file:line/);
  });

  it('明确 "执行者说成功不算 PASS" 的约束', () => {
    expect(subagentSrc).toMatch(/因为["「『]?执行者/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — 强模型调 verifier 子智能体, 模型继承正确 (与其他子智能体一致)
// ════════════════════════════════════════════════════════════════════════
describe('行为: verifier 子智能体模型继承', () => {
  it('强模型 (deepseek) 调 verifier → 子 loop 拿到父 provider + 父精确模型名', async () => {
    h.captured.length = 0;
    await runSubagent(
      'verifier',
      '验收条件: 1) App.tsx 改对 2) 测试全绿',
      quietRouter, fakeRegistry, 'user1', '/tmp/ws',
      'deepseek', 'deepseek-flash',
    );
    expect(h.captured).toHaveLength(1);
    expect(h.captured[0].model).toBe('deepseek');
    expect(h.captured[0].modelName).toBe('deepseek-flash');
  });

  it('未传父模型 → 保持历史兜底 (agentai + 空模型名)', async () => {
    h.captured.length = 0;
    await runSubagent('verifier', '任务', quietRouter, fakeRegistry, 'u', '/tmp');
    expect(h.captured[0].model).toBe('agentai');
    expect(h.captured[0].modelName).toBe('');
  });

  it('未知类型仍返回 "Unknown subagent type" 并**不构造 loop**', async () => {
    h.captured.length = 0;
    const out = await runSubagent(
      'not-a-type', 'x', quietRouter, fakeRegistry, 'u', '/tmp',
    );
    expect(out).toBe('Unknown subagent type: not-a-type');
    expect(h.captured).toHaveLength(0);
  });
});
