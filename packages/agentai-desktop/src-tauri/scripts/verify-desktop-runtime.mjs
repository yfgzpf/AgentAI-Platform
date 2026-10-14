#!/usr/bin/env node
/**
 * verify-desktop-runtime.mjs — gateway 运行时资源一致性门 (2026-10-14)
 *
 * verify-web-build.mjs 只查 GUI dist。本脚本查**打包进安装包的 gateway 运行时
 * 资源** (resources/gateway-dist/), 堵住两类"与开发不一致 / 部分页面缺失"根因:
 *
 *   R1 入口缺失 — gateway-dist/ 没有 dist/index.js (gateway/package.json main =
 *      dist/index.js, lib.rs 候选全要求它) → 运行时 gateway 起不来 → 所有依赖
 *      gateway 的页面挂 (典型的"部分页面缺失")。
 *   R2 .env 漂移 — 开发态 gateway 读根 .env (35 key), 打包 bundle 的是过期副本 →
 *      模型/密钥与开发态不一致。本门只比 **key 名**(源 ⊆ bundle), 不打 value。
 *
 * 用法:
 *   node scripts/verify-desktop-runtime.mjs
 * 退出码: 0 = 通过 (可能 WARN); 1 = 有 ERROR (缺入口 / 缺 key 名)
 *
 * 调用方: build-for-desktop.mjs (GUI 一致性门之后 spawn)
 *
 * 诚实边界: 本门只防"漏"(入口/ key 名缺), 不验"值对不对" — 值错靠 gateway.log
 * 启动时的 401/tripped 排查。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts → src-tauri → agentai-desktop → packages → repo-root
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const SRC_TAURI = resolve(__dirname, '..');
// 运行时资源目录 (打包进安装包的 gateway 运行时)
const GW_DIST = resolve(SRC_TAURI, 'resources', 'gateway-dist');
const ROOT_ENV = join(ROOT, '.env');
const BUNDLE_ENV = join(GW_DIST, '.env');
const GATEWAY_SRC_DIST = join(ROOT, 'packages', 'agentai-gateway', 'dist', 'index.js');

const errors = [];
const warns = [];
const pass = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const ok = (m) => pass.push(m);

// ── 前置: gateway-dist 是否存在 ──────────────────────────────────────────
if (!existsSync(GW_DIST)) {
  err(`gateway-dist 资源目录不存在: ${GW_DIST} —— 打包前提不成立`);
  report();
}

// ── R1: gateway 入口 dist/index.js 必须存在 ─────────────────────────────
{
  const entry = join(GW_DIST, 'dist', 'index.js');
  if (!existsSync(entry)) {
    err(
      `R1 入口缺失 —— ${entry} 不存在\n` +
      `      gateway/package.json main = dist/index.js, lib.rs 候选全要求它。\n` +
      `      缺了它 = 安装包里 gateway 起不来 = 所有依赖 gateway 的页面挂 (部分页面缺失)。\n` +
      `      → 先编译 gateway: 跑 build-for-desktop.mjs 的 Step1 tsc, 或手动 tsc -p packages/agentai-gateway`,
    );
  } else {
    ok(`R1 入口存在: dist/index.js`);
  }
}

// ── 辅助: 读 .env 的 key 名集合 (只读 key 行, 不读 value) ──────────────
function readEnvKeys(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

// ── R2: .env key 名漂移 (源根 .env 的 key 必须都在 bundle .env 里) ──────
{
  const srcKeys = readEnvKeys(ROOT_ENV);
  if (srcKeys === null) {
    warn(`根 .env 不存在: ${ROOT_ENV} —— 跳过 R2 (无法比对 key 名)`);
  } else {
    const bundleKeys = readEnvKeys(BUNDLE_ENV);
    if (bundleKeys === null) {
      err(`R2 缺 bundle .env —— ${BUNDLE_ENV} 不存在 (源根 .env 有 ${srcKeys.size} 个 key, 打包态读不到)`);
    } else {
      const missing = [...srcKeys].filter((k) => !bundleKeys.has(k));
      if (missing.length > 0) {
        err(
          `R2 .env 漂移 —— 源根 .env 有 ${srcKeys.size} 个 key, bundle .env 缺 ${missing.length} 个:\n` +
          `      ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}\n` +
          `      (只比 key 名, 不碰 value) → 跑 build-for-desktop.mjs 会同步 key 名; 值由用户/CI 注入`,
        );
      } else {
        ok(`R2 .env key 名齐全: 源 ${srcKeys.size} 个 key 都在 bundle 里 (值可能需用户/CI 注入)`);
      }
    }
  }
}

// ── R3: 陈旧告警 (源 gateway dist 比 bundle 新) ────────────────────────
{
  if (existsSync(GATEWAY_SRC_DIST) && existsSync(join(GW_DIST, 'dist', 'index.js'))) {
    try {
      const srcM = statSync(GATEWAY_SRC_DIST).mtime;
      const bundleM = statSync(join(GW_DIST, 'dist', 'index.js')).mtime;
      if (srcM > bundleM) {
        warn(`R3 陈旧 —— 源 gateway dist (${srcM.toISOString()}) 比 bundle 新 (${bundleM.toISOString()}) —— 重跑 build-for-desktop 同步`);
      } else {
        ok(`R3 入口不比源码旧 (bundle ${bundleM.toISOString()})`);
      }
    } catch { /* mtime 不可用则跳过 */ }
  }
}

// ── 附加: 关键依赖存在性 (不 exit, 仅 WARN — 缺失时 gateway 启动会自装) ──
{
  const critical = ['express', 'socket.io', 'cors', 'pino', 'uuid', 'openai'];
  const nm = join(GW_DIST, 'node_modules');
  if (!existsSync(nm)) {
    warn('gateway-dist 无 node_modules (gateway 启动时会自装, 离线则失败)');
  } else {
    const missing = critical.filter((d) => !existsSync(join(nm, d)));
    if (missing.length) warn(`gateway-dist 缺关键依赖: ${missing.join(', ')}`);
  }
}

report();

function report() {
  console.log('[verify-desktop-runtime] gateway 运行时资源一致性门');
  console.log(`  资源目录: ${GW_DIST}`);
  for (const m of pass) console.log(`  ✅ ${m}`);
  for (const m of warns) console.log(`  ⚠️  ${m}`);
  for (const m of errors) console.log(`  ❌ ${m}`);
  if (errors.length) {
    console.log(`\n[verify-desktop-runtime] 失败: ${errors.length} ERROR / ${warns.length} WARN`);
    process.exit(1);
  }
  console.log(`\n[verify-desktop-runtime] 通过 (${pass.length} 项 / ${warns.length} WARN)`);
  process.exit(0);
}
