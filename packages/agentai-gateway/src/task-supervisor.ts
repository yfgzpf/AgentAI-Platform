/**
 * task-supervisor.ts — 任务自监督系统 (MVP)
 * =====================================================
 * 功能:
 *   1. 任务计时 — 记录已工作时长 (参考 ZCode "已工作 2分46秒")
 *   2. 中断检测 — 检测模型掉线、速率限制、超时
 *   3. 自动恢复提示 — 生成任务继续指令
 *   4. 文件变更统计 — 实时统计 +xx -yy (参考 ZCode)
 *
 * 设计原则:
 *   - 轻量级: 不引入新依赖，复用现有 task-snapshot
 *   - 安全: 只建议不强制，用户可随时中断
 *   - 可配置: 通过环境变量控制行为
 */

import { EventEmitter } from 'events';
import type { TaskSnapshotManager } from './task-snapshot.js';

// ===== 类型定义 =====

export interface TaskSupervisorConfig {
  /** 空闲超时 (ms), 超过此时间无响应视为中断 */
  idleTimeout?: number;
  /** 最大自动恢复次数 */
  maxAutoResume?: number;
  /** 是否启用自动恢复 */
  autoResumeEnabled?: boolean;
}

export interface TaskHealthStatus {
  /** 是否健康 */
  healthy: boolean;
  /** 健康状态描述 */
  status: 'idle' | 'running' | 'interrupted' | 'completed' | 'unknown';
  /** 最后活动时间戳 */
  lastActivityAt: number;
  /** 已空闲时长 (ms) */
  idleDuration: number;
  /** 中断原因 (如果有) */
  interruptionReason?: InterruptionReason;
}

export type InterruptionReason =
  | 'model_error'
  | 'rate_limit'
  | 'timeout'
  | 'network_error'
  | 'token_limit'
  | 'user_cancelled'
  | 'unknown';

export interface TaskResumePrompt {
  /** 是否应该恢复 */
  shouldResume: boolean;
  /** 恢复提示文本 */
  prompt: string;
  /** 恢复原因 */
  reason: string;
  /** 置信度 (0-1) */
  confidence: number;
}

// ===== 主类 =====

export class TaskSupervisor extends EventEmitter {
  private config: Required<TaskSupervisorConfig>;
  
  // 计时相关
  private _startTime: number = 0;
  private _lastActivityTime: number = Date.now();
  private _isRunning: boolean = false;
  
  // 统计相关
  private _fileChangeStats: { additions: number; deletions: number; files: Set<string> } = {
    additions: 0,
    deletions: 0,
    files: new Set(),
  };
  
  // 恢复计数
  private _autoResumeCount: number = 0;

  constructor(config: TaskSupervisorConfig = {}) {
    super();
    this.config = {
      idleTimeout: config.idleTimeout || 60_000, // 默认 1 分钟无响应视为中断
      maxAutoResume: config.maxAutoResume || 5,
      autoResumeEnabled: config.autoResumeEnabled !== false, // 默认启用
    };
  }

  // ===== 1. 任务计时 (ZCode 风格: "已工作 2分46秒") =====

  /** 开始计时 */
  startTimer(): void {
    this._startTime = Date.now();
    this._lastActivityTime = Date.now();
    this._isRunning = true;
    this.emit('timer:start', { startTime: this._startTime });
  }

  /** 停止计时 */
  stopTimer(): void {
    this._isRunning = false;
    const elapsed = this.getElapsedTime();
    this.emit('timer:stop', { elapsed });
  }

  /** 更新最后活动时间 (每次 LLM 响应/工具调用时调用) */
  updateActivity(): void {
    this._lastActivityTime = Date.now();
  }

  /** 获取已工作时长 (格式化: "2分46秒") */
  getElapsedTime(): number {
    if (!this._isRunning && !this._startTime) return 0;
    return Date.now() - this._startTime;
  }

