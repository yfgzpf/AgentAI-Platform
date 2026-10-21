/**
 * bgJobs jobId 查找归一化 + 运行中 job 不被驱逐 (2026-10-21, 富哥实锤事故)
 * ======================================================================
 * 事故现场 (富哥三张截图): wsl_exec 长任务自动转后台 → Job 49273264820 创建成功;
 *   模型轮询 wait_for_job/job_output × 6, 全部 0.0s 秒败 "Not found";
 *   前端还误挂 "⚠️ 工具 wait_for_job 疑似卡死 (3 次调用)" — 用户问"模型不行还是误报"。
 * 根因: bgJobs 是 Map<number>, 而模型从工具返回的**文本**里抄 jobId 时带引号
 *   (字符串) → 裸 bgJobs.get("49273264820") 必 Miss。**不是模型失败, 是框架假失败**。
 * 次因: _pruneBgJobs 文档说"只驱已退出的旧 job", 代码却连**运行中的**一起删 —
 *   长会话 (>20 个后台 job, wsl_exec 自动转后台后极易达到) 里最早的活任务
 *   (长扫描) 被静默踢出注册表 → 轮询/stop 同样 "Not found"。
 * 本文件锁死:
 *   ① string jobId 与 number jobId 查找结果一致 (归一化, 模型抄文本的形态)
 *   ② 无效/不存在 id → 诊断文案 (可能原因 + list_jobs/同步重跑的下一步)
 *   ③ stop_job 字符串 id 也能杀 (归一化覆盖全部 4 个 job 工具)
 *   ④ >20 job 时运行中的长任务不丢 (prune 保活)
 *   ⑤ 源码契约: 裸 get(args.jobId) 绝迹 + prune 跳过 running + list_jobs 带 cmd
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_SRC = readFileSync(path.resolve(__dirname, 'tools.ts'), 'utf-8');

let handlers: any;
beforeAll(async () => {
  handlers = (await import('./tools.ts')).EXTRA_HANDLERS;
});

/** 等 job 落定但**不调用读取类工具** — wait_for_job/job_output 会标记 readAt,
 *  那是"已消费"信号, 用它来等会让快照正确地把该 job 排除掉 (测试自己的坑)。 */
async function waitDoneNoRead(id: number, ms = 15000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const { getBgJobRecords } = await import('./tools.ts');
    const r = getBgJobRecords().find((x: any) => x.id === id);
    if (r && r.status !== 'running') return;
    await new Promise(res => setTimeout(res, 100));
  }
}

describe('bgJobs: jobId 查找归一化 (富哥实锤: 轮询 6 连败全是类型不匹配)', () => {
  it('① string jobId 与 number jobId 查找结果一致 (模型抄文本常带引号)', async () => {
    const start = await handlers.run_background({ command: 'node -e "process.stdout.write(\'HELLO-BGJOB\')"' });
    expect(start.success).toBe(true);
    const jobId: number = start.data.jobId;
    expect(typeof jobId).toBe('number');

    // 字符串 id 也要能等到 exit 并拿到最终输出 (归一化覆盖 wait_for_job)
    const done = await handlers.wait_for_job({ jobId: String(jobId), timeoutMs: 8000 });
    expect(done.success).toBe(true);
    expect(done.output).toContain('HELLO-BGJOB');

    // 退出后: 数字 / 字符串 / 带空格字符串 三种形态查找结果一致
    // (实时输出不在此断言范围 — D3 已有专项; 这里只证明"同一个 job 三种 id 都认")
    const asNum = await handlers.job_output({ jobId });
    const asStr = await handlers.job_output({ jobId: String(jobId) });
    const asSpaced = await handlers.job_output({ jobId: ` ${jobId} ` });
    expect(asNum.success).toBe(true);
    expect(asStr.success).toBe(true);
    expect(asSpaced.success).toBe(true);
    expect(asStr.output).toContain('HELLO-BGJOB');
    expect(asSpaced.output).toContain('HELLO-BGJOB');
  }, 20000);

  it('② 无效 id (非数字/空/null) → 诊断文案, 不崩溃不误报成功', async () => {
    for (const bad of ['abc', '', null, undefined, {}, 'Job 123']) {
      const r = await handlers.job_output({ jobId: bad });
      expect(r.success, `jobId=${JSON.stringify(bad)} 应失败`).toBe(false);
      expect(r.output).toContain('Not found');
      expect(r.output).toContain('list_jobs');     // 指引: 看现存 job
      expect(r.output).toContain('不要加引号');     // 指引: 类型纠正
      expect(r.output).toContain('反复重试');       // 告诫: 别对死 id 反复重试
    }
  });

  it('③ 语法合法但不存在的 id → 诊断文案说明三种可能 (已清理/重启/抄错)', async () => {
    const r = await handlers.job_output({ jobId: 999_999_999 });
    expect(r.success).toBe(false);
    expect(r.output).toContain('Not found');
    expect(r.output).toContain('网关重启');
    expect(r.output).toContain('已结束并被清理');
  });

  it('④ stop_job 字符串 id 也能杀 (归一化覆盖全部 4 个 job 工具)', async () => {
    const start = await handlers.run_background({
      command: 'node -e "setTimeout(()=>{}, 8000)"',
    });
    const jobId: number = start.data.jobId;
    const stopped = await handlers.stop_job({ jobId: String(jobId) });
    expect(stopped.success).toBe(true);
    // 杀完 → wait_for_job 应拿到"已结束" (字符串 id)
    const done = await handlers.wait_for_job({ jobId: String(jobId), timeoutMs: 3000 });
    expect(done.success).toBe(true);
  }, 20000);
});

