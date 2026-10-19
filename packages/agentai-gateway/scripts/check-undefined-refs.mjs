// check-undefined-refs.mjs
// 目的: 找出 @ts-nocheck 文件里"引用但未定义"的标识符 (logger is not defined 这类)。
// 原理: @ts-nocheck 会让 tsc 完全跳过一个文件, 于是 TS2304(Cannot find name) 永远不报,
//       这类 ReferenceError 能在生产潜伏数月, 而且炸点常在 catch 里 → 把真实错误二次掩盖。
// 做法: 生成"去掉 nocheck"的临时副本, 用 TypeScript 编译器 API 一次性编译全部副本,
//       只收集 TS2304/TS2552。有命中 exit 1。
//
// 用法: node scripts/check-undefined-refs.mjs [文件...]
//       不带参数 → 自动发现 src 下所有 @ts-nocheck 生产文件 (排除测试)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(pkgRoot, 'src');

/** 递归找出带 @ts-nocheck 的生产 .ts (只看文件头 600 字符) */
function discoverNocheckFiles(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['__tests__', 'node_modules', 'dist'].includes(ent.name)) continue;
      out.push(...discoverNocheckFiles(abs));
      continue;
    }
    if (!ent.isFile() || !ent.name.endsWith('.ts') || ent.name.endsWith('.d.ts')) continue;
    if (/\.(test|spec)\.ts$/.test(ent.name)) continue;
    if (/@ts-nocheck/.test(fs.readFileSync(abs, 'utf8').slice(0, 600))) {
      out.push(path.relative(pkgRoot, abs).replace(/\\/g, '/'));
    }
  }
  return out;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : discoverNocheckFiles(srcRoot);

if (targets.length === 0) {
  console.log('没有发现 @ts-nocheck 文件, 跳过');
  console.log('\n=== DONE: 0 处 ===');
  process.exit(0);
}

/** relPath → 临时副本绝对路径 */
const tmpMap = new Map();
const tmpFiles = [];

for (const rel of targets) {
  const abs = path.join(pkgRoot, rel);
  if (!fs.existsSync(abs)) {
    console.log(`skip (missing): ${rel}`);
    continue;
  }
  const raw = fs.readFileSync(abs, 'utf8');
  if (!/@ts-nocheck/.test(raw)) {
    console.log(`ok (无 @ts-nocheck, tsc 已覆盖): ${rel}`);
    continue;
  }
  const stripped = raw
    .split('\n')
    .filter((l) => !/^\s*\/\/\s*@ts-nocheck\b/.test(l))
    .join('\n');
  // 放同目录 → 相对 import 仍能解析
  const tmpAbs = abs.replace(/\.ts$/, '.nocheckcheck.ts');
  fs.writeFileSync(tmpAbs, stripped, 'utf8');
  tmpMap.set(tmpAbs, rel);
  tmpFiles.push(tmpAbs);
}

let total = 0;
try {
  if (tmpFiles.length > 0) {
    // 一次 Program 覆盖全部副本 —— 分开建会让依赖图重复解析 N 遍 (实测 90s → ~15s)
    const program = ts.createProgram(tmpFiles, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
      strict: false,
      noImplicitAny: false,
      esModuleInterop: true,
      types: [],
    });

    for (const tmpAbs of tmpFiles) {
      const rel = tmpMap.get(tmpAbs);
      const sf = program.getSourceFile(tmpAbs);
      if (!sf) {
        console.log(`⚠️ 无法载入: ${rel}`);
        continue;
      }
      const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
      const hits = diags.filter((d) => d.code === 2304 || d.code === 2552);
      if (hits.length === 0) {
        console.log(`✅ ${rel}  无未定义引用 (TS2304/TS2552)`);
        continue;
      }
      total += hits.length;
      console.log(`\n🔴 ${rel}  ${hits.length} 处未定义引用:`);
      for (const d of hits) {
        const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
        const msg = (d.messageText && d.messageText.messageText) || String(d.messageText);
        console.log(`   L${line + 1}:${character + 1}  ${msg}`);
      }
    }
  }
} finally {
  for (const f of tmpFiles) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

console.log(`\n=== DONE: ${total} 处 ===`);
process.exit(total > 0 ? 1 : 0);
