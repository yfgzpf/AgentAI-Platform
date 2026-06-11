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
        console.warn('[cron] reflector failed:', e.message);
      }
    }));

    // 2. 定时清理 — 每天凌晨 3 点
    this.jobs.push(new CronJob('0 3 * * *', async () => {
      console.log('[cron] daily 3AM: triggering clean daemon');
      try {
        const { CleanerDaemon } = await import('./cleaner/index.js');
        const daemon = new CleanerDaemon({
          rules: [],
          stateDir: './.agentai/cleaner',
          scanRoots: [process.cwd()],
          workspace: process.cwd(),
          audit: { log: async () => { /* noop */ } },
        });
        await daemon.runOnce({ scope: 'safe' });
      } catch (e: any) {
        console.warn('[cron] cleaner failed:', e.message);
      }
    }));

    // 3. 进化日报 — 每天早上 6 点
    this.jobs.push(new CronJob('0 6 * * *', async () => {
      console.log('[cron] daily 6AM: generating evolution report');
      try {
        const { readEvolution } = await import('./evolution.js');
        const entries = await readEvolution(100);
        const counts = new Map<string, number>();
        for (const e of entries) {
          counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
        }
        console.log('[cron] evolution report:', Object.fromEntries(counts));
      } catch (e: any) {
        console.warn('[cron] evolution report failed:', e.message);
      }
    }));

    // 4. 错误率检测 — 每小时
    this.jobs.push(new CronJob('0 * * * *', async () => {
      console.log('[cron] hourly: checking error rate');
      try {
        const { readEvolution } = await import('./evolution.js');
        const entries = await readEvolution(50);
        const failures = entries.filter((e: any) => e.type === 'failure').length;
        if (failures > 5) {
          console.warn(`[cron] HIGH FAILURE RATE: ${failures} recent failures`);
          this.emit('error-rate-alert', { failures });
        }
      } catch (e: any) {
        console.warn('[cron] error rate check failed:', e.message);
      }
    }));

    // 5. 用户空闲检测 — 每 30 分钟
    this.jobs.push(new CronJob('*/30 * * * *', async () => {
      console.log('[cron] 30min: checking user idle');
      try {
        const { getSessionManager } = await import('./session-manager.js');
        const sm = getSessionManager();
        const sessions = sm?.get?.('temp') ? [sm.get('temp')] : [];
        const idleCount = sessions.filter((s: any) => {
          return Date.now() - (s.lastAccessedAt ?? 0) > 30 * 60 * 1000;
        }).length;
        if (idleCount > 0) {
          console.log(`[cron] ${idleCount} idle sessions detected`);
          this.emit('idle-sessions', { count: idleCount });
        }
      } catch (e: any) {
        console.warn('[cron] idle check failed:', e.message);
      }
    }));

    console.log(`[cron] started with ${this.jobs.length} jobs`);
  }

  stop(): void {
    for (const job of this.jobs) {
      job.stop();
    }
    console.log('[cron] stopped all jobs');
  }
}
