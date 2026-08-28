/**
 * 打包体积监控脚本
 * 分析构建产物，找出大体积依赖，生成优化报告
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = path.resolve(__dirname, '../dist');
const reportPath = path.resolve(__dirname, '../dist/size-report.txt');

function analyzeBundle() {
  console.log('📦 开始分析打包体积...\n');

  // 读取 manifest 文件
  const manifestPath = path.join(distDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ 未找到 manifest.json，请先执行构建');
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const assets = manifest.assets || [];

  // 按大小排序
  const sorted = assets
    .filter(a => a.file.endsWith('.js') || a.file.endsWith('.css'))
    .map(a => ({
      file: a.file,
      size: fs.statSync(path.join(distDir, a.file)).size,
      ratio: a.gzipSize ? (a.size / a.gzipSize).toFixed(2) : '1.0',
    }))
    .sort((a, b) => b.size - a.size);

  const totalSize = sorted.reduce((sum, a) => sum + a.size, 0);
  const totalGzip = sorted.reduce((sum, a) => sum + (a.size / (parseFloat(a.ratio) || 1)), 0);

  // 生成报告
  let report = `📦 打包体积报告\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  report += `总计: ${formatSize(totalSize)} (${formatSize(totalGzip)} gzipped)\n\n`;

  report += `📊 最大资源 Top 20:\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  sorted.slice(0, 20).forEach((asset, i) => {
    const pct = ((asset.size / totalSize) * 100).toFixed(1);
    report += `${String(i + 1).padStart(2)}. ${asset.file.padEnd(40)} ${formatSize(asset.size).padStart(10)} (${pct}%)\n`;
  });

  report += `\n📈 优化建议:\n`;
  report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

  // 分析大体积依赖
  const largeAssets = sorted.filter(a => a.size > 100_000); // >100KB
  if (largeAssets.length > 0) {
    report += `⚠️ 发现 ${largeAssets.length} 个大于 100KB 的资源:\n`;
    largeAssets.forEach(a => {
      if (a.file.includes('node_modules')) {
        const libName = a.file.split('node_modules/')[1]?.split('/')[0] || 'unknown';
        report += `  - ${libName}: ${formatSize(a.size)}\n`;
      }
    });
  }

  // 检查 tree-shaking 机会
  const vendorChunks = sorted.filter(a => a.file.includes('vendor'));
  if (vendorChunks.length > 0) {
    const vendorTotal = vendorChunks.reduce((sum, a) => sum + a.size, 0);
    report += `\n📦 Vendor  chunks 总计: ${formatSize(vendorTotal)}\n`;
    report += `   建议: 考虑按需加载第三方库\n`;
  }

  // 检查 CSS 体积
  const cssFiles = sorted.filter(a => a.file.endsWith('.css'));
  if (cssFiles.length > 0) {
    const cssTotal = cssFiles.reduce((sum, a) => sum + a.size, 0);
    report += `\n🎨 CSS 总计: ${formatSize(cssTotal)}\n`;
    if (cssTotal > 500_000) {
      report += `   ⚠️ CSS 体积较大，建议检查是否有重复样式\n`;
    }
  }

  fs.writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\n✅ 报告已保存: ${reportPath}\n`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

analyzeBundle();
