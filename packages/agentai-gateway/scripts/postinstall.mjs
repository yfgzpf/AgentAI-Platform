#!/usr/bin/env node
/**
 * postinstall — 安装可选依赖 Playwright Chromium
 *
 * 功能:
 *   1. 检查 playwright 是否可导入
 *   2. 检查 Chromium 是否已安装
 *   3. 如果缺失则自动下载 (安静模式)
 *
 * 注意: 此脚本只在 pnpm install/postinstall 时触发,
 *       如果 Chromium 已存在则跳过, 不影响启动速度。
 */
const { execSync } = await import('child_process');

try {
  // 1. 检查 playwright 包是否存在
  await import('playwright');
} catch {
  console.log('[postinstall] playwright 未安装, 跳过');
  process.exit(0);
}

// 2. 检查 Chromium 是否已安装
try {
  const { execSync } = await import('child_process');
  const out = execSync('npx playwright install --dry-run chromium 2>&1', {
    stdio: 'pipe',
    encoding: 'utf-8',
    timeout: 30_000,
  });
  if (out.includes('already installed')) {
    console.log('[postinstall] Chromium already installed, skip');
    process.exit(0);
  }
} catch {
  // dry-run 失败也继续尝试安装
}

// 3. 安装 Chromium (安静模式)
try {
  console.log('[postinstall] Downloading Playwright Chromium...');
  execSync('npx playwright install chromium 2>&1', {
    stdio: 'inherit',
    timeout: 120_000,
  });
  console.log('[postinstall] Chromium installed successfully');
} catch (e) {
  console.warn('[postinstall] Chromium install failed (optional):', e.message);
}
