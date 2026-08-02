/**
 * 用量统计 REST API
 */
import { Router, Request, Response } from 'express';
import { getDailyStats, getWeeklyStats, getSuccessRate } from '../usage-stats.js';

export const statsRouter = Router();

// 模型性能指标 (供前端 useModelMetrics hook 使用)
statsRouter.get('/v1/metrics/models', async (_req: Request, res: Response) => {
  try {
    // 动态导入 model-metrics-service 避免循环依赖
    const { modelMetrics } = await import('../model-metrics-service.js');
    const stats = modelMetrics.getAllStats();
    res.json({ ok: true, models: stats });
  } catch (e: any) {
    console.error('[stats] Failed to get model metrics:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

statsRouter.get('/v1/stats/daily', (req: Request, res: Response) => {
  try {
    const date = req.query.date as string | undefined;
    const workspace = process.cwd();
    const stats = getDailyStats(workspace, date);
    res.json({ ok: true, stats });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

statsRouter.get('/v1/stats/weekly', (_req: Request, res: Response) => {
  try {
    const workspace = process.cwd();
    const stats = getWeeklyStats(workspace);
    res.json({ ok: true, stats });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

statsRouter.get('/v1/stats/success-rate', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const workspace = process.cwd();
    const rate = getSuccessRate(workspace, days);
    res.json({ ok: true, successRate: rate, days });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});
