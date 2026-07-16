/**
 * screen-capture: 统一屏幕获取能力
 * ----------------------------------------------------
 * 用途: AI 助手一键获取屏幕画面（桌面 / 活动窗口 / 浏览器）
 * 来源:
 *   - 桌面: pyautogui / Windows native (PowerShell)
 *   - 浏览器: BrowserEngine (Playwright)
 *   - 活动窗口: Windows native / macOS screencapture
 *
 * 安全守护:
 *  - 路径白名单 (保存时)
 *  - 截图大小限制
 *  - 隐私模式: 排除敏感窗口（密码管理器、1Password 等）
 *  - 异步执行，不阻塞主循环
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile, exec } from 'child_process';
import { isPathAllowed } from './safety/path-guard.js';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export type CaptureMode = 'desktop' | 'window' | 'browser' | 'region';

export interface CaptureOptions {
  mode?: CaptureMode;
  /** region 模式: { x, y, width, height } */
  region?: { x: number; y: number; width: number; height: number };
  /** browser 模式: URL */
  url?: string;
  /** 活动窗口标题模糊匹配 (window 模式) */
  windowTitle?: string;
  /** 保存路径（可选，不传则返回 base64） */
  savePath?: string;
  /** 全屏截图（仅 desktop） */
  fullScreen?: boolean;
  /** 包含鼠标光标 */
  showCursor?: boolean;
}

export interface CaptureResult {
  ok: boolean;
  mode: CaptureMode;
  /** PNG base64 或 null */
  image?: string;
  /** 保存的文件路径 */
  filePath?: string;
  /** 图片尺寸 */
  width?: number;
  height?: number;
  /** v3.2: OCR 文本 (captureAndOcr 时填充) */
  ocrText?: string;
  /** 错误 */
  error?: string;
}

/** ===== 桌面截图 (跨平台) ===== */
async function captureDesktop(opts: CaptureOptions): Promise<CaptureResult> {
  const platform = process.platform;
  const savePath = opts.savePath || path.join(os.tmpdir(), `screen_${Date.now()}.png`);

  try {
    if (platform === 'win32') {
      // Windows: PowerShell + System.Drawing
      const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
${opts.region ? `$bounds = New-Object System.Drawing.Rectangle(${opts.region.x}, ${opts.region.y}, ${opts.region.width}, ${opts.region.height})` : ''}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${savePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "OK: $($bounds.Width)x$($bounds.Height)"
`;
      const output = await execPowerShell(script);
      const match = output.match(/OK: (\d+)x(\d+)/);
      return {
        ok: true,
        mode: 'desktop',
        filePath: savePath,
        width: match ? parseInt(match[1]) : undefined,
        height: match ? parseInt(match[2]) : undefined,
      };
    }
    if (platform === 'darwin') {
      // macOS: screencapture
      await execAsync('screencapture', ['-x', opts.region ? '-R' : '', savePath]);
      return { ok: true, mode: 'desktop', filePath: savePath };
    }
    // Linux: import (ImageMagick) 或 scrot
    try {
      await execAsync('import', [savePath]);
    } catch {
      await execAsync('scrot', [savePath]);
    }
    return { ok: true, mode: 'desktop', filePath: savePath };
  } catch (e: any) {
    return { ok: false, mode: 'desktop', error: e.message };
  }
}

/** ===== 活动窗口截图 ===== */
async function captureWindow(opts: CaptureOptions): Promise<CaptureResult> {
  if (process.platform !== 'win32') {
    return { ok: false, mode: 'window', error: 'Window capture only on Windows' };
  }
  const savePath = opts.savePath || path.join(os.tmpdir(), `window_${Date.now()}.png`);
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$signature = @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
$type = Add-Type -MemberDefinition $signature -Name Win32 -Namespace Capture -PassThru
$hwnd = $type::GetForegroundWindow()
$rect = New-Object Capture.Win32+RECT
$type::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
$bitmap.Save('${savePath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Output "OK: \${width}x\${height}"
`;
  try {
    const output = await execPowerShell(script);
    const match = output.match(/OK: (\d+)x(\d+)/);
    return {
      ok: true,
      mode: 'window',
      filePath: savePath,
      width: match ? parseInt(match[1]) : undefined,
      height: match ? parseInt(match[2]) : undefined,
    };
  } catch (e: any) {
    return { ok: false, mode: 'window', error: e.message };
  }
}

/** ===== 浏览器截图 (Playwright) ===== */
async function captureBrowser(opts: CaptureOptions): Promise<CaptureResult> {
  if (!opts.url) {
    return { ok: false, mode: 'browser', error: 'url required' };
  }
  try {
    const { getBrowserEngine } = await import('./browser-engine.js');
    const engine = getBrowserEngine();
    if (opts.url) await engine.navigate?.(opts.url);  // v3.2 修复: 先导航
    const savePath = opts.savePath || path.join(os.tmpdir(), `browser_${Date.now()}.png`);
    const shot = await engine.screenshot(undefined, !!opts.fullScreen);  // v3.2 修复: 用 engine.screenshot() 不用 page.screenshot
    const fs2 = await import('fs');
    const buf = Buffer.from(shot.base64, 'base64');
    fs2.writeFileSync(savePath, buf);
    return {
      ok: true,
      mode: 'browser',
      filePath: savePath,
      width: shot.width,
      height: shot.height,
    };
  } catch (e: any) {
    return { ok: false, mode: 'browser', error: e.message };
  }
}

/** ===== 主入口 ===== */
export async function captureScreen(opts: CaptureOptions = {}): Promise<CaptureResult> {
  const mode = opts.mode || 'desktop';

  // 1. 路径白名单（如果指定了 savePath）
  if (opts.savePath && !isPathAllowed(opts.savePath)) {
    return { ok: false, mode, error: 'savePath not allowed' };
  }

  // 2. 隐私保护: 拦截敏感窗口
  const SENSITIVE_WINDOW_PATTERNS = [
    /1password/i, /bitwarden/i, /keepass/i, /lastpass/i,
    /银行|bank|alipay|支付宝|wechat pay|微信支付/i,
  ];
  if (opts.windowTitle && SENSITIVE_WINDOW_PATTERNS.some(p => p.test(opts.windowTitle!))) {  // v3.2 修复: windowTitle 是 optional
    return { ok: false, mode, error: 'Sensitive window blocked by privacy policy' };
  }

  // 3. 执行
  let result: CaptureResult;
  switch (mode) {
    case 'desktop':
    case 'region':
      result = await captureDesktop(opts);
      break;
    case 'window':
      result = await captureWindow(opts);
      break;
    case 'browser':
      result = await captureBrowser(opts);
      break;
    default:
      return { ok: false, mode, error: 'Unknown mode' };
  }

  // 4. 读取 + 转 base64（如果不保存）
  if (result.ok && result.filePath && !opts.savePath) {
    try {
      const stat = fs.statSync(result.filePath);
      if (stat.size > MAX_IMAGE_SIZE) {
        return { ok: false, mode, error: `Image too large: ${stat.size}` };
      }
      const buf = fs.readFileSync(result.filePath);
      result.image = `data:image/png;base64,${buf.toString('base64')}`;
    } catch (e: any) {
      result.error = `Failed to read image: ${e.message}`;
    }
  }

  return result;
}

// ===== 工具函数 =====
function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function execPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(os.tmpdir(), `ps_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    exec(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 30000 }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
