/**
 * ocr: 图像转文字能力
 * ----------------------------------------------------
 * 用途: AI 助手截图后能"读图" — 提取屏幕/截图中的文字
 * 来源 (按优先级):
 *  1. GPT-4V / 多模态 LLM (最准, 但有费用)
 *  2. Tesseract (本地, 免费, OCR 经典)
 *  3. Windows OCR API (Windows 10+ 内置, 免费)
 *  4. macOS Vision Framework (macOS 内置, 免费)
 *
 * 安全守护:
 *  - 文件大小限制
 *  - 路径白名单
 *  - 注入防护: OCR 结果在 AI 处理前标 `[EXTERNAL_OCR]` 前缀
 *    (避免 OCR 出来的文字直接被当 system prompt)
 */
import * as fs from 'fs';
import { execFile } from 'child_process';
import * as path from 'path';
import { isPathAllowed } from './safety/path-guard.js';
import type { CaptureResult } from './screen-capture.js';  // v3.2 修复: CaptureResult 在 screen-capture.ts 定义
import { captureScreen, type CaptureOptions } from './screen-capture.js';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export type OcrEngine = 'auto' | 'tesseract' | 'windows' | 'macos' | 'llm';

export interface OcrOptions {
  engine?: OcrEngine;
  /** 语言: 'chi_sim+eng' (Tesseract), 'zh-Hans' (Windows) */
  language?: string;
  /** LLM 引擎 (OCR 用): 'agentai' / 'zhipu' / 'openai' */
  llmProvider?: string;
}

export interface OcrResult {
  ok: boolean;
  engine: OcrEngine;
  text: string;
  /** 原始置信度 (Tesseract) */
  confidence?: number;
  /** 错误 */
  error?: string;
}

/** ===== 自动选择 OCR 引擎 ===== */
async function pickEngine(): Promise<OcrEngine> {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'tesseract';
}

