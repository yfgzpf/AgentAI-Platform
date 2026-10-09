/**
 * 决策抽取测试 —— 锁定「AI 推翻重议」这个失忆症状
 * ========================================================================
 * 场景: AI 第 3 轮说"决定用 execFile 参数数组，因为它不经 shell"，
 *第 8 轮（上下文被压缩后）又说"我用 execSync 试试" → 用户看到原地打转。
 *
 * 修法: 把决策抽出来存进台账，每轮注入，AI 看见"已定决策"就不会重议。
 */

import { describe, it, expect } from 'vitest';
import { extractDecisions } from './decision-extractor.js';
import { TaskLedger } from './task-ledger.js';

describe('决策抽取', () => {
  it('抽出显式决策句', () => {
    const text = '我决定用 execFile 参数数组执行 git，因为它不经 shell，更安全。';
    const d = extractDecisions(text);
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]).toContain('execFile');
  });

  it('「采用/选择/改用」等标记都能识别', () => {
    for (const kw of ['采用', '选用', '改用', '换成', '确定为', '结论是']) {
      const d = extractDecisions(`因为性能问题${kw}更轻量的实现方式，所以这样改。`);
      expect(d.length, `「${kw}」应被识别为决策`).toBeGreaterThan(0);
    }
  });

  it('寒暄/过程叙述不算决策', () => {
    expect(extractDecisions('让我先读一下这个文件。')).toEqual([]);
    expect(extractDecisions('正在分析问题原因...')).toEqual([]);
    expect(extractDecisions('抱歉，我刚才出错了。')).toEqual([]);
  });

  it('代码块内容不参与抽取', () => {
    const text = '决定用新方案。\n```ts\n// 这里决定了变量名\nconst x = 1;\n// 决定采用 B方案\n```';
    const d = extractDecisions(text);
    expect(d.length).toBe(1);
    expect(d[0]).toContain('新方案');
    expect(d.join()).not.toContain('变量名');
  });

  it('无决策内容时返回空数组', () => {
    expect(extractDecisions('')).toEqual([]);
    expect(extractDecisions(null)).toEqual([]);
    expect(extractDecisions(undefined)).toEqual([]);
    expect(extractDecisions(123)).toEqual([]);
  });

  it('太短的句子忽略（无信息量）', () => {
    expect(extractDecisions('好。')).toEqual([]);
    expect(extractDecisions('决定')).toEqual([]);
  });

  it('每轮最多 5 条', () => {
    const many = Array.from({ length: 20 }, (_, i) => `决定采用第 ${i} 个方案来处理这个问题。`).join(' ');
    expect(extractDecisions(many).length).toBeLessThanOrEqual(5);
  });

  it('长句过滤（>200 字是叙述不是决策）', () => {
    const long = '决定' + 'x'.repeat(300);
    expect(extractDecisions(long)).toEqual([]);
  });
});

describe('决策进台账 → 防止推翻重议', () => {
  it('决策写入后出现在注入文本的「已定决策」段', () => {
    const l = new TaskLedger('d1');
    l.setIteration(3);
    l.recordDecision('采用 execFile 参数数组，因为它不经 shell');
    const out = l.render();
    expect(out).toContain('已定决策');
    expect(out).toContain('execFile');
    expect(out).toContain('不要重新讨论');
  });

  it('压缩后决策仍在（不依赖 appendOnlyLog）', () => {
    const l = new TaskLedger('d2');
    l.recordDecision('用 gitExec 而非裸 execSync');
    // appendOnlyLog 不参与，台账自持
    expect(l.listDecisions()).toEqual(['用 gitExec 而非裸 execSync']);
    expect(l.render()).toContain('gitExec');
  });

  it('重复决策不刷屏（最多 15 条，FIFO 淘汰）', () => {
    const l = new TaskLedger('d3');
    for (let i = 0; i < 30; i++) l.recordDecision(`决策 ${i}`);
    expect(l.listDecisions().length).toBeLessThanOrEqual(15);
    // 保留最近的
    expect(l.listDecisions().some((d) => d.includes('29'))).toBe(true);
  });

  it('端到端: 回复中的决策被抽取并入账', () => {
    const l = new TaskLedger('d4');
    const reply = '我先确认一下。决定采用内容指纹而不是 mtime 来检测配置文件变化，因为 Windows 上 mtime 精度不足会导致热重载静默失效。';
    extractDecisions(reply).forEach((d) => l.recordDecision(d));
    expect(l.listDecisions().length).toBeGreaterThan(0);
    expect(l.render()).toContain('mtime');
  });
});