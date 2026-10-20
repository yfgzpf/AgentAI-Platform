/**
 * 「重进页面恢复后台进度」回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 富哥实锤: "如果在任务过程中用户误退出页面再进去, 后台在跑前端就没有接收了"。
 *
 * 根因链:
 *   ① 前端 subagents 是组件级 useState, 挂载即为空 → 轮询通道启动条件不满足 →
 *      后台在跑的子智能体对用户完全隐形 (人走开=失明)
 *   ② 唤醒检查只挂在 SSE/轮询上 → 页面不打开就永远不触发 → 跑完也白发
 *   ③ 网关重启后磁盘上 status=running 的产物是僵尸 (子智能体是进程内 Promise,
 *      重启即蒸发) → 不识别的话前端永远转圈, "全部完成"永远不成立
 *
 * 本测试锁死:
 *   · 路由 / 的 alive 字段 (僵尸识别)
 *   · ChatView 挂载发现 effect (认领本会话产物 + 15 分钟窗内自动唤醒 + abortRef 防重入)
 *   · 轮询合并与产物面板的僵尸收敛
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { createSubagentArtifactsRouter } = await import('./routes/subagent-artifacts.js');
const { saveArtifact } = await import('./subagent-artifacts.js');
const { registerSubagent, completeSubagent, listSubagents } = await import('./subagent-registry.js');

let WS = '';
let server: http.Server | null = null;
let baseUrl = '';

beforeEach(async () => {
  WS = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-reentry-'));
  const app = express();
  app.use('/api/subagent-artifacts', createSubagentArtifactsRouter());
  server = http.createServer(app);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});
afterEach(async () => {
  for (const r of listSubagents()) {
    if (r.workspace === WS) completeSubagent(r.id, 'error', { error: 'test-cleanup' });
  }
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* ignore */ }
});

const getList = async () => {
  const res = await fetch(`${baseUrl}/api/subagent-artifacts?workspace=${encodeURIComponent(WS)}`);
  return (await res.json()) as any;
};

/** saveArtifact 是单对象签名 (workspace 在 artifact 里), 不是 (ws, art) */
const mk = (over: Record<string, any>) => saveArtifact({
  type: 'explore', task: 't', status: 'running', transcript: [], toolCalls: 0,
  workspace: WS, startedAt: Date.now(), updatedAt: Date.now(),
  ...over,
} as any);

describe('路由 alive 字段: 僵尸识别 (网关重启后磁盘 running 已死)', () => {
  it('磁盘 running + 注册表无记录 → alive:false (僵尸)', async () => {
    mk({ id: 'zombie-1', status: 'running' });
    const data = await getList();
    const a = data.artifacts.find((x: any) => x.id === 'zombie-1');
    expect(a.status).toBe('running');
    expect(a.alive).toBe(false);
  });

  it('注册表有 running 记录 → alive:true (真在跑)', async () => {
    registerSubagent({ id: 'live-1', parentSessionId: 's1', workspace: WS, status: 'running' });
    const data = await getList();
    const a = data.artifacts.find((x: any) => x.id === 'live-1');
    expect(a.alive).toBe(true);
  });

  it('done/error 产物 → alive:true (终态无僵尸概念, 不影响"全部完成"判定)', async () => {
    mk({ id: 'done-1', status: 'done', result: 'R' });
    const data = await getList();
    const a = data.artifacts.find((x: any) => x.id === 'done-1');
    expect(a.alive).toBe(true);
  });

  it('磁盘 running + 注册表已终态 → alive:false (注册表是活性真源)', async () => {
    registerSubagent({ id: 'race-1', parentSessionId: 's1', workspace: WS, status: 'running' });
    mk({ id: 'race-1', status: 'running' });
    completeSubagent('race-1', 'done', { result: 'R' });
    // 注册表说完成了 → 它就不再 alive (前端据此收敛终态 + 走唤醒, 不会永远转圈)。
    // 唤醒载荷走 finishedResultsForSession (注册表), 拿到的是 done 结果, 不受磁盘陈旧影响。
    const data = await getList();
    const a = data.artifacts.find((x: any) => x.id === 'race-1');
    expect(a.alive).toBe(false);
  });

  it('★ 防误判竞态: agentai-loop 内联 spawn 先 registerSubagent 后 saveArtifact', () => {
    // 若顺序颠倒 (先落盘 running 再注册), 轮询/发现在两者之间打到 → 活着的子任务被
    // 误判成僵尸 → 前端显示"已中断"并把唤醒触发链打断。
    const loopSrc = fs.readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
    const regIdx = loopSrc.indexOf('registerSubagent({');
    const saveIdx = loopSrc.indexOf('saveArtifact({');
    expect(regIdx).toBeGreaterThan(0);
    expect(saveIdx).toBeGreaterThan(regIdx);
  });
});

