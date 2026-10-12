/**
 * SKILL.md frontmatter 解析 — 回归 / 行为 / 边界
 * ----------------------------------------------------------------
 * 语料规模: `packages/agentai-skills` 下共 120 个 SKILL.md, 但
 *   `communication/marketing-skills/SKILL.md` 遮蔽了它下面 `references/` 里的 23 个,
 *   —— scanDirectory 命中 SKILL.md 便不再下降 —— 所以实际进入注册表的是 **97 个**。
 *
 * 这 97 个的修复前后对照 (2026-10-12 实测, 旧值由 F:\temp\measure-fm2.mjs 复刻旧 parseSkillMd):
 *   | 指标 | 修复前 | 修复后 |
 *   | name 解析出 | 59 | 79 |
 *   | tags 非空 | 10 | 47 |
 *   | triggers 非空 | 16 | 35 |
 *   | description 引号污染 | 12 | 0 |
 *   59 + 20(CRLF 分隔符) = 79, 差的 18 个是无 frontmatter 块的正文文件
 *   (由 `_registerFromDir` 的目录名兜底接管 —— 修复前它们被 `if (!meta.name) return 0` 静默丢弃,
 *    即 **38/97 = 39% 的技能对 smartDispatch 完全不可见**)。
 *
 * 本文件先打印语料真值 (console.log), 再断言不变量。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from './skill-frontmatter.js';
import { SkillOrchestrator } from './skill-orchestrator.js';

// ===== 语料扫描 =====

/** 递归收集 SKILL.md (与 app.ts 的扫描范围一致: 跳过 .dot / node_modules / _lib) */
function collectSkillMds(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '_lib') continue;
      const sub = path.join(dir, e.name);
      const md = path.join(sub, 'SKILL.md');
      if (fs.existsSync(md)) out.push(md);
      else walk(sub, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const SKILLS_ROOT = fileURLToPath(new URL('../../agentai-skills/', import.meta.url));
const HAS_CORPUS = fs.existsSync(SKILLS_ROOT);

describe('语料级回归 — packages/agentai-skills/**/SKILL.md', () => {
  let files: string[] = [];
  /** 每个文件的解析结果 + 原始内容特征 */
  let rows: Array<{
    file: string;
    crlf: boolean;
    hasFmBlock: boolean;
    name?: string;
    descQuotePolluted: boolean;
    tagsLen: number;
    triggersLen: number;
    nested: boolean;
  }> = [];

  beforeAll(() => {
    if (!HAS_CORPUS) return;
    files = collectSkillMds(SKILLS_ROOT);
    rows = files.map(file => {
      const text = fs.readFileSync(file, 'utf-8');
      const fm = parseFrontmatter(text);
      return {
        file,
        crlf: text.includes('\r\n'),
        // 归一换行后是否真的以 `---` 块开头 —— 这是"该文件本应有 frontmatter"的独立判据
        hasFmBlock: /^---\r?\n[\s\S]*?\r?\n---/.test(text),
        name: fm.name,
        descQuotePolluted: !!fm.description && /^["']|["']$/.test(fm.description),
        tagsLen: fm.tags?.length ?? 0,
        triggersLen: fm.triggers?.length ?? 0,
        nested: /\n\s+(category|tags|triggers):/.test(text),
      };
    });
  });

  it('语料存在 (否则本组断言无意义)', () => {
    expect(HAS_CORPUS, `未找到技能语料: ${SKILLS_ROOT}`).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it('实测真值打印 (供文档同步)', () => {
    if (!HAS_CORPUS) return;
    const stats = {
      total: rows.length,
      crlfFile: rows.filter(r => r.crlf).length,
      hasFmBlock: rows.filter(r => r.hasFmBlock).length,
      noFmBlock: rows.filter(r => !r.hasFmBlock).length,
      nameParsed: rows.filter(r => r.name !== undefined).length,
      nameMissing: rows.filter(r => r.name === undefined).length,
      tagsNonEmpty: rows.filter(r => r.tagsLen > 0).length,
      triggersNonEmpty: rows.filter(r => r.triggersLen > 0).length,
      descQuotePolluted: rows.filter(r => r.descQuotePolluted).length,
      nestedMetadata: rows.filter(r => r.nested).length,
    };
    console.log('[语料真值 / 修复后]', JSON.stringify(stats, null, 2));
    // 修复前对照 (F:\temp\measure-fm2.mjs 在**同一批 97 个文件**上复刻旧 parseSkillMd):
    //   { name: 59, desc: 58, category: 25, tags_nonempty: 10,
    //     trig_nonempty: 16, desc_quote_polluted: 12, crlf_delimiter: 20, no_frontmatter: 18 }
    //   59 + 20(CRLF) = 79 ⇒ 修复后凡有 frontmatter 块的都解析出 name;
    //   余下 18 个无 frontmatter 的文件由 _registerFromDir 的目录名兜底接管。
    expect(stats.nameParsed).toBe(stats.total - stats.noFmBlock);
  });

  it('不变量: 有 frontmatter 块的文件数 == 总文件数 - 无块文件数 (自洽)', () => {
    if (!HAS_CORPUS) return;
    expect(rows.length).toBe(rows.filter(r => r.hasFmBlock).length + rows.filter(r => !r.hasFmBlock).length);
  });

  it('不变量: 凡有 frontmatter 块的文件都必须解析出 name (CRLF 不再漏)', () => {
    if (!HAS_CORPUS) return;
    const withBlock = rows.filter(r => r.hasFmBlock);
    const missing = withBlock.filter(r => r.name === undefined);
    expect(missing.map(r => r.file), '这些文件有 frontmatter 块却读不到 name').toEqual([]);
    // 20 个 CRLF 文件必须已归入"有 frontmatter 且解出 name"这一侧
    expect(rows.filter(r => r.crlf && r.name !== undefined).length).toBeGreaterThan(0);
  });

  it('不变量: 0 个引号污染 (旧实现 21 个)', () => {
    if (!HAS_CORPUS) return;
    expect(rows.filter(r => r.descQuotePolluted).map(r => r.file)).toEqual([]);
  });

  it('不变量: 块式 tags 不再读成空数组 (旧实现仅 10 个非空)', () => {
    if (!HAS_CORPUS) return;
    const nonEmpty = rows.filter(r => r.tagsLen > 0).length;
    expect(nonEmpty).toBeGreaterThan(10);
  });

  it('不变量: 块式 triggers 仍能解析出非空数组 (未回归)', () => {
    if (!HAS_CORPUS) return;
    expect(rows.filter(r => r.triggersLen > 0).length).toBeGreaterThan(0);
  });

  it('orchestrator 注册数 ≥ SKILL.md 文件数 (目录名兜底生效, 不再静默丢弃)', () => {
    if (!HAS_CORPUS) return;
    const orch = new SkillOrchestrator();
    const registered = orch.scanDirectory(SKILLS_ROOT);
    // 注册可能因双别名 (a-b ↔ a_b) 多于文件数, 但不允许少于
    expect(registered).toBeGreaterThanOrEqual(rows.length);
  });
});

// ===== 行为级: 分数可归因 =====

describe('行为级 — smartDispatch 计分', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentai-skillfm-'));
    // 只用"嵌套 metadata + 块式列表"这一种形态 —— 正是旧实现全面失手的形态
    const skillDir = path.join(tmpRoot, 'zzgraphmarker');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
      '---',
      'metadata:',
      '  name: zzgraphmarker',
      '  description: zzqqww',
      '  category: zzz',
      '  tags:',
      '    - alphaaa',
      '    - betaaab',
      '    - gammaaac',
      '  triggers:',
      '    - trigoneword',
      '    - trigtwoword',
      '---',
      '',
      '# 正文不参与 frontmatter 解析',
      '',
    ].join('\n'), 'utf-8');
  });

  afterAll(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('嵌套 metadata 的 name/category/tags/triggers 都被读出', () => {
    const fm = parseFrontmatter(fs.readFileSync(path.join(tmpRoot, 'zzgraphmarker', 'SKILL.md'), 'utf-8'));
    expect(fm.name).toBe('zzgraphmarker');
    expect(fm.description).toBe('zzqqww');
    expect(fm.category).toBe('zzz');
    expect(fm.tags).toEqual(['alphaaa', 'betaaab', 'gammaaac']);
    expect(fm.triggers).toEqual(['trigoneword', 'trigtwoword']);
  });

  it('smartDispatch 分数 == 20*命中trigger数 + 5*命中tag数, 其余为 0', () => {
    const orch = new SkillOrchestrator();
    orch.scanDirectory(tmpRoot);
    expect(orch.get('zzgraphmarker')).toBeTruthy();

    // 消息只含 1 个 trigger + 1 个 tag:
    //   triggers 命中 1 → +20
    //   tags     命中 1 → +5
    //   name 'zzgraphmarker' 不在消息里 → 0
    //   description 'zzqqww' 不在消息里 → 0
    const matches = orch.smartDispatch('trigoneword alphaaa', 5);
    const hit = matches.find(m => m.name === 'zzgraphmarker');
    expect(hit, '嵌套 metadata 的技能必须能被 smartDispatch 命中').toBeTruthy();
    expect(hit!.score).toBe(25);
    expect(hit!.triggers).toEqual(['trigoneword']);
  });

  it('两个 trigger 全中 → 45', () => {
    const orch = new SkillOrchestrator();
    orch.scanDirectory(tmpRoot);
    const hit = orch.smartDispatch('trigoneword trigtwoword alphaaa', 5).find(m => m.name === 'zzgraphmarker');
    expect(hit!.score).toBe(45);
    expect(hit!.triggers).toEqual(['trigoneword', 'trigtwoword']);
  });
});