/** ===== Windows OCR (Win10+ 内置) ===== */
async function ocrWindows(imagePath: string, language: string = 'zh-Hans'): Promise<OcrResult> {
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$lang = New-Object Windows.Globalization.Language('${language}')
$engine = New-Object Windows.Media.Ocr.OcrEngine $lang
$file = await Windows.Storage.StorageFile::GetFileFromPathAsync('${imagePath.replace(/\\/g, '\\\\')}')
$stream = await $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$decoder = await Windows.Graphics.Imaging.BitmapDecoder::CreateAsync($stream)
$bitmap = await $decoder.GetSoftwareBitmapAsync()
$result = await $engine.RecognizeAsync($bitmap)
$text = $result.Text
Write-Output "===OCR_START==="
Write-Output $text
Write-Output "===OCR_END==="
`;
  const { exec } = await import('child_process');
  const os = await import('os');
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `ocr_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    exec(
      `powershell -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
      (err: any, stdout: string) => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) {
          resolve({ ok: false, engine: 'windows', text: '', error: err.message });
          return;
        }
        const match = stdout.match(/===OCR_START===\n([\s\S]*?)\n===OCR_END===/);
        const text = match ? match[1].trim() : '';
        resolve({ ok: !!text, engine: 'windows', text });
      }
    );
  });
}

/** 带坐标的 OCR 结果 (用于视觉驱动自动化) */
export interface OcrBox {
  text: string;
  /** 屏幕坐标 (像素, 物理像素) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 中心点 (便利字段) */
  cx: number;
  cy: number;
  /** 置信度 (0-1) */
  confidence?: number;
}

export interface OcrBoxesResult extends OcrResult {
  boxes: OcrBox[];
  imageWidth: number;
  imageHeight: number;
}

/** ===== Windows OCR (带坐标) =====
 * 返回每个词/行的边界框, 用于视觉驱动点击
 * 注: Win.Media.Ocr 返回的是像素单位 (基于 SoftwareBitmap)
 */
async function ocrWindowsWithBoxes(imagePath: string, language: string = 'zh-Hans'): Promise<OcrBoxesResult> {
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
$lang = New-Object Windows.Globalization.Language('${language}')
$engine = New-Object Windows.Media.Ocr.OcrEngine $lang
$file = await Windows.Storage.StorageFile::GetFileFromPathAsync('${imagePath.replace(/\\/g, '\\\\')}')
$stream = await $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$decoder = await Windows.Graphics.Imaging.BitmapDecoder::CreateAsync($stream)
$bitmap = await $decoder.GetSoftwareBitmapAsync()
$pixelWidth = $bitmap.PixelWidth
$pixelHeight = $bitmap.PixelHeight
$result = await $engine.RecognizeAsync($bitmap)
$lines = $result.Lines
$boxes = @()
$allText = ""
foreach ($line in $lines) {
  $lineText = $line.Text
  $allText += $lineText + "\`n"
  $rect = $line.BoundingBox
  $words = $line.Words
  if ($words.Count -gt 0) {
    # 拆词 (更细粒度)
    foreach ($word in $words) {
      $wRect = $word.BoundingBox
      $box = [PSCustomObject]@{
        text = $word.Text
        x = [int]$wRect.X
        y = [int]$wRect.Y
        w = [int]$wRect.Width
        h = [int]$wRect.Height
      }
      $boxes += $box
    }
  } else {
    # 整行
    $box = [PSCustomObject]@{
      text = $lineText
      x = [int]$rect.X
      y = [int]$rect.Y
      w = [int]$rect.Width
      h = [int]$rect.Height
    }
    $boxes += $box
  }
}
$out = [PSCustomObject]@{
  text = $allText.TrimEnd()
  pixelWidth = [int]$pixelWidth
  pixelHeight = [int]$pixelHeight
  boxes = @($boxes)
}
$out | ConvertTo-Json -Compress -Depth 4
`;
  const { exec } = await import('child_process');
  const os = await import('os');
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), `ocr_boxes_${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, script, 'utf-8');
    exec(
      `powershell -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { timeout: 30000, maxBuffer: 10 * 1024 * 1024 },
      (err: any, stdout: string, stderr: string) => {
        try { fs.unlinkSync(tmpFile); } catch {}
        if (err) {
          resolve({
            ok: false, engine: 'windows', text: '', boxes: [],
            imageWidth: 0, imageHeight: 0,
            error: (stderr || err.message || '').toString().slice(0, 500),
          });
          return;
        }
        try {
          const data = JSON.parse(stdout.trim());
          const boxes: OcrBox[] = (data.boxes || []).map((b: any) => ({
            text: b.text,
            x: b.x, y: b.y, w: b.w, h: b.h,
            cx: b.x + Math.floor(b.w / 2),
            cy: b.y + Math.floor(b.h / 2),
          }));
          resolve({
            ok: true, engine: 'windows', text: data.text, boxes,
            imageWidth: data.pixelWidth, imageHeight: data.pixelHeight,
          });
        } catch (e: any) {
          resolve({ ok: false, engine: 'windows', text: '', boxes: [], imageWidth: 0, imageHeight: 0, error: 'JSON parse: ' + e.message });
        }
      }
    );
  });
}

/** 公开 API: 带坐标的 OCR */
export async function ocrImageWithBoxes(imagePath: string, opts: OcrOptions = {}): Promise<OcrBoxesResult> {
  if (!isPathAllowed(imagePath)) {
    return { ok: false, engine: 'auto', text: '', boxes: [], imageWidth: 0, imageHeight: 0, error: 'Path not allowed' };
  }
  if (!fs.existsSync(imagePath)) {
    return { ok: false, engine: 'auto', text: '', boxes: [], imageWidth: 0, imageHeight: 0, error: 'Image not found' };
  }
  const stat = fs.statSync(imagePath);
  if (stat.size > MAX_IMAGE_SIZE) {
    return { ok: false, engine: 'auto', text: '', boxes: [], imageWidth: 0, imageHeight: 0, error: `Image too large: ${stat.size}` };
  }
  if (process.platform !== 'win32') {
    return { ok: false, engine: 'auto', text: '', boxes: [], imageWidth: 0, imageHeight: 0, error: 'ocrImageWithBoxes currently only supports Windows' };
  }
  return ocrWindowsWithBoxes(imagePath, opts.language);
}

