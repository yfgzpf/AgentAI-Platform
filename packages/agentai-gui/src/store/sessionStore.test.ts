/**
 * sessionStore 回归测试 — 2026-10-21 修复: 切会话后内容消失
 *  ① upsertMessages 按 id 新增/覆盖, 绝不重复 append (修复「同一条消息被存成多份」)
 *  ② 完整 segments(含 reasoning/thinking 思考过程) 入库并在 JSON 往返后保留
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore, capSessionMessages } from './sessionStore';

const reset = () => {
  const s = useSessionStore.getState();
  // 清空所有会话, 避免用例间串扰
  (s as any).sessions = [];
  (s as any).activeId = null;
};

describe('sessionStore 持久化完整性', () => {
  beforeEach(reset);

  it('upsertMessages 按 id 覆盖而非重复', () => {
    const { createSession, upsertMessages, sessions: get } = useSessionStore.getState();
    const id = createSession('t', 'u', 'chat');

    upsertMessages(id, [{ id: 'b1', role: 'assistant', content: '初', ts: 1, segments: [{ kind: 'text', text: '初' }] }]);
    upsertMessages(id, [{ id: 'b1', role: 'assistant', content: '终', ts: 1, segments: [{ kind: 'text', text: '终' }] }]);

    const sess = useSessionStore.getState().sessions.find(s => s.id === id)!;
    expect(sess.messages.length).toBe(1); // 同 id → 覆盖, 不是两条
    expect((sess.messages[0] as any).content).toBe('终');
  });

  it('完整 segments(含 reasoning 思考过程) 在 JSON 往返后保留', () => {
    const { createSession, upsertMessages } = useSessionStore.getState();
    const id = createSession('t2', 'u', 'chat');
    const segs = [
      { kind: 'reasoning', text: '先想一步: 用户要的是生图' },
      { kind: 'text', text: '这是最终回答' },
      { kind: 'tool', name: 'run_command', result: 'ok', status: 'success' },
    ];
    upsertMessages(id, [{ id: 'b2', role: 'assistant', content: '这是最终回答', ts: 2, segments: segs }]);

    // 模拟 persist → 重新 hydrate (JSON 序列化往返)
    const json = JSON.stringify({ state: { sessions: useSessionStore.getState().sessions }, version: 1 });
    const back = JSON.parse(json);
    const restored = back.state.sessions.find((s: any) => s.id === id)!;
    const stored = restored.messages[0];

    expect(Array.isArray(stored.segments)).toBe(true);
    expect(stored.segments.length).toBe(3);
    expect(stored.segments[0].kind).toBe('reasoning');
    expect(stored.segments[0].text).toContain('先想一步');
    expect(stored.segments[1].text).toBe('这是最终回答');
    expect(stored.segments[2].kind).toBe('tool');
  });
});

describe('会话消息上限: 迁 IndexedDB 后不再丢头 (2026-10-22 ① 根治)', () => {
  it('未超安全网时原样返回 (不复制数组, 正常长任务零丢失)', () => {
    const arr = Array.from({ length: 400 }, (_, i) => ({ id: `m${i}` }));
    // 旧 cap=300 会把这条 400 的会话截成 300, 丢掉开头; 新 cap=50000 必须原样保留
    const capped = capSessionMessages(arr);
    expect(capped).toBe(arr);
    expect(capped.length).toBe(400);
    expect(capped[0].id).toBe('m0');
    expect(capped[capped.length - 1].id).toBe('m399');
  });

  it('upsertMessages 存 400 条后, 全量保留且首条仍在 (以前 slice(-300) 会丢任务开头)', () => {
    const { createSession, upsertMessages } = useSessionStore.getState();
    const id = createSession('cap', 'u', 'chat');
    const payloads = Array.from({ length: 400 }, (_, i) => ({
      id: `p${i}`, role: 'user', content: `c${i}`, ts: i,
      segments: [{ kind: 'text', text: `c${i}` }],
    }));
    upsertMessages(id, payloads);
    const sess = useSessionStore.getState().sessions.find(x => x.id === id)!;
    // ★ 关键修复: 不再被截成 300, 400 条全在
    expect(sess.messages.length).toBe(400);
    expect(sess.messages[0].id).toBe('p0');
    expect(sess.messages[sess.messages.length - 1].id).toBe('p399');
  });

  it('极端安全网 (5万+) 仍保头, 不丢"任务原始要求"', () => {
    const arr = Array.from({ length: 60_000 }, (_, i) => ({ id: `z${i}` }));
    const capped = capSessionMessages(arr);
    // 仅极端情况下才触发, 且开头 20 条必须保留
    expect(capped.length).toBe(50_000);
    expect(capped[0].id).toBe('z0');
    expect(capped[19].id).toBe('z19');
    expect(capped[capped.length - 1].id).toBe('z59999');
  });
});
