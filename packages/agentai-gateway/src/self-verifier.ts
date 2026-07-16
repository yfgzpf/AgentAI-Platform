/**
 * self-verifier: 治中求验 — AI 输出后自动验证
 * ----------------------------------------------------
 * 灵感来源:
 *  - OfficeCLI (实时截图自检)
 *  - Fugu (Verifier 角色)
 *
 * 核心: AI 写完一段输出后, 自动验证它, 把结果反馈给 AI
 *
 * 当前支持的验证:
 *  - 代码: tsc --noEmit / 语法检查
 *  - 文件: 是否存在 / 大小
 *  - JSON: parse 校验
 *  - Office 文档: 占位符 / 元素统计
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { isPathAllowed } from './safety/path-guard.js';
import { officeSelfCheck } from './office-self-check.js';

export interface VerificationResult {
  /** 验证类型 */
  type: 'code' | 'file' | 'json' | 'office';
  /** 是否通过 */
  ok: boolean;
  /** 错误信息 */
  errors?: string[];
  /** 警告 */
  warnings?: string[];
  /** 建议 */
  hints?: string[];
}

/** 验证 TypeScript/JavaScript 代码 */
export function verifyCode(filePath: string): VerificationResult {
  if (!isPathAllowed(filePath)) {
    return { type: 'code', ok: false, errors: ['Path not allowed'] };
  }
  if (!fs.existsSync(filePath)) {
    return { type: 'code', ok: false, errors: ['File not found'] };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.ts' && ext !== '.tsx' && ext !== '.js' && ext !== '.jsx') {
    return { type: 'code', ok: false, errors: [`Unsupported extension: ${ext}`] };
  }
  try {
    // 语法检查
    const checker = ext === '.ts' || ext === '.tsx' ? 'tsc' : 'node';
    const checkCmd = checker === 'tsc'
      ? `node node_modules/typescript/bin/tsc --noEmit "${filePath}" 2>&1 || true`
      : `node --check "${filePath}"`;
    const output = execSync(checkCmd, { encoding: 'utf-8', timeout: 30000 });
    if (output && /error|Error/.test(output)) {
      return {
        type: 'code',
        ok: false,
        errors: output.split('\n').filter(l => /error|Error/.test(l)).slice(0, 5),
      };
    }
    return { type: 'code', ok: true };
  } catch (e: any) {
    return { type: 'code', ok: false, errors: [e.message?.slice(0, 200)] };
  }
}

/** 验证文件存在/大小 */
export function verifyFile(filePath: string, expectedSize?: { min?: number; max?: number }): VerificationResult {
  if (!isPathAllowed(filePath)) {
    return { type: 'file', ok: false, errors: ['Path not allowed'] };
  }
  if (!fs.existsSync(filePath)) {
    return { type: 'file', ok: false, errors: ['File not found'] };
  }
  const stat = fs.statSync(filePath);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (expectedSize?.min && stat.size < expectedSize.min) {
    errors.push(`File too small: ${stat.size} < ${expectedSize.min}`);
  }
  if (expectedSize?.max && stat.size > expectedSize.max) {
    errors.push(`File too large: ${stat.size} > ${expectedSize.max}`);
  }
  if (stat.size === 0) {
    errors.push('File is empty');
  }
  return { type: 'file', ok: errors.length === 0, errors, warnings };
}

/** 验证 JSON 字符串 */
export function verifyJson(jsonStr: string): VerificationResult {
  try {
    JSON.parse(jsonStr);
    return { type: 'json', ok: true };
  } catch (e: any) {
    return { type: 'json', ok: false, errors: [e.message] };
  }
}

/** 验证 Office 文档（包装 office-self-check） */
export async function verifyOffice(filePath: string): Promise<VerificationResult> {
  const result = await officeSelfCheck(filePath);
  return {
    type: 'office',
    ok: result.ok && !result.error,
    errors: result.error ? [result.error] : undefined,
    warnings: result.issues,
  };
}

/** 智能验证（按文件路径/内容自动选择验证方式） */
export async function autoVerify(target: string): Promise<VerificationResult> {
  if (!target) {
    return { type: 'file', ok: false, errors: ['Empty target'] };
  }
  // JSON 字符串
  if (target.trim().startsWith('{') || target.trim().startsWith('[')) {
    return verifyJson(target);
  }
  // 文件路径
  if (fs.existsSync(target)) {
    const ext = path.extname(target).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      return verifyCode(target);
    }
    if (['.pptx', '.xlsx', '.docx'].includes(ext)) {
      return verifyOffice(target);
    }
    return verifyFile(target);
  }
  return { type: 'file', ok: false, errors: ['Target not found: ' + target] };
}
