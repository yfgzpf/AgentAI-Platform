/**
 * code-runner 单元测试
 * ----------------------------------------------------
 * 验证: 静态扫描危险模式、语法检查、沙箱执行
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanForbiddenPatterns, syntaxCheck, runSandboxedSkill } from './code-runner.js';

let tmpDir: string;
let scriptPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-runner-test-'));
  scriptPath = path.join(tmpDir, 'test.js');
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('scanForbiddenPatterns', () => {
  it('accepts clean code', () => {
    expect(scanForbiddenPatterns('const x = 1 + 2;')).toEqual({ ok: true });
  });
  it('rejects child_process require', () => {
    const r = scanForbiddenPatterns(`require('child_process')`);
    expect(r.ok).toBe(false);
  });
  it('rejects eval', () => {
    const r = scanForbiddenPatterns(`eval("rm -rf /")`);
    expect(r.ok).toBe(false);
  });
  // 2026-10-12 修正: 原 `it('rejects fs import')` 断言的是**旧的严格策略**(拦掉所有 fs)。
  //   该策略已被 D7 有意放宽(见 code-runner.ts:18 注释「fs 只拦截写操作, 允许只读」),
  //   目的是解决"AI 生成的技能频繁被拒"。所以失败的**不是实现, 是这条过时断言** ——
  //   下面把 D7 的真实契约写成可执行断言: 只读放行, 写操作(含解构导入的绕过写法)一律拦。
  it('allows read-only fs import (D7 有意放宽)', () => {
    expect(scanForbiddenPatterns(`import fs from 'fs'`).ok).toBe(true);
    expect(scanForbiddenPatterns(`import { readFileSync, existsSync } from 'fs'`).ok).toBe(true);
  });
  it('rejects fs write via default/namespace import', () => {
    expect(scanForbiddenPatterns(`import fs from 'fs';\nfs.writeFileSync('a','b');`).ok).toBe(false);
  });
  it('rejects fs write via destructured import (2026-10-12 补的绕过口子)', () => {
    // 修复前: `writeFileSync(...)` 不带 `fs.` 前缀, 任何 FORBIDDEN_PATTERNS 都匹配不到 → 放行执行
    expect(scanForbiddenPatterns(`import { writeFileSync } from 'fs';\nwriteFileSync('a','b');`).ok).toBe(false);
    expect(scanForbiddenPatterns(`const { mkdirSync } = require('fs');\nmkdirSync('x');`).ok).toBe(false);
    expect(scanForbiddenPatterns(`import { rmSync } from 'fs';\nrmSync('x');`).ok).toBe(false);
  });
  it('rejects fs.promises write via require', () => {
    expect(scanForbiddenPatterns(`require('fs').promises.writeFile('a','b');`).ok).toBe(false);
  });
  it('rejects process.kill', () => {
    const r = scanForbiddenPatterns(`process.kill(123)`);
    expect(r.ok).toBe(false);
  });
});

describe('syntaxCheck', () => {
  it('passes valid syntax', () => {
    fs.writeFileSync(scriptPath, 'const x = 1;');
    const r = syntaxCheck(scriptPath);
    expect(r.ok).toBe(true);
  });
  it('fails invalid syntax', () => {
    fs.writeFileSync(scriptPath, 'const x = ;');
    const r = syntaxCheck(scriptPath);
    expect(r.ok).toBe(false);
  });
});

describe('runSandboxedSkill', () => {
  it('executes clean code', () => {
    fs.writeFileSync(scriptPath, 'console.log(JSON.stringify({ result: "ok" }));');
    const r = runSandboxedSkill(scriptPath);
    expect(r.ok).toBe(true);
  });
  it('blocks child_process', () => {
    fs.writeFileSync(scriptPath, `const cp = require('child_process'); console.log(cp.execSync('whoami').toString());`);
    const r = runSandboxedSkill(scriptPath);
    expect(r.ok).toBe(false);
  });
  it('blocks eval', () => {
    fs.writeFileSync(scriptPath, `eval("rm -rf /");`);
    const r = runSandboxedSkill(scriptPath);
    expect(r.ok).toBe(false);
  });
  it('returns error for missing file', () => {
    const r = runSandboxedSkill('/nonexistent/path.js');
    expect(r.ok).toBe(false);
  });
});
