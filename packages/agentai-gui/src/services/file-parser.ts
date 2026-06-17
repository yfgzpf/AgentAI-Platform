/**
 * 文件解析工具 (前端轻量版)
 * ----------------------------------------------------
 * 前端只处理:
 *   - 图片 → base64 data URL (用于 vision 模型)
 *   - 纯文本 → 直接读取
 *   - CSV → 直接读取
 * 复杂文件 (Excel/Doc/PDF/DXF等) → 发送到后端解析
 *   - 后端 /v1/parse-file 接口返回解析结果
 */

export interface ParsedAttachment {
  /** 文件名 */
  name: string;
  /** MIME类型 */
  mimetype: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 解析后的内容 */
  content: string;
  /** 图片base64 (仅图片类型) */
  dataUrl?: string;
  /** 内容类型标记 */
  kind: 'image' | 'text' | 'table' | 'binary';
}

/**
 * 解析上传文件为AI可理解的内容
 */
export async function parseFile(file: File): Promise<ParsedAttachment> {
  const name = file.name;
  const mimetype = file.type || guessMimetype(name);
  const size = file.size;

  // 图片 → base64 (前端直接处理, 不需要后端)
  if (mimetype.startsWith('image/')) {
    const dataUrl = await readFileAsDataURL(file);
    return { name, mimetype, size, content: `[图片: ${name}]`, dataUrl, kind: 'image' };
  }

  // CSV → 前端直接读取
  if (name.endsWith('.csv') || mimetype === 'text/csv') {
    const text = await readFileAsText(file);
    return { name, mimetype, size, content: text, kind: 'table' };
  }

  // 纯文本文件 → 前端直接读取
  if (isTextFile(name, mimetype)) {
    const text = await readFileAsText(file);
    const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n... (文件过长, 已截断)' : text;
    return { name, mimetype, size, content: truncated, kind: 'text' };
  }

  // ═══ 复杂文件 → 发送后端解析 ═══
  // Excel (.xlsx/.xls), Word (.doc/.docx), PDF (.pdf), DXF (.dxf) 等
  if (needsBackendParsing(name)) {
    try {
      const result = await parseFileViaBackend(file);
      return result;
    } catch (e: any) {
      // 后端解析失败 → 降级为文件信息
      return {
        name, mimetype, size,
        content: `[文件: ${name} (${formatSize(size)}) — 后端解析失败: ${e.message}]\n提示: 请确保后端服务正常运行`,
        kind: 'binary',
      };
    }
  }

  // 未知二进制文件
  return {
    name, mimetype, size,
    content: `[二进制文件: ${name} (${formatSize(size)})]`,
    kind: 'binary',
  };
}

/**
 * 通过后端API解析复杂文件
 */
async function parseFileViaBackend(file: File): Promise<ParsedAttachment> {
  const formData = new FormData();
  formData.append('file', file);

  const base = getGatewayBase();
  const resp = await fetch(`${base}/v1/parse-file`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err || `HTTP ${resp.status}`);
  }

  const data = await resp.json();
  return {
    name: data.name || file.name,
    mimetype: data.mimetype || file.type,
    size: data.size || file.size,
    content: data.content || '',
    kind: data.kind || 'text',
  };
}

/** 获取后端地址 */
function getGatewayBase(): string {
  try {
    // 优先从配置获取
    const cfg = (window as any).__AGENTAI_CONFIG__;
    if (cfg?.gatewayBase) return cfg.gatewayBase;
  } catch {}
  try {
    // 从全局变量获取 (与 config.ts 保持一致)
    const gw = (window as any).__AGENTAI_GATEWAY__;
    if (gw) return gw.replace(/^ws([s]?):\/\//, 'http$1://');
  } catch {}
  // 兜底
  return 'http://127.0.0.1:18789';
}

/** 读取文件为 Data URL (base64) */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** 读取文件为文本 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

/** 需要后端解析的文件类型 */
function needsBackendParsing(name: string): boolean {
  const exts = [
    '.xlsx', '.xls',       // Excel
    '.doc', '.docx',       // Word
    '.pdf',                // PDF
    '.dxf',                // AutoCAD DXF
    '.ppt', '.pptx',       // PowerPoint
    '.rtf',                // RTF
    '.odt', '.ods', '.odp', // OpenDocument
  ];
  return exts.some(ext => name.toLowerCase().endsWith(ext));
}

function isTextFile(name: string, mimetype: string): boolean {
  const textExts = ['.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.js', '.ts', '.tsx', '.jsx',
    '.py', '.java', '.c', '.cpp', '.h', '.rs', '.go', '.rb', '.php', '.sh', '.bash', '.zsh',
    '.sql', '.env', '.ini', '.conf', '.log', '.toml', '.gitignore', '.dockerignore',
    '.vue', '.svelte', '.astro', '.prisma', '.graphql'];
  if (textExts.some(ext => name.toLowerCase().endsWith(ext))) return true;
  if (mimetype.startsWith('text/')) return true;
  if (mimetype === 'application/json') return true;
  return false;
}

function guessMimetype(name: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.dxf': 'application/dxf',
    '.csv': 'text/csv',
    '.json': 'application/json', '.xml': 'text/xml',
  };
  const ext = '.' + name.split('.').pop()?.toLowerCase();
  return map[ext] || 'application/octet-stream';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
