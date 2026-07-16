/**
 * Hook事件到记忆的转换器
 * ----------------------------------------------------
 * 负责将捕获的Hook事件智能转换为记忆条目
 * 实现AgentMemory的4层记忆整理管道：
 * 原始事件 → 压缩 → 合并 → 长期记忆
 */

import { hooksManager, HookEvent } from './lifecycle-hooks.js';
import { writeMemory, MemoryEntry } from './memory.js';
import { WorkspaceManager } from './workspace-manager.js';

export interface MemoryCompressionConfig {
  // 压缩阈值配置
  rawEventThreshold: number;    // 原始事件阈值，超过则触发压缩
  compressionRatio: number;      // 压缩比例 (0-1)
  minImportanceScore: number;   // 最小重要性分数，低于此值被过滤
  
  // 时间窗口配置  
  aggregationWindowMs: number;   // 聚合时间窗口
  retentionDays: number;         // 记忆保留天数
  
  // 重要性计算权重
  weights: {
    tool: number;           // 工具调用权重
    model: number;          // 模型调用权重  
    memory: number;         // 记忆操作权重
    workflow: number;       // 工作流权重
    error: number;          // 错误事件权重
    session: number;        // 会话事件权重
  };
}

export interface CompressedMemory {
  id: string;
  ts: number;
  userId: string;
  workspace: string;
  type: 'tool' | 'model' | 'workflow' | 'error' | 'session';
  summary: string;
  details: {
    eventCount: number;        // 聚合的事件数量
    pattern: string;           // 发现的模式
    frequency: number;         // 发生频率
    success: boolean;          // 成功标志
    duration?: number;         // 耗时
  };
  importance: number;
  metadata: Record<string, any>;
  tags: string[];
}

/**
 * 事件到记忆转换管道
 * 实现4层记忆整理：原始→压缩→合并→长期
 */
export class EventToMemoryPipeline {
  private config: MemoryCompressionConfig = {
    rawEventThreshold: 20,
    compressionRatio: 0.3,
    minImportanceScore: 0.2,
    aggregationWindowMs: 30 * 60 * 1000, // 30分钟
    retentionDays: 30,
    weights: {
      tool: 0.3,
      model: 0.4,
      memory: 0.5,
      workflow: 0.6,
      error: 0.8,
      session: 0.2
    }
  };
  
  private eventBuffer: HookEvent[] = [];
  private compressorTimer?: NodeJS.Timeout;
  private workspaceManager = WorkspaceManager.getInstance();
  
  constructor(config?: Partial<MemoryCompressionConfig>) {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // 监听Hook事件
    hooksManager.on('hook:executed', (event) => {
      this.bufferEvent(event as HookEvent);
    });
    
    // 启动后台压缩任务
    this.startCompressionScheduler();
  }

  /**
   * 缓冲事件，准备压缩
   */
  private bufferEvent(hookEvent: HookEvent): void {
    this.eventBuffer.push(hookEvent);
    
    // 达到阈值时立即触发压缩
    if (this.eventBuffer.length >= this.config.rawEventThreshold) {
      this.triggerCompression();
    }
  }

  /**
   * 获取事件类型
   */
  private getEventType(event: HookEvent): 'tool' | 'model' | 'workflow' | 'error' | 'session' {
    const name = event.name;
    
    if (name.includes('Tool')) return 'tool';
    if (name.includes('Model')) return 'model';
    if (name.includes('Workflow')) return 'workflow';
    if (name.includes('Error')) return 'error';
    return 'session';
  }

  /**
   * 计算事件重要性分数
   */
  private calculateImportance(event: HookEvent): number {
    let score = 0.1; // 基础分数
    
    const eventType = this.getEventType(event);
    score += this.config.weights[eventType] || 0;
    
    // 基于上下文的加分
    const ctx = event.context;
    
    // 工具调用相关加分
    if (ctx.toolName) {
      if (ctx.toolName.includes('write') || ctx.toolName.includes('modify')) {
        score += 0.2; // 修改操作更重要
      }
      if (ctx.toolName.includes('delete') || ctx.toolName.includes('remove')) {
        score += 0.4; // 删除操作非常重要
      }
    }
    
    // 持续时间加分
    if (ctx.metadata?.duration) {
      const duration = ctx.metadata.duration as number;
      if (duration > 10000) score += 0.2; // 超过10秒的操作重要
      if (duration > 60000) score += 0.3; // 超过1分钟的操作非常重要
    }

    // 错误事件加分
    if (ctx.error || ctx.errorType) {
      score += 0.5; // 错误事件非常重要
    }

    // 输出长度加分
    if (ctx.toolResult?.output) {
      const outputLength = ctx.toolResult.output.length;
      if (outputLength > 1000) score += 0.1;
      if (outputLength > 5000) score += 0.2;
    }

    return Math.min(1.0, score);
  }

