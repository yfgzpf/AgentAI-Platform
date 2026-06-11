const CTX_MAX = 1_000_000;
const FOLD_THRESHOLD = 0.70;
const TAIL_FRACTION = 0.25;
const SUMMARY_TIMEOUT_MS = 10_000;

export async function maybeFold(
  appendOnlyLog: any[],
  _systemPrompt: string,
  router: any,
  workspace: string,
  userId: string,
): Promise<{ folded: boolean; beforeTokens: number; afterTokens: number; messagesRemoved: number }> {
  let totalTokens = 0;
  for (const m of appendOnlyLog) {
    if (typeof m.content === 'string') {
      const cn = (m.content.match(/[\u4e00-\u9fff]/g) || []).length;
      const en = m.content.length - cn;
      totalTokens += Math.ceil(cn * 1.5 + en * 0.4);
    }
  }
  if (totalTokens / CTX_MAX < FOLD_THRESHOLD) {
    return { folded: false, beforeTokens: totalTokens, afterTokens: totalTokens, messagesRemoved: 0 };
  }

  const tailBudget = Math.floor(CTX_MAX * TAIL_FRACTION);
  let tailTokens = 0;
  let tailStart = appendOnlyLog.length;
  for (let i = appendOnlyLog.length - 1; i >= 0; i--) {
    const m = appendOnlyLog[i];
    let tokens = 0;
    if (typeof m.content === 'string') {
      const cn = (m.content.match(/[\u4e00-\u9fff]/g) || []).length;
      const en = m.content.length - cn;
      tokens = Math.ceil(cn * 1.5 + en * 0.4);
    }
    if (tailTokens + tokens > tailBudget) break;
    tailTokens += tokens;
    tailStart = i;
  }
  if (tailStart <= 1) return { folded: false, beforeTokens: totalTokens, afterTokens: totalTokens, messagesRemoved: 0 };

  const head = appendOnlyLog.slice(0, tailStart);
  const summary = await _generateSummary(head, router, userId, workspace);
  const summaryMsg = { role: 'system' as const, content: `[上下文折叠摘要]\n${summary}\n---\n以下是最新的对话内容:` };
  appendOnlyLog.splice(0, tailStart, summaryMsg);
  return { folded: true, beforeTokens: totalTokens, afterTokens: tailTokens + Math.ceil((summary.length || 0) * 0.4), messagesRemoved: tailStart - 1 };
}

async function _generateSummary(messages: any[], router: any, userId: string, workspace: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    const res = await router.chat({
      model: 'deepseek',
      messages: [
        { role: 'system', content: '请把上面的对话总结为一段简洁的 prose，保留：用户目标、已做的决策、已检查的文件、还有哪些未完成。不要列步骤，用自然语言。' },
        ...messages.slice(-30),
      ],
      userId,
      workspace,
    });
    clearTimeout(timer);
    return res.content?.slice(0, 2000) || '(摘要生成失败)';
  } catch { return '(摘要生成失败)'; }
}
