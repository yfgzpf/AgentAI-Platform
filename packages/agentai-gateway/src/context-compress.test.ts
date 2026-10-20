import { describe, it, expect } from 'vitest';
import { splitForCompression, buildCompressedMessages, isSummaryMessage, SUMMARY_PREFIX } from './context-compress.js';

/**
 * splitForCompression — 压缩切分不切断 tool 父子 (2026-10-20 D6)
 * =====================================================================
 * 事故: agentai-loop 原用 `nonSystem.slice(-keepRecent)` 硬切, 切点落在 tool
 *   消息上时, 它的 assistant(tool_calls) 父消息被压进 old → 孤儿 tool 进 recent
 *   → 回写 appendOnlyLog (父子关联断裂 = 长任务失忆源)。
 */
describe('splitForCompression (2026-10-20 D6)', () => {
  const asst = (ids: string | string[]) => {
    const list = Array.isArray(ids) ? ids : [ids];
    return { role: 'assistant', content: null, tool_calls: list.map(id => ({ id, type: 'function', function: { name: 'f', arguments: '{}' } })) };
  };
  const tool = (id: string) => ({ role: 'tool', tool_call_id: id, content: `result-${id}` });
  const user = (t: string) => ({ role: 'user', content: t });

  it('切点落在 tool 消息上 → 向前扩展到父 assistant (不切父子)', () => {
    // 序列: u1 a1(c1,c1b) t1a t1b u2 a2(c2) t2 —— n=7
    // keepRecent=5 硬切落在 msgs[2]=t1a (tool) → 必须回退到 msgs[1]=a1
    const msgs = [user('u1'), asst(['c1', 'c1b']), tool('c1'), tool('c1b'), user('u2'), asst('c2'), tool('c2')];
    const { head, recent } = splitForCompression(msgs, 5);
    // 硬切本会得到 [t1a, t1b, u2, a2, t2] (首条 tool = 孤儿); 修复后 a1 整组进来
    expect(recent.map((m: any) => m.role)).toEqual(['assistant', 'tool', 'tool', 'user', 'assistant', 'tool']);
    expect(head).toEqual([user('u1')]);
  });

  it('切点落在 user 消息上 → 原样保留 (不回退)', () => {
    const msgs = [user('u1'), asst('c1'), tool('c1'), user('u2'), asst('c2'), tool('c2'), user('u3')];
    const { head, recent } = splitForCompression(msgs, 3);
    // 硬切 start=4 落在 a2 (assistant) 上 → 不回退; recent=[a2,t2,u3]
    expect(recent[0].role).toBe('assistant');
    expect((recent[0] as any).tool_calls[0].id).toBe('c2');
    expect(recent.length).toBe(3);
    expect(head.length).toBe(4);
  });

  it('切点落在 assistant(tool_calls) 上 → 它与它的 tool 回复同段 (天然完整)', () => {
    const msgs = [user('u1'), user('u2'), asst('c1'), tool('c1'), tool('c1b')];
    const { recent } = splitForCompression(msgs, 3);
    // recent = [asst(c1), tool(c1), tool(c1b)] — 首条 assistant 带 tool_calls, 回复随后
    expect(recent[0].role).toBe('assistant');
    expect(recent.filter((m: any) => m.role === 'tool').length).toBe(2);
  });

  it('keepRecent >= 长度 → head 空, recent 全量 (不越界)', () => {
    const msgs = [user('u1'), asst('c1'), tool('c1')];
    const { head, recent } = splitForCompression(msgs, 10);
    expect(head).toEqual([]);
    expect(recent).toEqual(msgs);
  });

  it('开头就是连续 tool (历史遗留孤儿) → start 退到 0, 不抛', () => {
    const msgs = [tool('x'), tool('y'), user('u'), asst('c1'), tool('c1')];
    const { head, recent } = splitForCompression(msgs, 3);
    expect(recent[0].role).toBe('user');
    expect(head.length).toBe(2);
  });

  it('与 buildCompressedMessages 组合: 结果协议合法 (每条 tool 都有父 assistant)', () => {
    const msgs = [user('u1'), asst('c1'), tool('c1'), tool('c1b'), user('u2'), asst('c2'), tool('c2'), user('u3')];
    const { recent } = splitForCompression(msgs, 4);
    const out = buildCompressedMessages([], '# 对话历史摘要 (test)', recent);
    // 遍历: 维护已声明 tool_calls 的 id 集合, 每条 tool 消息必须命中
    const declared = new Set<string>();
    for (const m of out) {
      if (m.role === 'assistant' && (m as any).tool_calls) {
        for (const tc of (m as any).tool_calls) declared.add(tc.id);
      } else if (m.role === 'tool') {
        expect(declared.has((m as any).tool_call_id), `孤儿 tool: ${(m as any).tool_call_id}`).toBe(true);
      }
    }
  });
});

describe('context-compress 不变量 (既有, 回归)', () => {
  it('buildCompressedMessages 恰好一条摘要且紧跟基础 system 之后', () => {
    const base = [{ role: 'system', content: 'sys' }];
    const out = buildCompressedMessages(base, `${SUMMARY_PREFIX} (test)`, [{ role: 'user', content: 'u' }]);
    expect(out.filter(isSummaryMessage).length).toBe(1);
    expect(out[1].content.startsWith(SUMMARY_PREFIX)).toBe(true);
  });

  it('buildCompressedMessages 清掉误混入 baseSystem 的旧摘要 (双保险)', () => {
    const base = [{ role: 'system', content: 'sys' }, { role: 'system', content: `${SUMMARY_PREFIX} (old)` }];
    const out = buildCompressedMessages(base, `${SUMMARY_PREFIX} (new)`, []);
    expect(out.filter(isSummaryMessage).length).toBe(1);
  });
});
