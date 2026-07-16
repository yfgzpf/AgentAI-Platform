/**
 * AgentAI 生命周期 Hooks 系统
 * ----------------------------------------------------
 * 学 AgentMemory: 通过12个精准生命周期Hook自动捕获AI操作
 * 替代现有 ProactiveEngine 的60s轮询扫描机制
 *
 * 12个生命周期Hook:
 * - Session Lifecycle: SessionStart/End
 * - Tool Lifecycle: PreToolUse/PostToolUse
 * - Model Lifecycle: PreModelCall/PostModelCall  
 * - Memory Lifecycle: MemoryRead/Write
 * - Exception Handling: ErrorOccurred/Recovery
 * - Workflow Lifecycle: WorkflowStart/End
 */

import { EventEmitter } from 'events';
import { ToolContext, ToolResult } from './tool-registry.js';

export type HookName =
  | 'SessionStart' | 'SessionEnd'
  | 'PreToolUse' | 'PostToolUse'
  | 'PreModelCall' | 'PostModelCall'  
  | 'MemoryRead' | 'MemoryWrite'
  | 'ErrorOccurred' | 'ErrorRecovered'
  | 'WorkflowStart' | 'WorkflowEnd'
  | 'SessionSuggestionAccepted';

export interface HookContext {
  userId: string;
  workspace: string;
  sessionId: string;
  timestamp: number;
  
  // Tool相关上下文
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolResult?: ToolResult;
  callId?: string;
  
  // Model相关上下文
  modelName?: string;
  modelInput?: string;
  modelOutput?: string;
  
  // Memory相关上下文
  memoryEntry?: any;
  memoryOperation?: 'read' | 'write' | 'update' | 'delete';
  
  // 错误相关上下文
  error?: Error;
  errorType?: string;
  
  // Workflow相关上下文
  workflowName?: string;
  workflowStep?: string;

  // 建议相关上下文
  suggestionId?: string;
  suggestion?: any;
  
  // 扩展元数据
  metadata?: Record<string, any>;
  
  // 原始上下文引用
  originalContext?: ToolContext;
}

export interface HookResult {
  success: boolean;
  continue: boolean; // false表示中断执行
  error?: string;
  data?: any;
}

export interface HookPoint {
  name: HookName;
  phase: 'before' | 'after' | 'error';
  priority: number;  // 优先级，数字小的先执行
  handler: (context: HookContext) => Promise<HookResult> | HookResult;
  enabled: boolean;
}

export interface HookEvent {
  id: string;
  name: HookName;
  phase: 'before' | 'after' | 'error';
  context: HookContext;
  result?: HookResult;
  timestamp: number;
}

/**
 * 生命周期Hook管理器
 * - 管理12个生命周期Hook的注册、触发、执行
 * - 支持优先级排序、错误处理、结果收集
 * - 线程安全，支持并发Hook执行
 */
export class LifecycleHooksManager extends EventEmitter {
  private hooks = new Map<string, HookPoint[]>(); // HookName -> HookPoint[]
  private executionStats = new Map<HookName, { count: number; avgDuration: number }>();
  private isEnabled = true;
  
  constructor() {
    super();
  }

  /**
   * 注册Hook处理器
   */
  register(hookName: HookName, hook: Omit<HookPoint, 'name'>): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    
    const hookWithName: HookPoint = { ...hook, name: hookName };
    const hooks = this.hooks.get(hookName)!;
    
    hooks.push(hookWithName);
    
    // 按优先级排序 (数字小的先执行)
    hooks.sort((a, b) => a.priority - b.priority);
    
