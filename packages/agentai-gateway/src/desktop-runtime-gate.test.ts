/**
 * gateway 运行时资源一致性门 — 回归测试 (2026-10-14 打包一致性)
 * =================================================================
 * 对应"打包与开发态显示不一致 + 部分页面缺失"根因修复:
 *   R1 gateway-dist 漏入口 (dist/index.js) → 运行时 gateway 起不来 → 页面挂
 *   R2 打包 .env 是过期副本 (漏 key) → 模型/密钥与开发态不一致
 * 三层:
 *   契约: build-for-desktop.mjs 有 dist 入口 fail-fast + spawn 新门 + syncEnvKeyNames;
 *         verify-desktop-runtime.mjs 有 R1/R2 检查且**不打印 value**; lib.rs 有 AGENTAI_ENV_PATH。
 *   行为: 在临时目录造"缺 dist" 的 gateway-dist → 门 exit1; 造"齐 dist+env" → exit0。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import * as nodePath from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const DESKTOP = nodePath.resolve(ROOT, 'packages', 'agentai-desktop');
const SRC_TAUDI = nodePath.join(DESKTOP, 'src-tauri');
const buildSrc = readFileSync(nodePath.join(SRC_TAUDI, 'scripts', 'build-for-desktop.mjs'), 'utf-8');
const gateSrc = readFileSync(nodePath.join(SRC_TAUDI, 'scripts', 'verify-desktop-runtime.mjs'), 'utf-8');
const libSrc = readFileSync(nodePath.join(SRC_TAUDI, 'src', 'lib.rs'), 'utf-8');

function codeOnly(s: string): string {
  const NL = String.fromCharCode(10);
  return s.split(NL).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(NL);
}
const buildCode = codeOnly(buildSrc);
const gateCode = codeOnly(gateSrc);

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: 打包一致性门的接线 + 入口 fail-fast', () => {
  it('build-for-desktop.mjs tsc 失败 → process.exit(1) (不再 warn 继续)', () => {
    expect(buildCode).toMatch(/tscResult\.status !== 0[\s\S]{0,300}?process\.exit\(1\)/);
  });

  it('build-for-desktop.mjs tsc 后校验 dist/index.js 入口存在, 缺则 exit(1)', () => {
    expect(buildCode).toMatch(/gwEntry[\s\S]{0,200}?dist['"],\s*['"]index\.js['"]/);
    expect(buildCode).toMatch(/Gateway 入口缺失[\s\S]{0,120}?process\.exit\(1\)/);
  });

  it('build-for-desktop.mjs spawn 新门 verify-desktop-runtime.mjs 且失败 exit(1)', () => {
    expect(buildCode).toMatch(/verify-desktop-runtime\.mjs/);
    expect(buildCode).toMatch(/rtGate\.status !== 0[\s\S]{0,150}?process\.exit\(1\)/);
  });

  it('build-for-desktop.mjs 有 .env key 名同步 (syncEnvKeyNames, 只碰 key 名)', () => {
    expect(buildCode).toMatch(/function syncEnvKeyNames/);
    expect(buildCode).toMatch(/缺失 key 名/);
  });

  it('verify-desktop-runtime.mjs 有 R1 入口检查 + R2 .env key 名检查', () => {
    expect(gateCode).toMatch(/dist['"],\s*['"]index\.js['"]/); // R1
    expect(gateCode).toMatch(/\.env key 名/);                    // R2
    expect(gateCode).toMatch(/process\.exit\(1\)/);
  });

  it('verify-desktop-runtime.mjs 只比 .env key 名, **不打印 value**', () => {
    // 门里有 readEnvKeys (只匹配 KEY= 行), 且没有把 value 写进日志的代码
    expect(gateCode).toMatch(/function readEnvKeys/);
    expect(gateCode).toMatch(/A-Za-z_.*\\s\*=/); // 匹配 key 行
    expect(gateCode).not.toMatch(/value:|密钥值|password/);
  });

  it('lib.rs spawn gateway 时显式设 AGENTAI_ENV_PATH 指向 bundle .env', () => {
    expect(libSrc).toMatch(/AGENTAI_ENV_PATH/);
    expect(libSrc).toMatch(/gw_dir\.join\("\.env"\)/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 — 临时目录造场景, 跑门脚本看 exit 码
// ════════════════════════════════════════════════════════════════════════
describe('行为: 门脚本对"缺 dist" / "齐 dist" 的判定', () => {
  const gateScript = nodePath.join(SRC_TAUDI, 'scripts', 'verify-desktop-runtime.mjs');
  const tmpBase = nodePath.join(SRC_TAUDI, 'resources');
  const gwDist = nodePath.join(tmpBase, 'gateway-dist');
  const bundleDistEntry = nodePath.join(gwDist, 'dist', 'index.js');
  const rootEnv = nodePath.join(ROOT, '.env');

  const saveState = () => {
    // 记录当前 bundle dist 入口 + bundle .env 是否存在, 测后恢复
    return {
      hadEntry: existsSync(bundleDistEntry),
      hadEnv: existsSync(nodePath.join(gwDist, '.env')),
      entryBackup: existsSync(bundleDistEntry) ? readFileSync(bundleDistEntry, 'utf-8') : null,
      envBackup: existsSync(nodePath.join(gwDist, '.env')) ? readFileSync(nodePath.join(gwDist, '.env'), 'utf-8') : null,
    };
  };
  const restore = (s: ReturnType<typeof saveState>) => {
    if (s.hadEntry && s.entryBackup != null) writeFileSync(bundleDistEntry, s.entryBackup);
    if (s.hadEnv && s.envBackup != null) writeFileSync(nodePath.join(gwDist, '.env'), s.envBackup);
    if (!s.hadEntry && existsSync(bundleDistEntry)) {
      try { rmSync(nodePath.join(gwDist, 'dist'), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (!s.hadEnv && existsSync(nodePath.join(gwDist, '.env'))) {
      try { rmSync(nodePath.join(gwDist, '.env'), { force: true }); } catch { /* ignore */ }
    }
  };

  const runGate = (): number => {
    try {
      execSync(`node ${JSON.stringify(gateScript)}`, { cwd: SRC_TAUDI, stdio: 'pipe' });
      return 0;
    } catch (e: any) {
      return e.status ?? 1;
    }
  };

  it('缺 dist 入口 → 门 exit 1 (R1 拦住"页面缺失"根因)', () => {
    const s = saveState();
    try {
      // 确保 bundle 没有 dist/index.js
      if (existsSync(bundleDistEntry)) rmSync(nodePath.join(gwDist, 'dist'), { recursive: true, force: true });
      const code = runGate();
      expect(code, '缺 dist 入口时门应 exit 1').toBe(1);
    } finally { restore(s); }
  });

  it('齐 dist 入口 + 齐 .env key → 门 exit 0', () => {
    const s = saveState();
    try {
      // 造一个最小 bundle dist/index.js
      mkdirSync(nodePath.join(gwDist, 'dist'), { recursive: true });
      writeFileSync(bundleDistEntry, '// minimal entry\n');
      // 造一个含全部根 .env key 名的 bundle .env
      const rootText = readFileSync(rootEnv, 'utf-8');
      const rootKeys = [...rootText.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(m => m[1]);
      writeFileSync(nodePath.join(gwDist, '.env'), rootKeys.map(k => `${k}=`).join('\n') + '\n');
      const code = runGate();
      expect(code, '齐 dist + 齐 key 名时门应 exit 0 (got 1 可能是 R3 陈旧 WARN, 不影响 exit)').toBe(0);
    } finally { restore(s); }
  });
});
