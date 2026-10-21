/**
 * 长任务连续性 + 记忆收口 (2026-10-21, 富哥「我们项目缺少主动更新记忆这一层」)
 * ======================================================================
 * 事故链 (代码核实, 非推测):
 *   ① findResumableTasks 前置 `status:'running'` 过滤, 而 snapshotBeforeSupersede()
 *      → pause() 把断点写成 'paused' → **断点写了永远召不回** (死链)。
 *   ② "继续" 不满足 isWorthSnapshotting(中文字<3) → taskSnap 恒 null →
 *      该回合 completeStep/bumpIteration 全是 no-op → 反复"继续"每回合丢一段。
 *   ③ self-memory-updater 的 resetSession() **全库无调用方** → sessionWriteCount
 *      进程累计, 写满 20 条后 shouldRemember 永远 false (自动记忆停摆)。
 *   ④ 自动记忆只在 iteration%3 触发, 中断/超时/完成的收口那一刻不结算 →
 *      最近 ≤2 轮的死路结论蒸发 (最该记的恰好丢掉)。
 * 本文件锁死: paused 可召回 / resumeTask 语义 / 三处接线契约 / dead_end 可写入。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getOrCreateSnapshot,
  findResumableTasks,
  tasksRoot,
  deleteDirReliable,
} from './task-snapshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_SRC = readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
const WS = 'F:\\__continuity_test_ws__';
const UID = 'u-continuity-test';

function makeTask(suffix: string, goal: string) {
  const id = `test-cont-${suffix}-${Date.now()}`;
  const mgr = getOrCreateSnapshot(id, { sessionId: 's-test', userId: UID, workspace: WS, goal });
  return { id, mgr };
}

describe('断点可召回 (pause → findResumableTasks)', () => {
  it('① paused 任务出现在可恢复列表 (此前被 status:running 前置过滤掉)', () => {
    const { id, mgr } = makeTask('paused', '测试被接管后的断点能否召回');
    try {
      mgr.pause('new-message');
      const found = findResumableTasks(UID, WS);
      expect(found.some(t => t.taskId === id), 'paused 断点必须可召回').toBe(true);
      expect(found.find(t => t.taskId === id)?.status).toBe('paused');
    } finally {
      deleteDirReliable(path.join(tasksRoot(), id));
    }
  });

  it('② resumeTask(): paused → running; completed 不复活', () => {
    const { id, mgr } = makeTask('resume', '测试继续回合接管后状态回到运行中');
    try {
      mgr.pause('new-message');
      mgr.resumeTask();
      const meta = findResumableTasks(UID, WS).find(t => t.taskId === id);
      expect(meta?.status).toBe('running');

      mgr.complete('done');
      mgr.resumeTask(); // 已完成的不能被"继续"复活
      const after = findResumableTasks(UID, WS).find(t => t.taskId === id);
      expect(after, 'completed 不应再出现在可恢复列表').toBeUndefined();
    } finally {
      deleteDirReliable(path.join(tasksRoot(), id));
    }
  });
});

describe('源码契约: 三处接线必须在位', () => {
  it('③ "继续"回合挂回原任务快照 (读路径 + 写路径都接上)', () => {
    expect(LOOP_SRC).toContain('let _resumedMeta: ReturnType<typeof findResumableTasks>[number] | null = null;');
    expect(LOOP_SRC).toMatch(/_resumedMeta = mine\[0\]/);
    // 关键: 召回后必须拿它的 taskId 建快照并 resume, 否则本回合进度零记录
    expect(LOOP_SRC).toMatch(/if \(!taskSnap && _resumedMeta\)/);
    expect(LOOP_SRC).toContain('getOrCreateSnapshot(_resumedMeta.taskId');
    expect(LOOP_SRC).toMatch(/resumeTask\?\.\(\)/);
  });

  it('④ 记忆写入预算每回合复位 (resetSession 不再是死代码)', () => {
    expect(LOOP_SRC).toMatch(/import\('\.\/self-memory-updater\.js'\)\.then\(m => m\.resetSession\(\)\)/);
  });

  it('⑤ 收口结算覆盖四类出口: 接管 / 中断 / 超时 / 完成', () => {
    expect(LOOP_SRC).toMatch(/_settleMemories\(`supersede:/);
    expect(LOOP_SRC).toMatch(/_settleMemories\('aborted'\)/);
    expect(LOOP_SRC).toMatch(/_settleMemories\(`timeout:/);
    expect(LOOP_SRC).toMatch(/_settleMemories\('completed'\)/);
    // dead_end 类别必须真的被产出
    expect(LOOP_SRC).toContain("category: 'dead_end'");
  });

  it('⑥ 死路判定要≥2 次 (单次 403 可能只是抖动, 不许当结论)', () => {
    const settle = LOOP_SRC.slice(LOOP_SRC.indexOf('private async _settleMemories'));
    expect(settle).toMatch(/if \(v\.count < 2\) continue;/);
  });
});

describe('记忆类别: dead_end 可用', () => {
  it('⑦ shouldRemember 接受 dead_end 且 importance≥3 时放行', async () => {
    const { shouldRemember, resetSession } = await import('./self-memory-updater.js');
    resetSession();
    const r = shouldRemember({
      category: 'dead_end',
      title: '死路: 403 /cas/actuator',
      content: '已确认此路不通 (3 次): 403 → /cas/actuator。样本: nginx forbidden',
      entityId: 'dead:test|403|/cas/actuator',
      importance: 4,
    });
    expect(r.should).toBe(true);
  });
});
