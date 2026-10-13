/**
 * JumpToBar — findJumpTarget 纯函数单测 (批次8.8, node-env)
 * 三种"跳到时间线"目标的选取逻辑: 最新 / 最近改代码 / 最近工具调用。
 */
import { describe, it, expect } from 'vitest';
import { findJumpTarget } from './JumpToBar';
import type { ChatMessage } from '../../store/chatStore';

const msg = (id: string, segments: any[]): ChatMessage =>
  ({ id, role: 'assistant', segments, ts: 0 }) as any;

describe('findJumpTarget — 最新', () => {
  it('返回末条消息 id', () => {
    const m = [msg('a', []), msg('b', [])];
    expect(findJumpTarget(m, 'latest')).toBe('b');
  });
  it('空列表 → undefined', () => {
    expect(findJumpTarget([], 'latest')).toBeUndefined();
  });
});

describe('findJumpTarget — 最近改代码 (tool 且 args.path)', () => {
  it('从后往前找第一个带 path 的 tool 段', () => {
    const m = [
      msg('a', [{ kind: 'tool', name: 'write_file', args: { path: '/x/a.ts' } }]),
      msg('b', [{ kind: 'text', text: 'hi' }]),
      msg('c', [{ kind: 'tool', name: 'read_file', args: { path: '/x/c.ts' } }]),
    ];
    expect(findJumpTarget(m, 'code')).toBe('c');
  });
  it('没有带 path 的 tool → undefined', () => {
    const m = [msg('a', [{ kind: 'tool', name: 'web_search', args: { q: 'x' } }])];
    expect(findJumpTarget(m, 'code')).toBeUndefined();
  });
});

describe('findJumpTarget — 最近工具调用 (任意 tool)', () => {
  it('从后往前找第一个 tool 段', () => {
    const m = [
      msg('a', [{ kind: 'tool', name: 'x' }]),
      msg('b', [{ kind: 'text', text: 'y' }]),
      msg('c', [{ kind: 'tool', name: 'z' }]),
    ];
    expect(findJumpTarget(m, 'tool')).toBe('c');
  });
  it('没有 tool 段 → undefined', () => {
    expect(findJumpTarget([msg('a', [{ kind: 'text', text: 'hi' }])], 'tool')).toBeUndefined();
  });
});
