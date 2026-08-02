/**
 * Monitoring API Routes — 系统监控面板API
 * ----------------------------------------
 * 提供进化系统、审批策略、反馈闭环的可视化数据
 */

import { Router, Request, Response } from 'express';
import { getVectorStore } from '../evolution-vector-search.js';
import { readEvolution } from '../evolution.js';
import { getApprovalEngine } from '../approval-policy.js';
import { getFeedbackLoop } from '../feedback-loop.js';
import { getModelDistiller } from '../model-distiller.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const router = Router();

// ============================================================
// 进化系统监控
// ============================================================

/**
 * GET /api/monitoring/evolution/stats
 * 获取进化系统统计
 */
router.get('/evolution/stats', (req: Request, res: Response) => {
  try {
    const entries = readEvolution(1000);
    
    // 时间分布 (最近7天)
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const dailyStats: Record<string, { success: number; failure: number }> = {};
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split('T')[0];
      dailyStats[key] = { success: 0, failure: 0 };
    }
    
    for (const entry of entries) {
      if (entry.ts > sevenDaysAgo) {
        const date = new Date(entry.ts).toISOString().split('T')[0];
        if (dailyStats[date]) {
          if (entry.success === true) {
            dailyStats[date].success++;
          } else if (entry.success === false) {
            dailyStats[date].failure++;
          }
        }
      }
    }
    
    // 失败分类统计
    const failureCategories: Record<string, number> = {};
    const errorTypes: Record<string, number> = {};
    
    for (const entry of entries.filter(e => e.success === false)) {
      const cat = entry.failureCategory || 'unknown';
      failureCategories[cat] = (failureCategories[cat] || 0) + 1;
      
      const err = entry.errorType || 'UnknownError';
      errorTypes[err] = (errorTypes[err] || 0) + 1;
    }
    
    res.json({
      totalEntries: entries.length,
      successRate: entries.length > 0 
        ? (entries.filter(e => e.success === true).length / entries.length * 100).toFixed(1)
        : 0,
      dailyStats: Object.entries(dailyStats)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, stats]) => ({ date, ...stats })),
      failureCategories,
      errorTypes,
      recentEntries: entries.slice(0, 20).map(e => ({
        ts: e.ts,
        type: e.type,
        success: e.success,
        failureCategory: e.failureCategory,
        keywords: e.keywords
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * GET /api/monitoring/evolution/distillation
 * 获取蒸馏状态
 */
router.get('/evolution/distillation', (req: Request, res: Response) => {
  try {
    const distiller = getModelDistiller();
    const distilledPath = path.join(os.homedir(), '.agentai', 'evolution', 'evolution_distilled.jsonl');
    
    let distilledCount = 0;
    if (fs.existsSync(distilledPath)) {
      distilledCount = fs.readFileSync(distilledPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .length;
    }
    
    res.json({
      distilledRules: distilledCount,
      lastDistillation: distiller.getLastDistillationTime(),
      topPatterns: distiller.getTopPatterns(10)
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 审批策略监控
// ============================================================

/**
 * GET /api/monitoring/approval/stats
 * 获取审批统计
 */
router.get('/approval/stats', (req: Request, res: Response) => {
  try {
    const engine = getApprovalEngine();
    const proposals = engine.getAllProposals();
    
    const stats = {
      total: proposals.length,
      pending: proposals.filter(p => p.status === 'pending').length,
      approved: proposals.filter(p => p.status === 'approved').length,
      rejected: proposals.filter(p => p.status === 'rejected').length,
      autoExecuted: proposals.filter(p => p.status === 'auto_executed').length,
      timeout: proposals.filter(p => p.status === 'timeout').length,
      
      byRiskLevel: {
        low: proposals.filter(p => p.policy.level === 'low').length,
        medium: proposals.filter(p => p.policy.level === 'medium').length,
        high: proposals.filter(p => p.policy.level === 'high').length,
        critical: proposals.filter(p => p.policy.level === 'critical').length,
      },
      
      averageRiskScore: proposals.length > 0
        ? (proposals.reduce((sum, p) => sum + p.riskScore, 0) / proposals.length).toFixed(1)
        : 0,
      
      recent: proposals.slice(0, 10).map(p => ({
        id: p.id,
        type: p.type,
        riskScore: p.riskScore,
        riskLevel: p.policy.level,
        status: p.status,
        timestamp: p.timestamp
      }))
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * GET /api/monitoring/approval/pending
 * 获取待审批列表
 */
router.get('/approval/pending', (req: Request, res: Response) => {
  try {
    const engine = getApprovalEngine();
    const pending = engine.getPendingProposals();
    
    res.json({
      count: pending.length,
      proposals: pending.map(p => ({
        id: p.id,
        type: p.type,
        targetFile: p.targetFile,
        description: p.description,
        riskScore: p.riskScore,
        riskLevel: p.policy.level,
        timeoutMs: p.policy.timeoutMs,
        timestamp: p.timestamp,
        elapsedMs: Date.now() - p.timestamp
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * POST /api/monitoring/approval/:id/approve
 * 审批通过
 */
router.post('/approval/:id/approve', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { approved, reviewer } = req.body;
    
    const result = getApprovalEngine().approve(id, approved, reviewer);
    
    if (!result) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }
    
    res.json({
      success: true,
      proposal: {
        id: result.id,
        status: result.status,
        riskLevel: result.policy.level
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 反馈闭环监控
// ============================================================

/**
 * GET /api/monitoring/feedback/stats
 * 获取反馈统计
 */
router.get('/feedback/stats', (req: Request, res: Response) => {
  try {
    const stats = getFeedbackLoop().getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/**
 * GET /api/monitoring/feedback/recent
 * 获取最近反馈
 */
router.get('/feedback/recent', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const feedbacks = getFeedbackLoop()
      .getAllFeedback()
      .slice(0, limit);
    
    res.json({
      count: feedbacks.length,
      feedbacks: feedbacks.map(f => ({
        id: f.id,
        type: f.type,
        rating: f.rating,
        comment: f.comment,
        tags: f.tags,
        processed: f.processed,
        timestamp: f.timestamp
      }))
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ============================================================
// 综合仪表盘
// ============================================================

/**
 * GET /api/monitoring/dashboard
 * 综合监控数据
 */
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const evolutionEntries = readEvolution(100);
    const approvalEngine = getApprovalEngine();
    const feedbackStats = getFeedbackLoop().getStats();
    
    res.json({
      timestamp: Date.now(),
      evolution: {
        totalEntries: evolutionEntries.length,
        recentSuccess: evolutionEntries.filter(e => e.success).length,
        recentFailure: evolutionEntries.filter(e => !e.success).length,
      },
      approval: {
        totalProposals: approvalEngine.getAllProposals().length,
        pending: approvalEngine.getPendingProposals().length,
        autoExecuted: approvalEngine.getAllProposals().filter(p => p.status === 'auto_executed').length,
      },
      feedback: {
        total: feedbackStats.totalCount,
        satisfaction: feedbackStats.totalCount > 0
          ? ((feedbackStats.thumbsUp / feedbackStats.totalCount) * 100).toFixed(1)
          : 0,
        trend7d: feedbackStats.trend7d
      },
      health: {
        status: 'healthy',
        components: {
          evolution: evolutionEntries.length > 0 ? 'ok' : 'empty',
          approval: 'ok',
          feedback: feedbackStats.totalCount > 0 ? 'ok' : 'empty',
          vectorSearch: 'ok'
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
