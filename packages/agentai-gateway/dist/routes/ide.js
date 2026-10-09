/**
 * IDE 状态路由 — 接收前端推送的编辑器状态
 * POST /v1/ide-state — 推送完整状态
 * GET  /v1/ide-state — 获取当前状态 (调试用)
 */
import { Router } from 'express';
import { updateIdeState, getIdeState, resetIdeState } from '../ide-state.js';
export const ideRouter = Router();
ideRouter.post('/ide-state', (req, res) => {
    try {
        const body = req.body;
        if (!body || typeof body !== 'object') {
            return res.status(400).json({ ok: false, error: 'invalid body' });
        }
        updateIdeState({
            openFiles: body.openFiles,
            activeFile: body.activeFile,
            diagnostics: body.diagnostics,
            isEditing: body.isEditing,
        }, body.workspace || req.headers['x-workspace']);
        res.json({ ok: true, timestamp: Date.now() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});
ideRouter.get('/ide-state', (_req, res) => {
    res.json({ ok: true, state: getIdeState() });
});
ideRouter.post('/ide-state/reset', (_req, res) => {
    resetIdeState();
    res.json({ ok: true });
});
