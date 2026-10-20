/**
 * 子智能体「失明」回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 实锤事故 (富哥报"子智能体根本就不动呀! 主任务一停它就停了"):
 *
 *   真相: 子智能体**一直在跑** (实测产物: 9 次工具调用 / 22 条 transcript 持续增长),
 *        是**前端失明**了 —— 主任务一停 → SSE res.end() 关闭 →
 *        后续 subagent:progress 全撞在已关闭连接上被丢弃 →
 *        前端 setSubagents 只在 SSE 事件里更新 → 画面永远卡住 → 用户以为它死了。
 *
 * 三个必须锁死的 bug:
 *   ① 前端无 SSE 无关的轮询通道 → 进度不可见
 *   ② 唤醒检查只挂在 SSE 的 onSubagentDone 上 → SSE 断了就永远不唤醒
 *   ③ 路由只传 checkpointSessionId 不传 sessionId → 产物 parentSessionId 为空
 *      → 前端按 parentSessionId 过滤永远匹配不上 → 唤醒**从设计上就触发不了**
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GUI = path.resolve(__dirname, '..');
const GW = path.resolve(GUI, '..', 'agentai-gateway');
const read = (p: string) => fs.readFileSync(p, 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const chatView = strip(read(path.join(GUI, 'src/components/ChatView.tsx')));
const chatRoute = strip(read(path.join(GW, 'src/routes/chat.ts')));

describe('① SSE 无关的轮询通道 (进度必须可见)', () => {
  it('存在轮询 effect: 从落盘产物读进度', () => {
    expect(chatView).toContain('/api/subagent-artifacts?workspace=');
    expect(chatView).toContain('setInterval(poll');
  });

  it('轮询把产物状态/过程合并进 subagents 状态', () => {
    // 合并 transcript (前端黑箱的数据来源)
    expect(chatView).toMatch(/setSubagents\(prev\s*=>/);
    expect(chatView).toContain('transcript: frontTr.length ? frontTr : sa.transcript');
    // 状态也要同步 (running → done/error)
    expect(chatView).toContain('status: effStatus as any');
    // 2026-10-21 僵尸收敛: alive=false 的 running 必须按 error 收敛,
    // 否则网关重启后它永远转圈、状态同步永远不成立
    expect(chatView).toContain("const zombie = a.status === 'running' && a.alive === false;");
  });

  it('★ 轮询在"有子智能体在跑"时才启动, 且 SSE 断了也继续 (不依赖 loading)', () => {
    expect(chatView).toContain("subagents.some(a => a.status === 'running')");
    // 关键: 轮询条件**不含** loading —— 主任务停了(loading=false)照样要轮询
    const pollBlock = chatView.slice(chatView.indexOf('setInterval(poll') - 3000, chatView.indexOf('setInterval(poll'));
    expect(pollBlock).not.toMatch(/if\s*\(\s*!loading\s*\)/);
  });

  it('轮询周期 2s (不至于打爆网关, 也不至于看着卡)', () => {
    expect(chatView).toContain('POLL_MS = 2000');
  });
});

describe('② 唤醒不能只依赖 SSE (SSE 断了也要能唤醒)', () => {
  it('★ 轮询路径也触发唤醒检查', () => {
    expect(chatView).toContain("await checkSubagentsFinished('poll')");
  });

  it('★ 轮询判定"全部完成"的条件正确 (没有 running 的)', () => {
    expect(chatView).toContain("mine.every((a: any) => a.status !== 'running' || a.alive === false)");
    // 2026-10-21: 条件收紧 — 僵尸 (alive=false 的 running) 也算"结束",
    // 否则网关重启后磁盘 running 产物会让"全部完成"永远不成立 → 永远不唤醒
    expect(chatView).toContain("a.alive === false");
  });

  it('产物归属过滤有兜底 (parentSessionId 为空的历史产物也能认领)', () => {
    // 精确匹配优先
    expect(chatView).toContain('a.parentSessionId === activeId');
    // 空 parentSessionId → 用本地已知子智能体 id 兜底认领
    expect(chatView).toContain("a.parentSessionId === '' && localIds.has(a.id)");
  });
});

describe('③ 后端必须把 sessionId 传给 loop (否则产物归属为空)', () => {
  it('★ chat 路由传了 sessionId (不只是 checkpointSessionId)', () => {
    expect(chatRoute).toContain('sessionId: requestSessionId');
  });

  it('★ 传 sessionId 的地方不能少于传 checkpointSessionId 的地方', () => {
    const cpCount = (chatRoute.match(/checkpointSessionId: requestSessionId/g) || []).length;
    const sidCount = (chatRoute.match(/sessionId: requestSessionId/g) || []).length;
    // 每个建 loop 的地方都要有 sessionId (checkpointSessionId 的字符串里含 "SessionId",
    // 但大小写不同, 不会误计)
    expect(sidCount).toBeGreaterThanOrEqual(cpCount);
    expect(sidCount).toBeGreaterThan(0);
  });

  it('产物用 opts.sessionId 做 parentSessionId (而不是 checkpointSessionId)', () => {
    const loop = strip(read(path.join(GW, 'src/agentai-loop.ts')));
    expect(loop).toContain('parentSessionId');
    expect(loop).toContain('this.opts.sessionId');
  });
});

describe('④ 回归: 子智能体确实不随父中断而中止', () => {
  const loop = strip(read(path.join(GW, 'src/agentai-loop.ts')));

  it('子循环构造不传 abortSignal (父死子不死)', () => {
    const idx = loop.indexOf('const subLoop = new AgentAILoop');
    expect(idx).toBeGreaterThan(-1);
    const block = loop.slice(idx, idx + 900);
    expect(block).not.toContain('abortSignal');
  });

  it('墙钟上限兜底 (不会跑飞)', () => {
    expect(loop).toContain('SUBAGENT_WALL_CLOCK_MS');
  });

  it('运行中就落盘一份产物 (进程被杀也知道有这么个子任务)', () => {
    expect(loop).toContain("status: 'running'");
    expect(loop).toContain('saveArtifact');
  });
});
