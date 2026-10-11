import { describe, it, expect } from 'vitest';
import { sanitizeToolMessages } from './message-utils.js';

/**
 * 回归测试: 2026-10-11 真实 400 事故
 * "An assistant message with 'tool_calls' must be followed by tool messages
 *  responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)"
 *
 * 原实现只降级「孤立 tool 消息」, 不修剪 assistant 侧的 tool_calls,
 * 导致「N 个 tool_calls 只回 M<N 条」的部分配对残留 → 上游 400 且重试确定性复现。
 */
const asst = (calls: string[], content: string | null = null) => ({
  role: 'assistant',
  content,
  tool_calls: calls.map(id => ({ id, type: 'function', function: { name: 'f', arguments: '{}' } })),
}) as any;
const tool = (id: string, content = 'ok') => ({ role: 'tool', tool_call_id: id, name: 'f', content }) as any;

describe('sanitizeToolMessages — tool_calls ↔ tool 逐 id 配对', () => {
  it('部分配对: 2 个 tool_calls 只有 1 条回复 → 修剪为 1 个 id', () => {
    const out = sanitizeToolMessages([asst(['a', 'b']), tool('a')] as any);
    expect(out).toHaveLength(2);
    expect(out[0].role).toBe('assistant');
    expect((out[0] as any).tool_calls.map((tc: any) => tc.id)).toEqual(['a']);
    expect((out[1] as any).tool_call_id).toBe('a');
  });

  it('部分配对 + 后续 user: 仍须修剪, 不能把未配对的 id 留在序列里', () => {
    const out = sanitizeToolMessages([
      { role: 'user', content: 'hi' },
      asst(['a', 'b', 'c']),
      tool('a'), tool('c'),
      { role: 'user', content: 'next' },
    ] as any);
    const a = out.find((m: any) => m.role === 'assistant') as any;
    expect(a.tool_calls.map((tc: any) => tc.id)).toEqual(['a', 'c']);
    for (const id of ['a', 'c']) {
      expect(out.some((m: any) => m.role === 'tool' && m.tool_call_id === id)).toBe(true);
    }
    expect(out.filter((m: any) => m.role === 'tool')).toHaveLength(2);
  });

  it('零配对且无正文 → 整个 assistant(tool_calls) 摘除 (原日志 asst=1/tool=0 的 400 场景)', () => {
    const out = sanitizeToolMessages([{ role: 'user', content: 'hi' }, asst(['a', 'b'])] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });

  it('零配对但有正文 → 摘除 tool_calls, 保留 assistant 文本', () => {
    const out = sanitizeToolMessages([asst(['a'], '我先说明一下')] as any);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('assistant');
    expect((out[0] as any).tool_calls).toBeUndefined();
    expect(out[0].content).toBe('我先说明一下');
  });

  it('孤立 tool 消息 (无前置 assistant) → 降级为 system, 不改协议', () => {
    const out = sanitizeToolMessages([{ role: 'user', content: 'hi' }, tool('ghost')] as any);
    expect(out).toHaveLength(2);
    expect(out[1].role).toBe('system');
    expect(String(out[1].content)).toContain('tool-result');
  });

  it('完整配对 → 原样保留', () => {
    const input = [asst(['a', 'b']), tool('a'), tool('b')] as any;
    const out = sanitizeToolMessages(input);
    expect(out).toHaveLength(3);
    expect((out[0] as any).tool_calls).toHaveLength(2);
  });

  it('相邻两个 assistant(tool_calls): 前一个缺回复也要被摘除 (旧实现的追踪漏洞)', () => {
    const out = sanitizeToolMessages([asst(['a']), asst(['b']), tool('b')] as any);
    const assts = out.filter((m: any) => m.role === 'assistant');
    expect(assts).toHaveLength(1);
    expect((assts[0] as any).tool_calls.map((tc: any) => tc.id)).toEqual(['b']);
  });
});
