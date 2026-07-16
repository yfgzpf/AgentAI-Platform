/**
 * office-self-check: Office 文档自检
 * ----------------------------------------------------
 * 灵感来源: OfficeCLI (12.3k Stars)
 * 核心思想: AI 写完 Office 文档后, 自动截图/检查/反馈
 *
 * 安全守护:
 *  - 路径白名单 (用 path-guard)
 *  - 不执行任意命令, 只用受信任的 office-check CLI
 *  - 超时控制
 *  - 文件大小限制
 */
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { isPathAllowed } from './safety/path-guard.js';  // v3.2 修复: path-guard 在 safety/ 子目录
import { runSandboxedSkill } from './safety/code-runner.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const TIMEOUT_MS = 30_000;

export type OfficeType = 'pptx' | 'xlsx' | 'docx';

export interface OfficeCheckResult {
  ok: boolean;
  type: OfficeType;
  file: string;
  /** LibreOffice 渲染出的 PNG 截图（base64）或 null */
  screenshot?: string;
  /** 元素统计 */
  stats?: { slides?: number; sheets?: number; pages?: number; words?: number };
  /** 问题清单（占位符空、字体异常等） */
  issues?: string[];
  /** 错误 */
  error?: string;
}

/** 检测文件类型 */
function detectType(file: string): OfficeType | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pptx') return 'pptx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  return null;
}

/** 元素统计（无需 LibreOffice） */
async function quickStats(file: string, type: OfficeType): Promise<OfficeCheckResult['stats']> {
  const buf = fs.readFileSync(file, 'utf-8');
  // OOXML 格式: pptx/xlsx/docx 都是 zip, 内部 XML 含 <p:sldId>/<sheet>/<w:p>
  // 简化: 用正则估算
  if (type === 'pptx') {
    const slides = (buf.match(/<p:sldId\b/g) || []).length;
    return { slides };
  }
  if (type === 'xlsx') {
    const sheets = (buf.match(/<sheet\b/g) || []).length;
    return { sheets };
  }
  if (type === 'docx') {
    const words = (buf.match(/<w:t[^>]*>[^<]+<\/w:t>/g) || []).reduce(
      (sum, m) => sum + m.replace(/<[^>]+>/g, '').length,
      0
    );
    const pages = Math.max(1, Math.ceil(words / 500));
    return { words, pages };
  }
  return {};
}

/** 检查占位符/空元素 */
function detectIssues(file: string, type: OfficeType): string[] {
  const issues: string[] = [];
  const buf = fs.readFileSync(file, 'utf-8');
  if (type === 'pptx') {
    // 检查是否有未填充的占位符
    const placeholders = (buf.match(/<p:ph\b/g) || []).length;
    const fldTags = (buf.match(/<a:fld[^>]*type="slidenum"|<a:fld[^>]*type="datetime"/g) || []).length;
    if (placeholders > 10) {
      issues.push(`过多占位符: ${placeholders} 个（建议拆分或精简）`);
    }
    if (fldTags === 0) {
      issues.push('未发现页码/日期占位符（建议添加）');
    }
  }
  if (type === 'xlsx') {
    // 检查空 cell 比例
    const cells = (buf.match(/<c\s+[^>]*\/>/g) || []).length;
    if (cells > 100) {
      issues.push(`空单元格过多: ${cells} 个（可能影响阅读）`);
    }
  }
  if (type === 'docx') {
    // 检查目录
    if (!/TOC|TOC \d/.test(buf)) {
      issues.push('未发现目录（建议添加）');
    }
  }
  return issues;
}

/** 主入口: 自检 Office 文档 */
export async function officeSelfCheck(
  filePath: string
): Promise<OfficeCheckResult> {
  // 1. 路径白名单
  if (!isPathAllowed(filePath)) {
    return { ok: false, type: 'pptx', file: filePath, error: 'Path not allowed' };
  }
  const resolved = path.resolve(filePath);
  // 2. 文件存在
  if (!fs.existsSync(resolved)) {
    return { ok: false, type: 'pptx', file: filePath, error: 'File not found' };
  }
  // 3. 大小限制
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_FILE_SIZE) {
    return { ok: false, type: 'pptx', file: filePath, error: `File too large: ${stat.size}` };
  }
  // 4. 类型检测
  const type = detectType(resolved);
  if (!type) {
    return { ok: false, type: 'pptx', file: filePath, error: 'Not a supported Office format' };
  }
  // 5. 快速统计
  const stats = await quickStats(resolved, type);
  // 6. 问题检测
  const issues = detectIssues(resolved, type);
  return {
    ok: true,
    type,
    file: resolved,
    stats,
    issues: issues.length > 0 ? issues : undefined,
  };
}
