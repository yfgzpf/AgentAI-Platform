/**
 * sanitizeForJson 回归测试 —— 修 "unexpected end of hex escape" 400
 *
 * 事故 (富哥 2026-10-19, 日志原文):
 *   deepseek 突然全部 400:
 *   Failed to parse the request body as JSON:
 *   messages[13].content: unexpected end of hex escape at line 1 column 129999
 *
 * "刚才都好好的, 突然就接不进去了" —— 不是模型挂了, 是我们发的 body 坏了。
 *
 * 机制: emoji 占 2 个 UTF-16 码元 (代理对)。任何 slice() 只要切在中间, 就得到
 *   一个"孤立代理项"。JSON.stringify 会把它转义成 "\ud83d" (没有配对的低位),
 *   语法合法但语义是非法 Unicode → 上游 serde 解析器报 unexpected end of hex escape。
 *   而这条坏消息会随 appendOnlyLog 一直重发 → 重试 3 次全废 → provider 熔断 →
 *   整个会话再也调不动这个模型。
 *
 * 修复: 发送前统一 toWellFormed() (孤立代理项 → U+FFFD)。
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForJson } from '../llm-router.js';

/** 取一个 emoji 的高位代理 (模拟"被 slice 切一半") */
const loneHigh = '\uD83D';        // 🔴 的前半个码元
const loneLow = '\uDE00';         // 😀 的后半个码元
const emoji = '🔴';               // 完整代理对

describe('sanitizeForJson: 孤立代理项修复', () => {
  it('先复现 bug: 切半的 emoji 是非法 Unicode, stringify 后带孤立 \\u 转义', () => {
    const cut = `工具输出${emoji}完成`.slice(0, 5); // 4 个汉字 + emoji 的高位码元 = 切一半
    // 断言这确实是孤立代理项 (否则测试前提不成立)
    expect((cut as any).isWellFormed()).toBe(false);
    // stringify 出来的 JSON 里会出现孤立的 \ud83d
    expect(JSON.stringify(cut)).toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it('清洗后 isWellFormed 为 true, 且不再有孤立转义', () => {
    const cut = `工具输出${emoji}完成`.slice(0, 5);
    const fixed = sanitizeForJson(cut);
    expect((fixed as any).isWellFormed()).toBe(true);
    // 修复后原 emoji 被替换成 U+FFFD, 不会留下半个码元
    expect(JSON.stringify(fixed)).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
  });

  it('完整的 emoji 原样保留 (不能误伤)', () => {
    const s = '✅ 扫描完成 🔴 高危 💭 思考中';
    expect(sanitizeForJson(s)).toBe(s);
    expect((sanitizeForJson(s) as any).isWellFormed()).toBe(true);
  });

  it('高位/低位代理单独存在都会被替换', () => {
    expect(sanitizeForJson(loneHigh)).toBe('\uFFFD');
    expect(sanitizeForJson(loneLow)).toBe('\uFFFD');
    expect(sanitizeForJson(`a${loneHigh}b${loneLow}c`)).toBe('a\uFFFDb\uFFFDc');
  });

  it('深层清洗: 嵌套对象/数组/tool_calls.arguments 都覆盖', () => {
    const payload = {
      model: 'deepseek-flash',
      messages: [
        { role: 'user', content: `看这个${emoji}`.slice(0, 4) }, // 3 汉字 + 高位码元
        { role: 'tool', content: [{ type: 'text', text: `结果${loneHigh}` }] },
        { role: 'assistant', tool_calls: [{ function: { name: 'x', arguments: `{"p":"${loneLow}"}` } }] },
      ],
      n: 1,
      ok: true,
      nil: null,
    };
    const out = sanitizeForJson(payload);
    const json = JSON.stringify(out);
    // 全量检查: 序列化后的 JSON 里不允许出现"没有低位跟随的高位代理"转义
    expect(json).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f][0-9a-f]{2})/i);
    // 非字符串字段原样
    expect(out.model).toBe('deepseek-flash');
    expect(out.n).toBe(1);
    expect(out.ok).toBe(true);
    expect(out.nil).toBe(null);
  });

  it('非字符串类型原样返回 (不改变语义)', () => {
    expect(sanitizeForJson(42)).toBe(42);
    expect(sanitizeForJson(true)).toBe(true);
    expect(sanitizeForJson(null)).toBe(null);
    expect(sanitizeForJson(undefined)).toBe(undefined);
  });

  it('大文本里的孤立代理项也能被清掉 (接近实机 130KB 场景)', () => {
    const big = 'x'.repeat(60_000) + loneHigh + 'y'.repeat(60_000);
    const fixed = sanitizeForJson(big) as string;
    expect(fixed.length).toBe(big.length);           // 1:1 替换, 长度不变
    expect((fixed as any).isWellFormed()).toBe(true);
    expect(fixed).toContain('x'.repeat(1000));
  });
});