describe('bgJobs: 运行中的 job 不被驱逐 (文档意图 vs 原实现的裂缝)', () => {
  it('⑤ >20 个 job 时, 运行中的长任务不丢 (原实现连运行中的一起删)', async () => {
    // 长任务 (活 ~6s): 最早的 job
    const long = await handlers.run_background({
      command: 'node -e "setTimeout(()=>{}, 6000)"',
    });
    const longId: number = long.data.jobId;
    // 20 个瞬间退出 job → 触发 prune (21 > BG_JOBS_KEEP=20)
    for (let i = 0; i < 20; i++) {
      const r = await handlers.run_background({ command: 'exit 0' });
      expect(r.success).toBe(true);
    }
    // 等快 job 全部退出 (不睡死) — 只剩长任务在跑
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const list = await handlers.list_jobs({});
      const running = String(list.output).split('\n').filter(l => l.includes('running=true')).length;
      if (running <= 1) break;
      await new Promise(r => setTimeout(r, 250));
    }
    // 核心断言: 最早的长任务仍在注册表且仍 running (字符串查找也要能认)
    const probe = await handlers.wait_for_job({ jobId: String(longId), timeoutMs: 300 });
    expect(probe.success, '长任务应仍在运行 (没被 prune 误删)').toBe(false);
    const out = await handlers.job_output({ jobId: String(longId) });
    expect(out.success, '长任务的 job_output 应能查到 (字符串 id)').toBe(true);
    // 清理: 杀进程树, 别留孤儿
    await handlers.stop_job({ jobId: String(longId) });
  }, 40000);
});

