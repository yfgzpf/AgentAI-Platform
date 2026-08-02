/**
 * token-early-warning.ts — Token 预警 + 自我总结能力
 * =================================================
 *
 * 解决问题:
 *   1. AI 助手在长任务中跑到 token 用尽才被动停止
 *   2. 用户没有实时看到 token 消耗趋势
 *   3. 主循环没有"上下文即将耗尽"的紧急压缩逻辑
 *
 * 实现方式:
 *   1. contextPressure(): 计算当前上下文压力 (0-1)
 *   2. shouldSummarizeEarly(): 决定是否提前触发自我总结
 *   3. buildSummaryCheckpoint(): 构建结构化总结 (写入记忆)
 *   4. emergencyCompress(): 紧急压缩旧消息
 *
 * 阈值设计 (3 段):
 *   - < 0.6: 正常模式
 *   - 0.6-0.8: 进入"主动总结"模式 — 每轮结束生成 checkpoint
 *   - 0.8-0.95: 进入"紧急压缩"模式 — 压缩旧消息
 *   - > 0.95: 拒绝新任务, 提示用户开启新会话
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { workspaceJournal } from './memory.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

export interface TokenUsage {
  /** 已用 token 数 */
  used: number;
  /** 模型上下文上限 */
  max: number;
  /** 当前消息数 */
  messageCount: number;
  /** 工具调用次数 */
  toolCallCount: number;
}

export interface PressureLevel {
  /** 压力值 0-1 */
  pressure: number;
  /** 等级 */
  level: 'safe' | 'caution' | 'warning' | 'critical' | 'overflow';
  /** 中文标签 */
  label: string;
  /** 颜色 */
  color: string;
  /** 建议操作 */
  advice: string;
}

export interface SummaryCheckpoint {
  ts: number;
  /** 总结的轮次区间 [from, to] */
  range: [number, number];
  /** 用户目标 */
  userGoal: string;
  /** 已完成的工作 */
  completed: string[];
  /** 关键决策 */
  keyDecisions: string[];
  /** 待办项 */
  pending: string[];
  /** 上下文关键事实 (注入下次) */
  keyFacts: string[];
  /** 下一步建议 */
  nextStep: string;
}

// ═══════════════════════════════════════════════════════════
// 核心函数
// ═══════════════════════════════════════════════════════════

/**
 * 计算当前上下文压力
 * @param usage 当前 token 使用情况
 * @param max 上下文上限 (默认从模型元数据获取)
 */
export function contextPressure(usage: TokenUsage, max?: number): PressureLevel {
  const maxTokens = max || usage.max || 128000;
  const pressure = Math.min(1.0, usage.used / maxTokens);

  if (pressure < 0.5) {
    return {
      pressure,
      level: 'safe',
      label: '充裕',
      color: '#22c55e',
      advice: '正常运行, 无需压缩',
    };
  } else if (pressure < 0.7) {
    return {
      pressure,
      level: 'caution',
      label: '关注',
      color: '#3b82f6',
      advice: '开始记录关键决策, 准备 checkpoint',
    };
  } else if (pressure < 0.85) {
    return {
      pressure,
      level: 'warning',
      label: '紧张',
      color: '#f59e0b',
      advice: '每轮结束主动生成 summary checkpoint',
    };
  } else if (pressure < 0.95) {
    return {
      pressure,
      level: 'critical',
      label: '紧急',
      color: '#ef4444',
      advice: '压缩历史消息, 仅保留关键事实',
    };
  } else {
    return {
      pressure,
      level: 'overflow',
      label: '溢出',
      color: '#dc2626',
      advice: '拒绝新任务, 提示用户开启新会话',
    };
  }
}

/**
 * 是否应该提前触发自我总结
 */
export function shouldSummarizeEarly(usage: TokenUsage, threshold = 0.7): boolean {
  return usage.used / (usage.max || 128000) >= threshold;
}

/**
 * 是否进入紧急压缩
 */
export function shouldEmergencyCompress(usage: TokenUsage, threshold = 0.85): boolean {
  return usage.used / (usage.max || 128000) >= threshold;
}

/**
 * 构建结构化总结 (用于注入下次主循环)
 */
export function buildSummaryCheckpoint(args: {
  range: [number, number];
  userGoal: string;
  messages: Array<{ role: string; content: string }>;
  toolCalls: Array<{ name: string; success: boolean }>;
}): SummaryCheckpoint {
  const { range, userGoal, messages, toolCalls } = args;

  // 1. 提取已完成的工作 (基于 assistant 工具调用)
  const completedTools = toolCalls
    .filter(t => t.success)
    .map(t => t.name);
  const completed = [...new Set(completedTools)];

  // 2. 提取关键决策 (基于 user/assistant 长消息)
  const keyDecisions = messages
    .filter(m => m.role === 'assistant' && m.content.length > 100)
    .slice(-3)
    .map(m => m.content.split('\n')[0]?.slice(0, 100) || '')
    .filter(Boolean);

  // 3. 提取关键事实 (基于 user 消息中的关键参数)
  const keyFacts = messages
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .filter(c => c.length > 10 && c.length < 200)
    .slice(-5);

  return {
    ts: Date.now(),
    range,
    userGoal,
    completed,
    keyDecisions,
    pending: [],  // 由 LLM 填写
    keyFacts,
    nextStep: '',  // 由 LLM 填写
  };
}

/**
 * 持久化总结 checkpoint 到工作日志
 */
export async function persistCheckpoint(
  workspace: string,
  checkpoint: SummaryCheckpoint
): Promise<void> {
  try {
    const line = JSON.stringify({
      type: 'summary_checkpoint',
      ...checkpoint,
    });
    await workspaceJournal.append(workspace, {
      summary: `Token checkpoint @ ${checkpoint.range[0]}-${checkpoint.range[1]} (${checkpoint.completed.length} completed)`,
      taskType: 'token_checkpoint',
      decision: line,
    });
  } catch (e: any) {
    console.warn('[token-early-warning] persistCheckpoint failed:', e.message);
  }
}

/**
 * 注入到 system prompt 的预警段
 * 当压力进入 caution 阶段时, AI 应主动告知用户
 */
export function buildWarningPrompt(level: PressureLevel): string {
  if (level.level === 'safe') return '';

  return `<token-pressure-warning>
当前上下文压力: ${(level.pressure * 100).toFixed(1)}% (${level.label})
建议: ${level.advice}
${level.level === 'critical' || level.level === 'overflow' ? '\n⚠️ 重要: 必须在本轮结束前生成 summary checkpoint, 并将待办项写入用户记忆' : ''}
</token-pressure-warning>`;
}

/**
 * AI 助手自检清单 — 每轮结束前的强制 checklist
 * 防止长任务跑到 token 用尽
 */
export const AI_SELF_CHECK_PROTOCOL = `
每轮结束前, 强制自检:
1. 当前上下文压力是多少? (contextPressure)
2. 如果 pressure > 0.7: 是否已生成 summary checkpoint?
3. 如果 pressure > 0.85: 是否已压缩旧消息?
4. 用户的目标是否清晰? (keyFacts 是否足够)
5. 下一步是否明确? (nextStep 是否填写)

如果任何一项不满足, 立即处理, 不要继续后续工具调用。
`.trim();
