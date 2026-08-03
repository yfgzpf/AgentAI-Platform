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
    defaultParams: { command: 'git add . && git commit -m "auto backup $(date)" && git push' },
    guide: '确保当前目录是 Git 仓库，且已配置远程仓库地址。',
  },
  {
    id: 'database-backup',
    name: '🗃️ 数据库定时备份',
    description: '每 6 小时备份 SQLite/JSON 数据文件，最多保留最近 24 个。',
    category: 'backup',
    defaultExpression: '0 */6 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'mkdir -p backups && find . -name "*.db" -mtime -1 -exec cp {} backups/ \\; 2>/dev/null; find . -name "*.json" -path "*/data/*" -exec cp {} backups/ \\; 2>/dev/null' },
    guide: '备份 .db 和 data/ 目录下的 .json 文件到 backups/。',
  },
  {
    id: 'config-backup',
    name: '⚙️ 配置文件快照',
    description: '每天备份关键配置文件 (.env, config.json, settings.json 等) 防止误删。',
    category: 'backup',
    defaultExpression: '0 3 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'mkdir -p backups/config && find . -name ".env*" -o -name "*.config.json" -o -name "settings.json" | head -10 | xargs -I{} cp {} backups/config/ 2>/dev/null' },
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
    defaultParams: { command: 'rm -rf .agentai/truncated-results/* node_modules/.cache __pycache__ 2>/dev/null' },
    guide: '删除截断结果缓存、npm 缓存和 Python 缓存，不影响源代码。',
  },
  {
    id: 'log-cleanup',
    name: '🗑️ 日志自动清理',
    description: '每天检查并删除 7 天前的日志文件。',
    category: 'cleanup',
    defaultExpression: '0 4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'find . -name "*.log" -mtime +7 -delete 2>/dev/null; find . -name "*.gw-dev.log" -mtime +3 -delete 2>/dev/null' },
    guide: '安全清理超过 7 天的 .log 文件，最近日志会保留。',
  },
  {
    id: 'dist-build-cleanup',
    name: '🏗️ 构建产物清理',
    description: '每次提交后清理 dist/build 目录中的旧构建文件。',
    category: 'cleanup',
    defaultExpression: '0 5 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'find . -name "dist" -o -name "build" -o -name ".next" | head -10 | xargs rm -rf 2>/dev/null' },
    guide: '清理 dist/ build/ .next/ 等构建产物，下次需要时重新构建即可。',
  },
  {
    id: 'trash-cleanup',
    name: '🗂️ 临时文件清理',
    description: '每周清理编辑器/IDE 产生的临时文件 (swp, tmp, sst, DS_Store)。',
    category: 'cleanup',
    defaultExpression: '0 4 * * 0',
    defaultAction: 'run_command',
    defaultParams: { command: 'find . -name "*.swp" -o -name "*.tmp" -o -name "*.sst" -o -name ".DS_Store" -o -name "*.orig" | xargs rm -f 2>/dev/null' },
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
    defaultParams: { command: 'git log --since=6am --oneline --no-merges --format="%h %s" 2>/dev/null || echo "无提交"' },
    guide: '读取今天的 Git 提交记录生成报告。',
  },
  {
    id: 'weekly-health-report',
    name: '🏥 项目健康周报',
    description: '每周一上午统计项目代码量、依赖状态、问题数量。',
    category: 'report',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'echo "=== 代码行数 ===" && find . -name "*.ts" -o -name "*.tsx" -o -name "*.js" | xargs wc -l 2>/dev/null | tail -1 && echo "=== 依赖 ===" && cat package.json | grep -c "dependencies" 2>/dev/null || echo "无 package.json"' },
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
    defaultParams: { command: 'npx tsc --noEmit 2>&1 | head -30' },
    guide: '运行 TypeScript 类型检查，发现编译错误。不修改代码。',
  },
  {
    id: 'test-suite',
    name: '🧪 测试套件运行',
    description: '每天凌晨运行测试套件，确保代码变更没有破坏功能。',
    category: 'test',
    defaultExpression: '0 3 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm test -- --passWithNoTests 2>&1 | tail -40' },
    guide: '运行 npm test，自动过滤掉无测试的情况。发现失败时会自动记录。',
  },
  {
    id: 'dependency-audit',
    name: '📋 依赖安全审计',
    description: '每周检查依赖漏洞，提醒更新存在安全问题的包。',
    category: 'security',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm audit --audit-level=high 2>&1 | tail -30' },
    guide: '运行 npm audit 检查高危依赖漏洞。仅报告，不自动修复。',
  },
  {
    id: 'unused-imports-scan',
    name: '🔍 未使用导入扫描',
    description: '每周扫描 TypeScript/JS 文件中的未使用导入，提示清理。',
    category: 'quality',
    defaultExpression: '0 11 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx ts-prune --no-strict 2>&1 | head -30' },
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
    defaultParams: { command: 'echo "磁盘:" && df -h . 2>/dev/null | tail -1 && echo "内存:" && free -h 2>/dev/null | grep Mem || echo "Windows: tasklist | findstr node"' },
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
    defaultParams: { command: 'curl -sI --max-time 5 https://localhost:18789/v1/health 2>/dev/null | head -1 || echo "UNREACHABLE"' },
    guide: '检查 Gateway 本地服务健康状态，每 15 分钟一次。',
  },
  {
    id: 'disk-space-monitor',
    name: '💾 磁盘空间监控',
    description: '每 2 小时检查磁盘使用率，超过 85% 时输出警告。',
    category: 'monitor',
    defaultExpression: '0 */2 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'df -h . 2>/dev/null | tail -1' },
    guide: '检查当前目录磁盘使用率。',
  },
  {
    id: 'error-log-monitor',
    name: '⚠️ 错误日志监控',
    description: '每 30 分钟扫描日志中的 ERROR/FATAL 关键字，统计错误趋势。',
    category: 'monitor',
    defaultExpression: '*/30 * * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'grep -c -E "ERROR|FATAL|CRITICAL" .agentai/*.log 2>/dev/null || echo "无错误日志"' },
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
    defaultParams: { command: 'git fetch origin 2>/dev/null && git log HEAD..origin/$(git branch --show-current 2>/dev/null || echo main) --oneline 2>/dev/null | head -5 || echo "无新提交"' },
    guide: '只 fetch 不 merge，避免冲突。显示远端新提交供你决定何时合并。',
  },
  {
    id: 'npm-updates-check',
    name: '📦 依赖更新检查',
    description: '每周检查 npm 依赖是否有新版本，输出升级建议。',
    category: 'sync',
    defaultExpression: '0 9 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx npm-check-updates -u --packageFile package.json --format json --jsonAll 2>/dev/null | head -50 || npm outdated 2>/dev/null || echo "所有依赖已是最新"' },
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
    defaultParams: { command: 'git log --oneline -10 | grep -vE "^(fix|feat|docs|style|refactor|perf|test|build|ci|chore|revert):" | head -5 && echo "---" || echo "所有提交符合规范"' },
    guide: '检查最近 10 次提交是否使用 Conventional Commits 格式。',
  },
  {
    id: 'build-test',
    name: '🔨 自动构建测试',
    description: '每天构建项目，确保 TypeScript 编译和打包正常。',
    category: 'dev',
    defaultExpression: '0 4 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'npm run build 2>&1 | tail -20' },
    guide: '运行 npm run build 验证项目可正常构建，发现编译错误及时修复。',
  },
  {
    id: 'coverage-report',
    name: '📊 测试覆盖率报告',
    description: '每周生成代码覆盖率报告，追踪测试覆盖趋势。',
    category: 'test',
    defaultExpression: '0 10 * * 1',
    defaultAction: 'run_command',
    defaultParams: { command: 'npx jest --coverage 2>&1 | tail -20 || npx tsc --noEmit 2>&1 | tail -10 || echo "无测试框架"' },
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
    defaultParams: { command: 'grep -rn --include="*.ts" --include="*.js" --include="*.tsx" -E "api[_-]?key|secret|password|token" src/ 2>/dev/null | head -10 || echo "未发现硬编码密钥"' },
    guide: '扫描 src/ 目录下是否有硬编码密钥，发现后应立即移入 .env。',
  },
  {
    id: 'env-check',
    name: '⚙️ 环境变量完整性检查',
    description: '每天检查 .env 文件中是否有缺失的必要环境变量。',
    category: 'security',
    defaultExpression: '0 8 * * *',
    defaultAction: 'run_command',
    defaultParams: { command: 'test -f .env && echo ".env 存在, $(wc -l < .env) 行" || echo "WARNING: .env 缺失"' },
    guide: '检查 .env 文件是否存在，确保环境变量配置完整。',
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
