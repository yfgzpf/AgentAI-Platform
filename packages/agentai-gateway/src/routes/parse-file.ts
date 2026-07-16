/**
 * 文件解析路由
 * ----------------------------------------------------
 * 前端上传复杂文件 (Excel/Word/PDF/DXF等), 后端解析为文本
 * 支持自动安装缺失依赖 → 系统自安装能力
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import * as util from 'util';

const execFileAsync = util.promisify(execFile);
const r = Router();

// multer 配置: 内存存储, 限制50MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ═══ 依赖自动安装缓存 ═══
const installedDeps = new Set<string>();
const installingDeps = new Map<string, Promise<boolean>>();

/**
 * 自动安装npm依赖
 * 系统自安装能力: 缺什么装什么, 不用用户操心
 */
export async function autoInstall(packageName: string): Promise<boolean> {
  if (installedDeps.has(packageName)) return true;
  if (installingDeps.has(packageName)) return installingDeps.get(packageName)!;

  const promise = (async () => {
    try {
      console.log(`[parse-file] 自动安装依赖: ${packageName}`);
      const gwDir = path.resolve(process.cwd(), '..', 'agentai-gateway');
      await execFileAsync('npm', ['install', packageName], {
        cwd: gwDir,
        timeout: 60000,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      installedDeps.add(packageName);
      console.log(`[parse-file] 依赖安装成功: ${packageName}`);
      return true;
    } catch (e: any) {
      console.error(`[parse-file] 依赖安装失败: ${packageName}`, e.message);
      return false;
    } finally {
      installingDeps.delete(packageName);
    }
  })();

  installingDeps.set(packageName, promise);
  return promise;
}

/**
 * 安全导入模块, 缺失时自动安装
 */
export async function safeImport(moduleName: string, packageName?: string): Promise<any> {
  try {
    return await import(moduleName);
  } catch {
    // 模块缺失 → 自动安装
    const pkg = packageName || moduleName;
    const installed = await autoInstall(pkg);
    if (!installed) return null;
    // 清除require缓存后重试
    try {
      delete require.cache[require.resolve(moduleName)];
    } catch {}
    try {
      return await import(moduleName);
    } catch {
      return null;
    }
  }
}

// ═══ 文件解析器 ═══

/** 解析Excel (.xlsx/.xls) */
export async function parseExcel(buffer: Buffer, filename: string): Promise<{ content: string; kind: string }> {
  const XLSX = await safeImport('xlsx');
  if (!XLSX) {
    return { content: `[Excel文件: ${filename} — 解析失败: xlsx库不可用, 自动安装也失败]`, kind: 'table' };
  }
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const lines: string[] = [`[Excel文件: ${filename}, ${wb.SheetNames.length}个工作表]\n`];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_csv(ws);
    const rows = data.split('\n').filter((r: string) => r.trim());
    const maxRows = 200;
    lines.push(`\n--- 工作表: ${sheetName} (${rows.length}行) ---`);
    lines.push(...rows.slice(0, maxRows));
    if (rows.length > maxRows) lines.push(`... (还有 ${rows.length - maxRows} 行)`);
  }
  return { content: lines.join('\n'), kind: 'table' };
}

/** 解析Word (.docx) */
export async function parseDocx(buffer: Buffer, filename: string): Promise<{ content: string; kind: string }> {
  const mammoth = await safeImport('mammoth');
  if (!mammoth) {
    return { content: `[Word文件: ${filename} — 解析失败: mammoth库不可用, 自动安装也失败]`, kind: 'text' };
  }
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  const truncated = text.length > 80000 ? text.slice(0, 80000) + '\n... (文件过长, 已截断)' : text;
  return { content: `[Word文件: ${filename}]\n\n${truncated}`, kind: 'text' };
}

/** 解析PDF */
export async function parsePdf(buffer: Buffer, filename: string): Promise<{ content: string; kind: string }> {
  const pdfParse = await safeImport('pdf-parse');
  if (!pdfParse) {
    return { content: `[PDF文件: ${filename} — 解析失败: pdf-parse库不可用, 自动安装也失败]`, kind: 'text' };
  }
  const data = await pdfParse(buffer);
  const text = data?.text ?? ''; // 扫描版 PDF 可能无 text 字段
  const truncated = text.length > 80000 ? text.slice(0, 80000) + '\n... (文件过长, 已截断)' : text;
  return { content: `[PDF文件: ${filename}, ${data?.numpages ?? 0}页]\n\n${truncated || '(PDF 无可提取文字, 可能是扫描版)' }`, kind: 'text' };
}

/** 解析DXF (AutoCAD) */
export async function parseDxf(buffer: Buffer, filename: string): Promise<{ content: string; kind: string }> {
  // DXF是文本格式, 可以直接读取
  const text = buffer.toString('utf-8');
  const lines = text.split('\n');
  // 提取关键实体信息
  const entities: string[] = [];
  let inEntity = false;
  let entityType = '';
  let entityData: string[] = [];
  let count = 0;
  const maxEntities = 100;

  for (let i = 0; i < lines.length && count < maxEntities; i++) {
    const cur = lines[i];
    if (!cur) continue;
    const line = cur.trim();
    if (line === 'ENTITIES') {
      inEntity = true;
      continue;
    }
    if (line === 'ENDSEC' && inEntity) {
      if (entityType) {
        entities.push(`  ${entityType}: ${entityData.join(', ')}`);
        count++;
      }
      inEntity = false;
      entityType = '';
      entityData = [];
      continue;
    }
    const next = lines[i + 1];
    if (inEntity && line === '0' && next) {
      if (entityType) {
        entities.push(`  ${entityType}: ${entityData.join(', ')}`);
        count++;
      }
      entityType = next.trim();
      entityData = [];
    }
    // 提取TEXT内容
    if (line === '1' && next) {
      entityData.push(`text="${next.trim()}"`);
    }
    // 提取图层
    if (line === '8' && next) {
      entityData.push(`layer="${next.trim()}"`);
    }
  }

  const summary = entities.length > 0
    ? `\n提取到 ${entities.length} 个实体:\n${entities.join('\n')}`
    : '\n(未提取到实体信息, 文件可能为空或格式异常)';

  const truncated = summary.length > 50000 ? summary.slice(0, 50000) + '\n... (已截断)' : summary;
  return { content: `[DXF文件: ${filename}, ${lines.length}行]\n${truncated}`, kind: 'text' };
}

/** 解析PPT (.pptx) */
export async function parsePptx(buffer: Buffer, filename: string): Promise<{ content: string; kind: string }> {
  // pptx是zip格式, 内含XML, 简单提取文本
  try {
    const JSZip = await safeImport('jszip', 'jszip');
    if (!JSZip) {
      return { content: `[PPT文件: ${filename} — 解析失败: jszip库不可用]`, kind: 'text' };
    }
    const zip = await JSZip.loadAsync(buffer);
    const slides: string[] = [];
    let slideNum = 0;

    const slideFiles = Object.keys(zip.files)
      .filter(f => f.match(/ppt\/slides\/slide\d+\.xml/))
      .sort();

    for (const slideFile of slideFiles) {
      slideNum++;
      const xml = await zip.files[slideFile].async('string');
      // 简单提取 <a:t> 标签内容
      const texts = [...xml.matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m => m[1]);
      if (texts.length > 0) {
        slides.push(`\n--- 第${slideNum}页 ---\n${texts.join('\n')}`);
      }
    }

    return {
      content: `[PPT文件: ${filename}, ${slideNum}页]\n${slides.join('\n') || '(未提取到文本内容)'}`,
      kind: 'text',
    };
  } catch (e: any) {
    return { content: `[PPT文件: ${filename} — 解析失败: ${e.message}]`, kind: 'text' };
  }
}

// ═══ 路由 ═══

r.post('/v1/parse-file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, size, mimetype } = file;
    const ext = path.extname(originalname || '').toLowerCase();

    let result: { content: string; kind: string };

    switch (ext) {
      case '.xlsx':
      case '.xls':
        result = await parseExcel(buffer, originalname);
        break;

      case '.docx':
        result = await parseDocx(buffer, originalname);
        break;

      case '.doc':
        // .doc是旧格式, mammoth只支持.docx
        result = { content: `[Word文件: ${originalname} — .doc旧格式暂不支持, 请转换为.docx]`, kind: 'text' };
        break;

      case '.pdf':
        result = await parsePdf(buffer, originalname);
        break;

      case '.dxf':
        result = await parseDxf(buffer, originalname);
        break;

      case '.pptx':
        result = await parsePptx(buffer, originalname);
        break;

      case '.ppt':
        result = { content: `[PPT文件: ${originalname} — .ppt旧格式暂不支持, 请转换为.pptx]`, kind: 'text' };
        break;

      default:
        // 尝试作为文本读取
        try {
          const text = buffer.toString('utf-8');
          result = { content: text.slice(0, 50000), kind: 'text' };
        } catch {
          result = { content: `[二进制文件: ${originalname} (${size}B)]`, kind: 'binary' };
        }
    }

    return res.json({
      name: originalname,
      mimetype: mimetype || 'application/octet-stream',
      size,
      content: result.content,
      kind: result.kind,
    });
  } catch (e: any) {
    console.error('[parse-file] Error:', e);
    return res.status(500).json({ error: e.message });
  }
});

export { r as parseFileRouter };
