// @ts-nocheck
/**
 * 语义代码搜索 (对标本机 Trae IDE 的 SearchCodebase)
 * ----------------------------------------------------
 * 启发式评分引擎, 不引入向量数据库:
 *   - 中文关键词 → 函数/类名 → 导入路径 → 注释匹配
 *   - 3 层打分: 精确匹配(10) > 子串匹配(5) > 局部匹配(2)
 *   - 返回 top 20 结果 + 摘要
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SearchHit {
    file: string;
    score: number;
    /** 命中的行范围 */
    lines?: string;
    /** 命中的符号名 */
    symbol?: string;
    /** 命中原因 */
    reason: string;
}

const MAX_FILES = 200;
const MAX_RESULTS = 20;
const EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.turbo', 'coverage']);

/**
 * 从中文问题中提取搜索关键词
 */
function extractKeywords(question: string): string[] {
    // 直接按空格/标点拆词 + 保留 2 字以上
    const raw = question
        .replace(/[，。？！、；：""''【】（）《》\s]+/g, ' ')
        .split(' ')
        .filter(w => w.length >= 2);
    // 去重
    return [...new Set(raw)];
}

/**
 * 在项目根目录下搜 TypeScript/JavaScript 文件
 */
function collectFiles(root: string): string[] {
    const files: string[] = [];
    function walk(dir: string) {
        if (EXCLUDE.has(path.basename(dir))) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            if (files.length >= MAX_FILES) return;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); }
            else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
                files.push(full);
            }
        }
    }
    walk(root);
    return files;
}

/**
 * 对单个文件打分
 */
function scoreFile(filepath: string, keywords: string[]): SearchHit | null {
    try {
        const content = fs.readFileSync(filepath, 'utf-8');
        if (content.length === 0) return null;
        const lines = content.split('\n');
        let totalScore = 0;
        const hitLines: number[] = [];
        const reasons: string[] = [];

        // 文件名匹配 (30 分)
        const fname = path.basename(filepath, path.extname(filepath)).toLowerCase();
        for (const kw of keywords) {
            const kwLower = kw.toLowerCase();
            if (fname.includes(kwLower)) {
                totalScore += 30;
                reasons.push(`文件名包含 "${kw}"`);
            }
        }

        // 逐行匹配
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineLower = line.toLowerCase();
            for (const kw of keywords) {
                const kwLower = kw.toLowerCase();
                if (!lineLower.includes(kwLower)) continue;

                // 精确单词边界匹配 (10 分)
                if (new RegExp(`\\b${escapeRegex(kwLower)}\\b`).test(lineLower)) {
                    totalScore += 10;
                } else {
                    totalScore += 5;
                }

                // 是 export/function/class 行额外加分
                if (/^(export\s+)?(async\s+)?(function|class|interface|type|const|let|var|enum)\s+/.test(line.trim())) {
                    totalScore += 15;
                    reasons.push(`符号定义行匹配 "${kw}"`);
                }

                if (!hitLines.includes(i)) hitLines.push(i);
            }
        }

        if (totalScore === 0) return null;

        // 生成摘要 (最相关的行)
        const summary = hitLines
            .slice(0, 10)
            .map(i => `L${i + 1}: ${lines[i].trim().slice(0, 120)}`)
            .join('\n');

        return {
            file: filepath,
            score: totalScore,
            lines: summary,
            reason: [...new Set(reasons)].slice(0, 3).join('; ') || '内容匹配',
        };
    } catch {
        return null;
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 语义代码搜索入口
 * @param question 自然语言问题
 * @param workspace 项目根目录
 * @returns top 20 命中结果
 */
export function searchCodebase(question: string, workspace: string): SearchHit[] {
    if (!question || !question.trim()) return [];
    const keywords = extractKeywords(question);
    if (keywords.length === 0) return [];

    const files = collectFiles(path.resolve(workspace, 'src') || workspace);
    const hits: SearchHit[] = [];

    for (const file of files) {
        const hit = scoreFile(file, keywords);
        if (hit) hits.push(hit);
    }

    // 按 score 降序
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, MAX_RESULTS);
}

/**
 * 格式化搜索结果为可读文本
 */
export function formatSearchResults(hits: SearchHit[]): string {
    if (hits.length === 0) return '(未找到匹配的代码)';
    const lines: string[] = [];
    for (const h of hits) {
        const relPath = h.file.replace(process.cwd() + path.sep, '').replace(/\\/g, '/');
        lines.push(`## ${relPath} (score=${h.score})\n${h.reason}\n\`\`\`\n${h.lines}\n\`\`\``);
    }
    return lines.join('\n\n');
}
