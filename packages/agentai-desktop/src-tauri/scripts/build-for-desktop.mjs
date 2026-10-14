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
import { existsSync, mkdirSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
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
      // 2026-10-14: tsc 失败不再"warn 继续" —— dist 漏了就漏进安装包 = gateway 入口缺失
      //   = 安装包里 gateway 起不来 = 所有依赖 gateway 的页面挂 (部分页面缺失)。
      //   fail-fast 拦住, 让人先修编译错误再打包。
      logWarn(`❌ tsc 编译失败 (exit ${tscResult.status}) —— 入口缺失会混进安装包, 中止打包`);
      process.exit(1);
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

  // 2026-10-14 R1: tsc 后入口 dist/index.js 必须存在 —— 这是"页面缺失"根因的 fail-fast 闸
  const gwEntry = resolve(gwDir, 'dist', 'index.js');
  if (!existsSync(gwEntry)) {
    logWarn(`❌ Gateway 入口缺失: ${gwEntry} —— tsc 跑完却没有 dist/index.js, 中止打包 (防止漏入口进安装包)`);
    process.exit(1);
  }
  logOk(`Gateway 入口存在: dist/index.js`);
}

// ── 2. 编译 GUI ─────────────────────────────────────────────────
log('Step 2: 编译 GUI...');
const guiDir = resolve(ROOT, 'packages', 'agentai-gui');
const guiDist = resolve(guiDir, 'dist', 'index.html');
const guiDistDir = resolve(guiDir, 'dist');

// 每次都重新编译 GUI, 确保打包的是最新代码 (不跳过)
{
  // P1 修复: 构建前清空 dist, 防止陈旧的 hashed 文件残留 (index-*.js 累积)
  // Tauri 2.x webview 缓存 + 多次构建不清理 → 桌面端可能加载旧版本
  if (existsSync(guiDistDir)) {
    log('  清空 GUI dist 旧文件 (防止 hash 残留)...');
    try {
      rmSync(guiDistDir, { recursive: true, force: true });
      logOk('  GUI dist 已清空');
    } catch (e) {
      logWarn(`  清空 dist 失败: ${e.message}`);
    }
  }

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

  // 验证: dist/index.html 引用的 entry 必须存在。
  //
  // ⚠️ 原实现是「按文件名排序后 slice(1) 删掉多余的 index-*.js」—— 这是**会删掉真入口的 bug**,
  //    直接对应「打包后功能缺失」:
  //      dist/index.html 引用 `index-e5M0SC7-.js` (610KB, **真入口**)
  //      assets/js 里另有一个 `index-CZSKxFA7.js` (33KB) —— 实测它是 **DecorAI 的懒加载 chunk**
  //        (在 index-e5M0SC7-.js 里以 `lazy(() => import("./index-CZSKxFA7.js"))` 引用)
  //      readdirSync 在 Windows NTFS 上返回字母序, 且 Node 不保证顺序:
  //        'C'(0x43) < 'e'(0x65) → 33KB 的排在前 → slice(1) 保留懒加载 chunk、
  //        **删掉 610KB 真入口** → 安装包里 index.html 指向不存在的文件 = 整站白屏。
  //      即使顺序反过来, 删掉的也是 DecorAI 的懒加载 chunk = 「装饰」功能包内白屏。
  //      **两种排序都错** —— 因为 `index-*.js` 这个名字本身无法区分入口与懒加载 chunk
  //      (vite.config.ts 的 chunkFileNames 是 `assets/js/[name]-[hash].js`, 名为 index 的模块
  //       产出的 chunk 也叫 index-<hash>.js), "只保留一个"这个前提从一开始就不成立。
  //    现在改为: 以 dist/index.html 的 <script src> 为**唯一裁判** —— 被引用的永不删,
  //    未被引用的**只报告不删除** (它很可能正是懒加载 chunk)。
  if (existsSync(guiDistDir)) {
    const assetsJsDir = resolve(guiDistDir, 'assets', 'js');
    const htmlPath = resolve(guiDistDir, 'index.html');
    if (existsSync(assetsJsDir) && existsSync(htmlPath)) {
      const html = readFileSync(htmlPath, 'utf8');
      const referenced = new Set(
        [...html.matchAll(/\/assets\/js\/([A-Za-z0-9._-]+\.js)/g)].map(m => m[1])
      );
      const indexFiles = readdirSync(assetsJsDir).filter(f => /^index-.*\.js$/.test(f));
      const entries = indexFiles.filter(f => referenced.has(f));
      if (entries.length > 0) {
        logOk(`  dist 验证通过: entry = ${entries.join(', ')}`);
      } else {
        logWarn(`  ❌ index.html 未引用任何 index-*.js (引用: ${[...referenced].join(', ') || '无'})`);
      }
      const orphan = indexFiles.filter(f => !referenced.has(f));
      if (orphan.length) {
        logWarn(`  另有未被 index.html 引用的 index-*.js: ${orphan.join(', ')}`);
        logWarn('     (不删除 —— 文件名无法区分入口与懒加载 chunk, 误删即白屏)');
      }
    } else {
      logWarn('  ❌ dist 缺少 assets/js 或 index.html!');
    }
  }

  // 构建后一致性门 (fail-fast): title / entry 引用 / 资源存在性 / chunk 完整性。
  // 上面那些 logWarn 只是提示, 这里才是**真的会拦住**打包的地方 ——
  // 「打包后与开发状态显示不一致」正是因为过去这里只 warn 不 exit。
  const gateScript = resolve(SRC_TAUDI, 'scripts', 'verify-web-build.mjs');
  if (existsSync(gateScript)) {
    log('运行构建一致性门 (verify-web-build.mjs)...');
    const gate = spawnSync(process.execPath, [gateScript], {
      cwd: SRC_TAUDI, stdio: 'inherit', shell: false,
    });
    if (gate.status !== 0) {
      logWarn('❌ 构建一致性校验未通过 —— 产物会与开发状态不一致, 已中止打包');
      process.exit(1);
    }
    logOk('构建一致性门通过');
  } else {
    logWarn('verify-web-build.mjs 不存在, 跳过一致性校验');
  }

  // 2026-10-14: gateway 运行时资源一致性门 (R1 入口 / R2 .env key 名 / R3 陈旧)。
  // 与 GUI 门并列 —— 过去"部分页面缺失"(漏 gateway 入口) 和"显示不一致"(.env 漂移)
  // 都靠人肉翻安装包, 现在机器化拦住。
  const rtGateScript = resolve(SRC_TAUDI, 'scripts', 'verify-desktop-runtime.mjs');
  if (existsSync(rtGateScript)) {
    log('运行 gateway 运行时一致性门 (verify-desktop-runtime.mjs)...');
    const rtGate = spawnSync(process.execPath, [rtGateScript], {
      cwd: SRC_TAUDI, stdio: 'inherit', shell: false,
    });
    if (rtGate.status !== 0) {
      logWarn('❌ gateway 运行时一致性门未通过 —— 安装包会缺 gateway 入口或 .env 漏 key, 已中止打包');
      process.exit(1);
    }
    logOk('gateway 运行时一致性门通过');
  } else {
    logWarn('verify-desktop-runtime.mjs 不存在, 跳过 gateway 运行时校验');
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
    const backups = readdirSync(resourcesDir)
      .filter(e => e.startsWith('gateway-dist-backup-'))
      .sort().reverse();
    backups.slice(1).forEach(b => {
      try { rmSync(resolve(resourcesDir, b), { recursive: true, force: true }); } catch {}
    });
  }
  // 2026-10-14 R2: 同步根 .env 的 key 名到 bundle .env (只碰 key 名, 不复制/不打印 value)
  syncEnvKeyNames(ROOT, gwDistFinal);
} else {
  logWarn('gateway-dist-v2 不完整, 保持现有 gateway-dist');
}

