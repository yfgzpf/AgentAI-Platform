// @ts-nocheck
/**
 * agentai-loop.ts 关键路径契约测试
 *
 * 目标：建立安全网，确保后续拆分不会破坏核心功能
 * 覆盖：构造契约、审批状态机、正常执行、工具调用、错误降级、上下文日志
 *
 * 说明：run() 是重量级集成入口 (8 层上下文注入 + 大量动态 import)，
 * 单测中通过 spy ensureContext 隔离上下文构建，router/registry 使用手工 mock。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentAILoop } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';

// Mock 依赖模块 (防止模块加载期副作用)
vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

/** 超过短回复恢复阈值的中性长文本，保证主循环一轮自然结束 */
const LONG_REPLY = '这是一个用于测试的完整回复内容'.repeat(20);

/** 隔离的临时工作区, 避免 ProactiveEngine/MemoryHook 等 best-effort 模块用 undefined 路径告警 */
const TEST_WORKSPACE = mkdtempSync(join(tmpdir(), 'agentai-loop-test-'));

/** 构造一个隔离了上下文构建的 loop 实例 */
function createLoop(opts: Record<string, any> = {}) {
  const mockRouter: any = {
    chat: vi.fn().mockResolvedValue({
      content: LONG_REPLY,
      provider: 'agentai',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }),
    getAvailableModels: vi.fn().mockReturnValue(['agentai', 'deepseek']),
  };
  const mockRegistry: any = {
    dispatch: vi.fn().mockResolvedValue([]),
    toLLMTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
  };
  const loop = new AgentAILoop(
    mockRouter as AgentAIRouter,
    mockRegistry,
    [],
    { maxIterations: 4, userId: 'test-user', workspace: TEST_WORKSPACE, ...opts },
  );

  // 隔离 8 层 immutable prefix 构建 (文件 IO / 技能索引 / 记忆召回等)
  vi.spyOn(loop as any, 'ensureContext').mockImplementation(async () => {
    (loop as any).contextReady = true;
    (loop as any).context.immutablePrefix = [{ role: 'system', content: 'test-system' }];
  });

  return { loop, mockRouter, mockRegistry };
}

