#!/usr/bin/env node
/**
 * build-for-desktop.mjs — 桌面版构建脚本 (统一入口)
 * 
 * 替代 tauri.conf.json 中复杂的 beforeBuildCommand 链式命令,
 * 解决 Windows 上 cd && 链失效和 tsc 在 @ts-nocheck 文件中报错的问题。
 * 
 * 用法: node scripts/build-for-desktop.mjs
 * 调用方: tauri.conf.json → beforeBuildCommand
 */
import { execSync } from 'node:child_process';
import { existsSync, cpSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const GW_DIR = resolve(ROOT, 'packages', 'agentai-gateway');
const GUI_DIR = resolve(ROOT, 'packages', 'agentai-gui');
const DESKTOP_DIR = resolve(__dirname, '..');

console.log('=== build-for-desktop ===');
console.log(`ROOT: ${ROOT}`);

// Step 1: 构建 Gateway
console.log('\n[1/4] Building Gateway...');
execSync('pnpm --filter @agentai/gateway build', { cwd: ROOT, stdio: 'inherit', timeout: 120_000 });
console.log('[1/4] Gateway built ✓');

// Step 2: 构建 GUI (跳过 tsc, vite build 已编译 TS)
console.log('\n[2/4] Building GUI...');
try {
  // 优先查找 GUI 自己的 node_modules (pnpm workspace 链接)
  const viteCandidates = [
    resolve(GUI_DIR, 'node_modules', 'vite', 'bin', 'vite.js'),
    resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  let vitePath = viteCandidates.find(p => existsSync(p));
  if (vitePath) {
    execSync(`node "${vitePath}" build`, { cwd: GUI_DIR, stdio: 'inherit', timeout: 120_000 });
  } else {
    // fallback: npx vite build
    execSync('npx vite build', { cwd: GUI_DIR, stdio: 'inherit', timeout: 120_000 });
  }
} catch (e) {
  console.warn('[2/4] vite build via node failed, trying npx fallback:', e.message);
  execSync('npx vite build', { cwd: GUI_DIR, stdio: 'inherit', timeout: 120_000 });
}
console.log('[2/4] GUI built ✓');

// Step 3: 准备 Gateway 运行时依赖
console.log('\n[3/4] Preparing Gateway runtime...');
const GW_DST = resolve(DESKTOP_DIR, 'src-tauri', 'resources', 'gateway-dist');
if (existsSync(GW_DST)) rmSync(GW_DST, { recursive: true, force: true });
mkdirSync(GW_DST, { recursive: true });

// 复制 dist/ 到 gateway-dist/dist/
// ⚠️ 重要：不复制 dist/index.js 到根目录！
// index.js 中的 import 路径是 ./app.js（相对当前目录），如果复制到根目录，
// Node.js 会从 gateway-dist/ 解析 ./app.js，但 app.js 只在 dist/app.js 存在。
const dstDist = resolve(GW_DST, 'dist');
mkdirSync(dstDist, { recursive: true });
cpSync(resolve(GW_DIR, 'dist'), dstDist, { recursive: true, force: true });
// 不复制 index.js 到根目录，避免 Rust 端优先选择错误的入口
// if (existsSync(resolve(GW_DIR, 'dist', 'index.js'))) {
//   copyFileSync(resolve(GW_DIR, 'dist', 'index.js'), resolve(GW_DST, 'index.js'));
// }

// 复制 package.json
copyFileSync(resolve(GW_DIR, 'package.json'), resolve(GW_DST, 'package.json'));

// npm install (完整安装所有依赖，包括 optional，确保离线可用)
console.log('[3/4] npm install (完整依赖, flat node_modules)...');
try {
  execSync('npm install --ignore-scripts --legacy-peer-deps', {
    cwd: GW_DST, stdio: 'inherit', timeout: 300_000,
  });
} catch (e) {
  console.warn('[3/4] npm install with --ignore-scripts failed, retrying with scripts:', e.message);
  try {
    execSync('npm install --legacy-peer-deps', {
      cwd: GW_DST, stdio: 'inherit', timeout: 300_000,
    });
  } catch (e2) {
    console.error('[3/4] npm install failed:', e2.message);
    process.exit(1);
  }
}

// 安装 Playwright Chromium (浏览器自动化核心能力，必须成功)
// 在 CI 环境中跳过，避免超时或网络问题
const isCI = process.env.CI === 'true';
console.log(`[3/4] CI environment: ${isCI}`);
if (!isCI) {
  console.log('[3/4] Installing Playwright Chromium...');
  try {
    execSync('npx playwright install chromium', {
      cwd: GW_DST, stdio: 'inherit', timeout: 300_000,
    });
    console.log('[3/4] Playwright Chromium installed ✓');
  } catch (e) {
    console.error('[3/4] Playwright Chromium install failed:', e.message);
    console.error('浏览器自动化功能将无法使用，构建中止');
    process.exit(1);
  }
} else {
  console.log('[3/4] Skipping Playwright install in CI (will auto-install on first run)');
}

// 注意：Playwright Chromium 不打包到安装包中（文件太大，~4GB）
// 改为在应用首次启动时自动下载安装
// 这样可以保持安装包在合理大小 (~200MB)
console.log('[3/4] Skipping Chromium copy (will auto-install on first run)');

// 复制 lite.html
const liteSrc = resolve(DESKTOP_DIR, 'src-tauri', 'resources', 'lite.html');
const guiDist = resolve(GUI_DIR, 'dist');
if (existsSync(liteSrc) && existsSync(guiDist)) {
  copyFileSync(liteSrc, resolve(guiDist, 'lite.html'));
}

// 复制 .env 文件
const envSrc = resolve(ROOT, '.env');
if (existsSync(envSrc)) {
  copyFileSync(envSrc, resolve(GW_DST, '.env'));
  console.log('[3/4] .env copied ✓');
}

// 复制 better-sqlite3 原生模块（确保离线可用）
console.log('[3/4] Copying native modules...');

// 查找 better-sqlite3 .node 文件的所有可能位置
const sqliteSearchPaths = [
  // flat node_modules (npm install 后的位置)
  resolve(GW_DST, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  // pnpm 源位置
  resolve(GW_DIR, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
  resolve(GW_DIR, 'node_modules', '.pnpm', 'better-sqlite3@11.10.0', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
];

let sqliteFound = false;
for (const src of sqliteSearchPaths) {
  if (existsSync(src)) {
    const target = resolve(GW_DST, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
    console.log(`[3/4] better-sqlite3 native module copied from ${src} ✓`);
    sqliteFound = true;
    break;
  }
}
if (!sqliteFound) {
  console.warn('[3/4] better-sqlite3 native module not found in any search path, will use sql.js fallback');
  console.warn('[3/4] Searched paths:', sqliteSearchPaths.map(p => '  ' + p).join('\n'));
}

console.log('[3/4] ✓');

// Step 4: 验证关键依赖
console.log('\n[4/4] Verifying runtime dependencies...');
const criticalDeps = [
  // 核心框架
  'express', 'openai', 'socket.io', 'cors', 'lru-cache', 'uuid',
  'chokidar', 'pino', 'playwright', 'better-sqlite3',
  // 文件解析（用户拿到安装包就能用，无需额外安装）
  'pdf-parse', 'xlsx', 'nodemailer', 'mammoth', 'jszip',
  // 其他必要依赖
  'typescript', 'multer', 'glob', 'cron-parser', 'sql.js',
];
let missing = 0;
for (const dep of criticalDeps) {
  if (!existsSync(resolve(GW_DST, 'node_modules', dep))) {
    console.warn(`  ⚠️ MISSING: ${dep}`);
    missing++;
  }
}
if (missing === 0) {
  console.log('[4/4] ✅ All critical deps present');
} else {
  console.warn(`[4/4] ⚠️ ${missing}/${criticalDeps.length} critical deps missing (non-fatal)`);
}

console.log('\n=== ✅ build-for-desktop complete ===');
