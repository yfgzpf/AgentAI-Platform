/**
 * 自主验证修复循环 — 对标 Claude Code 的 test→fix→retest
 * ============================================================
 * 核心流程:
 *   1. AI 改完代码 → preview_edit/apply_edit
 *   2. 自动检测项目类型 → 运行对应的 typecheck/lint
 *   3. 有错误 → 提取错误信息 → 反馈给 AI → AI 自动修复
 *   4. 重新验证 → 直到通过或达到最大次数
 *
 * 支持的验证器:
 *   - TypeScript: tsc --noEmit
 *   - ESLint: eslint --format json
 *   - Python: python -m py_compile
 *   - Go: go build
 *   - 通用: 运行特定测试命令
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface ValidationResult {
  success: boolean;
  tool: string;
  errors: ValidationError[];
  output: string;
  durationMs: number;
}

export interface ValidationError {
  file: string;
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
  code: string;
}

/**
 * 检测项目类型及可用验证器
 */
export function detectProject(workspace: string): {
  type: 'typescript' | 'javascript' | 'python' | 'go' | 'mixed' | 'unknown';
  validators: Array<{ name: string; command: string }>;
} {
  const hasPackageJson = fs.existsSync(path.join(workspace, 'package.json'));
  const hasTsConfig = fs.existsSync(path.join(workspace, 'tsconfig.json'));
  const hasPyProject = fs.existsSync(path.join(workspace, 'pyproject.toml'));
  const hasGoMod = fs.existsSync(path.join(workspace, 'go.mod'));
  const hasSetupPy = fs.existsSync(path.join(workspace, 'setup.py'));

  const validators: Array<{ name: string; command: string }> = [];

  if (hasPackageJson && hasTsConfig) {
    validators.push({ name: 'tsc', command: 'npx tsc --noEmit' });
    validators.push({ name: 'eslint', command: 'npx eslint --format json' });
  }
  if (hasPyProject || hasSetupPy) {
    validators.push({ name: 'python', command: 'python -m py_compile **/*.py 2>&1 | head -20' });
  }
  if (hasGoMod) {
    validators.push({ name: 'go', command: 'go build ./...' });
  }

  if (validators.length >= 2) return { type: 'mixed', validators };
  if (validators.length === 1) {
    return {
      type: validators[0].name === 'tsc' ? 'typescript' :
            validators[0].name === 'python' ? 'python' :
            validators[0].name === 'go' ? 'go' : 'unknown',
      validators,
    };
  }
  return { type: 'unknown', validators };
}

/**
 * 运行单个验证器
 */
export function runValidator(validator: { name: string; command: string }, workspace: string): ValidationResult {
  const start = Date.now();
  const errors: ValidationError[] = [];
  let output = '';
  let success = true;

  try {
    output = execSync(validator.command, {
      cwd: workspace,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, TMPDIR: process.env.TMPDIR || 'D:\\tmp' },
    });
  } catch (e: any) {
    success = false;
    output = e.stdout || e.stderr || e.message;
    errors.push(...parseErrors(output, validator.name));
  }

  return {
    success: errors.length === 0,
    tool: validator.name,
    errors,
    output: output.slice(0, 3000),
    durationMs: Date.now() - start,
  };
}

/**
 * 解析验证器输出为结构化错误
 */
function parseErrors(output: string, validator: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (validator === 'tsc') {
    // TS: src/file.ts(L,C): error TS1234: msg
    const re = /(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)/g;
    let match;
    while ((match = re.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] === 'error' ? 'error' : 'warning',
        code: match[5],
        message: match[6],
      });
    }
  } else if (validator === 'eslint') {
    // ESLint JSON 输出
    try {
      const reports = JSON.parse(output);
      for (const report of Array.isArray(reports) ? reports : [reports]) {
        for (const msg of report.messages || []) {
          errors.push({
            file: msg.filePath || report.filePath,
            line: msg.line || 1,
            column: msg.column || 1,
            severity: msg.severity === 2 ? 'error' : 'warning',
            code: msg.ruleId || '',
            message: msg.message,
          });
        }
      }
    } catch {}
  } else if (validator === 'python') {
    // Python: File "x.py", line N: SyntaxError: msg
    const re = /File "(.+?)", line (\d+).*?(SyntaxError|IndentationError|NameError):\s*(.+)/g;
    let match;
    while ((match = re.exec(output)) !== null) {
      errors.push({
        file: match[1],
        line: parseInt(match[2]),
        column: 0,
        severity: 'error',
        code: match[3],
        message: match[4],
      });
    }
  }

  // 去重
  const seen = new Set<string>();
  return errors.filter(e => {
    const key = `${e.file}:${e.line}:${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 自动修复循环
 * 返回: { fixed: 修复次数, remaining: 剩余错误数, iterations: 迭代次数 }
 */
export async function autoFixLoop(
  workspace: string,
  onValidate: () => Promise<{ errors: ValidationError[] }>,
  onFix: (errors: ValidationError[]) => Promise<{ fixed: number; errors: ValidationError[] }>,
  maxIterations = 3,
): Promise<{ fixed: number; remaining: number; iterations: number }> {
  let totalFixed = 0;
  let iteration = 0;

  for (iteration = 0; iteration < maxIterations; iteration++) {
    const { errors } = await onValidate();
    if (errors.length === 0) break;

    const result = await onFix(errors);
    totalFixed += result.fixed;

    if (result.errors.length === 0) break;
    if (result.fixed === 0) break; // 修不动了
  }

  const { errors: remaining } = await onValidate();
  return { fixed: totalFixed, remaining: remaining.length, iterations: iteration + 1 };
}
