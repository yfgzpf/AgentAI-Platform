/**
 * 成本追踪器
 * 岐枢 | PulseFlow - 第九章成本控制规范
 *
 * 职责：
 * 1. 追踪每个任务的token消耗
 * 2. 记录各阶段成本明细
 * 3. 生成成本摘要
 * 4. 触发成本告警
 */

import { EventEmitter } from 'events';
import {
  TaskCostSummary,
  PhaseCost,
  CostAlert,
  CostRating,
  DiagnosisPhase,
  ModelTier,
} from './types.js';
import { getCostBudget, COST_RATING_THRESHOLDS, isWithinBudget } from './config.js';

/**
 * 成本追踪器
 */
export class CostTracker extends EventEmitter {
  private activeTasks: Map<string, {
    startTime: number;
    breakdown: Map<string, PhaseCost>;
    totalTokens: number;
    taskType: string;
    complexity: string;
  }>;
  
  private dailyStats: {
    date: string;
    totalTokens: number;
    taskCount: number;
  };
  
  private budget;
  
  constructor() {
    super();
    this.activeTasks = new Map();
    this.dailyStats = {
      date: new Date().toISOString().slice(0, 10),
      totalTokens: 0,
      taskCount: 0,
    };
    this.budget = getCostBudget();
    
    // 每日重置统计
    this.scheduleDailyReset();
  }
  
  /**
   * 开始追踪任务
   */
  startTask(taskId: string, sessionId: string, userId: string, taskType: string, complexity: string): void {
    this.activeTasks.set(taskId, {
      startTime: Date.now(),
      breakdown: new Map(),
      totalTokens: 0,
      taskType,
      complexity,
    });
    
    console.log(`[cost] 📊 开始追踪任务 | taskId=${taskId} type=${taskType}`);
  }
  
