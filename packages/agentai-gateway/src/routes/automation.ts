/**
 * 自动化引擎 REST API 路由
 * 暴露 AutomationEngine 数据给前端面板
 */
import { Router, Request, Response } from 'express';
import { getAutomationEngine, AUTOMATION_PRESETS } from '../automation-engine.js';

export function createAutomationRouter(workspace: string): Router {
  const r = Router();
  const engine = getAutomationEngine(workspace);

  // GET /v1/automation/crons — 所有定时任务
  r.get('/v1/automation/crons', (_req: Request, res: Response) => {
    try {
      const jobs = engine.listCronJobs();
      res.json({ ok: true, crons: jobs, total: jobs.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /v1/automation/rules — 所有自动化规则
  r.get('/v1/automation/rules', (_req: Request, res: Response) => {
    try {
      const rules = engine.listRules();
      res.json({ ok: true, rules, total: rules.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /v1/automation/stats — 统计概览
  r.get('/v1/automation/stats', (_req: Request, res: Response) => {
    try {
      const crons = engine.listCronJobs();
      const rules = engine.listRules();
      const tasks = engine.listBackgroundTasks();
      res.json({
        ok: true,
        stats: {
          totalCrons: crons.length,
          activeCrons: crons.filter(j => j.status === 'active').length,
          totalRules: rules.length,
          activeRules: rules.filter(j => j.status === 'active').length,
          totalTasks: tasks.length,
          activeTasks: tasks.filter(j => j.status === 'running').length,
        },
      });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /v1/automation/cron/:id/toggle — 暂停/恢复定时任务
  r.post('/v1/automation/cron/:id/toggle', (req: Request, res: Response) => {
    try {
      const job = engine.toggleCronJob(req.params.id);
      if (!job) return res.status(404).json({ ok: false, error: '未找到' });
      res.json({ ok: true, job });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // DELETE /v1/automation/cron/:id — 删除定时任务
  r.delete('/v1/automation/cron/:id', (req: Request, res: Response) => {
    try {
      const ok = engine.deleteCronJob(req.params.id);
      res.json({ ok, deleted: ok });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /v1/automation/presets — 列出预设模板
  r.get('/v1/automation/presets', (req: Request, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      let presets = AUTOMATION_PRESETS;
      if (category) presets = presets.filter(p => p.category === category);
      res.json({ ok: true, presets, total: presets.length });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /v1/automation/cron — 创建定时任务
  r.post('/v1/automation/cron', (req: Request, res: Response) => {
    try {
      const { name, expression, action, params } = req.body;
      if (!name || !expression || !action) {
        return res.status(400).json({ ok: false, error: '缺少必填字段: name, expression, action' });
      }
      const job = engine.createCronJob(name, expression, action, params || {});
      res.json({ ok: true, job });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /v1/automation/rule — 创建自动化规则
  r.post('/v1/automation/rule', (req: Request, res: Response) => {
    try {
      const { name, description, triggerType, triggerPattern, actionTool, actionParams } = req.body;
      if (!name || !triggerType || !actionTool) {
        return res.status(400).json({ ok: false, error: '缺少必填字段: name, triggerType, actionTool' });
      }
      const trigger: any = { type: triggerType };
      if (triggerPattern) trigger.pattern = triggerPattern;
      const rule = engine.createRule(name, description || '', trigger, { tool: actionTool, params: actionParams || {} });
      res.json({ ok: true, rule });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return r;
}
