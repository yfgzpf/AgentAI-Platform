#!/usr/bin/env node
/**
 * prepare-gateway.mjs — Gateway 构建产物打包脚本 (轻量版)
 *
 * 策略：
 *   1. 只复制 gateway/dist 代码（不含 node_modules）
 *   2. 打包时体积小
 *   3. 首次启动时自动运行 npm install
 */

import { cpSync, existsSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_TARO = resolve(__dirname, '..');
const ROOT = resolve(SRC_TARO, '..', '..', '..');
const GW_SRC = resolve(ROOT, 'packages', 'agentai-gateway', 'dist');
const GW_DST = resolve(SRC_TARO, 'resources', 'gateway-dist');

console.log(`[prepare] src: ${GW_SRC}`);
console.log(`[prepare] dst: ${GW_DST}`);

// 1. 确保目标目录存在
if (!existsSync(GW_SRC)) {
    console.error(`[prepare] ERROR: source dist not found: ${GW_SRC}`);
    process.exit(1);
}

// 使用时间戳创建新目录，避免删除问题
const timestamp = Date.now();
const GW_DST_NEW = `${GW_DST}-${timestamp}`;
mkdirSync(GW_DST_NEW, { recursive: true });
console.log(`[prepare] using temp dir: ${GW_DST_NEW}`);

// 2. 只复制代码文件（不包含 node_modules）
console.log('[prepare] copying gateway source files...');

// 递归复制，但排除 node_modules
function copyDir(src, dst) {
    const entries = cpSync(src, dst, { recursive: true, force: true, filter: (src) => {
        return !src.includes('node_modules');
    }});
}

copyDir(GW_SRC, GW_DST_NEW);
console.log(`[prepare] copied source files to ${GW_DST_NEW}`);

// 3. 复制 package.json（用于 npm install）
const pkgSrc = resolve(ROOT, 'packages', 'agentai-gateway', 'package.json');
if (existsSync(pkgSrc)) {
    copyFileSync(pkgSrc, resolve(GW_DST_NEW, 'package.json'));
    console.log('[prepare] copied package.json');
}

// 4. 复制 .env 文件
const envSrc = resolve(ROOT, '.env');
if (existsSync(envSrc)) {
    copyFileSync(envSrc, resolve(GW_DST_NEW, '.env'));
    console.log('[prepare] copied .env');
}

// 5. 重命名为最终目录
if (existsSync(GW_DST)) {
    // 如果存在旧目录，重命名为备份
    const backupName = `${GW_DST}-backup-${timestamp}`;
    renameSync(GW_DST, backupName);
    console.log(`[prepare] old gateway-dist renamed to ${backupName}`);
}
renameSync(GW_DST_NEW, GW_DST);
console.log(`[prepare] renamed ${GW_DST_NEW} to ${GW_DST}`);

console.log('[prepare] ✅ gateway-dist ready (source only, no node_modules)');
console.log('[prepare] ⚠️  Note: npm install will run on first startup');
