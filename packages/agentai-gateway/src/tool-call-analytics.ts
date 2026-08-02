/**
 * Tool Call Analytics - 工具调用历史分析系统
 * ----------------------------------------------------
 * 实现 AI 自进化闭环的关键组件：
 * 1. 收集每次工具调用的详细数据（耗时、参数、结果、重试次数）
 * 2. 分析工具使用模式，识别低效/失败模式
 * 3. 生成优化建议，触发 self-modify 流程
 * 4. 将分析结果写入 evolution，供下次对话使用
 *
 * @see docs/SELF_EVOLUTION_DESIGN.md
 */

import { writeEvolution, EvolutionEntry, ErrorType, detectErrorType, classifyFailure } from './evolution.js';

/** 单次工具调用记录 */
export interface ToolCallRecord {
  id: string;
  sessionId: string;
  timestamp: number;
  toolName: string;
  parameters: Record<string, any>;
  result?: any;
  error?: string;
  errorType?: ErrorType;
  duration: number; // 执行耗时（毫秒）
  retryCount: number; // 重试次数
  success: boolean;
  context?: {
    previousTools: string[]; // 前置工具链
    userIntent?: string; // 用户意图摘要
    taskType?: string; // 任务类型
  };
}

/** 工具统计摘要 */
export interface ToolStats {
  toolName: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  retryRate: number; // 需要重试的比例
  commonErrors: Array<{ error: string; count: number }>;
  commonParams: Record<string, any[]>; // 常用参数值
}

/** 模式识别结果 */
export interface PatternAnalysis {
  type: 'inefficiency' | 'failure_pattern' | 'optimization_opportunity' | 'redundant_call';
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  affectedTools: string[];
  frequency: number; // 出现次数
  suggestion: string;
  codeChange?: {
    targetFile: string;
    changeType: 'fix' | 'optimize' | 'refactor';
    description: string;
  };
}

/** 工具调用分析器 */
export class ToolCallAnalytics {
  private records: ToolCallRecord[] = [];
  private maxRecords: number = 1000;

  /**
   * 记录一次工具调用
   */
  record(call: Omit<ToolCallRecord, 'id' | 'timestamp'>): void {
    const record: ToolCallRecord = {
      ...call,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.records.push(record);

    // 限制内存中记录数量
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    // 实时分析：如果是失败调用，立即记录到 evolution
    if (!call.success && call.error) {
      this.analyzeFailure(record);
    }
  }

  /**
   * 批量记录（从 session 历史导入）
   */
  importFromSession(sessionId: string, toolCalls: any[]): void {
    for (const call of toolCalls) {
      this.record({
        sessionId,
        toolName: call.name || call.toolName,
        parameters: call.arguments || call.parameters || {},
        result: call.result,
        error: call.error,
        duration: call.duration || 0,
        retryCount: call.retryCount || 0,
        success: !call.error,
        context: {
          previousTools: [],
        },
      });
    }
  }

  /**
   * 获取工具统计
   */
  getToolStats(toolName?: string): ToolStats[] {
    const records = toolName
      ? this.records.filter(r => r.toolName === toolName)
      : this.records;

    const grouped = this.groupBy(records, 'toolName');

    return Object.entries(grouped).map(([name, calls]) => {
      const durations = calls.map(c => c.duration);
      const errors = calls.filter(c => c.error);
      const retries = calls.filter(c => c.retryCount > 0);

      // 统计常见错误
      const errorCounts = new Map<string, number>();
      for (const e of errors) {
        const key = (e.error || '').slice(0, 100);
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }

      // 统计常用参数
      const paramValues: Record<string, Set<any>> = {};
      for (const call of calls) {
        for (const [key, value] of Object.entries(call.parameters)) {
          if (!paramValues[key]) paramValues[key] = new Set();
          paramValues[key].add(JSON.stringify(value));
        }
      }

      return {
        toolName: name,
        totalCalls: calls.length,
        successCount: calls.filter(c => c.success).length,
        failureCount: errors.length,
        avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length || 0,
        maxDuration: Math.max(...durations, 0),
        minDuration: Math.min(...durations, Infinity),
        retryRate: retries.length / calls.length,
        commonErrors: [...errorCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([error, count]) => ({ error, count })),
        commonParams: Object.fromEntries(
          Object.entries(paramValues).map(([k, v]) => [k, [...v]])
        ),
      };
    });
  }

