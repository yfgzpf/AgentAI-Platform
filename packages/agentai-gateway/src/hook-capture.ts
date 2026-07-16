/**
 * Hook 事件捕获器
 * ----------------------------------------------------
 * 管理12个生命周期Hook的捕获和上下文构建
 * 负责将系统事件转换为Hook调用
 */

import { hooksManager } from './lifecycle-hooks.js';
import { ToolContext, ToolResult } from './tool-registry.js';

export interface CaptureSession {
  sessionId: string;
  userId: string;
  workspace: string;
  startTime: number;
  context: ToolContext;
}

export interface CaptureWorkflow {
  workflowId: string;
  name: string;
  steps: string[];
  currentStep: number;
  startTime: number;
}

/**
 * Hook事件捕获器
 * 负责在各个关键节点捕获事件并触发Hook
 */
export class HookCaptureEngine {
  private activeSessions = new Map<string, CaptureSession>();
  private activeWorkflows = new Map<string, CaptureWorkflow>();
  
  constructor() {}

  // ═══════════════════════════════════════════════════════
  // Session Lifecycle Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * 会话开始 hook
   */
  async onSessionStart(
    userId: string,
    workspace: string,
    context: ToolContext,
    existingSessionId?: string
  ): Promise<string> {
    const sessionId = existingSessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    // 存储会话信息
    this.activeSessions.set(sessionId, {
      sessionId,
      userId,
      workspace,
      startTime: Date.now(),
      context
    });

    // 触发SessionStart Hook
    await hooksManager.trigger('SessionStart', {
      userId,
      workspace,
      sessionId,
      timestamp: Date.now(),
      originalContext: context,
      metadata: {
        sessionId,
        startTime: Date.now(),
        sessionType: 'user_interaction'
      }
    });

    console.log(`[HookCapture] Session started: ${sessionId}`);
    return sessionId;
  }

  /**
   * 会话结束 hook
   */
  async onSessionEnd(sessionId: string, reason: 'normal' | 'timeout' | 'error' = 'normal'): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[HookCapture] Session not found for ending: ${sessionId}`);
      return;
    }

    const duration = Date.now() - session.startTime;

    // 触发SessionEnd Hook
    await hooksManager.trigger('SessionEnd', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      originalContext: session.context,
      metadata: {
        sessionId,
        reason,
        duration,
        messageCount: 0 // 可以从appendOnlyLog获取实际数量
      }
    });

    this.activeSessions.delete(sessionId);
    console.log(`[HookCapture] Session ended: ${sessionId}, duration: ${duration}ms, reason: ${reason}`);
  }

  // ═══════════════════════════════════════════════════════
  // Tool Lifecycle Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * 工具使用前的 hook
   */
  async onPreToolUse(
    sessionId: string,
    toolName: string,
    args: Record<string, any>,
    context: ToolContext
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      // Session not found → don't block tools, just skip hooks
      console.warn(`[HookCapture] Session not found for PreToolUse: ${sessionId} (allowing tool)`);
      return true;
    }

    // 获取工具调用ID（如果有）
    const callId = args.__callId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const hookResult = await hooksManager.trigger('PreToolUse', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      toolName,
      toolArgs: args,
      callId,
      originalContext: context,
      metadata: {
        callId,
        toolCategory: this.getToolCategory(toolName),
        riskLevel: this.getToolRiskLevel(toolName, args)
      }
    });

    // 如果任何Hook要求中断，返回false
    return !hookResult.interrupted;
  }

  /**
   * 工具使用后的 hook
   */
  async onPostToolUse(
    sessionId: string,
    toolName: string,
    args: Record<string, any>,
    result: ToolResult,
    context: ToolContext
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`[HookCapture] Session not found for PostToolUse: ${sessionId}`);
      return;
    }

    const callId = args.__callId || `call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const duration = result.durationMs || 0;

