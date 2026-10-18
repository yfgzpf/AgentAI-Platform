import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rotateLogs, startLogRotation } from '../log-rotate.js';

const MAX = 50 * 1024 * 1024;   // 与实现同值
const HARD = 200 * 1024 * 1024;

describe('log-rotate: 2026-10-19 修"文件名+目录双重不匹配"', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logrot-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it('清理名单含真实文件名 gateway-crash.log (原来误写 crash.log)', () => {
    const f = path.join(dir, 'gateway-crash.log');
    // 造一个超过轮转阈值的稀疏文件 (60MB, 不占实际磁盘)
    const fd = fs.openSync(f, 'w');
    fs.ftruncateSync(fd, MAX + 1024);
    fs.closeSync(fd);

    rotateLogs(dir);

    // 应被轮转成 .1
    expect(fs.existsSync(`${f}.1`)).toBe(true);
  });

  it('超过硬上限 → 只保留尾部 (不再无限膨胀)', () => {
    const f = path.join(dir, 'gateway-crash.log');
    const fd = fs.openSync(f, 'w');
    fs.ftruncateSync(fd, HARD + 1024);
    fs.closeSync(fd);

    rotateLogs(dir);

    const size = fs.statSync(f).size;
    expect(size).toBeLessThanOrEqual(10 * 1024 * 1024 + 1024);
  });

  it('未超阈值 → 不动它 (避免无意义写盘)', () => {
    const f = path.join(dir, 'gateway-crash.log');
    fs.writeFileSync(f, 'small log');
    rotateLogs(dir);
    expect(fs.existsSync(f)).toBe(true);
    expect(fs.existsSync(`${f}.1`)).toBe(false);
  });

  it('startLogRotation 接受多目录 (包目录 + ~/.agentai)', () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'logrot2-'));
    try {
      // 旧签名 (string) 不能崩
      expect(() => startLogRotation(dir)).not.toThrow();
      expect(() => startLogRotation([dir, d2])).not.toThrow();
    } finally {
      fs.rmSync(d2, { recursive: true, force: true });
    }
  });

  it('目录不存在时不抛 (best-effort)', () => {
    expect(() => rotateLogs(path.join(dir, 'nope-does-not-exist'))).not.toThrow();
  });
});