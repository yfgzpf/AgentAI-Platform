/**
 * CronJob - 标准 Cron 调度器
 * 支持: 分 时 日 月 周 (标准 5 字段格式)
 * 使用 cron-parser 库支持完整 cron 语法
 *
 * 2026-07-12 修复:
 *   1. 使用 cron-parser 替换简单解析器，支持完整语法
 *   2. 支持逗号列表、范围、L、# 等高级语法
 *   3. 正确时区处理
 */

import { EventEmitter } from 'events';
import { parseExpression } from 'cron-parser';

export class CronJob extends EventEmitter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTick: number = 0;
  private running = false;

  constructor(private cron: string, private callback: () => Promise<void>) {
    super();
  }

  /**
   * 计算到下次 cron 触发时间的毫秒数
   * 使用 cron-parser 库支持完整 cron 语法
   */
  private calcNextDelay(): number {
    try {
      // 使用标准 cron-parser 库
      const interval = parseExpression(this.cron, {
        currentDate: new Date(),
      });
      const next = interval.next();
      const delay = next.getTime() - Date.now();
      return Math.max(delay, 1000); // 最小 1 秒
    } catch (e: any) {
      console.error(`[CronJob] 解析失败 "${this.cron}": ${e.message}`);
      // 降级到简单解析
      return this.calcSimpleDelay();
    }
  }

  /**
   * 简单解析降级方案
   */
  private calcSimpleDelay(): number {
    const parts = this.cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      console.error(`[CronJob] 无效cron: ${this.cron}`);
      return 60000; // 默认1分钟
    }

    const [minStr, hourStr] = parts;
    const now = new Date();

    // */N → 每 N 分钟
    if (minStr && minStr.startsWith('*/')) {
      const step = parseInt(minStr.slice(2)) || 1;
      return Math.max(step * 60 * 1000, 60000);
    }

    // 固定时间
    const target = new Date(now);
    target.setSeconds(0, 0);

    if (minStr && minStr !== '*') {
      target.setMinutes(parseInt(minStr));
    }
    if (hourStr && hourStr !== '*') {
      target.setHours(parseInt(hourStr));
    }

    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return Math.max(target.getTime() - now.getTime(), 1000);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this._scheduleNext();
    console.log(`[CronJob] started: ${this.cron}`);
  }

  private _scheduleNext(): void {
    if (!this.running) return;

    let delay: number;
    try {
      delay = this.calcNextDelay();
    } catch (e: any) {
      console.error(`[CronJob] 调度错误: ${e.message}`);
      return;
    }

    this.timer = setTimeout(async () => {
      this.timer = null;
      await this._tick();
      this._scheduleNext();
    }, delay);
  }

  private async _tick(): Promise<void> {
    const now = Date.now();
    // 防抖: 55 秒内不重复
    if (now - this.lastTick < 55000) return;
    this.lastTick = now;

    try {
      await this.callback();
      this.emit('completed');
    } catch (e: any) {
      console.error(`[CronJob] 执行错误: ${e.message}`);
      this.emit('error', e);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log(`[CronJob] stopped: ${this.cron}`);
  }

  getCron(): string {
    return this.cron;
  }

  isRunning(): boolean {
    return this.running;
  }
}
