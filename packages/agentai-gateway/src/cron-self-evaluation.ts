/**
 * Cron Self Evaluation - 定时自评估系统
 * 
 * 将self-eval.ts接入cron-dispatcher，实现：
 * 1. 定期对AI输出进行量化评分
 * 2. 统计成功率、错误率趋势
 * 3. 生成自评估报告
 * 4. 触发改进建议
 */

import { EventEmitter } from 'events';
import { SelfEvaluator, ScoreCard } from './judge/self-eval.js';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// 存储路径
const EVAL_DIR = join(homedir(), '.agentai', 'self-evaluation');
const EVAL_LOG_FILE = join(EVAL_DIR, 'evaluations.jsonl');
const STATS_FILE = join(EVAL_DIR, 'stats.json');

// 确保目录存在
function ensureDir() {
  if (!existsSync(EVAL_DIR)) {
    const fs = require('fs');
    fs.mkdirSync(EVAL_DIR, { recursive: true });
  }
}

// 评估记录
interface EvaluationRecord {
  id: string;
  timestamp: string;
  query: string;
  output: string;
  persona: string;
  scoreCard: ScoreCard;
  metadata: {
    sessionId?: string;
    userId?: string;
    toolCalls?: number;
    duration?: number;
  };
}

// 统计信息
interface EvaluationStats {
  totalEvaluations: number;
  averageScore: number;
  scoreDistribution: {
    excellent: number; // 10-12
    good: number;      // 7-9
    fair: number;      // 4-6
    poor: number;      // 0-3
    failed: number;    // <0
  };
  trend: {
    last24h: number;
    last7d: number;
    last30d: number;
  };
  topIssues: string[];
  lastUpdated: string;
}

export class CronSelfEvaluation extends EventEmitter {
  private evaluator: SelfEvaluator;
  private evaluations: EvaluationRecord[] = [];
  private stats: EvaluationStats;

  constructor() {
    super();
    this.evaluator = new SelfEvaluator();
    this.stats = this.loadStats();
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    await ensureDir();
    this.loadHistory();
    console.log('[self-eval] 自评估系统初始化完成');
  }