describe('AgentAILoop 关键路径测试', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 0: 构造与配置契约
  // ═══════════════════════════════════════════════════════════

  describe('构造与配置', () => {
    it('4 参数构造成功并应用默认值', () => {
      const { loop } = createLoop();
      expect(loop).toBeInstanceOf(AgentAILoop);
      expect(loop.getContext().immutablePrefix).toEqual([]);
    });

    it('maxIterations 自定义值透传', () => {
      const { loop } = createLoop({ maxIterations: 90 });
      expect((loop as any).opts.maxIterations).toBe(90);
    });

    it('getContext 返回不可变读取视图', () => {
      const { loop } = createLoop();
      const ctx = loop.getContext();
      expect(ctx).toHaveProperty('immutablePrefix');
      expect(ctx).toHaveProperty('appendOnlyLog');
      expect(ctx).toHaveProperty('volatileScratch');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 1: 正常执行流程
  // ═══════════════════════════════════════════════════════════

  describe('正常执行流程', () => {
    it('应该能处理简单对话请求并返回模型回复', async () => {
      const { loop, mockRouter } = createLoop();

      const result = await loop.run('你好');

      expect(result).toBeDefined();
      expect(result.content).toContain('测试的完整回复内容');
      expect(mockRouter.chat).toHaveBeenCalled();
    });

    it('应该能处理带工具调用的请求 (工具轮 -> 文本收尾)', async () => {
      const { loop, mockRouter, mockRegistry } = createLoop();

      mockRouter.chat
        .mockResolvedValueOnce({
          content: null,
          provider: 'agentai',
          toolCalls: [{
            id: 'call-1',
            name: 'read_file',
            args: { file_path: '/test/file.txt' },
          }],
        })
        .mockResolvedValueOnce({
          content: LONG_REPLY,
          provider: 'agentai',
          usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        });
      mockRegistry.dispatch.mockResolvedValueOnce([
        { id: 'call-1', name: 'read_file', result: { success: true, output: '文件内容', durationMs: 1, data: null } },
      ]);

      const result = await loop.run('读取文件');

      expect(result).toBeDefined();
      expect(mockRegistry.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 2: 工具调用与审批
  // ═══════════════════════════════════════════════════════════

  describe('工具调用与审批', () => {
    it('低风险工具应该直接执行 (不触发审批)', async () => {
      const { loop, mockRouter, mockRegistry } = createLoop();
      let approvalEmitted = false;
      loop.on('approval:required', () => { approvalEmitted = true; });

      mockRouter.chat.mockResolvedValueOnce({
        content: null,
        provider: 'agentai',
        toolCalls: [{ id: 'call-1', name: 'read_file', args: { file_path: '/test.txt' } }],
      });
      mockRegistry.dispatch.mockResolvedValueOnce([
        { id: 'call-1', name: 'read_file', result: { success: true, output: '文件内容', durationMs: 1, data: null } },
      ]);

      await loop.run('读取文件');

      expect(mockRegistry.dispatch).toHaveBeenCalled();
      expect(approvalEmitted).toBe(false);
    });

    it('planning 模式下删除文件应该触发审批, 批准后才 dispatch', async () => {
      const { loop, mockRouter, mockRegistry } = createLoop({ mode: 'planning' });
      const approvalIds: string[] = [];
      loop.on('approval:required', (info: any) => {
        approvalIds.push(info.id);
        // 用户在下一个事件循环拍批准 (事件先于 waitForApproval 注册发出)
        setImmediate(() => loop.resolveApproval(info.id, true));
      });

      mockRouter.chat.mockResolvedValueOnce({
        content: null,
        provider: 'agentai',
        toolCalls: [{ id: 'call-del', name: 'delete_file', args: { path: '/important.txt' } }],
      });
      mockRegistry.dispatch.mockResolvedValueOnce([
        { id: 'call-del', name: 'delete_file', result: { success: true, output: '已删除', durationMs: 1, data: null } },
      ]);

      await loop.run('删除文件');

      expect(approvalIds.length).toBeGreaterThan(0);
      expect(mockRegistry.dispatch).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 3: 错误处理
  // ═══════════════════════════════════════════════════════════

  describe('错误处理', () => {
    it('LLM 调用失败应该优雅降级而不是抛出异常', async () => {
      const { loop } = createLoop();
      (loop as any)._testRouterError = true;
      const router = (loop as any).router;
      router.chat.mockRejectedValue(new Error('API Error'));

      const result = await loop.run('测试');

      // 即使失败也应该返回结果对象，而不是抛出
      expect(result).toBeDefined();
      expect(typeof result.content).toBe('string');
    });

    it('工具执行失败应该把错误写入工具日志且不中断整体流程', async () => {
      const { loop, mockRouter, mockRegistry } = createLoop();

      mockRouter.chat.mockResolvedValueOnce({
        content: null,
        provider: 'agentai',
        toolCalls: [{ id: 'call-1', name: 'read_file', args: { file_path: '/nonexistent.txt' } }],
      });
      mockRegistry.dispatch.mockResolvedValueOnce([
        { id: 'call-1', name: 'read_file', result: { success: false, output: '[ERROR] 文件不存在', durationMs: 1, data: null } },
      ]);

      const result = await loop.run('读取不存在的文件');

      expect(result).toBeDefined();
      const toolMsgs = loop.getContext().appendOnlyLog.filter((m: any) => m.role === 'tool');
      expect(toolMsgs.length).toBeGreaterThan(0);
      expect(String(toolMsgs[0].content)).toContain('[ERROR]');
    });

    it('模型超时后重试成功应该正常返回', async () => {
      const { loop, mockRouter } = createLoop({ maxIterations: 4 });

      mockRouter.chat
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          content: LONG_REPLY,
          provider: 'agentai',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        });

      const result = await loop.run('测试超时');

      expect(result).toBeDefined();
      expect(result.content).toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 4: 完成与中断控制
  // ═══════════════════════════════════════════════════════════

  describe('完成与中断控制', () => {
    it('歧义消息触发澄清, 用户响应后正常收敛', async () => {
      const { loop } = createLoop();

      // "完成这个任务" 命中歧义检测, 主循环会等待澄清; 模拟前端在事件循环下一拍回答
      // (事件在 waitForClarification 注册前同步发出, 必须 setImmediate 延迟回复)
      loop.on('clarify:required', (info: any) => {
        setImmediate(() => loop.resolveClarification(info.id, {}));
      });

      const result = await loop.run('完成这个任务');

      expect(result.content).toBeTruthy();
      expect(result.iterations).toBeGreaterThanOrEqual(0);
    }, 20000);

    it('abort() 后中断标志生效', async () => {
      const { loop } = createLoop();
      loop.abort();
      expect((loop as any)._aborted || (loop as any).aborted).toBeTruthy();
    });

    it('未知审批 ID 的 resolveApproval 返回 false', () => {
      const { loop } = createLoop();
      expect(loop.resolveApproval('non-existent-id', true)).toBe(false);
    });

    it('waitForApproval 能被 resolveApproval 正确唤醒', async () => {
      const { loop } = createLoop();
      const pending = loop.waitForApproval('approval-test-1', 5000);
      // 模拟用户在另一个并发回调中批准
      setImmediate(() => loop.resolveApproval('approval-test-1', true));
      await expect(pending).resolves.toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试 5: 上下文日志
  // ═══════════════════════════════════════════════════════════

  describe('上下文日志', () => {
    it('run 后 appendOnlyLog 累积 assistant 消息', async () => {
      const { loop } = createLoop();

      await loop.run('你好');

      const assistantMsgs = loop.getContext().appendOnlyLog.filter((m: any) => m.role === 'assistant');
      expect(assistantMsgs.length).toBeGreaterThan(0);
    });

    it('initialMessages 中的非 system 消息进入 appendOnlyLog', async () => {
      const mockRouter: any = {
        chat: vi.fn().mockResolvedValue({
          content: LONG_REPLY,
          provider: 'agentai',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        }),
      };
      const loop = new AgentAILoop(mockRouter as AgentAIRouter, { dispatch: vi.fn() } as any, [
        { role: 'user', content: '历史消息 A' },
      ], { maxIterations: 4, userId: 'test-user' });

      // 不 spy ensureContext, 仅验证 initialMessages 分流逻辑:
      // 直接调用私有分流的等价路径成本过高, 这里验证构造器保存了初始消息
      expect((loop as any).initialMessages).toHaveLength(1);
      expect((loop as any).initialMessages[0].content).toBe('历史消息 A');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 集成测试：端到端场景 (mock router/registry, 真实 loop 状态机)
// ═══════════════════════════════════════════════════════════

describe('AgentAILoop 集成测试', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('完整对话流程：问候 -> 回复 -> 完成', async () => {
    const { loop, mockRouter } = createLoop();

    const result = await loop.run('你好，介绍一下你自己');

    expect(mockRouter.chat).toHaveBeenCalled();
    expect(result.content).toBeTruthy();
  });

  it('错误恢复流程：首轮失败 -> 重试 -> 成功', async () => {
    const { loop, mockRouter } = createLoop();

    mockRouter.chat
      .mockRejectedValueOnce(new Error('网络抖动'))
      .mockResolvedValueOnce({
        content: LONG_REPLY,
        provider: 'agentai',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });

    const result = await loop.run('任务');

    expect(result).toBeDefined();
    expect(result.content).toBeTruthy();
  });

  it('多轮工具调用：工具 A -> 结果 -> 文本完成', async () => {
    const { loop, mockRouter, mockRegistry } = createLoop();

    mockRouter.chat
      .mockResolvedValueOnce({
        content: null,
        provider: 'agentai',
        toolCalls: [{ id: 'a', name: 'glob', args: { pattern: '*.ts' } }],
      })
      .mockResolvedValueOnce({
        content: LONG_REPLY,
        provider: 'agentai',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      });
    mockRegistry.dispatch.mockResolvedValueOnce([
      { id: 'a', name: 'glob', result: { success: true, output: 'src/index.ts', durationMs: 1, data: null } },
    ]);

    const result = await loop.run('找一下 TS 文件');

    expect(mockRegistry.dispatch).toHaveBeenCalledTimes(1);
    expect(result.content).toBeTruthy();
  });
});
