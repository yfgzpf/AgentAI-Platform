/**
 * /v1/session/checkpoints — 会话级 checkpoint / rewind HTTP API
 * ------------------------------------------------------
 * 2026-10-16: 补上「AI 改错了能退回任意一轮」的会话内撤销 (docs/GIT_CAPABILITY_RESEARCH.md 缺口 B)。
 *
 * 端点:
 *   GET    /v1/session/checkpoints?sessionId=&limit=   列 checkpoint (最新在前, 带改动文件数)
 *   GET    /v1/session/checkpoints/:id/files          该点跟踪了哪些文件 (rewind 预览用)
 *   POST   /v1/session/checkpoints/rewind             回滚: body { sessionId, checkpointId, apply? }
 *   DELETE /v1/session/checkpoints?sessionId=         清空某会话的 checkpoint 历史
 *
 * 安全设计 (与 module 一致, 端点层不放松):
 *   - **默认 apply=false 只出计划**: 前端必须先给用户看 "将恢复 N 个 / 删除 M 个" 再确认
 *   - 只回滚该 checkpoint 跟踪过的文件; 未跟踪的文件 (用户自己改的、bash 改的) 一律不碰
 *   - 目标必须仍在原工作区内 (x-workspace / query.workspace 决定), 否则跳过
 *   - 这是**破坏性操作** (会覆盖磁盘上的代码) → 只给 GUI/人调, 不注册成 AI 工具
 *     (参照 pentest 的人类确认端点: AI 工具集里没有对应工具)
 */
import { Router } from 'express';
import * as path from 'path';
import { currentRequestWorkspace } from '../request-scope.js';
import { WorkspaceManager } from '../workspace-manager.js';
import { listCheckpoints, rewind, clearSession, sessionCheckpointUsage, getCheckpointFiles, logRewind, readRewindLog } from '../session-checkpoint.js';

export const sessionCheckpointRouter = Router();

function resolveWs(req: any): string {
  const q = (req.query?.workspace as string) || '';
  const bodyWs = (req.body?.workspace as string) || '';
  const explicit = (bodyWs || q || '').trim();
  let ws = explicit || currentRequestWorkspace();
  if (!ws) {
    try { ws = WorkspaceManager.getInstance().projectDir; } catch { /* 未初始化 */ }
  }
  ws = ws || process.cwd();
  return path.resolve(ws);
}

/** sessionId: body/query → header fallback (前端按会话维度传) */
function resolveSessionId(req: any): string {
  const raw = String(req.body?.sessionId || req.query?.sessionId || req.headers['x-session-id'] || '').trim();
  if (!raw) return '';
  // 与模块内消毒规则一致: 只允许安全字符, 防目录穿越
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/** 列 checkpoint */
sessionCheckpointRouter.get('/v1/session/checkpoints', (req, res) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId 必填 (query/header x-session-id)' });
    const limit = Math.min(Number(req.query?.limit) || 50, 200);
    res.json({ ok: true, sessionId, checkpoints: listCheckpoints(sessionId, limit), usage: sessionCheckpointUsage(sessionId) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** 该点跟踪的文件清单 (rewind 前给用户看"会动哪些文件") */
sessionCheckpointRouter.get('/v1/session/checkpoints/:id/files', (req, res) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId 必填' });
    const files = getCheckpointFiles(sessionId, req.params.id);
    res.json({ ok: true, sessionId, checkpointId: req.params.id, count: files.length, files });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/**
 * 回滚到指定 checkpoint。
 * apply 缺省 = false → 只返回计划 (restored/deleted/unchanged/skipped 都是"将会怎样")。
 * apply=true 才真写盘 —— 调用方 (GUI) 必须在用户确认后发。
 */
sessionCheckpointRouter.post('/v1/session/checkpoints/rewind', (req, res) => {
  try {
    const sessionId = resolveSessionId(req);
    const checkpointId = String(req.body?.checkpointId || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId 必填' });
    if (!checkpointId) return res.status(400).json({ ok: false, error: 'checkpointId 必填' });
    const workspace = resolveWs(req);
    const apply = req.body?.apply === true;
    const result = rewind(sessionId, checkpointId, { apply, workspaceRoot: workspace });
    // 破坏性操作留痕 (dryRun 预览也记, 便于事后看"当时打算改什么")
    logRewind(sessionId, result, { workspaceRoot: workspace, actor: String(req.body?.actor || 'human') });
    res.json({ ...result, workspace, note: result.dryRun ? 'dryRun: 未改动任何文件, 加 apply:true 才真回滚' : undefined });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** 回滚留痕 (审计: 谁在什么时候把哪个点回滚了、动了哪些文件) */
sessionCheckpointRouter.get('/v1/session/checkpoints/rewind-log', (req, res) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId 必填' });
    res.json({ ok: true, sessionId, entries: readRewindLog(sessionId, Math.min(Number(req.query?.limit) || 100, 500)) });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

/** 清空某会话的 checkpoint 历史 (用户显式要求删) */
sessionCheckpointRouter.delete('/v1/session/checkpoints', (req, res) => {
  try {
    const sessionId = resolveSessionId(req);
    if (!sessionId) return res.status(400).json({ ok: false, error: 'sessionId 必填' });
    const ok = clearSession(sessionId);
    res.json({ ok, sessionId, cleared: ok });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

export default sessionCheckpointRouter;