#!/usr/bin/env node
/**
 * verify-web-build.mjs — GUI 构建产物一致性门 (2026-10-12)
 *
 * 立这道门的理由: 用户反馈「以前打包会**功能缺失** / **与开发状态显示不一致** / 溢出 /
 * 控件与开发状态显示不一致」。这几类问题里,**前两类是可机检的产物缺陷**, 过去却全靠人肉
 * 在安装包里翻 —— 而且真的翻漏了:
 *
 *   实测证据 (2026-10-12):
 *     · `packages/agentai-gui/dist/index.html` 的 title 是 `PulseFlow Studio`,
 *       而源码 `packages/agentai-gui/index.html` 已是 `岐枢 PulseFlow Studio`
 *       → 归档的产物**落后于源码**(换品牌之后没重编), 这就是"与开发状态不一致"。
 *     · dist 里有两个 `index-*.js`, 而 build-for-desktop.mjs 按字母序会删掉
 *       HTML 真正引用的那个 (详见该文件 114 行起的注释) → 打包后白屏 = "功能缺失"。
 *
 * 本脚本做四类断言 (ERROR → exit 1; WARN 只打印):
 *   E1 title 一致性   —— dist/index.html 的 <title> 必须等于 src/index.html 的
 *   E2 引用完整性     —— dist/index.html 里每个 /assets/** 引用必须在磁盘上存在
 *                        (尤其: 被引用的 index-*.js 必须在 assets/js/ 里)
 *   E3 chunk 完整性   —— dist/assets/js/*.js 内部 import 的**哈希命名 chunk** 必须存在
 *                        (懒加载 chunk 缺失 = 点开某个功能才白屏, 最典型的"功能缺失")
 *   E4 品牌一致性     —— dist/index.html 必须含 src/index.html 里出现的 favicon 引用
 *   W1 陈旧告警       —— src/index.html 比 dist/index.html 新 (stale dist 的早期信号)
 *   W2 孤儿报告       —— 存在 HTML 未引用的 index-*.js (**合法**: 名为 index 的懒加载 chunk)
 *
 * 用法:
 *   node scripts/verify-web-build.mjs        # 从任意 cwd 均可 (路径按 __dirname 解析)
 * 退出码: 0 = 通过 (可能有 WARN); 1 = 有 ERROR
 *
 * 调用方: packages/agentai-desktop/src-tauri/scripts/build-for-desktop.mjs (GUI 编译之后)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts → src-tauri → agentai-desktop → packages → repo-root
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const GUI_DIR = resolve(ROOT, 'packages', 'agentai-gui');
const DIST_DIR = join(GUI_DIR, 'dist');
const DIST_HTML = join(DIST_DIR, 'index.html');
const SRC_HTML = join(GUI_DIR, 'index.html');

const errors = [];
const warns = [];
const pass = [];

const ok = (m) => pass.push(m);
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ── 前置: dist 是否存在 ────────────────────────────────────────────────
if (!existsSync(DIST_HTML)) {
  err(`dist/index.html 不存在: ${DIST_HTML} —— 尚未构建, 或构建输出目录被改过`);
  report();
}
if (!existsSync(SRC_HTML)) {
  err(`源码 index.html 不存在: ${SRC_HTML} —— 仓库结构异常`);
  report();
}

const distHtml = readFileSync(DIST_HTML, 'utf8');
const srcHtml = readFileSync(SRC_HTML, 'utf8');

// ── E1: title 一致性 (「与开发状态显示不一致」的直接指针) ──────────────
{
  const pick = (html) => (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]?.trim() ?? null;
  const distTitle = pick(distHtml);
  const srcTitle = pick(srcHtml);
  if (distTitle === null || srcTitle === null) {
    warn('index.html 缺少 <title>, 跳过 title 一致性检查');
  } else if (distTitle !== srcTitle) {
    err(
      `title 不一致 —— 产物落后于源码 (典型的"与开发状态显示不一致")\n` +
      `      dist: ${JSON.stringify(distTitle)}\n` +
      `      src : ${JSON.stringify(srcTitle)}\n` +
      `      → 重新构建 GUI: cd packages/agentai-gui && npx vite build`
    );
  } else {
    ok(`title 一致: ${JSON.stringify(distTitle)}`);
  }
}

// ── E2: dist/index.html 里每个 /assets/** 引用必须存在 ─────────────────
{
  const refs = [...distHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (refs.length === 0) {
    err('dist/index.html 里没有任何 /assets/** 引用 —— 构建产物结构异常 (脚本/样式都没挂上)');
  }
  for (const ref of new Set(refs)) {
    const abs = join(DIST_DIR, ref.replace(/^\//, ''));
    if (!existsSync(abs)) {
      err(`index.html 引用的资源不存在: ${ref} → 期望文件 ${abs} (打包后必然功能缺失)`);
    }
  }
  if (refs.length) ok(`index.html 的 ${new Set(refs).size} 个 /assets/** 引用全部存在`);

  // 单独把 entry chunk 点出来 —— 这正是 build-for-desktop.mjs 误删过的那个
  const entryRefs = [...new Set(refs)].filter((r) => /\/assets\/js\/index-[^/]+\.js$/.test(r));
  if (entryRefs.length === 0) {
    err('index.html 未引用任何 /assets/js/index-*.js —— 没有入口脚本, 打包后是白屏');
  } else {
    ok(`入口脚本已挂上: ${entryRefs.join(', ')}`);
  }
}

// ── E3: 构建出的 chunk 之间引用必须闭合 (缺懒加载 chunk = 点进功能才白屏) ──
{
  const jsDir = join(DIST_DIR, 'assets', 'js');
  if (!existsSync(jsDir)) {
    err(`dist/assets/js 不存在: ${jsDir}`);
  } else {
    const files = new Set(readdirSync(jsDir).filter((f) => f.endsWith('.js')));
    // 只认 Vite 的哈希命名 chunk (name-XXXXXXXX.js, 8 位 hash), 避免把压缩产物里的
    // 普通字符串 "./foo.js" 当引用而误报。
    const chunkPattern = /["'`]\.\/([A-Za-z0-9_$-]+-[A-Za-z0-9_-]{8}\.js)["'`]/g;
    let checked = 0;
    for (const f of files) {
      const body = readFileSync(join(jsDir, f), 'utf8');
      for (const m of body.matchAll(chunkPattern)) {
        checked++;
        if (!files.has(m[1])) {
          err(`${f} 内部引用了不存在的 chunk: ${m[1]} —— 该功能被打开时才会白屏 (功能缺失)`);
        }
      }
    }
    ok(`chunk 闭合检查: ${files.size} 个产物文件 / ${checked} 条内部引用`);
  }
}

// ── E4: 品牌资源引用一致性 (favicon 这类"开发有、打包丢"的常客) ────────
{
  const iconRefs = (html) => [...html.matchAll(/href="(\/[^"]*favicon[^"]*)"/gi)].map((m) => m[1]);
  const srcIcons = iconRefs(srcHtml);
  const distIcons = iconRefs(distHtml);
  for (const ref of srcIcons) {
    if (!distIcons.includes(ref)) {
      warn(`源码引用了 favicon ${ref}, 但产物 index.html 里没有 —— 检查构建配置`);
    }
  }
  for (const ref of new Set(distIcons)) {
    const abs = join(DIST_DIR, ref.replace(/^\//, ''));
    if (!existsSync(abs)) err(`产物引用的 favicon 文件不存在: ${ref} → ${abs}`);
  }
  if (distIcons.length) ok(`favicon 引用与文件均存在: ${[...new Set(distIcons)].join(', ')}`);
}

// ── W1: 陈旧告警 (src 比 dist 新) ──────────────────────────────────────
{
  try {
    const srcM = statSync(SRC_HTML).mtime;
    const distM = statSync(DIST_HTML).mtime;
    if (srcM > distM) {
      warn(
        `dist/index.html (${distM.toISOString()}) 比 src/index.html (${srcM.toISOString()}) 旧 ` +
        `—— 产物可能是陈旧的`
      );
    } else {
      ok(`产物不比源码旧 (dist ${distM.toISOString()})`);
    }
  } catch { /* mtime 不可用则跳过 */ }
}

