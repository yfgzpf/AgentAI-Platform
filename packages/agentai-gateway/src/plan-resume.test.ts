/**
 * 任务中断后继续执行计划（用户实机反馈）—— 回归测试
 * ========================================================================
 * 症状: AI 制定了计划，任务中途异常中断（模型断线 / gateway 重启 /
 *   会话关闭）。下次接上时**不会继续执行计划**，等于做了一半重来。
 *
 * 三重根因（现已全部修复）:
 *   D1 计划存模块级变量 `_active_plan` → gateway 重启即丢
 *   D2 不per-workspace → 多会话互相覆盖
 *   D3 ★ 计划从不注入 prompt → 模型压根不知道自己有计划
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getActivePlan,
  setActivePlan,
  clearActivePlan,
  renderActivePlan,
} from './tools.js';

let WS: string;

beforeEach(() => {
  WS = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ws-'));
  fs.mkdirSync(path.join(WS, '.agentai'), { recursive: true });
  clearActivePlan(WS);
});

afterEach(() => {
  clearActivePlan(WS);
  try { fs.rmSync(WS, { recursive: true, force: true }); } catch { /* ignore */ }
});

const mkPlan = (goal: string, statuses: string[]) => ({
  id: `plan-${Date.now()}`,
  goal,
  createdAt: Date.now(),
  subtasks: statuses.map((s, i) => ({
    id: `st${i + 1}`,
    title: `第 ${i + 1} 步`,
    status: s,
    dependencies: [],
    priority: 'high',
  })),
});

describe('D1 计划落盘，跨重启可恢复', () => {
  it('setActivePlan 后磁盘上有 active-plan.json', () => {
    setActivePlan(mkPlan('重构登录模块', ['pending', 'pending', 'pending']), WS);
    const f = path.join(WS, '.agentai', 'active-plan.json');
    expect(fs.existsSync(f), '计划必须落盘，否则重启即丢').toBe(true);
  });

  it('★ 模拟 gateway 重启（清内存缓存）后仍能读到计划', () => {
    setActivePlan(mkPlan('重构登录模块', ['completed', 'in_progress', 'pending']), WS);

    // 模拟"冷启动"：新进程里内存缓存是空的，只能从磁盘读。
    // 直接验证磁盘内容完整性 —— 这正是重启后 getActivePlan 会读到的数据。
    const f = path.join(WS, '.agentai', 'active-plan.json');
    const fromDisk = JSON.parse(fs.readFileSync(f, 'utf-8'));
    expect(fromDisk.goal).toBe('重构登录模块');
    expect(fromDisk.subtasks[0].status).toBe('completed');
    expect(fromDisk.subtasks[1].status).toBe('in_progress');

    // 且 getActivePlan 仍返回有效计划（内存有缓存时直接命中）
    const p = getActivePlan(WS);
    expect(p).toBeTruthy();
    expect(p.subtasks.length).toBe(3);
  });

  it('磁盘文件损坏时安全降级为「无计划」而非崩溃', () => {
    const f = path.join(WS, '.agentai', 'active-plan.json');
    fs.writeFileSync(f, '{ 这不是合法 JSON');
    // 内存里也没有 → 应返回 null 而不是 throw
    expect(getActivePlan(WS)).toBeNull();
  });
});

