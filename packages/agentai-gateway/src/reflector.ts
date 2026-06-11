// @ts-nocheck
/**
 * Reflector - 反思门 Agent
 * ----------------------------------------------------
 * 周期性地:
 *   1. 读取最近 N 轮的工具调用记录
 *   2. 用 LLM 总结"哪些有效/哪些无效/用户的偏好"
 *   3. 写入 evolution.jsonl 作为长期记忆
 *
 * 触发条件 (在 AgentAILoop.run 结束后判断):
 *   iteration % reflectEvery === 0  → 触发
 *
 * 闭环:
 *   loop → reflector → evolution → 下次 loop 的 immutable prefix
 */

import { AgentAIRouter } from './llm-router.js';
import { writeEvolution, readEvolution } from './evolution.js';
import { log } from './logger-stub.js';

export interface ReflectorOptions {
  /** 每多少轮反思一次 (默认 10) */
  reflectEvery?: number;
  /** 反思时读取最近多少条 evolution (默认 20) */
  historyLimit?: number;
  /** 用户上下文 (workspace/userId) */
  userId?: string;
  workspace?: string;
  /** 强制反思 (不依赖 reflectEvery 判断) */
  force?: boolean;
}

export interface ReflectorContext {
  /** 用户的最新消息 */
  userMessage: string;
  /** 助手最终回复 */
  finalResponse: string;
  /** 工具调用历史 (本轮) */
  toolCalls: Array<{ name: string; args: any; result: any; success: boolean; durationMs: number }>;
  /** 总迭代次数 */
  iterations: number;
  /** 成功/失败 */
  success: boolean;
}

/**
 * 触发反思
 * 不抛异常, 失败时静默
 */
export async function reflect(
  router: AgentAIRouter,
  ctx: ReflectorContext,
  opts: ReflectorOptions = {},
): Promise<void> {
  const every = opts.reflectEvery ?? 10;

  if (!opts.force && ctx.iterations % every !== 0) return;
  if (ctx.toolCalls.length === 0) return; // 无工具调用, 无需反思

  const t0 = Date.now();

  // 1. 收集最近历史 (含本次)
  const recent = readEvolution(opts.historyLimit ?? 20);

  // 2. 构造反思 prompt
  const prompt = buildReflectorPrompt(ctx, recent);

  try {
    // 3. 调用 LLM 反思 (走最便宜的 provider, 节省成本)
    const result = await router.chat({
      model: 'cheap',
      messages: [
        { role: 'system', content: REFLECTOR_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 300,
    });

    const summary = result.content.trim();

    // 4. 分类: 成功/失败/偏好
    const type = ctx.success ? 'success' : 'failure';
    writeEvolution({
      type,
      content: summary,
      metadata: {
        iterations: ctx.iterations,
        toolCount: ctx.toolCalls.length,
        durationMs: Date.now() - t0,
      },
      sessionId: opts.userId,
      userId: opts.userId,
      workspace: opts.workspace,
    });

    log?.info?.(`[reflector] 反思完成 (${Date.now() - t0}ms, ${type})`);
  } catch (e) {
    // 反思失败不影响主流程
    log?.warn?.(`[reflector] 反思失败: ${(e as Error).message}`);
  }
}

const REFLECTOR_SYSTEM_PROMPT = `你是一个反思助手, 任务是分析最近一次任务执行, 输出 1-2 句简洁的总结。
要求:
1. 中文, 50 字以内
2. 如果有用户偏好, 用 "用户偏好: ..." 前缀
3. 如果有工具调用失败的, 用 "失败: ..." 前缀
4. 如果是成功且无特别偏好, 用 "成功: ..." 前缀
5. 不要废话, 只输出一行`;

function buildReflectorPrompt(ctx: ReflectorContext, recent: any[]): string {
  const lines: string[] = [];

  lines.push('## 当前任务');
  lines.push(`用户: ${ctx.userMessage.slice(0, 300)}`);
  lines.push(`助手: ${ctx.finalResponse.slice(0, 300)}`);
  lines.push(`迭代: ${ctx.iterations} 次`);
  lines.push(`结果: ${ctx.success ? '成功' : '失败'}`);

  lines.push('\n## 工具调用');
  for (const t of ctx.toolCalls.slice(0, 10)) {
    const status = t.success ? '✓' : '✗';
    lines.push(`${status} ${t.name}(${t.durationMs}ms)`);
  }

  if (recent.length > 0) {
    lines.push('\n## 最近历史');
    for (const r of recent.slice(-5)) {
      lines.push(`- [${r.type}] ${r.content}`);
    }
  }

  return lines.join('\n');
}
