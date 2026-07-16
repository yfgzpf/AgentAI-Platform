/**
 * token-utils 单元测试
 * ----------------------------------------------------
 * 验证: 中英文混合 / 工具调用 / 多模态 / 异常边界
 */
import { describe, it, expect } from 'vitest';
import {
  estimateStringTokens,
  estimateContentTokens,
  estimateMessagesTokens,
  estimateToolCallsTokens,
} from './token-utils.js';

describe('estimateStringTokens', () => {
  it('空字符串返回 0', () => {
    expect(estimateStringTokens('')).toBe(0);
  });

  it('纯英文按 ~4 字符/token 估算', () => {
    // "Hello world" = 11 字符 -> ~3 tokens
    const t = estimateStringTokens('Hello world');
    expect(t).toBeGreaterThanOrEqual(2);
    expect(t).toBeLessThanOrEqual(4);
  });

  it('纯中文按 ~1.5 字符/token 估算', () => {
    // "你好世界" = 4 字符 -> ~6 tokens
    const t = estimateStringTokens('你好世界');
    expect(t).toBe(6);
  });

  it('中英文混合', () => {
    // "Hello 你好" = 5 en + 2 zh = 5/4 + 2*1.5 = 4.25 → ceil 5
    const t = estimateStringTokens('Hello 你好');
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThanOrEqual(6);
  });

  it('数字和符号按 ~4 字符/token 估算', () => {
    // "1234 5678" = 9 字符 (含空格) -> num/sym 部分 ~2-3 tokens
    const t = estimateStringTokens('1234 5678');
    expect(t).toBeGreaterThan(0);
  });
});

describe('estimateContentTokens', () => {
  it('字符串内容', () => {
    const t = estimateContentTokens('hello world');
    expect(t).toBeGreaterThan(0);
  });

  it('空内容返回 0', () => {
    expect(estimateContentTokens(null)).toBe(0);
    expect(estimateContentTokens(undefined)).toBe(0);
    expect(estimateContentTokens('')).toBe(0);
  });

  it('多模态数组 (文本块)', () => {
    const t = estimateContentTokens([
      { type: 'text', text: '你好世界' },
    ]);
    expect(t).toBe(6);
  });

  it('多模态数组 (图片块) 固定 170 tokens', () => {
    const t = estimateContentTokens([
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ]);
    expect(t).toBe(170);
  });
});

describe('estimateMessagesTokens', () => {
  it('单条系统消息', () => {
    const t = estimateMessagesTokens([
      { role: 'system', content: '你是一个 AI 助手' },
    ]);
    // 3 (前缀) + 4 (msg) + 6 (8字符 zh) = 13
    expect(t).toBeGreaterThan(10);
  });

  it('多轮对话 + 工具定义', () => {
    const t = estimateMessagesTokens(
      [
        { role: 'system', content: '你是一个 AI 助手' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好! 有什么可以帮你' },
      ],
      [{ name: 'read_file', description: '读取文件', parameters: { type: 'object' } }],
    );
    expect(t).toBeGreaterThan(15);
  });

  it('含 tool_calls 的 assistant 消息', () => {
    const t = estimateMessagesTokens([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { name: 'read_file', arguments: '{"path":"/tmp/test.ts"}' } },
        ],
      },
    ]);
    expect(t).toBeGreaterThan(10);
  });
});

describe('estimateToolCallsTokens', () => {
  it('空数组返回 0', () => {
    expect(estimateToolCallsTokens([])).toBe(0);
  });

  it('单个工具调用', () => {
    const t = estimateToolCallsTokens([
      { function: { name: 'read_file', arguments: '{"path":"/tmp/test.ts"}' } },
    ]);
    expect(t).toBeGreaterThan(5);
  });

  it('多个工具调用累加', () => {
    const t1 = estimateToolCallsTokens([
      { function: { name: 'a', arguments: '{}' } },
    ]);
    const t2 = estimateToolCallsTokens([
      { function: { name: 'a', arguments: '{}' } },
      { function: { name: 'b', arguments: '{"x":1}' } },
    ]);
    expect(t2).toBeGreaterThan(t1);
  });
});
