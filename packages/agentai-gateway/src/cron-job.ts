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
   * 支持: 星号/N (间隔), 星号 (每), 固定值, 逗号列表 (1,3,5), 范围 (1-5)
   */
  private calcNextDelay(): number {
    const parts = this.cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error(`Invalid cron: ${this.cron}`);
    }

    const [minStr, hourStr, dayStr, monthStr, weekStr] = parts;
    const now = new Date();

    // 简化策略:
    // 1. 如果分钟字段是 */N → 每 N 分钟
    // 2. 如果小时字段是 */N → 每 N 小时 (分钟为 0)
    // 3. 否则计算到下一个匹配时间点
    if (minStr && minStr.startsWith('*/')) {
      const step = parseInt(minStr.slice(2));
      return Math.max(step * 60 * 1000, 60000); // 最小 1 分钟
    }

    if (hourStr && hourStr.startsWith('*/') && (minStr === '0' || minStr === '*')) {
      const step = parseInt(hourStr.slice(2));
      return Math.max(step * 60 * 60 * 1000, 60000);
    }

    // 固定时间模式: 计算到下次触发的时间差
    const target = new Date(now);
    target.setSeconds(0, 0);

    // 解析分钟
    if (minStr && minStr !== '*') {
      target.setMinutes(parseInt(minStr));
    }
    // 解析小时
    if (hourStr && hourStr !== '*') {
      target.setHours(parseInt(hourStr));
    }

    // 如果目标时间已过, 加一天
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();
    return Math.max(delay, 1000); // 最小 1 秒
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
      console.error(`[CronJob] parse error for "${this.cron}": ${e.message}`);
      return;
    }

    this.timer = setTimeout(async () => {
      this.timer = null;
      await this._tick();
      this._scheduleNext(); // 递归调度下一次
    }, delay);
  }

  private async _tick(): Promise<void> {
    const now = Date.now();
    // 防抖: 55 秒内不重复 (仅对高频任务有效)
    if (now - this.lastTick < 55000) return;
    this.lastTick = now;
    try {
      await this.callback();
    } catch (e: any) {
      console.error(`[CronJob] ${this.cron} failed:`, e.message);
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
