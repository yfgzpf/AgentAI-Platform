/**
 * 回归守卫: @ts-nocheck 文件里的"未定义引用"
 *
 * 背景 (2026-10-19 事故链):
 *   llm-router.ts 里 `logger.warn(...)` 从未 import, 但因为文件头是 `// @ts-nocheck`,
 *   tsc 完全跳过它 → 每次 provider 成功返回后算 token 用量时抛
 *   `logger is not defined`, 整条响应被 tryOne 当失败丢弃 → 重试 3 次全废 → 拉黑
 *   → fallback 撞 429。用户看到的现象是"AI 说一句话就断了 / 几轮就中止"。
 *   同类还有 `noteFail`(类方法引用 chat 闭包)、`ws()`(重命名残留)、
 *   `command`/`checkName`/`xuanjiCaseId`/`startTime`(try 内声明、catch 里用)、
 *   `desktop_automate`(自引用 handler)、`execSync`(try 内解构、块外使用)。
 *
 * 这类 bug 的共同点: **tsc 看不见, 运行期才炸, 而且炸点往往在 catch 里,
 * 会把真实错误二次掩盖**。所以必须有一条独立于 tsc 的检查。
 *
 * 做法: 调用 scripts/check-undefined-refs.mjs, 它会自动发现 src 下所有
 * @ts-nocheck 生产文件, 生成"去掉 nocheck"的临时副本用 TS API 编译,
 * 只收集 TS2304/TS2552 (找不到名字), 有命中即 exit 1。
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('@ts-nocheck 未定义引用守卫', () => {
  it('所有 @ts-nocheck 生产文件不得引用未定义标识符', () => {
    const script = path.join(pkgRoot, 'scripts', 'check-undefined-refs.mjs');
    const r = spawnSync(process.execPath, [script], {
      cwd: pkgRoot,
      encoding: 'utf8',
      timeout: 240_000,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    // 失败时把完整清单打进断言消息, 直接能看到 文件:行:列 + 缺的名字
    expect(r.status, `发现未定义引用 (这类错误 tsc 看不见, 运行期才炸):\n${out}`).toBe(0);
    expect(out).toContain('DONE: 0 处');
  }, 300_000);
});
