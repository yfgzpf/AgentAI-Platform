/**
 * 长任务丝滑性两项修复 (2026-10-21, 富哥「长任务老中断/人家为什么能跑到完成」实锤)
 * ======================================================================
 * 诊断结论 (查实): 判停三层已宽松 (后端 idle 10min 有进展就续 / 绝对墙钟 12h 纯保险 /
 *   前端 idle 5min 有工具在跑就不算), 框架主动切任务的口子基本堵了。真中断来源:
 *   A 弱模型纯文本结轮 (无 tool_use → 回合自然结束, 任务没完也停)
 *   B 前端 5 分钟 idle abort 的空窗在「模型纯思考期」: tool:heartbeat 只在工具跑时发,
 *     慢思考/等 LLM 首 token >5min 零 SSE 事件 → controller.abort() → "[任务已中断]"
 * 修复:
 *   A → system-prompt.ts 第六阶段加「未完成不收场」纪律
 *   B → agentai-loop.ts _chatWithThinkingHeartbeat: 包住每轮 LLM 调用, 30s 一发
 *       tool:heartbeat (复用 provider_wait 同款事件与前端 onToolHeartbeat 续命路径,
 *       前端零改动); 主调用点 + L1/L3/L4 rescue 链全覆盖
 * 本文件锁死上述接线 (行为级时序测试代价高, 源码契约与项目惯例一致)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOOP_SRC = readFileSync(path.resolve(__dirname, 'agentai-loop.ts'), 'utf-8');
const PROMPT_SRC = readFileSync(path.resolve(__dirname, 'system-prompt.ts'), 'utf-8');

describe('思考期心跳: 填满前端 5 分钟 idle abort 空窗 (根因 B)', () => {
  it('① _chatWithThinkingHeartbeat: 30s 间隔 + finally 清理 + abort 后不发 + 复用 tool:heartbeat', () => {
    const m = LOOP_SRC.match(/private async _chatWithThinkingHeartbeat\([\s\S]*?\n  \}/);
    expect(m, '助手方法应存在').toBeTruthy();
    const body = m![0];
    expect(body).toContain('30_000');
    expect(body).toContain('clearInterval(hb)');
    expect(body).toContain('if (this._aborted) return');
    expect(body).toContain("emit('tool:heartbeat'");
    // unref: 不拖住进程退出 (Node 定时器默认会拖 event loop)
    expect(body).toContain('unref');
  });

  it('② 主调用点 + rescue 链全走助手 (1 定义 + 主调用 + L1/L3/L4 = 5 处, 不许漏)', () => {
    const calls = (LOOP_SRC.match(/_chatWithThinkingHeartbeat\(/g) || []).length;
    expect(calls, '主调用与 L1/L3/L4 rescue 都必须包心跳').toBeGreaterThanOrEqual(5);
  });

  it('③ 心跳身份可辨识 (model_thinking), 与工具期/退避期心跳不混', () => {
    expect(LOOP_SRC).toContain("callId: 'model_thinking'");
  });
});

describe('未完成不收场: 拴住弱模型纯文本结轮 (根因 A)', () => {
  it('④ 第六阶段含收场纪律四要素: 未确认 / 目标未达 / 不纯文本结束 / 无工具可派就陈述进度继续', () => {
    expect(PROMPT_SRC).toContain('未完成不收场');
    expect(PROMPT_SRC).toContain('不得用一段纯文本总结结束回合');
    expect(PROMPT_SRC).toContain('陈述当前进度与下一步');
    expect(PROMPT_SRC).toContain('闲聊与纯问答不受此限');
  });

  it('⑤ 纪律挂在「汇报」阶段 — 弱模型最可能交卷溜号的点, 不是埋在无关章节', () => {
    const idx = PROMPT_SRC.indexOf('### 第六阶段');
    expect(idx).toBeGreaterThan(-1);
    const seg = PROMPT_SRC.slice(idx, idx + 700);
    expect(seg).toContain('未完成不收场');
  });

  it('⑥ 与既有「调用后不要结束回合」并存不冲突 (子智能体章节纪律保留)', () => {
    expect(PROMPT_SRC).toContain('调用后不要结束回合');
  });
});
