#!/usr/bin/env node
/**
 * build-for-desktop.mjs — 转发入口
 *
 * 实际构建逻辑在 src-tauri/scripts/build-for-desktop.mjs
 * (tauri.conf.json beforeBuildCommand 执行目录是 src-tauri/)
 *
 * 此文件保留兼容性, 如直接从 desktop 包根目录调用。
 */
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const realScript = resolve(__dirname, '..', 'src-tauri', 'scripts', 'build-for-desktop.mjs');

const r = spawnSync('node', [realScript], { stdio: 'inherit', cwd: resolve(__dirname, '..', 'src-tauri') });
process.exit(r.status ?? 1);
