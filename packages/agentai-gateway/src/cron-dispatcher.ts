/**
 * Cron Dispatcher - 真定时反思 + 自进化触发器
 * ----------------------------------------------------
 * 替代原有"只回合触发"的弱点: 不连续对话也能自进化
 *
 * 5 个触发器:
 *   1. 反思门 (每 6 小时)        → reflect()
 *   2. 定时清理 (每天 3 点 AM)   → CleanerDaemon.runOnce()
 *   3. 进化日报 (每天 6 点 AM)   → 汇总 evolution.jsonl
 *   4. 错误率检测 (每 1 小时)    → 如果工具失败率 > 30% 报警
 *   5. 用户空闲检测 (每 30 分钟) → 触发轻量清理
 */

import { EventEmitter } from 'events';
import { CronJob } from './cron-job.js';

export class CronDispatcher extends EventEmitter {
  private jobs: CronJob[] = [];

  start(): void {
    // 1. 反思门 — 每 6 小时
    this.jobs.push(new CronJob('0 */6 * * *', async () => {
      console.log('[cron] 6h timer: triggering reflector');
      try {
        const { reflect } = await import('./reflector.js');
        if (typeof reflect !== 'function') {
          console.warn('[cron] reflector module loaded but reflect is not a function');
          return;
        }
        // reflect() needs router, ctx, opts. We create a minimal context.
        // This is a fire-and-forget safety net — best effort only.
        await reflect(
          null as any,  // router is optional for basic reflection
          {
            userMessage: 'periodic reflection triggered',
            finalResponse: '',
            toolCalls: [],
            iterations: 0,
            success: true,
          },
          { reflectEvery: 1, force: true },
        );
      } catch (e: any) {
        console.warn(`[cron] reflector failed (${e.code || e.message})`);
      }
    }));

    // 2. 定时清理 — 每天凌晨 3 点
    this.jobs.push(new CronJob('0 3 * * *', async () => {
      console.log('[cron] daily 3AM: triggering clean daemon');
      try {
        const { CleanerDaemon } = await import('./cleaner/index.js');
        const { loadRules } = await import('./cleaner/rule-engine.js');
        const { stateDir } = await import('./cleaner/state.js');
        const path = await import('path');
        const fs = await import('fs');
        if (typeof CleanerDaemon !== 'function' && typeof CleanerDaemon !== 'object') {
          console.warn('[cron] cleaner module not available');
          return;
        }
        // 加载规则文件
        let rules: any[] = [];
        const rulesPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'cleaner/rules.json');
        if (fs.existsSync(rulesPath)) {
          rules = await loadRules(rulesPath);
        }
        const daemon = new CleanerDaemon({
          rules,
          stateDir: stateDir(),
          scanRoots: [process.cwd()],
          workspace: process.cwd(),
          audit: { log: async () => { /* noop */ } },
        });
        await daemon.runOnce({ scope: 'safe' });
      } catch (e: any) {
        console.warn(`[cron] cleaner failed (${e.code || e.message})`);
      }
    }));

    // 3. 进化日报 — 每天早上 6 点
    this.jobs.push(new CronJob('0 6 * * *', async () => {
      console.log('[cron] daily 6AM: generating evolution report');
      try {
        const { readEvolution } = await import('./evolution.js');
        if (typeof readEvolution !== 'function') {
          console.warn('[cron] evolution module not available');
          return;
        }
        const entries = await readEvolution(100);
        const counts = new Map<string, number>();
        for (const e of entries) {
          counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        }
        console.log('[cron] evolution report:', Object.fromEntries(counts));
      } catch (e: any) {
        console.warn(`[cron] evolution report failed (${e.code || e.message})`);
      }
    }));

    // 4. 错误率检测 — 每小时
    this.jobs.push(new CronJob('0 * * * *', async () => {
      console.log('[cron] hourly: checking error rate');
      try {
        const { readEvolution } = await import('./evolution.js');
        if (typeof readEvolution !== 'function') return;
        const entries = await readEvolution(50);
        const failures = entries.filter((e: any) => e.type === 'failure').length;
        if (failures > 5) {
          console.warn(`[cron] HIGH FAILURE RATE: ${failures} recent failures`);
          this.emit('error-rate-alert', { failures });
        }
      } catch (e: any) {
        console.warn(`[cron] error rate check failed (${e.code || e.message})`);
      }
    }));

