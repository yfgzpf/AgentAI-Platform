/**
 * 用量统计 REST API
 */
import { Router } from 'express';
import { getDailyStats, getWeeklyStats, getSuccessRate } from '../usage-stats.js';
export const statsRouter = Router();
// 模型性能指标 (供前端 useModelMetrics hook 使用)
statsRouter.get('/v1/metrics/models', async (_req, res) => {
    try {
        // 动态导入 model-metrics-service 避免循环依赖
        const { modelMetrics } = await import('../model-metrics-service.js');
        const stats = modelMetrics.getAllStats();
        res.json({ ok: true, models: stats });
    }
    catch (e) {
        console.error('[stats] Failed to get model metrics:', e);
        res.status(500).json({ ok: false, error: e.message });
    }
});
statsRouter.get('/v1/stats/daily', (req, res) => {
    try {
        const date = req.query.date;
        const workspace = process.cwd();
        const stats = getDailyStats(workspace, date);
        res.json({ ok: true, stats });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
statsRouter.get('/v1/stats/weekly', (_req, res) => {
    try {
        const workspace = process.cwd();
        const stats = getWeeklyStats(workspace);
        res.json({ ok: true, stats });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
statsRouter.get('/v1/stats/success-rate', (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const workspace = process.cwd();
        const rate = getSuccessRate(workspace, days);
        res.json({ ok: true, successRate: rate, days });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
