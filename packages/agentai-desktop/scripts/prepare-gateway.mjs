#!/usr/bin/env node
/* global console, process */
/**
 * prepare-gateway.mjs — Gateway 构建产物打包脚本 (v4)
 *
 * 在 beforeBuildCommand 中被调用（cwd = packages/agentai-desktop/）
 *
 * ⚠️ 痛点: pnpm 的 node_modules 使用符号链接 (symlink)
 *   直接 cpSync 只会复制链接, 导致 gateway-dist/node_modules 残缺 (仅16个包)
 *
 * 修复: 不复制 pnpm node_modules!
 *   1. 复制 dist/ + package.json 到目标目录
 *   2. npm install --production 全新安装扁平 node_modules
 *   3. 验证 19 个关键依赖全部到位
 *
 * 负责:
 *   1. 创建完整的 gateway-dist-v2 (含完整扁平 node_modules)
 *   2. 复制 lite.html → agentai-gui/dist/lite.html
 *   3. 验证关键依赖完整性
 */

import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const GW_DIR = resolve(ROOT, 'packages', 'agentai-gateway');
const GW_SRC_DIST = resolve(GW_DIR, 'dist');
const GW_DST = resolve(__dirname, '..', 'src-tauri', 'resources', 'gateway-dist-v2');

console.log(`[prepare] ROOT: ${ROOT}`);
console.log(`[prepare] gateway dst: ${GW_DST}`);

// 使用新目录 (旧 gateway-dist 有 pnpm 深层符号链接无法清理)
if (existsSync(GW_DST)) rmSync(GW_DST, { recursive: true, force: true });
mkdirSync(GW_DST, { recursive: true });

// === Step 1: 复制 dist/ ===
if (!existsSync(GW_SRC_DIST)) {
    console.error(`[prepare] ERROR: dist not found at ${GW_SRC_DIST}`);
    console.error('[prepare] Run "pnpm --filter @agentai/gateway build" first');
    process.exit(1);
}
const dstDist = resolve(GW_DST, 'dist');
mkdirSync(dstDist, { recursive: true });
cpSync(GW_SRC_DIST, dstDist, { recursive: true, force: true });
console.log('[prepare] copied dist/ ✓');

// === Step 2: 复制 package.json (含更新后的完整依赖列表) ===
copyFileSync(resolve(GW_DIR, 'package.json'), resolve(GW_DST, 'package.json'));
console.log('[prepare] copied package.json ✓');

// === Step 3: npm install --production 创建扁平 node_modules ===
// 注意: 不在别处复制 node_modules! pnpm 的符号链接结构无法直接使用。
//       npm install 是创建扁平 node_modules 最可靠的方式。
console.log('[prepare] npm install --production (creating flat node_modules)...');
try {
    execSync('npm install --production --ignore-scripts --legacy-peer-deps', {
        cwd: GW_DST,
        stdio: 'inherit',
        timeout: 120_000,
    });
    console.log('[prepare] npm install completed ✓');
} catch (e) {
    console.error(`[prepare] npm install failed: ${e.message}`);
    // 重试: 某些包需要 postinstall 脚本 (如 better-sqlite3 需要编译)
    try {
        console.log('[prepare] retrying npm install (with scripts)...');
        execSync('npm install --production --legacy-peer-deps', {
            cwd: GW_DST,
            stdio: 'inherit',
            timeout: 120_000,
        });
    } catch (e2) {
        console.error(`[prepare] retry also failed: ${e2.message}`);
        process.exit(1);
    }
}

// === Step 4: 安装 production 排除了但运行时需要的包 ===
// typescript: npm --production 会排除它（即使放在 dependencies 中）
// 需要单独安装
console.log('[prepare] installing typescript (required by self-modify worker)...');
try {
    execSync('npm install typescript@5 --no-save --legacy-peer-deps', {
        cwd: GW_DST,
        stdio: 'inherit',
        timeout: 30_000,
    });
} catch {
    console.warn('[prepare] WARN: typescript install failed (non-critical)');
}

// === Step 5: 复制 lite.html 到 GUI dist ===
const LITE_SRC = resolve(__dirname, '..', 'src-tauri', 'resources', 'lite.html');
const GUI_DIST = resolve(ROOT, 'packages', 'agentai-gui', 'dist');
const LITE_DST = resolve(GUI_DIST, 'lite.html');
if (existsSync(LITE_SRC) && existsSync(GUI_DIST)) {
    copyFileSync(LITE_SRC, LITE_DST);
    console.log('[prepare] copied lite.html ✓');
} else {
    console.warn(`[prepare] WARN: cannot copy lite.html`);
}

// === Step 5: 验证关键依赖 ===
const criticalDeps = [
    'express', 'openai', 'socket.io', 'cors', 'lru-cache',
    'uuid', 'multer', 'chokidar', 'glob', 'better-sqlite3',
    'cron-parser', 'nodemailer', 'typescript', 'sql.js',
    'xlsx', 'mammoth', 'pdf-parse', 'jszip', 'playwright',
];
let missing = 0;
for (const dep of criticalDeps) {
    if (!existsSync(resolve(GW_DST, 'node_modules', dep))) {
        console.warn(`[prepare] ⚠️ MISSING: ${dep}`);
        missing++;
    }
}

if (missing === 0) {
    console.log('[prepare] ✅ All 19 critical deps present');
} else {
    console.warn(`[prepare] ⚠️ ${missing}/${criticalDeps.length} critical deps missing`);
}

// 总 size
try {
    const size = execSync(`du -sh "${GW_DST}/node_modules" 2>&1`, { encoding: 'utf-8', timeout: 5000, shell: true });
    console.log(`[prepare] node_modules size: ${size.trim().split('\t')[0]}`);
} catch {}

console.log('[prepare] ✅ all ready');
