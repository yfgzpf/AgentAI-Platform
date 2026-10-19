/**
 * cron-parse 回归测试
 *
 * 事故 (富哥 2026-10-19 启动日志):
 *   [automation] 不支持的 cron 表达式: 0 2 * * *, 使用默认 60 分钟   ← 连刷 10 次
 * 原实现只会解析 `* / N`, 于是"每日备份(0 2)""日志清理(0 4)""每周一(0 9 * * 1)"
 * 这些任务**全在按小时乱跑**, 用户设定的时间点根本不生效。
 */
import { describe, it, expect } from 'vitest';
import { parseCron, parseCronField, cronMatches } from '../cron-parse.js';

const at = (h: number, m: number, day = 15) => new Date(2026, 9, day, h, m, 0, 0); // 2026-10-15 是周四

describe('cron-parse: 字段解析', () => {
  it('* / 单值 / 区间 / 步长 / 枚举', () => {
    expect([...parseCronField('*', 0, 59)!].length).toBe(60);
    expect([...parseCronField('5', 0, 59)!]).toEqual([5]);
    expect([...parseCronField('1-4', 0, 59)!]).toEqual([1, 2, 3, 4]);
    expect([...parseCronField('*/15', 0, 59)!]).toEqual([0, 15, 30, 45]);
    expect([...parseCronField('0-30/10', 0, 59)!]).toEqual([0, 10, 20, 30]);
    expect([...parseCronField('12,0', 0, 23)!]).toEqual([12, 0]); // 启动日志里那个
  });

  it('非法输入返回 null (调用方据此降级)', () => {
    expect(parseCronField('60', 0, 59)).toBeNull();
    expect(parseCronField('-1', 0, 59)).toBeNull();
    expect(parseCronField('5-1', 0, 59)).toBeNull();
    expect(parseCronField('*/0', 0, 59)).toBeNull();
    expect(parseCronField('a', 0, 59)).toBeNull();
  });

  it('周日可写 7', () => {
    expect([...parseCronField('7', 0, 6, true)!]).toEqual([0]);
  });

  it('跨周日区间 0-7 / 1-7 / 5-7 必须展开成"整周/周一到周日/周五六日"', () => {
    // 旧实现把 hi=7 折成 0: 0-7 塌成 {0} (只剩周日), 1-7 直接判非法
    expect([...parseCronField('0-7', 0, 6, true)!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...parseCronField('1-7', 0, 6, true)!].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect([...parseCronField('5-7', 0, 6, true)!].sort((a, b) => a - b)).toEqual([0, 5, 6]);
    expect([...parseCronField('0-7/2', 0, 6, true)!].sort((a, b) => a - b)).toEqual([0, 2, 4, 6]);
  });
});

describe('cron-parse: 整条表达式', () => {
  it('5 段必须齐', () => {
    expect(parseCron('0 2 * * *')).not.toBeNull();
    expect(parseCron('0 2 * *')).toBeNull();
    expect(parseCron('0 2 * * * *')).toBeNull();
    expect(parseCron('')).toBeNull();
  });

  it('启动日志里报错的那条现在能解析', () => {
    const f = parseCron('0 12,0 * * *');
    expect(f).not.toBeNull();
    expect([...f!.hour].sort((a, b) => a - b)).toEqual([0, 12]);
    expect([...f!.minute]).toEqual([0]);
  });
});

describe('cron-parse: 时间匹配', () => {
  it('0 2 * * * → 只在 02:00 命中', () => {
    const f = parseCron('0 2 * * *')!;
    expect(cronMatches(f, at(2, 0))).toBe(true);
    expect(cronMatches(f, at(2, 1))).toBe(false);
    expect(cronMatches(f, at(3, 0))).toBe(false);
  });

  it('0 12,0 * * * → 00:00 与 12:00 都命中', () => {
    const f = parseCron('0 12,0 * * *')!;
    expect(cronMatches(f, at(0, 0))).toBe(true);
    expect(cronMatches(f, at(12, 0))).toBe(true);
    expect(cronMatches(f, at(6, 0))).toBe(false);
  });

  it('*/30 * * * * → 每 30 分钟', () => {
    const f = parseCron('*/30 * * * *')!;
    expect(cronMatches(f, at(1, 0))).toBe(true);
    expect(cronMatches(f, at(1, 30))).toBe(true);
    expect(cronMatches(f, at(1, 15))).toBe(false);
  });

  it('0 9 * * 1 → 周一 09:00 (2026-10-19 是周一)', () => {
    const f = parseCron('0 9 * * 1')!;
    expect(cronMatches(f, new Date(2026, 9, 19, 9, 0))).toBe(true);  // 周一
    expect(cronMatches(f, new Date(2026, 9, 19, 10, 0))).toBe(false);
    expect(cronMatches(f, new Date(2026, 9, 20, 9, 0))).toBe(false); // 周二
  });

  it('0 0 1 * * → 每月 1 号 00:00', () => {
    const f = parseCron('0 0 1 * *')!;
    expect(cronMatches(f, new Date(2026, 9, 1, 0, 0))).toBe(true);
    expect(cronMatches(f, new Date(2026, 9, 2, 0, 0))).toBe(false);
  });
});

describe('cron-parse: 兼容旧写法', () => {
  it('`*/N` 用 cron 匹配就能算出来 (无需特判遗留接口)', () => {
    const f = parseCron('*/6 * * * *')!;
    expect(cronMatches(f, at(0, 0))).toBe(true);
    expect(cronMatches(f, at(0, 6))).toBe(true);
    expect(cronMatches(f, at(0, 5))).toBe(false);
  });
});
