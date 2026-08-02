#!/usr/bin/env node
/**
 * verify-build.mjs — 打包后验证脚本
 * 确保所有必要文件都在安装包内，用户拿到就能用
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const DESKTOP_DIR = resolve(process.cwd());
const GW_DIST = resolve(DESKTOP_DIR, 'src-tauri', 'resources', 'gateway-dist-v2');

console.log('=== 打包后验证 ===\n');

let errors = 0;
let warnings = 0;

function check(path, required = true) {
  const exists = existsSync(path);
  const status = exists ? '✅' : required ? '❌' : '⚠️';
  const label = required ? '必须' : '可选';
  console.log(`${status} [${label}] ${path}`);
  if (!exists && required) errors++;
  if (!exists && !required) warnings++;
  return exists;
}

function checkSize(path, minSizeMB = 0) {
  if (!existsSync(path)) return false;
  const stats = statSync(path);
  const sizeMB = stats.size / 1024 / 1024;
  if (sizeMB < minSizeMB) {
    console.log(`   ⚠️ 文件过小: ${sizeMB.toFixed(2)}MB (期望 > ${minSizeMB}MB)`);
    warnings++;
    return false;
  }
  console.log(`   📦 大小: ${sizeMB.toFixed(2)}MB`);
  return true;
}

// 1. 检查 Gateway 编译输出
check(resolve(GW_DIST, 'dist', 'index.js'));
check(resolve(GW_DIST, 'dist', 'app.js'));

// 2. 检查 package.json
check(resolve(GW_DIST, 'package.json'));

// 3. 检查 node_modules 关键依赖
console.log('\n--- 核心依赖 ---');
const criticalDeps = [
  'express', 'openai', 'socket.io', 'cors', 'lru-cache', 'uuid',
  'chokidar', 'pino', 'playwright', 'better-sqlite3',
  'pdf-parse', 'xlsx', 'nodemailer', 'mammoth', 'jszip',
  'typescript', 'multer', 'glob', 'cron-parser', 'sql.js',
];
for (const dep of criticalDeps) {
  check(resolve(GW_DIST, 'node_modules', dep));
}

// 4. 检查 Playwright Chromium
console.log('\n--- Playwright Chromium ---');
const hasPlaywright = check(resolve(GW_DIST, 'node_modules', 'playwright'));
if (hasPlaywright) {
  const chromiumDir = resolve(GW_DIST, 'ms-playwright');
  if (check(chromiumDir, false)) {
    const entries = readdirSync(chromiumDir);
    const chromiumVersions = entries.filter(e => e.startsWith('chromium-') || e.startsWith('chromium_headless_shell-'));
    console.log(`   📦 找到 ${chromiumVersions.length} 个 Chromium 版本: ${chromiumVersions.join(', ')}`);
    if (chromiumVersions.length === 0) {
      console.log('   ❌ 未找到 Chromium 可执行文件');
      errors++;
    }
  } else {
    console.log('   ⚠️ 将使用系统 Edge/Chrome 作为降级方案');
    warnings++;
  }
}

// 5. 检查 better-sqlite3 原生模块
console.log('\n--- 原生模块 ---');
// better-sqlite3 原生模块可以在 node_modules 或 build/Release 中
const sqliteInNodeModules = existsSync(resolve(GW_DIST, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'));
const sqliteInBuild = existsSync(resolve(GW_DIST, 'build', 'Release', 'better_sqlite3.node'));
if (sqliteInNodeModules) {
  console.log('✅ [必须]', resolve(GW_DIST, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'));
} else if (sqliteInBuild) {
  console.log('✅ [必须]', resolve(GW_DIST, 'build', 'Release', 'better_sqlite3.node'));
} else {
  console.log('❌ [必须] better_sqlite3.node not found in node_modules or build/Release');
  errors++;
}

// 6. 检查前端构建输出
console.log('\n--- 前端构建 ---');
const GUI_DIST = resolve(DESKTOP_DIR, '..', 'agentai-gui', 'dist');
check(resolve(GUI_DIST, 'index.html'));
check(resolve(GUI_DIST, 'lite.html'), false);
checkSize(resolve(GUI_DIST, 'index.html'), 0.001);

// 7. 检查 Tauri 资源目录
console.log('\n--- Tauri 资源 ---');
check(resolve(DESKTOP_DIR, 'src-tauri', 'resources', 'gateway-dist-v2'));
check(resolve(DESKTOP_DIR, 'src-tauri', 'icons', 'icon.png'));

// 8. 估算安装包大小
console.log('\n--- 安装包大小估算 ---');
function getDirSize(dir) {
  if (!existsSync(dir)) return 0;
  let size = 0;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(path);
    } else {
      size += statSync(path).size;
    }
  }
  return size;
}

const gwSize = getDirSize(GW_DIST) / 1024 / 1024;
const guiSize = getDirSize(GUI_DIST) / 1024 / 1024;
console.log(`   Gateway: ${gwSize.toFixed(1)} MB`);
console.log(`   GUI: ${guiSize.toFixed(1)} MB`);
console.log(`   总计: ${(gwSize + guiSize).toFixed(1)} MB`);
console.log(`   预计安装包: ${(gwSize + guiSize + 50).toFixed(1)} MB (含 Tauri 运行时)`);

// 总结
console.log('\n=== 验证结果 ===');
if (errors === 0 && warnings === 0) {
  console.log('✅ 所有检查通过，安装包完整！');
  process.exit(0);
} else if (errors === 0) {
  console.log(`⚠️ 有 ${warnings} 个警告，但核心功能完整`);
  process.exit(0);
} else {
  console.log(`❌ 有 ${errors} 个错误，${warnings} 个警告，需要修复`);
  process.exit(1);
}
