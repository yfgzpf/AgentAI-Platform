/**
 * TrustLadder - 信任阶梯动态授权系统
 * 
 * 创新理念：每个工具/技能/领域有动态信任分数(0-100)
 * 随表现自动升降，不同等级对应不同自主权
 * 
 * 从全局开关 → 三维粒度(工具×技能×领域)动态授权
 */

import { EventEmitter } from 'events';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface TrustMetrics {
  /** 成功率 (0-1) */
  successRate: number;
  /** 执行次数 */
  executionCount: number;
  /** 平均延迟(ms) */
  averageLatency: number;
  /** 用户反馈分数 (-1到1) */
  userFeedback: number;
  /** 最后一次执行时间 */
  lastExecutionAt: number;
  /** 连续成功次数 */
  consecutiveSuccesses: number;
  /** 连续失败次数 */
  consecutiveFailures: number;
}

export interface TrustLadderEntry {
  /** 实体ID (工具名/技能名/领域) */
  entityId: string;
  /** 实体类型 */
  entityType: 'tool' | 'skill' | 'domain';
  /** 当前信任分数 (0-100) */
  trustScore: number;
  /** 信任等级 */
  level: TrustLevel;
  /** 指标 */
  metrics: TrustMetrics;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

export type TrustLevel = 
  | 'untrusted'    // 0-20: 不信任，需要人工确认
  | 'limited'      // 21-40: 有限信任，部分权限
  | 'standard'     // 41-60: 标准信任，正常权限
  | 'elevated'     // 61-80: 高度信任，扩展权限
  | 'full';        // 81-100: 完全信任，自主执行

export interface AuthorizationDecision {
  /** 是否允许 */
  allowed: boolean;
  /** 需要的确认级别 */
  confirmationLevel: 'none' | 'inform' | 'confirm' | 'approve';
  /** 原因 */
  reason: string;
  /** 当前信任分数 */
  trustScore: number;
  /** 建议 */
  suggestion?: string;
}

export interface TrustUpdateEvent {
  entityId: string;
  entityType: string;
  oldScore: number;
  newScore: number;
  oldLevel: TrustLevel;
  newLevel: TrustLevel;
  reason: string;
}

// ═══════════════════════════════════════════════════════════
// 信任阶梯核心类
// ═══════════════════════════════════════════════════════════

export class TrustLadder extends EventEmitter {
  private entries: Map<string, TrustLadderEntry> = new Map();
  
  // 配置参数
  private readonly config = {
    // 分数计算权重
    weights: {
      successRate: 0.4,
      executionCount: 0.1,
      latency: 0.1,
      userFeedback: 0.3,
      consistency: 0.1,
    },
    // 等级阈值
    thresholds: {
      untrusted: 20,
      limited: 40,
      standard: 60,
      elevated: 80,
      full: 100,
    },
    // 分数调整参数
    adjustment: {
      successBonus: 5,           // 成功加分
      failurePenalty: 10,        // 失败扣分
      consecutiveSuccessBonus: 2, // 连续成功额外加分
      consecutiveFailurePenalty: 5, // 连续失败额外扣分
      maxChangePerUpdate: 15,    // 单次最大变化
      decayRate: 0.1,            // 时间衰减率(每天)
    },
  };

