/**
 * auto-lint-selftrigger.test.ts — 2026-10-21 自噬 bug 修复验证
 *
 * 背景 (富哥截图实锤): GUI 里 write_file 写完 as6.sh 后, 系统追着 AI
 * "请立即检查是否有编译/lint 错误", 自主修复闭环还判了 ts_error —
 * 根因是 buildLintCheckDirective 的提示语被自家 /编译.*错误/ 正则当成真错误。
 * 提示即错误, 每写一个文件必触发, 长任务被周期性带偏。
 *
 * 修复两层:
 *   L1 tools.ts       — lint 指令只对 .tsx?/.jsx?/.mjs/.cjs 发射
 *   L2 agentai-loop.ts — 错误模式匹配前剥掉 [SYSTEM] 指令行 (系统注入不当错误证据)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_SRC = readFileSync(path.join(__dirname, 'tools.ts'), 'utf-8');
const LOOP_SRC = readFileSync(path.join(__dirname, 'agentai-loop.ts'), 'utf-8');

/** 与 agentai-loop.ts 自主修复闭环第 9 分支同款判据 (改源码必须同步改这里) */
const TS_ERROR_RE = /error TS\d{4}|compilation error|typecheck failed|类型.*错误|编译.*错误/i;
/** 与 L2 修复同款剥离开关 */
const stripSystemLines = (s: string) => s.split('\n').filter((l: string) => !/^\s*\[SYSTEM/.test(l)).join('\n');

describe('auto-lint 自噬修复 (2026-10-21)', () => {
  it('① L1 源码契约: buildLintCheckDirective 被扩展名门控包住', () => {
    const gated = TOOLS_SRC.match(
      /if \(\/\\\.\(tsx\?\|jsx\?\|mjs\|cjs\)\$\/i\.test\(resolved\)\)\s*\{\s*const lintDirective = buildLintCheckDirective/
    );
    expect(gated, 'lint 指令必须只在 /.(tsx?|jsx?|mjs|cjs)$/i 门控内发射').not.toBeNull();
  });

  it('② L1 源码契约: auto_verify 仍只认 ts/js (真检查边界不变)', () => {
    expect(TOOLS_SRC).toContain('if (!/\\.(tsx?|jsx?)$/i.test(filePath)) return null;');
  });

  it('③ L2 源码契约: [SYSTEM] 剥离子出现在 ts_error 修复分支之前', () => {
    const stripIdx = LOOP_SRC.indexOf("filter((l: string) => !/^\\s*\\[SYSTEM/.test(l))");
    const tsIdx = LOOP_SRC.indexOf("directives.add('auto_fix_ts'");
    expect(stripIdx, '剥离子必须存在').toBeGreaterThan(0);
    expect(tsIdx, 'ts_error 修复分支必须存在').toBeGreaterThan(0);
    expect(stripIdx, '剥离子必须先于错误模式匹配').toBeLessThan(tsIdx);
  });

  it('④ 行为: 含 [SYSTEM] lint 指令的产出, 剥前误判/剥后不判', () => {
    const out = 'Created (37 lines)\n[SYSTEM] 刚修改了 as6.sh。请立即检查是否有编译/lint 错误。如果有, 立即修复, 不要留到最后。';
    expect(TS_ERROR_RE.test(out), '剥前命中 = 自噬实锤 (回归保护)').toBe(true);
    expect(TS_ERROR_RE.test(stripSystemLines(out)), '剥后不得误判').toBe(false);
  });

  it('⑤ 行为: 真编译错误 (auto_verify 的 ⚠️ 行) 剥后照样命中', () => {
    const out = "Written (+2 lines, total 100)\n⚠️ 编译错误 (请立即修复):\nsrc/foo.ts(12,3): error TS2304: Cannot find name 'bar'.";
    expect(TS_ERROR_RE.test(stripSystemLines(out)), '真错必须照样触发').toBe(true);
  });

  it('⑥ 行为: 普通成功产出剥后不判; [SYSTEM] 之外的行不误伤', () => {
    const out = 'Created (37 lines)\n[SYSTEM] 刚修改了 a.ts。请立即检查是否有编译/lint 错误。\nDone';
    const scan = stripSystemLines(out);
    expect(scan).toBe('Created (37 lines)\nDone');
    expect(TS_ERROR_RE.test(scan)).toBe(false);
  });
});