    this.emit('hook:registered', { hookName, priority: hook.priority });
  }

  /**
   * 注销Hook处理器
   */
  unregister(hookName: HookName, handler: (context: HookContext) => any): boolean {
    const hooks = this.hooks.get(hookName);
    if (!hooks) return false;
    
    const index = hooks.findIndex(h => h.handler === handler);
    if (index === -1) return false;
    
    hooks.splice(index, 1);
    if (hooks.length === 0) {
      this.hooks.delete(hookName);
    }
    
    this.emit('hook:unregistered', { hookName });
    return true;
  }

  /**
   * 触发指定Hook的执行
   */
  async trigger(
    hookName: HookName,
    context: Partial<HookContext>
  ): Promise<{ results: HookResult[]; interrupted: boolean }> {
    if (!this.isEnabled) {
      return { results: [], interrupted: false };
    }

    const hooks = this.hooks.get(hookName) || [];
    if (hooks.length === 0) {
      return { results: [], interrupted: false };
    }

    const startTime = Date.now();
    const results: HookResult[] = [];
    let interrupted = false;

    try {
      // 创建完整的Hook上下文
      const fullContext: HookContext = {
        userId: context.userId || 'unknown',
        workspace: context.workspace || process.cwd(),
        sessionId: context.sessionId || `session-${Date.now()}`,
        timestamp: context.timestamp || Date.now(),
        ...context
      };

      // 依次执行所有Hook处理器
      for (const hook of hooks) {
        if (!hook.enabled) continue;
        
        try {
          const result = await this.executeHook(hook, fullContext);
          results.push(result);
          
          // 如果Hook要求中断，停止后续执行
          if (!result.continue) {
            interrupted = true;
            break;
          }
          
          this.emit('hook:executed', {
            hookName,
            result,
            duration: Date.now() - startTime
          });
          
        } catch (error) {
          console.warn(`[hooks:trigger] Hook ${hookName} execution failed:`, error);
          results.push({
            success: false,
            continue: true,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // 更新执行统计
      this.updateStats(hookName, Date.now() - startTime);
      
      this.emit('hook:triggered', {
        hookName,
        resultsCount: results.length,
        interrupted,
        duration: Date.now() - startTime
      });
      
    } catch (error) {
      console.error(`[hooks:trigger] Fatal error triggering hook ${hookName}:`, error);
      this.emit('hook:error', { hookName, error });
    }

    return { results, interrupted };
  }

  /**
   * 执行单个Hook处理器
   */
  private async executeHook(
    hook: HookPoint,
    context: HookContext
  ): Promise<HookResult> {
    const start = Date.now();
    
    try {
      const result = await Promise.resolve(hook.handler(context));
      
      return {
        ...result,
        success: result.success ?? true,
        continue: result.continue ?? true,
        data: {
          duration: Date.now() - start,
          ...result.data
        }
      };
    } catch (error) {
      return {
        success: false,
        continue: true,
        error: error instanceof Error ? error.message : String(error),
        data: { duration: Date.now() - start }
      };
    }
  }

  /**
   * 更新执行统计信息
   */
  private updateStats(hookName: HookName, duration: number): void {
    const existing = this.executionStats.get(hookName) || { count: 0, avgDuration: 0 };
    const newCount = existing.count + 1;
    const newAvg = (existing.avgDuration * existing.count + duration) / newCount;
    
    this.executionStats.set(hookName, {
      count: newCount,
      avgDuration: newAvg
    });
  }

  /**
   * 批量注册Hook（用于内置Hook的快速注册）
   */
  registerBatch(hookConfigs: Array<{ name: HookName } & Omit<HookPoint, 'name'>>): void {
    for (const config of hookConfigs) {
      this.register(config.name, config);
    }
  }

  /**
   * 启用/禁用所有Hook
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.emit('hooks:toggle', { enabled });
  }

  /**
   * 启用/禁用指定Hook
   */
  setHookEnabled(hookName: HookName, enabled: boolean): void {
    const hooks = this.hooks.get(hookName);
    if (hooks) {
      for (const hook of hooks) {
        hook.enabled = enabled;
      }
      this.emit('hook:toggle', { hookName, enabled });
    }
  }

  /**
   * 获取Hook统计信息
   */
  getStats(): Record<string, { count: number; avgDuration: number }> {
    return Object.fromEntries(this.executionStats);
  }

  /**
   * 获取已注册的Hook列表
   */
  getRegisteredHooks(): Array<{ name: HookName; count: number }> {
    return Array.from(this.hooks.entries()).map(([name, hooks]) => ({
      name: name as HookName,
      count: hooks.length
    }));
  }

  /**
   * 清空所有Hook（用于测试或重置）
   */
  clear(): void {
    this.hooks.clear();
    this.executionStats.clear();
    this.emit('hooks:clear');
  }

  /**
   * 获取Hook执行历史（最近N条）
   */
  private executionHistory: HookEvent[] = [];
  private maxHistorySize = 1000;
  
  addToHistory(event: HookEvent): void {
    this.executionHistory.push(event);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }
  
  getHistory(limit = 100): HookEvent[] {
    return this.executionHistory.slice(-limit);
  }
}

/**
 * Hook管理器单例实例
 */
export const hooksManager = new LifecycleHooksManager();

// ═══════════════════════════════════════════════════════
// 预设的内置Hook处理器
// ═══════════════════════════════════════════════════════

/**
 * 内存记录Hook - 自动将操作记录到memory
 */
export const memoryLoggerHook = {
  name: 'memory' as const,
  phase: 'after' as const,
  priority: 10,
  enabled: true,
  handler: async (context: HookContext): Promise<HookResult> => {
    try {
      let content = '';
      let metadata: any = {};
      
      if (context.toolName) {
        content = `Tool: ${context.toolName}`;
        if (context.toolArgs) {
          content += `, Args: ${JSON.stringify(context.toolArgs).slice(0, 100)}`;
        }
        if (context.toolResult) {
          content += `, Success: ${context.toolResult.success}`;
        }
        metadata = { tool: context.toolName, callId: context.callId };
      } else if (context.memoryOperation) {
        content = `Memory: ${context.memoryOperation}`;
        metadata = { operation: context.memoryOperation };
      } else if (context.workflowName) {
        content = `Workflow: ${context.workflowName}`;
        metadata = { workflow: context.workflowName, step: context.workflowStep };
      } else if (context.error) {
        content = `Error: ${context.error.message}`;
        metadata = { errorType: context.errorType };
      }
      
      if (content) {
        // 这里需要导入memory模块，但为避免循环依赖，延迟导入
        const { writeMemory } = await import('./memory.js');
        await writeMemory({
          userId: context.userId,
          workspace: context.workspace,
          role: 'system',
          content,
          source: 'lifecycle',
          metadata: {
            hookContext: metadata,
            sessionId: context.sessionId,
            ...context.metadata
          },
          importance: 0.3
        });
      }
      
      return { success: true, continue: true };
    } catch (error) {
      console.warn('[memoryLoggerHook] Failed to write memory:', error);
      return { success: false, continue: true, error: String(error) };
    }
  }
};

/**
 * 错误处理Hook - 捕获和记录错误
 */
export const errorHandlerHook = {
  name: 'error' as const,
  phase: 'error' as const,
  priority: 1,
  enabled: true,
  handler: async (context: HookContext): Promise<HookResult> => {
    if (!context.error) {
      return { success: true, continue: true };
    }
    
    try {
      console.error(`[LifecycleHook] Error in ${context.toolName || 'system'}:`, {
        error: context.error.message,
        userId: context.userId,
        workspace: context.workspace,
        sessionId: context.sessionId,
        metadata: context.metadata
      });
      
      return { success: true, continue: true };
    } catch (error) {
      console.error('[errorHandlerHook] Failed to handle error:', error);
      return { success: false, continue: true, error: String(error) };
    }
  }
};

// 注册内置Hook
hooksManager.register('SessionStart', memoryLoggerHook);
hooksManager.register('SessionEnd', memoryLoggerHook);
hooksManager.register('PostToolUse', memoryLoggerHook);
hooksManager.register('ErrorOccurred', errorHandlerHook);
hooksManager.register('ErrorRecovered', errorHandlerHook);