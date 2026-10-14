/**
 * 工作区任务不匹配前端提示 — 契约测试 (2026-10-15)
 * ============================================================================
 * 背景: agentai-loop.ts:1703 已加"任务归属判断"系统出口 (workspace-task-routing.test.ts),
 * 本测试锁住**前端镜像** — Composer 的"工作区疑似不匹配"提示条 + 切换工作区按钮
 * 事件通道, 防两套出口 (系统 prompt + 前端提示) 脱节。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

const gui = nodePath.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(nodePath.join(gui, rel), 'utf-8');
const composer = read('src/components/Composer.tsx');
const wsSel = read('src/components/WorkspaceSelector.tsx');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const composerNoCmt = strip(composer);
const wsSelNoCmt = strip(wsSel);

describe('工作区不匹配前端提示 (与系统出口镜像)', () => {
  it('Composer 有 detectTaskWorkspaceMismatch 检测 (关键词启发)', () => {
    expect(composerNoCmt).toMatch(/function\s+detectTaskWorkspaceMismatch/);
    // 命中"另起炉灶"类关键词
    expect(composerNoCmt).toMatch(/newDirKeywords|新建|换个/);
  });

  it('提示条只在 draft 非空且 busy=false 时出现 (不打断生成中)', () => {
    expect(composerNoCmt).toMatch(/mismatch\s*&&\s*!mismatchDismissed/);
    // 依赖里含 busy (生成中不提示)
    expect(composerNoCmt).toMatch(/\[draft,\s*workspaceDir,\s*busy\]/);
  });

  it('"自建目录"按钮会给 AI 追加系统层同源的提示 (output/<task> 或 .agentai/scratch)', () => {
    // 与 agentai-loop.ts:1703 出口文案对齐, 防前端/系统两套措辞脱节
    expect(composerNoCmt).toMatch(/自建目录/);
    expect(composerNoCmt).toMatch(/output\/<task>|\.agentai\/scratch/);
  });

  it('"切换工作区"按钮发 agentai:workspace-select 事件, WorkspaceSelector 监听它弹目录选择', () => {
    expect(composerNoCmt).toMatch(/agentai:workspace-select/);
    expect(wsSelNoCmt).toMatch(/addEventListener\(\s*['"]agentai:workspace-select['"]/);
    // 监听后真弹选择器 (setBrowserOpen(true))
    expect(wsSelNoCmt).toMatch(/setBrowserOpen\(true\)/);
  });

  it('提示条颜色走 CSS 变量 (不硬编码), 符合 AGENTS.md 前端颜色规矩', () => {
    // 提示条 border/background 含 warning 色 — 用 rgba 或 var(--warning), 不许 hex 硬编码 #faad14 之类
    expect(composerNoCmt).toMatch(/var\(--warning\)|rgba\(250,173,20/);
    expect(composerNoCmt).not.toMatch(/backgroundColor:\s*['"]#faad14['"]/i);
  });
});
