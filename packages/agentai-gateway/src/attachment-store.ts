/**
 * attachment-store: 用户上传的图片附件落盘
 * ------------------------------------------------------------
 * 背景 (2026-10-19 P0):
 *   用户在对话里贴截图 → GUI 转成 data URI → 网关只把它当 image_url 块塞进
 *   appendOnlyLog。**图片只活在内存里，磁盘上没有对应文件。**
 *   AI 想"读截图里的字"时只能调 ocr_image(imagePath)，而它手里没有任何真实路径，
 *   只能猜（附件名 / 上次 capture_screen 的临时路径 / 桌面路径）→ 99% 猜错 →
 *   `❌ OCR 失败: Image not found` 毫秒级失败 → 反复重试 → 烧额度 → 空响应。
 *
 * 修法: 图片注入上下文的同时，把 bytes 落到一个专用目录，并把**真实路径**写进
 *   同一条消息的文本里。AI 拿到的路径一定存在，ocr_image 一次命中。
 *
 * 存放位置: <tmpdir>/agentai-uploads/
 *   - tmpdir 在 Windows 下是 %LOCALAPPDATA%\Temp，位于用户主目录内，
 *     天然通过 path-guard 白名单（home 是允许根），不会触发 "Path not allowed"
 *   - 不写进用户工作区，避免污染项目目录 / 误入 git
 *   - 6 小时自动过期 + 最多 200 个，双闸防撑爆磁盘
 *
 * 安全: 目录独立、文件名带随机后缀，不信任用户提供的文件名做路径拼接。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const UPLOAD_DIR = path.join(os.tmpdir(), 'agentai-uploads');
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 小时过期
const MAX_FILES = 200;                 // 目录内文件数上限
const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 与 ocr.ts 的 MAX_IMAGE_SIZE 对齐(略放宽 base64 开销)
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 网关自有的临时目录 (AI 可见图片的统一落点)。
 *
 * ⚠️ 2026-10-19 关键修正: **不能假设 os.tmpdir() 在 path-guard 白名单里。**
 * 实机 TEMP=F:\temp, 而白名单根只有 cwd / projectDir / monorepo根 / home ——
 * 于是 uploads 和 capture_screen 的截图**全被 "Path not allowed" 挡在 OCR 门外**,
 * 表现为 `❌ OCR 失败: Image not found`(路径压根没到 existsSync 那一步就被拒)。
 * 修法: 所有"要被 AI 当 imagePath 用"的图片都落进这个子目录,
 * 并由 path-guard 单独授予它 (窄授权, 不放开整个 tmpdir)。
 */
export function getAppTempDir(): string {
  return UPLOAD_DIR;
}

/** 确保目录存在 (写文件前调用; path-guard 只读路径, 不要走这个) */
export function ensureAppTempDir(): void {
  ensureDir();
}

function ensureDir(): void {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
}

/** 过期清理: 超龄删 + 超量删(保留最新的), 每 5 分钟最多跑一次 */
export function cleanupUploads(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  try {
    const names = fs.readdirSync(UPLOAD_DIR).filter(n => {
      try { return fs.statSync(path.join(UPLOAD_DIR, n)).isFile(); } catch { return false; }
    });
    const withMtime = names.map(n => {
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(path.join(UPLOAD_DIR, n)).mtimeMs; } catch { /* ignore */ }
      return { name: n, mtimeMs };
    });
    // 超龄
    for (const e of withMtime) {
      if (now - e.mtimeMs > MAX_AGE_MS) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, e.name)); } catch { /* ignore */ }
      }
    }
    // 超量: 保留最新 MAX_FILES 个
    const survivors = withMtime
      .filter(e => now - e.mtimeMs <= MAX_AGE_MS)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let i = MAX_FILES; i < survivors.length; i++) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, survivors[i].name)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** data URI → Buffer; 非 data URI 或解析失败返回 null */
export function decodeDataUrl(dataUrl: string): { buf: Buffer; ext: string } | null {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(5, comma); // image/png;base64
  const isBase64 = /;base64/i.test(header);
  const mime = header.split(';')[0].trim().toLowerCase();
  const ext = mime === 'image/jpeg' ? 'jpg'
    : mime === 'image/webp' ? 'webp'
    : mime === 'image/gif' ? 'gif'
    : mime === 'image/bmp' ? 'bmp'
    : 'png';
  try {
    const payload = dataUrl.slice(comma + 1);
    const buf = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf-8');
    if (!buf.length || buf.length > MAX_IMAGE_BYTES) return null;
    return { buf, ext };
  } catch { return null; }
}

/** 由附件名猜扩展名(兜底) */
function extFromName(name?: string): string {
  if (!name) return 'png';
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name.trim());
  if (!m) return 'png';
  const e = m[1].toLowerCase();
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(e) ? (e === 'jpeg' ? 'jpg' : e) : 'png';
}

/**
 * 把单个图片附件落盘。
 * @returns 落盘后的绝对路径; 失败返回 null (不抛, 落盘失败不应阻断对话)
 */
export function saveImageAttachment(dataUrl: string, name?: string): string | null {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  ensureDir();
  cleanupUploads();
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const file = path.join(UPLOAD_DIR, `upload_${stamp}_${rand}.${decoded.ext || extFromName(name)}`);
  try {
    fs.writeFileSync(file, decoded.buf);
    return file;
  } catch { return null; }
}

/**
 * 批量处理附件: 图片 data URI 落盘, 并把路径写回 `att.savedPath`。
 * 已有且真实存在的 filePath 不重复落盘(直接用原文件)。
 * 返回成功落盘/复用的附件条数。
 */
export function persistAttachmentImages(attachments: any[]): number {
  if (!Array.isArray(attachments) || attachments.length === 0) return 0;
  let saved = 0;
  for (const att of attachments) {
    if (!att || att.kind !== 'image') continue;
    // 1) 磁盘原文件已存在 → 直接复用
    if (typeof att.filePath === 'string' && att.filePath) {
      try {
        if (fs.existsSync(att.filePath)) { att.savedPath = att.filePath; saved++; continue; }
      } catch { /* ignore */ }
    }
    // 2) data URI → 落盘
    if (typeof att.dataUrl === 'string' && att.dataUrl.startsWith('data:')) {
      const p = saveImageAttachment(att.dataUrl, att.name);
      if (p) { att.savedPath = p; saved++; }
    }
  }
  return saved;
}

/** 最近上传的文件路径(供 ocr_image 失败时给出候选), 新的在前 */
export function recentUploadPaths(limit = 8): string[] {
  try {
    return fs.readdirSync(UPLOAD_DIR)
      .map(n => {
        const full = path.join(UPLOAD_DIR, n);
        let mtimeMs = 0;
        try { mtimeMs = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
        return { full, mtimeMs };
      })
      .filter(e => e.mtimeMs > 0)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map(e => e.full);
  } catch { return []; }
}
