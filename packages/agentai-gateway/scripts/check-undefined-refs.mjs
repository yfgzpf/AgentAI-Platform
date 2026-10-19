// check-undefined-refs.mjs
// 目的: 找出 @ts-nocheck 文件里"引用但未定义"的标识符 (logger is not defined 这类)。
// 原理: @ts-nocheck 会让 tsc 完全跳过一个文件, 于是 TS2304(Cannot find name) 永远不报,
//       这类 ReferenceError 能在生产潜伏数月, 而且炸点常在 catch 里 → 把真实错误二次掩盖。
// 做法: 用**内存编译器宿主**把目标文件的 @ts-nocheck 行去掉 (不落任何临时文件),
//       一次性编译, 只收集 TS2304/TS2552。有命中 exit 1。
//
// 为什么不写临时副本: 早先版本在 src/ 下写 *.nocheckcheck.ts, 一旦进程被强杀
// (测试超时/手动中断) 就留下垃圾文件, 而 tsconfig 的 include 是 src/**/* →
// 这些副本会被 tsc 一起编译, 反而制造新问题。内存宿主没有这个风险。
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
    if (/@ts-nocheck/.test(fs.readFileSync(abs, 'utf8').slice(0, 600))) out.push(abs);
  }
  return out;
}

const argFiles = process.argv.slice(2);
const targetsAbs = (argFiles.length ? argFiles.map((f) => path.resolve(pkgRoot, f)) : discoverNocheckFiles(srcRoot))
  .filter((f) => fs.existsSync(f));

if (targetsAbs.length === 0) {
  console.log('没有发现 @ts-nocheck 文件, 跳过');
  console.log('\n=== DONE: 0 处 ===');
  process.exit(0);
}

/** absPath → 去掉 @ts-nocheck 的源码 (只放内存) */
const strippedByPath = new Map();
for (const abs of targetsAbs) {
  const raw = fs.readFileSync(abs, 'utf8');
  if (!/@ts-nocheck/.test(raw)) continue;
  strippedByPath.set(
    path.resolve(abs),
    raw.split('\n').filter((l) => !/^\s*\/\/\s*@ts-nocheck\b/.test(l)).join('\n'),
  );
}

const rel = (abs) => path.relative(pkgRoot, abs).replace(/\\/g, '/');
const options = {
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
};

// 覆盖 compiler host: 目标文件返回"已去掉 nocheck"的内存内容, 其余走默认磁盘读取
const baseHost = ts.createCompilerHost(options, true);
const host = {
  ...baseHost,
  getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
    const key = path.resolve(fileName);
    const patched = strippedByPath.get(key);
    if (patched !== undefined) {
      return ts.createSourceFile(fileName, patched, languageVersion, true);
    }
    return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  },
  readFile(fileName) {
    const key = path.resolve(fileName);
    return strippedByPath.has(key) ? strippedByPath.get(key) : baseHost.readFile(fileName);
  },
  fileExists(fileName) {
    return strippedByPath.has(path.resolve(fileName)) || baseHost.fileExists(fileName);
  },
};

let total = 0;
const program = ts.createProgram(targetsAbs, options, host);

for (const abs of targetsAbs) {
  if (!strippedByPath.has(path.resolve(abs))) {
    console.log(`ok (无 @ts-nocheck, tsc 已覆盖): ${rel(abs)}`);
    continue;
  }
  const sf = program.getSourceFile(abs);
  if (!sf) {
    console.log(`⚠️ 无法载入: ${rel(abs)}`);
    continue;
  }
  const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  const hits = diags.filter((d) => d.code === 2304 || d.code === 2552);
  if (hits.length === 0) {
    console.log(`✅ ${rel(abs)}  无未定义引用 (TS2304/TS2552)`);
    continue;
  }
  total += hits.length;
  console.log(`\n🔴 ${rel(abs)}  ${hits.length} 处未定义引用:`);
  for (const d of hits) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
    const msg = (d.messageText && d.messageText.messageText) || String(d.messageText);
    console.log(`   L${line + 1}:${character + 1}  ${msg}`);
  }
}

console.log(`\n=== DONE: ${total} 处 ===`);
process.exit(total > 0 ? 1 : 0);
