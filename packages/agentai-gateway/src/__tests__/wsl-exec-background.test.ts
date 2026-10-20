/**
 * wsl_exec: 长任务自动转后台 (2026-10-21 午后)
 * ----------------------------------------------------------------
 * 富哥实锤事故 (网关日志 19:09-19:10 UTC):
 *   wsl_exec duration=300038ms success=false — recon2.sh 跑满 300 秒被超时杀,
 *   **期间主循环一步都动不了** → SSE 5 分钟无事件 → 前端看着像卡死
 *   ("子智能体就不动一样")。
 *   且日志 STDOUT 有 "== full 59 aliv" (扫描输出) → **spawn 完全正常**,
 *   `-u root` 能用、绝对路径也没事 — 真凶是第三个: 长任务同步阻塞。
 *
 * 修法: 脚本执行 (bash xxx.sh) / 扫描器类命令 → 默认转后台,
 *   立即返回 jobId (bgJobs 同款形态), AI 用 job_output/wait_for_job 轮询。
 *   background:false 可强制同步 (which/ls 这类秒回命令)。
 *   spawn 同步抛错 (沙箱拦截/EMFILE) → 落回同步路径, 不假报失败。
 *
 * 本文件 mock 掉 spawn (沙箱拦 wsl.exe, 且行为测试不该依赖真发行版),
 * execFile 保持真实 (同步路径的测试走真失败诊断)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

const { EXTRA_HANDLERS, EXTRA_TOOLS } = await import('../tools.js');
import * as fs from 'node:fs';
import * as path from 'node:path';

const toolsSrc = fs.readFileSync(path.resolve(__dirname, '../tools.ts'), 'utf-8');

function fakeChild(): any {
  const ee: any = new EventEmitter();
  ee.pid = 424242;
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  return ee;
}

beforeEach(() => { spawnMock.mockReset(); spawnMock.mockImplementation(() => fakeChild()); });

describe('wsl_exec: 长任务自动转后台 (治主循环被同步阻塞)', () => {
  it('脚本形态 (bash xxx.sh) → 立即返回 jobId, 不阻塞主循环', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'bash', args: ['/mnt/f/挖洞赏金/output/jxnu/recon2.sh'] });
    expect(r.success).toBe(true);
    const out = String(r.output);
    expect(out).toContain('后台');
    expect(out).toContain('job_output');
    expect(out).toContain('别再对同一任务重复发起');
    expect(r.data?.background).toBe(true);
    expect(typeof r.data?.jobId).toBe('number');
    // spawn 参数必须数组化 + 绝对路径 (与 wsl-runtime 同一真源)
    const [exe, argv] = spawnMock.mock.calls[0];
    expect(String(exe)).toMatch(/wsl\.exe|wsl/);
    expect(argv).toEqual(['-u', 'root', '-d', 'kali-linux', '--', 'bash', '/mnt/f/挖洞赏金/output/jxnu/recon2.sh']);
  });

  it('扫描器形态 (nmap) → 同样转后台', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'nmap', args: ['-sV', '--top-ports', '100', '127.0.0.1'] });
    expect(r.success).toBe(true);
    expect(r.data?.background).toBe(true);
  });

  it('background:false → 强制同步 (脚本形态也不转)', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'bash', args: ['-c', 'echo hi'], background: false, timeout_ms: 8000 });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(r.data?.background).toBeUndefined();
  });

  it('短命令 (which) → 同步路径, 不误转后台', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'which', args: ['go'], timeout_ms: 8000 });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(r.data?.background).toBeUndefined();
  });

  it('转后台的任务进 bgJobs — job_output/list_jobs 原样兼容 + 实时输出 (D3 不回归)', async () => {
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'nuclei', args: ['-u', 'http://127.0.0.1', '-silent'] });
    const jobId = r.data?.jobId as number;
    expect(typeof jobId).toBe('number');
    const listed = await EXTRA_HANDLERS.list_jobs({});
    expect(String(listed.output)).toContain(`#${jobId}`);
    // 模拟实时输出 + 退出 — job.output 必须同步拿到 (D3: exit 才赋值 = 前 N 分钟轮询全空)
    const child = spawnMock.mock.results[0].value;
    child.stdout.emit('data', Buffer.from('[INF] Template loaded\n'));
    const mid = await EXTRA_HANDLERS.job_output({ jobId });
    expect(mid.success).toBe(true);
    expect(String(mid.output)).toContain('Template loaded');
    child.emit('exit', 0);
    const fin = await EXTRA_HANDLERS.wait_for_job({ jobId, timeoutMs: 1000 });
    expect(fin.success).toBe(true); // 已退出
    expect(String(fin.output)).toContain('Template loaded');
  });

  it('spawn 同步抛错 (沙箱拦截/EMFILE) → 落回同步路径, 不假报失败也不留半死 job', async () => {
    spawnMock.mockImplementationOnce(() => { throw new Error('blocked by policy'); });
    const r = await EXTRA_HANDLERS.wsl_exec({ command: 'bash', args: ['-c', 'echo hi'], timeout_ms: 8000 });
    expect(r.data?.background).toBeUndefined();
    expect(typeof r.data?.jobId).not.toBe('number');
  });

  it('源码断言: 识别表覆盖 bash/sh/python + 主流扫描器', () => {
    expect(toolsSrc).toContain('scriptLike');
    expect(toolsSrc).toMatch(/nuclei\|nmap\|ffuf/);
    expect(toolsSrc).toMatch(/bash\|sh\|zsh\|fish\|python3\?/);
    expect(toolsSrc).toMatch(/\\\.\(sh\|py\|pl\|rb\)/);
  });

  it('源码断言: spawn error 必须收敛 running (同 run_background D3 教训)', () => {
    // spawn 失败只发 'error' 不发 'exit' → 不收敛则 wait_for_job 等满超时只拿到空
    expect(toolsSrc).toContain("child.on('error'");
    expect(toolsSrc).toContain('j.running = false');
  });

  it('声明文档教 AI 轮询三件套 + 别重复发起 (否则它会反复重开同一任务)', () => {
    const decl = EXTRA_TOOLS.find((t: any) => t.name === 'wsl_exec') as any;
    expect(decl.description).toContain('job_output');
    expect(decl.description).toContain('wait_for_job');
    expect(decl.description).toContain('stop_job');
    expect(decl.description).toContain('background');
  });
});
