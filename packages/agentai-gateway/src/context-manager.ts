/**
 * ContextManager — 上下文压缩与缓存命中系统
 * ----------------------------------------------------
 * 学习 Hermes ContextCompressor + Reasonix 缓存策略:
 *
 * 1. 上下文压缩: 当对话超过阈值时，用廉价模型压缩中间轮次
 *    - 保护头部 (system prompt + 首轮对话)
 *    - 保护尾部 (最近 N tokens 的对话)
 *    - 压缩中间部分为结构化摘要
 *
 * 2. 缓存命中: 对重复的 system prompt + workspace 结构做缓存
 *    - 减少重复 token 消耗
 *    - 相同 workspace 的目录结构只发送一次
 *
 * 3. 迭代摘要: 多次压缩时，更新之前的摘要而非重新生成
 */

const CTX_MAX = 128_000; // 默认上下文窗口
const FOLD_THRESHOLD = 0.60; // 60% 时触发压缩
const TAIL_FRACTION = 0.25; // 尾部保留 25%
const SUMMARY_TIMEOUT_MS = 15_000;

// 结构化摘要模板 (学习 Hermes)
const SUMMARY_TEMPLATE = `## 目标
[用户正在尝试完成什么]

## 进度
### 已完成
[已完成的工作 — 包含具体文件路径、命令、结果]
### 进行中
[当前正在进行的工作]
### 阻塞
[遇到的阻塞或问题]

## 关键决策
[重要的技术决策及原因]

## 已解决的问题
[用户提出且已回答的问题 — 包含答案]

## 待处理问题
[尚未回答的问题或请求]

## 相关文件
[读取、修改或创建的文件 — 每个文件附简短说明]

## 剩余工作
[还需要完成的工作 — 作为上下文而非指令]

## 关键上下文
[可能丢失的具体值、错误消息、配置细节]`;

// 缓存: workspace 目录结构 (避免重复发送)
const workspaceCache = new Map<string, { content: string; ts: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 估算消息的 token 数 (中英文混合)
 */
function estimateTokens(content: string): number {
  const cn = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = content.length - cn;
  return Math.ceil(cn * 1.5 + en * 0.4);
}

/**
 * 获取 workspace 目录结构的缓存版本
 * 如果 5 分钟内已获取过，直接返回缓存
 */
export function getCachedWorkspaceListing(workspace: string, freshListing: string): string {
  const cached = workspaceCache.get(workspace);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return `[目录结构(缓存命中)] ${workspace}\n${cached.content}`;
  }
  workspaceCache.set(workspace, { content: freshListing, ts: Date.now() });
  return `[目录结构] ${workspace}\n${freshListing}`;
}

/**
 * 上下文压缩: 当对话超过阈值时压缩中间轮次
 *
 * 算法 (学习 Hermes ContextCompressor):
 *   1. 估算总 token 数
 *   2. 如果超过阈值 → 保护头部 + 尾部
 *   3. 用廉价模型 (agentai) 生成结构化摘要
 *   4. 替换中间部分为摘要
 *   5. 后续压缩时迭代更新摘要
 */
