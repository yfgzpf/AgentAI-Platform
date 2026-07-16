/**
 * Xuanji Routes - PulseFlow 核心认知框架 API
 * 
 * 提供四诊合参、辨证推理、医案管理等功能
 */
import { Router, Request, Response } from 'express';
import { Xuanji } from '../xuanji/index.js';
import { medicalCaseManager } from '../xuanji/medical-case.js';

// Xuanji 实例
const xuanji = new Xuanji({
  enableMedicalCase: true,
  enableSimilarCaseSearch: true,
  enableAutoEvaluation: true,
});

export function createXuanjiRouter(): Router {
  const r = Router();

  /**
   * POST /v1/xuanji/diagnose - 四诊合参 + 辨证
   * 
   * 输入: { messages, context }
   * 输出: { caseId, perception, diagnosis, prescription, similarCases }
   */
  r.post('/v1/xuanji/diagnose', async (req: Request, res: Response) => {
    try {
      const { messages, context } = req.body || {};
      
      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: 'Missing required field: messages' });
        return;
      }

      const result = await xuanji.processTask(messages, context);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      console.error('[xuanji] diagnose error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Diagnose failed',
      });
    }
  });

  /**
   * POST /v1/xuanji/complete - 完成治疗，记录疗效
   * 
   * 输入: { caseId, outcome }
   * 输出: { success, data: medicalCase }
   */
  r.post('/v1/xuanji/complete', async (req: Request, res: Response) => {
    try {
      const { caseId, outcome } = req.body || {};
      
      if (!caseId) {
        res.status(400).json({ error: 'Missing required field: caseId' });
        return;
      }

      const medicalCase = await xuanji.completeTreatment(caseId, outcome);
      
      if (!medicalCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      
      res.json({
        success: true,
        data: medicalCase,
      });
    } catch (err: any) {
      console.error('[xuanji] complete error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Complete failed',
      });
    }
  });

  /**
   * GET /v1/xuanji/cases - 查询医案
   * 
   * 查询参数: patient, status, tags, limit
   */
  r.get('/v1/xuanji/cases', async (req: Request, res: Response) => {
    try {
      const { patient, status, tags, limit, startTime, endTime } = req.query;
      
      const query: any = {};
      if (patient) query.patient = patient as string;
      if (status) query.status = status as string;
      if (tags) query.tags = (tags as string).split(',');
      if (limit) query.limit = parseInt(limit as string, 10);
      if (startTime) query.startTime = startTime as string;
      if (endTime) query.endTime = endTime as string;

      const cases = xuanji.queryCases(query);
      
      res.json({
        success: true,
        data: cases,
        count: cases.length,
      });
    } catch (err: any) {
      console.error('[xuanji] query cases error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Query failed',
      });
    }
  });

  /**
   * GET /v1/xuanji/cases/:id - 获取单个医案
   */
  r.get('/v1/xuanji/cases/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Missing case id' });
        return;
      }
      const medicalCase = medicalCaseManager.getCase(id);
      
      if (!medicalCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      
      res.json({
        success: true,
        data: medicalCase,
      });
    } catch (err: any) {
      console.error('[xuanji] get case error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Get case failed',
      });
    }
  });

  /**
   * GET /v1/xuanji/stats - 获取医案统计
   */
  r.get('/v1/xuanji/stats', async (_req: Request, res: Response) => {
    try {
      const stats = xuanji.getStats();
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      console.error('[xuanji] stats error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Get stats failed',
      });
    }
  });

  /**
   * POST /v1/xuanji/cases/:id/feedback - 添加医案反馈
   * 
   * 用于人工修正医案的标签和经验
   */
  r.post('/v1/xuanji/cases/:id/feedback', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ error: 'Missing case id' });
        return;
      }
      const { tags, lessons } = req.body || {};
      
      const medicalCase = medicalCaseManager.getCase(id);
      if (!medicalCase) {
        res.status(404).json({ error: 'Case not found' });
        return;
      }
      
      // 更新标签和经验
      if (tags) {
        medicalCase.lessons.tags = [...new Set([...medicalCase.lessons.tags, ...tags])];
      }
      if (lessons) {
        if (lessons.strengths) {
          medicalCase.lessons.strengths = [...medicalCase.lessons.strengths, ...lessons.strengths];
        }
        if (lessons.weaknesses) {
          medicalCase.lessons.weaknesses = [...medicalCase.lessons.weaknesses, ...lessons.weaknesses];
        }
      }
      
      res.json({
        success: true,
        data: medicalCase,
      });
    } catch (err: any) {
      console.error('[xuanji] feedback error:', err);
      res.status(500).json({
        success: false,
        error: err.message || 'Add feedback failed',
      });
    }
  });

  return r;
}
