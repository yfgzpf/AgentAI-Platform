/**
 * Task Routes — 长任务快照管理 API
 * =================================
 * 暴露 task-snapshot.ts 的能力给前端:
 *   GET    /v1/tasks              — 列出所有任务 (可按 userId/status 过滤)
 *   GET    /v1/tasks/resumable    — 列出可恢复任务 (running/paused/abandoned)
 *   GET    /v1/tasks/:id          — 获取任务详情 (含 snapshot)
 *   GET    /v1/tasks/:id/context  — 获取格式化的恢复上下文 (注入 LLM)
 *   POST   /v1/tasks/:id/status   — 标记任务状态 (completed/failed/abandoned)
 *   DELETE /v1/tasks/:id          — 删除任务
 *   POST   /v1/tasks/cleanup      — 清理过期任务 (参数: maxAgeDays)
 *   POST   /v1/tasks/:id/resume   — 标记任务为"被接管" (返回 taskId 给前端作为 chat 上下文)
 */
import { Router } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { listAllTasks, findResumableTasks, loadTaskSnapshot, markTaskStatus, cleanupTasks, formatResumeContext, deleteDirReliable, TASKS_ROOT, } from '../task-snapshot.js';
export function createTasksRouter() {
    const r = Router();
    /**
     * GET /v1/tasks
     * 列出所有任务
     * Query: userId, status, limit
     */
    r.get('/', (req, res) => {
        try {
            const userId = req.query.userId;
            const status = req.query.status;
            const workspace = req.query.workspace;
            const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
            let tasks = listAllTasks({ userId, status, workspace });
            // 过滤掉 30 分钟前还没活动的 running 任务 (实际是 abandoned)
            // (listAllTasks 内部已自动转换, 这里只是 sanity check)
            if (limit && tasks.length > limit) {
                tasks = tasks.slice(0, limit);
            }
            res.json({
                success: true,
                count: tasks.length,
                tasks,
                tasksRoot: TASKS_ROOT,
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * GET /v1/tasks/resumable
     * 列出可恢复的任务 (running/paused/abandoned)
     * Query: userId
     */
    r.get('/resumable', (req, res) => {
        try {
            const userId = req.query.userId;
            const workspace = req.query.workspace;
            const tasks = findResumableTasks(userId, workspace);
            // 同时附带恢复上下文 (注入 LLM)
            const enriched = tasks.map(t => {
                const snap = loadTaskSnapshot(t.taskId);
                const resumeContext = snap ? formatResumeContext(snap) : null;
                return { ...t, resumeContext };
            });
            res.json({
                success: true,
                count: enriched.length,
                tasks: enriched,
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * GET /v1/tasks/:id
     * 获取任务快照详情
     */
    r.get('/:id', (req, res) => {
        try {
            const { id } = req.params;
            if (!id)
                return res.status(400).json({ success: false, error: 'Missing task ID' });
            const snap = loadTaskSnapshot(id);
            if (!snap) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            res.json({ success: true, task: snap });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * GET /v1/tasks/:id/context
     * 获取格式化的恢复上下文 (用于注入 LLM system prompt)
     */
    r.get('/:id/context', (req, res) => {
        try {
            const { id } = req.params;
            if (!id)
                return res.status(400).json({ success: false, error: 'Missing task ID' });
            const snap = loadTaskSnapshot(id);
            if (!snap) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            const context = formatResumeContext(snap);
            res.json({
                success: true,
                taskId: id,
                context,
                status: snap.status,
                stage: snap.currentStage,
                progress: {
                    completed: snap.progress.completedSteps.length,
                    pending: snap.progress.pendingSteps.length,
                },
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * POST /v1/tasks/:id/status
     * 标记任务状态
     * Body: { status: 'completed'|'failed'|'abandoned', note?: string }
     */
    r.post('/:id/status', (req, res) => {
        try {
            const { id } = req.params;
            const { status, note } = req.body || {};
            if (!id)
                return res.status(400).json({ success: false, error: 'Missing task ID' });
            if (!['completed', 'failed', 'abandoned'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'status must be completed, failed, or abandoned',
                });
            }
            const ok = markTaskStatus(id, status, note);
            if (!ok) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            res.json({ success: true, taskId: id, status });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * POST /v1/tasks/:id/resume
     * 准备恢复任务 (前端调用此 API 后, 在下一条消息带上 taskId, AI 会自动加载上下文)
     * 返回 resume 提示信息, 前端可选择展示给用户确认
     */
    r.post('/:id/resume', (req, res) => {
        try {
            const { id } = req.params;
            if (!id)
                return res.status(400).json({ success: false, error: 'Missing task ID' });
            const snap = loadTaskSnapshot(id);
            if (!snap) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            const context = formatResumeContext(snap);
            res.json({
                success: true,
                taskId: id,
                goal: snap.goal,
                status: snap.status,
                context,
                suggestion: `请在下一条消息中带上 taskId="${id}", AI 将自动加载之前的进度。`,
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * DELETE /v1/tasks/:id
     * 删除任务 (不可恢复)
     */
    r.delete('/:id', (req, res) => {
        try {
            const { id } = req.params;
            if (!id)
                return res.status(400).json({ success: false, error: 'Missing task ID' });
            const taskDir = path.join(TASKS_ROOT, id);
            if (!fs.existsSync(taskDir)) {
                return res.status(404).json({ success: false, error: 'Task not found' });
            }
            // 跨平台可靠删除 (Windows 沙箱下 fs.rmSync 可能无效, 退回 cmd rmdir)
            const result = deleteDirReliable(taskDir);
            if (!result.ok) {
                return res.status(500).json({
                    success: false,
                    error: `Failed to delete: ${result.error || 'unknown'}`,
                    method: result.method,
                    taskId: id,
                });
            }
            res.json({ success: true, taskId: id, deleted: true, method: result.method });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    /**
     * POST /v1/tasks/cleanup
     * 清理过期任务 (智能: 超龄 + 无效 + 超量)
     * Body: { maxAgeDays?: number, maxTaskCount?: number, removeTrivial?: boolean }
     */
    r.post('/cleanup', (req, res) => {
        try {
            const maxAgeDays = req.body?.maxAgeDays ?? 7;
            const maxTaskCount = req.body?.maxTaskCount ?? 50;
            const removeTrivial = req.body?.removeTrivial ?? true;
            const result = cleanupTasks({ maxAgeDays, maxTaskCount, removeTrivial });
            res.json({
                success: true,
                removed: result.removed,
                byReason: result.byReason,
                maxAgeDays,
                maxTaskCount,
            });
        }
        catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    return r;
}
