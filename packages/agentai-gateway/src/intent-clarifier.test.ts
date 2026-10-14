/**
 * IntentClarifier 回归测试 (2026-10-15)
 * ============================================================================
 * 背景: 用户反馈"意图澄清太宽泛 — 只要出现 他/你/这/那 就追问, 很不智能"。
 * 根因: unclearReferences 旧正则 `(?:这个|那个|它|这|那)(?:文件|...)?` 无词边界,
 *       单字"这/那"命中"这次/这个月/这样"(时间词/程度副词) → 全判 high → 一命中就弹窗。
 * 修: 指代词必须**紧跟具体名词**(文件/代码/页面/功能/地方/东西)才匹配;
 *     模糊动词 + 未决选择 降 severity (不再触发 needsClarification 的 high 门槛)。
 * 本测试锁死: 误报不再追问 / 真指代仍追问 / 降级类型不阻断任务。
 */
import { describe, it, expect } from 'vitest';
import { getIntentClarifier, Ambiguity } from './meta/intent-clarifier.js';

const clarifier = getIntentClarifier();

describe('IntentClarifier — 指代词误报收紧 (2026-10-15)', () => {
  // ── 误报案例: 这些不该触发追问 (severity high 的歧义 = 0) ──
  it('时间词"这个月/这次"不判指代歧义', () => {
    const cases = [
      '帮我统计这个月的营收',
      '这次的任务完成了吗',
      '这样改性能效更好',
      '那些文件都归档了',
    ];
    for (const input of cases) {
      const ambiguous = clarifier.detectAmbiguities(input, {} as any).filter(a => a.type === 'unclear_reference');
      expect(ambiguous, `"${input}" 不应命中指代歧义`).toHaveLength(0);
    }
  });

  it('模糊动词"帮我搞一下/处理一下"不再判 high (降级为 low)', () => {
    const r = clarifier.detectAmbiguities('帮我搞一下这个项目', {} as any);
    const vague = r.filter(a => a.type === 'vague_verb');
    // 两条正则可能都命中 → ≥1 条, 但每条 severity 必须 low (不触发 needsClarification)
    expect(vague.length).toBeGreaterThanOrEqual(1);
    for (const a of vague) expect(a.severity).toBe('low');
  });

  it('"帮我搞一下" 整句不触发 needsClarification (low 不达到 high 门槛)', () => {
    expect(clarifier.needsClarification('帮我搞一下项目部署', {} as any)).toBe(false);
  });

  it('未决选择"用 X 还是 Y"降为 medium (不阻断任务, AI 直接给建议)', () => {
    const r = clarifier.detectAmbiguities('这里用 Redis 还是 Memcached?', {} as any);
    const choice = r.filter(a => a.type === 'unresolved_choice');
    expect(choice).toHaveLength(1);
    expect(choice[0].severity).toBe('medium');
    // medium 不达 high 门槛 → 不弹追问
    expect(clarifier.needsClarification('这里用 Redis 还是 Memcached?', {} as any)).toBe(false);
  });

  // ── 真指代案例: 这些仍该追问 ──
  it('真指代"这个文件/那个功能/该代码"仍判 high (触发追问)', () => {
    const cases = ['帮我改这个文件的第 3 行', '那个功能怎么实现的', '修一下该代码的 bug'];
    for (const input of cases) {
      const r = clarifier.detectAmbiguities(input, {} as any);
      expect(r.some(a => a.type === 'unclear_reference' && a.severity === 'high'), `"${input}" 应判 high 指代`).toBe(true);
      expect(clarifier.needsClarification(input, {} as any)).toBe(true);
    }
  });

  it('有 openFiles 上下文时, "当前打开的文件"可消解 (不算歧义)', () => {
    // "当前打开的文件" + openFiles=1 → tryResolveReference 返回 true → 不判 high
    const r = clarifier.detectAmbiguities('改下当前打开的文件', { openFiles: ['App.tsx'] } as any);
    expect(r.filter(a => a.type === 'unclear_reference' && a.severity === 'high')).toHaveLength(0);
  });

  it('有 lastMentionedFile 时, "它"可消解 (不算歧义)', () => {
    const r = clarifier.detectAmbiguities('把它的端口改成 8080', { lastMentionedFile: 'server.js' } as any);
    // 收紧后"它"单字不再命中 unclearReferences (它/它们 属泛指), 故 0 条
    expect(r.filter(a => a.type === 'unclear_reference')).toHaveLength(0);
  });

  it('普通明确任务 (无任何歧义词) 不触发任何高优先级追问', () => {
    const cases = ['重构登录模块', '写一个快排', '把日志级别调到 info', '新增一个用户列表页'];
    for (const input of cases) {
      expect(clarifier.needsClarification(input, {} as any), `"${input}" 不该触发高优先级追问`).toBe(false);
    }
  });
});