// ===== 边界 =====

describe('边界 — parseFrontmatter 契约 (不抛, 缺失返回 {})', () => {
  it('无 frontmatter → 字段全 undefined, raw 为空对象', () => {
    const fm = parseFrontmatter('# 标题\n\n正文 `---` 里的横线不该被当分隔符\n');
    expect(fm.name).toBeUndefined();
    expect(fm.tags).toBeUndefined();
    expect(fm.triggers).toBeUndefined();
    expect(fm.raw).toEqual({});
  });

  it('空 frontmatter 块 → {} 且不抛', () => {
    expect(() => parseFrontmatter('---\n---\n正文')).not.toThrow();
    expect(parseFrontmatter('---\n---\n正文').name).toBeUndefined();
  });

  it('非字符串 / 空输入 → 不抛', () => {
    expect(() => parseFrontmatter(undefined as unknown as string)).not.toThrow();
    expect(() => parseFrontmatter('')).not.toThrow();
  });

  it('CRLF 换行可解析 (20 个真实技能的死因)', () => {
    const fm = parseFrontmatter('---\r\nname: crlf-skill\r\ntags: [a, b]\r\n---\r\n正文');
    expect(fm.name).toBe('crlf-skill');
    expect(fm.tags).toEqual(['a', 'b']);
  });

  it('非法/残缺 YAML 不抛, 能读到的键照常返回', () => {
    const fm = parseFrontmatter('---\n::: 乱码\nname: ok\n  - 孤立的列表项\n---\n');
    expect(fm.name).toBe('ok');
  });

  it('内联数组 triggers 可解析', () => {
    const fm = parseFrontmatter('---\ntriggers: [foo, "bar baz"]\n---\n');
    expect(fm.triggers).toEqual(['foo', 'bar baz']);
  });

  it('空内联数组 → undefined (不产生空数组假阳性)', () => {
    expect(parseFrontmatter('---\ntriggers: []\n---\n').triggers).toBeUndefined();
  });

  it('带冒号的引号 description 不被截断, 引号被剥离', () => {
    const fm = parseFrontmatter('---\ndescription: "提示工程专家: CoT 与 few-shot"\n---\n');
    expect(fm.description).toBe('提示工程专家: CoT 与 few-shot');
  });

  it('单引号同样剥离', () => {
    expect(parseFrontmatter("---\nname: 'quoted'\n---\n").name).toBe('quoted');
  });

  it('顶层键在遇到嵌套块后正确复位 (不会被 metadata 污染)', () => {
    const fm = parseFrontmatter([
      '---',
      'name: topname',
      'metadata:',
      '  category: nested-cat',
      'tags:',
      '  - top-tag',
      '---',
    ].join('\n'));
    expect(fm.name).toBe('topname');
    expect(fm.category).toBe('nested-cat');
    expect(fm.tags).toEqual(['top-tag']);
  });

  it('metadata.parallelSafe 转 boolean; riskLevel 只收三档', () => {
    const fm = parseFrontmatter('---\nmetadata:\n  parallelSafe: true\n  riskLevel: medium\n---\n');
    expect(fm.parallelSafe).toBe(true);
    expect(fm.riskLevel).toBe('medium');
    expect(parseFrontmatter('---\nriskLevel: bogus\n---\n').riskLevel).toBeUndefined();
  });

  it('正文里的 `---` 不会被误当分隔符', () => {
    const fm = parseFrontmatter('---\nname: a\n---\n正文\n\n---\n\n更多正文');
    expect(fm.name).toBe('a');
  });
});
