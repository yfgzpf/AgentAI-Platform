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
  it('rejects fs import', () => {
    const r = scanForbiddenPatterns(`import fs from 'fs'`);
    expect(r.ok).toBe(false);
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
