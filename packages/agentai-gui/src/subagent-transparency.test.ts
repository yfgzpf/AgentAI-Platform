/**
 * 子智能体「黑箱治理 + 成果不丢」前端回归测试 — 2026-10-21
 * ----------------------------------------------------------------
 * 覆盖富哥实锤的两个问题:
 *  ① 黑箱: 子智能体的思考/正文/工具调用**必须可见**, 且**默认折叠** (不美观/太长)
 *  ② 成果不丢: 终态不再 5 秒即焚, 结果摘要可见
 *
 * 同时锁死"唤醒续跑"链路的关键接线:
 *  · 后端转发 delta/thinking → 前端 onSubagentProgress 必须分流进 transcript
 *  · 触发续跑时必须带 _resumeFrom
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GUI = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(GUI, p), 'utf-8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('SubagentStatus: 治黑箱 (过程可见 + 默认折叠)', () => {
  const src = read('src/components/SubagentStatus.tsx');
  const clean = strip(src);

  it('transcript 字段存在, 且区分 thinking/text/tool 三类', () => {
    expect(clean).toContain('transcript');
    // SubagentStatus 是**消费方**: 按 kind 分流渲染三类内容
    // (构造在 ChatView.onSubagentProgress 里)
    expect(clean).toContain("e.kind === 'thinking'");
    expect(clean).toContain("e.kind === 'text'");
    expect(clean).toContain("e.kind === 'tool'");
  });

  it('★ 每个 agent 独立折叠态, 默认全折叠 (富哥: 过程要折叠, 不要全展开)', () => {
    // 折叠状态用 Set 维护, 初始为空 → 默认全折叠
    expect(clean).toContain('openAgents');
    expect(clean).toContain('useState<Set<string>>(new Set())');
    // 折叠时才渲染详情
    expect(clean).toContain('{isOpen && (');
  });

  it('★ 思考过程是二级折叠, 默认收起', () => {
    expect(clean).toContain('openThinking');
    expect(clean).toContain('useState<Set<string>>(new Set())');
    // 思考块默认不展开 (需 thinkOpen 才渲染)
    expect(clean).toContain('thinkOpen && (');
  });

  it('去掉"只显示最后 3 步 + 单行 ellipsis"的读取限制', () => {
    // 骨架时间线保留 slice(-3), 但 transcript 走独立渲染, 不再受此限
    expect(clean).toContain('renderTranscript');
    // transcript 区域是可滚动的, 不是单行截断
    expect(clean).toContain('maxHeight: SCROLL_MAX_H');
    expect(clean).toContain('overflowY: \'auto\'');
    expect(clean).toContain('whiteSpace: \'pre-wrap\'');
  });

  it('★ 终态不再自动清空 (父任务中断时), 保留结果可见', () => {
    // parentInterrupted 时不触发淡出/清空
    expect(clean).toContain('parentInterrupted');
    expect(clean).toContain('if (parentInterrupted) return;');
  });

  it('done 状态显示结果摘要 (之前只有一个 ✓ 勾, 产出隐形)', () => {
    expect(clean).toContain('agent.result || \'已完成\'');
  });

  it('父任务中断时明确告知用户 (不再让人以为卡死)', () => {
    expect(clean).toContain('父任务已中断');
    expect(clean).toContain('仍在后台运行');
  });
});

describe('ChatView: 子智能体事件接线', () => {
  const src = read('src/components/ChatView.tsx');
  const clean = strip(src);

  it('★ delta(正文) 累积进 transcript, 不再变成"思考中..."', () => {
    expect(clean).toContain("info.event === 'delta'");
    expect(clean).toContain("kind: 'text'");
  });

  it('★ thinking(深度思考) 累积进 transcript', () => {
    expect(clean).toContain("info.event === 'thinking'");
    expect(clean).toContain("kind: 'thinking'");
  });

  it('工具调用同时进 transcript (工具名要能看到)', () => {
    expect(clean).toContain("kind: 'tool'");
    expect(clean).toContain('toolCalls');
  });

  it('★ 终态不再 5 秒删除 (原来 done/error 后 setTimeout 移除)', () => {
    // 不应再有 5000ms 的移除定时器
    expect(clean).not.toMatch(/setTimeout\(\(\)\s*=>\s*\{\s*setSubagents\(prev\s*=>\s*prev\.filter\(a\s*=>\s*a\.id\s*!==\s*info\.id\)/);
  });

  it('★ 唤醒续跑: 完成后检查子任务是否全部结束', () => {
    expect(clean).toContain('checkSubagentsFinished');
    expect(clean).toContain('/api/subagent-artifacts/status');
  });

  it('★ 唤醒续跑: 带 _resumeFrom 发起新请求', () => {
    expect(clean).toContain('triggerSubagentResume');
    expect(clean).toContain('_resumeFrom');
  });

  it('★ ④ 自动续跑开关真正生效: 关掉时子智能体完成不自动唤醒, 只提示', () => {
    // 实锤: 设置页 agentai.settings.autoResume 此前 ChatView 从没读, 开关是装饰品
    const idx = clean.indexOf('const triggerSubagentResume');
    const block = clean.slice(idx, idx + 1400);
    expect(block).toContain('isAutoResumeOn()');
    expect(block).toContain('自动续跑已关闭');
    expect(block).toContain('bot-subpaused');
  });

  it('★ 唤醒只触发一次 (同批子任务不重复唤醒)', () => {
    expect(clean).toContain('resumeTriggeredRef');
  });

  it('中断主任务时若有子智能体在跑 → 进入等待唤醒态', () => {
    expect(clean).toContain('setAwaitingSubagents(true)');
    expect(clean).toContain("a.status === 'running'");
  });
});

describe('后端: 子智能体独立任务单元 + 产物落盘', () => {
  const loop = strip(read('../agentai-gateway/src/agentai-loop.ts'));
  const chat = strip(read('../agentai-gateway/src/routes/chat.ts'));

  it('★ 子循环不继承父 abortSignal (父死子不死的关键)', () => {
    // 子循环构造里不能出现 abortSignal
    const idx = loop.indexOf('const subLoop = new AgentAILoop');
    expect(idx).toBeGreaterThan(-1);
    const block = loop.slice(idx, idx + 900);
    expect(block).not.toContain('abortSignal');
  });

  it('★ 转发 llm:delta (正文) —— 治黑箱的根因修复', () => {
    expect(loop).toContain("subLoop.on('llm:delta'");
    expect(loop).toContain("event: 'delta'");
  });

  it('★ 转发 llm:thinking (深度思考)', () => {
    expect(loop).toContain("subLoop.on('llm:thinking'");
    expect(loop).toContain("event: 'thinking'");
  });

  it('delta 做节流合并 (逐 token 直接转发会打爆 SSE)', () => {
    expect(loop).toContain('deltaBuf');
    expect(loop).toMatch(/setTimeout\(flushDelta,\s*\d+\)/);
  });

  it('★ 墙钟上限: 子智能体不会跑飞', () => {
    expect(loop).toContain('SUBAGENT_WALL_CLOCK_MS');
    expect(loop).toContain('10 * 60 * 1000');
  });

  it('★ 完成/失败都落盘产物 (不依赖主循环存活)', () => {
    expect(loop).toContain('saveArtifact');
    expect(loop).toContain('appendTranscript');
    expect(loop).toContain('registerSubagent');
    expect(loop).toContain('completeSubagent');
  });

  it('★ 产物落盘不依赖主循环: 运行中就先落一份', () => {
    expect(loop).toContain("status: 'running'");
  });

  it('★ SSE 转发带上 delta / text (前端才拿得到正文与思考)', () => {
    expect(chat).toContain("sendEvent('subagent_progress'");
    expect(chat).toContain('delta: typeof info.delta');
    expect(chat).toContain('text: typeof info.text');
  });

  it('★ 续跑入口 _resumeFrom: 构造唤醒输入', () => {
    expect(chat).toContain('_resumeFrom');
    expect(chat).toContain('子智能体唤醒');
  });

  it('★ 续跑内容用 UNTRUSTED delimiter 圈出 (提示注入防线与回注机制一致)', () => {
    expect(chat).toContain('UNTRUSTED subagent-output');
    expect(chat).toContain('END UNTRUSTED');
  });

  it('★ 续跑支持多个子任务合并成一次唤醒', () => {
    expect(chat).toContain('Array.isArray(rf.results)');
  });
});

describe('SubagentArtifactsPanel: 独立产物区', () => {
  const src = read('src/components/SubagentArtifactsPanel.tsx');
  const clean = strip(src);

  it('从网关拉产物列表', () => {
    expect(clean).toContain('/api/subagent-artifacts?workspace=');
  });

  it('就地展开完整过程 (思考/正文/工具分色)', () => {
    expect(clean).toContain('思考过程');
    expect(clean).toContain('最终结果');
    expect(clean).toContain('失败原因');
  });

  it('运行中的产物轮询刷新 (成果陆续落盘)', () => {
    expect(clean).toContain("a.status === 'running'");
    expect(clean).toContain('setInterval(load, 3000)');
  });

  it('挂在右栏 (与任务计划/生成文件并列)', () => {
    const rp = read('src/components/RightPanel.tsx');
    expect(rp).toContain('SubagentArtifactsPanel');
  });
});
