/**
 * 批次7 — 中文元数据进路由打分 + 正文兜底 + readSkillBody CRLF 修复
 * ----------------------------------------------------------------
 * 2026-10-12 Step 0 探针结论 (24 条消息, commit 890f059 基线):
 *   T1 (新文本 description+description_zh, 旧分词) → 0 分消息 11 → 9, 阈值误触发 0
 *   T2 (T1 + 中文 bigram)                          → 0 分 11 → 3, 但 6 条消息的
 *       top1 被 libtv-skill 夺走 (含"生成一个 PPT"错配), 且 1 条越过 0.5 注入阈值
 *       ⇒ 否决
 *   agentai-loop 内联打分器 L0 ≡ L1 ≡ L2 (top1 全同)
 *       ⇒ 实测无收益, 该 6400 行零覆盖文件不动
 *
 * 本文件断言的是**实现后**的实际行为, 不是预言值。
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter, extractBodyMeta, scorableText, tokenizeScorable } from './skill-frontmatter.js';
import { SkillOrchestrator } from './skill-orchestrator.js';
import { readSkillBody } from './auto-skill-discovery.js';

const SKILLS = fileURLToPath(new URL('../../agentai-skills/', import.meta.url));
const HAS_CORPUS = fs.existsSync(SKILLS);

// 判据: 归一换行后文件首行是否为 `---` (frontmatter 块开头)
const HAS_FM_BLOCK = /^---[ \t]*(?:\r?\n|$)/;

describe('批次7 — 解析 description_zh / description_en / 正文兜底', () => {
  it('description_zh 解析且带引号剥离 (66 个真实技能在用)', () => {
    const fm = parseFrontmatter('---\nname: s\ndescription_zh: "中文描述: 带冒号"\ndescription_en: "English desc"\n---\n');
    expect(fm.descriptionZh).toBe('中文描述: 带冒号');
    expect(fm.descriptionEn).toBe('English desc');
    // 无 description 键时, description 由 description_en 兜底 —— 这是批次7 新增的回退链
    expect(fm.description).toBe('English desc');
  });

  it('无 description 键 → description_en → 正文描述 → H1 标题 依次回退', () => {
    const text = '---\nname: x\ndescription_en: "English Fallback"\n---\n# H1 Title\n\n正文第一行\n';
    expect(parseFrontmatter(text).description).toBe('English Fallback');
    expect(parseFrontmatter('---\nname: y\n---\n# H1 T\n\n正文 D\n').description).toBe('正文 D');
    expect(parseFrontmatter('---\nname: z\n---\n# H1 Only\n').description).toBe('H1 Only');
  });

  it('18 个无 frontmatter 文件: 正文兜底补上 description (17/18 有可取描述)', () => {
    if (!HAS_CORPUS) return;
    const out: string[] = [];
    (function walk(d: string, dep: number) {
      if (dep > 3) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_lib') continue;
        const s = path.join(d, e.name);
        if (fs.existsSync(path.join(s, 'SKILL.md'))) out.push(path.join(s, 'SKILL.md'));
        else walk(s, dep + 1);
      }
    })(SKILLS, 0);
    let noFm = 0, noFmFilled = 0;
    for (const f of out) {
      const t = fs.readFileSync(f, 'utf-8').replace(/\r\n?/g, '\n');
      const fm = parseFrontmatter(t);
      if (!HAS_FM_BLOCK.test(t)) {
        noFm++;
        // 正文兜底拿到的 description 不等于目录名占位才算 "已补"
        if (fm.description && fm.description !== path.basename(path.dirname(f))) noFmFilled++;
      }
      if (!fm.description) console.error(`[FAIL] description 仍为空: ${f}`);
    }
    expect(noFm).toBe(18);
    // 全部 18 个无 frontmatter 文件都拿到了正文兜底描述 (18/18)
    expect(noFmFilled).toBe(18);
  });

  it('正文兜底跳过工程纪律型文件里的 **元信息** 与水平线', () => {
    const t = '# H1\n\n**参考来源**: x\n\n---\n\n## 核心理念\n\n真正的描述。\n';
    expect(extractBodyMeta(t).description).toBe('真正的描述。');
  });

  it('正文兜底不被代码围栏里的 key: value 骗到', () => {
    const t = '# H1\n\n```typescript\nname: fake\n---\n```\n\n真正的描述行\n';
    expect(extractBodyMeta(t).description).toBe('真正的描述行');
  });

  it('有 frontmatter 且 description 在时, 正文不得覆盖', () => {
    const fm = parseFrontmatter('---\nname: a\ndescription: real\n---\n# H1\n\n正文描述\n');
    expect(fm.description).toBe('real');
    // extractBodyMeta 本身不感知 description 是否已存在, 只负责兜底
    expect(extractBodyMeta('# H1\n\n正文描述\n').description).toBe('正文描述');
    expect(fm.description).toBe('real');
  });

  it('CRLF frontmatter 的 readSkillBody 必须剥掉 frontmatter (批次7 修)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentai-rsb-'));
    const f = path.join(dir, 'SKILL.md');
    fs.writeFileSync(f, '---\r\nname: crlfskill\r\ndescription: c\r\n---\r\n正文指令\r\n', 'utf-8');
    const body = readSkillBody(f);
    expect(body).toBe('正文指令');
    expect(body).not.toContain('---');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('LF frontmatter 的 readSkillBody 行为不变', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentai-rsb2-'));
    const f = path.join(dir, 'SKILL.md');
    fs.writeFileSync(f, '---\nname: lf\ndescription: l\n---\n正文 L\n', 'utf-8');
    expect(readSkillBody(f)).toBe('正文 L');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('批次7 — smartDispatch 分数归因 (T1 口径)', () => {
  it('description_zh 参与打分, 权重仍为每词 +1', () => {
    const orch = new SkillOrchestrator();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentai-zh-'));
    const skillDir = path.join(root, 'testing', 'zhmarker');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---', 'name: zhmarker',
      'description: english-only-marker',
      'description_zh: "中文测试词 独特中文标记词 触发词匹配"',
      'triggers:', '  - 触发词匹配', '---', '',
    ].join('\n'), 'utf-8');
    const registered = orch.scanDirectory(root);
    expect(registered, '该技能必须先注册进调度器').toBeGreaterThan(0);
    // 对照组: 消息不含 description_zh 的词 → trigger +20, 描述命中 0-1 词
    const hitNoZh = orch.smartDispatch('完全无关词 触发词匹配', 3).find(m => m.name === 'zhmarker');
    expect(hitNoZh, 'trigger 命中必须能匹配到该技能').toBeTruthy();
    expect(hitNoZh!.score).toBeGreaterThanOrEqual(20);
    // 实验组: 额外命中 description_zh 里的中文分词 → 分数严格更高
    const hit = orch.smartDispatch('独特中文标记词 触发词匹配', 3).find(m => m.name === 'zhmarker');
    expect(hit, '带中文 description_zh 的技能必须能被命中').toBeTruthy();
    expect(hit!.score).toBeGreaterThan(hitNoZh!.score);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('tokenizeScorable / scorableText 是打分唯一口径', () => {
    const toks = tokenizeScorable('提示工程 中文 测试');
    expect(toks).toContain('提示工程');
    expect(toks).toContain('测试');
    expect(tokenizeScorable('abc')).toEqual(['abc']);
    // 单字符 (len<2) 被丢
    expect(tokenizeScorable('a b cd')).toEqual(['cd']);
    expect(scorableText({ description: 'A', descriptionZh: 'B' })).toBe('A B');
    expect(scorableText({ description: 'A' })).toBe('A');
    expect(scorableText({})).toBe('');
  });
});
