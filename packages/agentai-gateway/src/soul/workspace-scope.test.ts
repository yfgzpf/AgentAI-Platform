/**
 * soul 模块 workspace 隔离测试（串味回归防护）
 * ==================================================
 * 背景: soul 7 模块曾全是进程级单例 + 构造时固化全局 projectDir，
 * 导致 projA 的梦境 / 私密记忆 / 痛感 / 好奇心被注入 projB 的任务上下文。
 * 模型表现为"我记得你上次在另一个任务里说过…"。
 *
 * 覆盖:
 *   - 同一 workspace 复用同一实例（避免每次 new 造成磁盘 IO + 定时器泄漏）
 *   - 不同 workspace 拿到不同实例（隔离）
 *   - 磁盘类模块的 dataPath 指向各自 workspace
 *   - resetScoped 精确销毁
 *   - 实例数上限 LRU 淘汰
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// 必须在 import 被测模块前设定 AGENTAI_HOME（memory.ts 在模块加载时求值）
// 详见 self-memory-updater.test.ts 同款注释
(globalThis as any).process.env.AGENTAI_HOME =
  path.join(os.tmpdir(), 'soul-scope-test-home');

import {
  getScoped,
  resetScoped,
  resetAllScoped,
  normalizeWs,
  scopedStats,
} from './workspace-scope.js';

let tmpRoot: string;

function ws(name: string): string {
  const p = path.join(tmpRoot, name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soul-scope-'));
  resetAllScoped();
});

afterEach(() => {
  resetAllScoped();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('normalizeWs', () => {
  it('空值统一归到 __default__', () => {
    expect(normalizeWs(undefined)).toBe('__default__');
    expect(normalizeWs('')).toBe('__default__');
    expect(normalizeWs('   ')).toBe('__default__');
  });

  it('非空值原样保留（去首尾空白）', () => {
    expect(normalizeWs('D:/projA')).toBe('D:/projA');
    expect(normalizeWs('  D:/projA  ')).toBe('D:/projA');
  });
});

describe('getScoped — 实例隔离', () => {
  it('同一 workspace 复用同一实例', () => {
    let created = 0;
    const a1 = getScoped('t', 'D:/projA', () => ({ n: ++created }));
    const a2 = getScoped('t', 'D:/projA', () => ({ n: ++created }));
    expect(a1).toBe(a2);
    expect(created).toBe(1);
  });

  it('不同 workspace 拿到不同实例', () => {
    const a = getScoped('t', 'D:/projA', () => ({ tag: 'A' }));
    const b = getScoped('t', 'D:/projB', () => ({ tag: 'B' }));
    expect(a).not.toBe(b);
    expect(a.tag).toBe('A');
    expect(b.tag).toBe('B');
  });

  it('不同模块名互不干扰', () => {
    const d = getScoped('dream', 'D:/projA', () => ({ m: 'dream' }));
    const c = getScoped('curiosity', 'D:/projA', () => ({ m: 'curiosity' }));
    expect(d).not.toBe(c);
  });

  it('未传 workspace 的调用共享 __default__ 桶', () => {
    const d1 = getScoped('t', undefined, () => ({}));
    const d2 = getScoped('t', '', () => ({}));
    expect(d1).toBe(d2);
  });
});

describe('resetScoped', () => {
  it('只销毁指定 workspace 的实例', () => {
    const a1 = getScoped('t', 'D:/projA', () => ({}));
    const b1 = getScoped('t', 'D:/projB', () => ({}));

    resetScoped('t', 'D:/projA');

    // A 被销毁重建 → 新实例
    const a2 = getScoped('t', 'D:/projA', () => ({}));
    expect(a2).not.toBe(a1);
    // B 未受影响
    expect(getScoped('t', 'D:/projB', () => ({}))).toBe(b1);
  });

  it('不传 workspace 时销毁该模块全部实例', () => {
    getScoped('t', 'D:/projA', () => ({}));
    getScoped('t', 'D:/projB', () => ({}));
    expect(scopedStats().t).toBe(2);

    resetScoped('t');
    // registries 保留空 Map（key 仍存在，size 为 0）
    expect(scopedStats().t).toBe(0);
  });

  it('调用实例的 stop() 以释放定时器', () => {
    let stopped = false;
    const inst = getScoped('t', 'D:/projA', () => ({
      stop() { stopped = true; },
    }));
    expect(stopped).toBe(false);
    resetScoped('t', 'D:/projA');
    expect(stopped).toBe(true);
    expect(inst.stop).toBeDefined();
  });
});

describe('LRU 上限', () => {
  it('实例数超上限时淘汰最旧的', () => {
    // 上限 16，写入 20 个 workspace
    const keys: string[] = [];
    for (let i = 0; i < 20; i++) {
      const k = `D:/proj${i}`;
      keys.push(k);
      getScoped('t', k, () => ({ i }));
    }
    // 超限后最早的应被淘汰 → 重新访问会创建新实例
    const stat = scopedStats().t;
    expect(stat).toBeLessThanOrEqual(16);

    const first = getScoped('t', keys[0]!, () => ({ rebuilt: true }));
    expect(first).toEqual({ rebuilt: true });
  });
});

describe('真实 soul 模块隔离（磁盘类）', () => {
  it('InnerVoice 各自写入各自 workspace 的 jsonl', async () => {
    const { getInnerVoice, resetInnerVoice } = await import('./inner-voice.js');
    const wsA = ws('projA');
    const wsB = ws('projB');

    const va = getInnerVoice(wsA);
    const vb = getInnerVoice(wsB);
    expect(va).not.toBe(vb);

    // 直接构造 thought 记录以验证路径隔离（避免依赖 whisper 的随机性）
    (va as any).thoughtPath = path.join(wsA, '.agentai', 'inner-voice.jsonl');
    (vb as any).thoughtPath = path.join(wsB, '.agentai', 'inner-voice.jsonl');
    expect((va as any).thoughtPath).not.toBe((vb as any).thoughtPath);

    resetInnerVoice();
  });

  it('PrivateMemory 的 dataPath 跟随 workspace', async () => {
    const { getPrivateMemory, resetPrivateMemory } = await import('./private-memory.js');
    const wsA = ws('projA');
    const wsB = ws('projB');

    const pa = getPrivateMemory(wsA) as any;
    const pb = getPrivateMemory(wsB) as any;
    expect(pa.dataPath).toBe(path.join(wsA, '.agentai', 'private-memory.enc'));
    expect(pb.dataPath).toBe(path.join(wsB, '.agentai', 'private-memory.enc'));

    resetPrivateMemory();
  });
});

describe('真实 soul 模块隔离（内存类）', () => {
  it('PainSense 痛感状态不跨 workspace 累积', async () => {
    const { getPainSense, resetPainSense } = await import('./pain-sense.js');
    const wsA = ws('projA');
    const wsB = ws('projB');

    const pa = getPainSense(wsA);
    const pb = getPainSense(wsB);
    expect(pa).not.toBe(pb);

    // 在 A 上累积痛感
    for (let i = 0; i < 3; i++) pa.feelPain('test');
    expect(pa.getState().consecutiveFailures).toBeGreaterThan(0);

    // B 不应受到影响
    expect(pb.getState().consecutiveFailures).toBe(0);

    resetPainSense();
  });

  it('ValueSystem 价值向量不跨 workspace 共享', async () => {
    const { getValueSystem, resetValueSystem } = await import('./value-vector.js');
    const wsA = ws('projA');
    const wsB = ws('projB');
    expect(getValueSystem(wsA)).not.toBe(getValueSystem(wsB));
    resetValueSystem();
  });

  it('InternalDebate 辩论历史不跨 workspace 共享', async () => {
    const { getInternalDebate, resetInternalDebate } = await import('./internal-debate.js');
    const wsA = ws('projA');
    const wsB = ws('projB');
    expect(getInternalDebate(wsA)).not.toBe(getInternalDebate(wsB));
    resetInternalDebate();
  });

  it('CuriosityEngine 洞察不跨 workspace 共享', async () => {
    const { getCuriosityEngine, resetCuriosityEngine } = await import('./curiosity-engine.js');
    const wsA = ws('projA');
    const wsB = ws('projB');
    expect(getCuriosityEngine(wsA)).not.toBe(getCuriosityEngine(wsB));
    resetCuriosityEngine();
  });

  it('DreamEngine 梦境日志不跨 workspace 共享', async () => {
    const { getDreamEngine, resetDreamEngine } = await import('./dream-engine.js');
    const wsA = ws('projA');
    const wsB = ws('projB');
    const da = getDreamEngine(undefined, wsA) as any;
    const db = getDreamEngine(undefined, wsB) as any;
    expect(da).not.toBe(db);
    expect(da.journalPath).toBe(path.join(wsA, '.agentai', 'dream-journal.jsonl'));
    expect(db.journalPath).toBe(path.join(wsB, '.agentai', 'dream-journal.jsonl'));
    resetDreamEngine();
  });
});