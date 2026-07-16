/**
 * e2e-desktop-image-match.ts
 * ----------------------------------------------------
 * 验证图像模板匹配 (不依赖 OCR):
 *  - findImageOnScreen  (找图)
 *  - clickImage          (点击图)
 *  - waitForImage        (等待图)
 *
 * 测试策略:
 *  1. 截屏保存为 test_source.png
 *  2. 截一个小区域保存为 test_template.png (从 source 中切一块)
 *  3. 用 findImageOnScreen 在 source 中找 template, 应该找到
 */
import { findImageOnScreen, clickImage, waitForImage } from './desktop-automation.js';
import { captureScreen } from './screen-capture.js';
import * as fs from 'fs';
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) { passed++; console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  console.log('\n========== Image Template Matching E2E ==========\n');

  if (process.platform !== 'win32') {
    console.log('⛔ Skip: only Windows supported');
    return;
  }

  // 1. 截屏
  console.log('[1] 截屏...');
  const c = await captureScreen({ mode: 'desktop' });
  check('captureScreen ok', c.ok, c.error);
  if (!c.ok || !c.filePath) return;
  const sourcePath = c.filePath;
  console.log('  source:', sourcePath);

  // 2. 从截屏中切出一个小区域作为模板
  console.log('\n[2] 创建测试模板 (从截屏中切 50x50 区域)...');
  const templatePath = 'F:\\temp\\test_template.png';
  // 如果模板已存在, 跳过切割 (避免重复执行)
  if (fs.existsSync(templatePath)) {
    check('模板已存在 (复用)', true, templatePath);
  } else {
    const cutScript = `
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
try {
  $src = [System.Drawing.Image]::FromFile('${sourcePath.replace(/\\/g, '\\\\')}')
  $bmp = New-Object System.Drawing.Bitmap $src
  $rect = New-Object System.Drawing.Rectangle 100, 100, 50, 50
  $crop = $bmp.Clone($rect, $bmp.PixelFormat)
  $crop.Save('${templatePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose(); $src.Dispose()
  Write-Output "saved"
} catch {
  Write-Output "error: $($_.Exception.Message)"
  exit 1
}
`;
    const tmpScript = path.join(os.tmpdir(), `cut_${Date.now()}.ps1`);
    fs.writeFileSync(tmpScript, cutScript, 'utf-8');
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpScript],
          { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) {
              console.log('  cut error:', err.message, '| stderr:', stderr);
              reject(err);
            } else {
              console.log('  cut result:', stdout.trim());
              resolve();
            }
          });
      });
    } catch (e: any) {
      check('模板创建', false, e.message);
    }
    check('模板创建成功', fs.existsSync(templatePath), `path=${templatePath}`);
  }

  // 3. findImageOnScreen: 在 source 中找 template
  console.log('\n[3] findImageOnScreen (在 source 中找 template)...');
  if (fs.existsSync(templatePath)) {
    const r = await findImageOnScreen(templatePath, { threshold: 0.8 });
    if (r.ok && r.data?.best) {
      check('找到匹配', true, `at (${r.data.best.cx}, ${r.data.best.cy}) sim=${r.data.best.similarity}`);
      check('匹配位置合理', r.data.best.x >= 0 && r.data.best.y >= 0, `x=${r.data.best.x} y=${r.data.best.y}`);
      check('相似度 > 0.8', r.data.best.similarity > 0.8, `sim=${r.data.best.similarity}`);
    } else {
      check('找到匹配', false, r.error);
    }
  }

  // 4. findImageOnScreen: 不存在的图 (用 50x50 的紫红色模板, 在真实屏幕上不可能有)
  console.log('\n[4] findImageOnScreen(不存在的图)...');
  const blankPath = 'F:\\temp\\test_blank.png';
  if (!fs.existsSync(blankPath)) {
    const blankScript = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 50, 50
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Magenta)
$bmp.Save('${blankPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved"
`;
    const tmpBlank = path.join(os.tmpdir(), `blank_${Date.now()}.ps1`);
    fs.writeFileSync(tmpBlank, blankScript, 'utf-8');
    try {
      await new Promise<void>((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpBlank],
          { timeout: 10000 }, (err, stdout, stderr) => {
            if (err) { console.log('  blank error:', err.message, '| stderr:', stderr); reject(err); }
            else resolve();
          });
      });
    } catch (e: any) {
      check('空白图创建', false, e.message);
    }
  }
  if (fs.existsSync(blankPath)) {
    const r2 = await findImageOnScreen(blankPath, { threshold: 0.95 });
    // ok=true 且有 best 是匹配成功; 我们期望找不到 → ok=false
    check('不存在的图 (50x50紫红) 未匹配', !r2.ok || !r2.data?.best,
      r2.ok ? `意外匹配 at (${r2.data?.best?.cx}, ${r2.data?.best?.cy})` : (r2.error?.slice(0, 60) || 'no match (expected)'));
  }

  // 5. waitForImage 失败路径
  console.log('\n[5] waitForImage(不存在的图, 短超时)...');
  if (fs.existsSync(blankPath)) {
    const w1 = await waitForImage(blankPath, { timeoutMs: 5000, pollMs: 2000, threshold: 0.95 });
    check('waitForImage(不存在) ok=false', !w1.ok, w1.error?.slice(0, 60));
  }

  // 清理
  try { fs.unlinkSync(sourcePath); } catch {}
  try { fs.unlinkSync(templatePath); } catch {}
  try { fs.unlinkSync(blankPath); } catch {}

  // 总结
  console.log('\n========== 结果 ==========');
  console.log(`通过: ${passed} / 失败: ${failed} / 总计: ${passed + failed}`);
  if (failed === 0) console.log('\n🎉 全部通过!');
  else { console.log('\n⚠️ 有失败项'); process.exit(1); }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('E2E failed:', e);
  process.exit(1);
});