  /**
   * 获取或创建信任条目
   */
  getEntry(entityId: string, entityType: 'tool' | 'skill' | 'domain'): TrustLadderEntry {
    const key = `${entityType}:${entityId}`;
    
    if (!this.entries.has(key)) {
      const entry: TrustLadderEntry = {
        entityId,
        entityType,
        trustScore: 50, // 初始标准信任
        level: 'standard',
        metrics: {
          successRate: 0.5,
          executionCount: 0,
          averageLatency: 0,
          userFeedback: 0,
          lastExecutionAt: 0,
          consecutiveSuccesses: 0,
          consecutiveFailures: 0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.entries.set(key, entry);
    }
    
    return this.entries.get(key)!;
  }

  /**
   * 记录执行结果，更新信任分数
   */
  recordExecution(
    entityId: string,
    entityType: 'tool' | 'skill' | 'domain',
    result: {
      success: boolean;
      durationMs: number;
      userFeedback?: number;
    }
  ): TrustLadderEntry {
    const entry = this.getEntry(entityId, entityType);
    const oldScore = entry.trustScore;
    const oldLevel = entry.level;
    
    // 更新指标
    const m = entry.metrics;
    m.executionCount++;
    m.lastExecutionAt = Date.now();
    
    // 更新成功率 (指数移动平均)
    const alpha = 0.3;
    m.successRate = m.successRate * (1 - alpha) + (result.success ? 1 : 0) * alpha;
    
    // 更新延迟
    if (m.averageLatency === 0) {
      m.averageLatency = result.durationMs;
    } else {
      m.averageLatency = m.averageLatency * 0.7 + result.durationMs * 0.3;
    }
    
    // 更新用户反馈
    if (result.userFeedback !== undefined) {
      m.userFeedback = m.userFeedback * 0.5 + result.userFeedback * 0.5;
    }
    
    // 更新连续成功/失败
    if (result.success) {
      m.consecutiveSuccesses++;
      m.consecutiveFailures = 0;
    } else {
      m.consecutiveFailures++;
      m.consecutiveSuccesses = 0;
    }
    
    // 计算分数变化
    let scoreChange = 0;
    
    if (result.success) {
      // 成功加分
      scoreChange += this.config.adjustment.successBonus;
      // 连续成功额外加分
      scoreChange += Math.min(m.consecutiveSuccesses, 5) * this.config.adjustment.consecutiveSuccessBonus;
    } else {
      // 失败扣分
      scoreChange -= this.config.adjustment.failurePenalty;
      // 连续失败额外扣分
      scoreChange -= Math.min(m.consecutiveFailures, 3) * this.config.adjustment.consecutiveFailurePenalty;
    }
    
    // 用户反馈影响
    if (result.userFeedback !== undefined) {
      scoreChange += result.userFeedback * 10; // -10到+10
    }
    
    // 限制单次变化
    scoreChange = Math.max(-this.config.adjustment.maxChangePerUpdate, 
                          Math.min(this.config.adjustment.maxChangePerUpdate, scoreChange));
    
    // 应用变化
    entry.trustScore = Math.max(0, Math.min(100, entry.trustScore + scoreChange));
    entry.level = this.calculateLevel(entry.trustScore);
    entry.updatedAt = Date.now();
    
    // 触发事件
    if (oldScore !== entry.trustScore || oldLevel !== entry.level) {
      const event: TrustUpdateEvent = {
        entityId,
        entityType,
        oldScore,
        newScore: entry.trustScore,
        oldLevel,
        newLevel: entry.level,
        reason: result.success ? '执行成功' : '执行失败',
      };
      this.emit('trust:updated', event);
      
      if (oldLevel !== entry.level) {
        this.emit('level:changed', event);
      }
    }
    
    return entry;
  }

  /**
   * 检查授权
   */
  checkAuthorization(
    entityId: string,
    entityType: 'tool' | 'skill' | 'domain',
    action: 'read' | 'write' | 'execute' | 'delete'
  ): AuthorizationDecision {
    const entry = this.getEntry(entityId, entityType);
    const score = entry.trustScore;
    const level = entry.level;
    
    // 根据等级和动作决定授权
    const decisions: Record<TrustLevel, Record<string, AuthorizationDecision>> = {
      untrusted: {
        read: { allowed: true, confirmationLevel: 'confirm', reason: '低信任等级', trustScore: score },
        write: { allowed: false, confirmationLevel: 'approve', reason: '不信任实体禁止写入', trustScore: score },
        execute: { allowed: false, confirmationLevel: 'approve', reason: '不信任实体禁止执行', trustScore: score },
        delete: { allowed: false, confirmationLevel: 'approve', reason: '不信任实体禁止删除', trustScore: score },
      },
      limited: {
        read: { allowed: true, confirmationLevel: 'inform', reason: '有限信任', trustScore: score },
        write: { allowed: true, confirmationLevel: 'confirm', reason: '写入需要确认', trustScore: score },
        execute: { allowed: true, confirmationLevel: 'confirm', reason: '执行需要确认', trustScore: score },
        delete: { allowed: false, confirmationLevel: 'approve', reason: '禁止删除', trustScore: score },
      },
      standard: {
        read: { allowed: true, confirmationLevel: 'none', reason: '标准信任', trustScore: score },
        write: { allowed: true, confirmationLevel: 'inform', reason: '标准权限', trustScore: score },
        execute: { allowed: true, confirmationLevel: 'inform', reason: '标准权限', trustScore: score },
        delete: { allowed: true, confirmationLevel: 'confirm', reason: '删除需要确认', trustScore: score },
      },
      elevated: {
        read: { allowed: true, confirmationLevel: 'none', reason: '高度信任', trustScore: score },
        write: { allowed: true, confirmationLevel: 'none', reason: '高度信任', trustScore: score },
        execute: { allowed: true, confirmationLevel: 'none', reason: '高度信任', trustScore: score },
        delete: { allowed: true, confirmationLevel: 'inform', reason: '删除需知情', trustScore: score },
      },
      full: {
        read: { allowed: true, confirmationLevel: 'none', reason: '完全信任', trustScore: score },
        write: { allowed: true, confirmationLevel: 'none', reason: '完全信任', trustScore: score },
        execute: { allowed: true, confirmationLevel: 'none', reason: '完全信任', trustScore: score },
        delete: { allowed: true, confirmationLevel: 'none', reason: '完全信任', trustScore: score },
      },
    };
    
    return decisions[level][action] || {
      allowed: false,
      confirmationLevel: 'approve',
      reason: '未知等级或动作',
      trustScore: score,
    };
  }

  /**
   * 获取信任报告
   */
  getTrustReport(entityId?: string): any {
    if (entityId) {
      const entry = Array.from(this.entries.values()).find(e => e.entityId === entityId);
      return entry || null;
    }
    
    // 整体报告
    const entries = Array.from(this.entries.values());
    const byType = {
      tool: entries.filter(e => e.entityType === 'tool'),
      skill: entries.filter(e => e.entityType === 'skill'),
      domain: entries.filter(e => e.entityType === 'domain'),
    };
    
    return {
      total: entries.length,
      byType: {
        tool: { count: byType.tool.length, avgScore: this.avg(byType.tool.map(e => e.trustScore)) },
        skill: { count: byType.skill.length, avgScore: this.avg(byType.skill.map(e => e.trustScore)) },
        domain: { count: byType.domain.length, avgScore: this.avg(byType.domain.map(e => e.trustScore)) },
      },
      byLevel: {
        untrusted: entries.filter(e => e.level === 'untrusted').length,
        limited: entries.filter(e => e.level === 'limited').length,
        standard: entries.filter(e => e.level === 'standard').length,
        elevated: entries.filter(e => e.level === 'elevated').length,
        full: entries.filter(e => e.level === 'full').length,
      },
      topTrusted: entries
        .sort((a, b) => b.trustScore - a.trustScore)
        .slice(0, 10)
        .map(e => ({ id: e.entityId, type: e.entityType, score: e.trustScore })),
      bottomTrusted: entries
        .sort((a, b) => a.trustScore - b.trustScore)
        .slice(0, 10)
        .map(e => ({ id: e.entityId, type: e.entityType, score: e.trustScore })),
    };
  }

  /**
   * 手动调整信任分数（管理员功能）
   */
  adjustTrust(
    entityId: string,
    entityType: 'tool' | 'skill' | 'domain',
    newScore: number,
    reason: string
  ): TrustLadderEntry {
    const entry = this.getEntry(entityId, entityType);
    const oldScore = entry.trustScore;
    const oldLevel = entry.level;
    
    entry.trustScore = Math.max(0, Math.min(100, newScore));
    entry.level = this.calculateLevel(entry.trustScore);
    entry.updatedAt = Date.now();
    
    this.emit('trust:manual-adjust', {
      entityId,
      entityType,
      oldScore,
      newScore: entry.trustScore,
      oldLevel,
      newLevel: entry.level,
      reason,
    });
    
    return entry;
  }

  // ═══════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════

  private calculateLevel(score: number): TrustLevel {
    if (score <= this.config.thresholds.untrusted) return 'untrusted';
    if (score <= this.config.thresholds.limited) return 'limited';
    if (score <= this.config.thresholds.standard) return 'standard';
    if (score <= this.config.thresholds.elevated) return 'elevated';
    return 'full';
  }

  private avg(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

// 单例导出
let trustLadderInstance: TrustLadder | null = null;

export function getTrustLadder(): TrustLadder {
  if (!trustLadderInstance) {
    trustLadderInstance = new TrustLadder();
  }
  return trustLadderInstance;
}
