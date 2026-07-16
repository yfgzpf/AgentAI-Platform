/**
 * Governor Routes — 系统管控员 AI 治理 API
 * ===========================================================================
 * 暴露动态能力矩阵、系统健康报告、模型推荐等端点给前端/桌面端。
 * 
 * 端点:
 *   GET  /governor/health          — 系统健康报告 (模型能力矩阵 + 建议)
 *   GET  /governor/models/:id      — 单个模型的动态能力详情
 *   GET  /governor/matrix          — 完整能力矩阵 (原始数据)
 *   POST /governor/flush           — 强制持久化能力矩阵
 *   GET  /governor/recommendations — 系统建议 (升级/降级/切换)
 */

import { Router, Request, Response } from 'express';

export function createGovernorRouter(): Router {
  const r = Router();

  // ===== 系统健康报告 =====
  r.get('/governor/health', async (_req: Request, res: Response) => {
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      const report = await getTracker().getHealthReport();
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ===== 单个模型的动态能力详情 =====
  r.get('/governor/models/:modelId', async (req: Request, res: Response) => {
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      const modelId = req.params.modelId;
      if (!modelId) return res.status(400).json({ error: 'modelId required' });
      const taskType = (req.query.taskType as string) || 'general';
      
      const dynCap = getTracker().getDynamicCapabilities(modelId, taskType as any);
      
      // 获取所有任务类型的统计
      const allTaskStats: Record<string, any> = {};
      for (const tt of ['coding', 'research', 'general', 'industry']) {
        const stats = getTracker().getStats(modelId, tt as any);
        if (stats) {
          allTaskStats[tt] = stats;
        }
      }
      
      res.json({
        modelId,
        dynamicCapability: dynCap,
        taskStats: allTaskStats,
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ===== 完整能力矩阵 (原始数据) =====
  r.get('/governor/matrix', async (_req: Request, res: Response) => {
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      const tracker = getTracker();
      const tracked = tracker.getTrackedModels();
      
      const matrix: Record<string, any> = {};
      for (const modelId of tracked) {
        const tasks: Record<string, any> = {};
        for (const tt of ['coding', 'research', 'general', 'industry']) {
          const stats = tracker.getStats(modelId, tt as any);
          if (stats) {
            tasks[tt] = stats;
          }
        }
        matrix[modelId] = tasks;
      }
      
      res.json({
        timestamp: Date.now(),
        trackedModels: tracked.length,
        matrix,
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ===== 强制持久化 =====
  r.post('/governor/flush', async (_req: Request, res: Response) => {
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      getTracker().flush();
      res.json({ ok: true, message: 'Capability matrix flushed to disk' });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  // ===== 系统建议 =====
  r.get('/governor/recommendations', async (_req: Request, res: Response) => {
    try {
      const { getTracker } = await import('../governor/runtime-capability-tracker.js');
      const report = await getTracker().getHealthReport();
      res.json({
        timestamp: Date.now(),
        recommendations: report.recommendations,
        tierChanges: report.models.filter(m => m.tierChanged),
      });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  return r;
}
