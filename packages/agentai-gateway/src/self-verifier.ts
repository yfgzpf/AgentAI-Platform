/**
 * Self-Verifier — 自我验证模块
 * 用于验证 AI 输出是否符合安全规范和质量标准
 *
 * 注意: 原文件缺失，此为重建版本
 * 原错误: Cannot find module './path-guard.js' — 已修正为正确路径
 */

import { isPathAllowed } from './safety/path-guard.js';

export interface VerificationResult {
  ok: boolean;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
}

/**
 * 验证文件路径是否在允许范围内
 */
export function verifyFilePath(filePath: string): VerificationResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  const allowed = isPathAllowed(filePath);
  if (!allowed) {
    issues.push(`路径不在白名单内: ${filePath}`);
  }

  return {
    ok: issues.length === 0,
    score: Math.max(0, 100 - issues.length * 20 - warnings.length * 5),
    issues,
    warnings,
  };
}

/**
 * 验证命令是否在白名单内
 */
export function verifyCommand(cmd: string): VerificationResult {
  const dangerousPatterns = [
    /rm\s+-rf\s+\//,
    /format\s+[a-z]:\\/,
    /del\s+\/s\s+\/q\s+C:\\/,
    /shutdown/,
    /reboot/,
  ];

  const issues: string[] = [];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(cmd)) {
      issues.push(`危险命令模式匹配: ${pattern.toString()}`);
    }
  }

  return {
    ok: issues.length === 0,
    score: Math.max(0, 100 - issues.length * 30),
    issues,
    warnings: [],
  };
}

/**
 * 综合验证 — 验证多个维度
 */
export function verifyAll(params: {
  filePaths?: string[];
  commands?: string[];
}): VerificationResult {
  const allIssues: string[] = [];
  const allWarnings: string[] = [];

  if (params.filePaths) {
    for (const fp of params.filePaths) {
      const r = verifyFilePath(fp);
      allIssues.push(...r.issues);
      allWarnings.push(...r.warnings);
    }
  }

  if (params.commands) {
    for (const cmd of params.commands) {
      const r = verifyCommand(cmd);
      allIssues.push(...r.issues);
      allWarnings.push(...r.warnings);
    }
  }

  return {
    ok: allIssues.length === 0,
    score: Math.max(0, 100 - allIssues.length * 15 - allWarnings.length * 3),
    issues: allIssues,
    warnings: allWarnings,
  };
}

export default { verifyFilePath, verifyCommand, verifyAll };
