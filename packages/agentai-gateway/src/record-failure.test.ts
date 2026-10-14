/**
 * 失败教训持久化 (record_failure 工具 + dup_fail 自动写) — 回归测试 (2026-10-14 P1)
 * ==============================================================================
 * RSIAgent "验证即学习" 闭环的最后一段: 失败教训必须**持久化**才能跨会话复用。
 * 我们有两个写入口:
 *   ① 自动: agentai-loop.ts:4544 检测到"同 sig 连续失败 3 次" → writeEvolution
 *   ② 主动: record_failure 工具 (AI 显式记教训, verifier 判 FAIL 后常用)
 *
 * 本文件三层:
 *   契约层: 工具声明 + 实现 + 主循环自动写, 三处都防有人删回去。
 *   行为层: 打桩 writeEvolution, 调 record_failure handler → 断言 evolution 收到
 *           正确的 entry (type=failure / execution_error / content 含 toolName/reason/hint)。
 *   边界层: 缺参数 → success:false; 缺 hint/errorType → 仍写 (默认 UnknownError)。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { EXTRA_HANDLERS } from './tools.js';

const src = (rel: string) =>
  readFileSync(new URL(`./${rel}`, import.meta.url), 'utf-8');

const toolsSrc = src('tools.ts');
const loopSrc = src('agentai-loop.ts');

// ===== 打桩 writeEvolution: 捕获 evolution 实际收到的 entry =====
const h = vi.hoisted(() => ({ captured: [] as any[] }));
vi.mock('./evolution.js', () => ({
  writeEvolution: (entry: any) => { h.captured.push(entry); },
  writeEvolutionAsync: async (entry: any) => { h.captured.push(entry); },
}));

const ctx = {
  userId: 'user1',
  workspace: '/tmp/ws',
  abortSignal: new AbortController().signal,
} as any;

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: record_failure 工具声明 + 实现 + 主循环自动写', () => {
  it('tools.ts 有 record_failure 声明 (含 4 参数 + execution_error 失因)', () => {
    expect(toolsSrc).toMatch(/name:\s*'record_failure'/);
    expect(toolsSrc).toMatch(/execution_error/);
    expect(toolsSrc).toMatch(/toolName/);
  });

  it('tools.ts 有 record_failure handler 实现', () => {
    expect(toolsSrc).toMatch(/record_failure:\s*async/);
  });

  it('主循环 dup_fail (连续失败 3 次) 分支里调 writeEvolution 自动写教训', () => {
    // 防有人把主循环的自动写删回去 — 分两段断言避免长源码 + 非贪婪正则性能问题
    expect(loopSrc).toMatch(/count >= 3/);
    expect(loopSrc).toMatch(/writeEvolution\(\s*\{[\s\S]*?failureCategory:\s*['"]execution_error['"]/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — record_failure handler 行为
// ════════════════════════════════════════════════════════════════════════
describe('行为: record_failure 写入 evolution', () => {
  it('✅ 正常调用 → 写入 type=failure, content 含 toolName + reason', async () => {
    h.captured.length = 0;
    const out = await EXTRA_HANDLERS['record_failure']({
      toolName: 'ffmpeg',
      reason: '本机未安装',
      errorType: 'NotFound',
      hint: '走 API 尾帧, 别依赖 ffmpeg',
    }, ctx);
    expect(out.success).toBe(true);
    expect(out.output).toContain('已记 ffmpeg 失败教训');
    expect(h.captured).toHaveLength(1);
    const e = h.captured[0];
    expect(e.type).toBe('failure');
    expect(e.failureCategory).toBe('execution_error');
    expect(e.errorType).toBe('NotFound');
    expect(e.content).toContain('ffmpeg');
    expect(e.content).toContain('本机未安装');
    expect(e.content).toContain('走 API 尾帧');
    expect(e.metadata?.source).toBe('record_failure');
  });

  it('缺 hint/errorType → 仍写入, errorType 默认 UnknownError', async () => {
    h.captured.length = 0;
    const out = await EXTRA_HANDLERS['record_failure']({
      toolName: 'run_command',
      reason: '命令不存在',
    }, ctx);
    expect(out.success).toBe(true);
    expect(h.captured[0].errorType).toBe('UnknownError');
    expect(h.captured[0].content).toContain('run_command');
    expect(h.captured[0].content).toContain('命令不存在');
  });

  it('缺 toolName → success:false, 不写 evolution', async () => {
    h.captured.length = 0;
    const out = await EXTRA_HANDLERS['record_failure']({
      reason: '缺 toolName 不该写',
    }, ctx);
    expect(out.success).toBe(false);
    expect(out.output).toMatch(/缺参数/);
    expect(h.captured).toHaveLength(0);
  });

  it('缺 reason → success:false, 不写 evolution', async () => {
    h.captured.length = 0;
    const out = await EXTRA_HANDLERS['record_failure']({
      toolName: 'x',
    }, ctx);
    expect(out.success).toBe(false);
    expect(h.captured).toHaveLength(0);
  });
});
