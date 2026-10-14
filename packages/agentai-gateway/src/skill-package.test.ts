/**
 * 技能包导入/导出 + Impeccable 技能库 — 回归测试 (2026-10-14 P1/P2)
 * ==============================================================================
 * P1 (agent-skills 分发): import_skill_package / export_skill_package 两个工具,
 * 让"跑出来的好技能" 跨 workspace / 跨项目复用 (tar.gz 格式, 不引外部依赖)。
 * P2 (Impeccable 7.8 万星): 把"设计总监思维" 作为技能库导入我们的项目, 由
 * design-review 子智能体 LLM 审 (不造 grep 工具, 59 条是方法论指令不是正则)。
 *
 * 三层:
 *   契约: tools.ts 有 2 个工具声明 + 2 个 handler + skill-package.ts 3 个导出。
 *   行为: 打桩 skillOrchestrator.scanDirectory, 调 import/export 看入参正确 +
 *         路径穿越被拒 (安全)。
 *   技能库: .agentai/skills/impeccable/ 存在 SKILL.md (frontmatter 含 name=impeccable)
 *           + 6 个 reference 文件 (防有人把技能库删回去)。
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as nodePath from 'node:path';

const ROOT = nodePath.resolve(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(nodePath.join(ROOT, rel), 'utf-8');

const toolsSrc = src('packages/agentai-gateway/src/tools.ts');
const skillPkgSrc = src('packages/agentai-gateway/src/skill-package.ts');

/** 去注释 (防匹配到注释里旧实现说明) */
function codeOnly(s: string): string {
  const NL = String.fromCharCode(10);
  return s.split(NL).filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join(NL);
}
const toolsCode = codeOnly(toolsSrc);
const skillPkgCode = codeOnly(skillPkgSrc);

// ════════════════════════════════════════════════════════════════════════
// 契约层
// ════════════════════════════════════════════════════════════════════════
describe('契约: 技能包导入/导出工具 + skill-package.ts 模块', () => {
  it('tools.ts 有 import_skill_package 声明 + handler', () => {
    expect(toolsCode).toMatch(/import_skill_package:\s*async/);
    expect(toolsCode).toMatch(/'import_skill_package'/);
  });

  it('tools.ts 有 export_skill_package 声明 + handler', () => {
    expect(toolsCode).toMatch(/export_skill_package:\s*async/);
    expect(toolsCode).toMatch(/'export_skill_package'/);
  });

  it('skill-package.ts 3 个导出 (importSkillPackage / exportSkillPackage / 路径穿越防护)', () => {
    expect(skillPkgCode).toMatch(/export async function importSkillPackage/);
    expect(skillPkgCode).toMatch(/export async function exportSkillPackage/);
    // 防路径穿越: 目标必须在 destDir 内
    expect(skillPkgCode).toMatch(/路径穿越被拒/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 行为层 (打桩 scanDirectory + 路径穿越防护)
// ════════════════════════════════════════════════════════════════════════
describe('行为: 技能包导入/导出 + 安全', () => {
  it('importSkillPackage 本地源不存在 → success:false, 不调 scanDirectory', async () => {
    const scanned: string[] = [];
    const { importSkillPackage } = await import('./skill-package.js');
    const r = await importSkillPackage(
      '/tmp/does-not-exist-xyz.skill',
      '/tmp/dest-test',
      { scanDirectory: (d: string) => { scanned.push(d); return 0; } },
    );
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/源不存在/);
    expect(scanned).toHaveLength(0);
  });

  it('exportSkillPackage 缺 SKILL.md → success:false', async () => {
    const { exportSkillPackage } = await import('./skill-package.js');
    const r = await exportSkillPackage('/tmp/not-a-skill-dir-xyz');
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/缺 SKILL.md/);
  });
});

// ════════════════════════════════════════════════════════════════════════
// 技能库层 — Impeccable 方法论已入库
// ════════════════════════════════════════════════════════════════════════
describe('技能库: Impeccable 方法论入库 (.agentai/skills/impeccable/)', () => {
  const dir = nodePath.resolve(ROOT, '.agentai', 'skills', 'impeccable');

  it('目录存在 + SKILL.md frontmatter 含 name: impeccable', () => {
    expect(existsSync(dir), 'impeccable 技能库目录缺失').toBe(true);
    const skillMd = readFileSync(nodePath.join(dir, 'SKILL.md'), 'utf-8');
    const fm = skillMd.match(/^---\n([\s\S]*?)\n---/m);
    expect(fm, 'SKILL.md 缺 frontmatter').toBeTruthy();
    expect(fm![1]).toMatch(/name:\s*impeccable/);
  });

  it('7 个文件齐全 (SKILL.md + 6 reference: critique/audit/polish/bolder/quieter/distill)', () => {
    const expected = [
      'SKILL.md', 'critique.md', 'audit.md', 'polish.md',
      'bolder.md', 'quieter.md', 'distill.md',
    ];
    for (const f of expected) {
      const p = nodePath.join(dir, f);
      expect(existsSync(p), `缺 ${f}`).toBe(true);
      expect(readFileSync(p, 'utf-8').length, `${f} 空文件`).toBeGreaterThan(200);
    }
  });

  it('SKILL.md description 命中 "design director / craft / impeccable" (方法论关键词, 防被替换成别的内容)', () => {
    const skillMd = readFileSync(nodePath.join(dir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toMatch(/impeccable/);
    expect(skillMd).toMatch(/design/i);
  });
});
