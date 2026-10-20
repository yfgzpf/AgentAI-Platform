/**
 * 子智能体「独立任务单元」回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 覆盖两件事:
 *  ① 产物落盘: 完成/失败的子任务必须**独立于主循环存活**地落盘, 且含完整 transcript
 *  ② 注册表: 网关知道"还有子任务在跑" → 支撑"等全部完成后一次性唤醒"
 *
 * 回归背景:
 *  · 主 AI 中断后子智能体继续跑, 但成果原本无处可去 (三丢: 不回注/事件丢弃/GC)
 *  · 前端只收到 iteration/progress/tool 四类骨架事件 → 看不到正文与思考 (黑箱)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  saveArtifact,
  loadArtifact,
  listArtifacts,
  deleteArtifact,
  appendTranscript,
  artifactsDir,
  type SubagentArtifact,
} from './subagent-artifacts.js';
import {
  registerSubagent,
  completeSubagent,
  getSubagent,
  listSubagents,
  runningForSession,
  allFinishedForSession,
  finishedResultsForSession,
  pruneSession,
} from './subagent-registry.js';

let ws: string;

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-art-'));
});
afterEach(() => {
  try { fs.rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ }
});

const mkArtifact = (over: Partial<SubagentArtifact> = {}): SubagentArtifact => ({
  id: 'research-1',
  type: 'research',
  task: '检查 WSL kali 里的任务',
  status: 'running',
  transcript: [],
  toolCalls: 0,
  workspace: ws,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
});

describe('subagent-artifacts: 产物落盘', () => {
  it('写完能读回, 内容一致', () => {
    const a = mkArtifact({ status: 'done', result: '最终结论: 存在 SQL 注入' });
    expect(saveArtifact(a)).toBe(true);
    const back = loadArtifact(ws, 'research-1');
    expect(back).not.toBeNull();
    expect(back!.result).toBe('最终结论: 存在 SQL 注入');
    expect(back!.status).toBe('done');
  });

  it('落盘路径在 {workspace}/.agentai/subagent-artifacts/ 下', () => {
    saveArtifact(mkArtifact());
    const expected = path.join(ws, '.agentai', 'subagent-artifacts', 'research-1.json');
    expect(fs.existsSync(expected)).toBe(true);
    expect(artifactsDir(ws)).toContain(path.join('.agentai', 'subagent-artifacts'));
  });

  it('不依赖主循环: 产物在"运行中"状态就已存在 (进程被杀也能看到)', () => {
    saveArtifact(mkArtifact({ status: 'running' }));
    const back = loadArtifact(ws, 'research-1');
    expect(back!.status).toBe('running');
  });

  it('transcript 累积: 思考/正文/工具调用都留痕 (治黑箱的数据基础)', () => {
    appendTranscript(ws, 'research-1', { kind: 'thinking', text: '先想一步', t: 1 });
    appendTranscript(ws, 'research-1', { kind: 'text', text: '我调用工具看看', t: 2 });
    appendTranscript(ws, 'research-1', { kind: 'tool', text: '调用工具: ws_exec', tool: 'ws_exec', t: 3 });
    const back = loadArtifact(ws, 'research-1');
    expect(back!.transcript.length).toBe(3);
    expect(back!.transcript.map(x => x.kind)).toEqual(['thinking', 'text', 'tool']);
    expect(back!.transcript[0].text).toBe('先想一步');
    expect(back!.toolCalls).toBe(1);
  });

  it('列表按 startedAt 倒序', () => {
    saveArtifact(mkArtifact({ id: 'a', startedAt: 1000 }));
    saveArtifact(mkArtifact({ id: 'b', startedAt: 3000 }));
    saveArtifact(mkArtifact({ id: 'c', startedAt: 2000 }));
    const list = listArtifacts(ws);
    expect(list.map(x => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('删除生效', () => {
    saveArtifact(mkArtifact());
    expect(deleteArtifact(ws, 'research-1')).toBe(true);
    expect(loadArtifact(ws, 'research-1')).toBeNull();
  });

  it('文件名净化: 防路径穿越', () => {
    saveArtifact(mkArtifact({ id: '../../evil' }));
    const dir = artifactsDir(ws);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    expect(files.length).toBe(1);
    expect(files[0]).not.toContain('..');
  });

  it('不脱敏: 敏感内容原样落盘 (用户拍板)', () => {
    const secret = 'http://internal.corp:8080/admin Authorization: Bearer sk-xxx';
    saveArtifact(mkArtifact({ status: 'done', result: secret }));
    expect(loadArtifact(ws, 'research-1')!.result).toBe(secret);
  });
});

describe('subagent-registry: 网关级任务登记', () => {
  beforeEach(() => {
    // 清空全局注册表, 避免用例串扰
    const g = globalThis as any;
    if (g.__agentai_subagent_registry__) g.__agentai_subagent_registry__.clear();
  });

  it('注册后可查到, 默认 running', () => {
    registerSubagent({ id: 's1', type: 'research', task: 't', parentSessionId: 'sess-1', workspace: ws });
    const r = getSubagent('s1');
    expect(r).toBeDefined();
    expect(r!.status).toBe('running');
    expect(r!.parentSessionId).toBe('sess-1');
  });

  it('完成后状态与结果更新', () => {
    registerSubagent({ id: 's1', parentSessionId: 'sess-1', workspace: ws });
    completeSubagent('s1', 'done', { result: '产出', iterations: 3, durationMs: 1200 });
    const r = getSubagent('s1')!;
    expect(r.status).toBe('done');
    expect(r.result).toBe('产出');
    expect(r.finishedAt).toBeGreaterThan(0);
  });

  it('runningForSession 只返回该会话仍在跑的', () => {
    registerSubagent({ id: 'a', parentSessionId: 'sess-1', workspace: ws });
    registerSubagent({ id: 'b', parentSessionId: 'sess-2', workspace: ws });
    completeSubagent('b', 'done', { result: 'x' });
    expect(runningForSession('sess-1').map(x => x.id)).toEqual(['a']);
    expect(runningForSession('sess-2').length).toBe(0);
  });

  it('allFinishedForSession: 全部完成才为 true (唤醒策略: 等齐再一次性唤醒)', () => {
    registerSubagent({ id: 'a', parentSessionId: 'sess-1', workspace: ws });
    registerSubagent({ id: 'b', parentSessionId: 'sess-1', workspace: ws });
    expect(allFinishedForSession('sess-1')).toBe(false);
    completeSubagent('a', 'done', { result: 'x' });
    expect(allFinishedForSession('sess-1')).toBe(false);
    completeSubagent('b', 'done', { result: 'y' });
    expect(allFinishedForSession('sess-1')).toBe(true);
  });

  it('没有子任务的会话 → allFinished 为 true (前端据此不进入等待态)', () => {
    expect(allFinishedForSession('sess-none')).toBe(true);
    expect(runningForSession('sess-none').length).toBe(0);
  });

  it('finishedResultsForSession 给出唤醒所需的成果', () => {
    registerSubagent({ id: 'a', parentSessionId: 'sess-1', workspace: ws });
    registerSubagent({ id: 'b', parentSessionId: 'sess-1', workspace: ws });
    completeSubagent('a', 'done', { result: '成果A' });
    completeSubagent('b', 'error', { error: '炸了' });
    const fin = finishedResultsForSession('sess-1');
    expect(fin.length).toBe(2);
    expect(fin.find(x => x.id === 'a')!.result).toBe('成果A');
    expect(fin.find(x => x.id === 'b')!.error).toBe('炸了');
  });

  it('pruneSession 保留最近 keep 条', () => {
    for (let i = 0; i < 10; i++) {
      registerSubagent({ id: `s${i}`, parentSessionId: 'sess-1', workspace: ws, startedAt: 1000 + i });
    }
    pruneSession('sess-1', 3);
    const left = listSubagents().filter(r => r.parentSessionId === 'sess-1');
    expect(left.length).toBe(3);
  });
});
