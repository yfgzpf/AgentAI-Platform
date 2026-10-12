/**
 * SKILL.md frontmatter 解析 (共享实现)
 * ----------------------------------------------------------------
 * 背景 (2026-10-12 实测):
 *   原先有两个几乎同构的"扁平"解析器, 且都有同类缺陷:
 *     - skill-orchestrator.ts:parseSkillMd    (喂 smartDispatch 路由打分)
 *     - auto-skill-discovery.ts:parseSkillMeta (喂技能索引 / TRAE 技能注册)
 *   实测 120 个 SKILL.md 里:
 *     - 20 个用 CRLF 换行 → /^---\n/ 不匹配 → 整个 frontmatter 读不到
 *     - 18 个根本没有 frontmatter 块 (正文以 "# 标题" 开头)
 *     ⇒ 合计 38 个 (32%) 拿到 name=undefined。skill-orchestrator 的
 *       `if (!meta.name) return 0` 会把它们**静默丢弃**, 于是这 38 个技能
 *       永远不会被 smartDispatch 匹配到, 也不会被自动注入/强制调用。
 *     另有 27 个把 category/tags/triggers 嵌套在 `metadata:` 下 (旧解析器
 *       靠 key.trim() 歪打正着读到标量, 但块式列表一律读成空数组)。
 *
 * 本模块负责: 把 SKILL.md 的 YAML 子集解析成一份统一形状。
 *   - 换行归一 (\r\n / \r → \n)
 *   - 一级嵌套块 (metadata: 下的 category/tags/triggers/riskLevel/...)
 *   - 两种列表形态: 内联 [a, b] 与块式 "- a"
 *   - 标量引号剥离 (保留值内冒号)
 *   - 无法解析时返回 {} 且**不抛** (与两个旧解析器的既有契约一致)
 *
 * 刻意不引 yaml 依赖: 项目零新依赖 + 这些 frontmatter 只用到极小子集。
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  triggers?: string[];
  riskLevel?: string;
  version?: string;
  parallelSafe?: boolean;
  author?: string;
  /** 解析到的原始键值 (含未识别的键), 仅用于诊断/测试 */
  raw: Record<string, string | string[] | boolean>;
}

/** 需要从 frontmatter 顶层或 metadata 子层读取的标量键 */
const SCALAR_KEYS = ['name', 'description', 'category', 'riskLevel', 'version', 'author'] as const;
/** 需要读取的列表键 */
const LIST_KEYS = ['tags', 'triggers'] as const;
/** metadata 子层用的键名 → 统一形状的键名 (同名为主, 少数别名) */
const NESTED_ALIAS: Record<string, string> = {
  author: 'author',
  parallelSafe: 'parallelSafe',
  parallel_safe: 'parallelSafe',
  risklevel: 'riskLevel',
};

/** 去掉成对包裹的引号 (单/双), 但不动值内部的引号 */
function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2) {
    const a = s[0];
    const b = s[s.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return s.slice(1, -1).trim();
  }
  return s;
}

/** 内联数组: `[a, b, "c"]` → ['a','b','c']; 顺带容忍 `[{x}, {y}]` 这类残缺模板 */
function parseInlineList(v: string): string[] {
  const inner = v.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map(s => unquote(s.replace(/^[{[]|[}\]]$/g, '')))
    .filter(Boolean);
}

interface ParsedLine {
  indent: number;
  key?: string;
  /** 冒号后的原文 (已 trim), 空字符串表示"key 后面没值, 预期是块式列表" */
  value?: string;
  listItem?: string;
}

function readLine(raw: string): ParsedLine {
  const indent = raw.length - raw.trimStart().length;
  const body = raw.trim();
  if (body.startsWith('- ')) return { indent, listItem: body.slice(2).trim() };
  if (body.startsWith('-')) return { indent, listItem: body.slice(1).trim() };
  const ci = body.indexOf(':');
  if (ci < 0) return { indent };
  return { indent, key: body.slice(0, ci).trim(), value: body.slice(ci + 1).trim() };
}

/**
 * 解析 SKILL.md (或任意 markdown) 的 YAML frontmatter。
 * 输入是**文件全文**; 无 frontmatter / 解析失败一律返回 `{}`。
 */
export function parseFrontmatter(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = { raw: {} };
  try {
    if (typeof text !== 'string' || !text) return out;

    // 1) 换行归一: CRLF / 裸 CR → LF。这是 20 个技能"读不到 name"的根因。
    const src = text.replace(/\r\n?/g, '\n');
    const m = src.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (!m) return out;
    const body = m[1]!;

    // 2) 逐行解析 (只支持一层缩进嵌套 —— 与真实语料的最大深度一致)
    const scalars: Record<string, string> = {};
    const lists: Record<string, string[]> = {};
    let container: string | null = null; // 当前缩进块名 (如 'metadata')
    let listOwner: string | null = null; // 正在收集 "- x" 的键

    for (const raw of body.split('\n')) {
      if (!raw.trim()) continue;
      const line = readLine(raw);

      // 块式列表项 → 挂到最近一个"值为空"的键上
      if (line.listItem !== undefined) {
        if (listOwner) {
          lists[listOwner] = lists[listOwner] || [];
          const item = unquote(line.listItem);
          if (item) lists[listOwner]!.push(item);
        }
        continue;
      }
      if (!line.key) continue;

      // 缩进 0 + 无值 → 既可能是嵌套容器 (`metadata:`), 也可能是块式列表头 (`tags:`)
      //   看下一行才知道; 两个角色同时登记, 后续行会自然消歧。
      if (line.indent === 0 && (line.value === undefined || line.value === '')) {
        container = line.key;
        listOwner = line.key;
        lists[line.key] = lists[line.key] || [];
        continue;
      }
      // 缩进 0 + 有值 → 顶层键
      if (line.indent === 0) {
        container = null;
        listOwner = null;
      }

      const keyRaw = line.key;
      const valRaw = line.value ?? '';
      const key = container ? (NESTED_ALIAS[keyRaw] ?? keyRaw) : keyRaw;

      // 值为空 → 该键可能跟着块式列表
      if (valRaw === '') {
        listOwner = key;
        lists[key] = lists[key] || [];
        continue;
      }
      listOwner = null;

      // 内联数组
      if (valRaw.startsWith('[')) {
        lists[key] = parseInlineList(valRaw);
        continue;
      }
      scalars[key] = unquote(valRaw);
    }

    // 3) 映射到统一形状 (顶层优先, 嵌套块作为兜底)
    for (const k of SCALAR_KEYS) {
      const v = scalars[k];
      if (v === undefined || v === '') continue;
      if (k === 'riskLevel') {
        // 只收可信的三档, 其余丢弃 (避免把任意字符串当风险等级用)
        if (v === 'low' || v === 'medium' || v === 'high') out.riskLevel = v;
      } else {
        (out as any)[k] = v;
      }
    }
    for (const k of LIST_KEYS) {
      const v = lists[k];
      if (v && v.length > 0) (out as any)[k] = v;
    }
    if (scalars['parallelSafe'] !== undefined) {
      out.parallelSafe = scalars['parallelSafe'] === 'true';
    }
    if (scalars['author'] !== undefined) out.author = scalars['author'];

    // 4) raw 快照 (诊断用)
    for (const [k, v] of Object.entries(scalars)) out.raw[k] = v;
    for (const [k, v] of Object.entries(lists)) out.raw[k] = v;
    if (out.parallelSafe !== undefined) out.raw['parallelSafe'] = out.parallelSafe;

    return out;
  } catch {
    return out;
  }
}