/**
 * 把根 .env 里出现的 key 名同步进 bundle .env —— 已同名保留原值行, 缺的追加 `KEY=` 空占位。
 * 只碰 **key 名**, 绝不复制/打印 value (值由用户/CI 注入, 不把真 key 硬编码进仓库)。
 * 堵住 R2"打包态 .env 漏 key" 导致的"与开发态显示不一致"。
 */
function syncEnvKeyNames(rootDir, gwDistDir) {
  const rootEnv = resolve(rootDir, '.env');
  const bundleEnv = resolve(gwDistDir, '.env');
  if (!existsSync(rootEnv)) { logWarn('根 .env 不存在, 跳过 key 名同步'); return; }
  const rootText = readFileSync(rootEnv, 'utf8');
  const rootKeys = [...rootText.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(m => m[1]);
  if (rootKeys.length === 0) { logWarn('根 .env 无 key, 跳过'); return; }

  const bundleLines = existsSync(bundleEnv) ? readFileSync(bundleEnv, 'utf8').split(/\r?\n/) : [];
  const existing = new Set(bundleLines.map(l => (l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/) || [])[1]).filter(Boolean));
  const missing = rootKeys.filter(k => !existing.has(k));
  if (missing.length === 0) { logOk(`bundle .env 已含根 .env 全部 ${rootKeys.length} 个 key 名`); return; }

  // 追加缺失 key 的空占位 (KEY=), 已有 key 的行不动 (保留用户已填的值)
  const placeholder = missing.map(k => `${k}=`).join('\n');
  const newContent = (bundleLines.join('\n') + '\n' + placeholder + '\n');
  writeFileSync(bundleEnv, newContent, 'utf8');
  logOk(`bundle .env 同步 ${missing.length} 个缺失 key 名: ${missing.join(', ')} (值为空占位, 由用户/CI 注入)`);
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