export async function maybeFold(
  appendOnlyLog: any[],
  _systemPrompt: string,
  router: any,
  workspace: string,
  userId: string,
): Promise<{ folded: boolean; beforeTokens: number; afterTokens: number; messagesRemoved: number }> {
  // 1. 估算总 token 数
  let totalTokens = 0;
  for (const m of appendOnlyLog) {
    if (typeof m.content === 'string') {
      totalTokens += estimateTokens(m.content);
    }
  }

  if (totalTokens / CTX_MAX < FOLD_THRESHOLD) {
    return { folded: false, beforeTokens: totalTokens, afterTokens: totalTokens, messagesRemoved: 0 };
  }

  // 2. 确定尾部边界 (保护最近的对话)
  const tailBudget = Math.floor(CTX_MAX * TAIL_FRACTION);
  let tailTokens = 0;
  let tailStart = appendOnlyLog.length;
  for (let i = appendOnlyLog.length - 1; i >= 0; i--) {
    const m = appendOnlyLog[i];
    const tokens = typeof m.content === 'string' ? estimateTokens(m.content) : 0;
    if (tailTokens + tokens > tailBudget) break;
    tailTokens += tokens;
    tailStart = i;
  }

  if (tailStart <= 1) {
    return { folded: false, beforeTokens: totalTokens, afterTokens: totalTokens, messagesRemoved: 0 };
  }

  // 3. 检查是否已有之前的摘要 (迭代更新)
  const head = appendOnlyLog.slice(0, tailStart);
  const existingSummaryIdx = head.findIndex(
    (m: any) => m.role === 'system' && typeof m.content === 'string' && m.content.startsWith('[上下文折叠摘要]')
  );

  let previousSummary: string | null = null;
  let newHeadStart = 0;
  if (existingSummaryIdx >= 0) {
    previousSummary = head[existingSummaryIdx].content.replace('[上下文折叠摘要]\n', '');
    newHeadStart = existingSummaryIdx + 1;
  }

  const turnsToCompress = head.slice(newHeadStart);
  if (turnsToCompress.length === 0) {
    return { folded: false, beforeTokens: totalTokens, afterTokens: totalTokens, messagesRemoved: 0 };
  }

  // 4. 生成结构化摘要 (使用免费模型 agentai)
  const summary = await generateStructuredSummary(turnsToCompress, router, userId, workspace, previousSummary);

  // 5. 替换中间部分
  const summaryMsg = {
    role: 'system' as const,
    content: `[上下文折叠摘要 — 仅供参考]\n以下是之前对话的压缩摘要，作为背景参考，不要重复执行其中已完成的操作:\n\n${summary}\n---\n以下是最新的对话内容:`,
  };
  appendOnlyLog.splice(0, tailStart, summaryMsg);

  return {
    folded: true,
    beforeTokens: totalTokens,
    afterTokens: tailTokens + estimateTokens(summary),
    messagesRemoved: tailStart - 1,
  };
}

/**
 * 生成结构化摘要 (学习 Hermes 的结构化模板)
 * 优先使用免费模型 agentai，不可用时降级
 */
async function generateStructuredSummary(
  messages: any[],
  router: any,
  userId: string,
  workspace: string,
  previousSummary: string | null,
): Promise<string> {
  // 序列化消息 (截断过长的工具输出)
  const serialized = messages
    .filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool')
    .slice(-30) // 最多30条
    .map((m: any) => {
      const content = typeof m.content === 'string' ? m.content : '';
      const truncated = content.length > 2000 ? content.slice(0, 1500) + '\n...[截断]...\n' + content.slice(-500) : content;
      return `[${m.role.toUpperCase()}]${m.name ? ` (${m.name})` : ''}: ${truncated}`;
    })
    .join('\n\n');

  const prompt = previousSummary
    ? `你是一个摘要代理，正在更新上下文压缩摘要。之前的摘要如下，请将新对话融入其中。

之前的摘要:
${previousSummary}

新对话内容:
${serialized}

请更新摘要，保留所有仍然相关的信息，添加新进度，将已完成的项目从"进行中"移到"已完成"。使用以下结构:`
    : `你是一个摘要代理，为另一个AI创建上下文交接摘要。不要回答对话中的问题，只输出结构化摘要。

对话内容:
${serialized}

使用以下结构:`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

    // 优先使用免费模型 agentai 做摘要 (节省成本)
    const res = await router.chat({
      model: 'agentai',
      messages: [
        { role: 'system', content: `${prompt}\n\n${SUMMARY_TEMPLATE}\n\n目标约2000 tokens。要具体——包含文件路径、命令输出、错误消息和具体值。只输出摘要正文。` },
      ],
      userId,
      workspace,
    });
    clearTimeout(timer);
    return res.content?.slice(0, 4000) || '(摘要生成失败)';
  } catch {
    // 降级: 简单截断
    return serialized.slice(0, 2000) || '(摘要生成失败)';
  }
}

/**
 * 工具输出修剪 (学习 Hermes 的廉价预处理)
 * 在压缩前先修剪旧的工具输出，减少 token 消耗
 */
export function pruneOldToolResults(messages: any[], protectTailCount: number = 10): { pruned: number; savedTokens: number } {
  let pruned = 0;
  let savedTokens = 0;
  const placeholder = '[旧工具输出已清除以节省上下文空间]';

  const boundary = Math.max(0, messages.length - protectTailCount);
  for (let i = 0; i < boundary; i++) {
    const m = messages[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 200 && m.content !== placeholder) {
      savedTokens += estimateTokens(m.content);
      m.content = placeholder;
      pruned++;
    }
  }

  return { pruned, savedTokens };
}
