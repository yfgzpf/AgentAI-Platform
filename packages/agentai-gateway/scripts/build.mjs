#!/usr/bin/env node
/**
 * Gateway build 脚本:
 * 1) 跑 tsc 编译 TS → dist/
 * 2) 复制 src/cleaner/rules.json → dist/cleaner/rules.json
 *    (tsc 不处理非 .ts 资源文件, 但 daemon 启动时需要 rules.json)
 *
 * 注意: tsc 失败时仍会执行 copy step (保证资源文件就位),
 *       但最终退出码会如实返回, 不吞错误。
 *
 * ⚠️ 不能用 npx tsc — pnpm workspace 子包内 npx 找不到 hoisted tsc
 *    必须用绝对路径直接调 node + tsc
 */
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(ROOT, '..', '..');

/** 定位 tsc 入口 (与 dev.mjs 同款 — 用真正的 JS 文件, 不用 .bin 包装脚本) */
function resolveTsc() {
    // 1) 真正的 JS 入口 (跨平台)
    const jsEntry = resolve(REPO_ROOT, 'node_modules/typescript/bin/tsc');
    if (existsSync(jsEntry)) {
        return { cmd: process.execPath, args: [jsEntry], shell: false };
    }
    // 2) 兜底: .bin 包装脚本 (需 shell 解释)
    const binCjs = resolve(REPO_ROOT, 'node_modules/.bin/tsc');
    if (existsSync(binCjs)) {
        return { cmd: binCjs, args: [], shell: true };
    }
    return { cmd: 'npx', args: ['tsc'], shell: true };
}

let tscExit = 0;
try {
    const { cmd, args, shell } = resolveTsc();
    const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell });
    tscExit = r.status ?? (r.error ? 1 : 0);
    if (tscExit !== 0) {
        console.warn(`\n[build] tsc 编译失败 (exit ${tscExit})，仍继续 copy 资源文件...`);
    }
} catch (e) {
    tscExit = e.status ?? 1;
    console.warn(`\n[build] tsc 编译失败 (exit ${tscExit})，仍继续 copy 资源文件...`);
}

// 不管 tsc 是否成功, copy step 必跑 (资源文件不依赖 tsc)
const src = resolve(ROOT, 'src/cleaner/rules.json');
const dst = resolve(ROOT, 'dist/cleaner/rules.json');
if (existsSync(src)) {
    copyFileSync(src, dst);
    console.log(`[build] copied rules.json (${existsSync(dst) ? 'overwrite' : 'new'})`);
} else {
    console.warn(`[build] WARN: 源 ${src} 不存在, 跳过 copy`);
}

if (tscExit !== 0) {
    console.error(`\n[build] ❌ tsc 编译有错误 (exit ${tscExit})，请修复后重试`);
}
process.exit(tscExit);
