#!/usr/bin/env node
/**
 * Gateway build 脚本:
 * 1) 跑 tsc 编译 TS → dist/
 * 2) 复制 src/cleaner/rules.json → dist/cleaner/rules.json
 *    (tsc 不处理非 .ts 资源文件, 但 daemon 启动时需要 rules.json)
 * 3) 不管 tsc 退出码, copy 步骤必跑
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

let tscExit = 0;
try {
    execSync('npx tsc', { cwd: ROOT, stdio: 'inherit' });
} catch (e) {
    tscExit = e.status ?? 1;
    console.warn(`[build] tsc 退出码 ${tscExit}, 继续 copy step 以保证 dist/cleaner/rules.json 存在`);
}

const src = resolve(ROOT, 'src/cleaner/rules.json');
const dst = resolve(ROOT, 'dist/cleaner/rules.json');
if (existsSync(src)) {
    copyFileSync(src, dst);
    console.log(`[build] copied rules.json (${existsSync(dst) ? 'overwrite' : 'new'})`);
} else {
    console.warn(`[build] WARN: 源 ${src} 不存在, 跳过 copy`);
}

process.exit(tscExit);