  /**
   * 记录阶段成本
   */
  recordPhase(
    taskId: string,
    phase: DiagnosisPhase | string,
    tokens: number,
    model: string,
    modelTier: ModelTier,
    details?: Record<string, any>
  ): void {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`[cost] ⚠️ 任务未找到 | taskId=${taskId}`);
      return;
    }
    
    // 更新或创建阶段记录
    const existing = task.breakdown.get(phase);
    if (existing) {
      existing.tokens += tokens;
      existing.calls += 1;
    } else {
      task.breakdown.set(phase, {
        phase,
        tokens,
        model,
        modelTier,
        calls: 1,
        details,
      });
    }
    
    task.totalTokens += tokens;
    
    // 检查阶段预算
    const phaseBudget = this.budget.phaseLimits[phase as DiagnosisPhase] || Infinity;
    const check = isWithinBudget(task.breakdown.get(phase)!.tokens, phaseBudget);
    
    if (!check.ok) {
      this.emit('alert', {
        id: `alert-${Date.now()}`,
        type: 'phase_exceeded',
        severity: 'critical',
        message: `阶段 ${phase} 超出预算 | 当前: ${task.breakdown.get(phase)!.tokens}, 预算: ${phaseBudget}`,
        currentValue: task.breakdown.get(phase)!.tokens,
        threshold: phaseBudget,
        taskId,
        timestamp: Date.now(),
      } as CostAlert);
    } else if (check.warning) {
      console.warn(`[cost] ⚠️ 阶段 ${phase} 接近预算 | 剩余: ${check.remaining}`);
    }
    
    console.log(`[cost] 📝 记录阶段 | taskId=${taskId} phase=${phase} tokens=${tokens} model=${model}`);
  }
  
  /**
   * 结束任务并生成摘要
   */
  endTask(taskId: string): TaskCostSummary | null {
    const task = this.activeTasks.get(taskId);
    if (!task) {
      console.warn(`[cost] ⚠️ 结束任务未找到 | taskId=${taskId}`);
      return null;
    }
    
    const endTime = Date.now();
    const duration = endTime - task.startTime;
    
    // 计算框架开销
    // 假设核心任务成本（execution阶段）为基础
    const coreCost = task.breakdown.get('execution')?.tokens || task.totalTokens * 0.7;
    const overhead = task.totalTokens - coreCost;
    const overheadPercentage = coreCost > 0 ? (overhead / coreCost) * 100 : 0;
    
    // 成本评级
    const costRating = this.getCostRating(task.totalTokens);
    
    // 检查总预算
    const totalCheck = isWithinBudget(task.totalTokens, this.budget.taskTotalLimit);
    if (!totalCheck.ok) {
      this.emit('alert', {
        id: `alert-${Date.now()}`,
        type: 'task_exceeded',
        severity: 'critical',
        message: `任务总成本超出预算 | 当前: ${task.totalTokens}, 预算: ${this.budget.taskTotalLimit}`,
        currentValue: task.totalTokens,
        threshold: this.budget.taskTotalLimit,
        taskId,
        timestamp: Date.now(),
      } as CostAlert);
    }
    
    // 检查框架开销
    if (overheadPercentage > this.budget.maxFrameworkOverhead) {
      this.emit('alert', {
        id: `alert-${Date.now()}`,
        type: 'overhead_high',
        severity: 'warning',
        message: `框架开销过高 | ${overheadPercentage.toFixed(1)}% > ${this.budget.maxFrameworkOverhead}%`,
        currentValue: overheadPercentage,
        threshold: this.budget.maxFrameworkOverhead,
        taskId,
        timestamp: Date.now(),
      } as CostAlert);
    }
    
    // 生成摘要
    const summary: TaskCostSummary = {
      taskId,
      sessionId: '', // 需要从外部传入
      userId: '', // 需要从外部传入
      totalTokens: task.totalTokens,
      breakdown: Object.fromEntries(task.breakdown),
      frameworkOverheadPercentage: parseFloat(overheadPercentage.toFixed(1)),
      costRating,
      taskType: task.taskType,
      complexity: task.complexity,
      startTime: task.startTime,
      endTime,
      duration,
    };
    
    // 更新日统计
    this.dailyStats.totalTokens += task.totalTokens;
    this.dailyStats.taskCount += 1;
    
    // 检查日预算
    const dailyCheck = isWithinBudget(this.dailyStats.totalTokens, this.budget.dailyLimit);
    if (!dailyCheck.ok) {
      this.emit('alert', {
        id: `alert-${Date.now()}`,
        type: 'daily_exceeded',
        severity: 'critical',
        message: `日预算超出 | 当前: ${this.dailyStats.totalTokens}, 预算: ${this.budget.dailyLimit}`,
        currentValue: this.dailyStats.totalTokens,
        threshold: this.budget.dailyLimit,
        timestamp: Date.now(),
      } as CostAlert);
    }
    
    // 清理任务记录
    this.activeTasks.delete(taskId);
    
    // 输出成本摘要
    this.logSummary(summary);
    
    // 触发完成事件
    this.emit('taskComplete', summary);
    
    console.log(`[cost] ✅ 任务完成 | taskId=${taskId} total=${task.totalTokens} rating=${costRating}`);
    
    return summary;
  }
  
  /**
   * 获取成本评级
   */
  private getCostRating(tokens: number): CostRating {
    if (tokens <= COST_RATING_THRESHOLDS.low) return 'low';
    if (tokens <= COST_RATING_THRESHOLDS.medium) return 'medium';
    if (tokens <= COST_RATING_THRESHOLDS.high) return 'high';
    return 'critical';
  }
  
  /**
   * 输出成本摘要
   */
  private logSummary(summary: TaskCostSummary): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 任务成本摘要');
    console.log('='.repeat(60));
    console.log(`任务ID: ${summary.taskId}`);
    console.log(`任务类型: ${summary.taskType}`);
    console.log(`复杂度: ${summary.complexity}`);
    console.log(`总Token: ${summary.totalTokens}`);
    console.log(`框架开销: ${summary.frameworkOverheadPercentage}%`);
    console.log(`成本评级: ${summary.costRating}`);
    console.log(`执行时长: ${summary.duration}ms`);
    console.log('\n阶段明细:');
    for (const [phase, cost] of Object.entries(summary.breakdown)) {
      console.log(`  ${phase}: ${cost.tokens} tokens (${cost.modelTier})`);
    }
    console.log('='.repeat(60) + '\n');
  }
  
  /**
   * 获取日统计
   */
  getDailyStats(): { date: string; totalTokens: number; taskCount: number; avgCost: number } {
    return {
      ...this.dailyStats,
      avgCost: this.dailyStats.taskCount > 0 
        ? Math.round(this.dailyStats.totalTokens / this.dailyStats.taskCount)
        : 0,
    };
  }
  
  /**
   * 每日重置
   */
  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
      console.log(`[cost] 🌅 日统计重置 | 昨日: ${this.dailyStats.totalTokens} tokens, ${this.dailyStats.taskCount} 任务`);
      this.dailyStats = {
        date: new Date().toISOString().slice(0, 10),
        totalTokens: 0,
        taskCount: 0,
      };
      this.scheduleDailyReset();
    }, msUntilMidnight);
  }
}

// 单例实例
let globalTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!globalTracker) {
    globalTracker = new CostTracker();
  }
  return globalTracker;
}

export function resetCostTracker(): void {
  globalTracker = null;
}
