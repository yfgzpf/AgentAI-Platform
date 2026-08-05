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

if (existsSync(gwDist)) {
  logOk('Gateway dist 已存在, 跳过编译');
} else {
  // 直接调 tsc（不走 pnpm build，避免触发 workspace root postinstall）
  const tscPath = resolve(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (existsSync(tscPath)) {
    // tsc 失败不影响后续（build.mjs 会 copy 资源文件并 exit 1）
    spawnSync(process.execPath, [tscPath, '-p', gwDir], {
      cwd: gwDir, stdio: 'inherit', shell: false,
    });
  } else {
    logWarn('tsc 未找到, 跳过编译');
  }
  // 复制 rules.json（build.mjs 中的 copy 步骤）
  const rulesSrc = resolve(gwDir, 'src', 'cleaner', 'rules.json');
  const rulesDst = resolve(gwDir, 'dist', 'cleaner', 'rules.json');
  if (existsSync(rulesSrc)) {
    mkdirSync(resolve(rulesDst, '..'), { recursive: true });
    cpSync(rulesSrc, rulesDst);
  }
}

// ── 2. 编译 GUI ─────────────────────────────────────────────────
log('Step 2: 编译 GUI...');
const guiDir = resolve(ROOT, 'packages', 'agentai-gui');
const guiDist = resolve(guiDir, 'dist', 'index.html');

if (existsSync(guiDist)) {
  logOk('GUI dist 已存在, 跳过编译');
} else {
  // 直接调 vite build（不走 pnpm build）
  const vitePath = resolve(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(vitePath)) {
    spawnSync(process.execPath, [vitePath, 'build'], {
      cwd: guiDir, stdio: 'inherit', shell: false,
    });
  } else {
    // 兜底: npx vite build
    run('npx vite build', guiDir);
  }
}

// ── 3. 准备 gateway-dist-v2 ─────────────────────────────────────
log('Step 3: 准备 gateway-dist-v2...');
const resourcesDir = resolve(SRC_TAUDI, 'resources');
const gwDistV2 = resolve(resourcesDir, 'gateway-dist-v2');

if (existsSync(resolve(gwDistV2, 'node_modules', 'express', 'package.json'))) {
  logOk('gateway-dist-v2 已完整, 跳过打包');
} else {
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

// ── 4. 生成 lite.html ───────────────────────────────────────────
log('Step 4: 生成 lite.html...');
const buildLiteCjs = resolve(SRC_TAUDI, 'scripts', 'build-lite.cjs');
if (existsSync(buildLiteCjs)) {
  run(buildLiteCjs, SRC_TAUDI);
} else {
  logWarn('build-lite.cjs 不存在, 跳过');
}

log('✅ 全部构建步骤完成');
