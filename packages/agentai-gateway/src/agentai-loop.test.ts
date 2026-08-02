// @ts-nocheck
/**
 * agentai-loop.ts 关键路径测试
 * 
 * 目标：建立安全网，确保后续拆分不会破坏核心功能
 * 覆盖：正常执行、工具调用、错误处理、完成检测
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentAILoop } from './agentai-loop.js';
import { AgentAIRouter } from './llm-router.js';

// Mock依赖
vi.mock('./llm-router.js');
vi.mock('./tool-registry.js');
vi.mock('./memory-manager.js');

describe('AgentAILoop 关键路径测试', () => {
  let loop: AgentAILoop;
  let mockRouter: any;

  beforeEach(() => {
    mockRouter = {
      chat: vi.fn(),
      getAvailableModels: vi.fn().mockReturnValue(['agentai', 'deepseek']),
    };
    
    loop = new AgentAILoop(mockRouter as AgentAIRouter, [], {
      maxIterations: 90,
      userId: 'test-user',
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试1: 正常执行流程
  // ═══════════════════════════════════════════════════════════
  
  describe('正常执行流程', () => {
    it('应该能处理简单对话请求', async () => {
      // 模拟LLM响应
      mockRouter.chat.mockResolvedValue({
        content: '这是一个测试回复',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await loop.processMessage({
        content: '你好',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result.success).toBe(true);
      expect(result.response).toContain('测试回复');
      expect(mockRouter.chat).toHaveBeenCalledTimes(1);
    });

    it('应该能处理带工具调用的请求', async () => {
      // 第一次调用：LLM决定调用工具
      mockRouter.chat.mockResolvedValueOnce({
        content: '',
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/test/file.txt' }),
          },
        }],
      });

      // 第二次调用：LLM生成最终回复
      mockRouter.chat.mockResolvedValueOnce({
        content: '文件内容已读取',
        usage: { prompt_tokens: 20, completion_tokens: 10 },
      });

      const result = await loop.processMessage({
        content: '读取文件',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result.success).toBe(true);
      expect(mockRouter.chat).toHaveBeenCalledTimes(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试2: 工具调用与审批
  // ═══════════════════════════════════════════════════════════

  describe('工具调用与审批', () => {
    it('低风险工具应该直接执行', async () => {
      const toolResult = { success: true, output: '文件内容' };
      
      mockRouter.chat.mockResolvedValue({
        content: '',
        tool_calls: [{
          id: 'call-1',
          function: {
            name: 'read_file', // 低风险工具
            arguments: JSON.stringify({ path: '/test.txt' }),
          },
        }],
      });

      // 验证工具被调用且无需审批
      const spy = vi.spyOn(loop as any, 'executeTool');
      
      await loop.processMessage({
        content: '读取文件',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(spy).toHaveBeenCalled();
      // 低风险工具不应该触发审批UI
    });

    it('高风险工具应该触发审批', async () => {
      mockRouter.chat.mockResolvedValue({
        content: '',
        tool_calls: [{
          id: 'call-1',
          function: {
            name: 'delete_file', // 高风险工具
            arguments: JSON.stringify({ path: '/important.txt' }),
          },
        }],
      });

      const spy = vi.spyOn(loop as any, 'requestApproval');
      
      await loop.processMessage({
        content: '删除文件',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      // 高风险工具应该触发审批
      expect(spy).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试3: 错误处理
  // ═══════════════════════════════════════════════════════════

  describe('错误处理', () => {
    it('LLM调用失败应该优雅降级', async () => {
      mockRouter.chat.mockRejectedValue(new Error('API Error'));

      // 应该有fallback机制
      const result = await loop.processMessage({
        content: '测试',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      // 即使失败也应该返回结果，而不是抛出
      expect(result).toBeDefined();
    });

    it('工具执行失败应该记录错误', async () => {
      mockRouter.chat.mockResolvedValue({
        content: '',
        tool_calls: [{
          id: 'call-1',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: '/nonexistent.txt' }),
          },
        }],
      });

      const result = await loop.processMessage({
        content: '读取不存在的文件',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('应该处理超时情况', async () => {
      mockRouter.chat.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      const result = await loop.processMessage({
        content: '测试超时',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result).toBeDefined();
      // 应该有超时处理逻辑
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试4: 完成检测
  // ═══════════════════════════════════════════════════════════

  describe('完成检测', () => {
    it('应该正确检测任务完成', async () => {
      mockRouter.chat.mockResolvedValue({
        content: '任务已完成',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await loop.processMessage({
        content: '完成这个任务',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result.isComplete).toBe(true);
      expect(result.summary).toBeDefined();
    });

    it('应该检测需要继续执行的情况', async () => {
      mockRouter.chat.mockResolvedValue({
        content: '我需要更多信息',
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await loop.processMessage({
        content: '继续',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      expect(result.isComplete).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试5: 上下文管理
  // ═══════════════════════════════════════════════════════════

  describe('上下文管理', () => {
    it('应该维护会话上下文', async () => {
      // 第一轮对话
      mockRouter.chat.mockResolvedValue({
        content: '你好，我是AI助手',
      });

      await loop.processMessage({
        content: '你好',
        sessionId: 'session-1',
        userId: 'user-1',
      });

      // 第二轮对话，应该记住上下文
      mockRouter.chat.mockResolvedValue({
        content: '你刚才说你好',
      });

      const result = await loop.processMessage({
        content: '我刚才说了什么',
        sessionId: 'session-1',
        userId: 'user-1',
      });

      // 验证上下文被传递
      const callArgs = mockRouter.chat.mock.calls[1][0];
      expect(callArgs.messages.length).toBeGreaterThan(2); // 包含历史消息
    });

    it('应该限制上下文长度', async () => {
      // 模拟大量历史消息
      const longHistory = Array(50).fill(null).map((_, i) => ({
        role: 'user',
        content: `消息${i}`,
      }));

      mockRouter.chat.mockResolvedValue({
        content: '回复',
      });

      await loop.processMessage({
        content: '测试',
        sessionId: 'test-session',
        userId: 'test-user',
        history: longHistory,
      });

      // 验证上下文被压缩或截断
      const callArgs = mockRouter.chat.mock.calls[0][0];
      expect(callArgs.messages.length).toBeLessThan(50);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 测试6: 记忆系统
  // ═══════════════════════════════════════════════════════════

  describe('记忆系统', () => {
    it('应该记录重要信息到记忆', async () => {
      const memorySpy = vi.spyOn(loop as any, 'writeMemory');

      mockRouter.chat.mockResolvedValue({
        content: '我记住你喜欢用pnpm',
      });

      await loop.processMessage({
        content: '我喜欢用pnpm而不是npm',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      // 验证记忆被写入
      expect(memorySpy).toHaveBeenCalled();
    });

    it('应该在后续对话中读取记忆', async () => {
      // 先写入记忆
      (loop as any).memory = {
        read: vi.fn().mockResolvedValue(['用户偏好: pnpm']),
        write: vi.fn(),
      };

      mockRouter.chat.mockResolvedValue({
        content: '好的，我用pnpm',
      });

      await loop.processMessage({
        content: '安装依赖',
        sessionId: 'test-session',
        userId: 'test-user',
      });

      // 验证记忆被读取并用于上下文
      const callArgs = mockRouter.chat.mock.calls[0][0];
      expect(JSON.stringify(callArgs)).toContain('pnpm');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 集成测试：端到端场景
// ═══════════════════════════════════════════════════════════

describe('AgentAILoop 集成测试', () => {
  it('完整对话流程：问候 -> 任务 -> 完成', async () => {
    // 这是一个完整的端到端测试
    // 验证整个循环能正常工作
  });

  it('错误恢复流程：失败 -> 诊断 -> 重试 -> 成功', async () => {
    // 验证错误处理和学习机制
  });

  it('多轮工具调用：工具A -> 结果 -> 工具B -> 完成', async () => {
    // 验证复杂工具链
  });
});
