/**
 * 文件读取解码器 —— 2026-10-06
 * ========================================================================
 * 立项原因（用户实机反馈）:
 *   「AI 老报错: 修复工具链故障 → 检查 read_file 工具异常原因」
 *
 * 工具本身没坏。真正的原因是**内容被毁**，而 AI 不知道发生了什么，
 * 于是把它误判成"工具异常"，进入 auto_fix / 重试 / 报告失败的循环。
 *
 * 两个实测复现的缺陷
 * ────────────────────────────────────────────────────────────────────
 * D1 非 UTF-8 文本（GBK 中文）静默返回乱码
 *   `fs.readFileSync(p, 'utf-8')` 对非法字节**不抛错**，
 *   只是替换成 U+FFFD。实测：
 *     GBK 的"你好，世界" → "���,����"
 *   AI 拿到后无法解析任何内容 → 认为文件损坏/工具异常。
 *
 * D2 二进制文件当 UTF-8 读
 *   实测：PNG 头部 → "�PNG\r\n\u001a\n\u0000��"
 *   既浪费 token（几十 MB 塞进上下文），又误导后续判断。
 *
 * 修法：读 buffer → 判别（编码 + 二进制）→ 决定呈现方式。
 */

import * as fs from 'node:fs';

export interface ReadSmartOptions {
  /** 最大读取字节数，默认 512KB（超出截断，避免炸上下文） */
  maxBytes?: number;
}

export interface ReadSmartResult {
  /** 呈现给模型的内容（可能是提示文本而非文件内容） */
  content: string;
  /** 编码：utf-8 / gbk / latin1 / null（二进制） */
  encoding: string | null;
  /** 是否二进制文件 */
  isBinary: boolean;
  /** 是否因超限被截断 */
  truncated: boolean;
  /** 文件总字节数 */
  totalBytes: number;
}

/** 二进制文件扩展名（先判扩展名，比嗅探快且准） */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', '.tiff',
  '.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv',
  '.zip', '.rar', '.7z', '.gz', '.tar', '.xz', '.bz2',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.obj', '.class',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.db', '.sqlite', '.sqlite3', '.mdb',
  '.pyc', '.pyd', '.wasm',
]);

/**
 * 二进制嗅探
 * @param buf 文件头部字节
 */
export function sniffBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  // 魔数魔棒
  const magics: number[][] = [
    [0x89, 0x50, 0x4E, 0x47],              // PNG
    [0xFF, 0xD8, 0xFF],// JPEG
    [0x47, 0x49, 0x46, 0x38],              // GIF8
    [0x42, 0x4D],                          // BMP
    [0x50, 0x4B, 0x03, 0x04],              // ZIP (xlsx/docx)
    [0x52, 0x61, 0x72, 0x21],              // RAR
    [0x7F, 0x45, 0x4C, 0x46],// ELF
    [0x4D, 0x5A],                          // PE (exe/dll)
    [0x00, 0x61, 0x73, 0x6D],              // wasm
    [0xCA, 0xFE, 0xBA, 0xBE],              // class
  ];
  for (const m of magics) {
    if (buf.length >= m.length && m.every((b, i) => buf[i] === b)) return true;
  }
  // %PDF- (文本头但二进制体)
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return true;
  // OGG / MP4 的 ftyp box
  if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp') return true;

  // 启发式：前 8KB 里 ≥30% 是控制字符（0x00-0x08/0x0B/0x0C/0x0E-0x1F）
  const n = Math.min(buf.length, 8192);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0x00 || (b < 0x09) || (b > 0x0D && b < 0x20)) ctrl++;
  }
  return n > 0 && ctrl / n > 0.3;
}

/**
 * 编码探测
 * @returns 'utf-8' | 'gbk' | 'latin1' | null（二进制/无法判定）
 */
export function detectEncoding(buf: Buffer): string | null {
  if (sniffBinary(buf)) return null;

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return 'utf-8';
  }
  // UTF-16 BOM
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';

  // 严格 UTF-8 校验：非法序列 → 不是 utf-8
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  if (!decoded.includes('\uFFFD')) return 'utf-8';

  // 出现替换字符 → 可能是 GBK/其他单双字节编码
  // 用 GBK 严格解码验证
  try {
    const gbk = new TextDecoder('gbk', { fatal: true }).decode(buf);
    if (!gbk.includes('\uFFFD')) return 'gbk';
  } catch { /* 不是合法 GBK */ }

  try {
    const latin = new TextDecoder('windows-1252', { fatal: true }).decode(buf);
    if (!latin.includes('\uFFFD')) return 'latin1';
  } catch { /* ignore */ }

  return 'latin1'; // 兜底：总比乱码好
}

/**
 * 智能读取文件
 * @param filePath 文件路径
 * @param opts maxBytes 截断上限
 */
export function readFileSmart(filePath: string, opts: ReadSmartOptions = {}): ReadSmartResult {
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();

  const totalBytes = (() => {
    try { return fs.statSync(filePath).size; } catch { return 0; }
  })();

  // 先按扩展名快速判定（避免读大文件）
  if (BINARY_EXT.has(ext)) {
    return {
      content: binaryHint(filePath, ext, totalBytes),
      encoding: null,
      isBinary: true,
      truncated: false,
      totalBytes,
    };
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e: any) {
    return {
      content: `[读取失败] ${filePath}\n原因: ${e.message}\n提示: 用 list_directory 确认路径是否存在。`,
      encoding: null,
      isBinary: false,
      truncated: false,
      totalBytes,
    };
  }

  const enc = detectEncoding(buf);
  if (enc === null) {
    return {
      content: binaryHint(filePath, ext, totalBytes),
      encoding: null,
      isBinary: true,
      truncated: false,
      totalBytes,
    };
  }

  const truncated = buf.length > maxBytes;
  const slice = truncated ? buf.slice(0, maxBytes) : buf;

  let content: string;
  try {
    content = new TextDecoder(enc).decode(slice);
  } catch {
    content = slice.toString('utf-8');
  }

  if (truncated) {
    content += `\n\n[文件过大已截断] 共 ${totalBytes} 字节，已显示前 ${maxBytes} 字节。`
      + `\n提示: 用 read_file 的 offset/limit 参数分段读取，或用 search_codebase 定位所需片段。`;
  }

  return { content, encoding: enc, isBinary: false, truncated, totalBytes };
}

/** 二进制文件的可操作提示（替代"给 AI 一堆乱码"） */
function binaryHint(filePath: string, ext: string, size: number): string {
  const kb = (size / 1024).toFixed(1);
  const special = ext === '.xlsx' || ext === '.xls'
    ? '\n提示: Excel 文件请用 read_file 直接读（本工具会自动解析为表格文本）。'
    : ext === '.pdf'
      ? '\n提示: PDF 请用 run_code + pdfplumber/PyPDF2 提取文本。'
      : ext.startsWith('.doc') || ext.startsWith('.xls') || ext.startsWith('.ppt')
        ? '\n提示: Office 文档请用 run_code + python-docx/openpyxl/python-pptx 解析。'
        : ext.startsWith('.mp4') || ext.startsWith('.mov')
          ? '\n提示: 视频请用 ffmpeg 抽帧，或直接用 UI 上传该文件。'
          : '';
  return `[二进制文件] ${filePath} (${ext || '未知类型'}, ${kb} KB)\n`
    + '这不是文本文件，无法作为代码/文本读取，已跳过其内容。'
    + (special || '\n提示: 如需查看内容，请用对应的专用工具或让用户提供截图/描述。');
}