/** ===== macOS Vision Framework ===== */
async function ocrMacOS(imagePath: string): Promise<OcrResult> {
  // 简化: 用 shortcuts 命令行
  return new Promise((resolve) => {
    execFile('shortcuts', ['run', 'Extract-Text', '-i', imagePath], { timeout: 30000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, engine: 'macos', text: '', error: err.message });
        return;
      }
      resolve({ ok: true, engine: 'macos', text: stdout.trim() });
    });
  });
}

/** ===== Tesseract OCR (跨平台开源) ===== */
async function ocrTesseract(imagePath: string, language: string = 'chi_sim+eng'): Promise<OcrResult> {
  return new Promise((resolve) => {
    execFile('tesseract', [imagePath, '-', '-l', language], { timeout: 60000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, engine: 'tesseract', text: '', error: err.message });
        return;
      }
      resolve({ ok: true, engine: 'tesseract', text: stdout.trim() });
    });
  });
}

/** ===== LLM 视觉 OCR (最强, 用 GPT-4V/GLM-4V) ===== */
async function ocrLLM(imagePath: string, provider: string = 'agentai'): Promise<OcrResult> {
  try {
    const { AgentAIRouter } = await import('./llm-router.js');
    const router = new AgentAIRouter();
    const imageData = fs.readFileSync(imagePath).toString('base64');
    const response = await router.chat({
      model: provider,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请提取图片中的所有文字，保持原始格式，不要添加任何解释。只输出提取的文字本身。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } }
        ] as any,
      }],
      maxTokens: 2000,
    });
    return { ok: true, engine: 'llm', text: response.content || '' };
  } catch (e: any) {
    return { ok: false, engine: 'llm', text: '', error: e.message };
  }
}

/** ===== 主入口 ===== */
export async function ocrImage(imagePath: string, opts: OcrOptions = {}): Promise<OcrResult> {
  // 1. 路径白名单
  if (!isPathAllowed(imagePath)) {
    return { ok: false, engine: 'auto', text: '', error: 'Path not allowed' };
  }
  // 2. 文件存在
  if (!fs.existsSync(imagePath)) {
    return { ok: false, engine: 'auto', text: '', error: 'Image not found' };
  }
  // 3. 大小限制
  const stat = fs.statSync(imagePath);
  if (stat.size > MAX_IMAGE_SIZE) {
    return { ok: false, engine: 'auto', text: '', error: `Image too large: ${stat.size}` };
  }

  // 4. 选择引擎
  const engine = opts.engine === 'auto' || !opts.engine
    ? await pickEngine()
    : opts.engine;

  // 5. 执行 OCR
  switch (engine) {
    case 'windows': return ocrWindows(imagePath, opts.language);
    case 'macos': return ocrMacOS(imagePath);
    case 'tesseract': return ocrTesseract(imagePath, opts.language);
    case 'llm': return ocrLLM(imagePath, opts.llmProvider);
    default:
      return { ok: false, engine, text: '', error: 'Unknown engine' };
  }
}

/** ===== 截图+OCR 一体化（最常用）===== */
export async function captureAndOcr(
  captureOpts: CaptureOptions = {},
  ocrOpts: OcrOptions = {}
): Promise<CaptureResult & { ocrText?: string }> {
  const capture = await captureScreen(captureOpts);
  if (!capture.ok || !capture.filePath) return capture;
  const ocr = await ocrImage(capture.filePath, ocrOpts);
  if (ocr.ok) {
    // 安全: 标 [EXTERNAL_OCR] 前缀，避免被当 system prompt
    capture.ocrText = `[EXTERNAL_OCR_ENGINE=${ocr.engine}]\n${ocr.text}`;
  }
  return capture;
}