describe('ChatView 挂载发现 effect (人走开再回来, 后台进度必须可见)', () => {
  const cv = fs.readFileSync(path.resolve(__dirname, '../../agentai-gui/src/components/ChatView.tsx'), 'utf-8');

  it('有挂载发现 effect: 查 /api/subagent-artifacts 并按 parentSessionId 认领', () => {
    expect(cv).toContain('SUBAGENT_RESUME_WINDOW_MS = 15 * 60 * 1000');
    expect(cv).toContain('a.parentSessionId === activeId');
    // 发现逻辑与轮询通道分离 — 轮询靠 subagents 状态启动, 发现负责把状态灌进去
    const discoverBlock = cv.slice(cv.indexOf('认领本会话的后台子智能体'), cv.indexOf('认领本会话的后台子智能体') + 3000);
    expect(discoverBlock).toContain('setSubagents(prev =>');
    expect(discoverBlock).toContain('added.length > 0 ? [...prev, ...added] : prev');
  });

  it('★ 15 分钟窗内自动唤醒 (跨页面关闭仍有效, "跑完不能白发")', () => {
    expect(cv).toContain('Date.now() - newest > SUBAGENT_RESUME_WINDOW_MS');
    expect(cv).toContain('await triggerSubagentResume(merged, activeId)');
  });

  it('僵尸按 error 收敛 (网关重启后不能永远转圈)', () => {
    expect(cv).toContain("const zombie = a.status === 'running' && a.alive === false");
    expect(cv).toContain("zombie ? 'error' : a.status");
    expect(cv).toContain('后台子任务已不存在 (网关重启过), 按中断处理');
  });

  it('防重入: resumeTriggeredRef 去重 + 本页有活跃流不抢 (abortRef)', () => {
    const discoverBlock = cv.slice(cv.indexOf('认领本会话的后台子智能体'), cv.indexOf('认领本会话的后台子智能体') + 3000);
    expect(discoverBlock).toContain('resumeTriggeredRef.current.has(activeId)');
    expect(discoverBlock).toContain('if (abortRef.current) return');
  });

  it('轮询合并也用 alive 判定"全部完成" (僵尸算结束, 否则唤醒永远不触发)', () => {
    expect(cv).toContain("mine.every((a: any) => a.status !== 'running' || a.alive === false)");
  });
});

describe('产物面板的僵尸显示', () => {
  const panel = fs.readFileSync(path.resolve(__dirname, '../../agentai-gui/src/components/SubagentArtifactsPanel.tsx'), 'utf-8');

  it('接口有 alive 字段, 轮询条件排除僵尸 (否则永远 3s 轮询)', () => {
    expect(panel).toContain('alive?: boolean');
    expect(panel).toContain("a.status === 'running' && a.alive !== false");
  });

  it('僵尸行显示"已中断"而不是假装在跑', () => {
    expect(panel).toContain('const interrupted = a.status === \'running\' && a.alive === false');
    expect(panel).toContain("interrupted ? '已中断 (网关重启过, 子任务进程已不存在)'");
  });
});