    // 5. 用户空闲检测 — 每 30 分钟
    this.jobs.push(new CronJob('*/30 * * * *', async () => {
      console.log('[cron] 30min: checking user idle');
      try {
        const { getSessionManager } = await import('./session-manager.js');
        const sm = getSessionManager();
        const stats = sm.stats();
        if (stats.size > 0) {
          console.log(`[cron] active sessions: ${stats.size}, total calls: ${stats.totalCalls}`);
          this.emit('idle-sessions', { count: stats.size });
        }
      } catch (e: any) {
        console.warn('[cron] idle check failed:', e.message);
      }
    }));

    // 6. 客户跟进检查 — 每小时扫描到期跟进任务 (C4)
    this.jobs.push(new CronJob('0 * * * *', async () => {
      console.log('[cron] hourly: checking follow-up tasks');
      try {
        const { getFollowUpScheduler } = await import('./follow-up-scheduler.js');
        const scheduler = getFollowUpScheduler();
        // 设置 gateway URL (供 AI 生成话术用)
        const host = process.env.AGENTAI_HOST || '127.0.0.1';
        const port = process.env.AGENTAI_PORT || '18789';
        scheduler.setGatewayUrl(`http://${host}:${port}`);
        // 检查并生成跟进任务
        const tasks = await scheduler.checkAndGenerate();
        if (tasks.length > 0) {
          this.emit('follow-up:tasks', { count: tasks.length, tasks });
          console.log(`[cron] generated ${tasks.length} follow-up tasks`);
        }
        // 清理旧任务
        scheduler.cleanup();
      } catch (e: any) {
        console.warn(`[cron] follow-up check failed: ${e.message}`);
      }
    }));

    // 7. 自评估量化评分 — 每 4 小时
    this.jobs.push(new CronJob('0 */4 * * *', async () => {
      console.log('[cron] 4h: running self-evaluation');
      try {
        const { cronSelfEvaluation } = await import('./cron-self-evaluation.js');
        await cronSelfEvaluation.init();
        
        // 生成定期报告
        const report = cronSelfEvaluation.generateReport('daily');
        console.log('[cron] self-evaluation report:', {
          total: report.stats.totalEvaluations,
          average: report.stats.averageScore.toFixed(2),
          trend24h: report.stats.trend.last24h.toFixed(2),
          insights: report.insights,
        });
        
        // 如果有建议，记录到进化日志
        if (report.recommendations.length > 0) {
          const { writeEvolution } = await import('./evolution.js');
          await writeEvolution({
            type: 'self-eval-insight',
            content: JSON.stringify({
              insights: report.insights,
              recommendations: report.recommendations,
              stats: report.stats,
            }),
          });
        }
        
        this.emit('self-evaluation', report);
      } catch (e: any) {
        console.warn(`[cron] self-evaluation failed: ${e.message}`);
      }
    }));

    // 8. 自动清理系统 — 每 4 小时
    this.jobs.push(new CronJob('0 */4 * * *', async () => {
      console.log('[cron] 4h: running auto-cleanup');
      try {
        const { autoCleanup } = await import('./auto-cleanup.js');
        const result = await autoCleanup.runCleanup();
        
        console.log('[cron] cleanup result:', {
          tempFiles: result.tempFiles.deleted,
          logsRotated: result.logs.rotated,
          cacheFiles: result.cache.deleted,
          diskBefore: result.disk.beforeUsage + '%',
          diskAfter: result.disk.afterUsage + '%',
        });
        
        // 如果磁盘使用率过高，发送告警
        if (result.disk.status === 'emergency') {
          this.emit('cleanup:emergency', result);
        }
        
        this.emit('cleanup:complete', result);
      } catch (e: any) {
        console.warn(`[cron] auto-cleanup failed: ${e.message}`);
      }
    }));

    // 9. 每周深度评估报告 — 每周一早上 9 点
    this.jobs.push(new CronJob('0 9 * * 1', async () => {
      console.log('[cron] weekly: generating deep evaluation report');
      try {
        const { cronSelfEvaluation } = await import('./cron-self-evaluation.js');
        const report = cronSelfEvaluation.generateReport('weekly');
        
        console.log('[cron] weekly report:', {
          period: 'weekly',
          averageScore: report.stats.averageScore.toFixed(2),
          distribution: report.stats.scoreDistribution,
          topIssues: report.stats.topIssues,
          recommendations: report.recommendations,
        });
        
        this.emit('weekly-report', report);
      } catch (e: any) {
        console.warn(`[cron] weekly report failed: ${e.message}`);
      }
    }));

    // 启动所有定时任务
    for (const job of this.jobs) {
      job.start();
    }

    console.log(`[cron] started with ${this.jobs.length} jobs`);
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    console.log('[cron] stopped all jobs');
  }
}
