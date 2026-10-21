import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nonzeroExitVerdict, EXTRA_HANDLERS } from './tools.js';

/**
 * 工具结果误报专项 (2026-10-20, 富哥实机反馈: "工具结果误报导致很多工具失败,
 * http_replay / run_command 最多")
 *
 * 误报根因: 原实现把「退出码非 0」一律当工具失败。但退出码语义因工具而异:
 *   grep 无匹配=1 / test·diff 判假=1 / nmap 主机不可达=1 /
 *   ffuf·httpx 无发现=1 / sqlmap 无可利用=1 / wsl 内 exit 1 → wsl.exe 也透传 1
 * 这些场景 stdout 里全是有效结果, 却回给 AI 一个 "Error: exit code 1" —
 * AI 反复重试或绕道写脚本, 任务被"假失败"拖死。
 */
describe('nonzeroExitVerdict — 非零退出码判定', () => {
  it('非零退出码 + 有 stdout → 放行 (前缀说明退出码语义)', () => {
    const v = nonzeroExitVerdict(1, 'Target: 10.0.0.1\nPORT 80 open', '');
    expect(v.success).toBe(true);
    expect(v.prefix).toContain('退出码 1');
    expect(v.prefix).toContain('无结果/布尔假');
    expect(v.prefix).toContain('不要仅凭退出码就原样重试');
  });

  it('stderr 有内容也算「有输出」 (nmap 的警告走 stderr)', () => {
    const v = nonzeroExitVerdict(1, '', 'WARNING: RST from 10.0.0.1');
    expect(v.success).toBe(true);
  });

  it('无任何输出 → 才判真失败', () => {
    const v = nonzeroExitVerdict(1, '', '   \n  ');
    expect(v.success).toBe(false);
    expect(v.prefix).toBe('');
  });

  it('退出码 0 的场景不会走到这里 (语义保持: code 0 由调用方直接 resolve)', () => {
    // 判据本身对 0 无话可说; 调用方 (close handler) 只在 code !== 0 时求助本函数
    const v = nonzeroExitVerdict(0, '', '');
    expect(v.success).toBe(false);
  });
});

const TOOLS_SRC = readFileSync(new URL('./tools.ts', import.meta.url), 'utf-8');

