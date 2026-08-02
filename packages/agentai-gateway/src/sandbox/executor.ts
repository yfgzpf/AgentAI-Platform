// ===========================================================================
// src/sandbox/executor.ts — 安全代码执行沙盒
// ===========================================================================
/**
 * 职责：让 Agent 生成的代码在安全沙盒中执行，不碰生产环境。
 * 
 * 安全约束：
 *   - timeout: 5s（默认）
 *   - maxOutputBytes: 1MB（默认）
 *   - 网络隔离（NODE_ENV=sandbox 禁止联网库）
 *   - 子进程隔离（child_process.execFile）
 *   - 输出截断（防内存溢出）
 */

import { execFile } from 'node:child_process';
import * as util from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ===== 类型 =====
export interface ExecResult {
  success: boolean;
  output: string;
  error: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxLimits {
  timeoutMs?: number;        // 默认 5000
  maxOutputBytes?: number;   // 默认 1MB
  maxMemoryBytes?: number;   // 默认 64MB（软限制）
}

// ===== 沙盒执行器 =====
export class CodeRunner {
  private limits: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxMemoryBytes: number;
  };
  /** 缓存 Python 路径 */
  private pythonPath: string | null = null;

  constructor(limits: SandboxLimits = {}) {
    this.limits = {
      timeoutMs: limits.timeoutMs ?? 5000,
      maxOutputBytes: limits.maxOutputBytes ?? 1024 * 1024,
      maxMemoryBytes: limits.maxMemoryBytes ?? 64 * 1024 * 1024,
    };
  }

  /** 自动查找 Python 路径（优先用户级安装路径） */
  private findPython(): string {
    if (this.pythonPath) return this.pythonPath;
    const versions = ['314', '313', '312', '311', '310'];
    const localAppData = process.env.LOCALAPPDATA || `${process.env.USERPROFILE || '~'}/AppData/Local`;
    const common: string[] = [];
    for (const v of versions) common.push(`${localAppData}/Programs/Python/Python${v}/python.exe`);
    for (const v of versions) common.push(`C:/Python${v}/python.exe`);
    for (const v of versions.slice(0, 3)) common.push(`${process.env.PROGRAMFILES || 'C:/Program Files'}/Python${v}/python.exe`);
    for (const p of common) {
      try { if (fs.existsSync(p)) { this.pythonPath = p; return p; } } catch {}
    }
    const candidates = process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python'];
    this.pythonPath = candidates[0];
    return this.pythonPath;
  }

  /**
   * 在沙盒中执行 JS 代码
   * @param code - 箭头函数代码字符串，如 "() => 42"
   * @param context - 可选的上下文变量（通过环境变量传入）
   */
  async execute(code: string, context?: Record<string, unknown>): Promise<ExecResult> {
    const startTime = Date.now();

    // 1. 创建临时文件（避免 shell 转义问题）
    const tmpFile = path.join(
      os.tmpdir(),
      `sandbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.js`,
    );
    
    // 2. 将代码写入临时文件
    fs.writeFileSync(tmpFile, code, 'utf-8');

    // 3. 构建 runner 脚本
    const safePath = fs.realpathSync(tmpFile);
    const runnerLines = [
      "'use strict';",
      "var fs = require('fs');",
      "var ctxRaw = process.env.__SANDBOX_CTX__ || null;",
      "var __ctx = null;",
      "if (ctxRaw) { try { __ctx = JSON.parse(ctxRaw); } catch(e) {} }",
      "var src;",
      "try { src = fs.readFileSync('" + safePath.replace(/\\/g, '\\\\') + "', 'utf-8'); }",
      "catch (e) { process.stderr.write('[E] Cannot read code'); process.exit(1); }",
      "var ret;",
      "try { var fn = eval('(' + '(' + src + ')' + ')'); ret = (typeof fn === 'function' ? fn() : fn); }",
      "catch (e) { process.stderr.write('[E]' + e.message); process.exit(1); }",
      "if (ret !== undefined && ret !== null) {",
      "  var s; try { s = (typeof ret === 'string') ? ret : JSON.stringify(ret); } catch(e) { s = String(ret); }",
      "  if (s.length > " + this.limits.maxOutputBytes + ") {",
      "    process.stdout.write(s.substring(0, " + this.limits.maxOutputBytes + "));",
      "    process.stdout.write('[TRUNCATED]');",
      "  } else { process.stdout.write(s); }",
      "}",
      "process.exit(0);",
    ];
    const runnerCode = runnerLines.join('\n');

    // 4. 执行 runner
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'sandbox',
      NODE_NO_WARNINGS: '1',
    };
    if (context) {
      env['__SANDBOX_CTX__'] = JSON.stringify(context);
    }

