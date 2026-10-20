/**
 * wsl-runtime 回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 富哥实锤: wsl_exec 报 `Command failed: wsl -u root -d kali-linux -- bash -lc ...`
 * (非零退出 + 无输出)。两个假设按概率: ① PATH 无 wsl.exe; ② -u root 未启用。
 * 本测试锁死 wsl-runtime 对两个假设的根治行为:
 *   · 绝对路径解析 (win32 且 System32\wsl.exe 存在 → 返回绝对路径)
 *   · 静默失败 (非零+无输出) + 指定 user → 自动回退默认用户重试一次
 *   · 有输出的失败 = 命令自己跑过 → 不重试 (不放大命令层噪音)
 *   · spawn 错误 (ENOENT) → 不重试 (换用户无解)
 *   · argv 数组化 (user 在前, -d distro -- command args)
 *   · 失败诊断带 exe 路径 / exit code / 回退标记
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import { wslRun, resolveWslExe, formatWslFailure } from './wsl-runtime.js';

/** 脚本化 execFile: 按调用次序返回预设行为 */
type Behavior =
  | { kind: 'ok'; stdout?: string; stderr?: string }
  | { kind: 'silentFail'; code?: number }
  | { kind: 'noisyFail'; code?: number; stdout?: string; stderr?: string }
  | { kind: 'enoent' }
  | { kind: 'timeout' };

function script(...behaviors: Behavior[]) {
  let i = 0;
  execFileMock.mockImplementation((_exe: string, _argv: string[], _opts: any, cb: any) => {
    const b = behaviors[Math.min(i++, behaviors.length - 1)];
    setImmediate(() => {
      if (b.kind === 'ok') cb(null, b.stdout ?? '', b.stderr ?? '');
      else if (b.kind === 'silentFail') cb(Object.assign(new Error('Command failed: wsl ...'), { code: b.code ?? 1 }), '', '');
      else if (b.kind === 'noisyFail') cb(Object.assign(new Error('Command failed: wsl ...'), { code: b.code ?? 1 }), b.stdout ?? '', b.stderr ?? '');
      else if (b.kind === 'enoent') cb(Object.assign(new Error('spawn wsl ENOENT'), { code: 'ENOENT' }), '', '');
      else cb(Object.assign(new Error('Command failed: wsl ...'), { killed: true, code: 'ETIMEDOUT' }), '', '');
    });
    return { pid: 1234, on: () => {} };
  });
}

beforeEach(() => { execFileMock.mockReset(); });

describe('resolveWslExe: 绝对路径解析 (假设 ①)', () => {
  it('win32 且 System32\wsl.exe 存在 → 返回绝对路径', () => {
    const exe = resolveWslExe();
    if (process.platform === 'win32') {
      // 本机实测存在; 若被测环境没有, 退化为裸 'wsl' 也合法 (交给 PATH)
      expect(exe === 'wsl' || /^[A-Za-z]:\\/.test(exe)).toBe(true);
      if (exe !== 'wsl') expect(exe.replace(/\//g, '\\')).toMatch(/System32\\wsl\.exe$/);
    } else {
      expect(exe).toBe('wsl');
    }
  });
});

describe('wslRun: argv 数组化 (不经 cmd.exe)', () => {
  it('指定 user → -u 在最前', async () => {
    script({ kind: 'ok', stdout: 'ok\n' });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'echo hi'], distro: 'kali-linux', user: 'root' });
    const [exe, argv] = execFileMock.mock.calls[0];
    expect(argv).toEqual(['-u', 'root', '-d', 'kali-linux', '--', 'bash', '-lc', 'echo hi']);
    expect(exe).toBe(resolveWslExe());
    expect(r.ok).toBe(true);
    expect(r.usedUser).toBe('root');
    expect(r.fellBack).toBe(false);
    expect(r.stdout).toBe('ok\n');
  });

  it('user 为空 → 不带 -u', async () => {
    script({ kind: 'ok' });
    await wslRun({ command: 'echo', args: ['hi'] });
    const [, argv] = execFileMock.mock.calls[0];
    expect(argv).toEqual(['-d', 'kali-linux', '--', 'echo', 'hi']);
  });
});

describe('wslRun: 静默失败自动回退默认用户 (假设 ②)', () => {
  it('首次静默非零 + 指定 root → 用默认用户重试并成功', async () => {
    script({ kind: 'silentFail', code: 1 }, { kind: 'ok', stdout: 'hello\n' });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'echo hello'], user: 'root' });
    expect(execFileMock).toHaveBeenCalledTimes(2);
    // 第二次调用不带 -u
    const [, argv2] = execFileMock.mock.calls[1];
    expect(argv2).not.toContain('-u');
    expect(r.ok).toBe(true);
    expect(r.fellBack).toBe(true);
    expect(r.usedUser).toBe('');
    expect(r.firstExitCode).toBe(1);
  });

  it('两次都失败 → fellBack 标记 + 保留首次 exit code', async () => {
    script({ kind: 'silentFail', code: 4294967295 }, { kind: 'silentFail', code: 1 });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'x'], user: 'root' });
    expect(r.ok).toBe(false);
    expect(r.fellBack).toBe(true);
    expect(r.firstExitCode).toBe(4294967295);
    expect(r.exitCode).toBe(1);
    const diag = formatWslFailure(r, 'kali-linux');
    expect(diag).toContain('已自动回退默认用户重试');
    expect(diag).toContain('4294967295');
  });

  it('未指定 user 的静默失败 → 不重试 (没有可回退的用户)', async () => {
    script({ kind: 'silentFail', code: 1 });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'x'] });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(r.fellBack).toBe(false);
  });
});

describe('wslRun: 有输出的失败不重试 (命令层噪音不放大)', () => {
  it('exit 1 + stderr 有内容 → 只跑一次, 不带回退', async () => {
    script({ kind: 'noisyFail', code: 1, stderr: 'bash: foo: command not found\n' });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'foo'], user: 'root' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.fellBack).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('command not found');
  });

  it('exit 1 + stdout 有内容 (扫描器无发现) → 放行给调用方判', async () => {
    script({ kind: 'noisyFail', code: 1, stdout: '0 results\n' });
    const r = await wslRun({ command: 'ffuf', args: ['-w', 'x'], user: 'root' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('0 results\n'); // 调用方按 nonzeroExitVerdict 放行
  });
});

describe('wslRun: spawn 错误不重试 (换用户无解)', () => {
  it('ENOENT → 一次调用, spawnError 落诊断', async () => {
    script({ kind: 'enoent' });
    const r = await wslRun({ command: 'bash', args: ['-lc', 'x'], user: 'root' });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(r.spawnError).toContain('ENOENT');
    expect(r.exitCode).toBeNull();
    const diag = formatWslFailure(r, 'kali-linux');
    expect(diag).toContain('spawn 错误');
    expect(diag).toContain(resolveWslExe());
  });
});

describe('wslRun: 超时标记', () => {
  it('killed/ETIMEDOUT → timedOut=true', async () => {
    script({ kind: 'timeout' });
    const r = await wslRun({ command: 'go', args: ['install', 'x'], user: 'root', timeout: 1000 });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });
});
