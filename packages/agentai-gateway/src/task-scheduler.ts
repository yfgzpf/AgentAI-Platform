/**
 * Task Scheduler — 用户可配置的定时任务调度器
 * ==================================================
 * 核心能力:
 *   1. 定时执行 RPA 脚本 (browser_replay)
 *   2. 定时执行自定义 AI 任务 (通过 agentai-loop 发送消息)
 *   3. 定时触发通知推送
 *   4. Cron 表达式调度 + 一次性定时
 *   5. 任务执行历史 + 失败重试 + 通知告警
 *
 * 存储路径: ~/.agentai/task-schedules.json
 *
 * 与现有 cron-dispatcher.ts 的关系:
 *   cron-dispatcher.ts 是系统内置的 6 个固定定时任务 (反思/清理/进化等)
 *   task-scheduler.ts 是用户/AI 动态创建的定时任务 (RPA/AI任务/通知)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CronJob } from './cron-job.js';

// ===== 类型定义 =====

export type ScheduleType = 'rpa' | 'ai_task' | 'notification' | 'custom' | 'workflow';
export type ScheduleStatus = 'active' | 'paused' | 'disabled';

export interface TaskSchedule {
  id: string;
  name: string;
  description: string;
  /** 任务类型 */
  type: ScheduleType;
  /** Cron 表达式 (5 字段: 分 时 日 月 周) 或 'once' 表示一次性 */
  cron: string;
  /** 一次性任务的执行时间 (ISO 字符串, cron='once' 时必填) */
  runAt?: string;
  /** 任务参数 (根据 type 不同) */
  config: ScheduleConfig;
  /** 状态 */
  status: ScheduleStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
  /** 上次执行时间 */
  lastRunAt?: number;
  /** 上次执行结果 */
  lastResult?: { success: boolean; output?: string; error?: string; durationMs: number };
  /** 执行次数 */
  runCount: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failCount: number;
  /** 最大重试次数 (默认 0) */
  maxRetries: number;
  /** 执行超时 (毫秒, 默认 120000 = 2 分钟) */
  timeoutMs: number;
  /** 失败时是否发送通知 */
  notifyOnFailure: boolean;
  /** 成功时是否发送通知 */
  notifyOnSuccess: boolean;
}

export interface ScheduleConfig {
  // type='rpa': RPA 回放配置
  rpaScriptId?: string;
  rpaSteps?: any[];
  rpaVariables?: Record<string, string>;

  // type='ai_task': AI 任务配置
  aiMessage?: string;
  aiSessionId?: string;

  // type='notification': 通知配置
  notifTitle?: string;
  notifBody?: string;
  notifLevel?: 'info' | 'success' | 'warning' | 'error';
  notifChannel?: 'sse' | 'webhook' | 'email' | 'desktop';

  // type='custom': 自定义 HTTP 调用
  customUrl?: string;
  customMethod?: string;
  customBody?: any;

  // type='workflow': 工作流模板执行
  workflowTemplateId?: string;
  workflowVariables?: Record<string, any>;
}

export interface ScheduleExecutionResult {
  scheduleId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  executedAt: number;
}

// ===== 持久化 =====

const SCHEDULES_FILE = path.join(os.homedir(), '.agentai', 'task-schedules.json');

function ensureFile(): void {
  const dir = path.dirname(SCHEDULES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SCHEDULES_FILE)) fs.writeFileSync(SCHEDULES_FILE, '[]', 'utf-8');
}

// ===== 调度器 =====

class TaskScheduler {
  private schedules: Map<string, TaskSchedule> = new Map();
  private jobs: Map<string, CronJob> = new Map();
  private gatewayUrl: string = 'http://127.0.0.1:18789';

  constructor() {
    this._load();
  }

  setGatewayUrl(url: string): void {
    this.gatewayUrl = url;
  }

