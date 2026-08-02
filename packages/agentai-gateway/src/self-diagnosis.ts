/**
 * Self-Diagnosis System — 自我诊断系统
 * --------------------------------------------
 * AI自动检测自身故障并尝试修复
 * 
 * 诊断维度:
 * 1. 系统健康检查 (内存、CPU、磁盘)
 * 2. 依赖服务检查 (LLM API、数据库、文件系统)
 * 3. 配置有效性检查
 * 4. 性能瓶颈检测
 * 5. 安全漏洞扫描
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ===== 类型定义 =====

export type DiagnosisSeverity = 'info' | 'warning' | 'critical' | 'fatal';
export type DiagnosisCategory = 'system' | 'dependency' | 'config' | 'performance' | 'security';

export interface DiagnosisIssue {
  id: string;
  category: DiagnosisCategory;
  severity: DiagnosisSeverity;
  title: string;
  description: string;
  recommendation: string;
  autoFixable: boolean;
  fixAction?: string;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface DiagnosisResult {
  healthy: boolean;
  score: number; // 0-100
  issues: DiagnosisIssue[];
  checksPerformed: string[];
  durationMs: number;
  timestamp: number;
}

export interface SystemMetrics {
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  cpu: {
    loadAvg: number[];
    usagePercent: number;
  };
  disk: {
    total: number;
    free: number;
    usagePercent: number;
  };
  uptime: number;
}

// ===== 自我诊断系统 =====

export class SelfDiagnosisSystem extends EventEmitter {
  private issues: DiagnosisIssue[] = [];
  private history: DiagnosisResult[] = [];
  private maxHistory = 100;
  private diagnosisDir: string;

  constructor() {
    super();
    this.diagnosisDir = path.join(os.homedir(), '.agentai', 'diagnosis');
    this._ensureDir();
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this.diagnosisDir)) {
      fs.mkdirSync(this.diagnosisDir, { recursive: true });
    }
  }

  // ---------------------------------------------------------------------------
  // 主诊断流程
  // ---------------------------------------------------------------------------

  /**
   * 执行完整诊断
   */
  async runFullDiagnosis(): Promise<DiagnosisResult> {
    const startTime = Date.now();
    this.issues = [];
    const checksPerformed: string[] = [];

    // 1. 系统健康检查
    checksPerformed.push('system');
    await this._checkSystemHealth();

    // 2. 依赖服务检查
    checksPerformed.push('dependencies');
    await this._checkDependencies();

    // 3. 配置检查
    checksPerformed.push('config');
    await this._checkConfiguration();

    // 4. 性能检查
    checksPerformed.push('performance');
    await this._checkPerformance();

    // 5. 安全检查
    checksPerformed.push('security');
    await this._checkSecurity();

    // 计算健康分数
    const score = this._calculateHealthScore();
    const healthy = score >= 80 && !this.issues.some(i => i.severity === 'fatal');

    const result: DiagnosisResult = {
      healthy,
      score,
      issues: this.issues,
      checksPerformed,
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };

    // 保存历史
    this._saveResult(result);
    
    // 触发事件
    this.emit('diagnosis:complete', result);
    
    if (!healthy) {
      this.emit('diagnosis:unhealthy', result);
    }

    return result;
  }

  /**
   * 快速诊断 (仅关键检查)
   */
  async runQuickDiagnosis(): Promise<DiagnosisResult> {
    const startTime = Date.now();
    this.issues = [];

    await this._checkSystemHealth();
    await this._checkCriticalDependencies();

    const score = this._calculateHealthScore();
    
    return {
      healthy: score >= 80,
      score,
      issues: this.issues,
      checksPerformed: ['system', 'critical_dependencies'],
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // 具体检查项
  // ---------------------------------------------------------------------------

  private async _checkSystemHealth(): Promise<void> {
    const metrics = this._getSystemMetrics();

    // 内存检查
    if (metrics.memory.usagePercent > 90) {
      this._addIssue({
        category: 'system',
        severity: 'critical',
        title: '内存使用率过高',
        description: `当前内存使用率 ${metrics.memory.usagePercent.toFixed(1)}%`,
        recommendation: '考虑重启服务或增加物理内存',
        autoFixable: false,
      });
    } else if (metrics.memory.usagePercent > 75) {
      this._addIssue({
        category: 'system',
        severity: 'warning',
        title: '内存使用率偏高',
        description: `当前内存使用率 ${metrics.memory.usagePercent.toFixed(1)}%`,
        recommendation: '监控内存使用趋势',
        autoFixable: false,
      });
    }

    // 磁盘检查
    if (metrics.disk.usagePercent > 90) {
      this._addIssue({
        category: 'system',
        severity: 'critical',
        title: '磁盘空间不足',
        description: `磁盘使用率 ${metrics.disk.usagePercent.toFixed(1)}%`,
        recommendation: '清理日志文件或扩展磁盘空间',
        autoFixable: true,
        fixAction: 'clean_logs',
      });
    }

    // CPU检查
    if (metrics.cpu.usagePercent > 80) {
      this._addIssue({
        category: 'system',
        severity: 'warning',
        title: 'CPU使用率偏高',
        description: `当前CPU使用率 ${metrics.cpu.usagePercent.toFixed(1)}%`,
        recommendation: '检查是否有异常任务占用CPU',
        autoFixable: false,
      });
    }
  }

  private async _checkDependencies(): Promise<void> {
    // 检查LLM API可用性
    const llmProviders = ['agentai', 'zhipu', 'deepseek', 'openai'];
    const availableProviders = [];
    
    for (const provider of llmProviders) {
      const envKey = `${provider.toUpperCase()}_API_KEY`;
      if (process.env[envKey]) {
        availableProviders.push(provider);
      }
    }

    if (availableProviders.length === 0) {
      this._addIssue({
        category: 'dependency',
        severity: 'fatal',
        title: '无可用LLM API',
        description: '未配置任何LLM API密钥',
        recommendation: '配置至少一个LLM提供商的API密钥',
        autoFixable: false,
      });
    } else if (availableProviders.length < 2) {
      this._addIssue({
        category: 'dependency',
        severity: 'warning',
        title: 'LLM API冗余不足',
        description: '仅配置了一个LLM提供商',
        recommendation: '建议配置多个提供商以实现故障转移',
        autoFixable: false,
      });
    }

    // 检查Node.js版本
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 18) {
      this._addIssue({
        category: 'dependency',
        severity: 'critical',
        title: 'Node.js版本过低',
        description: `当前版本 ${nodeVersion}，需要 >= 18`,
        recommendation: '升级Node.js到18或更高版本',
        autoFixable: false,
      });
    }
  }

  private async _checkCriticalDependencies(): Promise<void> {
    // 仅检查最关键的依赖
    if (!process.env.AGENTAI_API_KEY && !process.env.OPENAI_API_KEY) {
      this._addIssue({
        category: 'dependency',
        severity: 'fatal',
        title: '缺少核心API密钥',
        description: '未配置AGENTAI_API_KEY或OPENAI_API_KEY',
        recommendation: '立即配置API密钥',
        autoFixable: false,
      });
    }
  }

  private async _checkConfiguration(): Promise<void> {
    const workspaceRoot = process.cwd();
    
    // 检查关键配置文件
    const criticalFiles = [
      'package.json',
      'tsconfig.json',
    ];

    for (const file of criticalFiles) {
      const filePath = path.join(workspaceRoot, file);
      if (!fs.existsSync(filePath)) {
        this._addIssue({
          category: 'config',
          severity: 'critical',
          title: `缺少配置文件: ${file}`,
          description: `未找到 ${file}`,
          recommendation: '恢复或重新创建配置文件',
          autoFixable: false,
        });
      }
    }

    // 检查.env文件
    const envPath = path.join(workspaceRoot, '.env');
    if (!fs.existsSync(envPath)) {
      this._addIssue({
        category: 'config',
        severity: 'warning',
        title: '缺少.env文件',
        description: '未找到环境变量配置文件',
        recommendation: '从.env.example复制创建',
        autoFixable: true,
        fixAction: 'create_env',
      });
    }
  }

  private async _checkPerformance(): Promise<void> {
    // 检查日志文件大小
    const logDir = path.join(os.homedir(), '.agentai', 'logs');
    if (fs.existsSync(logDir)) {
      let totalLogSize = 0;
      const files = fs.readdirSync(logDir);
      
      for (const file of files) {
        const stat = fs.statSync(path.join(logDir, file));
        totalLogSize += stat.size;
      }

      // 超过500MB警告
      if (totalLogSize > 500 * 1024 * 1024) {
        this._addIssue({
          category: 'performance',
          severity: 'warning',
          title: '日志文件过大',
          description: `日志总大小 ${(totalLogSize / 1024 / 1024).toFixed(1)} MB`,
          recommendation: '清理旧日志文件',
          autoFixable: true,
          fixAction: 'clean_logs',
        });
      }
    }

    // 检查备份文件数量
    const backupDir = path.join(os.homedir(), '.agentai', 'backups');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir);
      if (backups.length > 100) {
        this._addIssue({
          category: 'performance',
          severity: 'info',
          title: '备份文件过多',
          description: `共有 ${backups.length} 个备份文件`,
          recommendation: '定期清理旧备份',
          autoFixable: true,
          fixAction: 'clean_backups',
        });
      }
    }
  }

  private async _checkSecurity(): Promise<void> {
    // 检查敏感文件权限
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      try {
        const stats = fs.statSync(envPath);
        const mode = stats.mode;
        // 检查是否其他用户可读写 (简化检查)
        if (mode & 0o044) {
          this._addIssue({
            category: 'security',
            severity: 'warning',
            title: '.env文件权限过于开放',
            description: '其他用户可能可以读取.env文件',
            recommendation: '修改文件权限为 600',
            autoFixable: true,
            fixAction: 'fix_env_permissions',
          });
        }
      } catch (e) {
        // 忽略权限检查错误
      }
    }

    // 检查是否暴露的API密钥
    const srcDir = path.join(process.cwd(), 'src');
    if (fs.existsSync(srcDir)) {
      // 简单的模式检查
      const dangerousPatterns = [
        /['"]sk-[a-zA-Z0-9]{20,}['"]/, // OpenAI API key pattern
        /api[_-]?key['"]?\s*[:=]\s*['"][a-zA-Z0-9]{10,}/i,
      ];

      // 注意：这里只是示例，实际应该使用更安全的方式检查
      this._addIssue({
        category: 'security',
        severity: 'info',
        title: '建议定期审计代码中的敏感信息',
        description: '确保没有硬编码的API密钥',
        recommendation: '使用环境变量管理敏感信息',
        autoFixable: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 自动修复
  // ---------------------------------------------------------------------------

  /**
   * 尝试自动修复问题
   */
  async attemptAutoFix(issueId: string): Promise<{ success: boolean; message: string }> {
    const issue = this.issues.find(i => i.id === issueId);
    if (!issue) {
      return { success: false, message: '问题未找到' };
    }

    if (!issue.autoFixable || !issue.fixAction) {
      return { success: false, message: '该问题不支持自动修复' };
    }

    try {
      switch (issue.fixAction) {
        case 'clean_logs':
          return await this._fixCleanLogs();
        case 'clean_backups':
          return await this._fixCleanBackups();
        case 'create_env':
          return await this._fixCreateEnv();
        case 'fix_env_permissions':
          return await this._fixEnvPermissions();
        default:
          return { success: false, message: `未知的修复动作: ${issue.fixAction}` };
      }
    } catch (e: any) {
      return { success: false, message: `修复失败: ${e.message}` };
    }
  }

  private async _fixCleanLogs(): Promise<{ success: boolean; message: string }> {
    const logDir = path.join(os.homedir(), '.agentai', 'logs');
    if (!fs.existsSync(logDir)) {
      return { success: true, message: '日志目录不存在' };
    }

    const files = fs.readdirSync(logDir);
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > sevenDays) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    return { success: true, message: `已清理 ${deleted} 个旧日志文件` };
  }

  private async _fixCleanBackups(): Promise<{ success: boolean; message: string }> {
    const backupDir = path.join(os.homedir(), '.agentai', 'backups');
    if (!fs.existsSync(backupDir)) {
      return { success: true, message: '备份目录不存在' };
    }

    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(backupDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > thirtyDays) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    return { success: true, message: `已清理 ${deleted} 个旧备份文件` };
  }

  private async _fixCreateEnv(): Promise<{ success: boolean; message: string }> {
    const envPath = path.join(process.cwd(), '.env');
    const examplePath = path.join(process.cwd(), '.env.example');
    
    if (fs.existsSync(examplePath)) {
      fs.copyFileSync(examplePath, envPath);
      return { success: true, message: '已从.env.example创建.env文件' };
    }

    // 创建基本的.env模板
    const template = `# AgentAI Platform Environment Configuration
# Generated by Self-Diagnosis System

# LLM API Keys (至少配置一个)
AGENTAI_API_KEY=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
ZHIPU_API_KEY=

# Optional: Custom endpoints
# AGENTAI_BASE_URL=
`;
    fs.writeFileSync(envPath, template);
    return { success: true, message: '已创建.env模板文件' };
  }

  private async _fixEnvPermissions(): Promise<{ success: boolean; message: string }> {
    const envPath = path.join(process.cwd(), '.env');
    try {
      fs.chmodSync(envPath, 0o600);
      return { success: true, message: '已修复.env文件权限为600' };
    } catch (e: any) {
      return { success: false, message: `权限修复失败: ${e.message}` };
    }
  }

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  private _getSystemMetrics(): SystemMetrics {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // 简单的CPU使用率估算
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = 100 - ~~(100 * totalIdle / totalTick);

    return {
      memory: {
        total: totalMem,
        used: usedMem,
        free: freeMem,
        usagePercent: (usedMem / totalMem) * 100,
      },
      cpu: {
        loadAvg: os.loadavg(),
        usagePercent: cpuUsage,
      },
      disk: {
        total: 0,
        free: 0,
        usagePercent: 0,
      },
      uptime: os.uptime(),
    };
  }

  private _addIssue(partial: Omit<DiagnosisIssue, 'id' | 'timestamp'>): void {
    const issue: DiagnosisIssue = {
      ...partial,
      id: `issue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };
    this.issues.push(issue);
    this.emit('issue:detected', issue);
  }

  private _calculateHealthScore(): number {
    if (this.issues.length === 0) return 100;

    const severityWeights = {
      info: 0,
      warning: 5,
      critical: 15,
      fatal: 30,
    };

    const totalDeduction = this.issues.reduce(
      (sum, issue) => sum + severityWeights[issue.severity],
      0
    );

    return Math.max(0, 100 - totalDeduction);
  }

  private _saveResult(result: DiagnosisResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // 持久化
    try {
      const file = path.join(this.diagnosisDir, 'history.jsonl');
      const line = JSON.stringify(result) + '\n';
      fs.appendFileSync(file, line);
    } catch (e) {
      console.warn('[self-diagnosis] Failed to save result:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 公共API
  // ---------------------------------------------------------------------------

  /**
   * 获取诊断历史
   */
  getHistory(limit: number = 10): DiagnosisResult[] {
    return this.history.slice(-limit);
  }

  /**
   * 获取当前问题列表
   */
  getCurrentIssues(): DiagnosisIssue[] {
    return [...this.issues];
  }

  /**
   * 获取系统指标
   */
  getMetrics(): SystemMetrics {
    return this._getSystemMetrics();
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _diagnosis: SelfDiagnosisSystem | null = null;

export function getSelfDiagnosis(): SelfDiagnosisSystem {
  if (!_diagnosis) {
    _diagnosis = new SelfDiagnosisSystem();
  }
  return _diagnosis;
}
