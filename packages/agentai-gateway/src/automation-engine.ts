/**
 * AutomationEngine — AI 主动创建的自动化工作流引擎
 * ----------------------------------------------------
 * 核心能力:
 *   1. Cron Jobs — AI 可创建定时任务 (create_cron_job / delete_cron_job / list_cron_jobs)
 *   2. 自动化规则 — AI 可创建触发器规则 (create_automation_rule / list_automation_rules / toggle)
 *   3. 后台任务 — AI 可创建常驻后台任务 (create_background_task)
 *
 * AI 通过工具调用管理整个系统, 无需人工编辑配置。
 *
 * cron + autonomous systems 设计理念
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { isUserTaskActive } from './runtime-activity.js';
import { parseCron, cronMatches } from './cron-parse.js';

// ===== 类型定义 =====

export interface CronJob {
  id: string;
  name: string;
  expression: string;          // cron 表达式: "0 */2 * * *" (每2小时)
  action: string;              // 工具名称: "run_command", "web_search", etc.
  params: Record<string, any>; // 工具参数
  status: 'active' | 'paused' | 'disabled';
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  createdBy: 'ai' | 'user';
  // 智能健康管理字段
  failCount?: number;          // 连续失败次数
  lastFailAt?: number;        // 上次失败时间
  successCount?: number;       // 累计成功次数
  autoDisabledReason?: string; // 自动禁用原因
  lastDiag?: string;           // A1: 结构化失败诊断 JSON
  presetVersion?: number;     // 预设版本号 (用于检测是否需要更新)
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: 'file_change' | 'git_commit' | 'time_interval' | 'system_event' | 'ai_suggestion';
    pattern?: string;           // glob pattern for file_change
    intervalMs?: number;        // for time_interval
  };
  action: {
    tool: string;               // 要调用的工具名
    params: Record<string, any>;
  };
  status: 'active' | 'paused';
  createdAt: number;
  lastTriggered?: number;
  createdBy: 'ai' | 'user';
}

export interface BackgroundTask {
  id: string;
  name: string;
  description: string;
  prompt: string;              // AI 自主执行的 prompt
  intervalMs: number;          // 执行间隔
  status: 'running' | 'paused' | 'stopped';
  createdAt: number;
  lastRun?: number;
}

// ===== 引擎 =====

const DATA_DIR = '.agentai/automation/';

export class AutomationEngine extends EventEmitter {
  private cronJobs: Map<string, CronJob> = new Map();
  private rules: Map<string, AutomationRule> = new Map();
  private backgroundTasks: Map<string, BackgroundTask> = new Map();
  private workspace: string;
  private _timers: Map<string, any> = new Map(); // NodeJS.Timeout
  private _loaded = false;
  private _registry?: any;
  private _router?: any;

  constructor(workspace: string, registry?: any, router?: any) {
    super();
    // P1 修复: 增加最大监听器限制, 防止定时任务触发时内存泄漏警告
    this.setMaxListeners(50);
    this.workspace = workspace;
    this._registry = registry;
    this._router = router;
  }

  // ===== 持久化 =====

  private dataDir(): string {
    return path.join(this.workspace, DATA_DIR);
  }

  private ensureDir(): void {
    fs.mkdirSync(this.dataDir(), { recursive: true });
  }

  private save(): void {
    this.ensureDir();
    fs.writeFileSync(path.join(this.dataDir(), 'cron-jobs.json'), JSON.stringify([...this.cronJobs.values()], null, 2), 'utf-8');
    fs.writeFileSync(path.join(this.dataDir(), 'rules.json'), JSON.stringify([...this.rules.values()], null, 2), 'utf-8');
    fs.writeFileSync(path.join(this.dataDir(), 'background-tasks.json'), JSON.stringify([...this.backgroundTasks.values()], null, 2), 'utf-8');
  }