  /**
   * 分析低效模式
   */
  analyzeInefficiencies(): PatternAnalysis[] {
    const patterns: PatternAnalysis[] = [];
    const stats = this.getToolStats();

    for (const stat of stats) {
      // 1. 高失败率工具
      const failureRate = stat.failureCount / stat.totalCalls;
      if (failureRate > 0.3 && stat.totalCalls > 5) {
        patterns.push({
          type: 'failure_pattern',
          description: `${stat.toolName} 失败率过高 (${(failureRate * 100).toFixed(1)}%)`,
          severity: failureRate > 0.5 ? 'critical' : 'high',
          affectedTools: [stat.toolName],
          frequency: stat.failureCount,
          suggestion: `检查 ${stat.toolName} 的实现，常见错误: ${stat.commonErrors[0]?.error.slice(0, 50)}`,
          codeChange: {
            targetFile: `tools/${stat.toolName}.ts`,
            changeType: 'fix',
            description: `修复 ${stat.toolName} 的高失败率问题`,
          },
        });
      }

      // 2. 高重试率工具
      if (stat.retryRate > 0.2 && stat.totalCalls > 5) {
        patterns.push({
          type: 'inefficiency',
          description: `${stat.toolName} 需要频繁重试 (${(stat.retryRate * 100).toFixed(1)}%)`,
          severity: 'medium',
          affectedTools: [stat.toolName],
          frequency: Math.floor(stat.totalCalls * stat.retryRate),
          suggestion: `优化 ${stat.toolName} 的错误处理或增加预检查`,
          codeChange: {
            targetFile: `tools/${stat.toolName}.ts`,
            changeType: 'optimize',
            description: `减少 ${stat.toolName} 的重试需求`,
          },
        });
      }

      // 3. 耗时过长工具
      if (stat.avgDuration > 5000 && stat.totalCalls > 3) {
        patterns.push({
          type: 'optimization_opportunity',
          description: `${stat.toolName} 平均耗时过长 (${(stat.avgDuration / 1000).toFixed(1)}s)`,
          severity: stat.avgDuration > 10000 ? 'high' : 'medium',
          affectedTools: [stat.toolName],
          frequency: stat.totalCalls,
          suggestion: `考虑为 ${stat.toolName} 添加缓存或异步处理`,
        });
      }
    }

    // 4. 检测重复调用模式（相同参数连续调用）
    const redundantPatterns = this.detectRedundantCalls();
    patterns.push(...redundantPatterns);

    return patterns.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * 检测冗余调用（相同参数重复调用）
   */
  private detectRedundantCalls(): PatternAnalysis[] {
    const patterns: PatternAnalysis[] = [];
    const callGroups = this.groupBy(this.records, r =>
      `${r.toolName}:${JSON.stringify(r.parameters)}`
    );

    for (const [key, calls] of Object.entries(callGroups)) {
      if (calls.length >= 3) {
        const [toolName] = key.split(':');
        const timeSpan = Math.max(...calls.map(c => c.timestamp)) -
                        Math.min(...calls.map(c => c.timestamp));

        // 短时间内重复调用
        if (timeSpan < 60000) { // 1分钟内
          patterns.push({
            type: 'redundant_call',
            description: `${toolName} 在 ${(timeSpan / 1000).toFixed(0)}s 内被调用 ${calls.length} 次（相同参数）`,
            severity: 'medium',
            affectedTools: [toolName],
            frequency: calls.length,
            suggestion: `考虑添加调用去重或结果缓存机制`,
          });
        }
      }
    }

    return patterns;
  }

  /**
   * 分析失败并写入 evolution
   */
  private analyzeFailure(record: ToolCallRecord): void {
    if (!record.error) return;

    const errorType = record.errorType || detectErrorType(record.error);
    const failureCategory = classifyFailure({
      errorMessage: record.error,
      errorType,
      toolName: record.toolName,
    });

    // 只有 skill_defect 才触发 self-modify 提案
    const shouldProposeFix = failureCategory === 'skill_defect';

    // 写入 evolution
    writeEvolution({
      type: 'tool_stats',
      content: `工具 ${record.toolName} 调用失败: ${record.error.slice(0, 100)}`,
      taskType: 'coding',
      metadata: {
        toolName: record.toolName,
        errorType,
        failureCategory,
        duration: record.duration,
        retryCount: record.retryCount,
        parameters: record.parameters,
        shouldProposeFix,
      },
      toolCall: {
        toolName: record.toolName,
        params: record.parameters,
        duration: record.duration,
        retryCount: record.retryCount,
      },
    });

    // 如果是技能缺陷，立即生成修复提案
    if (shouldProposeFix) {
      this.generateFixProposal(record, errorType);
    }
  }

  /**
   * 生成修复提案（触发 self-modify 流程）
   */
  private generateFixProposal(record: ToolCallRecord, errorType: ErrorType): void {
    const proposalId = `fix-${record.toolName}-${Date.now()}`;

    writeEvolution({
      type: 'self_modify_proposal',
      content: `自动生成的修复提案：${record.toolName} 存在 ${errorType} 错误`,
      taskType: 'coding',
      proposalId,
      targetFile: `src/tools.ts`, // 或其他具体文件
      reason: `工具 ${record.toolName} 频繁出现 ${errorType}: ${record.error?.slice(0, 100)}`,
      failureInfo: JSON.stringify({
        error: record.error,
        parameters: record.parameters,
        context: record.context,
      }),
      proposal: {
        type: 'tool_fix',
        toolName: record.toolName,
        errorType,
        suggestedFix: this.suggestFix(record, errorType),
      },
    });
  }

  /**
   * 根据错误类型给出修复建议
   */
  private suggestFix(record: ToolCallRecord, errorType: ErrorType): string {
    const fixes: Record<string, string> = {
      'TypeError': '添加参数类型检查和转换',
      'ReferenceError': '检查变量定义和导入',
      'SyntaxError': '修复语法错误',
      'ValidationError': '改进参数校验逻辑',
      'NetworkError': '添加网络超时和重试机制',
      'TimeoutError': '优化超时处理或增加超时时间',
      'FileSystemError': '添加文件存在性检查和错误处理',
      'PermissionError': '检查权限或提供降级方案',
    };

    return fixes[errorType] || '检查工具实现逻辑';
  }

  /**
   * 生成优化报告（供 AI 决策使用）
   */
  generateOptimizationReport(): {
    summary: string;
    inefficiencies: PatternAnalysis[];
    topIssues: PatternAnalysis[];
    recommendations: string[];
  } {
    const inefficiencies = this.analyzeInefficiencies();
    const criticalAndHigh = inefficiencies.filter(
      p => p.severity === 'critical' || p.severity === 'high'
    );

    const stats = this.getToolStats();
    const totalCalls = stats.reduce((sum, s) => sum + s.totalCalls, 0);
    const totalFailures = stats.reduce((sum, s) => sum + s.failureCount, 0);

    return {
      summary: `共记录 ${totalCalls} 次工具调用，失败 ${totalFailures} 次，发现 ${inefficiencies.length} 个优化点`,
      inefficiencies,
      topIssues: criticalAndHigh.slice(0, 5),
      recommendations: inefficiencies.map(p => p.suggestion),
    };
  }

  /**
   * 导出到 evolution（会话结束时调用）
   */
  exportToEvolution(sessionId: string): void {
    const report = this.generateOptimizationReport();

    // 写入优化洞察
    writeEvolution({
      type: 'self-eval-insight',
      content: `工具调用分析：${report.summary}`,
      taskType: 'coding',
      sessionId,
      metadata: {
        inefficiencyCount: report.inefficiencies.length,
        criticalIssues: report.topIssues.filter(i => i.severity === 'critical').length,
        recommendations: report.recommendations,
      },
    });

    // 为每个严重问题生成修复提案
    for (const issue of report.topIssues) {
      if (issue.codeChange) {
        writeEvolution({
          type: 'self_modify_proposal',
          content: issue.description,
          taskType: 'coding',
          sessionId,
          targetFile: issue.codeChange.targetFile,
          reason: issue.suggestion,
          proposal: {
            type: issue.codeChange.changeType,
            description: issue.codeChange.description,
            severity: issue.severity,
          },
        });
      }
    }
  }

  /** 辅助方法 */
  private generateId(): string {
    return `tc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private groupBy<T>(array: T[], key: keyof T | ((item: T) => string)): Record<string, T[]> {
    return array.reduce((groups, item) => {
      const groupKey = typeof key === 'function' ? key(item) : String(item[key]);
      groups[groupKey] = groups[groupKey] || [];
      groups[groupKey].push(item);
      return groups;
    }, {} as Record<string, T[]>);
  }
}

// 单例导出
let analytics: ToolCallAnalytics | null = null;

export function getToolCallAnalytics(): ToolCallAnalytics {
  if (!analytics) {
    analytics = new ToolCallAnalytics();
  }
  return analytics;
}

/**
 * 快速记录工具调用（供外部使用）
 */
export function recordToolCall(
  toolName: string,
  parameters: Record<string, any>,
  result: { success: boolean; error?: string; duration?: number; retryCount?: number }
): void {
  const analytics = getToolCallAnalytics();
  analytics.record({
    sessionId: 'current',
    toolName,
    parameters,
    success: result.success,
    error: result.error,
    duration: result.duration || 0,
    retryCount: result.retryCount || 0,
  });
}

/**
 * 会话结束时导出分析（供外部使用）
 */
export function finalizeSessionAnalytics(sessionId: string): void {
  const analytics = getToolCallAnalytics();
  analytics.exportToEvolution(sessionId);
}