  private _load(): void {
    try {
      ensureFile();
      const data = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf-8')) as TaskSchedule[];
      for (const s of data) {
        this.schedules.set(s.id, s);
        // 自动恢复 active 状态的任务
        if (s.status === 'active') {
          this._startJob(s);
        }
      }
      console.log(`[task-scheduler] 加载 ${this.schedules.size} 个调度任务`);
    } catch { /* first run */ }
  }

  private _save(): void {
    try {
      ensureFile();
      const data = Array.from(this.schedules.values());
      fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn(`[task-scheduler] 保存失败: ${e.message}`);
    }
  }

  // ─── CRUD ───

  create(data: Omit<TaskSchedule, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'failCount'>): TaskSchedule {
    const schedule: TaskSchedule = {
      ...data,
      id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
      successCount: 0,
      failCount: 0,
      maxRetries: data.maxRetries ?? 0,
      timeoutMs: data.timeoutMs ?? 120_000,
      notifyOnFailure: data.notifyOnFailure ?? true,
      notifyOnSuccess: data.notifyOnSuccess ?? false,
    };
    this.schedules.set(schedule.id, schedule);
    if (schedule.status === 'active') this._startJob(schedule);
    this._save();
    return schedule;
  }

  get(id: string): TaskSchedule | undefined {
    return this.schedules.get(id);
  }

  list(status?: ScheduleStatus): TaskSchedule[] {
    const all = Array.from(this.schedules.values()).sort((a, b) => b.createdAt - a.createdAt);
    return status ? all.filter(s => s.status === status) : all;
  }

  update(id: string, updates: Partial<Omit<TaskSchedule, 'id' | 'createdAt'>>): TaskSchedule | null {
    const existing = this.schedules.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
    this.schedules.set(id, updated);
    // 重启 job
    this._stopJob(id);
    if (updated.status === 'active') this._startJob(updated);
    this._save();
    return updated;
  }

  delete(id: string): boolean {
    this._stopJob(id);
    const existed = this.schedules.delete(id);
    if (existed) this._save();
    return existed;
  }

  pause(id: string): TaskSchedule | null {
    return this.update(id, { status: 'paused' });
  }

  resume(id: string): TaskSchedule | null {
    return this.update(id, { status: 'active' });
  }

  /** 手动触发一次执行 (不影响调度) */
  async runOnce(id: string): Promise<ScheduleExecutionResult> {
    const schedule = this.schedules.get(id);
    if (!schedule) {
      return { scheduleId: id, success: false, error: '调度任务不存在', durationMs: 0, executedAt: Date.now() };
    }
    return this._execute(schedule);
  }

  // ─── 调度执行 ───

  private _startJob(schedule: TaskSchedule): void {
    // 一次性任务
    if (schedule.cron === 'once' && schedule.runAt) {
      const delay = new Date(schedule.runAt).getTime() - Date.now();
      if (delay <= 0) {
        // 已过期, 立即执行一次然后标记为 disabled
        this._execute(schedule).then(() => {
          this.update(schedule.id, { status: 'disabled' });
        });
        return;
      }
      const timer = setTimeout(() => {
        this._execute(schedule).then(() => {
          this.update(schedule.id, { status: 'disabled' });
        });
      }, delay);
      // 用 CronJob 的 interval 机制模拟 (实际上是一次性的)
      // 存 timer 引用以便取消
      (timer as any)._scheduleId = schedule.id;
      this.jobs.set(schedule.id, { stop: () => clearTimeout(timer) } as any);
      return;
    }

    // 周期性任务
    try {
      const job = new CronJob(schedule.cron, async () => {
        await this._execute(schedule);
      });
      job.start();
      this.jobs.set(schedule.id, job);
    } catch (e: any) {
      console.warn(`[task-scheduler] 启动失败 ${schedule.name}: ${e.message}`);
    }
  }

