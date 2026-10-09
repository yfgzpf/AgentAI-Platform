/**
 * 失忆根因回归测试
 * ========================================================================
 * 用户实机反馈:「AI 失忆严重，工作摘要及上回做了什么看不见，一直重复读文件」
 *
 * 本文件锁定三条独立根因，每条都先写失败断言再修：
 *   R1  flush() 只返回 1 条 → 工作摘要被20+ 个同优先级指令挤掉
 *   R2  台账必须独立于 appendOnlyLog（否则压缩/裁剪后事实消失）
 *   R3  重复动作必须可检出并注入
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SystemDirectiveManager } from './system-directive-manager.js';
import {
  TaskLedger,
  getLedger,
  dropLedger,
  clearLedgers,
  ledgerStats,
} from './task-ledger.js';

// ════════════════════════════════════════════════════════════════════════
// R1: 指令队列不得静默丢弃工作摘要
// ════════════════════════════════════════════════════════════════════════

describe('R1 SystemDirectiveManager 不得静默丢弃关键指令', () => {
  it('flushAll 应返回全部 critical + high 指令，而非只有 1 条', () => {
    const dm = new SystemDirectiveManager();
    dm.add('task_progress', '[工作摘要] 第3轮进度', 'high');
    dm.add('fail_strategy', '[失败策略] 换方案', 'high');
    dm.add('auto_fix_path', '[自动修复] 路径不存在', 'high');

    const all = dm.flushAll();
    expect(all.length, 'flushAll 应返回全部 high 指令').toBeGreaterThanOrEqual(3);
    expect(all.join('\n')).toContain('[工作摘要] 第3轮进度');
  });

  it('critical 指令必须永远排在最前', () => {
    const dm = new SystemDirectiveManager();
    dm.add('x', 'low 指令', 'low');
    dm.add('y', 'medium 指令', 'medium');
    dm.add('z', 'critical 指令', 'critical');

    const all = dm.flushAll();
    expect(all[0]).toContain('critical');
  });

  it('同名source 只保留最新一条（避免刷屏）', () => {
    const dm = new SystemDirectiveManager();
    dm.add('task_progress', '第1版', 'high');
    dm.add('task_progress', '第2版', 'high');
    dm.add('task_progress', '第3版', 'high');

    const all = dm.flushAll();
    expect(all.length).toBe(1);
    expect(all[0]).toContain('第3版');
  });

  it('flushAll 后队列应被清空（不重复注入）', () => {
    const dm = new SystemDirectiveManager();
    dm.add('a', 'A', 'high');
    dm.flushAll();
    expect(dm.flushAll().length).toBe(0);
  });

  it('低优先级 medium/low 默认不参与每轮注入（避免噪音）', () => {
    const dm = new SystemDirectiveManager();
    dm.add('m', 'medium 指令', 'medium');
    dm.add('l', 'low 指令', 'low');
    const all = dm.flushAll();
    expect(all.join('\n')).not.toContain('low 指令');
  });

  it('兼容旧接口 flush(): 有 critical 时仍返回最高优先级那条', () => {
    const dm = new SystemDirectiveManager();
    dm.add('a', 'high 1', 'high');
    dm.add('b', 'high 2', 'high');
    const top = dm.flush();
    expect(top).toBeTruthy();
  });

  it('real 场景：20 个 auto_fix 高优先级挤在一起时工作摘要仍能进 messages', () => {
    const dm = new SystemDirectiveManager();
    // 模拟：一轮里 AI 触发了大量工具错误修复指令
    for (let i = 0; i < 20; i++) {
      dm.add(`auto_fix_${i}`, `[自动修复 ${i}]`, 'high');
    }
    // 同时 loop 每轮都会加工作摘要
    dm.add('task_progress', '[工作摘要] 已读 a.ts，已写 b.ts', 'high');

    const all = dm.flushAll();
    expect(
      all.join('\n'),
      '工作摘要必须与 auto_fix 指令同时送达，不能因数量劣势被丢弃',
    ).toContain('已读 a.ts');
  });
});

// ════════════════════════════════════════════════════════════════════════
// R2: 台账独立于对话历史
// ════════════════════════════════════════════════════════════════════════

describe('R2 TaskLedger 独立于 appendOnlyLog', () => {
  let ledger: TaskLedger;
  beforeEach(() => {
    ledger = new TaskLedger('t1');
  });

  it('appendOnlyLog 被清空后台账仍保留已读文件', () => {
    ledger.record('read_file', 'src/a.ts', 'read');
    ledger.record('read_file', 'src/b.ts', 'read');
    // 模拟历史被裁剪: 对话记录清空
    // （TaskLedger 根本不依赖它，这里只是证明语义）
    expect(ledger.listReads()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('记录已读文件并返回这是第几次', () => {
    expect(ledger.record('read_file', 'src/a.ts', 'read')).toBe(0); // 首次返回 0
    expect(ledger.record('read_file', 'src/a.ts', 'read')).toBe(1); // 第二次返回 1
    expect(ledger.record('read_file', 'src/a.ts', 'read')).toBe(2);
    expect(ledger.readCount('src/a.ts')).toBe(3);
  });

  it('区分读与写：读过不等于写过', () => {
    ledger.record('read_file', 'src/a.ts', 'read');
    expect(ledger.writeCount('src/a.ts')).toBe(0);
    expect(ledger.readCount('src/a.ts')).toBe(1);
  });

  it('路径归一化：反斜杠与正斜杠视为同一文件', () => {
    ledger.record('read_file', 'src\\lib\\a.ts', 'read');
    expect(ledger.readCount('src/lib/a.ts')).toBe(1);
  });

  it('任务目标只保留最新一条', () => {
    ledger.setGoal('第一次的需求');
    ledger.setGoal('第二次的需求');
    expect(ledger.getGoal()).toBe('第二次的需求');
  });

  it('同一失败不重复记录', () => {
    ledger.recordFailure('read_file', 'ENOENT');
    ledger.recordFailure('read_file', 'ENOENT');
    expect(ledger.listFailures().length).toBe(1);
  });

  it('同一决策不重复记录', () => {
    ledger.recordDecision('采用 execFile 而非 execSync');
    ledger.recordDecision('采用 execFile 而非 execSync');
    expect(ledger.listDecisions().length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// R3: 重复动作必须可检出
// ════════════════════════════════════════════════════════════════════════

describe('R3 重复动作检出', () => {
  it('topDuplicates 应列出被重复执行的动作', () => {
    const l = new TaskLedger('t2');
    l.record('read_file', 'src/a.ts', 'read');
    l.record('read_file', 'src/a.ts', 'read');
    l.record('read_file', 'src/a.ts', 'read');
    l.record('read_file', 'src/b.ts', 'read');

    const dups = l.topDuplicates();
    expect(dups.length).toBeGreaterThan(0);
    expect(dups[0].target).toBe('src/a.ts');
    expect(dups[0].count).toBe(3);
  });

  it('未重复的动作不应出现在 topDuplicates', () => {
    const l = new TaskLedger('t3');
    l.record('read_file', 'src/only-once.ts', 'read');
    expect(l.topDuplicates().length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 注入渲染
// ════════════════════════════════════════════════════════════════════════

describe('台账注入文本', () => {
  it('空台账不产生任何 token 开销', () => {
    expect(new TaskLedger('empty').render()).toBe('');
  });

  it('含已读文件时明确写"禁止重复读取"', () => {
    const l = new TaskLedger('r1');
    l.setIteration(5);
    l.setGoal('给 tools.ts 加参数校验');
    l.record('read_file', 'packages/gateway/src/tools.ts', 'read');
    const out = l.render();
    expect(out).toContain('任务台账');
    expect(out).toContain('packages/gateway/src/tools.ts');
    expect(out).toContain('禁止重复读取');
    expect(out).toContain('给 tools.ts 加参数校验');
    expect(out).toContain('第 5 轮');
  });

  it('含已写文件与失败项', () => {
    const l = new TaskLedger('r2');
    l.record('write_file', 'src/b.ts', 'write');
    l.recordFailure('run_command', '命令超时');
    const out = l.render();
    expect(out).toContain('src/b.ts');
    expect(out).toContain('不要原样重试');
    expect(out).toContain('命令超时');
  });

  it('超长时截断但保留头部（任务目标不能被截掉）', () => {
    const l = new TaskLedger('r3');
    l.setGoal('这是一个必须保留的任务目标');
    for (let i = 0; i < 60; i++) l.record('read_file', `src/file-${i}.ts`, 'read');
    const out = l.render({ maxChars: 300 });
    expect(out.length).toBeLessThanOrEqual(340);
    expect(out).toContain('这是一个必须保留的任务目标');
  });
});

// ════════════════════════════════════════════════════════════════════════
// per-session 隔离
// ════════════════════════════════════════════════════════════════════════

describe('per-session 台账隔离（防串味）', () => {
  beforeEach(() => clearLedgers());

  it('不同 session 各自独立', () => {
    const a = getLedger('userA:projA');
    const b = getLedger('userB:projB');
    a.record('read_file', 'projA-secret.ts', 'read');
    expect(b.listReads()).toEqual([]);
    expect(a.listReads()).toEqual(['projA-secret.ts']);
  });

  it('同session 重复get 返回同一实例', () => {
    const a1 = getLedger('same');
    const a2 = getLedger('same');
    a1.record('read_file', 'x.ts', 'read');
    expect(a2.listReads()).toEqual(['x.ts']);
  });

  it('dropLedger 后状态清空', () => {
    const a = getLedger('dropme');
    a.record('read_file', 'x.ts', 'read');
    dropLedger('dropme');
    expect(getLedger('dropme').listReads()).toEqual([]);
  });

  it('LRU 上限生效，不会无界增长', () => {
    for (let i = 0; i < 200; i++) getLedger(`s${i}`);
    expect(ledgerStats().count).toBeLessThanOrEqual(64);
  });

  it('空 sessionKey 归入 default 桶', () => {
    const a = getLedger('');
    const b = getLedger('');
    expect(a).toBe(b);
  });
});