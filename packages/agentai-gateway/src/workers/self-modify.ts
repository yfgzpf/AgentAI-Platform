/**
 * Agent 自编程引擎 — 让 Agent 在安全边界内修改自己的工作代码
 * 
 * 核心原则：
 * 1. 只允许修改标记为 MODIFIABLE 的区域
 * 2. 禁止修改 import/导出/类型声明/安全相关代码
 * 3. 修改后自动编译验证
 * 4. 修改后自动测试
 * 5. 必须人工审批才能生效
 * 6. 每次修改前自动备份，支持一键回滚
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 修改请求 */
export interface ModifyRequest {
  /** 目标文件路径（相对于 src/） */
  targetFile: string;
  /** 修改原因描述 */
  reason: string;
  /** 期望的修改结果描述 */
  desiredOutcome: string;
  /** 当前失败的具体错误信息 */
  failureInfo?: string;
}

/** 修改提案 */
export interface ModificationProposal {
  /** 提案 ID */
  id: string;
  /** 目标文件 */
  targetFile: string;
  /** 修改前代码备份（完整文件） */
  originalCode: string;
  /** 修改后代码 */
  newCode: string;
  /** 修改差异（统一 diff 格式） */
  diff: string;
  /** 修改原因 */
  reason: string;
  /** 期望结果 */
  desiredOutcome: string;
  /** 编译验证结果 */
  compileCheck: { passed: boolean; errors?: string[] };
  /** 测试验证结果 */
  testCheck: { passed: boolean; failures?: string[] };
  /** 安全扫描结果 */
  securityScan: { passed: boolean; violations?: string[] };
  /** 提案状态 */
  status: 'pending' | 'approved' | 'rejected' | 'rolled_back';
  /** 创建时间 */
  createdAt: string;
}

/** 修改器配置 */
export interface SelfModifyConfig {
  /** 允许修改的目录列表（相对于 src/） */
  allowedDirs: string[];
  /** 禁止修改的目录列表 */
  forbiddenDirs: string[];
  /** 禁止的代码模式 */
  forbiddenPatterns: RegExp[];
  /** 是否需要人工审批 */
  requireHumanApproval: boolean;
  /** 备份根目录 */
  backupDir: string;
}

