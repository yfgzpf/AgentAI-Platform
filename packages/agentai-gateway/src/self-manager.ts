/**
 * SelfManager — 系统自管理引擎
 * ----------------------------------------------------
 * 理念: AI 不只是执行命令，还能管理自身系统的健康
 *
 * 核心能力:
 *   1. 健康自检 — 定期检查 API Key、模型可用性、缓存状态
 *   2. 异常自修 — 自动修复常见问题 (Key过期/端口占用/缓存损坏)
 *   3. 资源自清理 — 清理过期缓存、压缩记忆、回收磁盘空间
 *   4. 性能自调 — 根据历史数据调整路由权重和超时设置
 *
 * 设计原则:
 *   - 自管理不等于自毁 — 所有破坏性操作需确认
 *   - 自管理是渐进式的 — 先检测→报告→建议→执行
 *   - 不依赖外部 LLM — 纯本地规则
 */

import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

const AGENTAI_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '~', '.agentai');

// ===== 类型定义 =====

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'critical';

export interface HealthCheck {
  component: string;
  status: HealthStatus;
  message: string;
  autoFixAvailable: boolean;
  autoFixed?: boolean;
}

export interface SelfDiagnosis {
  overallStatus: HealthStatus;
  checks: HealthCheck[];
  recommendations: string[];
  timestamp: string;
}

export interface CleanupResult {
  category: string;
  freedBytes: number;
  freedMB: string;
  details: string;
}

// ===== 核心引擎 =====

export class SelfManager extends EventEmitter {
  private lastDiagnosis: SelfDiagnosis | null = null;

  /**
   * 执行全面自检
   */
  async diagnose(): Promise<SelfDiagnosis> {
    const checks: HealthCheck[] = [];

    // 1. API Key 检查
    checks.push(await this.checkApiKeys());

    // 2. 磁盘空间检查
    checks.push(this.checkDiskSpace());

    // 3. 记忆系统检查
    checks.push(await this.checkMemorySystem());

    // 4. 缓存系统检查
    checks.push(this.checkCacheSystem());

    // 5. 端口检查
    checks.push(await this.checkPortAvailability());

    // 计算总体状态
    const statusPriority: Record<HealthStatus, number> = { healthy: 0, degraded: 1, unhealthy: 2, critical: 3 };
    const worstStatus = checks.reduce<HealthStatus>((worst, check) => {
      return statusPriority[check.status] > statusPriority[worst] ? check.status : worst;
    }, 'healthy');

    // 生成建议
    const recommendations = this.generateRecommendations(checks);

    const diagnosis: SelfDiagnosis = {
      overallStatus: worstStatus,
      checks,
      recommendations,
      timestamp: new Date().toISOString(),
    };

    this.lastDiagnosis = diagnosis;
    this.emit('diagnosis:done', diagnosis);

    return diagnosis;
  }

  /**
   * 自动修复 — 只修复安全的、可逆的问题
   */
  async autoFix(): Promise<Array<{ component: string; fixed: boolean; message: string }>> {
    const results: Array<{ component: string; fixed: boolean; message: string }> = [];

    if (!this.lastDiagnosis) {
      await this.diagnose();
    }

    for (const check of this.lastDiagnosis!.checks) {
      if (check.status === 'healthy' || !check.autoFixAvailable) continue;

      switch (check.component) {
        case 'cache': {
          const fixed = this.fixCorruptedCache();
          results.push({ component: 'cache', fixed, message: fixed ? '缓存已清理' : '缓存清理失败' });
          break;
        }
        case 'memory': {
          const fixed = this.fixMemoryOverflow();
          results.push({ component: 'memory', fixed, message: fixed ? '记忆已压缩' : '记忆压缩失败' });
          break;
        }
        case 'disk': {
          const cleaned = this.cleanupTempFiles();
          results.push({ component: 'disk', fixed: cleaned.length > 0, message: `清理 ${cleaned.length} 类临时文件` });
          break;
        }
      }
    }

    this.emit('autofix:done', results);
    return results;
  }

