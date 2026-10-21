/**
 * "并入对话" 不得中断当前任务 (2026-10-21 富哥实锤)
 * ======================================================================
 * 事故: 后台任务完成提示条点"并入对话" → 直接调 handleSend →
 *   handleSend 的"新消息压制旧回复"分支 abort 掉正在跑的回合 →
 *   用户看到"一点并入就换了对话, 好好的任务被破坏"。
 * 正解: handleSend 是"用户主动改主意"的入口, 有权中断;
 *   并入只是补一条信息, 没有中断权 → 正在跑就进 queuedSends,
 *   loading=false 后由队列 effect 自动发送。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(__dirname, 'components/ChatView.tsx'), 'utf-8');

describe('后台任务"并入对话"不打断当前回合', () => {
  it('① 并入按钮走"正在跑则排队"分支, 不再无条件 handleSend', () => {
    const idx = SRC.indexOf('const mergeText = `后台任务已完成');
    expect(idx, '并入按钮的合并文案应存在').toBeGreaterThan(0);
    const block = SRC.slice(idx, idx + 1200);
    expect(block).toContain('if (loading)');
    expect(block).toContain('setQueuedSends(q => [...q, mergeText])');
    // 铁律: 只有不在跑的时候才允许直接 handleSend
    expect(block).toMatch(/}\s*else\s*\{\s*handleSend\(mergeText\);\s*\}/);
  });

  it('② 提示条明确告知"不点也可以/不会打断" (别让用户以为必须点)', () => {
    expect(SRC).toContain('不点也可以：结果已落盘');
    expect(SRC).toContain('不会打断');
  });
});