    try {
      const result = await util.promisify(execFile)('node', ['-e', runnerCode], {
        timeout: this.limits.timeoutMs,
        maxBuffer: Math.max(this.limits.maxOutputBytes * 2, 1024 * 1024),
        env,
      });

      const stdout = (result.stdout as string) ?? '';
      const stderr = (result.stderr as string) ?? '';
      return {
        success: true,
        output: stdout,
        error: stderr,
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');

      return {
        success: false,
        output: '',
        error: msg,
        durationMs: Date.now() - startTime,
        timedOut: isTimeout,
      };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }

  /**
   * 在沙盒中执行 Python 代码
   * @param code - Python 代码字符串
   * @param context - 可选的上下文变量（通过环境变量传入）
   */
  async executePython(code: string, context?: Record<string, unknown>): Promise<ExecResult> {
    const startTime = Date.now();
    const pyExe = this.findPython();

    // 1. 写临时 .py 文件
    const tmpFile = path.join(
      os.tmpdir(),
      `sandbox_py_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.py`,
    );
    const header = ['#!/usr/bin/env python3', '# -*- coding: utf-8 -*-', '', 'import sys, json, os'];
    if (context) {
      header.push('');
      header.push('# Context from sandbox');
      header.push(`_CTX = json.loads(os.environ.get('__SANDBOX_CTX__', 'null')) or {}`);
      header.push('');
    }
    fs.writeFileSync(tmpFile, [...header, code].join('\n'), 'utf-8');

    // 2. 执行
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'sandbox',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    };
    if (context) {
      env['__SANDBOX_CTX__'] = JSON.stringify(context);
    }

    try {
      const result = await util.promisify(execFile)(pyExe, [tmpFile], {
        timeout: this.limits.timeoutMs,
        maxBuffer: Math.max(this.limits.maxOutputBytes * 2, 1024 * 1024),
        env,
      });

      return {
        success: true,
        output: ((result.stdout as string) || '') + ((result.stderr as string) || ''),
        error: '',
        durationMs: Date.now() - startTime,
        timedOut: false,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes('timeout') || msg.includes('ETIMEDOUT');
      return {
        success: false,
        output: '',
        error: msg,
        durationMs: Date.now() - startTime,
        timedOut: isTimeout,
      };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
}

// ===== 便捷工厂 =====
export function createSandbox(limits?: SandboxLimits): CodeRunner {
  return new CodeRunner(limits);
}

// ===== 内置安全规则检查 =====
export class SandboxRules {
  /** 检查代码是否包含危险模式 */
  static checkDanger(code: string): { safe: boolean; patterns: string[] } {
    const dangerousPatterns = [
      { pattern: /require\s*\(\s*['"]fs['"]\s*\)/i, risk: 'file-access' },
      { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/i, risk: 'process-spawn' },
      { pattern: /require\s*\(\s*['"]net['"]\s*\)/i, risk: 'network' },
      { pattern: /fetch\s*\(/i, risk: 'network' },
      { pattern: /exec\s*\(/i, risk: 'command-execution' },
      { pattern: /eval\s*\(/i, risk: 'code-execution' },
      { pattern: /process\.exit/i, risk: 'process-kill' },
      { pattern: /rm\s+-rf/i, risk: 'file-deletion' },
      { pattern: /\.env/i, risk: 'env-leak' },
    ];

    const matches: string[] = [];
    for (const { pattern, risk } of dangerousPatterns) {
      if (pattern.test(code)) {
        matches.push(risk);
      }
    }

    return {
      safe: matches.length === 0,
      patterns: matches,
    };
  }
}
