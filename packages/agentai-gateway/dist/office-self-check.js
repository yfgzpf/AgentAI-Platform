import * as path from 'path';
import * as fs from 'fs';
import { isPathAllowed } from './safety/path-guard.js'; // v3.2 修复: path-guard 在 safety/ 子目录
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const TIMEOUT_MS = 30_000;
/** 检测文件类型 */
function detectType(file) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.pptx')
        return 'pptx';
    if (ext === '.xlsx' || ext === '.xls')
        return 'xlsx';
    if (ext === '.docx' || ext === '.doc')
        return 'docx';
    return null;
}
/** 元素统计（无需 LibreOffice） */
async function quickStats(file, type) {
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
        const words = (buf.match(/<w:t[^>]*>[^<]+<\/w:t>/g) || []).reduce((sum, m) => sum + m.replace(/<[^>]+>/g, '').length, 0);
        const pages = Math.max(1, Math.ceil(words / 500));
        return { words, pages };
    }
    return {};
}
/** 检查占位符/空元素 */
function detectIssues(file, type) {
    const issues = [];
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
export async function officeSelfCheck(filePath) {
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
