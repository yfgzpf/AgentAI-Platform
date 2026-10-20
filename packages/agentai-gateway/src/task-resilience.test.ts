/**
 * 任务不中断 / 不假成功 回归 (2026-10-21)
 * ================================================================
 * 对应实机日志:
 *   - 同一会话两个 run 交错 (路径写法不同 → sessionKey 不同)
 *   - 109 字符流式响应被当成完整结束 (finishReason 恒 stop)
 *   - 0 个工具动作仍记 success=true
 *   - 预算 63889 > 60000, "丢弃 3 条"却列出 8 个名字
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { sessionKeyOf } from './ws-paths.js';
import { enforceContextBudget, hasTaskProgress, SECURITY_PROGRESS_TOOLS } from './agentai-loop.js';
import { decideStreamFinishReason } from './llm-router.js';
import { extractMessageText } from './message-utils.js';

const LOOP_SRC = fs.readFileSync(new URL('./agentai-loop.ts', import.meta.url), 'utf-8');
const CHAT_SRC = fs.readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf-8');
const ROUTER_SRC = fs.readFileSync(new URL('./llm-router.ts', import.meta.url), 'utf-8');

describe('① 会话 key 归一化: 同一项目只有一把钥匙', () => {
  it('反斜杠 / 正斜杠 / 尾斜杠 / 重复斜杠 → 同一个 key', () => {
    const a = sessionKeyOf('u1', 'F:\\挖洞赏金');
    const b = sessionKeyOf('u1', 'F:/挖洞赏金');
    const c = sessionKeyOf('u1', 'F:/挖洞赏金/');
    const d = sessionKeyOf('u1', 'F://挖洞赏金//');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
    expect(a).toBe('u1:F:/挖洞赏金');
  });

  it('不同用户 / 不同项目仍是不同 key', () => {
    expect(sessionKeyOf('u1', 'F:/a')).not.toBe(sessionKeyOf('u2', 'F:/a'));
    expect(sessionKeyOf('u1', 'F:/a')).not.toBe(sessionKeyOf('u1', 'F:/b'));
  });

  it('chat.ts 用归一化 key, 且 abort 前落断点', () => {
    expect(CHAT_SRC).toContain('const sessionKey = sessionKeyOf(userId, workspace);');
    expect(CHAT_SRC).toContain('snapshotBeforeSupersede');
    // 调用顺序: 先快照, 再 abort
    const snapIdx = CHAT_SRC.indexOf('snapshotBeforeSupersede');
    const abortIdx = CHAT_SRC.indexOf('prevEntry.abort()', snapIdx);
    expect(snapIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeGreaterThan(snapIdx);
  });
});

describe('② 预算仲裁: 同一条消息只扣一次, 且必须报真实剩余', () => {
  const mk = (chars: number, role: any = 'system') => ({ role, content: 'x'.repeat(chars) } as any);

  it('同一 message 被重复登记 → 只扣一次; names 全部保留', () => {
    const m = mk(120);
    const mandatory = mk(10);
    const r = enforceContextBudget(
      [m, mandatory],
      [
        { msg: m, name: 'soul:dream', priority: 40 },
        { msg: m, name: 'soul:inner', priority: 40 },
        { msg: mandatory, name: 'core', priority: 0 },
      ],
      100,
      30,
    );
    expect(r.dropped).toBe(1);              // 只丢 1 条 message
    expect(r.droppedNames.length).toBe(2);  // 但登记项有 2 个
    expect(r.postChars).toBe(10);           // 真实剩余 = 10, 不是 120 被扣两次
    expect(r.overBudget).toBe(false);
  });

  it('必保留项占用超预算 → 不丢, 明确 overBudget', () => {
    const m = mk(120);
    const r = enforceContextBudget([m], [{ msg: m, name: 'core', priority: 0 }], 100, 30);
    expect(r.dropped).toBe(0);
    expect(r.overBudget).toBe(true);
    expect(r.postChars).toBe(120);
  });

  it('未超预算 → 原样返回', () => {
    const m = mk(50);
    const r = enforceContextBudget([m], [{ msg: m, name: 'a', priority: 40 }], 100, 30);
    expect(r.dropped).toBe(0);
    expect(r.messages).toEqual([m]);
    expect(r.overBudget).toBe(false);
  });

  it('源码日志包含 drop 前后总量 (不再只报超预算)', () => {
    expect(LOOP_SRC).toContain('丢弃后 ${budget.postChars} 字符');
  });
});

describe('③ 安全任务真实进度: 0 个专用工具动作不算进度', () => {
  it('security + 无工具 → false; 有 diff_replay → true', () => {
    expect(hasTaskProgress('security', [])).toBe(false);
    expect(hasTaskProgress('security', ['read_file', 'write_file'])).toBe(false);
    expect(hasTaskProgress('security', ['diff_replay'])).toBe(true);
    expect(hasTaskProgress('security', ['fingerprint_target'])).toBe(true);
  });

  it('非 security 任务不受限制', () => {
    expect(hasTaskProgress('coding', [])).toBe(true);
    expect(hasTaskProgress('general', ['read_file'])).toBe(true);
  });

  it('进度工具集覆盖决定性能力', () => {
    for (const t of ['diff_replay', 'fingerprint_target', 'http_replay', 'save_and_hash_evidence', 'bounty_report']) {
      expect(SECURITY_PROGRESS_TOOLS.has(t)).toBe(true);
    }
  });

  it('完成/成功判定已接入进度; 空跑改为 paused + no_progress', () => {
    expect(LOOP_SRC).toContain('const runProgressed = hasTaskProgress(this._taskType, this._runToolNames);');
    expect(LOOP_SRC).toContain("taskSnap.pause('no_progress')");
    expect(LOOP_SRC).toContain('const success = qualityScore >= 0.4 && runProgressed;');
    expect(LOOP_SRC).toContain('progress=${runProgressed}');
    expect(LOOP_SRC).toContain('this._runToolNames.add(c.name)');
  });
});

describe('④ 流式结束原因: 截断不再伪装成完成', () => {
  it('stream_error / length / truncated / stop 四态', () => {
    expect(decideStreamFinishReason({ streamError: 'boom', sawDone: true, lastFinishReason: 'stop', contentLen: 100 })).toBe('stream_error');
    expect(decideStreamFinishReason({ streamError: null, sawDone: true, lastFinishReason: 'length', contentLen: 100 })).toBe('length');
    expect(decideStreamFinishReason({ streamError: null, sawDone: false, lastFinishReason: '', contentLen: 109 })).toBe('truncated');
    expect(decideStreamFinishReason({ streamError: null, sawDone: true, lastFinishReason: 'stop', contentLen: 109 })).toBe('stop');
    // 空内容且没 DONE: 交给上层 fallback, 不当截断续写
    expect(decideStreamFinishReason({ streamError: null, sawDone: false, lastFinishReason: '', contentLen: 0 })).toBe('stop');
  });

  it('源码: 追踪 [DONE] / finish_reason, 并对 truncated 自动续写', () => {
    expect(ROUTER_SRC).toContain('let sawDone = false;');
    expect(ROUTER_SRC).toContain("if (data === '[DONE]') { sawDone = true; continue; }");
    expect(ROUTER_SRC).toContain('decideStreamFinishReason({');
    expect(LOOP_SRC).toContain("res.finishReason === 'length' || res.finishReason === 'truncated'");
    expect(LOOP_SRC).toContain("reason: _truncReason");
  });
});

describe('⑤ 结构化消息取文本 + 代理项就地修复', () => {
  it('extractMessageText 覆盖 string / 多模态 / 对象 / 空值', () => {
    expect(extractMessageText('继续上次的挖洞')).toBe('继续上次的挖洞');
    expect(extractMessageText([
      { type: 'text', text: '继续 jxnu' },
      { type: 'image_url', image_url: { url: 'x' } },
      { type: 'text', text: '目标 jxnu.edu.cn' },
    ])).toBe('继续 jxnu\n目标 jxnu.edu.cn');
    expect(extractMessageText({ content: '继续' })).toBe('继续');
    expect(extractMessageText(null)).toBe('');
    expect(extractMessageText([{ type: 'image_url' }])).toBe('');
  });

  it('任务隔离不再用 typeof === string 判空', () => {
    expect(LOOP_SRC).toContain('const currentMsg = extractMessageText(userMessage);');
  });

  it('孤立代理项在发送时就地修复, 而不是每轮重复告警', () => {
    expect(ROUTER_SRC).toContain('已就地修复为 U+FFFD');
    expect(ROUTER_SRC).toContain('(m as any).content = sanitizeForJson(c);');
  });
});
