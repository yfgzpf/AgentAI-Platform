/**
 * 发现提取 (Finding Extract) — 2026-10-21
 * ════════════════════════════════════════════════════════════════════════
 * 立项原因 (富哥赏金任务实锤): 会话压缩**只保动作不保发现** ——
 *   · 层1 历史压缩 (agentai-loop.ts:4365) 摘要只留: 用户请求/AI 操作/
 *     文件路径/错误记录/工具计数 —— **工具产出内容本体整个丢弃**;
 *   · 任务台账 (task-ledger.ts, 唯一宣称"扛压缩"的机制) 设计要点写死
 *     "记录**动作**": reads/writes/commands/failures/decisions ——
 *     **无 findings 字段**;
 *   · 层0 token-compressor 的 crushJson 把同构数组打成 2 样本+计数。
 *   净效果: "扫出来的事实" (anyshare 全 200 / host 定位 / 版本泄露)
 *   压缩后不存在于任何地方 → AI 失忆后反复重读文件或凭空猜。
 *
 * 本模块是两层消费的**单一真源**:
 *   ① agentai-loop.ts 历史压缩 — 摘要加「## 关键发现」段 (F1)
 *   ② agentai-loop.ts 台账 hook — recordFinding 进台账 (F2, 每轮注入)
 *
 * 设计约束:
 *   - 纯函数、零依赖、零 LLM 调用 (每轮每个工具产出都跑, 不能贵)
 *   - 错误产出不提取 (两层消费都已有专门错误通道, 不重复占位)
 *   - [SYSTEM] 行跳过 (防自噬: 系统指令不是工具产出, 不当事实证据 —
 *     见 auto-lint-selftrigger.test.ts 同款教训)
 *   - 短输出不提取 (<minChars): 模型在近期上下文里还记得, 不占额度
 */

export interface ExtractFindingsOpts {
  /** 最多提取几条 (默认 3) */
  max?: number;
  /** 产出少于此字符数不提取 (默认 60) — 短输出模型自己记得住 */
  minChars?: number;
}

/** 单条发现最大字符数 (超长截断, 台账/摘要都要控量) */
const MAX_LINE = 120;
/** 行长度合法区间: 过滤装饰线/超长行 */
const MIN_LINE = 8;
const MAX_LINE_IN = 200;
/** 模式扫描的行数上限 (头条不受限; 防止超大输出扫全量) */
const SCAN_LINES = 200;

/**
 * 发现模式 — 命中即认为该行陈述了一个"事实"而非过程噪音。
 *   bounty 向: 未授权/泄露/漏洞/CVE/指纹/端口/高中低危
 *   通用向: version 泄露 / HTTP 结论码 (200/302/401/403/5xx)
 */
const FINDING_PATTERN = /(未授权|泄露|漏洞|vuln|CVE-\d|指纹|fingerprint|高危|中危|低危|开放端口|open port|发现|version|versio|200 |201 |301 |302 |401 |403 |500 |502 |503 )/i;

/** 错误产出不提取 (首行错误特征; 错误在两层消费里都有专门通道) */
function looksLikeError(text: string): boolean {
  const first = (text.split('\n', 1)[0] || '').trim();
  return /^\[ERROR\]|^Error\b|^ENOENT|^EACCES|^EPERM|^SyntaxError|^TypeError|^ReferenceError|^ModuleNotFoundError/i.test(first);
}

/**
 * 从工具产出中提取"发现行" (事实, 非过程)。
 *
 * 提取策略:
 *   ① 头条 — 工具产出的第一行有效内容通常是结论行
 *      ("== 0. alive check ==" / "140 hosts alive" / "probe3 抓取完成")
 *   ② 发现模式行 — 命中 FINDING_PATTERN 的行 (按出现顺序, 满了即停)
 *
 * 去重 + 按 max 截断。返回空数组 = 没有值得扛过压缩的事实。
 */
export function extractFindings(
  output: string | undefined | null,
  opts: ExtractFindingsOpts = {},
): string[] {
  const max = Math.max(1, opts.max ?? 3);
  const minChars = opts.minChars ?? 60;
  const text = String(output ?? '');
  if (text.length < minChars) return [];
  if (looksLikeError(text)) return [];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= MIN_LINE && l.length <= MAX_LINE_IN && !/^\[SYSTEM/.test(l));
  if (lines.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (l: string): void => {
    const v = l.slice(0, MAX_LINE);
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  };

  // ① 头条: 第一行有效内容 (通常是结论行)
  push(lines[0]);

  // ② 发现模式行 (从头扫, 有上限; 满了即停)
  for (const l of lines.slice(0, SCAN_LINES)) {
    if (out.length >= max) break;
    if (FINDING_PATTERN.test(l)) push(l);
  }

  return out.slice(0, max);
}