describe('命令类工具的退出码语义接线 (源码契约)', () => {
  it('D1: run_command close handler 用 nonzeroExitVerdict, 不再一律 reject', () => {
    expect(TOOLS_SRC).toMatch(/if \(code !== 0\) \{[\s\S]{0,400}?nonzeroExitVerdict\(code, stdout, stderr\)/);
    // 原裸判形态必须绝迹
    expect(TOOLS_SRC).not.toMatch(/if \(code !== 0\) \{\s*\n\s*const e: any = new Error\(`exit code/);
  });

  it('D2: wsl_exec 只对「数字退出码 + 有输出」放行, ENOENT/ETIMEDOUT 仍走 catch', () => {
    expect(TOOLS_SRC).toMatch(/typeof err\.code === 'number'[\s\S]{0,220}?nonzeroExitVerdict\(err\.code/);
    // wsl_exec 与 wsl_scan 两处都要接 (定义 1 次 + 调用 3 次 = 4)
    const calls = (TOOLS_SRC.match(/nonzeroExitVerdict\(/g) || []).length;
    expect(calls, '四处: 函数定义 + run_command + wsl_exec + wsl_scan').toBe(4);
  });

  it('D3: wsl_scan 同样接 nonzeroExitVerdict (nuclei 无发现 exit 1 是常态)', () => {
    // wsl_scan 的 execFile callback 内必须有数字退出码判定
    expect(TOOLS_SRC).toMatch(/clearTimeout\(timer\);\s*\n\s*if \(err\) \{[\s\S]{0,400}?typeof err\.code === 'number'/);
  });

  it('D4: http_replay catch 有分类可行动指引 (超时/拒连/TLS/DNS/授权), 不再裸抛 message', () => {
    const idx = TOOLS_SRC.indexOf('http_replay: async');
    expect(idx).toBeGreaterThan(-1);
    const chunk = TOOLS_SRC.slice(idx, idx + 8000);
    expect(chunk).toMatch(/请求超时 — 目标响应慢或被 WAF 挂起/);
    expect(chunk).toMatch(/连接被拒绝 — 端口未监听或服务已下线/);
    expect(chunk).toMatch(/TLS 证书问题/);
    expect(chunk).toMatch(/DNS 解析失败/);
    expect(chunk).toMatch(/别原样重试同一请求/);
    // 旧的裸抛形态绝迹
    expect(chunk).not.toMatch(/\} catch \(e: any\) \{ return \{ success: false, output: `http_replay 失败: \$\{e\.message\}` \}; \}/);
  });
});

/**
 * 后台任务 (run_background / job_output / wait_for_job) — 2026-10-20 D3/D4
 * =====================================================================
 * D3 事故: bgJobs.set(id,{running:true,output:''}) 后 stdout 只进局部变量,
 *   exit 时才赋值 → 运行中 job_output 永远拿到空 → AI 以为卡死就杀进程重跑
 *   (长任务监控主力通道实质残缺); spawn 失败只发 'error' 不发 'exit' →
 *   running 永 true → wait_for_job 等满超时只拿到「失败+空输出」。
 * D4 事故: jobIdCounter 模块级从 0 起, 网关重启后 id 重发 → 旧「Job 7」撞上
 *   新 job 7, job_output(7) 串台; 且旧进程 spawn 的子进程成孤儿, 渗透扫描
 *   脱离管控继续打目标。
 */
describe('run_background / job_output / wait_for_job (2026-10-20 D3/D4)', () => {
  const handlers: any = EXTRA_HANDLERS;

  it('D3: 运行中的 job 也能读到实时输出 (不等 exit)', async () => {
    // 每 200ms 出一个 TICK, 活 12 秒 (60 个) — 读取点 (~1.3s) 远早于退出点,
    // 保证读到时 job 必在运行中, 证明的是「实时」而不是 exit 快照。
    // 全量套件并行下 node 冷启可能数秒: 轮询 + 2 tick 即断, 不赌固定睡眠。
    // 清理用 stop_job (杀进程树秒回) — 不用 wait_for_job 等 12s 自然退出
    // (那会顶爆 testTimeout; 此坑本测试亲自踩过: 10026ms timeout)。
    const start = await handlers.run_background({
      command: 'node -e "let i=0; const t=setInterval(()=>{process.stdout.write(\'TICK\'+i+\' \'); if(++i>=60) clearInterval(t);}, 200)"',
    });
    expect(start.success).toBe(true);
    const jobId = start.data.jobId;
    expect(typeof jobId).toBe('number');
    let ticks = 0;
    let mid: any = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 250));
      mid = await handlers.job_output({ jobId });
      ticks = (mid.output.match(/TICK/g) || []).length;
      if (ticks >= 2) break;
    }
    expect(mid?.success).toBe(true);
    // 至少 2 个 tick — 证明「运行中实时可读」, 不是 exit 时的快照
    expect(ticks, `output=${JSON.stringify((mid?.output || '').slice(0, 80))}`).toBeGreaterThanOrEqual(2);
    // 收尾: 杀进程树, 别留孤儿 (不等 12s 自然退出)
    await handlers.stop_job({ jobId });
  }, 25_000);

  it('D3: wait_for_job 能等到 exit 并拿到最终输出', async () => {
    const start = await handlers.run_background({
      command: 'node -e "process.stdout.write(\'A\'); setTimeout(()=>process.stdout.write(\'B\'), 200)"',
    });
    const jobId = start.data.jobId;
    const done = await handlers.wait_for_job({ jobId, timeoutMs: 5000 });
    expect(done.success).toBe(true);          // 已结束
    expect(done.output).toContain('A');
    expect(done.output).toContain('B');       // exit 前的尾部输出也在
  });

  it('D3: spawn 失败 (命令不存在) → running 即止, 不卡死', async () => {
    const start = await handlers.run_background({
      command: 'agentai_no_such_cmd_xyz --version',
    });
    expect(start.success).toBe(true);         // spawn 调用本身成功 (shell 包装)
    const jobId = start.data.jobId;
    const done = await handlers.wait_for_job({ jobId, timeoutMs: 5000 });
    // 命令不存在 → shell 立即退出; 关键是不再"永远 running"
    expect(done.success).toBe(true);
  });

  it('D4: jobId 带进程时间戳基底 (重启后不可能从 1 重发 → 不撞号)', async () => {
    const start = await handlers.run_background({ command: 'node -e "setTimeout(()=>{},100)"' });
    const jobId = start.data.jobId;
    // JOB_ID_BASE = (Date.now()%1e8)*1000 + rand(0..999) → 至少千万级, 远离 1
    expect(jobId).toBeGreaterThan(1_000_000);
    await handlers.wait_for_job({ jobId, timeoutMs: 3000 });
  });

  it('job_output 对不存在的 jobId 返回失败而非崩溃 (2026-10-21: 诊断文案取代裸 Not found)', async () => {
    const r = await handlers.job_output({ jobId: 999_999_999 });
    expect(r.success).toBe(false);
    // 2026-10-21: 裸 'Not found' 让模型对死 id 反复重试 (富哥实锤: 轮询 6 连败
    //   0.0s 秒败, 前端还误挂"疑似卡死") — 改为可行动诊断 (可能原因 + 下一步)。
    expect(r.output).toContain('Not found');
    expect(r.output).toContain('list_jobs');
    expect(r.output).toContain('不要加引号');
  });

  it('源码契约: 实时 output / 上限 / 退出清理 / error handler 全部在位', () => {
    expect(TOOLS_SRC).toContain('const BG_JOB_OUTPUT_MAX = 200_000;');
    expect(TOOLS_SRC).toMatch(/job\.output = output;/);                       // 实时更新
    expect(TOOLS_SRC).toMatch(/output\.length > BG_JOB_OUTPUT_MAX\) output = output\.slice\(-BG_JOB_OUTPUT_MAX\)/);
    expect(TOOLS_SRC).toContain('const JOB_ID_BASE = (Date.now() % 100_000_000) * 1000');
    expect(TOOLS_SRC).toMatch(/process\.on\('exit', \(\) => \{/);             // 退出杀进程树
    expect(TOOLS_SRC).toContain('taskkill /PID ${j.pid} /T /F');
    expect(TOOLS_SRC).toMatch(/child\.on\('error'/);                          // spawn 失败不卡死
    // 原"exit 时才赋值"形态绝迹: bgJobs.set 里不允许再出现 output: ''
    expect(TOOLS_SRC).not.toMatch(/bgJobs\.set\(id, \{ pid: child\.pid, running: true, output: '' \}\)/);
  });
});
