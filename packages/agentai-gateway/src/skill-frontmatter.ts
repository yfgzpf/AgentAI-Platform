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
 * 2026-10-12 (批次7) 追加:
 *   - 解析 `description_zh` / `description_en` —— 实测 66 个 SKILL.md 带
 *     `description_zh`, 但全仓 .ts/.tsx 里 `grep -rn description_zh` **零匹配**,
 *     即这批中文元数据从来没进过任何打分器。
 *   - 正文兜底 `extractBodyMeta`: 18 个 SKILL.md 完全没有 frontmatter 块,
 *     且其中 16 个的正文第 2/3 行就是一句中文说明。没有这一步, 它们注册后的
 *     description 只能是目录名兜底的 "xxx skill" (等于没有)。
 *     ⚠️ 只在**正文**里找, 绝不把正文的 `---` 水平线或代码围栏里的 `key: value`
 *     当元数据 (agents/engineering-discipline 这两样都有)。
 *
 * 刻意不引 yaml 依赖: 项目零新依赖 + 这些 frontmatter 只用到极小子集。
 */

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  /** frontmatter 的 `description_zh` (66 个技能在用; 2026-10-12 前全仓零读取) */
  descriptionZh?: string;
  /** frontmatter 的 `description_en` (常与 description_zh 成对出现) */
  descriptionEn?: string;
  /** 正文第一个 `# H1` 的标题 (仅正文兜底用) */
  title?: string;
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
 * 从正文里兜底提取标题与描述 (仅在 frontmatter 没给 description 时用)。
 *
 * 规则: 跳过 frontmatter 块 → 先记下第一个 `# H1` 作为 title → 之后取**第一行
 * 非空、且不是标题/引用/列表/表格/HTML/水平线/加粗元信息行**的正文作为描述。
 * 遇代码围栏 (``` / ~~~) 整段跳过, 避免把代码里的 `key: value` 当描述。
 * 最多前探 40 行, 描述截断到 300 字符; 找不到就返回空 —— 不猜。
 *
 * 实测 (2026-10-12): ppt-generator 命中第 2 行；brand-design 需要跳过
 * `## 技能概述` 才命中第 5 行；engineering-discipline 要连跳
 * `**参考来源**` / `---` / `## 核心理念` 三行, 命中第 11 行。
 */
export function extractBodyMeta(text: string): { title?: string; description?: string } {
  const out: { title?: string; description?: string } = {};
  try {
    if (typeof text !== 'string' || !text) return out;
    const src = text.replace(/\r\n?/g, '\n');
    // 有 frontmatter 块就只在它之后找; 否则全文都是正文
    const fm = src.match(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/);
    const body = fm ? src.slice(fm[0].length) : src;

    let inFence = false;
    let scanned = 0;
    for (const raw of body.split('\n')) {
      if (++scanned > 40) break;
      const line = raw.trim();
      if (line.startsWith('```') || line.startsWith('~~~')) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (!line) continue;
      // 标题: 记第一个 H1 当标题, 但不当描述
      if (/^#{1,6}\s/.test(line)) {
        if (!out.title && /^#\s/.test(line)) out.title = line.replace(/^#\s+/, '').trim();
        continue;
      }
      // 引用 / 列表 / 表格 / HTML / 水平线(---, ***, ___) / 加粗元信息(**参考来源**:)
      if (/^[>*+|<-]/.test(line) || /^[-*_]{3,}$/.test(line) || /^\d+\./.test(line)) continue;
      out.description = line.length > 300 ? line.slice(0, 300) : line;
      break;
    }
  } catch {
    // 兜底失败就当没有, 与 parseFrontmatter 的"不抛"契约一致
  }
  return out;
}

/**
 * 打分唯一口径 (批次7, 2026-10-12): 路由打分器喂给"描述关键词"那一步的
 * 文本与分词都从这里出, 避免重演批次6 暴露过的"每个打分器各切一套"口径不一致。
 *
 * 注意: 这是喂**输入**, 不是改**权重** —— smartDispatch 的
 * +20/+10/+5/+1 与 0.5/0.7 阈值一行不动。
 */
export function scorableText(s: { description?: string; descriptionZh?: string }): string {
  const p: string[] = [];
  if (s.description) p.push(s.description);
  if (s.descriptionZh) p.push(s.descriptionZh);
  return p.join(' ');
}

/**
 * 分词: 与 smartDispatch 现用的 `/[\s,，、]+/` (len>=2) 保持**完全一致** (T1)。
 * 2026-10-12 Step 0 实测 24 条消息: T1 只把 2 条 0 分消息提到 1 分、无重排、
 * 无阈值误触发; 而"中文 2 字滑窗 (T2)"会让 libtv-skill 这类长描述靠
 * bigram 刷分夺走 6 条消息的 top1 (含"生成一个 PPT"等明显错配), 并把
 * "把这个视频转成音频"顶到 15 分越过 0.5 注入阈值 —— **否决**, 故这里不引入
 * 滑窗。中文精确匹配属于"分词口径之外的更大改造", 见 docs §十四 如实披露。
 */
export function tokenizeScorable(text: string): string[] {
  return text.toLowerCase().split(/[\s,，、]+/).filter(w => w.length >= 2);
}

/**
 * 解析 SKILL.md (或任意 markdown) 的 YAML frontmatter。
 * 输入是**文件全文**; 无 frontmatter / 解析失败一律返回 `{}`。
 * description 按 `description → description_en → 正文描述 → H1 标题` 兜底,
 * 调用方无需自己再做回退。
 */
export function parseFrontmatter(text: string): SkillFrontmatter {
  const out: SkillFrontmatter = { raw: {} };
  try {
    if (typeof text !== 'string' || !text) return out;

    // 1) 换行归一: CRLF / 裸 CR → LF。这是 20 个技能"读不到 name"的根因。
    const src = text.replace(/\r\n?/g, '\n');
    const m = src.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

    // 2) 正文兜底 (无 frontmatter 块时尤其关键) —— 先算, 最后参与 description 回退
    const bodyMeta = extractBodyMeta(src);
    if (bodyMeta.title) out.title = bodyMeta.title;

    if (m) {
      const body = m[1]!;

      // 3) 逐行解析 (只支持一层缩进嵌套 —— 与真实语料的最大深度一致)
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

      // 4) 映射到统一形状 (顶层优先, 嵌套块作为兜底)
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
      // 中文/英文描述 (批次7): 不新增字段就永远读不到
      if (scalars['description_zh']) out.descriptionZh = scalars['description_zh'];
      if (scalars['description_en']) out.descriptionEn = scalars['description_en'];

      // 5) raw 快照 (诊断用)
      for (const [k, v] of Object.entries(scalars)) out.raw[k] = v;
      for (const [k, v] of Object.entries(lists)) out.raw[k] = v;
      if (out.parallelSafe !== undefined) out.raw['parallelSafe'] = out.parallelSafe;
    }

    // 6) description 回退链 (一处解析, 两个调用点都不用自己回退)
    if (!out.description) {
      out.description = out.descriptionEn || bodyMeta.description || out.title;
    }

    return out;
  } catch {
    return out;
  }
}
