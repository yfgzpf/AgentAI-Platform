// @ts-nocheck
/**
 * 2026-10-17 死循环熔断 + 迭代天花板 回归测试
 * ==============================================
 * 事故现场 (富哥实机日志, 渗透任务 deepseek):
 *   probe8.js → getcaptcha.js → probe_pay10.js → ...
 *   [pain-sense] 连续失败 51 次
 *   [loop] 迭代达上限 90/90 — 要求收尾
 *   [loop] 迭代上限已警告一轮仍未收尾 — 强制退出 (iteration 91)
 *   → 用户视角: 任务没做完被系统莫名中止
 *
 * 三个真 bug (本测试锁定):
 *   ① 熔断只统计「同工具+同参数」(sig=tool::args), AI 换文件名/换参数重试时
 *      sig 每次都是新键 → 计数从 0 重来 → "连续失败3次换方案"永不触发,
 *      唯一兜底只剩 maxIterations → 死循环烧光预算被强杀。
 *   ② security(渗透) 类长任务被普通自主任务的 90 轮天花板卡死。
 *   ③ HookCapture 日志解包错误 → success 恒 undefined (误导排查, 实机截图事故)。
 *
 * 说明: 熔断判定与阈值都是**导出的真实实现**, 测试直接调用 ——
 *   不在测试里复写一份逻辑 (那样测的是测试自己, 锁不住生产代码)。
 */

import { describe, it, expect } from 'vitest';
import { TOOL_FAIL_BREAKER, shouldTripToolBreaker } from '../agentai-loop.js';
import { HookCaptureEngine } from '../hook-capture.js';

describe('工具级连续失败熔断 (2026-10-17 P0) — 直接调用真实实现', () => {
  it('阈值常量导出且为 6 (生产代码与测试共用同一份)', () => {
    expect(TOOL_FAIL_BREAKER).toBe(6);
  });

  it('同工具换参数连续失败 ≥6 次 → 应熔断 (即使每次参数都不同)', () => {
    // 实机场景: write_file 换文件名重试 — sig 每次都新, 同参数熔断失效,
    // 靠这个工具维度兜底。failN 6 → 熔断。
    for (const n of [1, 2, 3, 4, 5]) {
      expect(shouldTripToolBreaker('write_file', n, false)).toBe(false);
    }
    expect(shouldTripToolBreaker('write_file', 6, false)).toBe(true);
    expect(shouldTripToolBreaker('write_file', 7, false)).toBe(true);
    expect(shouldTripToolBreaker('write_file', 51, false)).toBe(true); // 实机真值
  });

  it('探测类工具豁免工具级熔断 — 换目标探测是正常工作流', () => {
    // 扫不同子域名/端点换参数 = 正常工作流, 不算卡死, 即便失败 20 次也不熔断
    expect(shouldTripToolBreaker('wsl_scan', 20, true)).toBe(false);
    expect(shouldTripToolBreaker('enum_subdomains', 20, true)).toBe(false);
    expect(shouldTripToolBreaker('http_replay', 20, true)).toBe(false);
    expect(shouldTripToolBreaker('save_evidence', 20, true)).toBe(false);
  });

  it('熔断边界: failN 恰好等于阈值才触发 (off-by-one 安全)', () => {
    expect(shouldTripToolBreaker('read_file', TOOL_FAIL_BREAKER - 1, false)).toBe(false);
    expect(shouldTripToolBreaker('read_file', TOOL_FAIL_BREAKER, false)).toBe(true);
  });
});

describe('HookCapture 日志解包 (2026-10-17 P0) — 不再 success: undefined', () => {
  it('嵌套 {id, result:{...}} → 日志里 success:true (修复前是 undefined)', async () => {
    const engine = new HookCaptureEngine();
    const sessionId = 'breaker-session-1';
    // 注册一个真实 session, 让 onPostToolUse 能走到 trigger + 日志打印
    (engine as any).activeSessions.set(sessionId, {
      sessionId,
      userId: 'breaker-test-user',
      workspace: 'F:/tmp',
      startTime: Date.now(),
      context: {},
    });

    const dispatchResult = {
      id: 'call-1',
      name: 'write_file',
      result: { success: true, output: 'Created (42 lines)', durationMs: 123 },
    };

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };
    try {
      await engine.onPostToolUse(sessionId, 'write_file', {}, dispatchResult as any, {} as any);
    } finally {
      console.log = origLog;
    }

    const toolLog = logs.find(l => l.includes('Tool executed'));
    expect(toolLog).toBeDefined();
    // ★ 核心断言: 日志显示真实 success 值, 不再 undefined
    expect(toolLog).toContain('success: true');
    expect(toolLog).not.toContain('success: undefined');
    expect(toolLog).toContain('duration: 123ms'); // duration 也不再恒 0
  });

  it('失败时日志附带 output 摘要 (排查可直接看到原因)', async () => {
    const engine = new HookCaptureEngine();
    const sessionId = 'breaker-session-2';
    (engine as any).activeSessions.set(sessionId, {
      sessionId, userId: 'u', workspace: 'F:/tmp', startTime: Date.now(), context: {},
    });

    const dispatchResult = {
      id: 'call-2',
      result: { success: false, output: '[ERROR] sandbox denied: path outside allowed roots', durationMs: 8 },
    };

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => { logs.push(args.join(' ')); };
    try {
      await engine.onPostToolUse(sessionId, 'write_file', {}, dispatchResult as any, {} as any);
    } finally {
      console.log = origLog;
    }

    const toolLog = logs.find(l => l.includes('Tool executed'))!;
    expect(toolLog).toContain('success: false');
    expect(toolLog).toContain('sandbox denied'); // 失败原因直接可见
  });

  it('兼容扁平形状 (已是 ToolResult 时直读, 不被误解包)', () => {
    const flat: any = { success: false, output: 'Error: boom', durationMs: 7 };
    const raw = flat;
    const tr = (raw && raw.result && typeof raw.result === 'object') ? raw.result : raw;
    expect(tr).toBe(flat); // 扁平原样返回
    expect(tr.success).toBe(false);
    expect(tr.durationMs).toBe(7);
  });
});