// ── W2: 孤儿 index-*.js 报告 (合法情形: 名为 index 的懒加载 chunk) ─────
{
  const jsDir = join(DIST_DIR, 'assets', 'js');
  if (existsSync(jsDir)) {
    const referenced = new Set(
      [...distHtml.matchAll(/\/assets\/js\/([A-Za-z0-9._-]+\.js)/g)].map((m) => m[1])
    );
    const orphans = readdirSync(jsDir)
      .filter((f) => /^index-.*\.js$/.test(f) && !referenced.has(f));
    if (orphans.length) {
      warn(
        `存在 ${orphans.length} 个未被 index.html 引用的 index-*.js: ${orphans.join(', ')}\n` +
        `      (合法 —— 名为 index 的模块会产出同名 chunk; 但**不要按文件名删除它们**,` +
        ` 详见 build-for-desktop.mjs 的同段注释)`
      );
    }
  }
}

report();

// ─────────────────────────────────────────────────────────────────────
function report() {
  console.log('[verify-web-build] GUI 构建产物一致性门');
  console.log(`  产物目录: ${DIST_DIR}`);
  for (const m of pass) console.log(`  ✅ ${m}`);
  for (const m of warns) console.log(`  ⚠️  ${m}`);
  for (const m of errors) console.log(`  ❌ ${m}`);
  if (errors.length) {
    console.log(`\n[verify-web-build] 失败: ${errors.length} 个 ERROR / ${warns.length} 个 WARN`);
    process.exit(1);
  }
  console.log(`\n[verify-web-build] 通过 (${pass.length} 项 / ${warns.length} 个 WARN)`);
  process.exit(0);
}
