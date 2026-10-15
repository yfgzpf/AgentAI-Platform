/**
 * deepseek-reasoning.test.ts — DeepSeek V4.1-Flash thinking 模式 400 回归
 * ----------------------------------------------------------------
 * 2026-10-16: 长任务 (多轮工具调用) 必 400 的根因 ——
 *   DeepSeek 官方规矩: 带 tool_calls 的 assistant 消息必须原样回传 reasoning_content。
 *   但主循环存 assistant 消息时只存了 content + tool_calls, 漏存了 reasoning_content
 *   (res.reasoningContent 由 router 取回但没写进 appendOnlyLog) → 下一轮该字段缺失 → 400。
 *   修复: agentai-loop.ts 存消息时带上 reasoning_content; llm-router.ts:1797 的保留段
 *   原样带出, 发给 DeepSeek。
 *
 * 本文件锁这条不变量 (防"有人把修复删回去"), 走源码契约层:
 *   ① agentai-loop.ts 存 assistant 消息时写 reasoning_content
 *   ② llm-router.ts 请求体保留 reasoning_content (工具轮必需)
 *   ③ sanitizeToolMessages 摘 tool_calls 时不丢 reasoning_content (rest 展开)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8');

describe('DeepSeek thinking 模式 reasoning_content 回传 (2026-10-16)', () => {
  it('agentai-loop.ts 存 assistant 消息时写入 reasoning_content', () => {
    const loop = src('agentai-loop.ts');
    // 修复点: assistantMsg.reasoning_content = res.reasoningContent
    expect(loop).toMatch(/assistantMsg\.reasoning_content\s*=\s*\(res as any\)\.reasoningContent/);
  });

  it('llm-router.ts 请求体保留 reasoning_content (有工具轮必需)', () => {
    const router = src('llm-router.ts');
    // 保留段: 消息带 reasoning_content 时原样带入 body
    expect(router).toMatch(/msg\.reasoning_content\s*=\s*\(m as any\)\.reasoning_content/);
  });

  it('sanitizeToolMessages 摘 tool_calls 时用 ...rest 保留其他字段 (含 reasoning_content)', () => {
    const mu = src('message-utils.ts');
    // 关键: 摘除 tool_calls 走解构 rest (保留 reasoning_content 等字段), 而非重造消息对象
    expect(mu).toMatch(/const \{ tool_calls: _dropped, \.\.\.rest \} = m;/);
    expect(mu).toMatch(/result\.push\(rest as ChatMessage\)/);
  });
});
