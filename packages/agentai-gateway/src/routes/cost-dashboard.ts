/**
 * Cost Dashboard API — 成本追踪仪表板路由
 * --------------------------------------------
 * 提供成本分析、统计、趋势等API端点
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getCostTracker } from '../cost/tracker.js';

const router = Router();
const COST_DIR = path.join(os.homedir(), '.agentai', 'cost');

// 确保目录存在
if (!fs.existsSync(COST_DIR)) {
  fs.mkdirSync(COST_DIR, { recursive: true });
}

// ===== 实时统计 =====

/**
 * GET /api/cost/dashboard — 获取成本仪表板数据
 */
router.get('/dashboard', (_req: Request, res: Response) => {
  try {
    const tracker = getCostTracker();
    const dailyStats = tracker.getDailyStats();
    
    // 读取历史数据
    const history = readCostHistory(30); // 最近30天
    
    // 计算趋势
    const trends = calculateTrends(history);
    
    // 模型使用分布
    const modelDistribution = calculateModelDistribution(history);
    
    // 任务类型分布
    const taskTypeDistribution = calculateTaskTypeDistribution(history);
    
    res.json({
      success: true,
      data: {
        today: dailyStats,
        history: history.slice(-7), // 最近7天详细数据
        trends,
        modelDistribution,
        taskTypeDistribution,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cost/stats — 获取成本统计
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const history = readCostHistory(days);
    
    const totalTokens = history.reduce((sum, h) => sum + h.totalTokens, 0);
    const totalTasks = history.reduce((sum, h) => sum + h.taskCount, 0);
    const avgTokensPerTask = totalTasks > 0 ? Math.round(totalTokens / totalTasks) : 0;
    
    // 找出最高成本日
    const maxDay = history.reduce((max, h) => h.totalTokens > max.totalTokens ? h : max, history[0] || { date: '-', totalTokens: 0 });
    
    res.json({
      success: true,
      data: {
        period: `${days} days`,
        totalTokens,
        totalTasks,
        avgTokensPerTask,
        maxCostDay: maxDay,
        estimatedCostUSD: (totalTokens / 1000 * 0.002).toFixed(4), // 估算成本 $0.002/1K tokens
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cost/trends — 获取成本趋势
 */
router.get('/trends', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const history = readCostHistory(days);
    
    // 计算7日移动平均
    const movingAvg = calculateMovingAverage(history, 7);
    
    // 预测明日成本 (简单线性回归)
    const prediction = predictNextDay(history);
    
    res.json({
      success: true,
      data: {
        daily: history,
        movingAverage: movingAvg,
        prediction,
        growthRate: calculateGrowthRate(history),
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cost/models — 获取模型使用分布
 */
router.get('/models', (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const history = readCostHistory(days);
    const distribution = calculateModelDistribution(history);
    
    res.json({
      success: true,
      data: distribution,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cost/alerts — 获取成本告警历史
 */
router.get('/alerts', (_req: Request, res: Response) => {
  try {
    const alertsFile = path.join(COST_DIR, 'alerts.jsonl');
    if (!fs.existsSync(alertsFile)) {
      return res.json({ success: true, data: [] });
    }
    
    const lines = fs.readFileSync(alertsFile, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .slice(-100) // 最近100条
      .map(line => JSON.parse(line));
    
    res.json({
      success: true,
      data: lines.reverse(), // 最新的在前
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * POST /api/cost/budget — 设置预算
 */
router.post('/budget', (req: Request, res: Response) => {
  try {
    const { dailyLimit, taskLimit, alertThreshold } = req.body;
    
    const budgetConfig = {
      dailyLimit: dailyLimit || 100000,
      taskLimit: taskLimit || 50000,
      alertThreshold: alertThreshold || 0.8,
      updatedAt: Date.now(),
    };
    
    fs.writeFileSync(
      path.join(COST_DIR, 'budget.json'),
      JSON.stringify(budgetConfig, null, 2)
    );
    
    res.json({
      success: true,
      message: 'Budget updated successfully',
      data: budgetConfig,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * GET /api/cost/budget — 获取预算设置
 */
router.get('/budget', (_req: Request, res: Response) => {
  try {
    const budgetFile = path.join(COST_DIR, 'budget.json');
    const defaultBudget = {
      dailyLimit: 100000,
      taskLimit: 50000,
      alertThreshold: 0.8,
    };
    
    if (!fs.existsSync(budgetFile)) {
      return res.json({ success: true, data: defaultBudget });
    }
    
    const budget = JSON.parse(fs.readFileSync(budgetFile, 'utf-8'));
    res.json({ success: true, data: budget });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===== 辅助函数 =====

interface DailyCost {
  date: string;
  totalTokens: number;
  taskCount: number;
  modelBreakdown?: Record<string, number>;
  taskTypeBreakdown?: Record<string, number>;
}

function readCostHistory(days: number): DailyCost[] {
  const history: DailyCost[] = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const file = path.join(COST_DIR, `${dateStr}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      history.push({ date: dateStr, ...data });
    } else {
      history.push({ date: dateStr, totalTokens: 0, taskCount: 0 });
    }
  }
  
  return history.reverse();
}

function calculateTrends(history: DailyCost[]) {
  if (history.length < 2) return { direction: 'stable', change: 0 };
  
  const firstWeek = history.slice(0, Math.floor(history.length / 2));
  const secondWeek = history.slice(Math.floor(history.length / 2));
  
  const firstAvg = firstWeek.reduce((s, h) => s + h.totalTokens, 0) / firstWeek.length;
  const secondAvg = secondWeek.reduce((s, h) => s + h.totalTokens, 0) / secondWeek.length;
  
  const change = firstAvg > 0 ? ((secondAvg - firstAvg) / firstAvg) * 100 : 0;
  
  return {
    direction: change > 5 ? 'up' : change < -5 ? 'down' : 'stable',
    change: Math.abs(change).toFixed(1),
  };
}

function calculateModelDistribution(history: DailyCost[]) {
  const distribution: Record<string, number> = {};
  
  for (const day of history) {
    if (day.modelBreakdown) {
      for (const [model, tokens] of Object.entries(day.modelBreakdown)) {
        distribution[model] = (distribution[model] || 0) + tokens;
      }
    }
  }
  
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  
  return Object.entries(distribution)
    .map(([name, tokens]) => ({
      name,
      tokens,
      percentage: total > 0 ? ((tokens / total) * 100).toFixed(1) : '0',
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

function calculateTaskTypeDistribution(history: DailyCost[]) {
  const distribution: Record<string, number> = {};
  
  for (const day of history) {
    if (day.taskTypeBreakdown) {
      for (const [type, count] of Object.entries(day.taskTypeBreakdown)) {
        distribution[type] = (distribution[type] || 0) + count;
      }
    }
  }
  
  const total = Object.values(distribution).reduce((s, v) => s + v, 0);
  
  return Object.entries(distribution)
    .map(([name, count]) => ({
      name,
      count,
      percentage: total > 0 ? ((count / total) * 100).toFixed(1) : '0',
    }))
    .sort((a, b) => b.count - a.count);
}

function calculateMovingAverage(history: DailyCost[], period: number) {
  const result = [];
  
  for (let i = period - 1; i < history.length; i++) {
    const slice = history.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, h) => s + h.totalTokens, 0) / period;
    result.push({
      date: history[i].date,
      average: Math.round(avg),
    });
  }
  
  return result;
}

function predictNextDay(history: DailyCost[]) {
  if (history.length < 3) return null;
  
  // 简单线性回归
  const n = history.length;
  const sumX = history.reduce((s, _, i) => s + i, 0);
  const sumY = history.reduce((s, h) => s + h.totalTokens, 0);
  const sumXY = history.reduce((s, h, i) => s + i * h.totalTokens, 0);
  const sumX2 = history.reduce((s, _, i) => s + i * i, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  const prediction = slope * n + intercept;
  
  return {
    predictedTokens: Math.max(0, Math.round(prediction)),
    confidence: 'medium', // 简单模型置信度中等
  };
}

function calculateGrowthRate(history: DailyCost[]) {
  if (history.length < 2) return 0;
  
  const first = history[0].totalTokens;
  const last = history[history.length - 1].totalTokens;
  
  if (first === 0) return last > 0 ? 100 : 0;
  
  return (((last - first) / first) * 100).toFixed(1);
}

export default router;
