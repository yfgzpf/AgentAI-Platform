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

// GET /v1/soul/status — 全部灵魂状态
soulRouter.get('/soul/status', async (_req: Request, res: Response) => {
  try {
    const { getDreamEngine, getInnerVoice, getPainSense, getCuriosityEngine, getInternalDebate } = await import('../soul/index.js');
    const dream = getDreamEngine();
    const painSense = getPainSense();
    const curiosity = getCuriosityEngine();
    const debate = getInternalDebate();
    const innerVoice = getInnerVoice();

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
soulRouter.get('/soul/dreams', async (_req: Request, res: Response) => {
  try {
    const { getDreamEngine } = await import('../soul/index.js');
    const dreams = getDreamEngine().getRecentDreams(20);
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
    const result = await getDreamEngine().dream(trigger);
    res.json({ ok: true, data: result });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// GET /v1/soul/curiosity — 未解问题
soulRouter.get('/soul/curiosity', async (_req: Request, res: Response) => {
  try {
    const { getCuriosityEngine } = await import('../soul/index.js');
    const engine = getCuriosityEngine();
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
soulRouter.get('/soul/mood', async (_req: Request, res: Response) => {
  try {
    const { getPainSense } = await import('../soul/index.js');
    res.json({ ok: true, data: getPainSense().getState() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

// GET /v1/soul/debates — 辩论历史
soulRouter.get('/soul/debates', async (_req: Request, res: Response) => {
  try {
    const { getInternalDebate } = await import('../soul/index.js');
    res.json({ ok: true, data: getInternalDebate().getHistory() });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});
