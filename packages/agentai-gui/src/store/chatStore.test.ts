/**
 * chatStore 核心逻辑测试 —— 消息域安全网（阶段 0 / T0-1）
 * 覆盖：append 去重、updateMessage 微任务合并、setMessages 原子替换、removeMessages
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { ChatMessage } from './chatStore';

function mkMsg(id: string, text = ''): ChatMessage {
  return {
    id,
    role: 'assistant',
    segments: [{ kind: 'text', text }],
    ts: Date.now(),
    status: 'done',
  };
}

function textOf(m: ChatMessage | undefined): string {
  const seg = m?.segments?.[0];
  return seg && seg.kind === 'text' ? seg.text : '';
}

// 2026-09-04: updateMessage 合帧已从 queueMicrotask 改为 rAF+100ms 兜底;
// 测试等待需超过兜底窗口以确保 flush 完成。
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 150));

describe('chatStore.appendMessage', () => {
  beforeEach(() => {
    useChatStore.getState().setMessages([]);
  });

  it('追加新消息', () => {
    const { appendMessage } = useChatStore.getState();
    appendMessage(mkMsg('a', 'hello'));
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['a']);
  });

  it('同 ID 消息不重复追加（P1-7 去重）', () => {
    const { appendMessage } = useChatStore.getState();
    appendMessage(mkMsg('a', 'first'));
    appendMessage(mkMsg('a', 'second'));
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(textOf(msgs[0])).toBe('first');
  });
});

describe('chatStore.updateMessage 微任务合并', () => {
  beforeEach(() => {
    useChatStore.getState().setMessages([mkMsg('a', '')]);
  });

  it('同一消息的多次更新按顺序合并生效', async () => {
    const { updateMessage } = useChatStore.getState();
    updateMessage('a', (m) => ({ ...m, segments: [{ kind: 'text', text: textOf(m) + 'x' }] }));
    updateMessage('a', (m) => ({ ...m, segments: [{ kind: 'text', text: textOf(m) + 'y' }] }));
    updateMessage('a', (m) => ({ ...m, segments: [{ kind: 'text', text: textOf(m) + 'z' }] }));
    await flushMicrotasks();
    expect(textOf(useChatStore.getState().messages[0])).toBe('xyz');
  });

  it('不同消息互不影响', async () => {
    const s = useChatStore.getState();
    s.setMessages([mkMsg('a', ''), mkMsg('b', '')]);
    const { updateMessage } = useChatStore.getState();
    updateMessage('a', (m) => ({ ...m, segments: [{ kind: 'text', text: 'A' }] }));
    await flushMicrotasks();
    const msgs = useChatStore.getState().messages;
    expect(textOf(msgs.find((m) => m.id === 'a'))).toBe('A');
    expect(textOf(msgs.find((m) => m.id === 'b'))).toBe('');
  });
});

describe('chatStore.setMessages 原子替换', () => {
  it('替换后 pendingUpdates 清空，旧更新不污染新消息', async () => {
    const s = useChatStore.getState();
    s.setMessages([mkMsg('old', '')]);
    s.updateMessage('old', (m) => ({ ...m, segments: [{ kind: 'text', text: 'stale' }] }));
    s.setMessages([mkMsg('new', 'fresh')]);
    await flushMicrotasks();
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('new');
    expect(textOf(msgs[0])).toBe('fresh');
  });
});

describe('chatStore.removeMessages', () => {
  it('批量移除指定 ID', () => {
    const s = useChatStore.getState();
    s.setMessages([mkMsg('a'), mkMsg('b'), mkMsg('c')]);
    s.removeMessages(['a', 'c']);
    expect(useChatStore.getState().messages.map((m) => m.id)).toEqual(['b']);
  });
});
