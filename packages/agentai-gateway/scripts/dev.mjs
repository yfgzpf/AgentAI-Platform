// dev.mjs - tsc emit + node 启动, chokidar 监听 src 触发重新编译+重启
// 原因: esbuild swc 在 win 长 unicode 文件解析有 bug, 改用 tsc emit
//
// ⚠️ 关键: 不能用 `npx tsc` — pnpm workspace 子包内 npx 找不到 hoisted 的 tsc
//    (会卡在 "This is not the tsc command you are looking for" 提示)
//    必须用绝对路径直接调 node + tsc 脚本
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkgRoot = path.resolve(__dirname, '..');
// monorepo 根 (上上两级: scripts/.. 是包根, 再上两级是 monorepo 根)
const repoRoot = path.resolve(pkgRoot, '..', '..');

/**
 * 定位 tsc 实际可执行入口
 * ⚠️ 关键: node_modules/.bin/tsc 是 shell 包装脚本 (Windows 是 .cmd, Unix 是无后缀的 sh)
 *    不能用 process.execPath 直接调, 必须用真正的 JS 入口: node_modules/typescript/bin/tsc
 *
 * 策略:
 *   1) 用真正的 JS 入口 (跨平台, 不依赖 shell)
 *   2) 兜底用 .cmd (Windows) 或可执行文件 (Unix) + shell: true
 */
function resolveTscCommand() {
  // 1) 真正的 JS 入口 (pnpm 布局: ../../node_modules/typescript/bin/tsc)
  const jsEntry = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (existsSync(jsEntry)) {
    return { cmd: process.execPath, args: [jsEntry, '-p', '.'], shell: false };
  }
  // 2) 兜底: pnpm 9 标准布局有 .bin/tsc (shell wrapper)
  const binCjs = path.join(repoRoot, 'node_modules', '.bin', 'tsc');
  if (existsSync(binCjs)) {
    // Windows 上是 .cmd, Unix 是可执行 sh 脚本 — 都需要 shell 解释
    return { cmd: binCjs, args: ['-p', '.'], shell: true };
  }
  // 3) 终极兜底
  return { cmd: 'npx', args: ['tsc', '-p', '.'], shell: true };
}

let nodeProc = null;
let isBuilding = false;
let pendingRebuild = false;

function build() {
  console.log('[dev] tsc build...');
  const { cmd, args, shell } = resolveTscCommand();
  const r = spawnSync(cmd, args, { cwd: pkgRoot, encoding: 'utf8', shell });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status === 0) {
    console.log('[dev] build OK');
    return true;
  }
  console.error('[dev] build FAILED, status=' + r.status);
  return false;
}

function startNode() {
  const launch = () => {
    console.log('[dev] starting node dist/index.js');
    nodeProc = spawn('node', ['dist/index.js'], { cwd: pkgRoot, stdio: 'inherit', shell: true });
    nodeProc.on('exit', (code) => {
      if (code !== 0 && code !== null) console.log('[dev] node exited code=' + code);
    });
  };

  if (nodeProc) {
    // 等待旧进程完全退出再启动新进程, 避免端口占用
    const old = nodeProc;
    nodeProc = null;
    old.once('exit', () => {
      // 额外等 500ms 确保端口释放
      setTimeout(launch, 500);
    });
    old.once('error', () => launch); // 进程已死, 直接启动
    try { old.kill(); } catch {}
    // 超时保护: 如果 3 秒后旧进程还没退出, 强制杀
    setTimeout(() => {
      if (old.exitCode === null && old.pid) {
        try {
          process.kill(old.pid, 'SIGKILL');
        } catch {}
      }
    }, 3000);
  } else {
    launch();
  }
}

function rebuildAndRestart() {
  if (isBuilding) { pendingRebuild = true; return; }
  isBuilding = true;
  const ok = build();
  isBuilding = false;
  if (ok) startNode();
  if (pendingRebuild) { pendingRebuild = false; rebuildAndRestart(); }
}

// 首次启动
if (build()) startNode();

// 监听 src 目录
const watcher = chokidar.watch(path.join(pkgRoot, 'src'), { ignoreInitial: true });
watcher.on('all', (event, file) => {
  console.log('[dev] ' + event + ': ' + path.relative(pkgRoot, file));
  rebuildAndRestart();
});

process.on('SIGINT', () => { watcher.close(); if (nodeProc) nodeProc.kill(); process.exit(0); });
process.on('SIGTERM', () => { watcher.close(); if (nodeProc) nodeProc.kill(); process.exit(0); });
