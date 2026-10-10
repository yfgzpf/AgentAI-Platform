#!/usr/bin/env node
/**
 * 工具一致性构建期校验 (fail-fast)
 *
 * 背景: src/index.ts:133 用 EXTRA_TOOLS 循环取 EXTRA_HANDLERS[spec.name] 注册工具,
 *      缺 handler 时只 console.warn + continue —— 构建通过、启动正常,
 *      但那个工具**永远不会注册**。运行时静默失效, 编译期完全看不见。
 *
 * 实测 (2026-10-10): EXTRA_TOOLS 声明 198 / EXTRA_HANDLERS 实现 203,
 *      5 个 handler 从未注册: edit_file, get_symbols, clear_plan,
 *      knowledge_explore, _formatBytes。
 *
 * 实现说明: 用 TypeScript 编译器 API 走 AST, 不用正则/括号配平。
 *   tools.ts 有大量含 ${} 的模板字符串, 正则和括号配平都会误判(实测各踩一次)。
 *
 * 双向校验:
 *   1. 声明了但没实现 → ERROR (工具静默消失)
 *   2. 实现了但没声明 → WARN  (死代码, 可能是遗漏的声明)
 *   3. 缺 riskLevel    → WARN  (审批门会走错分支)
 *
 * 退出码: 1 = 有 ERROR / AST 解析失败; 0 = 通过
 * 用法: node scripts/verify-tool-consistency.mjs [--strict]
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(ROOT, '..', '..');
const TOOLS_FILE = resolve(ROOT, 'src/tools.ts');
const STRICT = process.argv.includes('--strict');

// pnpm workspace 里 typescript 在 repo 根 node_modules
const require = createRequire(import.meta.url);
let ts;
for (const base of [REPO_ROOT, ROOT]) {
    try {
        ts = require(require.resolve('typescript', { paths: [base] }));
        break;
    } catch { /* try next */ }
}
if (!ts) {
    console.error('[verify-tools] FAIL: 找不到 typescript, 无法解析 AST');
    process.exit(2);
}

const src = readFileSync(TOOLS_FILE, 'utf-8');
const sf = ts.createSourceFile('tools.ts', src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

/** 找到顶层 `export const NAME = <ArrayLiteral|ObjectLiteral>` */
function findTopLevelLiteral(name) {
    for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
            const init = d.initializer;
            if (init && (ts.isArrayLiteralExpression(init) || ts.isObjectLiteralExpression(init))) {
                return init;
            }
        }
    }
    return null;
}

const toolsLit = findTopLevelLiteral('EXTRA_TOOLS');
const handlersLit = findTopLevelLiteral('EXTRA_HANDLERS');

if (!toolsLit || !ts.isArrayLiteralExpression(toolsLit)) {
    console.error('[verify-tools] FAIL: AST 里找不到 EXTRA_TOOLS 数组字面量');
    process.exit(2);
}
if (!handlersLit || !ts.isObjectLiteralExpression(handlersLit)) {
    console.error('[verify-tools] FAIL: AST 里找不到 EXTRA_HANDLERS 对象字面量');
    process.exit(2);
}

// --- 提取声明: { name: 'xxx', ... } ---
const declared = [];
const noRisk = [];
for (const el of toolsLit.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    let name = null, risk = null;
    for (const p of el.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        if (key === 'name' && ts.isStringLiteral(p.initializer)) name = p.initializer.text;
        if (key === 'riskLevel' && ts.isStringLiteral(p.initializer)) risk = p.initializer.text;
    }
    if (name) {
        declared.push(name);
        if (!risk) noRisk.push(name);
    }
}

// --- 提取实现: { xxx: (args) => {} } ---
const implemented = [];
for (const p of handlersLit.properties) {
    let key = null;
    if (ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
        const n = p.name;
        if (n && (ts.isIdentifier(n) || ts.isStringLiteral(n))) key = n.text;
    }
    if (key) implemented.push(key);
}

const uniq = a => [...new Set(a)];
const declaredU = uniq(declared);
const implementedU = uniq(implemented);

if (declaredU.length === 0 || implementedU.length === 0) {
    console.error(`[verify-tools] FAIL: AST 解析结果异常 declared=${declaredU.length} implemented=${implementedU.length}`);
    process.exit(2);
}

const noHandler = declaredU.filter(n => !implementedU.includes(n));
const noDeclaration = implementedU.filter(n => !declaredU.includes(n));
const realDead = noDeclaration.filter(n => !n.startsWith('_'));
const privHelpers = noDeclaration.filter(n => n.startsWith('_'));

// 风险等级分布
const riskDist = {};
for (const el of toolsLit.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    for (const p of el.properties) {
        if (!ts.isPropertyAssignment(p)) continue;
        const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
        if (key === 'riskLevel' && ts.isStringLiteral(p.initializer)) {
            riskDist[p.initializer.text] = (riskDist[p.initializer.text] || 0) + 1;
        }
    }
}

console.log('[verify-tools] 工具一致性校验 (TypeScript AST)');
console.log('  声明 EXTRA_TOOLS    :', declaredU.length);
console.log('  实现 EXTRA_HANDLERS :', implementedU.length);
console.log('  风险等级分布       :', JSON.stringify(riskDist));

let hasError = false;

if (noHandler.length) {
    hasError = true;
    console.error(`\n  ❌ ERROR 声明但无实现 (${noHandler.length}) — 注册时会被静默跳过:`);
    for (const n of noHandler) console.error(`       - ${n}`);
}

if (realDead.length) {
    const label = STRICT ? 'ERROR' : 'WARN ';
    if (STRICT) hasError = true;
    console.warn(`\n  ⚠️  ${label} 有实现但未声明 (${realDead.length}) — 永不注册的死代码:`);
    for (const n of realDead) console.warn(`       - ${n}`);
}

if (privHelpers.length) {
    console.log(`\n  ℹ️  私有 helper (下划线前缀, 已忽略): ${privHelpers.join(', ')}`);
}

if (noRisk.length) {
    const msg = `\n  ⚠️  WARN 缺 riskLevel 的声明 (${noRisk.length}): ${noRisk.slice(0, 12).join(', ')}${noRisk.length > 12 ? ' ...' : ''}`;
    if (STRICT) { hasError = true; console.error(msg.replace('WARN', 'ERROR')); }
    else console.warn(msg);
}

if (hasError) {
    console.error('\n[verify-tools] ❌ 校验未通过');
    process.exit(1);
}

console.log(`\n[verify-tools] ✅ 校验通过 (${declaredU.length} 个工具全部有实现)`);
process.exit(0);