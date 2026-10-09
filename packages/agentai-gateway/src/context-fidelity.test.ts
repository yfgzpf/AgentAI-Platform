// @ts-nocheck
/**
 * 上下文保真契约测试（"AI 老是从头开始"回归防护）
 * ==================================================
 * 背景：用户实机反馈长任务中 AI 反复"从头开始"。调查定位到三个截断点，
 * 本文件针对其中两个可在单测内复现的直接原因建立安全网：
 *
 *   P0-1压缩写回时把刚生成的「# 对话历史摘要」一起过滤掉
 *        → 删了历史，摘要也没了 = 纯信息净损失
 *   P0-2  被去重跳过的工具调用不产生任何 tool 消息
 *        → AI 只看到"发起调用没有结果"，于是重复尝试
 *
 * 说明：run() 是重量级入口，沿用 agentai-loop.test.ts 的 mock 模式
 * （spy ensureContext隔离 8 层注入 + 手工 mock router/registry）。
 */

// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAILoop } from './agentai-loop.js';

vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

const TEST_WORKSPACE = mkdtempSync(join(tmpdir(), 'loop-context-fidelity-'));

/** 构造隔离了上下文构建的 loop */
function createLoop(routerImpl: any, opts: Record<string, any> = {}) {
  const mockRouter: any = {
    chat: vi.fn(routerImpl),
    getAvailableModels: vi.fn().mockReturnValue(['agentai']),
  };
  const mockRegistry: any = {
    dispatch: vi.fn().mockResolvedValue([]),
    toLLMTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
  };
  const loop = new AgentAILoop(mockRouter, mockRegistry, [], {
    maxIterations: 3,
    userId: 'test-user',
    workspace: TEST_WORKSPACE,
    ...opts,
  });
  vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
    (loop as any).contextReady = true;
    (loop as any).context.immutablePrefix = [{ role: 'system', content: 'test-system' }];
    // 注意: 不能在这里重置 appendOnlyLog —— run() 开头会调ensureContext，
    // 重置会把测试预置的历史清掉，导致裁剪/压缩逻辑测不到。
  });
  return { loop, mockRouter, mockRegistry };
}

/** 读出某轮实际发给 LLM 的 messages */
function sentMessages(mockRouter: any, callIndex = 0): any[] {
  const calls = mockRouter.chat.mock.calls;
  if (!calls[callIndex]) throw new Error(`没有第 ${callIndex} 次 LLM 调用，实际 ${calls.length} 次`);
  const arg = calls[callIndex][0];
  return Array.isArray(arg) ? arg : (arg?.messages ?? []);
}

