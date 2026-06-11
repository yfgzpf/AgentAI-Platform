// @ts-nocheck
/**
 * 代码智能分析
 * ----------------------------------------------------
 * 功能:
 *   1. 符号跳转 - 解析 TS 文件导出 (function/class/interface/type/const)
 *   2. 依赖图 - 解析 import 语句, 构建模块依赖关系
 *   3. 圈复杂度 - 粗略计算 (if/for/while/switch/catch 计数)
 */

import * as fs from 'fs';

export interface Symbol {
    name: string;
    kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'variable';
    line: number;
    exported: boolean;
    async?: boolean;
    params?: string;
}

export interface Dependency {
    from: string;
    to: string;
    /** import specifiers, e.g. ["default"] / ["named1","named2"] */
    specifiers: string[];
    /** relative / npm / internal */
    kind: 'relative' | 'npm' | 'internal';
}

export interface ComplexityReport {
    file: string;
    lines: number;
    /** 圈复杂度 (if/for/while/switch/catch 总数) */
    cyclomatic: number;
    functions: number;
    /** 复杂度最高的 5 个函数 */
    topFunctions: { name: string; line: number; complexity: number }[];
}

/**
 * 从文件内容解析所有符号定义
 */
export function parseSymbols(filepath: string): Symbol[] {
    let content: string;
    try { content = fs.readFileSync(filepath, 'utf-8'); } catch { return []; }
    const lines = content.split('\n');
    const symbols: Symbol[] = [];

    const re = /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\s+(\w+)/;
    const constRe = /^(export\s+)?const\s+(\w+)\s*[=:]/;
    const varRe = /^(?:export\s+)?(let|var)\s+(\w+)\s*[=:]/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        let m = re.exec(line);
        if (m) {
            symbols.push({
                name: m[5],
                kind: m[4] as Symbol['kind'],
                line: i + 1,
                exported: !!m[1],
                async: !!m[3],
                params: extractParams(line, m[4] === 'function'),
            });
            continue;
        }
        m = constRe.exec(line);
        if (m) {
            symbols.push({ name: m[2], kind: 'const', line: i + 1, exported: !!m[1] });
            continue;
        }
        m = varRe.exec(line);
        if (m) {
            symbols.push({ name: m[2], kind: 'variable', line: i + 1, exported: false });
        }
    }
    return symbols;
}

function extractParams(line: string, isFunc: boolean): string | undefined {
    if (!isFunc) return undefined;
    const m = line.match(/\(([^)]*)\)/);
    return m ? m[1].trim().slice(0, 80) : undefined;
}

/**
 * 解析文件的 import 依赖关系
 */
export function parseDependencies(filepath: string): Dependency[] {
    let content: string;
    try { content = fs.readFileSync(filepath, 'utf-8'); } catch { return []; }
    const deps: Dependency[] = [];

    // import { a, b } from '...'
    // import x from '...'
    // require('...')
    const importRe = /import\s+(?:type\s+)?(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    const requireRe = /(?:const|let|var)\s+\{?([^}=]+)\}?\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

    for (const m of content.matchAll(importRe)) {
        const namedPart = m[1] ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
        const defaultPart = m[2] ? [m[2].trim()] : [];
        deps.push({
            from: filepath,
            to: m[3],
            specifiers: [...defaultPart, ...namedPart],
            kind: classifyImport(m[3]),
        });
    }
    for (const m of content.matchAll(requireRe)) {
        const specs = m[1] ? m[1].split(',').map(s => s.trim()).filter(Boolean) : [];
        deps.push({
            from: filepath,
            to: m[2],
            specifiers: specs,
            kind: classifyImport(m[2]),
        });
    }
    return deps;
}

function classifyImport(target: string): Dependency['kind'] {
    if (target.startsWith('.')) return 'relative';
    if (target.startsWith('@agentai')) return 'internal';
    return 'npm';
}

/**
 * 计算文件圈复杂度
 */
export function computeComplexity(filepath: string): ComplexityReport {
    let content: string;
    try { content = fs.readFileSync(filepath, 'utf-8'); } catch {
        return { file: filepath, lines: 0, cyclomatic: 0, functions: 0, topFunctions: [] };
    }
    const lines = content.split('\n');
    const funcPatterns: { name: string; line: number; complexity: number }[] = [];

    // 按函数拆分 (粗略)
    const funcRe = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
    const arrowRe = /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/gm;

    for (const m of content.matchAll(funcRe)) {
        funcPatterns.push({ name: m[1], line: lineOf(content, m.index!), complexity: 1 });
    }
    for (const m of content.matchAll(arrowRe)) {
        funcPatterns.push({ name: m[1], line: lineOf(content, m.index!), complexity: 1 });
    }

    // 全局复杂度
    let cyclo = 1;
    const complexifiers = [/\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bswitch\b/g, /\bcatch\b/g, /\?\s*[^:]+:/g];
    for (const re of complexifiers) {
        for (const _ of content.matchAll(re)) cyclo++;
    }

    return {
        file: filepath,
        lines: lines.length,
        cyclomatic: cyclo,
        functions: funcPatterns.length,
        topFunctions: funcPatterns.slice(0, 5),
    };
}

function lineOf(text: string, pos: number): number {
    return (text.slice(0, pos).match(/\n/g) || []).length + 1;
}

/**
 * 格式化 analyze 结果
 */
export function formatAnalyzeResult(
    symbols: Symbol[],
    deps: Dependency[],
    complexity: ComplexityReport,
): string {
    const parts: string[] = [];
    parts.push(`## 复杂度\n行数: ${complexity.lines}, 圈复杂度: ${complexity.cyclomatic}, 函数数: ${complexity.functions}`);
    if (complexity.topFunctions.length > 0) {
        parts.push('### 复杂度 Top-' + complexity.topFunctions.length);
        for (const f of complexity.topFunctions) {
            parts.push(`- \`${f.name}\` L${f.line}: 复杂度 ~${f.complexity}`);
        }
    }

    parts.push(`\n## 符号 (${symbols.length})`);
    for (const s of symbols.slice(0, 30)) {
        const tags = [s.exported ? 'export' : '', s.async ? 'async' : '', s.params ? `(${s.params})` : ''].filter(Boolean);
        parts.push(`- L${s.line}: ${s.kind} \`${s.name}\` ${tags.join(' ')}`);
    }
    if (symbols.length > 30) parts.push(`... ${symbols.length - 30} more`);

    if (deps.length > 0) {
        parts.push(`\n## 依赖 (${deps.length})`);
        for (const d of deps.slice(0, 15)) {
            parts.push(`- → \`${d.to}\` [${d.kind}] (${d.specifiers.slice(0, 3).join(', ')})`);
        }
        if (deps.length > 15) parts.push(`... ${deps.length - 15} more`);
    }

    return parts.join('\n');
}
