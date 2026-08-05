// @ts-nocheck
/**
 * AgentTask Routes — 持久任务板 API
 * ==================================
 * 对标 Trae TodoWrite 的功能:
 *   POST /v1/agent-tasks          — 创建任务
 *   PATCH /v1/agent-tasks/:id     — 更新任务
 *   GET  /v1/agent-tasks          — 列出任务
 *   GET  /v1/agent-tasks/active   — 当前活跃任务
 *   GET  /v1/agent-tasks/next     — 下一步推荐
 *   GET  /v1/agent-tasks/context  — 任务上下文 (注入 system prompt)
 *   GET  /v1/agent-tasks/stream   — SSE 实时推送
 *   DELETE /v1/agent-tasks/:id    — 删除任务
 */
import { Router, Request, Response } from 'express';
import { AgentTaskStore, createAgentTaskStream } from '../agent-task-store.js';

export function createAgentTaskRouter() {
  const r = Router();

  function getStore(workspace = process.cwd()): AgentTaskStore {
    return AgentTaskStore.getInstance(workspace);
  }

  // GET /v1/agent-tasks — 列出任务
  r.get('/', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      const tasks = store.list({ workspace, status, limit });
      const counts = store.countByStatus(workspace);

      res.json({
        success: true,
        tasks,
        counts,
        total: tasks.length,
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /v1/agent-tasks/active — 当前正在执行的任务
  r.get('/active', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const tasks = store.getActiveTasks(workspace);
      res.json({ success: true, tasks });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /v1/agent-tasks/next — 下一步推荐
  r.get('/next', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const steps = store.getNextSteps(workspace);
      const pending = store.list({ workspace, status: 'pending', limit: 5 });
      res.json({ success: true, nextSteps: steps, pendingTasks: pending });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /v1/agent-tasks/context — 任务上下文 (注入 system prompt)
  r.get('/context', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const recent = store.getRecentTasks(workspace, 10);
      const active = store.getActiveTasks(workspace);
      const nextSteps = store.getNextSteps(workspace);

      const contextParts: string[] = [];

      if (active.length > 0) {
        contextParts.push('## 当前正在执行的任务');
        for (const t of active) {
          contextParts.push(`- [running] ${t.title} — ${t.description || ''}`);
        }
        contextParts.push('');
      }

      if (recent.length > 0) {
        contextParts.push('## 最近完成的任务 (最近 5 条)');
        for (const t of recent.slice(0, 5)) {
          contextParts.push(`- [done] ${t.title}`);
          if (t.result) contextParts.push(`  结果: ${t.result.slice(0, 200)}`);
        }
        contextParts.push('');
      }

      if (nextSteps.length > 0) {
        contextParts.push('## 推荐下一步');
        for (const s of nextSteps) contextParts.push(s);
        contextParts.push('');
      }

      const contextText = contextParts.join('\n') || '无历史任务记录';
      res.json({ success: true, context: contextText, recentCount: recent.length, activeCount: active.length });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /v1/agent-tasks — 创建任务
  r.post('/', (req: Request, res: Response) => {
    try {
      const workspace = (req.body.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const { title, description, tags = [], parentId } = req.body;

      if (!title) {
        res.status(400).json({ success: false, error: 'title is required' });
        return;
      }

      const task = store.create({
        title,
        description,
        status: 'pending',
        workspace,
        createdBy: 'ai',
        tags,
        parentId,
      });
      res.json({ success: true, task });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /v1/agent-tasks/:id — 更新任务
  r.patch('/:id', (req: Request, res: Response) => {
    try {
      const workspace = (req.body.workspace as string) || process.cwd();
      const store = getStore(workspace);
      const task = store.update(req.params.id, req.body);
      if (!task) {
        res.status(404).json({ success: false, error: 'Task not found' });
        return;
      }
      res.json({ success: true, task });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /v1/agent-tasks/:id — 删除任务
  r.delete('/:id', (req: Request, res: Response) => {
    try {
      const workspace = (req.body.workspace as string) || process.cwd();
      const store = getStore(workspace);
      // SQLite DELETE
      store['db'].prepare('DELETE FROM agent_tasks WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /v1/agent-tasks/stream — SSE 实时推送
  r.get('/stream', (req: Request, res: Response) => {
    try {
      const workspace = (req.query.workspace as string) || process.cwd();
      createAgentTaskStream(res, workspace);
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return r;
}
