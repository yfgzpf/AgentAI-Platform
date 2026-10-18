import { describe, it, expect } from 'vitest';
import { markStaleToolSegmentsAborted } from './components/chat/chat-utils';

describe('markStaleToolSegmentsAborted: SSE 断连自愈 (2026-10-19)', () => {
  it('running 工具 segment → 标记 error + 明确文案', () => {
    const segs = [
      { kind: 'text', text: 'thinking' },
      { kind: 'tool', callId: 'c1', name: 'run_command', state: 'running', args: { command: 'python x.py' } },
    ];
    const out = markStaleToolSegmentsAborted(segs);
    expect(out[1].state).toBe('error');
    expect(out[1].ok).toBe(false);
    expect(out[1].result).toContain('任务已中止');
    expect(out[1].result).toContain('SSE 连接断开');
    // 原有字段保留 (args/callId 不能丢, 否则卡片渲染崩)
    expect(out[1].callId).toBe('c1');
    expect(out[1].name).toBe('run_command');
    expect(out[1].args).toEqual({ command: 'python x.py' });
  });

  it('已完成/已失败的 segment 不动 (幂等, 不覆盖真实结果)', () => {
    const segs = [
      { kind: 'tool', callId: 'a', state: 'success', ok: true, result: '真实成功输出' },
      { kind: 'tool', callId: 'b', state: 'error', ok: false, result: '真实失败输出' },
    ];
    const out = markStaleToolSegmentsAborted(segs);
    expect(out[0]).toEqual(segs[0]);
    expect(out[1]).toEqual(segs[1]);
  });

  it('已有 result 的 running segment 保留原 result (不丢部分输出)', () => {
    const segs = [{ kind: 'tool', callId: 'c', state: 'running', result: '半截输出' }];
    const out = markStaleToolSegmentsAborted(segs);
    expect(out[0].state).toBe('error');
    expect(out[0].result).toBe('半截输出');
  });

  it('非 tool segment 与畸形输入不炸', () => {
    expect(markStaleToolSegmentsAborted([{ kind: 'text', text: 'x' }])).toHaveLength(1);
    expect(markStaleToolSegmentsAborted([] as any)).toEqual([]);
    expect(markStaleToolSegmentsAborted(undefined as any)).toBeUndefined();
  });

  it('多个 running 一次全部标记', () => {
    const segs = [
      { kind: 'tool', callId: 'a', state: 'running' },
      { kind: 'tool', callId: 'b', state: 'running' },
      { kind: 'tool', callId: 'c', state: 'running' },
    ];
    const out = markStaleToolSegmentsAborted(segs);
    expect(out.every((s: any) => s.state === 'error')).toBe(true);
  });
});