describe('源码契约: 归一化 + 诊断 + prune 保活都在位', () => {
  it('⑥ _lookupBgJob 单一真源, job 工具全走它, 裸 get(args.jobId) 绝迹', () => {
    expect(TOOLS_SRC).toContain('const _lookupBgJob =');
    expect(TOOLS_SRC).toMatch(/job_output: async \(args\) => \{ const \{ job: j(, id)? \} = _lookupBgJob\(args\.jobId\)/);
    expect(TOOLS_SRC).toMatch(/wait_for_job: async \(args\) => \{ const \{ job: j(, id)? \} = _lookupBgJob\(args\.jobId\)/);
    expect(TOOLS_SRC).toMatch(/stop_job: async \(args\) => \{ try \{ const \{ job: j(, id)? \} = _lookupBgJob\(args\.jobId\)/);
    // 裸 get 形态绝迹 (4 个处理器 region) — 这是本次事故的根因形态
    expect(TOOLS_SRC).not.toMatch(/bgJobs\.get\(args\.jobId\)/);
  });

  it('⑦ prune 跳过 running (文档意图落地: 只驱已退出的旧 job)', () => {
    expect(TOOLS_SRC).toContain('if (j && j.running) continue;');
  });

  it('⑧ list_jobs 带 cmd (模型能认出哪个 job 是哪个任务)', () => {
    expect(TOOLS_SRC).toMatch(/list_jobs: async \(\) => \(\{ success: true, output: \[\.\.\.bgJobs\.entries\(\)\]\.map\(\(\[id, j\]\) => `#\$\{id\}: running=\$\{j\.running\}\$\{j\.cmd/);
  });
});

describe('buildBgJobSnapshot: 跨回合注入快照 (富哥中断归因 #3: "继续"不继承 tool 队列)', () => {
  it('⑨ 真实 job 落盘后快照可见: 命令/状态/接管指引齐备; 未知工作区返回空串', async () => {
    const { buildBgJobSnapshot } = await import('./tools.ts');
    // 未知工作区 → 无记录 → 空串 (不产出噪音注入)
    expect(buildBgJobSnapshot('F:\\__no_such_ws__\\xyz')).toBe('');

    // 跑一个真实 job (带 workspace 语义由 handler 内部记录), 快照应捕获
    const start = await handlers.run_background({ command: 'node -e "process.stdout.write(\'SNAPSHOT-PROBE\')"' });
    expect(start.success).toBe(true);
    await waitDoneNoRead(start.data.jobId);

    // 全工作区视图 (undefined) 必须看到该 job 的终态行
    const snapAll = buildBgJobSnapshot('');
    expect(snapAll).toContain(`#${start.data.jobId}`);
    expect(snapAll).toContain('[done]');
    expect(snapAll).toContain('不要重跑');
    // 接管指引: running 用 wait_for_job/job_output
    expect(snapAll).toContain('wait_for_job');
  }, 20000);

  it('⑩ 源码契约: chat.ts 每轮请求注入快照 (不被 persistentMemory 分支遮蔽)', () => {
    const CHAT_SRC = readFileSync(path.resolve(__dirname, 'routes/chat.ts'), 'utf-8');
    expect(CHAT_SRC).toContain("import { buildBgJobSnapshot } from '../tools.js'");
    expect(CHAT_SRC).toMatch(/buildBgJobSnapshot\(workspace\)/);
    expect(CHAT_SRC).toMatch(/injectedCtx = \(injectedCtx \|\| ''\) \+ '\\n\\n' \+ bgSnap/);
  });
});

describe('完成结果"已消费"后不再推送/不再注入 (富哥: AI 都拿到了还推一遍)', () => {
  it('⑪ 完成后读过一次 → 快照不再包含该 job (不会下轮再注入)', async () => {
    const { buildBgJobSnapshot, isBgJobConsumed, getBgJobRecords } = await import('./tools.ts');
    const start = await handlers.run_background({ command: 'node -e "process.stdout.write(\'CONSUME-PROBE\')"' });
    const id = start.data.jobId;
    await waitDoneNoRead(id);

    // 第一轮: 完成但还没人读 → 快照必须包含 (保证 AI 能发现)
    expect(buildBgJobSnapshot('')).toContain(`#${id}`);

    // 模型读取 → 标记消费
    await handlers.job_output({ jobId: id });
    const rec = getBgJobRecords().find(r => r.id === id);
    expect(rec?.readAt, 'job_output 后必须写入 readAt').toBeTruthy();
    expect(isBgJobConsumed(rec!)).toBe(true);

    // 已消费 → 快照不再注入 (否则模型重复读、重复总结)
    expect(buildBgJobSnapshot('')).not.toContain(`#${id}`);
  }, 20000);

  it('⑫ 运行中读中间输出不算消费 — 完成后仍要通知一次', async () => {
    const { buildBgJobSnapshot, getBgJobRecords, isBgJobConsumed } = await import('./tools.ts');
    const start = await handlers.run_background({
      command: 'node -e "setTimeout(()=>process.stdout.write(\'LATE-DONE\'),2500)"',
    });
    const id = start.data.jobId;

    // 还在跑时读一次 (wait_for_job 超时返回) → readAt 有了, finishedAt 还没有
    await handlers.wait_for_job({ jobId: String(id), timeoutMs: 300 });
    // 等它自然结束 (期间**不再读取**)
    await new Promise(r => setTimeout(r, 4000));

    const rec = getBgJobRecords().find(r => r.id === id);
    expect(rec?.status).toBe('done');
    expect(rec?.readAt).toBeTruthy();
    expect(isBgJobConsumed(rec!), '运行中读的不算消费 (readAt < finishedAt)').toBe(false);
    // 完成后仍需进快照一次, 让 AI/用户知道最终结果
    expect(buildBgJobSnapshot('')).toContain(`#${id}`);
  }, 20000);

  it('⑬ 源码契约: 读取类工具都标记 readAt, 快照按消费状态过滤', () => {
    expect(TOOLS_SRC).toMatch(/job_output: async \(args\) => \{ const \{ job: j, id \} = _lookupBgJob/);
    expect(TOOLS_SRC).toMatch(/wait_for_job: async \(args\) => \{ const \{ job: j, id \} = _lookupBgJob/);
    expect(TOOLS_SRC).toContain('_markJobRead(id)');
    expect(TOOLS_SRC).toContain('export function isBgJobConsumed');
    expect(TOOLS_SRC).toMatch(/!isBgJobConsumed\(r\)/);
  });
});
