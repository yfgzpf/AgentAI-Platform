/**
 * routes/subagent-artifacts — 子智能体「任务产物」REST 接口
 * ----------------------------------------------------------------
 * 2026-10-21 新增。
 *
 * 用途:
 *   ① 前端「子任务产物」面板读取产物列表/详情
 *   ② 等待唤醒的前端轮询: 判断"我等的子任务跑完了没"
 *   ③ 用户手动清理
 *
 * 落盘位置: {workspace}/.agentai/subagent-artifacts/{subId}.json
 *   (按富哥拍板: 不脱敏, 全量原样落盘)
 */
import { Router, Request, Response } from 'express';
import {
  listArtifacts,
  loadArtifact,
  deleteArtifact,
  artifactsDir,
} from '../subagent-artifacts.js';
import { listSubagents, runningForSession, allFinishedForSession } from '../subagent-registry.js';

export function createSubagentArtifactsRouter(): Router {
  const router = Router();

  /**
   * GET /api/subagent-artifacts?workspace=F:\xxx
   * 列出该工作区的全部产物 (含运行中的, 运行中的来自注册表)
   */
  router.get('/', (req: Request, res: Response) => {
    const workspace = (req.query.workspace as string) || '';
    try {
      const saved = listArtifacts(workspace);
      // 合并注册表里"还在跑"的 (可能还没落盘最终态)
      const savedIds = new Set(saved.map(a => a.id));
      const running = listSubagents()
        .filter(r => r.workspace === workspace && r.status === 'running' && !savedIds.has(r.id))
        .map(r => ({
          id: r.id,
          type: r.type,
          task: r.task,
          status: 'running' as const,
          transcript: [],
          toolCalls: 0,
          parentSessionId: r.parentSessionId,
          workspace: r.workspace,
          startedAt: r.startedAt,
          updatedAt: r.startedAt,
        }));
      const all = [...running, ...saved].map(a => ({
        ...a,
        // ★ 2026-10-21: alive — 子智能体是网关进程内的 detached Promise,
        //   **网关一重启全部蒸发**。磁盘上 status='running' 的产物在重启后就是僵尸:
        //   注册表 (内存) 没有对应 running 记录 → 它永远不会自己跑完。
        //   前端据此把僵尸显示成"已中断"并触发唤醒, 而不是永远转圈。
        //   (竞态兜底: registerSubagent 先于 saveArtifact 执行, 正常流程不会误判)
        alive: a.status !== 'running'
          || listSubagents().some(r => r.id === a.id && r.status === 'running'),
      }));
      res.json({
        success: true,
        count: all.length,
        dir: artifactsDir(workspace),
        artifacts: all,
      });
    } catch (e: any) {
      res.json({ success: false, error: e?.message, artifacts: [] });
    }
  });

  /**
   * GET /api/subagent-artifacts/status?workspace=xxx&sessionId=xxx
   * 等待唤醒用: 该会话还有几个子任务在跑 / 是否全部完成
   */
  router.get('/status', (req: Request, res: Response) => {
    const workspace = (req.query.workspace as string) || '';
    const sessionId = (req.query.sessionId as string) || '';
    try {
      const running = sessionId ? runningForSession(sessionId) : [];
      const allFinished = sessionId ? allFinishedForSession(sessionId) : true;
      res.json({
        success: true,
        sessionId,
        runningCount: running.length,
        running: running.map(r => ({ id: r.id, type: r.type, task: r.task, startedAt: r.startedAt })),
        allFinished,
        // 没有子任务注册过 → 无事可等 (前端据此不进入等待态)
        hasSubagents: sessionId ? listSubagents().some(r => r.parentSessionId === sessionId) : false,
      });
    } catch (e: any) {
      res.json({ success: false, error: e?.message, runningCount: 0, allFinished: true, hasSubagents: false });
    }
  });

  /**
   * GET /api/subagent-artifacts/:id?workspace=xxx
   * 取单个产物详情 (含完整 transcript)
   */
  router.get('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const workspace = (req.query.workspace as string) || '';
    if (!id) return res.status(400).json({ success: false, error: 'Missing artifact id' });
    const artifact = loadArtifact(workspace, id);
    if (!artifact) return res.status(404).json({ success: false, error: 'Artifact not found' });
    res.json({ success: true, artifact });
  });

  /**
   * DELETE /api/subagent-artifacts/:id?workspace=xxx
   */
  router.delete('/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const workspace = (req.query.workspace as string) || '';
    if (!id) return res.status(400).json({ success: false, error: 'Missing artifact id' });
    const ok = deleteArtifact(workspace, id);
    res.json({ success: ok });
  });

  return router;
}