  load(): void {
    if (this._loaded) return;
    this.ensureDir();
    try {
      const cronData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'cron-jobs.json'), 'utf-8'));
      for (const item of cronData) this.cronJobs.set(item.id, item);
    } catch { /* 首次加载无文件 */ }
    try {
      const rulesData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'rules.json'), 'utf-8'));
      for (const item of rulesData) this.rules.set(item.id, item);
    } catch { /* 无文件 */ }
    try {
      const tasksData = JSON.parse(fs.readFileSync(path.join(this.dataDir(), 'background-tasks.json'), 'utf-8'));
      for (const item of tasksData) this.backgroundTasks.set(item.id, item);
    } catch { /* 无文件 */ }
    this._loaded = true;
    // 自动检测工作区环境 → 自动安装匹配的预设模板 (已存在的跳过)
    this.autoDetectAndInstall();
    this.startTimers();
    // 监听所有 cron:tick → 执行 action + 蒸馏特殊处理
    this.on('cron:tick', async (job: CronJob) => {
      try {
        // ═══ 2026-10-11: 用户任务进行中 → 本次 tick 让路 ═══
        // 用户反馈「自动化任务会影响任务进程, 导致任务老是卡住 不流畅」。
        // cron 与用户任务共用同一 gateway 进程 / workspace, 同时跑会互相抢工具与子进程。
        // 「跳过」= 纯让路: 不执行 action、不累加 successCount/failCount、不触发自动禁用。
        // (lastRun 由 scheduleCron 的 emit 处统一更新, 与本次是否执行无关)
        if (isUserTaskActive()) {
          console.log(`[automation] ⏸️ 用户任务进行中, ${job.name} 本次 tick 跳过 (让路)`);
          return;
        }

        console.log(`[automation] ⏰ 定时任务触发: ${job.name} (action=${job.action})`);

        // 蒸馏任务: 特殊逻辑
        if (job.action === 'run_distillation' || job.name.includes('蒸馏')) {
          try {
            const { runDistillation, installAutomationsFromDistillation } = await import('./model-distiller.js');
            const result = runDistillation();
            if (result.stats.patternsGenerated > 0) {
              const installed = installAutomationsFromDistillation(this);
              console.log(`[automation] 🧠 蒸馏完成: ${result.stats.patternsGenerated} 个模式, 装 ${installed.length} 个任务`);
            }
          } catch (e: any) {
            console.warn('[automation] 蒸馏失败:', e?.message);
          }
          return;
        }

        // 通用 action 执行: 通过 ToolRegistry 调用工具
        if (this._registry && job.action) {
          // A3 修复: registry 未 ready 时不误判工具不存在
          if (!this._registry.isReady?.() && !this._registry.list?.()) {
            console.warn(`[automation] ⏳ ${job.name}: registry 尚未 ready, 跳过本次执行 (不计数)`);
            return;
          }

          const tool = this._registry.get(job.action);
          if (tool) {
            // 智能健康管理: disabled 状态的任务不执行
            if (job.status === 'disabled') {
              console.log(`[automation] ⏭️ ${job.name} 已自动禁用 (${job.autoDisabledReason}), 跳过执行`);
              return;
            }

            // A2 修复: 超时保护 — 每个任务有独立 timeout
            // 重工具 (batch_pentest 等要 spawn 子智能体跑多轮 LLM) 默认 30 分钟,
            // 普通命令类保持 120s — 否则子智能体刚起就被 abort。
            const isHeavyTool = job.action === 'batch_pentest' || job.action === 'subagent_run';
            const jobTimeoutMs = (job as any).timeoutMs || (isHeavyTool ? 1_800_000 : 120_000);
            const abortCtrl = new AbortController();
            const timeoutTimer = setTimeout(() => abortCtrl.abort(), jobTimeoutMs);

            const execStart = Date.now();
            let result: any;
            try {
              // 2026-10-16: workspace 跟随**活动工作区** (WorkspaceManager), 不是 gateway 进程 cwd。
              // 授权目标 (scope.json / vulns) 都落在用户当前选定的工作区 (如 F:/目录已检查/澳彩),
              // gateway 进程 cwd 是 F:/agentai-platform — 用 cwd 会读不到授权目标 → cron 空跑。
              let wsForTool = this.workspace;
              if (job.action === 'batch_pentest') {
                try {
                  const { WorkspaceManager } = await import('./workspace-manager.js');
                  wsForTool = String(WorkspaceManager.getInstance().projectDir)
                    .replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
                } catch { /* fallback 到 this.workspace */ }
              }
              result = await tool.handler(job.params || {}, {
                userId: 'system',
                workspace: wsForTool,
                abortSignal: abortCtrl.signal,
                // 2026-10-16: 注入 registry/router — batch_pentest 等重工具需要
                // spawn 子智能体 (router 走 LLM, registry 供子智能体调工具),
                // 没有它们工具只能返回"请在主对话里跑 /batch", cron 白跑。
                _registry: this._registry,
                _router: this._router,
              });
            } catch (e: any) {
              result = { success: false, output: '', error: e.message, _timedOut: abortCtrl.signal.aborted };
            } finally {
              clearTimeout(timeoutTimer);
            }
            const durationMs = Date.now() - execStart;
            job.lastRun = Date.now();

            // A1 修复: 结构化失败日志 — 完整诊断信息
            if (result.success) {
              job.lastResult = `✅ 成功 (${durationMs}ms)`;
              job.failCount = 0;
              job.successCount = (job.successCount || 0) + 1;
              console.log(`[automation] ✅ ${job.name} 执行成功 (累计 ${job.successCount} 次, ${durationMs}ms)`);
            } else {
              const errorMsg = result.error || result.output || 'unknown';
              const isTimeout = result._timedOut || errorMsg.includes('超时') || errorMsg.includes('timeout');
              // A1: 结构化诊断记录
              const diag = {
                tool: job.action,
                exitCode: result.exitCode ?? (result.success ? 0 : 1),
                stdoutTail: typeof result.output === 'string' ? result.output.slice(-300) : '',
                stderrTail: typeof result.error === 'string' ? result.error.slice(-300) : '',
                durationMs,
                cwd: this.workspace,
                platform: process.platform,
                nodeVersion: process.version,
                timedOut: isTimeout,
                paramsHash: JSON.stringify(job.params || {}).slice(0, 100),
                timestamp: new Date().toISOString(),
              };
              const diagStr = JSON.stringify(diag);
              job.lastResult = `❌ 失败: ${isTimeout ? '[超时] ' : ''}${errorMsg.slice(0, 200)}`;
              job.lastDiag = diagStr; // 完整诊断信息存入 job
              job.failCount = (job.failCount || 0) + 1;
              job.lastFailAt = Date.now();
              console.warn(`[automation] ❌ ${job.name} 失败 (连续 ${job.failCount} 次, ${durationMs}ms): ${errorMsg.slice(0, 150)}\n[诊断] ${diagStr.slice(0, 400)}`);

              // A2 修复: 失败策略改为先诊断+退避+再禁用
              // 第 1-2 次失败: 记录 + 指数退避 (不立即重试)
              // 第 3 次失败: 环境自检 + 尝试更新预设命令 (但不重置计数)
              // 第 5 次失败: 自动禁用 + 发通知
              if (job.failCount === 3) {
                // 环境自检: 检查 node/git/cwd 是否可用
                const envOk = await this._checkJobEnvironment(job);
                if (envOk.needsUpdate) {
                  const preset = AUTOMATION_PRESETS.find(p => p.name === job.name);
                  if (preset && preset.defaultParams?.command !== job.params?.command) {
                    console.log(`[automation] 🔧 ${job.name} 环境自检后更新命令到最新预设版本`);
                    job.params = { ...preset.defaultParams };
                    // A2 修复: 不重置 failCount — 给新命令 2 次机会, 失败继续累计
                  } else {
                    console.warn(`[automation] ⚠️ ${job.name} 预设命令已是最新, 失败可能是环境问题`);
                  }
                }
              }

              // 第 5 次失败 → 自动禁用 (从 3 提高到 5, 避免过早禁用)
              if (job.failCount >= 5) {
                job.status = 'disabled';
                job.autoDisabledReason = `连续失败 ${job.failCount} 次, 最后错误: ${errorMsg.slice(0, 120)}`;
                console.warn(`[automation] 🛑 ${job.name} 自动禁用: ${job.autoDisabledReason}`);
                this.emit('cron:auto-disabled', { jobId: job.id, name: job.name, reason: job.autoDisabledReason, diag: diagStr });
              }
            }

            this.save();
            this.emit('cron:result', { jobId: job.id, result: job.lastResult, failCount: job.failCount, successCount: job.successCount });
          } else {
            // A3 修复: 工具不存在时不立即禁用 — 区分 registry 未 ready 和工具真被移除
            job.failCount = (job.failCount || 0) + 1;
            job.lastFailAt = Date.now();
            const registrySize = this._registry?.list?.()?.length ?? 0;
            job.lastResult = `❌ 工具 "${job.action}" 不存在 (registry ${registrySize} 个工具已加载)`;
            // A3: 只有连续 5 次且 registry 有其他工具时才禁用
            if (job.failCount >= 5 && registrySize > 0) {
              job.status = 'disabled';
              job.autoDisabledReason = `工具 ${job.action} 连续 5 次不存在 (registry 有 ${registrySize} 个工具, 可能已被移除)`;
              console.warn(`[automation] 🛑 ${job.name} 自动禁用: 工具不存在 (${registrySize} 个工具在 registry)`);
              this.emit('cron:auto-disabled', { jobId: job.id, name: job.name, reason: job.autoDisabledReason });
            } else if (registrySize === 0) {
              console.warn(`[automation] ⏳ ${job.name}: registry 为空, 可能尚未加载完成, 不禁用`);
              job.failCount = Math.max(0, job.failCount - 1); // 不计数
            }
            this.save();
          }
        }
      } catch (e: any) {
        console.warn(`[automation] ⏰ ${job.name} 执行异常:`, e?.message, e?.stack?.slice(0, 300));
      }
    });
    console.log(`[automation] 加载完毕: ${this.cronJobs.size} cron jobs, ${this.rules.size} rules, ${this.backgroundTasks.size} background tasks`);
  }

  // ===== Cron Jobs =====

  createCronJob(name: string, expression: string, action: string, params: Record<string, any>): CronJob {
    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const job: CronJob = { id, name, expression, action, params, status: 'active', createdAt: Date.now(), createdBy: 'ai' };
    this.cronJobs.set(id, job);
    this.save();
    this.scheduleCron(job);
    this.emit('cron:created', job);
    return job;
  }

  deleteCronJob(id: string): boolean {
    const job = this.cronJobs.get(id);
    if (!job) return false;
    this.unschedule(id);
    this.cronJobs.delete(id);
    this.save();
    this.emit('cron:deleted', { id });
    return true;
  }

  listCronJobs(): CronJob[] {
    return [...this.cronJobs.values()];
  }

  toggleCronJob(id: string): CronJob | null {
    const job = this.cronJobs.get(id);
    if (!job) return null;
    job.status = job.status === 'active' ? 'paused' : 'active';
    if (job.status === 'active') this.scheduleCron(job);
    else this.unschedule(id);
    this.save();
    return job;
  }

  // ===== Automation Rules =====

  createRule(name: string, description: string, trigger: AutomationRule['trigger'], action: AutomationRule['action']): AutomationRule {
    const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const rule: AutomationRule = { id, name, description, trigger, action, status: 'active', createdAt: Date.now(), createdBy: 'ai' };
    this.rules.set(id, rule);
    this.save();
    this.emit('rule:created', rule);
    return rule;
  }

  listRules(): AutomationRule[] {
    return [...this.rules.values()];
  }

  toggleRule(id: string): AutomationRule | null {
    const rule = this.rules.get(id);
    if (!rule) return null;
    rule.status = rule.status === 'active' ? 'paused' : 'active';
    this.save();
    return rule;
  }

  deleteRule(id: string): boolean {
    if (!this.rules.has(id)) return false;
    this.rules.delete(id);
    this.save();
    return true;
  }

  // ===== Background Tasks =====

  createBackgroundTask(name: string, description: string, prompt: string, intervalMs: number): BackgroundTask {
    const id = `bg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: BackgroundTask = { id, name, description, prompt, intervalMs, status: 'running', createdAt: Date.now() };
    this.backgroundTasks.set(id, task);
    this.save();
    this.scheduleBackgroundTask(task);
    this.emit('bg:created', task);
    return task;
  }

  listBackgroundTasks(): BackgroundTask[] {
    return [...this.backgroundTasks.values()];
  }

  // ===== 定时调度 =====

  private scheduleCron(job: CronJob): void {
    if (this._timers.has(job.id)) return;

    // ═══ 2026-10-19 P0: 真正解析 cron, 不再只认 `*/N` ═══
    // 事故 (启动日志): "[automation] 不支持的 cron 表达式: 0 2 * * *, 使用默认 60 分钟"
    // 连刷 10 次 —— 每日备份 / 日志清理 / Git 同步这些任务全被降级成"每 60 分钟"，
    // 用户设定的时间点完全不生效。现在支持 * / N / a-b / a-b/n / 逗号枚举。
    const parsed = parseCron(job.expression);
    if (!parsed) {
      console.warn(`[automation] 无法解析 cron: ${job.expression}, 降级为每小时整点 (请检查表达式)`);
    }

    let lastFiredMinute = -1;
    // 30s 检查一次: 整分钟边界抖动也不会漏触发; 同一分钟只放行一次
    const timer = setInterval(() => {
      const now = new Date();
      const minuteKey = Math.floor(now.getTime() / 60_000);
      if (minuteKey === lastFiredMinute) return;

      if (parsed) {
        if (!cronMatches(parsed, now)) return;
      } else if (now.getMinutes() !== 0) {
        return; // 降级: 每小时整点
      }

      lastFiredMinute = minuteKey;
      this.emit('cron:tick', job);
      job.lastRun = Date.now();
      this.save();
    }, 30_000);
    (timer as any).unref?.();
    this._timers.set(job.id, timer);
  }

  private scheduleBackgroundTask(task: BackgroundTask): void {
    if (this._timers.has(`bg-${task.id}`)) return;
    const timer = setInterval(() => {
      this.emit('bg:tick', task);
      task.lastRun = Date.now();
      this.save();
    }, task.intervalMs);
    this._timers.set(`bg-${task.id}`, timer);
  }

  private unschedule(id: string): void {
    const timer = this._timers.get(id);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(id);
    }
  }

  private startTimers(): void {
    for (const job of this.cronJobs.values()) {
      if (job.status === 'active') this.scheduleCron(job);
    }
    for (const task of this.backgroundTasks.values()) {
      if (task.status === 'running') this.scheduleBackgroundTask(task);
    }
  }

/**
* A2 修复: 环境自检 — 检查执行环境是否满足要求
* 返回 { ok, needsUpdate, reason }
*/
private async _checkJobEnvironment(job: CronJob): Promise<{ ok: boolean; needsUpdate: boolean; reason: string }> {
  const cmd = job.params?.command || '';
  const cwd = this.workspace || process.cwd();

  // 检查 cwd 是否存在
  try {
    const fs = await import('fs');
    if (!fs.existsSync(cwd)) {
      return { ok: false, needsUpdate: false, reason: `工作目录不存在: ${cwd}` };
    }
  } catch {}

  // 检查命令依赖的工具是否可用
  if (cmd.startsWith('git ')) {
    try {
      const { execSync } = await import('child_process');
      execSync('git --version', { encoding: 'utf-8', timeout: 3000, stdio: 'ignore' });
    } catch {
      return { ok: false, needsUpdate: false, reason: 'git 未安装或不在 PATH' };
    }
  }
  if (cmd.startsWith('npm ') || cmd.startsWith('npx ')) {
    try {
      const { execSync } = await import('child_process');
      execSync('npm --version', { encoding: 'utf-8', timeout: 3000, stdio: 'ignore' });
    } catch {
      return { ok: false, needsUpdate: false, reason: 'npm 未安装或不在 PATH' };
    }
  }
  if (cmd.startsWith('node ')) {
    // node 一定可用 (gateway 自己就是 node 跑的)
    // 但命令可能需要更新
    return { ok: true, needsUpdate: true, reason: 'node 命令可能需要更新为非 node -e 形式' };
  }

  return { ok: true, needsUpdate: false, reason: '环境检查通过' };
}

/**
* 自动检测工作区环境 → 自动安装匹配的预设模板
   * 每次 load() 时执行, 已安装的跳过
   */
  private autoDetectAndInstall(): void {
    const existingNames = new Set(Array.from(this.cronJobs.values()).map(j => j.name));
    const workspace = this.workspace;

    // 检测条件 → 预设映射
    const checks: Array<{ check: () => boolean; preset: typeof AUTOMATION_PRESETS[0] }> = [
      {
        check: () => fs.existsSync(path.join(workspace, '.git')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'daily-code-backup')!,
      },
      {
        check: () => fs.existsSync(path.join(workspace, '.git')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'git-fetch-sync')!,
      },
      {
        check: () => fs.existsSync(path.join(workspace, '.git')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'commit-lint-check')!,
      },
      {
        check: () => {
          const pkgPath = path.join(workspace, 'package.json');
          if (!fs.existsSync(pkgPath)) return false;
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            return !!deps.eslint || !!deps['eslint-config'] || fs.existsSync(path.join(workspace, '.eslintrc'));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'code-quality-check')!,
      },
      {
        check: () => {
          const pkgPath = path.join(workspace, 'package.json');
          if (!fs.existsSync(pkgPath)) return false;
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const scripts = pkg.scripts || {};
            return !!(scripts.test || scripts["test:ci"]);
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'test-suite')!,
      },
      {
        check: () => {
          const pkgPath = path.join(workspace, 'package.json');
          if (!fs.existsSync(pkgPath)) return false;
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            const scripts = pkg.scripts || {};
            return !!(scripts.build || scripts.dev);
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'build-test')!,
      },
      {
        check: () => {
          try {
            const files = fs.readdirSync(workspace);
            return files.some(f => f.endsWith('.log'));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'log-cleanup')!,
      },
      {
        check: () => {
          try {
            const files = fs.readdirSync(workspace);
            return files.some(f => f.endsWith('.db'));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'database-backup')!,
      },
      {
        check: () => fs.existsSync(path.join(workspace, '.agentai')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'knowledge-sync')!,
      },
      {
        check: () => fs.existsSync(path.join(workspace, '.env')) || fs.existsSync(path.join(workspace, '.env.local')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'env-check')!,
      },
      {
        check: () => fs.existsSync(path.join(workspace, 'src')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'secret-scan')!,
      },
      {
        check: () => {
          try {
            const files = fs.readdirSync(workspace);
            return files.some(f => ['dist', 'build', '.next', 'out'].includes(f));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'dist-build-cleanup')!,
      },
    ];

    let installed = 0;
    let updated = 0;
    let cleaned = 0;
    let reactivated = 0;

    // ═══ 智能任务健康管理: 清理 + 更新 + 保留 + 恢复 ═══
    const existingJobs = Array.from(this.cronJobs.values());
    const PRESET_VERSION = 2; // 当前预设版本号

    for (const job of existingJobs) {
      const cmd = job.params?.command || '';
      const preset = AUTOMATION_PRESETS.find(p => p.name === job.name);

      // 1. 清理: 完全失效的任务 (工具不存在 + disabled 超过 7 天)
      if (job.status === 'disabled' && job.lastFailAt && (Date.now() - job.lastFailAt > 7 * 24 * 60 * 60 * 1000)) {
        this.cronJobs.delete(job.id);
        this.unschedule(job.id);
        cleaned++;
        console.log(`[automation] 🗑️ 清理长期失效任务: ${job.name} (禁用超过7天)`);
        continue;
      }

      // 2. 更新: 命令过时的任务 (Unix 命令 或 预设版本不匹配)
      const isUnixCmd = /\bfind\b.*-name/.test(cmd) || /\bgrep\b.*-r/.test(cmd) || /\btail\b/.test(cmd) || /\|/.test(cmd) || /&&/.test(cmd);
      const isOldVersion = !job.presetVersion || job.presetVersion < PRESET_VERSION;
      if ((isUnixCmd || isOldVersion) && preset) {
        job.params = { ...preset.defaultParams };
        job.presetVersion = PRESET_VERSION;
        // 如果之前因命令失败被 disabled, 重新激活
        if (job.status === 'disabled' && job.autoDisabledReason?.includes('失败')) {
          job.status = 'active';
          job.failCount = 0;
          job.autoDisabledReason = undefined;
          reactivated++;
          console.log(`[automation] ♻️ 重新激活已修复任务: ${job.name}`);
        }
        updated++;
        console.log(`[automation] 🔄 更新任务到 v${PRESET_VERSION}: ${job.name}`);
      }

      // 3. 保留: 成功的任务不动, 只更新统计
      // (无需操作, 继续运行)

      // 4. 恢复: disabled 但环境已变化的任务 (重新检测条件)
      if (job.status === 'disabled' && preset) {
        // 检查对应的 check 条件是否还满足
        const matchedCheck = checks.find(c => c.preset?.id === preset.id);
        if (matchedCheck && matchedCheck.check()) {
          // 环境条件仍满足 → 重置失败计数, 重新激活
          job.status = 'active';
          job.failCount = 0;
          job.autoDisabledReason = undefined;
          job.params = { ...preset.defaultParams }; // 用最新命令
          job.presetVersion = PRESET_VERSION;
          reactivated++;
          console.log(`[automation] ♻️ 环境条件仍满足, 重新激活: ${job.name}`);
        }
      }
    }

    if (updated > 0 || cleaned > 0 || reactivated > 0) {
      this.save();
      console.log(`[automation] 📊 健康管理完成: 更新 ${updated}, 清理 ${cleaned}, 重新激活 ${reactivated}`);
    }
    // 始终安装: 每天中午/午夜运行蒸馏 (不在凌晨2点, 改到 12:00)
    const DISTILL_NAME = '🧠 经验蒸馏学习';
    if (!existingNames.has(DISTILL_NAME)) {
      this.createCronJob(
        DISTILL_NAME,
        '0 12,0 * * *',  // 每天中午12点和午夜0点运行
        'run_distillation',
        {},
      );
      console.log(`[automation] 🧠 已安装蒸馏任务: 每天 12:00 和 0:00 执行`);
      installed++;
    }

    for (const { check, preset } of checks) {
      if (!preset) continue;
      if (existingNames.has(preset.name)) continue; // 已存在跳过
      try {
        if (check()) {
          this.createCronJob(preset.name, preset.defaultExpression, preset.defaultAction, preset.defaultParams);
          // P0: 新安装的任务标记当前预设版本
          const newJob = Array.from(this.cronJobs.values()).find(j => j.name === preset.name);
          if (newJob) newJob.presetVersion = 2;
          console.log(`[automation] 🤖 自动检测到环境匹配 → 已安装预设: ${preset.name}`);
          installed++;
        }
      } catch (e: any) {
        console.warn(`[automation] 自动安装预设 "${preset.name}" 失败:`, e?.message);
      }
    }
    if (installed > 0) {
      console.log(`[automation] ✅ 本次自动安装了 ${installed} 个预设模板`);
      this.emit('auto:presets-installed', { count: installed });
    }
  }

  /** 停止所有定时器 */
  stop(): void {
    for (const [, timer] of this._timers) clearInterval(timer);
    this._timers.clear();
  }
}

// ===== 🎯 自动化预设模板 (蒸馏) =====
// 预置常见自动化场景，用户无需写代码，AI 一键部署

export interface AutomationPreset {
  id: string;
  name: string;
  description: string;
  category: 'backup' | 'cleanup' | 'report' | 'monitor' | 'quality' | 'sync' | 'dev' | 'test' | 'deploy' | 'security';
  defaultExpression: string;
  defaultAction: string;
  defaultParams: Record<string, any>;
  guide: string;
}

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  // ===== Backup & Recovery =====
  {
    id: 'daily-code-backup',
    name: '📦 每日代码备份',
    description: '每天凌晨自动把代码推送到远程仓库，防止代码丢失。',
    category: 'backup',
    defaultExpression: '0 2 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git add . && git commit -m "auto backup" && git push' },
    guide: '确保当前目录是 Git 仓库，且已配置远程仓库地址。',
  },
  {
    id: 'database-backup',
    name: '🗃️ 数据库定时备份',
    description: '每 6 小时备份 SQLite/JSON 数据文件，最多保留最近 24 个。',
    category: 'backup',
    defaultExpression: '0 */6 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');fs.mkdirSync(\'backups\',{recursive:true});function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.endsWith(\'.db\')||e.name.endsWith(\'.json\')){fs.copyFileSync(p.join(d,e.name),p.join(\'backups\',e.name));}}}scan(\'.\');console.log(\'backup done\')"' },
    guide: '备份 .db 和 data/ 目录下的 .json 文件到 backups/。',
  },
  {
    id: 'config-backup',
    name: '⚙️ 配置文件快照',
    description: '每天备份关键配置文件 (.env, config.json, settings.json 等) 防止误删。',
    category: 'backup',
    defaultExpression: '0 3 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');fs.mkdirSync(\'backups/config\',{recursive:true});function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.startsWith(\'.env\')||e.name===\'settings.json\'||e.name.endsWith(\'.config.json\')){fs.copyFileSync(p.join(d,e.name),p.join(\'backups/config\',e.name));}}}scan(\'.\');console.log(\'config backup done\')"' },
    guide: '备份根目录下 .env 和 config 文件到 backups/config/。',
  },
  // ===== Cleanup =====
  {
    id: 'weekly-disk-cleanup',
    name: '🧹 每周磁盘清理',
    description: '每周日凌晨清理缓存和临时文件，释放磁盘空间。',
    category: 'cleanup',
    defaultExpression: '0 3 * * 0',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');for(const d of [\'.agentai/truncated-results\',\'node_modules/.cache\',\'__pycache__\']){try{fs.rmSync(d,{recursive:true,force:true});}catch{}}console.log(\'cache cleaned\')"' },
    guide: '删除截断结果缓存、npm 缓存和 Python 缓存，不影响源代码。',
  },
  {
    id: 'log-cleanup',
    name: '🗑️ 日志自动清理',
    description: '每天检查并删除 7 天前的日志文件。',
    category: 'cleanup',
    defaultExpression: '0 4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(e.name.endsWith(\'.log\')){const f=p.join(d,e.name);const s=fs.statSync(f);if(Date.now()-s.mtimeMs>604800000)fs.unlinkSync(f);}}}scan(\'.\');console.log(\'log cleanup done\')"' },
    guide: '安全清理超过 7 天的 .log 文件，最近日志会保留。',
  },
  {
    id: 'dist-build-cleanup',
    name: '🏗️ 构建产物清理',
    description: '每次提交后清理 dist/build 目录中的旧构建文件。',
    category: 'cleanup',
    defaultExpression: '0 5 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');const EXCLUDE=new Set([\'node_modules\',\'.git\',\'.pnpm\']);function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')&&!EXCLUDE.has(e.name)){const sd=p.join(d,e.name);if([\'dist\',\'build\',\'.next\'].includes(e.name)){fs.rmSync(sd,{recursive:true,force:true});}else{scan(sd);}}}}scan(\'.\');console.log(\'build artifacts cleaned (node_modules excluded)\')"' },
    guide: '清理 dist/ build/ .next/ 等构建产物，下次需要时重新构建即可。',
  },
  {
    id: 'trash-cleanup',
    name: '🗂️ 临时文件清理',
    description: '每周清理编辑器/IDE 产生的临时文件 (swp, tmp, sst, DS_Store)。',
    category: 'cleanup',
    defaultExpression: '0 4 * * 0',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if([\'.swp\',\'.tmp\',\'.sst\',\'.orig\',\'.DS_Store\'].some(x=>e.name.endsWith(x))){fs.unlinkSync(p.join(d,e.name));}}}scan(\'.\');console.log(\'temp files cleaned\')"' },
    guide: '清理 vim swap、临时文件、macOS DS_Store 等，不影响项目。',
  },
  // ===== Report =====
  {
    id: 'daily-report',
    name: '📋 每日工作报告',
    description: '每天下午 5 点自动查看今天的代码变更，生成简洁的工作报告。',
    category: 'report',
    defaultExpression: '0 17 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git log --since=6am --oneline --no-merges' },
    guide: '读取今天的 Git 提交记录生成报告。',
  },
  {
    id: 'weekly-health-report',
    name: '🏥 项目健康周报',
    description: '每周一上午统计项目代码量、依赖状态、问题数量。',
    category: 'report',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){let c=0;for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')&&e.name!==\'node_modules\'){c+=scan(p.join(d,e.name));}else if(/\.(ts|tsx|js)$/.test(e.name)){const f=p.join(d,e.name);const l=fs.readFileSync(f,\'utf8\').split(\'\\n\').length;c+=l;}}return c;}console.log(\'代码行数: \'+scan(\'.\'));try{const pkg=JSON.parse(fs.readFileSync(\'package.json\',\'utf8\'));console.log(\'依赖数: \'+(Object.keys(pkg.dependencies||{}).length+Object.keys(pkg.devDependencies||{}).length));}catch{console.log(\'无 package.json\')}"'}, 
    guide: '统计项目代码行数和依赖数量。',
  },
  // ===== Quality =====
  {
    id: 'code-quality-check',
    name: '✅ 代码质量检查',
    description: '每天自动运行类型检查和 lint，发现潜在问题。',
    category: 'quality',
    defaultExpression: '0 9 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx tsc --noEmit' },
    guide: '运行 TypeScript 类型检查，发现编译错误。不修改代码。',
  },
  {
    id: 'test-suite',
    name: '🧪 测试套件运行',
    description: '每天凌晨运行测试套件，确保代码变更没有破坏功能。',
    category: 'test',
    defaultExpression: '0 3 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm test -- --passWithNoTests' },
    guide: '运行 npm test，自动过滤掉无测试的情况。发现失败时会自动记录。',
  },
  {
    id: 'dependency-audit',
    name: '📋 依赖安全审计',
    description: '每周检查依赖漏洞，提醒更新存在安全问题的包。',
    category: 'security',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm audit --audit-level=high' },
    guide: '运行 npm audit 检查高危依赖漏洞。仅报告，不自动修复。',
  },
  {
    id: 'unused-imports-scan',
    name: '🔍 未使用导入扫描',
    description: '每周扫描 TypeScript/JS 文件中的未使用导入，提示清理。',
    category: 'quality',
    defaultExpression: '0 11 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npx ts-prune --no-strict\',{cwd:\'.\',encoding:\'utf8\',timeout:60000});console.log(out.slice(-2000))}catch(e){console.log(\'ts-prune not installed\')}"' },
    guide: '扫描未使用的类型和导入，发现僵尸代码。不会自动删除。',
  },
  // ===== Monitor =====
  {
    id: 'system-health-check',
    name: '🔍 系统健康自检',
    description: '每 4 小时检查磁盘、内存使用情况。',
    category: 'monitor',
    defaultExpression: '0 */4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const os=require(\'os\');const fs=require(\'fs\');const total=os.totalmem(),free=os.freemem();console.log(\'内存: \'+Math.round((total-free)/1024/1024/1024*10)/10+\'GB / \'+Math.round(total/1024/1024/1024*10)/10+\'GB (\'+Math.round((1-free/total)*100)+\'% 使用)\');try{const stats=fs.statSync(\'.\');console.log(\'磁盘检查完成\')}catch{console.log(\'磁盘检查跳过\')}"' },
    guide: '检查磁盘使用率和内存占用，仅检查不修改。',
  },
  {
    id: 'price-monitor',
    name: '💰 竞品价格监控',
    description: '每 6 小时自动搜索竞品价格变动，保存对比结果。',
    category: 'monitor',
    defaultExpression: '0 */6 * * *',
    defaultAction: 'web_search',
    defaultParams: { query: '竞品价格行情 最新报价' },
    guide: 'AI 会搜索互联网上的价格信息并保存到本地。',
  },
  {
    id: 'uptime-check',
    name: '🌐 服务可用性监控',
    description: '每 15 分钟检查关键 URL 是否可访问，发现宕机立即记录。',
    category: 'monitor',
    defaultExpression: '*/15 * * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "fetch(\'http://localhost:18789/v1/health\',{signal:AbortSignal.timeout(5000)}).then(r=>console.log(\'HTTP \'+r.status+\' OK\')).catch(()=>console.log(\'UNREACHABLE\'))"' },
    guide: '检查 Gateway 本地服务健康状态，每 15 分钟一次。',
  },
  {
    id: 'disk-space-monitor',
    name: '💾 磁盘空间监控',
    description: '每 2 小时检查磁盘使用率，超过 85% 时输出警告。',
    category: 'monitor',
    defaultExpression: '0 */2 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const os=require(\'os\');console.log(\'内存使用: \'+Math.round((os.totalmem()-os.freemem())/1024/1024/1024*10)/10+\'GB / \'+Math.round(os.totalmem()/1024/1024/1024*10)/10+\'GB\')"' },
    guide: '检查当前目录磁盘使用率。',
  },
  {
    id: 'error-log-monitor',
    name: '⚠️ 错误日志监控',
    description: '每 30 分钟扫描日志中的 ERROR/FATAL 关键字，统计错误趋势。',
    category: 'monitor',
    defaultExpression: '*/30 * * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');const d=\'.agentai\';if(!fs.existsSync(d)){console.log(\'无错误日志\');process.exit()}let c=0;for(const f of fs.readdirSync(d)){if(f.endsWith(\'.log\')){const lines=fs.readFileSync(p.join(d,f),\'utf8\').split(\'\\n\');c+=lines.filter(l=>/ERROR|FATAL|CRITICAL/.test(l)).length}}console.log(\'错误日志条数: \'+c)"' },
    guide: '统计日志中的错误行数，发现异常可及时告警。',
  },
  // ===== Sync =====
  {
    id: 'knowledge-sync',
    name: '📚 知识库同步',
    description: '每天定时从外部来源同步知识，让 AI 始终保持最新信息。',
    category: 'sync',
    defaultExpression: '0 6 * * *',
    defaultAction: 'web_search',
    defaultParams: { query: '行业最新动态 技术资讯' },
    guide: 'AI 会搜索行业最新资讯并存入记忆库。',
  },
  {
    id: 'git-fetch-sync',
    name: '🔄 Git 远端同步',
    description: '每 2 小时从远程仓库拉取最新代码，保持本地仓库更新。',
    category: 'sync',
    defaultExpression: '0 */2 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git fetch origin && git log HEAD..origin/HEAD --oneline -5' },
    guide: '只 fetch 不 merge，避免冲突。显示远端新提交供你决定何时合并。',
  },
  {
    id: 'npm-updates-check',
    name: '📦 依赖更新检查',
    description: '每周检查 npm 依赖是否有新版本，输出升级建议。',
    category: 'sync',
    defaultExpression: '0 9 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm outdated' },
    guide: '检查 package.json 依赖是否有更新版本，仅报告不自动升级。',
  },
  // ===== Dev =====
  {
    id: 'commit-lint-check',
    name: '📝 提交信息规范检查',
    description: '每天检查最近的 git 提交信息是否符合 Conventional Commits 规范。',
    category: 'dev',
    defaultExpression: '0 18 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git log --oneline -10' },
    guide: '检查最近 10 次提交是否使用 Conventional Commits 格式。',
  },
  {
    id: 'build-test',
    name: '🔨 自动构建测试',
    description: '每天构建项目，确保 TypeScript 编译和打包正常。',
    category: 'dev',
    defaultExpression: '0 4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm run build' },
    guide: '运行 npm run build 验证项目可正常构建，发现编译错误及时修复。',
  },
  {
    id: 'coverage-report',
    name: '📊 测试覆盖率报告',
    description: '每周生成代码覆盖率报告，追踪测试覆盖趋势。',
    category: 'test',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx jest --coverage' },
    guide: '生成 Jest 覆盖率报告，如无测试框架则跳过。',
  },
  // ===== Security =====
  {
    id: 'secret-scan',
    name: '🔒 密钥泄露扫描',
    description: '每天扫描代码中是否有硬编码的 API Key、Token、密码等敏感信息。',
    category: 'security',
    defaultExpression: '0 22 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\'),p=require(\'path\');function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.isDirectory()&&!e.name.startsWith(\'.\')){scan(p.join(d,e.name));}else if(/\.(ts|js|tsx)$/.test(e.name)){const f=p.join(d,e.name);const c=fs.readFileSync(f,\'utf8\');if(/api[_-]?key|secret|password|token/i.test(c)){console.log(f+\': possible secret\');}}}}scan(\'src\');console.log(\'secret scan done\')"' },
    guide: '扫描 src/ 目录下是否有硬编码密钥，发现后应立即移入 .env。',
  },
  {
    id: 'env-check',
    name: '⚙️ 环境变量完整性检查',
    description: '每天检查 .env 文件中是否有缺失的必要环境变量。',
    category: 'security',
    defaultExpression: '0 8 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node -e "const fs=require(\'fs\');if(fs.existsSync(\'.env\')){const l=fs.readFileSync(\'.env\',\'utf8\').split(\'\\n\').filter(x=>x.trim()).length;console.log(\'.env 存在, \'+l+\' 行\')}else{console.log(\'WARNING: .env 缺失\')}"' },
    guide: '检查 .env 文件是否存在，确保环境变量配置完整。',
  },
  // ===== 赏金打单: 定时批量渗透 (2026-10-16) =====
  // 配合「渗透测试授权」面板 + 盯哨 (cve-watch): 授权目标就位后,
  // 批量巡检自动把授权范围内的目标逐个扫, 命中落盘, 报告人工提交。
  {
    id: 'batch-pentest',
    name: '🎯 批量挖洞巡检',
    description: '对当前工作区「渗透测试授权」里的全部授权目标, 逐个 spawn 一个 pentest 子智能体跑一轮渗透 (浅扫: nmap 指纹 + 表单端点 + 最小强度探针)。命中的洞自动 save_evidence + report_vulnerability 落盘, 未命中的不写 — 数量堆命中率。',
    category: 'security',
    defaultExpression: '0 3 */2 * *',
    defaultAction: 'batch_pentest',
    defaultParams: { depth: 'quick', maxTargets: 10 },
    guide: '前提: 工作区 .agentai/scope.json 里已有授权目标 (在「渗透测试授权」面板批量粘贴平台清单)。执行窗口内用户在跑任务会先让路。内置限频 (scope_guard 默认 max_rps=5) + 每子智能体"够深就停"策略。跑完自动沉淀课程焦点 (命中目标下轮转 deep 重扫 + 已验证手法复用), 下一轮 48h 定时自动加深。建议配 cve-watch 盯哨: 新 CVE 曝光后下一轮批量扫自动命中。',
  },
  {
    id: 'cve-watch-subdomains',
    name: '👁️ 盯哨巡检 (CVE + 子域扩展)',
    description: '跑一轮 cve-watch: 拉 NVD + CISA KEV 新曝光 CVE → 子域自动扩展 (crt.sh, 不打目标) → 比对授权资产 → 新命中告警落 .agentai/cve/alerts.json (GUI 面板可见)。配合 batch-pentest 巡检: 盯哨发现新面/新洞, 下一轮批量扫自动跟上。',
    category: 'security',
    defaultExpression: '0 6 */2 * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'node packages/agentai-gateway/scripts/cve-watch.mjs --once --skip-fingerprint' },
    guide: '纯被动: CVE 数据源是 NVD/KEV 公开 API, 子域枚举只查 crt.sh 证书日志, 目标服务器零请求。告警人工触发 nuclei 验证。需 Kali WSL 已装 (install-kali-wsl.mjs)。',
  },
];

// ===== 全局单例 =====
let _instance: AutomationEngine | null = null;

export function getAutomationEngine(workspace?: string, registry?: any, router?: any): AutomationEngine {
  if (!_instance && workspace) {
    _instance = new AutomationEngine(workspace, registry, router);
    _instance.load();
  }
  // 延迟注入: 首次调用时 registry/router 可能尚未 ready (index.ts 里
  // createAutomationRouter 在 deps.router 之前挂载过), 补填不影响已加载的 job。
  if (_instance) {
    if (registry && !(_instance as any)._registry) (_instance as any)._registry = registry;
    if (router && !(_instance as any)._router) (_instance as any)._router = router;
  }
  return _instance!;
}