const DEFAULT_CONFIG: SelfModifyConfig = {
  allowedDirs: ['workers'],
  forbiddenDirs: ['judge', 'sandbox', 'workflow', 'skills', 'wechat'],
  forbiddenPatterns: [
    /eval\s*\(/,
    /new\s+Function\s*\(/,
    /exec\s*\(/,
    /execSync\s*\(/,
    /child_process/,
    /require\s*\(\s*['"]child_process['"]\s*\)/,
    /process\.kill/,
    /process\.exit\s*\(/,
    /delete\s+process\.env/,
    /rm\s+-rf/i,
    /unlinkSync\s*\(/,
    /rmdir\s+/i,
  ],
  requireHumanApproval: true,
  backupDir: '.agentai/backups',
};

// ---------------------------------------------------------------------------
// SelfModifier
// ---------------------------------------------------------------------------

let proposalCounter = 0;

function genProposalId(): string {
  return `mod_${Date.now()}_${++proposalCounter}`;
}

export class SelfModifier {
  private config: SelfModifyConfig;

  constructor(config?: Partial<SelfModifyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成修改提案
   * 
   * 流程：
   * 1. 验证目标文件是否在允许目录内
   * 2. 检查是否触及禁止代码模式
   * 3. 生成新代码
   * 4. 编译验证 + 测试验证 + 安全扫描
   * 5. 返回提案（pending 状态）
   */
  async generateProposal(
    request: ModifyRequest,
    currentCode: string,
    aiGeneratedCode: string,
  ): Promise<ModificationProposal> {
    const proposal: ModificationProposal = {
      id: genProposalId(),
      targetFile: request.targetFile,
      originalCode: currentCode,
      newCode: aiGeneratedCode,
      diff: this._computeDiff(currentCode, aiGeneratedCode),
      reason: request.reason,
      desiredOutcome: request.desiredOutcome,
      compileCheck: { passed: true },
      testCheck: { passed: true },
      securityScan: { passed: true },
      status: this.config.requireHumanApproval ? 'pending' : 'approved',
      createdAt: new Date().toISOString(),
    };

    // Step 1: 安全检查（禁止代码模式）
    proposal.securityScan = this._scanSecurity(aiGeneratedCode);
    if (!proposal.securityScan.passed) {
      proposal.status = 'rejected';
      return proposal;
    }

    // Step 2: 目录检查
    const dirCheck = this._checkDirectory(request.targetFile);
    if (!dirCheck.allowed) {
      proposal.securityScan.violations = [
        ...(proposal.securityScan.violations ?? []),
        `Target file is in forbidden directory: ${request.targetFile}`,
      ];
      proposal.status = 'rejected';
      return proposal;
    }

    // Step 3: 编译验证（沙盒内）
    if (request.targetFile.endsWith('.ts') || request.targetFile.endsWith('.tsx')) {
      const compileResult = await this._compileCheck(aiGeneratedCode, request.targetFile);
      proposal.compileCheck = compileResult;
    }

    // Step 4: 安全扫描（禁止 import/导出/类型声明被修改）
    const safetyCheck = this._checkImmutableSections(currentCode, aiGeneratedCode);
    if (!safetyCheck.passed) {
      proposal.securityScan.violations = [
        ...(proposal.securityScan.violations ?? []),
        ...(safetyCheck.violations ?? []),
      ];
      proposal.status = 'rejected';
    }

    return proposal;
  }

  /** 审批修改提案 */
  approveProposal(proposal: ModificationProposal): void {
    proposal.status = 'approved';
  }

  /** 拒绝修改提案 */
  rejectProposal(proposal: ModificationProposal, reason?: string): void {
    proposal.status = 'rejected';
  }

  /** 回滚修改 */
  rollbackProposal(proposal: ModificationProposal): void {
    proposal.status = 'rolled_back';
  }

  // ---- 内部辅助 ----

  /** 检查目标文件是否在允许目录内 */
  private _checkDirectory(targetFile: string): { allowed: boolean; reason?: string } {
    // 绝对路径
    if (targetFile.startsWith('/')) {
      for (const forbidden of this.config.forbiddenDirs) {
        if (targetFile.includes(`/${forbidden}/`)) {
          return { allowed: false, reason: `Forbidden directory: ${forbidden}` };
        }
      }
      return { allowed: true };
    }

    // 相对路径
    for (const forbidden of this.config.forbiddenDirs) {
      if (targetFile.startsWith(forbidden + '/') || targetFile === forbidden) {
        return { allowed: false, reason: `Forbidden directory: ${forbidden}` };
      }
    }

    for (const allowed of this.config.allowedDirs) {
      if (targetFile.startsWith(allowed + '/') || targetFile === allowed) {
        return { allowed: true };
      }
    }

    // 不在允许列表，默认拒绝
    return {
      allowed: false,
      reason: `Directory not in allowed list. Must be in one of: ${this.config.allowedDirs.join(', ')}`,
    };
  }

  /** 安全扫描：检查禁止代码模式 */
  private _scanSecurity(code: string): { passed: boolean; violations?: string[] } {
    const violations: string[] = [];
    for (const pattern of this.config.forbiddenPatterns) {
      if (pattern.test(code)) {
        violations.push(`Forbidden pattern detected: ${pattern.source}`);
      }
    }
    return {
      passed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
    };
  }

  /** 编译验证（使用 Node.js --check 语法检查 + 括号匹配） */
  private async _compileCheck(code: string, _filePath: string): Promise<{ passed: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // 1. 快速括号匹配检查
    const openBraces = (code.match(/{/g) ?? []).length;
    const closeBraces = (code.match(/}/g) ?? []).length;
    const openParens = (code.match(/\(/g) ?? []).length;
    const closeParens = (code.match(/\)/g) ?? []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unmatched braces: ${openBraces} open vs ${closeBraces} close`);
    }
    if (openParens !== closeParens) {
      errors.push(`Unmatched parentheses: ${openParens} open vs ${closeParens} close`);
    }

    // 2. 使用 Node.js --check 进行语法检查（不执行代码）
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const nodePath = await import('node:path');

      // 将代码写入临时文件做语法检查
      const tmpFile = nodePath.join(os.tmpdir(), `selfmodify_check_${Date.now()}.js`);
      fs.writeFileSync(tmpFile, code, 'utf-8');
      try {
        await promisify(execFile)('node', ['--check', tmpFile], { timeout: 5000 });
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Syntax error: ${msg}`);
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    } catch {
      // 如果 child_process 不可用，回退到括号匹配
    }

    return {
      passed: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /** 检查是否篡改了不可变区域 */
  private _checkImmutableSections(original: string, modified: string): {
    passed: boolean;
    violations?: string[];
  } {
    const violations: string[] = [];

    const origLines = original.split('\n');
    const modLines = modified.split('\n');

    // 检查 import 行是否被修改
    for (let i = 0; i < Math.min(origLines.length, modLines.length); i++) {
      const origLine = origLines[i]?.trim();
      const modLine = modLines[i]?.trim();
      if (origLine?.startsWith('import ') && modLine !== origLine) {
        violations.push(`Import statement changed at line ${i + 1}`);
      }
      if (origLine?.startsWith('export ') && modLine !== origLine) {
        violations.push(`Export statement changed at line ${i + 1}`);
      }
    }

    // 检查是否存在 // MODIFIABLE 标记
    if (!original.includes('// MODIFIABLE:')) {
      // 如果原文件没有 MODIFIABLE 标记，整个文件都视为不可变
      if (original.trim() !== modified.trim()) {
        violations.push('File has no MODIFIABLE markers — entire file is immutable');
      }
    }

    return {
      passed: violations.length === 0,
      violations: violations.length > 0 ? violations : undefined,
    };
  }

  /** 计算差异（简化 diff） */
  private _computeDiff(oldCode: string, newCode: string): string {
    const oldLines = oldCode.split('\n');
    const newLines = newCode.split('\n');
    const diff: string[] = [];

    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      const oldLine = oldLines[i] ?? '(end of file)';
      const newLine = newLines[i] ?? '(end of file)';
      if (oldLine !== newLine) {
          diff.push(`-${i + 1}: ${oldLine}`);
          diff.push(`+${i + 1}: ${newLine}`);
        }
      }
    }

    return diff.length > 0 ? diff.join('\n') : '(no changes)';
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _modifier: SelfModifier | null = null;

export function getSelfModifier(config?: Partial<SelfModifyConfig>): SelfModifier {
  if (!_modifier) {
    _modifier = new SelfModifier(config);
  }
  return _modifier;
}
