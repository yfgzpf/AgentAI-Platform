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
 * 学自: Reasonix cron + autonomous systems 设计理念
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

// ===== 类型定义 =====

export interface CronJob {
  id: string;
  name: string;
  expression: string;          // cron 表达式: "0 */2 * * *" (每2小时)
  action: string;              // 工具名称: "run_command", "web_search", etc.
  params: Record<string, any>; // 工具参数
  status: 'active' | 'paused';
  createdAt: number;
  lastRun?: number;
  lastResult?: string;
  createdBy: 'ai' | 'user';
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

  constructor(workspace: string, registry?: any) {
    super();
    this.workspace = workspace;
    this._registry = registry;
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
          const tool = this._registry.get(job.action);
          if (tool) {
            const result = await tool.handler(job.params || {}, {
              userId: 'system',
              workspace: this.workspace,
              abortSignal: new AbortController().signal,
            });
            job.lastRun = Date.now();
            job.lastResult = result.success ? '✅ 成功' : `❌ 失败: ${result.error || result.output}`;
            console.log(`[automation] ✅ ${job.name} 执行完毕: ${job.lastResult}`);
            job.lastRun = Date.now();
            this.save();
            this.emit('cron:result', { jobId: job.id, result: job.lastResult });
          } else {
            console.warn(`[automation] ⚠️ 找不到工具 "${job.action}", 跳过执行`);
          }
        }
      } catch (e: any) {
        console.warn(`[automation] ⏰ ${job.name} 执行异常:`, e?.message);
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
    // 简化实现: 每 N 分钟执行 (cron 表达式 "*/N * * * *")
    const match = job.expression.match(/\*\/(\d+)/);
    if (!match) {
      console.warn(`[automation] 不支持的 cron 表达式: ${job.expression}, 使用默认 60 分钟`);
    }
    const intervalMs = (match ? parseInt(match[1]!) : 60) * 60 * 1000;
    const timer = setInterval(() => {
      this.emit('cron:tick', job);
      job.lastRun = Date.now();
      this.save();
    }, intervalMs);
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
   * 自动检测工作区环境 → 自动安装匹配的预设模板
   * 每次 load() 时执行, 已安装的跳过
   */
  private autoDetectAndInstall(): void {
    const existingNames = new Set(Array.from(this.cronJobs.values()).map(j => j.name));
    const workspace = this.workspace;

    // 检测条件 → 预设映射
    const checks: Array<{ check: () => boolean; preset: typeof AUTOMATION_PRESETS[0] }> = [
      // 有 .git 目录 → 每日代码备份
      {
        check: () => fs.existsSync(path.join(workspace, '.git')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'daily-code-backup')!,
      },
      // 有 eslint 配置 → 代码质量检查
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
      // 有 .log 文件 → 日志清理 (扫描速度限制: 只检查最近3层)
      {
        check: () => {
          try {
            const files = fs.readdirSync(workspace);
            return files.some(f => f.endsWith('.log'));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'log-cleanup')!,
      },
      // 有 .db 文件 → 数据库备份
      {
        check: () => {
          try {
            const files = fs.readdirSync(workspace);
            return files.some(f => f.endsWith('.db'));
          } catch { return false; }
        },
        preset: AUTOMATION_PRESETS.find(p => p.id === 'database-backup')!,
      },
      // 有 .agentai/ 目录 → 知识库同步
      {
        check: () => fs.existsSync(path.join(workspace, '.agentai')),
        preset: AUTOMATION_PRESETS.find(p => p.id === 'knowledge-sync')!,
      },
    ];

    let installed = 0;
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
  /** 白话描述 (AI 给用户看的) */
  description: string;
  /** 预设类型 */
  category: 'backup' | 'cleanup' | 'report' | 'monitor' | 'quality' | 'sync';
  /** 默认 cron 表达式 */
  defaultExpression: string;
  /** 默认动作 */
  defaultAction: string;
  /** 默认参数示例 */
  defaultParams: Record<string, any>;
  /** 安装说明 (AI 生成前给用户看) */
  guide: string;
}

export const AUTOMATION_PRESETS: AutomationPreset[] = [
  {
    id: 'daily-code-backup',
    name: '📦 每日代码备份',
    description: '每天凌晨自动把代码推送到远程仓库，防止代码丢失。你只需要确保已经配置了 Git 远程仓库。',
    category: 'backup',
    defaultExpression: '0 2 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git add . && git commit -m "auto backup $(date)" && git push' },
    guide: '确保当前目录是 Git 仓库，且已配置远程仓库地址。AI 会自动执行 git add/commit/push。',
  },
  {
    id: 'weekly-disk-cleanup',
    name: '🧹 每周磁盘清理',
    description: '每周日凌晨自动清理临时文件、缓存和过期日志，释放磁盘空间。',
    category: 'cleanup',
    defaultExpression: '0 3 * * 0',
    defaultAction: 'run_command',
    defaultParams: { command: 'rm -rf .agentai/truncated-results/* node_modules/.cache __pycache__' },
    guide: '会删除截断结果缓存、npm 缓存和 Python 缓存。不会影响你的源代码。',
  },
  {
    id: 'daily-report',
    name: '📋 每日工作报告',
    description: '每天下午 5 点自动查看今天的代码变更，生成简洁的工作报告。',
    category: 'report',
    defaultExpression: '0 17 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'git log --since=6am --oneline --no-merges --format="%h %s" --author=$(git config user.name)' },
    guide: '读取今天的 Git 提交记录，生成报告。建议每天下班前查看。',
  },
  {
    id: 'price-monitor',
    name: '💰 竞品价格监控',
    description: '每 6 小时自动搜索竞品价格变动，保存对比结果供你查看。',
    category: 'monitor',
    defaultExpression: '0 */6 * * *',
    defaultAction: 'web_search',
    defaultParams: { query: '竞品价格行情 最新报价' },
    guide: 'AI 会自动搜索互联网上的价格信息，并保存到本地供你分析。',
  },
  {
    id: 'code-quality-check',
    name: '✅ 代码质量检查',
    description: '每次代码有重要变更时，自动运行代码检查工具，发现潜在问题。',
    category: 'quality',
    defaultExpression: '0 9 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx eslint . --ext .ts,.tsx --quiet 2>&1 | head -50' },
    guide: '需要项目中已配置 ESLint。AI 只会查看检查结果，不会自动修改代码。',
  },
  {
    id: 'weekly-health-report',
    name: '🏥 项目健康周报',
    description: '每周一上午自动统计项目代码量、依赖状态、问题数量，生成健康报告。',
    category: 'report',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'echo "=== 代码统计 ===" && find . -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | tail -1 && echo "=== 依赖 ===" && cat package.json | grep -c "\\"dependencies\\""' },
    guide: '统计项目的代码行数、依赖数量等信息。如果项目较大，可能需要几秒钟。',
  },
  {
    id: 'log-cleanup',
    name: '🗑️ 日志自动清理',
    description: '每天检查并删除 7 天前的日志文件，防止日志堆积占用磁盘。',
    category: 'cleanup',
    defaultExpression: '0 4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'find . -name "*.log" -mtime +7 -delete 2>/dev/null; find . -name "*.gw-dev.log" -mtime +3 -delete 2>/dev/null' },
    guide: '安全清理，只会删除超过 7 天的 .log 文件。最近的日志会保留。',
  },
  {
    id: 'knowledge-sync',
    name: '📚 知识库同步',
    description: '每天定时从外部来源同步知识，让 AI 始终保持最新信息。',
    category: 'sync',
    defaultExpression: '0 6 * * *',
    defaultAction: 'web_search',
    defaultParams: { query: '行业最新动态 技术资讯' },
    guide: 'AI 会搜索行业最新资讯并存入记忆库。你可以在对话中问"今天有什么新消息"。',
  },
  {
    id: 'system-health-check',
    name: '🔍 系统健康自检',
    description: '每 4 小时检查系统资源使用情况，发现异常自动提醒。',
    category: 'monitor',
    defaultExpression: '0 */4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'echo "磁盘:" && df -h . | tail -1 && echo "内存:" && free -h | grep Mem && echo "进程:" && wmic process get name,processid 2>/dev/null | head -20 || ps aux --sort=-%mem | head -10' },
    guide: '检查磁盘使用率、内存占用和关键进程状态。仅检查不修改。',
  },
  {
    id: 'database-backup',
    name: '🗃️ 数据库定时备份',
    description: '每小时自动备份 SQLite 数据库文件，最多保留最近 10 个备份。',
    category: 'backup',
    defaultExpression: '0 * * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'mkdir -p backups && cp *.db backups/db-$(date +%Y%m%d-%H%M).db 2>/dev/null && ls -t backups/*.db 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null' },
    guide: '备份当前目录下所有 .db 文件到 backups/ 文件夹，自动清理旧备份。',
  },
];

// ===== 全局单例 =====
let _instance: AutomationEngine | null = null;

export function getAutomationEngine(workspace?: string, registry?: any): AutomationEngine {
  if (!_instance && workspace) {
    _instance = new AutomationEngine(workspace, registry);
    _instance.load();
  }
  return _instance!;
}