  /** 格式化耗时显示 */
  getFormattedElapsed(): string {
    const ms = this.getElapsedTime();
    if (ms < 1000) return `${ms}ms`;
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}秒`;
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}分${remainingSeconds.toString().padStart(2, '0')}秒`;
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}小时${remainingMinutes}分`;
  }

  /** 获取计时器状态 (用于前端展示) */
  getTimerState() {
    return {
      isRunning: this._isRunning,
      elapsed: this.getElapsedTime(),
      formatted: this.getFormattedElapsed(),
      startTime: this._startTime,
      lastActivity: this._lastActivityTime,
    };
  }

  // ===== 2. 文件变更统计 (ZCode 风格: "+195 -64") =====

  /** 记录文件变更 */
  recordFileChange(filePath: string, additions: number = 0, deletions: number = 0): void {
    this._fileChangeStats.additions += additions;
    this._fileChangeStats.deletions += deletions;
    if (filePath) {
      this._fileChangeStats.files.add(filePath);
    }
    this.emit('file:change', {
      filePath,
      additions,
      deletions,
      total: this.getFileChangeSummary(),
    });
  }

  /** 从工具调用结果中解析变更 (智能提取 +xx -yy) */
  parseFileChangeFromResult(toolName: string, result: string): void {
    // write_file / multi_edit 操作
    if (['write_file', 'multi_edit'].includes(toolName)) {
      const addMatch = result.match(/\+(\d+)/);
      const delMatch = result.match(/-(\d+)/);
      const additions = addMatch ? parseInt(addMatch[1]) || 0 : 0;
      const deletions = delMatch ? parseInt(delMatch[1]) || 0 : 0;
      
      if (additions > 0 || deletions > 0) {
        // 尝试从结果中提取文件路径
        const pathMatch = result.match(/(?:file|path)["':\s]+(["'])([^"']+)\1/i);
        const filePath = pathMatch ? pathMatch[2] : `unknown-${Date.now()}`;
        this.recordFileChange(filePath, additions, deletions);
      }
    }
  }

  /** 重置变更统计 (新任务开始时调用) */
  resetFileChanges(): void {
    this._fileChangeStats = { additions: 0, deletions: 0, files: new Set() };
  }

  /** 获取文件变更摘要 (用于前端展示) */
  getFileChangeSummary() {
    return {
      files: this._fileChangeStats.files.size,
      additions: this._fileChangeStats.additions,
      deletions: this._fileChangeStats.deletions,
      formatted: `+${this._fileChangeStats.additions} -${this._fileChangeStats.deletions}`,
    };
  }

  // ===== 3. 中断检测 =====

  /** 检查任务健康状态 */
  checkHealth(): TaskHealthStatus {
    const now = Date.now();
    const idleDuration = now - this._lastActivityTime;
    
    let status: TaskHealthStatus['status'] = 'unknown';
    let healthy = true;
    let interruptionReason: InterruptionReason | undefined;

    if (!this._isRunning) {
      status = 'idle';
    } else if (idleDuration > this.config.idleTimeout) {
      status = 'interrupted';
      healthy = false;
      interruptionReason = 'timeout';
    } else if (this._isRunning) {
      status = 'running';
    }

    return {
      healthy,
      status,
      lastActivityAt: this._lastActivityTime,
      idleDuration,
      interruptionReason,
    };
  }

  /** 检测具体的中断原因 */
  detectInterruption(error?: Error | string): InterruptionReason {
    const errStr = (error instanceof Error ? error.message : error || '').toLowerCase();
    
    if (errStr.includes('rate limit') || errStr.includes('429') || errStr.includes('too many requests')) {
      return 'rate_limit';
    }
    if (errStr.includes('timeout') || errStr.includes('timed out')) {
      return 'timeout';
    }
    if (errStr.includes('token') || errStr.includes('context length')) {
      return 'token_limit';
    }
    if (errStr.includes('network') || errStr.includes('econnrefused') || errStr.includes('enotfound')) {
      return 'network_error';
    }
    if (errStr.includes('model') || errStr.includes('provider error')) {
      return 'model_error';
    }
    
    return 'unknown';
  }

  // ===== 4. 自动恢复决策 =====

  /**
   * 判断是否应该自动恢复任务
   * @param options 检测选项
   * @returns 恢复决策
   */
  async shouldAutoResume(options: {
    /** 最后一次错误 */
    lastError?: Error | string | null;
    /** 当前任务快照 (可选) */
    taskSnapshot?: any;
    /** 工具调用历史 */
    toolHistory?: Array<{ name: string; ok: boolean }>;
  }): Promise<TaskResumePrompt> {
    
    // 检查是否启用
    if (!this.config.autoResumeEnabled) {
      return { shouldResume: false, prompt: '', reason: 'auto_resume_disabled', confidence: 0 };
    }

    // 检查恢复次数限制
    if (this._autoResumeCount >= this.config.maxAutoResume) {
      return { 
        shouldResume: false, 
        prompt: '', 
        reason: 'max_auto_resume_reached', 
        confidence: 0 
      };
    }

    // 检查健康状态
    const health = this.checkHealth();
    if (health.healthy) {
      return { shouldResume: false, prompt: '', reason: 'task_healthy', confidence: 0 };
    }

    // 分析中断原因
    const reason = this.detectInterruption(options.lastError || undefined);
    
    // 根据原因决定是否恢复
    let shouldResume = false;
    let confidence = 0;
    let prompt = '';

    switch (reason) {
      case 'rate_limit':
        // 速率限制: 可以等待后重试
        shouldResume = true;
        confidence = 0.7;
        prompt = this.generateRateLimitPrompt();
        break;
        
      case 'timeout':
        // 超时: 可能是模型慢，可以尝试
        shouldResume = true;
        confidence = 0.6;
        prompt = this.generateTimeoutPrompt();
        break;
        
      case 'token_limit':
        // Token 限制: 通常由循环自动处理
        shouldResume = false;
        confidence = 0.3;
        break;
        
      case 'network_error':
        // 网络错误: 可以尝试重连
        shouldResume = true;
        confidence = 0.8;
        prompt = this.generateNetworkErrorPrompt();
        break;
        
      case 'model_error':
        // 模型错误: 可能需要切换模型
        shouldResume = true;
        confidence = 0.65;
        prompt = this.generateModelErrorPrompt();
        break;
        
      default:
        // 未知原因: 保守处理
        shouldResume = false;
        confidence = 0.2;
    }

    // 如果有未完成的任务步骤，提高恢复置信度
    if (options.taskSnapshot && !options.taskSnapshot.isCompleted?.()) {
      confidence = Math.min(confidence + 0.15, 0.95);
      if (confidence > 0.7) shouldResume = true;
    }

    if (shouldResume) {
      this._autoResumeCount++;
    }

    return { shouldResume, prompt, reason, confidence };
  }

  // ===== 恢复提示生成器 =====

  private generateRateLimitPrompt(): string {
    const elapsed = this.getFormattedElapsed();
    const changes = this.getFileChangeSummary();
    return `[任务自监督] 检测到 API 速率限制，任务已暂停。