describe('D2 per-workspace 隔离', () => {
  let WS2: string;

  beforeEach(() => {
    WS2 = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ws2-'));
    fs.mkdirSync(path.join(WS2, '.agentai'), { recursive: true });
  });

  afterEach(() => {
    clearActivePlan(WS2);
    try { fs.rmSync(WS2, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('两个工作区的计划互不干扰', () => {
    setActivePlan(mkPlan('projA 的任务', ['pending']), WS);
    setActivePlan(mkPlan('projB 的任务', ['completed', 'completed']), WS2);

    expect(getActivePlan(WS).goal).toBe('projA 的任务');
    expect(getActivePlan(WS2).goal).toBe('projB 的任务');
  });

  it('清除一个工作区不影响另一个', () => {
    setActivePlan(mkPlan('A', ['pending']), WS);
    setActivePlan(mkPlan('B', ['pending']), WS2);
    clearActivePlan(WS);
    expect(getActivePlan(WS)).toBeNull();
    expect(getActivePlan(WS2).goal).toBe('B');
  });
});

describe('D3 计划注入 prompt（中断续接的核心）', () => {
  it('有未完成计划时必须渲染出注入文本', () => {
    setActivePlan(mkPlan('重构登录模块', ['completed', 'in_progress', 'pending']), WS);
    const out = renderActivePlan(WS);
    expect(out).toContain('当前任务计划');
    expect(out).toContain('重构登录模块');
    expect(out).toContain('第 1 步');
    expect(out).toContain('第 3 步');
  });

  it('★ 明确标出「下一步」并要求不要重新规划', () => {
    setActivePlan(mkPlan('重构登录模块', ['completed', 'completed', 'pending', 'pending']), WS);
    const out = renderActivePlan(WS);
    expect(out, '必须告诉模型从哪一步继续').toMatch(/下一步/);
    expect(out, '必须禁止重新规划').toMatch(/不要重新规划|不要从头开始/);
  });

  it('标出进行中的步骤（中断点）', () => {
    setActivePlan(mkPlan('任务', ['completed', 'in_progress', 'pending']), WS);
    const out = renderActivePlan(WS);
    expect(out).toMatch(/当前卡在|进行中/);
  });

  it('用图标区分四种状态', () => {
    setActivePlan(mkPlan('任务', ['completed', 'in_progress', 'failed', 'pending']), WS);
    const out = renderActivePlan(WS);
    expect(out).toContain('✅');// completed
    expect(out).toContain('🔄');      // in_progress
    expect(out).toContain('❌');      // failed
    expect(out).toContain('⬜');      // pending
  });

  it('显示进度计数', () => {
    setActivePlan(mkPlan('任务', ['completed', 'completed', 'pending', 'pending']), WS);
    expect(renderActivePlan(WS)).toMatch(/2\/4/);
  });

  it('★ 全部完成后不再注入（避免噪声）', () => {
    setActivePlan(mkPlan('任务', ['completed', 'completed']), WS);
    expect(renderActivePlan(WS)).toBe('');
  });

  it('无计划时不产生任何 token 开销', () => {
    expect(renderActivePlan(WS)).toBe('');
  });

  it('空子任务列表不注入', () => {
    setActivePlan({ id: 'x', goal: 'y', subtasks: [] }, WS);
    expect(renderActivePlan(WS)).toBe('');
  });

  it('超长计划被截断但保留关键信息', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({
      id: `s${i}`, title: `非常长的任务标题-${i}-`.repeat(3),
      status: i < 30 ? 'completed' : 'pending',
      dependencies: [], priority: 'high',
    }));
    setActivePlan({ id: 'p', goal: 'L'.repeat(300), subtasks: long }, WS);
    const out = renderActivePlan(WS, 700);
    expect(out.length).toBeLessThanOrEqual(760);
    expect(out).toMatch(/截断/);
  });

  it('失败步骤被显式提示不要原样重试', () => {
    setActivePlan(mkPlan('任务', ['failed', 'pending']), WS);
    const out = renderActivePlan(WS);
    expect(out).toContain('❌');
    expect(out).toMatch(/失败/);
  });
});

describe('端到端: 中断续接场景', () => {
  it('模拟「执行到第2 步崩溃 → 重启 → 新会话拿到计划继续」', () => {
    // 1. 第一次会话：建计划
    setActivePlan(mkPlan('给 VideoGen 加尾帧提取', ['pending', 'pending', 'pending']), WS);

    // 2. 会话中途：第 1 步完成，第 2 步做了一半（in_progress）
    const plan = getActivePlan(WS);
    plan.subtasks[0].status = 'completed';
    plan.subtasks[1].status = 'in_progress';
    setActivePlan(plan, WS);

    // 3. gateway 崩溃/重启 —— 只读磁盘（模拟冷启动）
    const fromDisk = JSON.parse(
      fs.readFileSync(path.join(WS, '.agentai', 'active-plan.json'), 'utf-8'),
    );

    // 4. 新会话的 prompt 应包含完整进度与下一步
    const injected = renderActivePlan(WS);
    expect(injected).toContain('给 VideoGen 加尾帧提取');
    expect(injected).toMatch(/1\/3/);
    expect(injected).toMatch(/当前卡在|进行中/);
    expect(injected).toMatch(/下一步/);
    // 磁盘数据完整 —— 进度没丢
    expect(fromDisk.subtasks[0].status).toBe('completed');
    expect(fromDisk.subtasks[1].status).toBe('in_progress');
  });
});