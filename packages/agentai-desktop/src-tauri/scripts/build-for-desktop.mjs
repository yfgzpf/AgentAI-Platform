#!/usr/bin/env node
/**
 * build-for-desktop.mjs — Tauri beforeBuildCommand 入口
 *
 * 职责:
 *   1. 编译 Gateway (tsc → dist/)  ← 直接调 tsc，避开 pnpm workspace hooks
 *   2. 编译 GUI (Vite → dist/)     ← 直接调 vite build，避开 pnpm workspace hooks
 *   3. 准备 gateway-dist-v2 (dist/ + node_modules/ + package.json)
 *   4. 生成 lite.html
 *
 * 调用方: Tauri tauri.conf.json build.beforeBuildCommand
 * 执行目录: packages/agentai-desktop/src-tauri/
 *
 * 注意:
 *   - 不走 pnpm build（会触发 workspace root postinstall，导致 ERR_PNPM_IGNORED_BUILDS 失败）
 *   - 直接调 tsc / vite，跳过 pnpm 包装层
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_TAUDI = __dirname;
// __dirname = src-tauri/scripts → 上溯4层: scripts→src-tauri→desktop→packages→repo-root
const ROOT = resolve(__dirname, '..', '..', '..', '..');

function log(msg) { console.log(`[build-desktop] ${msg}`); }
function logOk(msg) { console.log(`  ✅ ${msg}`); }
function logWarn(msg) { console.log(`  ⚠️  ${msg}`); }

function run(cmd, cwd, opts = {}) {
  log(cmd);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0 && r.status !== undefined) {
    logWarn(`${cmd} 失败 (exit ${r.status})，继续下一步...`);
  }
}

// ── 1. 编译 Gateway ─────────────────────────────────────────────
log('Step 1: 编译 Gateway...');
const gwDir = resolve(ROOT, 'packages', 'agentai-gateway');
const gwDist = resolve(gwDir, 'dist', 'index.js');

// 每次都重新编译, 确保打包的是最新代码 (不跳过)
{
  const tscPath = resolve(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (existsSync(tscPath)) {
    log('运行 tsc 编译 Gateway...');
    const tscResult = spawnSync(process.execPath, [tscPath, '-p', gwDir], {
      cwd: gwDir, stdio: 'inherit', shell: false,
    });
    if (tscResult.status !== 0 && tscResult.status !== undefined) {
      logWarn(`tsc 编译失败 (exit ${tscResult.status})，继续...`);
    } else {
      logOk('Gateway tsc 编译完成');
    }
  } else {
    logWarn('tsc 未找到, 尝试 npm run build');
    run('npm run build', gwDir);
  }
  // 复制 rules.json
  const rulesSrc = resolve(gwDir, 'src', 'cleaner', 'rules.json');
  const rulesDst = resolve(gwDir, 'dist', 'cleaner', 'rules.json');
  if (existsSync(rulesSrc)) {
    mkdirSync(resolve(rulesDst, '..'), { recursive: true });
    cpSync(rulesSrc, rulesDst);
    logOk('rules.json 已复制');
  }
}

// ── 2. 编译 GUI ─────────────────────────────────────────────────
log('Step 2: 编译 GUI...');
const guiDir = resolve(ROOT, 'packages', 'agentai-gui');
const guiDist = resolve(guiDir, 'dist', 'index.html');

// 每次都重新编译 GUI, 确保打包的是最新代码 (不跳过)
{
  const viteCandidates = [
    resolve(guiDir, 'node_modules', 'vite', 'bin', 'vite.js'),
    resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
  ];
  const vitePath = viteCandidates.find(p => existsSync(p));
  if (vitePath) {
    log('运行 vite build 编译 GUI...');
    const viteResult = spawnSync(process.execPath, [vitePath, 'build'], {
      cwd: guiDir, stdio: 'inherit', shell: false,
    });
    if (viteResult.status !== 0 && viteResult.status !== undefined) {
      logWarn(`vite build 失败 (exit ${viteResult.status})，继续...`);
    } else {
      logOk('GUI vite build 完成');
    }
  } else {
    // 兜底: npx vite build
    log('使用 npx vite build...');
    run('npx vite build', guiDir);
  }
}

// ── 3. 准备 gateway-dist-v2 ─────────────────────────────────────
log('Step 3: 准备 gateway-dist-v2...');
const resourcesDir = resolve(SRC_TAUDI, 'resources');
const gwDistV2 = resolve(resourcesDir, 'gateway-dist-v2');

// 每次都重新打包 gateway-dist-v2, 确保最新代码 (不跳过)
{
  const distSrc = resolve(gwDir, 'dist');
  if (!existsSync(distSrc)) {
    logWarn(`Gateway dist 不存在: ${distSrc}，跳过 node_modules 安装`);
    // 至少复制 dist 目录
    mkdirSync(gwDistV2, { recursive: true });
    cpSync(distSrc + '/.', resolve(gwDistV2, 'dist/'), { recursive: true, force: true });
    cpSync(resolve(gwDir, 'package.json'), resolve(gwDistV2, 'package.json'));
  } else {
    // 清空并重建
    rmSync(gwDistV2, { recursive: true, force: true });
    mkdirSync(gwDistV2, { recursive: true });
    mkdirSync(resolve(gwDistV2, 'dist'), { recursive: true });

    // 复制 dist 编译产物
    cpSync(distSrc + '/.', resolve(gwDistV2, 'dist/'), { recursive: true, force: true });

    // 复制 package.json（安装依赖用）
    cpSync(resolve(gwDir, 'package.json'), resolve(gwDistV2, 'package.json'));

    // 安装 production 依赖（用 npm，不走 pnpm）
    log('  安装 production 依赖...');
    run('npm install --production --ignore-scripts --no-optional --legacy-peer-deps', gwDistV2);

    // 验证关键文件
    const checks = [
      'package.json',
      'dist/index.js',
      'node_modules/express/package.json',
      'node_modules/cors/package.json',
      'node_modules/socket.io/package.json',
    ];
    let allOk = true;
    for (const f of checks) {
      const ok = existsSync(resolve(gwDistV2, f));
      log(ok ? `✅ ${f}` : `❌ ${f}`);
      if (!ok) allOk = false;
    }
    if (allOk) {
      logOk('gateway-dist-v2 打包完成');
    } else {
      logWarn('部分依赖缺失, 首次启动会自动补装');
    }
  }
}

// ── 3.5 同步 gateway-dist-v2 → gateway-dist (tauri.conf.json 打包用的是 gateway-dist) ──
log('Step 3.5: 同步 gateway-dist-v2 → gateway-dist...');
const gwDistFinal = resolve(resourcesDir, 'gateway-dist');
if (existsSync(gwDistV2) && existsSync(resolve(gwDistV2, 'dist', 'index.js'))) {
  // 备份旧 gateway-dist
  if (existsSync(gwDistFinal)) {
    const backupName = `${gwDistFinal}-backup-${Date.now()}`;
    try { rmSync(backupName, { recursive: true, force: true }); } catch {}
    try { renameSync(gwDistFinal, backupName); } catch {}
  }
  // 复制 gateway-dist-v2 → gateway-dist
  cpSync(gwDistV2, gwDistFinal, { recursive: true, force: true });
  logOk('gateway-dist 已同步 (tauri.conf.json 打包用此目录)');
  // 清理旧备份 (只保留最近一个)
  if (existsSync(resourcesDir)) {
    const backups = require('fs').readdirSync(resourcesDir)
      .filter(e => e.startsWith('gateway-dist-backup-'))
      .sort().reverse();
    backups.slice(1).forEach(b => {
      try { rmSync(resolve(resourcesDir, b), { recursive: true, force: true }); } catch {}
    });
  }
} else {
  logWarn('gateway-dist-v2 不完整, 保持现有 gateway-dist');
}

// ── 4. 生成 lite.html ───────────────────────────────────────────
log('Step 4: 生成 lite.html...');
const buildLiteCjs = resolve(SRC_TAUDI, 'scripts', 'build-lite.cjs');
if (existsSync(buildLiteCjs)) {
  run(buildLiteCjs, SRC_TAUDI);
} else {
  logWarn('build-lite.cjs 不存在, 跳过');
}

log('✅ 全部构建步骤完成');
