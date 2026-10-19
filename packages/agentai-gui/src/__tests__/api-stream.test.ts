import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiStream } from '../services/api';

const enc = new TextEncoder();

/**
 * 可控 reader: 精确复现真实 SSE 行为。
 * 关键场景: 末包同时携带 done 事件且 read() 返回 {value, done:true}
 * —— 这正是触发"说一句话就断了"的传输层条件 (done 与 res.end() 同一 TCP 段)。
 */
function mockFetch(readerSeq: Array<{ value?: Uint8Array; done: boolean }>) {
  let i = 0;
  const reader = {
    read: async () => readerSeq[i++] ?? { value: undefined, done: true },
    cancel: async () => {},
  };
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as any));
}

describe('apiStream SSE 解析 — 末包 done 事件不应被丢弃', () => {
  let savedFetch: any;
  beforeEach(() => { savedFetch = (globalThis as any).fetch; });
  afterEach(() => { (globalThis as any).fetch = savedFetch; });

  it('done 事件在末包 (done:true) 中时, onDone 仍被调用 (修复前会丢 → 永久转圈)', async () => {
    (globalThis as any).fetch = mockFetch([
      { value: enc.encode('event: delta\ndata: {"delta":"hello"}\n\n'), done: false },
      // 末包: 同时含 done 事件 且 read 返回 done:true —— 旧代码 if(done) break 会跳过处理
      { value: enc.encode('event: done\ndata: {"content":"hello","provider":"x"}\n\n'), done: true },
    ]);

    let doneInfo: any = null;
    let deltaText = '';
    let errored = '';
    await apiStream('http://x/v1/chat', { message: 'hi' }, {
      onDelta: (t) => { deltaText += t; },
      onDone: (info) => { doneInfo = info; },
      onError: (e) => { errored = e; },
    });

    expect(errored).toBe('');
    expect(doneInfo).not.toBeNull();
    expect(doneInfo.content).toBe('hello');
    expect(doneInfo.provider).toBe('x');
    expect(deltaText).toBe('hello');
  });

  it('流关闭但无 done 事件时, 用已收 delta 兜底 onDone, 绝不卡死转圈', async () => {
    (globalThis as any).fetch = mockFetch([
      { value: enc.encode('event: delta\ndata: {"delta":"partial work"}\n\n'), done: false },
      { value: undefined, done: true },
    ]);

    let doneInfo: any = null;
    let errored = '';
    await apiStream('http://x/v1/chat', { message: 'hi' }, {
      onDelta: () => {},
      onDone: (info) => { doneInfo = info; },
      onError: (e) => { errored = e; },
    });

    // 修复前: 这里会静默 return, doneInfo 永远为 null (卡在 streaming)
    expect(doneInfo).not.toBeNull();
    expect(doneInfo.content).toBe('partial work');
    expect(errored).toBe('');
  });

  it('resume 事件被透传给 onNotice (断线恢复提示)', async () => {
    (globalThis as any).fetch = mockFetch([
      { value: enc.encode('event: resume\ndata: {"received":42,"msg":"SSE 断线恢复中..."}\n\n'), done: false },
      { value: enc.encode('event: done\ndata: {"content":"ok"}\n\n'), done: true },
    ]);

    let notice: any = null;
    let doneInfo: any = null;
    await apiStream('http://x/v1/chat', { message: 'hi' }, {
      onDelta: () => {},
      onDone: (info) => { doneInfo = info; },
      onNotice: (n) => { notice = n; },
    });

    expect(notice).not.toBeNull();
    expect(notice.kind).toBe('reconnect');
    expect(doneInfo.content).toBe('ok');
  });
});