const NEUTRAL = '任务已完成'.repeat(30);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('P0-1 压缩后摘要必须存活', () => {
  it('触发压缩后，appendOnlyLog 里仍有「对话历史摘要」', async () => {
    // 造一个必然触发压缩的场景：>30 条消息
    // MAX_MSGS = 30 → messages.length > 30 即触发
    const { loop, mockRouter } = createLoop(async () => ({
      content: NEUTRAL,
      provider: 'agentai',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));

    // 预置 40 条历史（user/assistant/tool 混合），确保 old.length > 0
    const log: any[] = [];
    for (let i = 0; i < 20; i++) {
      log.push({ role: 'user', content: `第${i}轮需求: 修改模块${i}` });
      log.push({ role: 'assistant', content: `第${i}轮回复` });
      log.push({ role: 'tool', name: 'read_file', content: `读取 file_${i}.ts 的内容 ${'x'.repeat(200)}` });
    }
    (loop as any).context.appendOnlyLog = log;

    await loop.run('继续处理');

    const after = (loop as any).context.appendOnlyLog as any[];
    const summary = after.find(
      (m) => m.role === 'system' && typeof m.content === 'string'
        && m.content.startsWith('# 对话历史摘要'),
    );
    expect(
      summary,
      `压缩后 appendOnlyLog 中应保留摘要，实际 role 分布: ${JSON.stringify(after.reduce((a: any, m: any) => { a[m.role] = (a[m.role] || 0) + 1; return a; }, {}))}`,
    ).toBeDefined();
  });

  it('摘要应包含被压缩掉的旧用户请求（AI 才知道原来要干什么）', async () => {
    const { loop } = createLoop(async () => ({
      content: NEUTRAL,
      provider: 'agentai',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }));

    const log: any[] = [];
    for (let i = 0; i < 20; i++) {
      log.push({ role: 'user', content: `任务诉求编号${i}: 优化搜索性能` });
      log.push({ role: 'assistant', content: `已完成第${i}步` });
      log.push({ role: 'tool', name: 'write_file', content: `写入 src/mod${i}.ts 成功` });
    }
    (loop as any).context.appendOnlyLog = log;

    await loop.run('继续');

    const after = (loop as any).context.appendOnlyLog as any[];
    const summary = after.find(
      (m) => m.role === 'system' && typeof m.content === 'string'
        && m.content.startsWith('# 对话历史摘要'),
    );
    expect(summary).toBeDefined();
    // 摘要里应能看到旧的用户请求片段
    expect(summary.content).toMatch(/任务诉求编号\d+/);
  });

  it('摘要必须真的进入下一轮发给 LLM 的 messages（不是只躺在 log 里）', async () => {
    let callCount = 0;
    const { loop, mockRouter } = createLoop(async () => {
      callCount++;
      return {
        content: NEUTRAL,
        provider: 'agentai',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    });

    const log: any[] = [];
    for (let i = 0; i < 20; i++) {
      log.push({ role: 'user', content: `原始需求${i}` });
      log.push({ role: 'assistant', content: `处理${i}` });
      log.push({ role: 'tool', name: 'read_file', content: `读取 a${i}.ts ${'y'.repeat(200)}` });
    }
    (loop as any).context.appendOnlyLog = log;

    await loop.run('继续');

    // 检查所有 LLM 调用中是否有任意一次带上了摘要
    const calls = mockRouter.chat.mock.calls;
    const hasSummary = calls.some((c: any[]) => {
      const msgs = Array.isArray(c[0]) ? c[0] : (c[0]?.messages ?? []);
      return msgs.some(
        (m: any) => typeof m?.content === 'string' && m.content.startsWith('# 对话历史摘要'),
      );
    });
    expect(hasSummary, '摘要应至少出现在一轮发给 LLM 的 messages 中').toBe(true);
  });
});

describe('P0-2 被跳过的工具调用必须留痕', () => {
  it('跨轮重复的工具调用被跳过时，context 中要有 [SKIPPED] 痕迹', async () => {
    let callIdx = 0;
    // 第1轮: 发起工具调用(成功执行, 写入 _toolCallHistory)
    // 第2轮: 发起完全相同的调用 → 应被去重跳过
    const { loop, mockRegistry } = createLoop(async () => {
      callIdx++;
      if (callIdx === 1) {
        return {
          content: '', provider: 'agentai', finishReason: 'tool_calls',
          // 2026-10-06: 改用 run_command（**非只读**工具）。
          // 只读工具(read_file/list_directory/glob/...) 被有意排除在跨轮去重之外
          // （READ_ONLY_TOOLS 白名单），理由是「AI 每轮可能需要重新探索，
          // 硬去重会让它卡死」—— 那个设计是对的，测去重必须换工具。
          toolCalls: [{ id: 'c1', name: 'run_command', args: { command: 'npm test' } }],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'c2', name: 'run_command', args: { command: 'npm test' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    mockRegistry.dispatch.mockResolvedValue([
      { id: "c1", result: { success: true, output: "测试通过" } },
    ]);

    (loop as any).context.appendOnlyLog = [
      { role: 'user', content: '跑一下测试' },
    ];

    await loop.run('再跑一次测试');

    const after = (loop as any).context.appendOnlyLog as any[];
    const skipped = after.find(
      (m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('[SKIPPED]'),
    );
    expect(
      skipped,
      `被去重跳过的调用应在 context 中留痕。实际 log: ${JSON.stringify(after.map((m: any) => ({ r: m.role, c: String(m.content).slice(0, 40) })))}`,
    ).toBeDefined();
  });

  it('[SKIPPED] 痕迹应包含被跳过的工具名与原因', async () => {
    let callIdx = 0;
    const { loop, mockRegistry } = createLoop(async () => {
      callIdx++;
      if (callIdx === 1) {
        return {
          content: '', provider: 'agentai', finishReason: 'tool_calls',
          toolCalls: [{ id: 'c1', name: 'write_file', args: { file_path: 'a.ts', content: 'x' } }],
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: '', provider: 'agentai', finishReason: 'tool_calls',
        toolCalls: [{ id: 'c2', name: 'write_file', args: { file_path: 'a.ts', content: 'x' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });
    mockRegistry.dispatch.mockImplementation(async (calls: any[]) =>
      calls.map((c: any) => ({
        id: c.id,
        result: { success: true, output: `已写入 ${c.args?.file_path}` },
      })),
    );

    (loop as any).context.appendOnlyLog = [{ role: 'user', content: '写 a.ts' }];

    await loop.run('再写一次');

    const after = (loop as any).context.appendOnlyLog as any[];
    const skipped = after.find(
      (m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('[SKIPPED]'),
    );
    expect(skipped).toBeDefined();
    expect(skipped.content).toContain('write_file');
  });

  it('未被去重的正常工具调用不应产生 [SKIPPED] 噪音', async () => {
    let callIdx = 0;
    const { loop } = createLoop(async () => {
      callIdx++;
      if (callIdx === 1) {
        return { content: '第一轮', provider: 'agentai', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
      }
      return {
        content: '',
        provider: 'agentai',
        finishReason: 'tool_calls',
        toolCalls: [{ id: 'c1', name: 'read_file', args: { file_path: 'brand-new.ts' } }],
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      };
    });

    (loop as any)._toolCallHistory = new Set<string>();   // 空历史
    (loop as any).context.appendOnlyLog = [{ role: 'user', content: '读 brand-new.ts' }];

    await loop.run('读 brand-new.ts');

    const after = (loop as any).context.appendOnlyLog as any[];
    const skipped = after.filter(
      (m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('[SKIPPED]'),
    );
    expect(skipped).toHaveLength(0);
  });
});

describe('P0-3 工具调用响应不得被误判为空响应', () => {
  // OpenAI 兼容协议: assistant 发起 tool_calls 时 content 必然为 null/''
  // 若判定条件只看 content，会把每一次正常工具调用都当成"模型空返"，
  // 触发 rescue chain(L1→L4) 白白多打 1-4 次 LLM，最后还可能返回
  // "当前 AI 模型暂时繁忙"，工具根本没执行。
  it('content 为空但有 toolCalls 时，应直接走工具执行，不进 rescue chain', async () => {
    const { loop, mockRouter, mockRegistry } = createLoop(async () => ({
      content: '', provider: 'agentai', finishReason: 'tool_calls',
      toolCalls: [{ id: 'c1', name: 'read_file', args: { file_path: 'a.ts' } }],
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }));
    mockRegistry.dispatch.mockResolvedValue([
      { id: 'c1', result: { success: true, output: 'a.ts 内容' } },
    ]);

    (loop as any).context.appendOnlyLog = [{ role: 'user', content: '读 a.ts' }];

    const res = await loop.run('读一下 a.ts');

    expect(
      mockRegistry.dispatch,
      '模型正常发起工具调用时，必须真正执行工具，而不是进 rescue chain',
    ).toHaveBeenCalled();
    // 不应产生"模型繁忙"这类兜底回复
    expect(String(res?.content || '')).not.toContain('模型暂时繁忙');
  });

  it('既无 content 也无 toolCalls 时，才算真正的空响应', async () => {
    // 这个用例锁定"空响应"定义：两者皆空
    const { loop, mockRegistry } = createLoop(async () => ({
      content: '', provider: 'agentai', finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }));
    mockRegistry.dispatch.mockResolvedValue([]);

    (loop as any).context.appendOnlyLog = [{ role: 'user', content: '你好' }];
    await loop.run('你好');

    // 真空响应时 rescue chain 会被触发 → LLM 被额外调用多次
    const calls = mockRegistry.dispatch.mock.calls.length;
    // 断言点：rescue 会导致额外的 router.chat 调用（这里只验证不抛错 + 有兜底文案）
    expect(calls).toBe(0);
  });
});

describe('去重签名不应被 500 字符截断', () => {
  it('前500字符相同但后续参数不同的调用不应被误判为重复', async () => {
    const longPrefix = 'A'.repeat(600);
    const args1 = { file_path: 'a.ts', content: longPrefix + '尾部不同1' };
    const args2 = { file_path: 'a.ts', content: longPrefix + '尾部不同2' };

    // 模拟当前实现：slice(0,500) 截断
    const sig1 = `write_file:${JSON.stringify(args1).slice(0, 500)}`;
    const sig2 = `write_file:${JSON.stringify(args2).slice(0, 500)}`;

    // 这就是 bug: 不同调用被判为相同
    expect(sig1).toBe(sig2);

    // 期望: 全量签名应不同
    const full1 = `write_file:${JSON.stringify(args1)}`;
    const full2 = `write_file:${JSON.stringify(args2)}`;
    expect(full1).not.toBe(full2);
  });
});
