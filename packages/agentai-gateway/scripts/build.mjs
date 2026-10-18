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

// ── 前置: 工具声明/实现一致性校验 (fail-fast) ──
// EXTRA_TOOLS 声明了但 EXTRA_HANDLERS 没实现的工具, 会在 index.ts:134 被
// console.warn + continue 静默跳过 —— 构建通过、启动正常, 但工具永远不注册。
// 这个校验把它从运行时静默失效提到构建期硬失败。
try {
    const vr = spawnSync(process.execPath, [resolve(__dirname, 'verify-tool-consistency.mjs')], {
        cwd: ROOT, stdio: 'inherit', shell: false
    });
    if ((vr.status ?? 1) !== 0) {
        console.error('\n[build] ❌ 工具一致性校验未通过, 中止构建');
        process.exit(1);
    }
} catch (e) {
    console.error(`\n[build] ❌ 工具一致性校验执行异常, 中止构建: ${e.message}`);
    process.exit(1);
}

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

// ═══ 2026-10-16: 编译产物版本戳 (防"改了 src 但 dist 是旧的") ═══
// 事故背景: 修了 deepseek 400 的三道防线后, 400 依旧复现 —— 因为
//   `npm start` 跑的是 `node dist/index.js`, 而我只改了 src 没重新 build,
//   **修复从未被加载**。这种"改了等于没改"极难自查:
//   源码明明修对了, 测试也全绿, 但运行时行为纹丝不动。
// 解法: build 时写入 src 全部 .ts 的内容哈希 + 时间戳, 启动时比对。
//   不一致就在日志最前面打醒目告警 —— 让人一眼看出"跑的是旧产物"。
if (tscExit === 0) {
    try {
        const { createHash } = await import('node:crypto');
        const { readdirSync, readFileSync, writeFileSync, statSync } = await import('node:fs');
        const { join } = await import('node:path');

        /** 递归列出 src 下全部 .ts (跳过 .test.ts —— 测试不影响运行时) */
        function listTs(dir, acc = []) {
            for (const name of readdirSync(dir)) {
                const p = join(dir, name);
                const st = statSync(p);
                if (st.isDirectory()) listTs(p, acc);
                else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) acc.push(p);
            }
            return acc;
        }
        const srcDir = resolve(ROOT, 'src');
        const files = listTs(srcDir).sort();
        const h = createHash('sha256');
        for (const f of files) h.update(readFileSync(f));
        const stamp = {
            hash: h.digest('hex').slice(0, 16),
            files: files.length,
            builtAt: new Date().toISOString(),
        };
        writeFileSync(resolve(ROOT, 'dist/.build-stamp.json'), JSON.stringify(stamp, null, 2));
        console.log(`[build] stamped: ${stamp.hash} (${stamp.files} files)`);
    } catch (e) {
        console.warn(`[build] WARN: 写入 build stamp 失败: ${e?.message || e}`);
    }
}

if (tscExit !== 0) {
    console.error(`\n[build] ❌ tsc 编译有错误 (exit ${tscExit})，请修复后重试`);
}
process.exit(tscExit);
