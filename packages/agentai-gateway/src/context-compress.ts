/**
 * context-compress.ts — 上下文压缩的纯函数部分 (可测)
 * =====================================================================
 * 事故 (富哥 2026-10-19 实锤):
 *   长任务里前端被 "⏳ 已自动压缩上下文 (保留 N 条…)" 刷屏, 对话被拉得极长,
 *   而且 "保留条数" 从 46 一路涨到 298 —— 说明**压缩根本没把消息数降下来**。
 *
 * 根因链:
 *   1. 压缩后回写 appendOnlyLog 时, 保留了**所有**以 "# 对话历史摘要" 开头的 system 消息;
 *   2. 而每次压缩都会新造一条摘要 → 摘要一条条累积 (46→298);
 *   3. `messages.length > MAX_MSGS(30)` 从此永远成立 → **每一轮都触发压缩**;
 *   4. 每轮压缩都 emit 一次 `context_compressed` → 前端每轮多一行提示。
 *
 * 所以这里把三件事固化成不变量:
 *   - 摘要只允许存在**一份** (旧的折进新的, 不并列)
 *   - 折叠有字符上限 (防止摘要本身无限膨胀)
 *   - 构造结果里摘要恰好 1 条 (由 buildCompressedMessages 保证, 并有测试锁住)
 */

/** 摘要消息的识别前缀 (必须与写入时的 header 前缀完全一致) */
export const SUMMARY_PREFIX = '# 对话历史摘要';

/** 判断是否是一条"历史摘要" system 消息 */
export function isSummaryMessage(m: any): boolean {
  return !!m
    && m.role === 'system'
    && typeof m.content === 'string'
    && m.content.startsWith(SUMMARY_PREFIX);
}

/**
 * 把 system 消息分成"基础 system"和"历史摘要"两类。
 * 基础 system (系统提示词/台账/计划/指令) 原样保留; 摘要单独拿出来折叠。
 */
export function partitionSystemMessages(systemMsgs: any[]): { base: any[]; summaries: any[] } {
  const base: any[] = [];
  const summaries: any[] = [];
  for (const m of systemMsgs || []) {
    if (isSummaryMessage(m)) summaries.push(m);
    else base.push(m);
  }
  return { base, summaries };
}

/**
 * 把多条旧摘要折成一段文本 (按时间顺序拼接, 超长时**保留最近的**)。
 * 注意: 超出上限时丢的是最早的摘要内容 —— 越早的信息价值越低, 且已被后续摘要覆盖。
 */
export function foldSummaries(summaries: any[], maxChars = 1200): string {
  if (!summaries || summaries.length === 0) return '';
  const bodies = summaries
    .map((m) => String(m.content || '').replace(/^# 对话历史摘要[^\n]*\n?/, '').trim())
    .filter(Boolean);
  if (bodies.length === 0) return '';
  let out = bodies.join('\n\n');
  if (out.length > maxChars) {
    // 从尾部截取, 保证保留的是最新内容
    out = out.slice(out.length - maxChars);
    // 尽量从一个段落边界开始, 避免半句话
    const nl = out.indexOf('\n\n');
    if (nl > 0 && nl < 200) out = out.slice(nl + 2);
    out = `…(更早内容已省略)\n${out}`;
  }
  return out;
}

/**
 * 构造压缩后的消息数组。
 * 不变量: 结果里**恰好一条**摘要 (且紧跟基础 system 之后), 不会累积。
 */
export function buildCompressedMessages(
  baseSystem: any[],
  summaryContent: string,
  recent: any[],
): any[] {
  // 防御: 即使调用方误把旧摘要混进 baseSystem, 也在这里清掉 (双保险)
  const base = (baseSystem || []).filter((m) => !isSummaryMessage(m));
  return [
    ...base,
    { role: 'system' as const, content: summaryContent },
    ...(recent || []),
  ];
}

/**
 * 提示节流判定 —— 压缩提示不该每轮都弹。
 * 规则: 首次必发; 之后至少间隔 minIntervalMs; 或者本次压缩量足够大 (值得说一句)。
 */
export function shouldNotifyCompress(
  lastEmitAt: number,
  nowMs: number,
  compressedCount: number,
  minIntervalMs = 90_000,
  bigCompressThreshold = 15,
): boolean {
  if (!lastEmitAt) return true;
  if (compressedCount >= bigCompressThreshold) return true;
  return nowMs - lastEmitAt >= minIntervalMs;
}