  /**
   * 生成事件的语义摘要
   */
  private generateEventSummary(events: HookEvent[]): string {
    if (events.length === 0) return '无事件';
    
    const firstEvent = events[0]!;
    const eventType = this.getEventType(firstEvent);
    
    if (events.length === 1) {
      return this.generateSingleEventSummary(firstEvent);
    }
    
    // 多个事件的聚合摘要
    const eventTypes = [...new Set(events.map(e => this.getEventType(e)))];
    const toolNames = [...new Set(events.map(e => e.context.toolName).filter(Boolean))];
    const hasErrors = events.some(e => e.context.error);
    
    let summary = `聚合了 ${events.length} 个事件`;
    
    if (eventTypes.length === 1) {
      summary += `，类型：${eventTypes[0]}`;
    } else if (eventTypes.length <= 3) {
      summary += `，类型：${eventTypes.join('、')}`;
    }
    
    if (toolNames.length > 0) {
      if (toolNames.length <= 5) {
        summary += `，工具：${toolNames.join('、')}`;
      } else {
        summary += `，涉及 ${toolNames.length} 个不同工具`;
      }
    }
    
    if (hasErrors) {
      summary += `，包含错误`;
    }
    
    return summary;
  }

  /**
   * 生成单个事件的摘要
   */
  private generateSingleEventSummary(event: HookEvent): string {
    const ctx = event.context;
    const eventType = this.getEventType(event);
    
    switch (eventType) {
      case 'tool':
        if (ctx.toolName) {
          const success = ctx.toolResult?.success !== false;
          return `工具 ${ctx.toolName} ${success ? '执行成功' : '执行失败'}`;
        }
        break;
        
      case 'model':
        if (ctx.modelName) {
          return `调用模型 ${ctx.modelName} 进行推理`;
        }
        break;
        
      case 'workflow':
        if (ctx.workflowName) {
          return `执行工作流 ${ctx.workflowName}`;
        }
        break;
        
      case 'error':
        if (ctx.error) {
          return `发生错误：${ctx.error.message}`;
        }
        break;
        
      case 'session':
        return `会话活动：${event.name}`;
    }
    
    return `${event.name} 事件`;
  }

  /**
   * 检测事件模式
   */
  private detectPatterns(events: HookEvent[]): { pattern: string; frequency: number } {
    if (events.length < 2) {
      return { pattern: 'single', frequency: 1 };
    }
    
    // 分析工具调用模式
    const toolEvents = events.filter(e => e.context.toolName);
    if (toolEvents.length >= 2) {
      const toolSequence = toolEvents.map(e => e.context.toolName).join(' → ');
      
      // 检查常见模式
      if (toolSequence.includes('read_file') && toolSequence.includes('modify_file')) {
        return { pattern: 'read_modify_cycle', frequency: toolEvents.length };
      }
      
      if (toolSequence.includes('web_search') && toolSequence.includes('write_file')) {
        return { pattern: 'research_and_write', frequency: toolEvents.length };
      }
      
      return { pattern: 'sequential_tools', frequency: toolEvents.length };
    }
    
    // 分析错误模式
    const errorEvents = events.filter(e => e.context.error);
    if (errorEvents.length >= events.length * 0.5) {
      return { pattern: 'error_prone', frequency: errorEvents.length };
    }
    
    // 分析时间模式
    const timeSpan = events[events.length - 1]!.timestamp - events[0]!.timestamp;
    if (timeSpan < 5000) { // 5秒内
      return { pattern: 'burst_activity', frequency: events.length };
    }
    
    return { pattern: 'general', frequency: events.length };
  }

