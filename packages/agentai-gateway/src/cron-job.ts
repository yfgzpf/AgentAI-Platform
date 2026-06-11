/**
 * CronJob - 简易 Cron 调度器
 * 支持: 分 时 日 月 周 (标准 5 字段格式)
 * 不依赖 node-cron (避免 native 依赖)
 */

import { EventEmitter } from 'events';

export interface CronJobOptions {
  cron: string;              // "0 */6 * * *" format
  callback: () => Promise<void>;
  onTick?: (date: Date) => void;  // 可选: 每次触发回调
}

export class CronJob extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastTick: number = 0;

  constructor(private cron: string, private callback: () => Promise<void>) {
    super();
  }

  /**
   * 解析 cron 表达式, 转为 setInterval 毫秒数
   * 简化: 只支持 step (/N) 和 * (全匹配)
   */
  private parseCronToMs(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron: ${cron}`);
    }

    const [minStr, hourStr] = [parts[0] || '*', parts[1] || '*'];

    // 解析分钟
    let minute = 0;
    if (minStr === '*') {
      minute = 0;
    } else if (minStr.startsWith('*/')) {
      const step = parseInt(minStr.slice(2));
      minute = step;  // will be handled by interval
    } else {
      minute = parseInt(minStr);
    }

    // 解析小时
    let hourInterval = 1;
    if (hourStr === '*') {
      hourInterval = 1;
    } else if (hourStr.startsWith('*/')) {
      hourInterval = parseInt(hourStr.slice(2));
    } else if (hourStr.startsWith('*/') || hourStr === '*') {
      hourInterval = 1;
    }

    // 简化: 计算最小间隔
    if (minStr.startsWith('*/')) {
      const step = parseInt(minStr.slice(2));
      return step * 60 * 1000;  // 按分钟间隔
    } else if (hourStr.startsWith('*/')) {
      const step = parseInt(hourStr.slice(2));
      return step * 60 * 60 * 1000;  // 按小时间隔
    } else if (minStr === '*' && hourStr === '*') {
      return 60 * 1000;  // 每分钟检查
    } else {
      // 固定时间: 计算下次触发时间
      const now = new Date();
      const target = new Date(now);
      target.setHours(parseInt(hourStr || '0'), minute, 0, 0);
      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }
      return target.getTime() - now.getTime();
    }
  }

  start(): void {
    const ms = this.parseCronToMs(this.cron);
    if (ms < 1000) {
      console.warn(`[CronJob] ${this.cron} resolved to ${ms}ms, clamping to 1s`);
    }

    // 立即执行一次
    this.tick().catch(() => {});

    // 然后按间隔执行
    this.interval = setInterval(async () => {
      await this.tick();
    }, Math.max(ms, 60000));  // 最小 1 分钟

    console.log(`[CronJob] started: ${this.cron} (every ${ms / 60000} min)`);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTick < 55000) return;  // 防抖: 55 秒内不重复
    this.lastTick = now;
    try {
      await this.callback();
    } catch (e: any) {
      console.error(`[CronJob] ${this.cron} failed:`, e.message);
    }
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}