- 已工作: ${elapsed}
- 文件变更: ${changes.formatted} (${changes.files} 个文件)
- 建议: 等待几秒后继续执行当前任务。请检查之前的进度，从断点处继续。`;
  }

  private generateTimeoutPrompt(): string {
    const elapsed = this.getFormattedElapsed();
    const changes = this.getFileChangeSummary();
    return `[任务自监督] 检测到请求超时，可能模型响应较慢。
- 已工作: ${elapsed}
- 文件变更: ${changes.formatted}
- 建议: 任务尚未完成，请继续执行。如果连续超时，考虑简化操作或拆分任务。`;
  }

  private generateNetworkErrorPrompt(): string {
    const elapsed = this.getFormattedElapsed();
    const changes = this.getFileChangeSummary();
    return `[任务自监督] 检测到网络连接问题。
- 已工作: ${elapsed}
- 文件变更: ${changes.formatted}
- 建议: 网络已恢复，请继续完成当前任务。先回顾已完成的工作，然后继续下一步。`;
  }

  private generateModelErrorPrompt(): string {
    const elapsed = this.getFormattedElapsed();
    const changes = this.getFileChangeSummary();
    return `[任务自监督] 模型返回错误，正在尝试恢复。
- 已工作: ${elapsed}
- 文件变更: ${changes.formatted}
- 建议: 如果错误持续，系统会自动切换模型。请尝试用更简单的方式完成任务。`;
  }

  /** 生成通用任务继续提示 (下次对话注入) */
  generateTaskResumeContext(taskGoal: string, snapshot?: any): string {
    const elapsed = this.getFormattedElapsed();
    const changes = this.getFileChangeSummary();
    const health = this.checkHealth();
    
    let context = `[任务自监督报告]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 原始任务: ${taskGoal}
⏱️  已工作时长: ${elapsed}
📊 文件变更: ${changes.formatted} (${changes.files} 个文件)
🔍 状态: ${health.status}`;

    if (snapshot) {
      context += `\n📈 进度: ${snapshot.progressPercent || '?'}%`;
      if (snapshot.completedSteps?.length) {
        context += `\n✅ 已完成步骤: ${snapshot.completedSteps.length} 个`;
      }
      if (snapshot.pendingSteps?.length) {
        context += `\n⏳ 待完成步骤:\n${snapshot.pendingSteps.map((s: any, i: number) => `  ${i + 1}. ${s}`).join('\n')}`;
      }
    }

    if (health.interruptionReason) {
      context += `\n⚠️  中断原因: ${health.interruptionReason}`;
    }

    context += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[建议] 继续执行任务，从上次中断处开始。`;

    return context;
  }

  // ===== 重置 =====

  /** 重置所有状态 (新任务开始时调用) */
  reset(): void {
    this._startTime = 0;
    this._lastActivityTime = Date.now();
    this._isRunning = false;
    this._autoResumeCount = 0;
    this.resetFileChanges();
    this.emit('reset');
  }

  /** 获取完整状态 (用于调试/序列化) */
  getState() {
    return {
      timer: this.getTimerState(),
      fileChanges: this.getFileChangeSummary(),
      health: this.checkHealth(),
      autoResumeCount: this._autoResumeCount,
      config: this.config,
    };
  }
}

// ===== 单例导出 (全局共享) =====

let _instance: TaskSupervisor | null = null;

export function getTaskSupervisor(config?: TaskSupervisorConfig): TaskSupervisor {
  if (!_instance) {
    _instance = new TaskSupervisor(config);
  }
  return _instance;
}

export function resetTaskSupervisor(): void {
  if (_instance) {
    _instance.reset();
  }
  _instance = null;
}