  /**
   * 生成记忆标签
   */
  private generateTags(events: HookEvent[]): string[] {
    const tags = new Set<string>();
    
    for (const event of events) {
      const ctx = event.context;
      
      // 事件类型标签
      const eventType = this.getEventType(event);
      tags.add(eventType);
      
      // 工具相关标签
      if (ctx.toolName) {
        tags.add(`tool:${ctx.toolName}`);
        
        // 工具分类标签
        if (ctx.toolName.includes('file')) tags.add('file_operation');
        if (ctx.toolName.includes('web')) tags.add('web_operation'); 
        if (ctx.toolName.includes('code')) tags.add('code_execution');
      }
      
      // 模型标签
      if (ctx.modelName) {
        tags.add(`model:${ctx.modelName}`);
        const provider = ctx.modelName.includes('gpt') ? 'openai' :
                        ctx.modelName.includes('claude') ? 'anthropic' : 'other';
        tags.add(`provider:${provider}`);
      }
      
      // 错误标签
      if (ctx.error) {
        tags.add('error');
        if (ctx.errorType) tags.add(`error_type:${ctx.errorType}`);
      }
      
      // 性能标签
      if (ctx.metadata?.duration) {
        const duration = ctx.metadata.duration as number;
        if (duration > 10000) tags.add('long_running');
        if (duration < 1000) tags.add('quick');
      }
    }
    
    return Array.from(tags);
  }

  /**
   * 执行记忆压缩
   */
  async compress(events: HookEvent[]): Promise<CompressedMemory[]> {
    if (events.length === 0) return [];
    
    // 按用户、工作空间、类型分组
    const groups = new Map<string, HookEvent[]>();
    
    for (const event of events) {
      const groupId = `${event.context.userId}:${event.context.workspace}:${this.getEventType(event)}`;
      if (!groups.has(groupId)) {
        groups.set(groupId, []);
      }
      groups.get(groupId)!.push(event);
    }
    
    const compressedMemories: CompressedMemory[] = [];
    
    for (const [groupId, groupEvents] of groups) {
      // 按时间排序
      groupEvents.sort((a, b) => a.timestamp - b.timestamp);
      
      // 按时间窗口进一步分组
      const windowGroups = this.groupByTimeWindow(groupEvents);
      
      for (const windowEvents of windowGroups) {
        // 计算重要性（取最高分）
        const importance = Math.max(
          ...windowEvents.map(e => this.calculateImportance(e))
        );
        
        // 低于阈值的事件过滤掉
        if (importance < this.config.minImportanceScore) {
          continue;
        }
        
        // 生成摘要
        const summary = this.generateEventSummary(windowEvents);
        
        // 检测模式
        const { pattern, frequency } = this.detectPatterns(windowEvents);
        
        // 生成标签
        const tags = this.generateTags(windowEvents);
        
        // 计算持续时间
        const duration = windowEvents.length > 1 
          ? windowEvents[windowEvents.length - 1]!.timestamp - windowEvents[0]!.timestamp
          : windowEvents[0]!.context.metadata?.duration || 0;
        
        const memory: CompressedMemory = {
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts: windowEvents[0]!.timestamp,
          userId: windowEvents[0]!.context.userId,
          workspace: windowEvents[0]!.context.workspace,
          type: this.getEventType(windowEvents[0]!),
          summary,
          details: {
            eventCount: windowEvents.length,
            pattern,
            frequency,
            success: !windowEvents.some(e => e.context.error),
            duration
          },
          importance,
          metadata: {
            source: 'lifecycle_hooks',
            compressionRatio: windowEvents.length / (windowEvents.length * this.config.compressionRatio),
            originalEvents: windowEvents.length
          },
          tags
        };
        
        compressedMemories.push(memory);
      }
    }
    
    return compressedMemories;
  }

