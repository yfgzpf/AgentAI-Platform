/**
 * 行业知识库路由 (/v1/knowledge)
 * ----------------------------------------------------
 * - POST /v1/knowledge/upload        上传文档 (text/plain)
 * - POST /v1/knowledge/upload-file   上传文件 (JSON text)
 * - POST /v1/knowledge/upload-raw   上传文件 (multipart, 支持 Excel/Word/PDF/DXF/图片)
 * - GET  /v1/knowledge/search        BM25 搜索
 * - GET  /v1/knowledge/list          列出文档
 * - DELETE /v1/knowledge/:id         删除文档
 * - GET  /v1/knowledge/stats         统计信息
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import { getKnowledgeBase } from '../industry-knowledge-base.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function createKnowledgeRouter(): Router {
  const router = Router();
  const kb = getKnowledgeBase();

  /**
   * POST /v1/knowledge/upload
   * Body: { name, text, industry, description? }
   */
  router.post('/upload', (req: Request, res: Response) => {
    try {
      const { name, text, industry, description } = req.body || {};
      if (!name || !text || !industry) {
        res.status(400).json({ ok: false, error: 'name, text, industry required' });
        return;
      }
      const doc = kb.addTextDocument(name, text, industry, 'upload', description);
      res.json({ ok: true, doc });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Upload failed' });
    }
  });

  /**
   * POST /v1/knowledge/upload-file
   * 上传文件(支持 txt/md)，自动读取文本内容
   */
  router.post('/upload-file', (req: Request, res: Response) => {
    try {
      const { name, industry, content, description } = req.body || {};
      if (!name || !content || !industry) {
        res.status(400).json({ ok: false, error: 'name, content, industry required' });
        return;
      }
      const doc = kb.addTextDocument(name, content, industry, 'upload', description);
      res.json({ ok: true, doc, message: `✅ 已导入「${name}」(${doc.charCount} 字符, ${doc.chunkCount} 个片段)` });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Upload failed' });
    }
  });

  /**
   * POST /v1/knowledge/upload-raw
   * 上传原始文件 (multipart)，自动解析并导入知识库
   * 支持: .xlsx, .xls, .docx, .pdf, .dxf, .pptx, .txt, .md, 图片
   */
  router.post('/upload-raw', upload.single('file'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ ok: false, error: 'No file uploaded' });
        return;
      }

      const industry = req.body.industry as string || 'general';
      const description = req.body.description as string || `通过文件上传 (${new Date().toLocaleDateString()})`;
      const { buffer, originalname, mimetype } = file;
      const ext = path.extname(originalname || '').toLowerCase();

      // 解析文件内容
      let content = '';
      let kind = 'text';

      switch (ext) {
        case '.xlsx':
        case '.xls': {
          const { parseExcel } = await import('./parse-file.js');
          const r = await parseExcel(buffer, originalname);
          content = r.content;
          kind = r.kind;
          break;
        }
        case '.docx': {
          const { parseDocx } = await import('./parse-file.js');
          const r = await parseDocx(buffer, originalname);
          content = r.content;
          break;
        }
        case '.pdf': {
          const { parsePdf } = await import('./parse-file.js');
          const r = await parsePdf(buffer, originalname);
          content = r.content;
          break;
        }
        case '.dxf': {
          const { parseDxf } = await import('./parse-file.js');
          const r = await parseDxf(buffer, originalname);
          content = r.content;
          break;
        }
        case '.pptx': {
          const { parsePptx } = await import('./parse-file.js');
          const r = await parsePptx(buffer, originalname);
          content = r.content;
          break;
        }
        case '.txt':
        case '.md':
        case '.csv':
          content = buffer.toString('utf-8').slice(0, 100000);
          break;
        default:
          // 图片等二进制 → 存文件名和描述
          content = `[${ext.toUpperCase()}文件: ${originalname}] 类型: ${mimetype}, 大小: ${(buffer.length / 1024).toFixed(1)}KB`;
          kind = 'binary';
      }

      // 存入知识库
      const doc = kb.addTextDocument(
        originalname.replace(ext, ''),
        content,
        industry,
        'upload',
        `${description} (${ext})`,
      );

      res.json({
        ok: true,
        doc,
        message: `✅ 已导入「${originalname}」(${doc.charCount} 字符, ${doc.chunkCount} 个片段)`,
        kind,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Upload failed' });
    }
  });

  /**
   * POST /v1/knowledge/import-text
   * AI 工具调用: 直接将文本导入知识库
   */
  router.post('/import-text', (req: Request, res: Response) => {
    try {
      const { name, industry, content, description } = req.body || {};
      if (!name || !content || !industry) {
        res.status(400).json({ ok: false, error: 'name, content, industry required' });
        return;
      }
      const doc = kb.addTextDocument(name, content, industry, 'ai_auto', description);
      res.json({ ok: true, doc, message: `✅ 已导入行业知识「${name}」` });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Import failed' });
    }
  });

  /**
   * GET /v1/knowledge/search?q=xxx&industry=xxx&topK=5
   */
  router.get('/search', (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const industry = req.query.industry as string || undefined;
      const topK = parseInt(req.query.topK as string) || 5;
      if (!q) {
        res.status(400).json({ ok: false, error: 'q (query) required' });
        return;
      }
      const results = kb.search(q, industry, topK);
      res.json({ ok: true, results, count: results.length });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Search failed' });
    }
  });

  /**
   * GET /v1/knowledge/list?industry=xxx
   */
  router.get('/list', (req: Request, res: Response) => {
    try {
      const industry = req.query.industry as string || undefined;
      const docs = kb.listDocuments(industry);
      res.json({ ok: true, documents: docs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'List failed' });
    }
  });

  /**
   * DELETE /v1/knowledge/:id
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const ok = kb.removeDocument(req.params.id!);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'Document not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Delete failed' });
    }
  });

  /**
   * GET /v1/knowledge/stats
   */
  router.get('/stats', (_req: Request, res: Response) => {
    try {
      const stats = kb.getStats();
      res.json({ ok: true, stats });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || 'Stats failed' });
    }
  });

  return router;
}