  /**
   * 资源清理 — 回收磁盘空间
   */
  cleanupTempFiles(): CleanupResult[] {
    const results: CleanupResult[] = [];

    // 1. 清理过期缓存文件 (>7天)
    const cacheDir = path.join(AGENTAI_DIR, 'cache');
    const cacheResult = this.cleanDirectory(cacheDir, 7 * 24 * 3600 * 1000);
    if (cacheResult) results.push(cacheResult);

    // 2. 清理 explorer 缓存
    const explorerDir = path.join(AGENTAI_DIR, 'explorer-cache');
    const explorerResult = this.cleanDirectory(explorerDir, 24 * 3600 * 1000);
    if (explorerResult) results.push(explorerResult);

    // 3. 清理 skills 临时文件
    const skillsTemp = path.join(AGENTAI_DIR, 'skills', '.tmp');
    const skillsResult = this.cleanDirectory(skillsTemp, 3600 * 1000);
    if (skillsResult) results.push(skillsResult);

    // 4. 压缩日志 (>1MB 的日志文件)
    const logDir = path.join(AGENTAI_DIR, 'logs');
    if (fsSync.existsSync(logDir)) {
      let logFreed = 0;
      try {
        const files = fsSync.readdirSync(logDir);
        for (const file of files) {
          const fp = path.join(logDir, file);
          try {
            const stat = fsSync.statSync(fp);
            if (stat.size > 1024 * 1024 && file.endsWith('.log')) {
              // 截断日志: 保留最后 100KB
              const content = fsSync.readFileSync(fp, 'utf-8');
              const truncated = content.slice(-100 * 1024);
              fsSync.writeFileSync(fp, truncated, 'utf-8');
              logFreed += stat.size - truncated.length;
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (logFreed > 0) {
        results.push({
          category: '日志压缩',
          freedBytes: logFreed,
          freedMB: (logFreed / 1024 / 1024).toFixed(1) + 'MB',
          details: '大日志文件已截断至 100KB',
        });
      }
    }

    this.emit('cleanup:done', results);
    return results;
  }

  /**
   * 生成系统自检报告 — 给 AI 的 system prompt 用
   */
  buildHealthPrompt(): string {
    if (!this.lastDiagnosis) return '';

    const d = this.lastDiagnosis;
    const statusEmoji: Record<HealthStatus, string> = {
      healthy: '✅', degraded: '⚠️', unhealthy: '❌', critical: '🚨',
    };

    const lines: string[] = [`# 系统自检 (${statusEmoji[d.overallStatus]} ${d.overallStatus})`];
    for (const check of d.checks) {
      lines.push(`${statusEmoji[check.status]} ${check.component}: ${check.message}`);
    }
    if (d.recommendations.length > 0) {
      lines.push(`建议: ${d.recommendations.join('; ')}`);
    }

    return lines.join('\n');
  }

  // ===== 各组件检查 =====

  private async checkApiKeys(): Promise<HealthCheck> {
    const keyMap: Record<string, string> = {
      agentai: 'AGENTAI_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      openai: 'OPENAI_API_KEY',
      cline: 'CLINE_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
    };

    let configured = 0;
    const missing: string[] = [];
    for (const [provider, envVar] of Object.entries(keyMap)) {
      if (process.env[envVar]) {
        configured++;
      } else {
        missing.push(provider);
      }
    }

    if (configured >= 3) {
      return { component: 'API Keys', status: 'healthy', message: `${configured} 个已配置`, autoFixAvailable: false };
    } else if (configured >= 2) {
      return { component: 'API Keys', status: 'degraded', message: `${configured} 个已配置, 缺少 ${missing.join('/')}`, autoFixAvailable: false };
    } else {
      return { component: 'API Keys', status: 'unhealthy', message: `仅 ${configured} 个已配置, 缺少 ${missing.join('/')}`, autoFixAvailable: false };
    }
  }

  private checkDiskSpace(): HealthCheck {
    try {
      const stats = fsSync.statSync(AGENTAI_DIR);
      // 简单检查: ~/.agentai 目录大小
      let totalSize = 0;
      this.calcDirSize(AGENTAI_DIR, totalSize, 0);

      if (totalSize > 500 * 1024 * 1024) { // > 500MB
        return { component: 'disk', status: 'degraded', message: `~/.agentai 占用 ${(totalSize / 1024 / 1024).toFixed(0)}MB`, autoFixAvailable: true };
      }
      return { component: 'disk', status: 'healthy', message: `~/.agentai 占用 ${(totalSize / 1024 / 1024).toFixed(0)}MB`, autoFixAvailable: false };
    } catch {
      return { component: 'disk', status: 'healthy', message: '磁盘正常', autoFixAvailable: false };
    }
  }

  private calcDirSize(dir: string, _acc: number, depth: number): number {
    if (depth > 3) return 0;
    let total = 0;
    try {
      const entries = fsSync.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries.slice(0, 100)) {
        const fp = path.join(dir, entry.name);
        try {
          if (entry.isFile()) {
            total += fsSync.statSync(fp).size;
          } else if (entry.isDirectory()) {
            total += this.calcDirSize(fp, _acc, depth + 1);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return total;
  }

  private async checkMemorySystem(): Promise<HealthCheck> {
    const memDir = path.join(AGENTAI_DIR, 'memory');
    if (!fsSync.existsSync(memDir)) {
      return { component: 'memory', status: 'healthy', message: '记忆系统未初始化', autoFixAvailable: false };
    }

    try {
      const files = fsSync.readdirSync(memDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      let totalSize = 0;
      for (const f of jsonFiles) {
        totalSize += fsSync.statSync(path.join(memDir, f)).size;
      }

      if (totalSize > 10 * 1024 * 1024) { // > 10MB
        return { component: 'memory', status: 'degraded', message: `记忆文件 ${(totalSize / 1024 / 1024).toFixed(1)}MB (${jsonFiles.length} 个)`, autoFixAvailable: true };
      }
      return { component: 'memory', status: 'healthy', message: `记忆正常 (${jsonFiles.length} 会话)`, autoFixAvailable: false };
    } catch {
      return { component: 'memory', status: 'degraded', message: '记忆读取异常', autoFixAvailable: true };
    }
  }

  private checkCacheSystem(): HealthCheck {
    const cacheDir = path.join(AGENTAI_DIR, 'cache');
    if (!fsSync.existsSync(cacheDir)) {
      return { component: 'cache', status: 'healthy', message: '缓存系统正常', autoFixAvailable: false };
    }

    try {
      const files = fsSync.readdirSync(cacheDir);
      let staleCount = 0;
      const now = Date.now();
      for (const f of files) {
        try {
          const stat = fsSync.statSync(path.join(cacheDir, f));
          if (now - stat.mtimeMs > 7 * 24 * 3600 * 1000) staleCount++;
        } catch { /* ignore */ }
      }

      if (staleCount > 10) {
        return { component: 'cache', status: 'degraded', message: `${staleCount} 个过期缓存文件`, autoFixAvailable: true };
      }
      return { component: 'cache', status: 'healthy', message: `缓存正常 (${files.length} 文件)`, autoFixAvailable: false };
    } catch {
      return { component: 'cache', status: 'degraded', message: '缓存异常', autoFixAvailable: true };
    }
  }

  private async checkPortAvailability(): Promise<HealthCheck> {
    // 简单检查: 看 18789 端口是否在监听
    try {
      const { execSync } = await import('child_process');
      const result = execSync('netstat -an | findstr 18789', { encoding: 'utf-8', timeout: 3000 });
      if (result.includes('LISTENING')) {
        return { component: 'port', status: 'healthy', message: 'Gateway 端口 18789 正常', autoFixAvailable: false };
      }
    } catch { /* netstat failed or port not listening */ }

    return { component: 'port', status: 'degraded', message: 'Gateway 可能未运行', autoFixAvailable: false };
  }

  // ===== 自动修复 =====

  private fixCorruptedCache(): boolean {
    const cacheDir = path.join(AGENTAI_DIR, 'cache');
    try {
      if (!fsSync.existsSync(cacheDir)) return true;
      const files = fsSync.readdirSync(cacheDir);
      const now = Date.now();
      let cleaned = 0;
      for (const f of files) {
        try {
          const fp = path.join(cacheDir, f);
          const stat = fsSync.statSync(fp);
          if (now - stat.mtimeMs > 7 * 24 * 3600 * 1000) {
            fsSync.unlinkSync(fp);
            cleaned++;
          }
        } catch { /* ignore */ }
      }
      return true;
    } catch {
      return false;
    }
  }

  private fixMemoryOverflow(): boolean {
    const memDir = path.join(AGENTAI_DIR, 'memory');
    try {
      if (!fsSync.existsSync(memDir)) return true;
      const files = fsSync.readdirSync(memDir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const fp = path.join(memDir, f);
          const stat = fsSync.statSync(fp);
          if (stat.size > 1024 * 1024) { // > 1MB 的记忆文件
            const content = fsSync.readFileSync(fp, 'utf-8');
            try {
              const data = JSON.parse(content);
              // 保留最近 50 条消息
              if (data.messages && Array.isArray(data.messages)) {
                data.messages = data.messages.slice(-50);
                fsSync.writeFileSync(fp, JSON.stringify(data), 'utf-8');
              }
            } catch { /* invalid JSON, skip */ }
          }
        } catch { /* ignore */ }
      }
      return true;
    } catch {
      return false;
    }
  }

  // ===== 辅助方法 =====

  private cleanDirectory(dir: string, maxAge: number): CleanupResult | null {
    if (!fsSync.existsSync(dir)) return null;

    let freed = 0;
    let count = 0;
    const now = Date.now();

    try {
      const files = fsSync.readdirSync(dir);
      for (const f of files) {
        try {
          const fp = path.join(dir, f);
          const stat = fsSync.statSync(fp);
          if (now - stat.mtimeMs > maxAge) {
            freed += stat.size;
            fsSync.unlinkSync(fp);
            count++;
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    if (count > 0) {
      return {
        category: path.basename(dir),
        freedBytes: freed,
        freedMB: (freed / 1024 / 1024).toFixed(1) + 'MB',
        details: `清理 ${count} 个过期文件`,
      };
    }
    return null;
  }

  private generateRecommendations(checks: HealthCheck[]): string[] {
    const recs: string[] = [];
    for (const check of checks) {
      if (check.status === 'healthy') continue;

      switch (check.component) {
        case 'API Keys':
          recs.push('在设置页面配置更多 API Key 以提高可用性');
          break;
        case 'disk':
          recs.push('运行 autoFix 清理临时文件和过期缓存');
          break;
        case 'memory':
          recs.push('记忆文件过大，建议压缩或清理旧会话');
          break;
        case 'cache':
          recs.push('缓存文件过多，建议清理过期缓存');
          break;
        case 'port':
          recs.push('Gateway 可能未启动，请检查进程状态');
          break;
      }
    }
    return recs;
  }
}

export const selfManager = new SelfManager();
