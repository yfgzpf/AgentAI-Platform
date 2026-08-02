/**
 * Loop 类型定义
 * 从 agentai-loop.ts 提取，保持完全兼容
 */

import { ChatMessage, MessageContent, ProviderId } from '../llm-router.js';
import { ToolResult } from '../tool-registry.js';

/** 运行模式 */
export type RunMode = 'auto' | 'planning' | 'review' | 'readonly';

/** 能力等级 */
export type CapabilityTier = 'autonomous' | 'guided' | 'supervised';

/** 任务类型 */
export type TaskType = 'coding' | 'research' | 'general' | 'industry';

/**
 * Loop 配置选项
 */
export interface LoopOptions {
  maxIterations: number;
  userId: string;
  workspace: string;
  sessionId?: string;
  abortSignal?: AbortSignal | undefined;
  parallelMax?: number;
  reflectEvery?: number;
  includeSkillsIndex?: boolean;
  model?: string;
  modelName?: string;
  /** UI 显示的模型名称 */
  displayModelLabel?: string;
  /** 持久记忆系统引用 */
  persistentMemory?: any;
  /** 用户手动选择模型 */
  userPickedModel?: boolean;
  /** 运行模式 */
  mode?: RunMode;
  /** 用户当前情绪 */
  emotion?: { emotion: string; intensity: number; label: string };
  /** 内部: 自动恢复是否已触发 */
  _autoResumed?: boolean;
  /** 是否开启思考模式 */
  thinking?: boolean;
  /** 思考模式 token 预算 */
  thinkingBudget?: number;
  /** 自定义模型配置 */
  modelConfig?: { baseURL: string; modelName: string; provider: string };
  /** 用户当前在编辑器中打开的文件 */
  activeFile?: string;
  /** 长任务快照 ID */
  taskId?: string;
}

/**
 * Reasonix Pillar 1 三段式上下文
 */
export interface AgentContext {
  sessionId: string;
  immutablePrefix: ChatMessage[];
  appendOnlyLog: ChatMessage[];
  volatileScratch: string;
}

/**
 * 系统指令优先级
 */
export type DirectivePriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * 待处理指令
 */
export interface PendingDirective {
  source: string;
  content: string;
  priority: DirectivePriority;
  ts: number;
}

/**
 * 指令管理器接口
 */
export interface IDirectiveManager {
  add(source: string, content: string, priority: DirectivePriority): void;
  getTop(): PendingDirective | null;
  getAllForPrompt(): string;
  clear(): void;
}

/**
 * 信任模式
 */
export interface TrustedPattern {
  toolName: string;
  pathPattern: string;
  trustedAt: number;
}

/**
 * 工具过滤选项
 */
export interface ToolFilterOptions {
  mode: RunMode;
  capabilityTier: CapabilityTier;
  taskType: TaskType;
  message: string;
}

/**
 * 反思选项
 */
export interface ReflectionOptions {
  userMessage: string;
  finalResponse: string;
  toolCalls: Array<{ name: string; args: any; result: any; success: boolean; durationMs: number }>;
  iterations: number;
  success: boolean;
  reflectEvery: number;
  userId: string;
  workspace: string;
  taskType: TaskType;
  industry: string;
  keywords: string[];
}

/**
 * 上下文构建选项
 */
export interface ContextBuildOptions {
  opts: Readonly<LoopOptions>;
  messages: ChatMessage[];
  taskType: TaskType;
  userIndustry: string;
  directives: IDirectiveManager;
  emotionHistory: Array<{ emotion: string; intensity: number; ts: number }>;
  forceSkill: string | null;
  capabilityTier: CapabilityTier;
}

/**
 * 工具调用结果格式化选项
 */
export interface ToolResultFormatOptions {
  verbose?: boolean;
  includeTimestamp?: boolean;
}

/**
 * 循环运行结果
 */
export interface LoopRunResult {
  content: string;
  provider: ProviderId | 'none';
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    cacheHit: boolean;
    source: 'actual' | 'estimated';
  };
  iterations: number;
  durationMs: number;
}

/**
 * 目标运行结果
 */
export interface GoalResult {
  success: boolean;
  output: string;
  iterations: number;
  durationMs: number;
}
