// @ts-nocheck
/**
 * Admin Routes - 框架切换、状态查看、会话管理、能力探针
 * ----------------------------------------------------
 * 暴露给 GUI / 桌面端的内部管理端点
 */
import { Router, Request, Response } from 'express';
import { AgentAIRouter } from '../llm-router.js';
import { CapabilityProbe } from '../capability-probe.js';

interface AdminDeps {
  [key: string]: any;  // 允许传入额外依赖 (app.ts 传入完整 deps 对象)
  frameworkSwitcher?: any;
  sessionManager?: any;
  router?: AgentAIRouter;
}

export function createAdminRouter(deps: AdminDeps): Router {
  const r = Router();

  // ===== 框架状态 =====
  r.get('/admin/frameworks', (_req: Request, res: Response) => {
    if (!deps.frameworkSwitcher) {
      return res.status(503).json({ error: 'FrameworkSwitcher not available' });
    }
    res.json({
      status: deps.frameworkSwitcher.status(),
      list: deps.frameworkSwitcher.list(),
    });
  });

  // ===== 切换框架 =====
  r.post('/admin/frameworks/switch', (req: Request, res: Response) => {
    if (!deps.frameworkSwitcher) {
      return res.status(503).json({ error: 'FrameworkSwitcher not available' });
    }
    const { to, abRatio, drain, timeoutMs } = req.body;
    if (!to || !['openclaw', 'hermes'].includes(to)) {
      return res.status(400).json({ error: 'Invalid target framework. Must be openclaw or hermes' });
    }
    deps.frameworkSwitcher.switch({ to, abRatio, drain, timeoutMs }).then((result: any) => {
      res.json(result);
    }).catch((err: any) => {
      res.status(500).json({ error: String(err) });
    });
  });

  // ===== 会话管理 =====
  r.get('/admin/sessions', (_req: Request, res: Response) => {
    if (!deps.sessionManager) {
      return res.status(503).json({ error: 'SessionManager not available' });
    }
    res.json(deps.sessionManager.stats());
  });

  r.post('/admin/sessions/clear', (_req: Request, res: Response) => {
    if (!deps.sessionManager) {
      return res.status(503).json({ error: 'SessionManager not available' });
    }
    deps.sessionManager.clear();
    res.json({ ok: true, message: 'All sessions cleared' });
  });

  // ===== Capability Probe =====
  r.get('/admin/probe/models', (req: Request, res: Response) => {
    // 查询要 probe 的模型
    const models = (req.query.models as string) || 'agentai,deepseek,openai';
    const quick = req.query.quick === 'true';
    if (!deps.router) {
      return res.status(503).json({ error: 'Router not available' });
    }
    const probe = new CapabilityProbe(deps.router);
    const runAll = async () => {
      const results: any[] = [];
      for (const model of models.split(',')) {
        try {
          if (quick) {
            results.push(await probe.runQuickProbe(model.trim()));
          } else {
            results.push(await probe.runAll(model.trim()));
          }
        } catch (e: any) {
          results.push({ model: model.trim(), error: e.message });
        }
      }
      return results;
    };
    runAll().then((results) => {
      res.json(results);
    }).catch((err: any) => {
      res.status(500).json({ error: String(err) });
    });
  });

  return r;
}
