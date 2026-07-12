/**
 * Task Scheduler Routes - 定时任务调度器 API
 * 
 * 提供任务管理、统计查询、成功率分析等功能
 */
import { Router, Request, Response } from 'express';
import { getTaskScheduler } from '../task-scheduler.js';

export function createTaskSchedulerRouter(): Router {
  const r = Router();

  /**
   * GET /v1/schedules - 获取所有定时任务
   */
  r.get('/v1/schedules', async (_req: Request, res: Response) => {
    try {
      const scheduler = getTaskScheduler();
      const schedules = scheduler.list();
      
      res.json({
        success: true,
        data: schedules,
        count: schedules.length,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /v1/schedules/stats - 获取统计信息
   */
  r.get('/v1/schedules/stats', async (_req: Request, res: Response) => {
    try {
      const scheduler = getTaskScheduler();
      const stats = scheduler.getStats();
      
      // 计算成功率
      const successRate = stats.totalRuns > 0 
        ? (stats.totalSuccess / stats.totalRuns * 100).toFixed(2)
        : '0.00';
      
      res.json({
        success: true,
        data: {
          ...stats,
          successRate: `${successRate}%`,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * GET /v1/schedules/:id - 获取单个任务详情
   */
  r.get('/v1/schedules/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const schedule = scheduler.get(id);
      
      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Schedule not found',
        });
        return;
      }
      
      // 计算成功率
      const successRate = schedule.runCount > 0
        ? (schedule.successCount / schedule.runCount * 100).toFixed(2)
        : '0.00';
      
      res.json({
        success: true,
        data: {
          ...schedule,
          successRate: `${successRate}%`,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /v1/schedules - 创建新任务
   */
  r.post('/v1/schedules', async (req: Request, res: Response) => {
    try {
      const scheduler = getTaskScheduler();
      const schedule = scheduler.create(req.body);
      
      res.json({
        success: true,
        data: schedule,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /v1/schedules/:id/run - 手动执行任务
   */
  r.post('/v1/schedules/:id/run', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const result = await scheduler.runOnce(id);
      
      res.json({
        success: result.success,
        data: result,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * PATCH /v1/schedules/:id - 更新任务
   */
  r.patch('/v1/schedules/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const schedule = scheduler.update(id, req.body);
      
      if (!schedule) {
        res.status(404).json({
          success: false,
          error: 'Schedule not found',
        });
        return;
      }
      
      res.json({
        success: true,
        data: schedule,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * DELETE /v1/schedules/:id - 删除任务
   */
  r.delete('/v1/schedules/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const success = scheduler.delete(id);
      
      res.json({
        success,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /v1/schedules/:id/pause - 暂停任务
   */
  r.post('/v1/schedules/:id/pause', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const schedule = scheduler.pause(id);
      
      res.json({
        success: !!schedule,
        data: schedule,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  /**
   * POST /v1/schedules/:id/resume - 恢复任务
   */
  r.post('/v1/schedules/:id/resume', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        res.status(400).json({ success: false, error: 'Missing schedule id' });
        return;
      }
      const scheduler = getTaskScheduler();
      const schedule = scheduler.resume(id);
      
      res.json({
        success: !!schedule,
        data: schedule,
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });

  return r;
}