  private _stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      try { job.stop(); } catch {}
      this.jobs.delete(id);
    }
  }

  /** 执行调度任务（带重试） */
  private async _execute(schedule: TaskSchedule): Promise<ScheduleExecutionResult> {
    const startTime = Date.now();
    console.log(`[task-scheduler] 执行: ${schedule.name} (${schedule.type})`);

    let result: ScheduleExecutionResult | undefined;
    let attempts = 0;
    const maxRetries = schedule.maxRetries || 0;
    
    while (attempts <= maxRetries) {
      attempts++;
      
      try {
        // 超时保护
        const timeoutPromise = new Promise<ScheduleExecutionResult>((_, reject) => {
          setTimeout(() => reject(new Error(`任务超时 (${schedule.timeoutMs}ms)`)), schedule.timeoutMs);
        });

        const execPromise = this._executeByType(schedule);
        result = await Promise.race([execPromise, timeoutPromise]);
        
        // 成功，跳出重试循环
        if (result.success) break;
        
        // 失败但还有重试次数
        if (attempts <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000); // 指数退避，最大30秒
          console.log(`[task-scheduler] 任务失败，${delay}ms后第${attempts}次重试...`);
          await new Promise(r => setTimeout(r, delay));
        }
      } catch (e: any) {
        result = {
          scheduleId: schedule.id,
          success: false,
          error: e.message,
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
        
        // 异常但还有重试次数
        if (attempts <= maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
          console.log(`[task-scheduler] 任务异常，${delay}ms后第${attempts}次重试...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    // result 在此一定已赋值（while 至少执行一次）
    const safeResult = result!;
    
    // 更新统计
    const s = this.schedules.get(safeResult.scheduleId);
    if (s) {
      s.lastRunAt = Date.now();
      s.lastResult = { 
        success: safeResult.success, 
        output: safeResult.output?.slice(0, 500), 
        error: safeResult.error, 
        durationMs: safeResult.durationMs,
      };
      s.runCount++;
      if (safeResult.success) s.successCount++;
      else s.failCount++;
      this._save();
    }

    // 通知
    if (!safeResult.success && schedule.notifyOnFailure) {
      await this._notify(schedule, false, safeResult as any, attempts);
    } else if (safeResult.success && schedule.notifyOnSuccess) {
      await this._notify(schedule, true, safeResult as any, attempts);
    }

    const retryInfo = attempts > 1 ? ` (重试${attempts - 1}次)` : '';
    console.log(`[task-scheduler] 完成: ${schedule.name} → ${safeResult.success ? '✅' : '❌'}${retryInfo} (${safeResult.durationMs}ms)`);
    return safeResult;
  }

  /** 根据类型执行 */
  private async _executeByType(schedule: TaskSchedule): Promise<ScheduleExecutionResult> {
    const startTime = Date.now();
    const cfg = schedule.config;

    switch (schedule.type) {
      case 'rpa': {
        // 调用 RPA 回放
        const body: any = {};
        if (cfg.rpaScriptId) body.script_id = cfg.rpaScriptId;
        if (cfg.rpaSteps) body.steps = cfg.rpaSteps;
        if (cfg.rpaVariables) body.variables = cfg.rpaVariables;
        const resp = await fetch(`${this.gatewayUrl}/v1/chat/tools`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: 'browser_replay', args: body }),
        });
        const data: any = await resp.json();
        return {
          scheduleId: schedule.id,
          success: data.success !== false,
          output: data.output || JSON.stringify(data).slice(0, 500),
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
      }

      case 'ai_task': {
        // 发送 AI 消息
        const resp = await fetch(`${this.gatewayUrl}/v1/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: cfg.aiMessage || schedule.description,
            sessionId: cfg.aiSessionId || `scheduled-${schedule.id}`,
            auto: true,
          }),
        });
        const data: any = await resp.json();
        return {
          scheduleId: schedule.id,
          success: !data.error,
          output: data.response?.slice(0, 500) || data.error,
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
      }

      case 'notification': {
        // 发送通知
        const resp = await fetch(`${this.gatewayUrl}/v1/chat/tools`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool: 'send_notification',
            args: {
              title: cfg.notifTitle || schedule.name,
              body: cfg.notifBody || schedule.description,
              level: cfg.notifLevel || 'info',
              channel: cfg.notifChannel || 'sse',
              source: `定时任务: ${schedule.name}`,
            },
          }),
        });
        const data: any = await resp.json();
        return {
          scheduleId: schedule.id,
          success: data.success !== false,
          output: data.output || '通知已发送',
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
      }

      case 'custom': {
        // 自定义 HTTP 调用
        const resp = await fetch(cfg.customUrl || '', {
          method: cfg.customMethod || 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: cfg.customBody ? JSON.stringify(cfg.customBody) : undefined,
        });
        const text = await resp.text();
        return {
          scheduleId: schedule.id,
          success: resp.ok,
          output: text.slice(0, 500),
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
      }

      case 'workflow': {
        // 执行工作流模板
        const { getWorkflowEngine } = await import('./workflow-template-engine.js');
        const engine = getWorkflowEngine();
        engine.setGatewayUrl(this.gatewayUrl);
        if (!cfg.workflowTemplateId) {
          return { scheduleId: schedule.id, success: false, output: '缺少工作流模板ID', error: 'workflowTemplateId is required', durationMs: Date.now() - startTime, executedAt: Date.now() };
        }
        const execution = await engine.execute(cfg.workflowTemplateId, cfg.workflowVariables || {});
        return {
          scheduleId: schedule.id,
          success: execution.status !== 'failed',
          output: `工作流 ${execution.status}: ${execution.templateName} (${execution.stepResults.size}步)`,
          error: execution.error,
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
      }

      default:
        return {
          scheduleId: schedule.id,
          success: false,
          error: `未知任务类型: ${schedule.type}`,
          durationMs: Date.now() - startTime,
          executedAt: Date.now(),
        };
    }
  }

  /** 发送通知 (成功/失败) */
  private async _notify(schedule: TaskSchedule, success: boolean, result: ScheduleExecutionResult, attempts: number = 1): Promise<void> {
    try {
      const { getNotificationEngine } = await import('./notification-engine.js');
      const engine = getNotificationEngine();
      
      const retryInfo = attempts > 1 ? ` (重试${attempts - 1}次)` : '';
      await engine.send({
        title: `[定时任务] ${schedule.name} ${success ? '✅ 执行成功' : '❌ 执行失败'}${retryInfo}`,
        body: result.error
          ? `错误: ${result.error}\n耗时: ${result.durationMs}ms\n尝试次数: ${attempts}\n总执行次数: ${schedule.runCount}`
          : `结果: ${result.output || '完成'}\n耗时: ${result.durationMs}ms\n尝试次数: ${attempts}\n总执行次数: ${schedule.runCount}`,
        level: success ? 'success' : 'error',
        channel: 'sse',
        source: `定时任务调度器`,
      });
    } catch { /* best effort */ }
  }

  /** 获取统计 */
  getStats(): { total: number; active: number; paused: number; totalRuns: number; totalSuccess: number; totalFail: number } {
    let active = 0, paused = 0, totalRuns = 0, totalSuccess = 0, totalFail = 0;
    for (const s of this.schedules.values()) {
      if (s.status === 'active') active++;
      else if (s.status === 'paused') paused++;
      totalRuns += s.runCount;
      totalSuccess += s.successCount;
      totalFail += s.failCount;
    }
    return { total: this.schedules.size, active, paused, totalRuns, totalSuccess, totalFail };
  }

  /** 停止所有任务 */
  stopAll(): void {
    for (const id of this.jobs.keys()) {
      this._stopJob(id);
    }
    console.log('[task-scheduler] 已停止所有调度任务');
  }
}

// ===== 单例 =====

let _instance: TaskScheduler | null = null;

export function getTaskScheduler(): TaskScheduler {
  if (!_instance) _instance = new TaskScheduler();
  return _instance;
}
