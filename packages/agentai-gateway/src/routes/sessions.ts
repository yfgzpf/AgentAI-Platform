/**
 * 会话管理路由 (/api/sessions)
 * 列出所有 checkpoint + 查询某 session 的消息历史
 */
import { Router, Request, Response } from 'express';
import type { PersistentMemory } from '../persistent-memory.js';
import { readMemory } from '../memory.js';

export function createSessionsRouter(persistentMemory?: PersistentMemory): Router {
  const router = Router();

  function getMem(): PersistentMemory | null {
    return persistentMemory || null;
  }

/**
 * POST /api/sessions
 * 创建新会话
 */
router.post('/', (req: Request, res: Response) => {
  const pm = getMem();
  if (!pm) return res.status(503).json({ success: false, error: 'Memory not available' });
  const { name, userId = 'user', workspace = '' } = req.body || {};
  const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cp = pm.createCheckpoint(sessionId, userId, workspace || name || '');
  res.json({ success: true, sessionId, checkpoint: cp });
});

/**
 * GET /api/sessions
 * 列出所有持久化的 checkpoint
 */
router.get('/', (_req: Request, res: Response) => {
  const pm = getMem();
  if (!pm) return res.json({ success: true, count: 0, sessions: [] });
  const checkpoints = pm.listCheckpoints();
  res.json({
    success: true,
    count: checkpoints.length,
    sessions: checkpoints,
  });
});

/**
 * GET /api/sessions/last?workspace=F:\xxx
 * 获取 .agentai/last-session.json (上轮会话摘要, v3.1)
 * 用于 GUI LastSessionHint 组件
 *
 * 注意: 必须在 /:id 路由之前注册, 否则 "last" 会被当成 session id
 */
router.get('/last', (req: Request, res: Response) => {
  const workspace = (req.query.workspace as string) || '';
  if (!workspace || !persistentMemory) {
    return res.json({ summary: null });
  }
  try {
    const data = persistentMemory.getLastSessionSummary(workspace);
    if (!data) return res.json({ summary: null });
    return res.json(data);
  } catch (err: any) {
    return res.json({ summary: null, error: err.message });
  }
});

/**
 * GET /api/sessions/:id
 * 获取指定 session 的 checkpoint 详情
 */
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem();
  if (!pm) return res.status(404).json({ success: false, error: 'Memory not available' });
  const cp = pm.getCheckpoint(id);
  if (!cp) {
    return res.status(404).json({ success: false, error: 'Checkpoint not found' });
  }
  res.json({ success: true, checkpoint: cp });
});

/**
 * GET /api/sessions/:id/messages
 */
router.get('/:id/messages', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem();
  if (!pm) return res.status(404).json({ success: false, error: 'Memory not available' });
  const messages = pm.getMessages(id);
  res.json({ success: true, sessionId: id, count: messages.length, messages });
});

/**
 * DELETE /api/sessions/:id
 */
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem();
  if (!pm) return res.status(404).json({ success: false, error: 'Memory not available' });
  pm.deleteCheckpoint(id);
  res.json({ success: true, sessionId: id });
});

/**
 * GET /api/sessions/last?workspace=F:\xxx
 * 获取 .agentai/last-session.json (上轮会话摘要, v3.1)
 * 用于 GUI LastSessionHint 组件
 */
router.get('/last', (req: Request, res: Response) => {
  const workspace = (req.query.workspace as string) || '';
  if (!workspace || !persistentMemory) {
    return res.json({ summary: null });
  }
  try {
    const data = persistentMemory.getLastSessionSummary(workspace);
    if (!data) return res.json({ summary: null });
    return res.json(data);
  } catch (err: any) {
    return res.json({ summary: null, error: err.message });
  }
});

  return router;
}

/**
 * GET /api/memory/stats
 * 返回记忆统计数据：项目级 + 用户级记忆条目数
 */
const memoryRouter = Router();
memoryRouter.get('/stats', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'user';
    const workspace = (req.query.workspace as string) || '';
    const projectMems = workspace ? await readMemory({ userId, workspace, limit: 9999 }) : [];
    const userMems = await readMemory({ userId, limit: 9999 });
    res.json({
      projectCount: projectMems.length,
      userCount: userMems.length,
      totalCount: projectMems.length + userMems.length,
    });
  } catch (err: any) {
    res.json({ projectCount: 0, userCount: 0, totalCount: 0, error: err.message });
  }
});

/**
 * GET /api/memory/auto-captured
 * 返回 AI 主动捕获的记忆条目 (source=auto_reflect)
 * 支持按 category 过滤, 按 importance 排序
 *
 * 2026-08-03 新增: 配合前端 AutoMemoryPanel 可视化
 */
memoryRouter.get('/auto-captured', async (req: Request, res: Response) => {
  try {
    const userId = (req.query.userId as string) || 'default';
    const workspace = (req.query.workspace as string) || '';
    const category = req.query.category as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const all = await readMemory({ userId, workspace, limit: 200 });

    // 过滤: 只返回自动捕获的 (source=auto_reflect 且有 category 元数据)
    let filtered = all.filter(m =>
      m.source === 'auto_reflect' && m.metadata?.category
    );

    // 按分类过滤
    if (category) {
      filtered = filtered.filter(m => m.metadata?.category === category);
    }

    // 按重要性排序 (importance 降序, 然后按时间降序)
    filtered.sort((a, b) => {
      const impA = (a.importance ?? 0) * 1000 + (a.ts / 1e10);
      const impB = (b.importance ?? 0) * 1000 + (b.ts / 1e10);
      return impB - impA;
    });

    // 限制数量
    const result = filtered.slice(0, limit).map(m => ({
      ts: m.ts,
      category: m.metadata?.category as string,
      title: m.metadata?.title as string,
      content: m.content,
      importance: m.importance ?? 0,
      entityId: m.entityId,
      tags: m.metadata?.tags as string[] || [],
      sourceTool: m.metadata?.sourceTool as string | undefined,
      industry: m.industry,
    }));

    // 按分类统计
    const stats: Record<string, number> = {};
    for (const m of filtered) {
      const cat = (m.metadata?.category as string) || 'unknown';
      stats[cat] = (stats[cat] || 0) + 1;
    }

    res.json({
      items: result,
      total: filtered.length,
      stats,
    });
  } catch (err: any) {
    res.json({ items: [], total: 0, stats: {}, error: err.message });
  }
});

export { memoryRouter };
