// @ts-nocheck
/**
 * Admin Routes - 框架切换、状态查看、会话管理、能力探针
 * ----------------------------------------------------
 * 暴露给 GUI / 桌面端的内部管理端点
 */
import { Router } from 'express';
import { CapabilityProbe } from '../capability-probe.js';
export function createAdminRouter(deps) {
    const r = Router();
    // ===== 框架状态 =====
    r.get('/admin/frameworks', (_req, res) => {
        if (!deps.frameworkSwitcher) {
            return res.status(503).json({ error: 'FrameworkSwitcher not available' });
        }
        res.json({
            status: deps.frameworkSwitcher.status(),
            list: deps.frameworkSwitcher.list(),
        });
    });
    // ===== 切换框架 =====
    r.post('/admin/frameworks/switch', (req, res) => {
        if (!deps.frameworkSwitcher) {
            return res.status(503).json({ error: 'FrameworkSwitcher not available' });
        }
        const { to, abRatio, drain, timeoutMs } = req.body;
        if (!to || !['agentai', 'pulseflow'].includes(to)) {
            return res.status(400).json({ error: 'Invalid target framework. Must be agentai or pulseflow' });
        }
        deps.frameworkSwitcher.switch({ to, abRatio, drain, timeoutMs }).then((result) => {
            res.json(result);
        }).catch((err) => {
            res.status(500).json({ error: String(err) });
        });
    });
    // ===== 会话管理 =====
    r.get('/admin/sessions', (_req, res) => {
        if (!deps.sessionManager) {
            return res.status(503).json({ error: 'SessionManager not available' });
        }
        res.json(deps.sessionManager.stats());
    });
    r.post('/admin/sessions/clear', (_req, res) => {
        if (!deps.sessionManager) {
            return res.status(503).json({ error: 'SessionManager not available' });
        }
        deps.sessionManager.clear();
        res.json({ ok: true, message: 'All sessions cleared' });
    });
    // ===== Capability Probe =====
    r.get('/admin/probe/models', (req, res) => {
        // 查询要 probe 的模型
        const models = req.query.models || 'agentai,deepseek,openai';
        const quick = req.query.quick === 'true';
        if (!deps.router) {
            return res.status(503).json({ error: 'Router not available' });
        }
        const probe = new CapabilityProbe(deps.router);
        const runAll = async () => {
            const results = [];
            for (const model of models.split(',')) {
                try {
                    if (quick) {
                        results.push(await probe.runQuickProbe(model.trim()));
                    }
                    else {
                        results.push(await probe.runAll(model.trim()));
                    }
                }
                catch (e) {
                    results.push({ model: model.trim(), error: e.message });
                }
            }
            return results;
        };
        runAll().then((results) => {
            res.json(results);
        }).catch((err) => {
            res.status(500).json({ error: String(err) });
        });
    });
    return r;
}
