/**
 * 知识库路由 (/v1/knowledge)
 * ----------------------------------------------------
 * 包含：
 * - 传统知识库功能（文档上传、搜索、管理）
 * - 知识探索功能（缺口检测、GitHub 探索、知识蒸馏）
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import { getKnowledgeBase } from '../industry-knowledge-base.js';
import { detectKnowledgeGaps, exploreGitHub, distillFromMultiple } from '../knowledge/index.js';
import { readMemory } from '../memory.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

export function createKnowledgeRouter(): Router {
  const router = Router();
  const kb = getKnowledgeBase();

  // ==================== 传统知识库功能 ====================

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

  // ==================== 知识探索功能 ====================

  /**
   * POST /v1/knowledge/detect-gaps
   * 检测知识缺口
   */
  router.post('/detect-gaps', async (req: Request, res: Response) => {
    try {
      const { task, domain } = req.body;
      
      if (!task) {
        return res.status(400).json({ error: 'Task is required' });
      }
      
      const result = await detectKnowledgeGaps(task, domain);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Gap detection failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /v1/knowledge/explore
   * 探索 GitHub 仓库
   */
  router.post('/explore', async (req: Request, res: Response) => {
    try {
      const { concept, maxResults = 5 } = req.body;
      
      if (!concept) {
        return res.status(400).json({ error: 'Concept is required' });
      }
      
      const result = await exploreGitHub([concept], maxResults);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Exploration failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /v1/knowledge/distill
   * 从仓库蒸馏知识
   */
  router.post('/distill', async (req: Request, res: Response) => {
    try {
      const { repos, concept } = req.body;
      
      if (!repos || !concept) {
        return res.status(400).json({ error: 'Repos and concept are required' });
      }
      
      const result = await distillFromMultiple(repos, concept);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Distillation failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /v1/knowledge/explore-stats
   * 获取探索统计信息
   */
  router.get('/explore-stats', async (_req: Request, res: Response) => {
    try {
      // 从记忆系统查询知识相关数据
      const memories = await readMemory({
        userId: 'knowledge_system',
        limit: 100,
      });
      
      const knowledgeMemories = memories.filter(m => 
        m.content?.includes('"type":"learned_knowledge"')
      );
      
      const explorationMemories = memories.filter(m =>
        m.metadata?.tags?.includes('exploration')
      );
      
      // 计算统计
      const totalKnowledgeNodes = knowledgeMemories.length;
      const totalExplorations = explorationMemories.length;
      
      // 提取置信度
      const confidences = knowledgeMemories.map(m => {
        try {
          const data = JSON.parse(m.content);
          return data.confidence || 0;
        } catch {
          return 0;
        }
      });
      
      const averageConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0;
      
      // 构建活动时间线
      const recentActivity = memories
        .filter(m => m.ts)
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, 20)
        .map(m => {
          let type: 'gap_detected' | 'exploration' | 'distillation' = 'gap_detected';
          if (m.metadata?.tags?.includes('exploration')) type = 'exploration';
          if (m.metadata?.tags?.includes('knowledge')) type = 'distillation';
          
          let concept = 'Unknown';
          try {
            const data = JSON.parse(m.content);
            concept = data.concept || data.name || 'Unknown';
          } catch {
            concept = m.entityId || 'Unknown';
          }
          
          return {
            type,
            concept,
            timestamp: m.ts || Date.now(),
          };
        });
      
      res.json({
        success: true,
        data: {
          totalExplorations,
          totalReposExplored: totalExplorations * 3,  // 估算
          totalKnowledgeNodes,
          averageConfidence,
          recentActivity,
        },
      });
    } catch (error) {
      console.error('Stats fetch failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /v1/knowledge/nodes
   * 获取知识节点列表
   */
  router.get('/nodes', async (_req: Request, res: Response) => {
    try {
      const memories = await readMemory({
        userId: 'knowledge_system',
        limit: 50,
      });
      
      const nodes = memories
        .filter(m => m.content?.includes('"type":"learned_knowledge"'))
        .map(m => {
          try {
            const data = JSON.parse(m.content);
            return {
              id: m.entityId || 'unknown',
              concept: data.concept,
              domain: data.domain,
              description: data.description,
              confidence: data.confidence,
              sources: data.sources || [],
              createdAt: m.ts,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      
      res.json({
        success: true,
        data: nodes,
      });
    } catch (error) {
      console.error('Nodes fetch failed:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  return router;
}

export default createKnowledgeRouter;