  /**
   * 执行单次评估
   */
  evaluate(
    query: string,
    output: string,
    persona: string = 'general',
    metadata: EvaluationRecord['metadata'] = {}
  ): EvaluationRecord {
    const scoreCard = this.evaluator.evaluate(query, output, persona as any);
    
    const record: EvaluationRecord = {
      id: `eval-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      query,
      output: output.slice(0, 1000), // 限制长度
      persona,
      scoreCard,
      metadata,
    };

    // 保存记录
    this.saveEvaluation(record);
    
    // 更新统计
    this.updateStats(record);
    
    // 触发事件
    this.emit('evaluation:completed', record);
    
    // 低分报警
    if (scoreCard.totalScore < 5) {
      this.emit('evaluation:low-score', record);
      console.warn(`[self-eval] 低分警告: ${scoreCard.totalScore}分`, (scoreCard as any).reasons || []);
    }

    return record;
  }

  /**
   * 批量评估（用于定时任务）
   */
  async batchEvaluate(sessions: Array<{ query: string; output: string; metadata?: any }>): Promise<EvaluationRecord[]> {
    const results: EvaluationRecord[] = [];
    
    for (const session of sessions) {
      try {
        const record = this.evaluate(
          session.query,
          session.output,
          'general',
          session.metadata
        );
        results.push(record);
        
        // 间隔避免阻塞
        await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        console.error('[self-eval] 评估失败:', e);
      }
    }

    return results;
  }

  /**
   * 生成定期报告
   */
  generateReport(period: 'daily' | 'weekly' | 'monthly'): {
    period: string;
    stats: EvaluationStats;
    insights: string[];
    recommendations: string[];
  } {
    const now = Date.now();
    const periodMs = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000,
    }[period];

    const periodEvals = this.evaluations.filter(
      e => now - new Date(e.timestamp).getTime() < periodMs
    );

    const insights: string[] = [];
    const recommendations: string[] = [];

    // 分析洞察
    if (this.stats.trend.last24h < this.stats.averageScore - 2) {
      insights.push('最近24小时评分显著下降');
      recommendations.push('建议检查模型配置或提示词');
    }

    if (this.stats.scoreDistribution.failed > this.stats.totalEvaluations * 0.1) {
      insights.push('失败率超过10%');
      recommendations.push('需要审查失败案例并优化');
    }

    if (this.stats.topIssues.includes('json_format')) {
      recommendations.push('JSON格式错误较多，建议加强格式约束');
    }

    return {
      period,
      stats: this.stats,
      insights,
      recommendations,
    };
  }

  /**
   * 获取统计信息
   */
  getStats(): EvaluationStats {
    return this.stats;
  }

  /**
   * 保存评估记录
   */
  private saveEvaluation(record: EvaluationRecord): void {
    const line = JSON.stringify(record) + '\n';
    writeFileSync(EVAL_LOG_FILE, line, { flag: 'a' });
    this.evaluations.push(record);
    
    // 限制内存中数量
    if (this.evaluations.length > 1000) {
      this.evaluations = this.evaluations.slice(-500);
    }
  }

  /**
   * 加载历史记录
   */
  private loadHistory(): void {
    try {
      if (!existsSync(EVAL_LOG_FILE)) return;
      
      const content = readFileSync(EVAL_LOG_FILE, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      
      this.evaluations = lines
        .slice(-500) // 只保留最近500条
        .map(line => JSON.parse(line));
      
      console.log(`[self-eval] 加载了 ${this.evaluations.length} 条历史记录`);
    } catch (e) {
      console.error('[self-eval] 加载历史失败:', e);
    }
  }

  /**
   * 加载统计
   */
  private loadStats(): EvaluationStats {
    try {
      if (existsSync(STATS_FILE)) {
        return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
      }
    } catch (e) {
      console.error('[self-eval] 加载统计失败:', e);
    }

    return {
      totalEvaluations: 0,
      averageScore: 0,
      scoreDistribution: { excellent: 0, good: 0, fair: 0, poor: 0, failed: 0 },
      trend: { last24h: 0, last7d: 0, last30d: 0 },
      topIssues: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * 更新统计
   */
  private updateStats(record: EvaluationRecord): void {
    const score = record.scoreCard.totalScore;
    
    this.stats.totalEvaluations++;
    
    // 更新分布
    if (score >= 10) this.stats.scoreDistribution.excellent++;
    else if (score >= 7) this.stats.scoreDistribution.good++;
    else if (score >= 4) this.stats.scoreDistribution.fair++;
    else if (score >= 0) this.stats.scoreDistribution.poor++;
    else this.stats.scoreDistribution.failed++;

    // 更新平均分
    this.stats.averageScore = 
      (this.stats.averageScore * (this.stats.totalEvaluations - 1) + score) / 
      this.stats.totalEvaluations;

    // 更新趋势
    this.updateTrend();
    
    // 更新top issues
    this.updateTopIssues(record);

    this.stats.lastUpdated = new Date().toISOString();
    
    // 保存
    writeFileSync(STATS_FILE, JSON.stringify(this.stats, null, 2));
  }

  /**
   * 更新趋势
   */
  private updateTrend(): void {
    const now = Date.now();
    
    const calcAvg = (ms: number) => {
      const periodEvals = this.evaluations.filter(
        e => now - new Date(e.timestamp).getTime() < ms
      );
      if (periodEvals.length === 0) return 0;
      return periodEvals.reduce((sum, e) => sum + e.scoreCard.totalScore, 0) / periodEvals.length;
    };

    this.stats.trend = {
      last24h: calcAvg(24 * 60 * 60 * 1000),
      last7d: calcAvg(7 * 24 * 60 * 60 * 1000),
      last30d: calcAvg(30 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * 更新top issues
   */
  private updateTopIssues(record: EvaluationRecord): void {
    const issueCount = new Map<string, number>();
    
    for (const e of this.evaluations.slice(-100)) {
      for (const reason of e.scoreCard.reasons) {
        // 提取问题类型
        const issue = reason.includes('JSON') ? 'json_format' :
                     reason.includes('安全') ? 'safety' :
                     reason.includes('幻觉') ? 'hallucination' :
                     reason.includes('完整') ? 'completeness' :
                     'other';
        issueCount.set(issue, (issueCount.get(issue) ?? 0) + 1);
      }
    }

    this.stats.topIssues = Array.from(issueCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue]) => issue);
  }
}

// 单例导出
export const cronSelfEvaluation = new CronSelfEvaluation();
