/**
 * 会话管理路由 (/api/sessions)
 * 列出所有 checkpoint + 查询某 session 的消息历史
 */
import { Router, Request, Response } from 'express';
import { PersistentMemory } from '../persistent-memory.js';
import { getPersistentMemory as getPM } from '../persistent-memory.js';

const router = Router();

// ===== 获取 persistentMemory 实例 =====
function getMem(deps: Record<string, any>): PersistentMemory {
  if (deps?.persistentMemory) return deps.persistentMemory;
  return getPM();
}

/**
 * GET /api/sessions
 * 列出所有持久化的 checkpoint
 */
router.get('/', (_req: Request, res: Response) => {
  const pm = getMem((_req as any).app?.locals?.deps);
  const checkpoints = pm.listCheckpoints();
  res.json({
    success: true,
    count: checkpoints.length,
    sessions: checkpoints,
  });
});

/**
 * GET /api/sessions/:id
 * 获取指定 session 的 checkpoint 详情
 */
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem((req as any).app?.locals?.deps);
  const cp = pm.getCheckpoint(id);
  if (!cp) {
    return res.status(404).json({ success: false, error: 'Checkpoint not found' });
  }
  res.json({ success: true, checkpoint: cp });
});

/**
 * GET /api/sessions/:id/messages
 * 获取指定 session 的消息历史
 */
router.get('/:id/messages', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem((req as any).app?.locals?.deps);
  const messages = pm.getMessages(id);
  res.json({ success: true, sessionId: id, count: messages.length, messages });
});

/**
 * DELETE /api/sessions/:id
 * 删除指定 session 的 checkpoint
 */
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, error: 'Missing session ID' });
  const pm = getMem((req as any).app?.locals?.deps);
  pm.deleteCheckpoint(id);
  res.json({ success: true, sessionId: id });
});

export { router as sessionsRouter };
