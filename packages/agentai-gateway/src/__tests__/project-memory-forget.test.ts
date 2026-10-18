/**
 * forget(project_memory) 修复验证 — 2026-10-17
 * ==============================================
 * 背景: tools.ts 的 forget handler 用两参调 `initProjectMemory(ws, x)`,
 * 而 project-memory.ts 的签名只有 `(workspace)` — 第二参被 JS 静默忽略:
 *   · "删单条" 分支 delete pm[key] 后调 initProjectMemory(ws, pm)
 *     → 实际执行的是全量重置, 却回报 "✅ 已删除项目记忆: xxx" (假成功)
 *   · "清空全部" 分支碰巧行为正确 (重置即清空), 但语义是错的
 *   · pm 为 null 时 Object.keys(null) 直接 TypeError
 *
 * 本测试锁定修复后的行为:
 *   · 单条删除只重置目标字段, 其他字段原样保留
 *   · 不 delete 顶层键 (删 techStack/preferences 会崩读方)
 *   · 中文键名 (schema 示例) 可用
 *   · 未知键明确失败并列出可用键
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXTRA_HANDLERS } from '../tools.js';
import { runWithWorkspace } from '../request-scope.js';
import { readProjectMemory, initProjectMemory, saveProjectMemory, addFixPattern, addKnownIssue } from '../project-memory.js';

const TMP = path.join(os.tmpdir(), 'agentai-forget-test-' + Date.now());

beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true });
  fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ name: 'forget-test', dependencies: {} }));
});

afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** 在 TMP 工作区上下文中调 forget handler (getWs() 走 currentRequestWorkspace) */
async function forget(args: any) {
  return runWithWorkspace(TMP, () => (EXTRA_HANDLERS as any).forget(args));
}

/** 造一份有数据的项目记忆 */
function seedMemory() {
  initProjectMemory(TMP);
  addFixPattern(TMP, 'tsc 报错', '重启 tsx');
  addKnownIssue(TMP, '端口占用', '换端口', 'low');
  const mem = readProjectMemory(TMP)!;
  mem.facts.push({ key: 'k', value: 'v', source: 'test' });
  mem.preferences.customRules.push('缩进: 2 空格');
  saveProjectMemory(TMP, mem);
}

describe('forget(project_memory) — 单参 initProjectMemory 修复 (2026-10-17)', () => {
  it('P1 清空全部: 数据清零但结构保留, 不崩', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('已清空全部项目记忆');
    const mem = readProjectMemory(TMP)!;
    expect(mem.fixPatterns).toEqual([]);
    expect(mem.knownIssues).toEqual([]);
    expect(mem.facts).toEqual([]);
    expect(mem.preferences.customRules).toEqual([]);
    expect(mem.techStack).toBeTruthy();          // 结构保留
    expect(mem.techStack.language).toBeTruthy();
  });

  it('P2 删单条 fixPatterns: 只清目标字段, knownIssues/facts 原样保留 (旧 bug 会一起清空)', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory', key: 'fixPatterns' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('fixPatterns');
    const mem = readProjectMemory(TMP)!;
    expect(mem.fixPatterns).toEqual([]);
    expect(mem.knownIssues.length).toBe(1);
    expect(mem.facts.length).toBe(1);
    expect(mem.preferences.customRules.length).toBe(1);
  });

  it('P3 中文键名 (schema 示例 key="修复模式"): 真实可删', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory', key: '修复模式' });
    expect(r.success).toBe(true);
    expect(readProjectMemory(TMP)!.fixPatterns).toEqual([]);
    expect(readProjectMemory(TMP)!.knownIssues.length).toBe(1);
  });

  it('P4 删 techStack: 不删键, 重新探测 (buildMemoryContext 读 mem.techStack.language 不崩)', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory', key: '技术栈' });
    expect(r.success).toBe(true);
    const mem = readProjectMemory(TMP)!;
    expect(mem.techStack).toBeTruthy();
    expect(mem.techStack.language).toBeTruthy();
    expect(mem.fixPatterns.length).toBe(1);      // 其他字段不动
  });

  it('P5 删 preferences: 重置为 { customRules: [] } 而非 delete 键', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory', key: 'preferences' });
    expect(r.success).toBe(true);
    const mem = readProjectMemory(TMP)!;
    expect(mem.preferences).toEqual({ customRules: [] });
    expect(mem.fixPatterns.length).toBe(1);
  });

  it('P6 未知键: 明确失败并列出可用键 (不假成功)', async () => {
    seedMemory();
    const r = await forget({ type: 'project_memory', key: '不存在的键' });
    expect(r.success).toBe(false);
    expect(r.output).toContain('可用键');
    expect(r.output).toContain('techStack');
    // 记忆不能被未知键动过
    expect(readProjectMemory(TMP)!.fixPatterns.length).toBe(1);
  });

  it('P7 无记忆文件时清空: 返回"已为空"而非 TypeError', async () => {
    const empty = path.join(os.tmpdir(), 'agentai-forget-empty-' + Date.now());
    fs.mkdirSync(empty, { recursive: true });
    try {
      const r = await runWithWorkspace(empty, () => (EXTRA_HANDLERS as any).forget({ type: 'project_memory' }));
      expect(r.success).toBe(true);
      expect(r.output).toContain('已为空');
    } finally {
      try { fs.rmSync(empty, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('P8 forget(all) 也能清空项目记忆且不崩', async () => {
    seedMemory();
    const r = await forget({ type: 'all' });
    expect(r.success).toBe(true);
    expect(r.output).toContain('项目记忆');
    expect(readProjectMemory(TMP)!.fixPatterns).toEqual([]);
  });
});
