/**
 * Soul Layer API Routes
 * ----------------------------------------------------
 * GET  /v1/soul/status    — 全部灵魂状态 (梦境/情绪/好奇心/辩论)
 * GET  /v1/soul/dreams    — 梦境历史
 * POST /v1/soul/dream     — 手动触发梦境
 * GET  /v1/soul/curiosity — 未解问题队列
 * GET  /v1/soul/insights  — 近期洞察
 * GET  /v1/soul/mood      — 当前情绪状态
 * GET  /v1/soul/debates   — 辩论历史
 */
import { Router, Request, Response } from 'express';

export const soulRouter = Router();

/**
 * 从请求解析 workspace —— 串味修复
 * ================================================
 * soul 7 模块已改为 per-workspace 实例，本路由的所有查询必须带上
 * workspace，否则会命中 `__default__` 桶（进程级默认），导致：
 *   - 前端看到的是默认工作区的状态，而非当前工作区的
 *   - 与 agentai-loop 注入的上下文不是同一份数据
 *
 * 优先级: ?workspace= 查询参数 > x-workspace 头 > 默认工作区
 */
function wsOf(req: Request): string {
  const q = (req.query.workspace as string) || '';
  if (q) return q;
  const h = (req.headers['x-workspace'] as string) || '';
  if (h) return h;
  // 兜底: 默认工作区（与 index.ts 启动 DreamEngine 时用的一致）
  return (globalThis as any).__agentaiDefaultWorkspace || '';
}

// GET /v1/soul/status — 全部灵魂状态
soulRouter.get('/soul/status', async (req: Request, res: Response) => {
  try {
    const ws = wsOf(req);
    const { getDreamEngine, getInnerVoice, getPainSense, getCuriosityEngine, getInternalDebate } = await import('../soul/index.js');
    const dream = getDreamEngine(undefined, ws);
    const painSense = getPainSense(ws);
    const curiosity = getCuriosityEngine(ws);
    const debate = getInternalDebate(ws);
    const innerVoice = getInnerVoice(ws);

    const dreamStats = {
      dreaming: dream.isDreaming(),
      recentDreams: dream.getRecentDreams(3),
    };
    const emotionState = painSense.getState();
    const curiosityStats = curiosity.getStats();
    const curiosityPending = curiosity.getPendingQuestions().slice(0, 5);
    const curiosityInsights = curiosity.getInsights().slice(-3);
    const debateHistory = debate.getHistory().slice(-2);
    const innerThoughts = innerVoice.getRecentThoughts(3);

    res.json({
      ok: true,
      data: {
        dream: dreamStats,
        emotion: emotionState,
        curiosity: {
          stats: curiosityStats,
          pending: curiosityPending,
          insights: curiosityInsights,
        },
        debate: debateHistory,
        innerVoice: innerThoughts,
      },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message || 'soul status failed' });
  }
});

// GET /v1/soul/dreams — 梦境历史
soulRouter.get('/soul/dreams', async (req: Request, res: Response) => {
  try {
    const { getDreamEngine } = await import('../soul/index.js');
    const dreams = getDreamEngine(undefined, wsOf(req)).getRecentDreams(20);
    res.json({ ok: true, data: dreams });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// POST /v1/soul/dream — 手动触发梦境
soulRouter.post('/soul/dream', async (req: Request, res: Response) => {
  try {
    const { getDreamEngine } = await import('../soul/index.js');
    const trigger = req.body?.trigger || 'manual';
    const result = await getDreamEngine(undefined, wsOf(req)).dream(trigger);
    res.json({ ok: true, data: result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// GET /v1/soul/curiosity — 未解问题
soulRouter.get('/soul/curiosity', async (req: Request, res: Response) => {
  try {
    const { getCuriosityEngine } = await import('../soul/index.js');
    const engine = getCuriosityEngine(wsOf(req));
    res.json({
      ok: true,
      data: {
        stats: engine.getStats(),
        pending: engine.getPendingQuestions(),
        insights: engine.getInsights(),
      },
    });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// GET /v1/soul/mood — 当前情绪
soulRouter.get('/soul/mood', async (req: Request, res: Response) => {
  try {
    const { getPainSense } = await import('../soul/index.js');
    res.json({ ok: true, data: getPainSense(wsOf(req)).getState() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// GET /v1/soul/debates — 辩论历史
soulRouter.get('/soul/debates', async (req: Request, res: Response) => {
  try {
    const { getInternalDebate } = await import('../soul/index.js');
    res.json({ ok: true, data: getInternalDebate(wsOf(req)).getHistory() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});
