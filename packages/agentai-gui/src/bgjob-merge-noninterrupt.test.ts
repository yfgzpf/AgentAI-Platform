/**
 * 后台任务完成 → 自动唤醒主 AI (2026-10-21 富哥重审)
 * ======================================================================
 * 富哥原话: "这个不是 AI 会自动轮询去拿结果吗？为什么要发送下一轮呢？
 *           它发 wsl_exec 完成就会跳一次，AI 不是自己去拿结果吗？
 *           显示也不能常驻呀！要闪退呀！"
 *
 * 旧实现的两个错:
 *   ① 没有自动唤醒通道 — job 跑完只弹横幅, 等人点"并入"或等下一条用户消息,
 *      等于把人当轮询器 (子智能体早有 triggerSubagentResume, 后台 job 没有)。
 *   ② 横幅常驻 — 一直挡视线, 还诱导用户点一个会 abort 当前回合的按钮。
 * 正解: 轮询发现 done/error → 去抖合并 → 直接续跑取结果 (同 sessionId);
 *   横幅降级为 6 秒自动收起的回执。stopped/orphaned 只展示不唤醒。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.resolve(__dirname, 'components/ChatView.tsx'), 'utf-8');

describe('后台 job 完成 → 自动续跑', () => {
  it('① 轮询把 done/error 推进自动唤醒队列 (不再只弹横幅)', () => {
    const idx = SRC.indexOf('const autoJobs = fresh.filter');
    expect(idx, '应存在自动接管过滤').toBeGreaterThan(0);
    const block = SRC.slice(idx, idx + 600);
    expect(block).toContain("j.status === 'done' || j.status === 'error'");
    expect(block).toContain('bgResumeQueueRef.current.push(...autoJobs)');
    expect(block).toContain('scheduleBgResume()');
  });

  it('② 唤醒走直接续跑 (同 sessionId), 不经过 handleSend (无中断权)', () => {
    const idx = SRC.indexOf('const triggerBgJobResume');
    expect(idx).toBeGreaterThan(0);
    const block = SRC.slice(idx, idx + 2600);
    expect(block).toContain('apiStream(');
    expect(block).toContain('sessionId: activeId');
    expect(block).toContain('job_output');
    expect(block).not.toContain('handleSend(');
  });

  it('③ 去抖: 一批 job 接连完成只唤醒一次', () => {
    const idx = SRC.indexOf('const scheduleBgResume');
    const block = SRC.slice(idx, idx + 500);
    expect(block).toContain('if (bgResumeTimerRef.current) return;');
    expect(block).toContain('splice(0)');
  });

  it('④ 正在跑任务时排队, 本轮结束立刻唤醒 (绝不打断)', () => {
    expect(SRC).toMatch(/if \(!loading && bgResumeQueueRef\.current\.length > 0\) scheduleBgResume\(0\)/);
    expect(SRC).toMatch(/if \(loading\) \{[\s\S]{0,200}bgResumeQueueRef\.current\.push\(\.\.\.jobs\)/);
  });

  it('⑤ 提示条 6 秒自动收起, 不再常驻', () => {
    expect(SRC).toContain('const t = setTimeout(() => setPendingBgJobs([]), 6000);');
    expect(SRC).toContain('本提示 6 秒后自动收起');
    expect(SRC).toContain('已自动读取');
  });

  it('⑥ 已读结果不再推 (AI 已 job_output 拿到的不弹、不唤醒)', () => {
    // 判据与网关 isBgJobConsumed 一致: readAt >= finishedAt
    expect(SRC).toContain('const isConsumed = (j: any)');
    expect(SRC).toContain('new Date(j.readAt).getTime() >= new Date(j.finishedAt).getTime()');
    expect(SRC).toMatch(/&& !isConsumed\(j\)/);
  });
});
