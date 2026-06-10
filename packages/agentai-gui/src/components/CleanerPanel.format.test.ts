import { describe, it, expect } from 'vitest';
import { formatRelative } from './CleanerPanel';

describe('formatRelative', () => {
  const NOW = 1_700_000_000_000;

  it('returns "未调度" for 0/NaN/undefined', () => {
    expect(formatRelative(0, NOW)).toBe('未调度');
    expect(formatRelative(NaN, NOW)).toBe('未调度');
  });

  it('returns "即将执行" for past timestamps', () => {
    expect(formatRelative(NOW - 1000, NOW)).toBe('即将执行');
    expect(formatRelative(NOW, NOW)).toBe('即将执行');
  });

  it('formats seconds (< 60s)', () => {
    expect(formatRelative(NOW + 5_000, NOW)).toBe('5 秒后');
    expect(formatRelative(NOW + 59_000, NOW)).toBe('59 秒后');
  });

  it('formats minutes (< 60min)', () => {
    expect(formatRelative(NOW + 60_000, NOW)).toBe('1 分钟后');
    expect(formatRelative(NOW + 5 * 60_000, NOW)).toBe('5 分钟后');
    expect(formatRelative(NOW + 59 * 60_000, NOW)).toBe('59 分钟后');
  });

  it('formats hours (< 24h)', () => {
    expect(formatRelative(NOW + 60 * 60_000, NOW)).toBe('1 小时后');
    expect(formatRelative(NOW + 5 * 60 * 60_000, NOW)).toBe('5 小时后');
    expect(formatRelative(NOW + 23 * 60 * 60_000, NOW)).toBe('23 小时后');
  });

  it('formats hours with minutes (e.g. 1h 30m)', () => {
    expect(formatRelative(NOW + (60 + 30) * 60_000, NOW)).toBe('1 小时 30 分后');
    expect(formatRelative(NOW + (5 * 60 + 15) * 60_000, NOW)).toBe('5 小时 15 分后');
  });

  it('formats days (>= 24h)', () => {
    expect(formatRelative(NOW + 24 * 60 * 60_000, NOW)).toBe('1 天后');
    expect(formatRelative(NOW + 7 * 24 * 60 * 60_000, NOW)).toBe('7 天后');
  });
});