    // 触发PostToolUse Hook
    await hooksManager.trigger('PostToolUse', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      toolName,
      toolArgs: args,
      toolResult: result,
      callId,
      originalContext: context,
      metadata: {
        callId,
        duration,
        success: result.success,
        errorType: result.structuredError?.type,
        outputLength: result.output?.length || 0
      }
    });

    console.log(`[HookCapture] Tool executed: ${toolName}, duration: ${duration}ms, success: ${result.success}`);
  }

  // ═══════════════════════════════════════════════════════
  // Model Lifecycle Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * Model调用前的 hook
   */
  async onPreModelCall(
    sessionId: string,
    modelName: string,
    input: string,
    context: ToolContext
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return true;

    const hookResult = await hooksManager.trigger('PreModelCall', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      modelName,
      modelInput: input.slice(0, 1000), // 限制长度
      originalContext: context,
      metadata: {
        inputLength: input.length,
        modelProvider: this.getModelProvider(modelName),
        estimatedTokens: this.estimateTokens(input)
      }
    });

    return !hookResult.interrupted;
  }

  /**
   * Model调用后的 hook
   */
  async onPostModelCall(
    sessionId: string,
    modelName: string,
    input: string,
    output: string,
    context: ToolContext
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await hooksManager.trigger('PostModelCall', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      modelName,
      modelInput: input.slice(0, 500),
      modelOutput: output.slice(0, 1000),
      originalContext: context,
      metadata: {
        inputLength: input.length,
        outputLength: output.length,
        modelProvider: this.getModelProvider(modelName),
        estimatedTokens: {
          input: this.estimateTokens(input),
          output: this.estimateTokens(output)
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  // Memory Lifecycle Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * 记忆读取 hook
   */
  async onMemoryRead(
    sessionId: string,
    operation: 'read' | 'search' | 'recall',
    query: string,
    result: any[],
    context: ToolContext
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await hooksManager.trigger('MemoryRead', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      memoryOperation: 'read',
      originalContext: context,
      metadata: {
        operation,
        query: query.slice(0, 200),
        resultCount: result.length,
        estimatedRelevance: this.calculateRelevance(query, result)
      }
    });
  }

  /**
   * 记忆写入 hook
   */
  async onMemoryWrite(
    sessionId: string,
    entry: any,
    context: ToolContext
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await hooksManager.trigger('MemoryWrite', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      memoryEntry: entry,
      memoryOperation: 'write',
      originalContext: context,
      metadata: {
        entryType: entry.role,
        source: entry.source,
        importance: entry.importance,
        contentLength: entry.content?.length || 0
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  // Exception Handling Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * 错误发生 hook
   */
  async onErrorOccurred(
    sessionId: string,
    error: Error,
    context: ToolContext,
    additionalInfo?: any
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await hooksManager.trigger('ErrorOccurred', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      error,
      errorType: error.name,
      originalContext: context,
      metadata: {
        errorMessage: error.message,
        stack: error.stack?.slice(0, 1000),
        ...additionalInfo
      }
    });

    console.error(`[HookCapture] Error occurred in session ${sessionId}:`, error.message);
  }

  /**
   * 错误恢复 hook
   */
  async onErrorRecovered(
    sessionId: string,
    originalError: Error,
    recoveryMethod: string,
    context: ToolContext
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    await hooksManager.trigger('ErrorRecovered', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      error: originalError,
      errorType: originalError.name,
      originalContext: context,
      metadata: {
        recoveryMethod,
        originalError: originalError.message,
        recoveryTime: Date.now()
      }
    });

    console.log(`[HookCapture] Error recovered in session ${sessionId}: ${recoveryMethod}`);
  }

  // ═══════════════════════════════════════════════════════
  // Workflow Lifecycle Hooks
  // ═══════════════════════════════════════════════════════

  /**
   * 工作流开始 hook
   */
  async onWorkflowStart(
    sessionId: string,
    workflowName: string,
    context: ToolContext,
    steps?: string[]
  ): Promise<string> {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const workflowId = `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const workflow: CaptureWorkflow = {
      workflowId,
      name: workflowName,
      steps: steps || [],
      currentStep: 0,
      startTime: Date.now()
    };

    this.activeWorkflows.set(workflowId, workflow);

    await hooksManager.trigger('WorkflowStart', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      workflowName,
      originalContext: context,
      metadata: {
        workflowId,
        steps: steps || [],
        estimatedDuration: this.estimateWorkflowDuration(workflowName, steps)
      }
    });

    console.log(`[HookCapture] Workflow started: ${workflowId} (${workflowName})`);
    return workflowId;
  }

  /**
   * 工作流结束 hook
   */
  async onWorkflowEnd(
    sessionId: string,
    workflowId: string,
    context: ToolContext,
    success: boolean = true,
    reason?: string
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    const workflow = this.activeWorkflows.get(workflowId);
    
    if (!session || !workflow) {
      console.warn(`[HookCapture] Session or workflow not found: ${sessionId}, ${workflowId}`);
      return;
    }

    const duration = Date.now() - workflow.startTime;

    await hooksManager.trigger('WorkflowEnd', {
      userId: session.userId,
      workspace: session.workspace,
      sessionId,
      timestamp: Date.now(),
      workflowName: workflow.name,
      originalContext: context,
      metadata: {
        workflowId,
        success,
        reason,
        duration,
        completedSteps: workflow.currentStep,
        totalSteps: workflow.steps.length
      }
    });

    this.activeWorkflows.delete(workflowId);
    console.log(`[HookCapture] Workflow ended: ${workflowId}, duration: ${duration}ms, success: ${success}`);
  }

  // ═══════════════════════════════════════════════════════
  // Helper Methods
  // ═══════════════════════════════════════════════════════

  /**
   * 获取工具分类
   */
  private getToolCategory(toolName: string): string {
    if (toolName.includes('file') || toolName.includes('read') || toolName.includes('write')) {
      return 'file_operation';
    }
    if (toolName.includes('web') || toolName.includes('browser') || toolName.includes('search')) {
      return 'web_operation';
    }
    if (toolName.includes('code') || toolName.includes('execute') || toolName.includes('run')) {
      return 'code_execution';
    }
    return 'general';
  }

  /**
   * 获取工具风险等级
   */
  private getToolRiskLevel(toolName: string, args: any): 'low' | 'medium' | 'high' | 'critical' {
    if (toolName.includes('delete') || toolName.includes('remove') || toolName.includes('rm')) {
      return args.path && args.path.includes('/') ? 'critical' : 'high';
    }
    if (toolName.includes('write') || toolName.includes('modify')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * 获取模型提供商
   */
  private getModelProvider(modelName: string): string {
    if (modelName.includes('gpt')) return 'openai';
    if (modelName.includes('claude')) return 'anthropic';
    if (modelName.includes('deepseek')) return 'deepseek';
    if (modelName.includes('zhipu')) return 'zhipu';
    return 'unknown';
  }

  /**
   * 估算Token数量
   */
  private estimateTokens(text: string): number {
    // 简单估算：中文字符1.5token，英文0.4token
    const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const enChars = text.length - cnChars;
    return Math.ceil(cnChars * 1.5 + enChars * 0.4);
  }

  /**
   * 计算查询相关度
   */
  private calculateRelevance(query: string, results: any[]): number {
    if (results.length === 0) return 0;
    
    // 简单相关度计算：匹配结果数量和查询长度
    const avgLength = results.reduce((sum, r) => sum + (r.content?.length || 0), 0) / results.length;
    return Math.min(1, avgLength / (query.length * 10));
  }

  /**
   * 估算工作流耗时
   */
  private estimateWorkflowDuration(workflowName: string, steps?: string[]): number {
    const baseTime = 5000; // 5秒基础时间
    const stepTime = (steps?.length || 1) * 2000; // 每步2秒
    return baseTime + stepTime;
  }

  // ═══════════════════════════════════════════════════════
  // Utility Methods
  // ═══════════════════════════════════════════════════════

  /**
   * 获取所有活跃会话
   */
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  /**
   * 获取所有活跃工作流
   */
  getActiveWorkflows(): string[] {
    return Array.from(this.activeWorkflows.keys());
  }

  /**
   * 清理超时会话
   */
  cleanupTimeoutSessions(timeoutMs = 3600000): void { // 默认1小时
    const now = Date.now();
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (now - session.startTime > timeoutMs) {
        this.activeSessions.delete(sessionId);
        console.log(`[HookCapture] Cleaned up timeout session: ${sessionId}`);
      }
    }
  }
}

/**
 * Hook捕获引擎单例实例
 */
export const hookCapture = new HookCaptureEngine();