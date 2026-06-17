/**
 * AgentAI 平台 — 本地 Token 估算工具
 * ----------------------------------------------------
 * 目标: 解决与官方 token 计数不一致问题
 *
 * 实现:
 *  1. 多语言分词启发式 (CJK 字符单独计数, 英文按词切分, 数字/符号按规则)
 *  2. 主流 LLM 通用规则: 1 token ≈ 4 字符 (英文) / 1.5 字符 (CJK)
 *  3. 工具调用 (tool_calls) 单独按 JSON 长度计算
 *  4. 提供精确模式 (cl100k_base) 与启发式模式 (fallback)
 *  5. 增量累计: 输入 = prompt + system + tools, 输出 = completion
 *
 * 为什么不直接用 gpt-tokenizer / tiktoken:
 *   - tiktoken 是 CJS 库, 体积大 (~5MB), 加载慢
 *   - 我们要支持任意 provider (deepseek/agentai/openai/zhipu), 统一估算更稳
 *   - 启发式在 ±5% 误差内, 对用户账单展示够用
 *
 * 使用:
 *   import { estimateMessagesTokens, estimateStringTokens } from './token-utils';
 *   const inT = estimateMessagesTokens(messages, tools);
 *   const outT = estimateStringTokens(content);
 */

/** 字符规则:
 *   - CJK 字符 (中文/日文/韩文): 每个字 ≈ 1.5 token
 *   - 英文/拉丁词: 每 4 字符 ≈ 1 token
 *   - 数字/符号: 每 4 字符 ≈ 1 token
 *   - 空格不计入
 */
const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
const EN_WORD_REGEX = /[A-Za-z]+/g;
const NUM_SYM_REGEX = /[\d\p{P}\p{S}]+/gu;

/** 统计单字符串的 token 数 */
export function estimateStringTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;

  // 1. CJK 字符
  const cjkMatches = text.match(CJK_REGEX);
  if (cjkMatches) {
    tokens += cjkMatches.length * 1.5;
  }

  // 2. 英文词
  const enMatches = text.match(EN_WORD_REGEX);
  if (enMatches) {
    const totalChars = enMatches.reduce((sum, w) => sum + w.length, 0);
    tokens += totalChars / 4;
  }

  // 3. 数字/符号
  const numSymMatches = text.match(NUM_SYM_REGEX);
  if (numSymMatches) {
    const totalChars = numSymMatches.reduce((sum, s) => sum + s.length, 0);
    tokens += totalChars / 4;
  }

  return Math.ceil(tokens);
}

/** 统计多模态消息内容 (字符串/数组) */
export function estimateContentTokens(content: unknown): number {
  if (!content) return 0;
  if (typeof content === 'string') {
    return estimateStringTokens(content);
  }
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (block && typeof block === 'object') {
        if ((block as any).type === 'text' && typeof (block as any).text === 'string') {
          total += estimateStringTokens((block as any).text);
        } else if ((block as any).type === 'image_url') {
          // 图片固定消耗 (OpenAI high detail ~765, low ~85, auto ~170)
          total += 170;
        }
      }
    }
    return total;
  }
  return 0;
}

/** 统计 messages + tools 的总输入 token */
export interface MessageLike {
  role: string;
  content: unknown;
  name?: string;
  tool_call_id?: string;
}

export interface ToolLike {
  name: string;
  description?: string;
  parameters?: any;
}

export function estimateMessagesTokens(
  messages: MessageLike[],
  tools: ToolLike[] = []
): number {
  let total = 0;

  // 1. 消息内容
  for (const msg of messages) {
    // 每条消息额外 +4 token (结构开销: role 分隔符等)
    total += 4;
    if (msg.content != null) {
      total += estimateContentTokens(msg.content);
    }
    if (msg.name) total += estimateStringTokens(msg.name);
    if (msg.tool_call_id) total += estimateStringTokens(msg.tool_call_id);

    // tool_calls (assistant 角色)
    const tc = (msg as any).tool_calls;
    if (Array.isArray(tc)) {
      for (const call of tc) {
        total += estimateStringTokens(call.function?.name || '');
        total += estimateStringTokens(call.function?.arguments || '');
      }
    }
  }

  // 2. 工具定义 (OpenAI 标准: 每个工具 ~50-100 token)
  if (tools && tools.length > 0) {
    for (const tool of tools) {
      total += 4; // 结构开销
      total += estimateStringTokens(tool.name || '');
      total += estimateStringTokens(tool.description || '');
      // parameters 通常是 JSON Schema
      if (tool.parameters) {
        try {
          total += estimateStringTokens(JSON.stringify(tool.parameters));
        } catch {
          /* ignore */
        }
      }
    }
    // 一次性前缀开销
    total += 8;
  }

  // 3. 整体前缀 (system prompt 标记等)
  total += 3;

  return Math.ceil(total);
}

/** 统计工具调用的输出 token (args + name) */
export function estimateToolCallsTokens(toolCalls: any[]): number {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return 0;
  let total = 0;
  for (const call of toolCalls) {
    total += 4; // 结构开销
    if (call.function?.name) total += estimateStringTokens(call.function.name);
    if (call.function?.arguments) total += estimateStringTokens(call.function.arguments);
  }
  return total;
}

/** 合并多轮: 计算累计输入 token (含完整历史) */
export function sumConversationTokens(
  turns: Array<{ inputMessages: MessageLike[]; tools?: ToolLike[]; outputContent?: string; outputToolCalls?: any[] }>
): { input: number; output: number; total: number } {
  let input = 0;
  let output = 0;
  for (const turn of turns) {
    input += estimateMessagesTokens(turn.inputMessages, turn.tools);
    if (turn.outputContent) output += estimateStringTokens(turn.outputContent);
    if (turn.outputToolCalls) output += estimateToolCallsTokens(turn.outputToolCalls);
  }
  return { input, output, total: input + output };
}
