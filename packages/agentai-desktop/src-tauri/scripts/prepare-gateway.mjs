#!/usr/bin/env node
/**
 * prepare-gateway.mjs — Gateway 构建产物打包脚本 (完整版)
 *
 * 策略：
 *   1. 复制 gateway/dist 代码
 *   2. 复制 gateway/node_modules (生产依赖, 避免首次启动 npm install)
 *   3. 复制 package.json 和 .env
 *   4. 打包体积较大但启动可靠
 */

import { cpSync, existsSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_TARO = resolve(__dirname, '..');
const ROOT = resolve(SRC_TARO, '..', '..', '..');
const GW_SRC = resolve(ROOT, 'packages', 'agentai-gateway', 'dist');
const GW_NM  = resolve(ROOT, 'packages', 'agentai-gateway', 'node_modules');
const GW_DST = resolve(SRC_TARO, 'resources', 'gateway-dist');

console.log(`[prepare] src dist: ${GW_SRC}`);
console.log(`[prepare] src node_modules: ${GW_NM}`);
console.log(`[prepare] dst: ${GW_DST}`);

// 1. 确保源 dist 存在
if (!existsSync(GW_SRC)) {
    console.error(`[prepare] ERROR: source dist not found: ${GW_SRC}`);
    process.exit(1);
}

// 使用时间戳创建新目录，避免删除问题
const timestamp = Date.now();
const GW_DST_NEW = `${GW_DST}-${timestamp}`;
mkdirSync(GW_DST_NEW, { recursive: true });
console.log(`[prepare] using temp dir: ${GW_DST_NEW}`);

// 2. 复制代码文件（不含 node_modules）
console.log('[prepare] copying gateway source files...');
cpSync(GW_SRC, GW_DST_NEW, { recursive: true, force: true, filter: (src) => {
    return !src.includes('node_modules');
}});
console.log(`[prepare] copied source files`);

// 3. 复制 node_modules (如果存在)
if (existsSync(GW_NM)) {
    console.log('[prepare] copying node_modules...');
    const nmDst = resolve(GW_DST_NEW, 'node_modules');
    try {
        // 使用 recursive copy，不排除任何内容
        cpSync(GW_NM, nmDst, { recursive: true, force: true });
        console.log('[prepare] ✅ node_modules copied');
    } catch (e) {
        console.warn(`[prepare] ⚠️ node_modules copy failed: ${e.message}`);
        console.warn('[prepare] Gateway will attempt npm install on first startup');
    }
} else {
    console.warn('[prepare] ⚠️ node_modules not found, gateway will npm install on first startup');
}

// 4. 复制 package.json（用于 npm install fallback）
const pkgSrc = resolve(ROOT, 'packages', 'agentai-gateway', 'package.json');
if (existsSync(pkgSrc)) {
    copyFileSync(pkgSrc, resolve(GW_DST_NEW, 'package.json'));
    console.log('[prepare] copied package.json');
}

// 5. 复制 .env 文件
const envSrc = resolve(ROOT, '.env');
if (existsSync(envSrc)) {
    copyFileSync(envSrc, resolve(GW_DST_NEW, '.env'));
    console.log('[prepare] copied .env');
}

// 6. 清理旧备份目录 (只保留最近一个)
const backupDir = resolve(SRC_TARO, 'resources');
if (existsSync(backupDir)) {
    const entries = require('fs').readdirSync(backupDir);
    const oldBackups = entries
        .filter(e => e.startsWith('gateway-dist-backup-'))
        .map(e => ({ name: e, path: resolve(backupDir, e) }))
        .sort((a, b) => b.name.localeCompare(a.name));
    // 删除除最新备份外的所有旧备份
    oldBackups.slice(1).forEach(b => {
        console.log(`[prepare] cleaning old backup: ${b.name}`);
        try { rmSync(b.path, { recursive: true, force: true }); } catch {}
    });
}

// 7. 重命名为最终目录
if (existsSync(GW_DST)) {
    const backupName = `${GW_DST}-backup-${timestamp}`;
    renameSync(GW_DST, backupName);
    console.log(`[prepare] old gateway-dist renamed to ${backupName}`);
}
renameSync(GW_DST_NEW, GW_DST);
console.log(`[prepare] renamed ${GW_DST_NEW} to ${GW_DST}`);

console.log('[prepare] ✅ gateway-dist ready (with node_modules)');