  /**
   * 按时间窗口分组事件
   */
  private groupByTimeWindow(events: HookEvent[]): HookEvent[][] {
    if (events.length === 0) return [];
    
    const groups: HookEvent[][] = [];
    let currentGroup: HookEvent[] = [events[0]!];
    
    for (let i = 1; i < events.length; i++) {
      const prevEvent = events[i - 1]!;
      const currentEvent = events[i]!;
      
      const timeGap = currentEvent.timestamp - prevEvent.timestamp;
      
      if (timeGap <= this.config.aggregationWindowMs) {
        currentGroup.push(currentEvent);
      } else {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [currentEvent];
      }
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }

  /**
   * 将压缩后的记忆写入存储
   */
  async persistMemories(memories: CompressedMemory[]): Promise<void> {
    for (const memory of memories) {
      try {
        await writeMemory({
          userId: memory.userId,
          workspace: memory.workspace,
          role: 'system',
          content: `[记忆压缩] ${memory.type.toUpperCase()}: ${memory.summary}`,
          source: 'lifecycle',
          importance: memory.importance,
          metadata: {
            memoryId: memory.id,
            compressionDetails: memory.details,
            originalEventCount: memory.details.eventCount,
            detectedPattern: memory.details.pattern,
            tags: memory.tags,
            compressionSource: 'event_pipeline'
          },
          entityId: memory.details.pattern !== 'single' ? memory.details.pattern : undefined
        });
      } catch (error) {
        console.error('[EventToMemory] Failed to persist memory:', error);
      }
    }
  }

  /**
   * 触发记忆压缩
   */
  async triggerCompression(): Promise<void> {
    if (this.eventBuffer.length === 0) return;
    
    const eventsToProcess = [...this.eventBuffer];
    this.eventBuffer = [];
    
    try {
      console.log(`[EventToMemory] Starting compression of ${eventsToProcess.length} events`);
      
      // 执行压缩
      const compressedMemories = await this.compress(eventsToProcess);
      
      // 写入存储
      await this.persistMemories(compressedMemories);
      
      console.log(`[EventToMemory] Compressed ${eventsToProcess.length} events into ${compressedMemories.length} memories`);
      
    } catch (error) {
      console.error('[EventToMemory] Compression failed:', error);
      // 恢复事件到缓冲区
      this.eventBuffer.unshift(...eventsToProcess);
    }
  }

  /**
   * 启动后台压缩调度器
   */
  private startCompressionScheduler(): void {
    // 每10分钟执行一次强制压缩
    this.compressorTimer = setInterval(async () => {
      if (this.eventBuffer.length > 0) {
        await this.triggerCompression();
      }
    }, 10 * 60 * 1000);
  }

  /**
   * 手动添加事件（测试用）
   */
  async addEvent(event: HookEvent): Promise<void> {
    this.bufferEvent(event);
  }

  /**
   * 获取压缩统计信息
   */
  getStats(): {
    bufferSize: number;
    config: MemoryCompressionConfig;
  } {
    return {
      bufferSize: this.eventBuffer.length,
      config: this.config
    };
  }

  /**
   * 销毁管道
   */
  destroy(): void {
    if (this.compressorTimer) {
      clearInterval(this.compressorTimer);
      this.compressorTimer = undefined;
    }
    
    // 处理剩余事件
    if (this.eventBuffer.length > 0) {
      this.triggerCompression().catch(console.error);
    }
  }
}

/**
 * 事件到记忆管道单例
 */
export const eventToMemoryPipeline = new EventToMemoryPipeline();

// ═══════════════════════════════════════════════════════
// 预定义的事件压缩规则
// ═══════════════════════════════════════════════════════

export const predefinedPatterns = {
  // 常见工具调用模式
  readModifyCycle: {
    pattern: ['read_file', 'modify_file'],
    summary: '文件的读取和修改循环',
    importance: 0.6
  },
  
  researchAndWrite: {
    pattern: ['web_search', 'read_file', 'write_file'], 
    summary: '研究后写作的工作流程',
    importance: 0.7
  },
  
  codeTestCycle: {
    pattern: ['code_executor', 'read_file', 'modify_file'],
    summary: '代码编写和测试的循环',
    importance: 0.8
  },
  
  // 错误模式
  persistentErrors: {
    pattern: ['error'],
    minOccurrences: 3,
    timeWindow: 5 * 60 * 1000, // 5分钟
    summary: '持续发生的错误',
    importance: 0.9
  },
  
  // 性能模式
  longRunningOperations: {
    pattern: ['tool'],
    minDuration: 30000, // 30秒
    summary: '耗时较长的操作',
    importance: 0.5
  }
};

// 自动注册一些默认的Hook来捕获事件
hooksManager.register('PostToolUse', {
  phase: 'after',
  priority: 100,
  enabled: true,
  handler: async (context) => {
    const hookEvent: HookEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'PostToolUse',
      phase: 'after',
      context,
      timestamp: Date.now()
    };
    
    // 延迟添加，避免阻塞主流程
    setTimeout(() => {
      eventToMemoryPipeline.addEvent(hookEvent).catch(console.error);
    }, 0);
    
    return { success: true, continue: true };
  }
});

hooksManager.register('ErrorOccurred', {
  phase: 'error',
  priority: 100,
  enabled: true,
  handler: async (context) => {
    const hookEvent: HookEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'ErrorOccurred',
      phase: 'error',
      context,
      timestamp: Date.now()
    };
    
    setTimeout(() => {
      eventToMemoryPipeline.addEvent(hookEvent).catch(console.error);
    }, 0);
    
    return { success: true, continue: true };
  }
});