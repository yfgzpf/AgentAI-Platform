/**
 * 工作区任务归属判断 — 回归测试 (2026-10-15)
 * ============================================================================
 * 背景: 用户反馈"工作区设成 C 盘某目录, 但任务跟它无关时, AI 老在原地打转,
 * 不主动避开/自建目录"。根因是 buildImmutablePrefix 的 workspace 注入文案
 * 只教了"怎么用相对路径 + 能跨目录用绝对路径", 但没给"这任务不归你管, 该挪开"
 * 的决策出口 → AI 被锚定 + 无出口 = 打转。
 *
 * 修法 (agentai-loop.ts): workspace 段补"⚠️ 任务归属判断"出口:
 *   先判断任务与工作区是否相关 → 无关就自建专属目录(别污染工作区根) →
 *   同一目录反复打转(>2 次没推进)就停下 ask_user。
 * 本测试锁死这段文案存在且没被 tier 门控 (强模型同样要吃得到)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

const loopSrc = readFileSync(nodePath.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');

// 修复点注释/文案里大量含 `//` 行注释, 朴素 grep 易误命中。用**声明上下文**正则:
// 断言锚在 systemMsgs.push 的 content 模板串特征词上 (这些词只在正文出现, 注释里没有)。
function hasAnchor(s: string, re: RegExp): boolean {
  return re.test(s);
}

describe('workspace 注入含"任务归属判断"出口 (防 AI 在无关工作区打转)', () => {
  it('有 ⚠️ 任务归属判断 段, 教 AI 先判断任务相关性', () => {
    expect(hasAnchor(loopSrc, /任务归属判断/)).toBe(true);
    // 核心逻辑词: 相关就地 / 无关自建 / 别打转
    expect(hasAnchor(loopSrc, /不要在当前工作区里乱建文件/)).toBe(true);
    expect(hasAnchor(loopSrc, /ask_user/)).toBe(true);
  });

  it('无关任务给自建目录出口 (output/ 或 .agentai/scratch), 不污染工作区根', () => {
    // 两条自建路径出口都在
    expect(hasAnchor(loopSrc, /'output',\s*'<task-slug>'/)).toBe(true);
    expect(hasAnchor(loopSrc, /'\.agentai',\s*'scratch'/)).toBe(true);
  });

  it('打转 >2 次就停下 (防无限原地重试)', () => {
    expect(hasAnchor(loopSrc, /反复尝试都在原地打转/)).toBe(true);
  });

  it('这段注入未被 tier/autonomous 门控 (强模型同样吃得到)', () => {
    // 锚点: workspace 段 "任务归属判断" 与最近的 systemMsgs.push 之间,
    // 不该夹着 _capabilityTier !== 'autonomous' / !isStrongModel 的门控。
    const idx = loopSrc.indexOf('任务归属判断');
    expect(idx, '任务归属判断 文案缺失').toBeGreaterThan(-1);
    // 向前找最近的 systemMsgs.push
    const pushIdx = loopSrc.lastIndexOf('systemMsgs.push', idx);
    expect(pushIdx, '任务归属判断 不在 systemMsgs.push 内').toBeGreaterThan(-1);
    // 这段 (push→锚点之间) 不该有 autonomous 门控
    const between = loopSrc.slice(pushIdx, idx);
    expect(hasAnchor(between, /!==\s*['"]autonomous['"]/)).toBe(false);
    expect(hasAnchor(between, /!isStrongModel/)).toBe(false);
  });
});
