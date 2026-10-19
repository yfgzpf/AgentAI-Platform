/**
 * context-compress 回归测试
 *
 * 事故 (富哥 2026-10-19 实锤截图):
 *   长渗透任务的前端被 "⏳ 已自动压缩上下文 (保留 N 条关键记忆, 压缩 M 条)" 刷屏,
 *   一屏几十条, 对话被拉得极长; 而且"保留条数"从 46 一路涨到 298 —— 压缩根本没把
 *   消息数降下来。
 *
 * 根因: 回写 appendOnlyLog 时保留了**所有** "# 对话历史摘要" 开头的 system 消息,
 *   而每次压缩都新造一条 → 摘要累积 → messages.length 只增不减 →
 *   `messages.length > MAX_MSGS(30)` 永远成立 → 每一轮都压缩 + 每轮都发提示。
 *
 * 这里锁住两条不变量:
 *   ① 无论压缩多少次, 摘要永远只有 1 条, 消息总数有上界
 *   ② 压缩提示必须节流 (首次 / 90s 后 / 大压缩才发)
 */
import { describe, it, expect } from 'vitest';
import {
  SUMMARY_PREFIX,
  isSummaryMessage,
  partitionSystemMessages,
  foldSummaries,
  buildCompressedMessages,
  shouldNotifyCompress,
} from '../context-compress.js';

describe('context-compress: 摘要不许累积', () => {
  it('连续 20 轮压缩: 消息数恒定, 且永远只有一条摘要', () => {
    const base = [
      { role: 'system', content: '你是助手' },
      { role: 'system', content: '工具说明' },
    ];
    let systemMsgs: any[] = [...base];
    let recent: any[] = [{ role: 'tool', content: 'r-1' }];
    const totals: number[] = [];

    for (let round = 0; round < 20; round++) {
      // 每轮新增 10 条工具结果, 只留最近 10 条 (对应 keepRecent=10)
      recent = Array.from({ length: 10 }, (_, i) => ({ role: 'tool', content: `r${round}-${i}` }));

      const { base: baseMsgs, summaries } = partitionSystemMessages(systemMsgs);
      const folded = foldSummaries(summaries, 1200);
      const header = `${SUMMARY_PREFIX} (累计 ${round + 1} 条消息已压缩)`;
      const content = folded ? `${header}\n## 更早的摘要 (已折叠)\n${folded}` : header;

      const messages = buildCompressedMessages(baseMsgs, content, recent);
      systemMsgs = messages.filter((m) => m.role === 'system');
      totals.push(messages.length);

      // 不变量 ①: 摘要恰好 1 条
      expect(messages.filter(isSummaryMessage).length, `round ${round}`).toBe(1);
      // 不变量 ②: 总数由 base + 1 + recent 决定, 不随轮次膨胀
      expect(messages.length).toBe(base.length + 1 + recent.length);
    }

    // 旧实现这里会 3 → 4 → 5 ... 一路涨; 现在必须恒定
    expect(Math.max(...totals)).toBe(Math.min(...totals));
    // 且必须留在 MAX_MSGS(30) 以下, 否则又会"每轮都压缩"
    expect(Math.max(...totals)).toBeLessThan(30);
  });

  it('buildCompressedMessages 会清掉混进 base 的旧摘要 (双保险)', () => {
    const dirtyBase = [
      { role: 'system', content: '系统提示' },
      { role: 'system', content: `${SUMMARY_PREFIX} (旧)` },
      { role: 'system', content: '台账' },
    ];
    const out = buildCompressedMessages(dirtyBase, `${SUMMARY_PREFIX} (新)`, [{ role: 'user', content: 'hi' }]);
    expect(out.filter(isSummaryMessage).length).toBe(1);
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('isSummaryMessage 只认前缀, 不误判普通 system', () => {
    expect(isSummaryMessage({ role: 'system', content: `${SUMMARY_PREFIX} x` })).toBe(true);
    expect(isSummaryMessage({ role: 'system', content: '台账内容' })).toBe(false);
    expect(isSummaryMessage({ role: 'user', content: `${SUMMARY_PREFIX} x` })).toBe(false);
    expect(isSummaryMessage(null)).toBe(false);
  });
});

describe('context-compress: 摘要折叠', () => {
  it('多条摘要按顺序拼接', () => {
    const out = foldSummaries([
      { role: 'system', content: `${SUMMARY_PREFIX} (1)\nAAA` },
      { role: 'system', content: `${SUMMARY_PREFIX} (2)\nBBB` },
    ]);
    expect(out).toContain('AAA');
    expect(out).toContain('BBB');
    // 前缀头不该被重复带进正文
    expect(out.match(/# 对话历史摘要/g)).toBeNull();
  });

  it('超长时保留最新内容并标注省略', () => {
    const long = 'x'.repeat(3000) + 'NAIL';
    const out = foldSummaries([{ role: 'system', content: `${SUMMARY_PREFIX}\n${long}` }], 500);
    expect(out.length).toBeLessThanOrEqual(560);
    expect(out).toContain('NAIL');      // 最新内容必须留住
    expect(out).toContain('已省略');
  });

  it('空输入返回空串', () => {
    expect(foldSummaries([])).toBe('');
    expect(foldSummaries([{ role: 'system', content: `${SUMMARY_PREFIX}` }])).toBe('');
  });
});

describe('context-compress: 提示节流', () => {
  it('首次必发', () => {
    expect(shouldNotifyCompress(0, 1_000_000, 2)).toBe(true);
  });

  it('90s 内不重复发 (否则一屏几十条)', () => {
    expect(shouldNotifyCompress(1_000_000, 1_000_000 + 5_000, 3)).toBe(false);
    expect(shouldNotifyCompress(1_000_000, 1_000_000 + 89_000, 3)).toBe(false);
  });

  it('超过间隔后可以再发', () => {
    expect(shouldNotifyCompress(1_000_000, 1_000_000 + 90_000, 3)).toBe(true);
  });

  it('一次压得很多 (>=15) 时值得立刻说一句', () => {
    expect(shouldNotifyCompress(1_000_000, 1_000_000 + 1_000, 15)).toBe(true);
    expect(shouldNotifyCompress(1_000_000, 1_000_000 + 1_000, 14)).toBe(false);
  });
});
