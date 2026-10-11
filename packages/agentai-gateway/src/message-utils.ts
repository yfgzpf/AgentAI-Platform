/**
 * 消息处理工具函数 — 从 agentai-loop.ts 提取
 * 
 * 包含:
 *   - consolidateSystemInjections: 合并连续 [SYSTEM] 注入消息
 *   - sanitizeToolMessages: 清洗工具消息确保 OpenAI 协议合规
 * 
 * 原位置: agentai-loop.ts 行 ~131-174, 270-302
 * 提取理由: 纯函数，无 this 依赖，置信度 95%+
 */

import type { ChatMessage } from './llm-router.js';

/**
 * P0-1.3: 合并连续的 [SYSTEM] 注入消息
 * 多个模块可能在一轮中各推一条 [SYSTEM] 指令, 弱模型容易迷失
 * 此函数将连续的 [SYSTEM] 消息合并为一条, 保留最关键信息
 */
export function consolidateSystemInjections(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length <= 1) return messages;
  const result: ChatMessage[] = [];
  let pendingSystem: string[] = [];

  const flushPending = () => {
    if (pendingSystem.length === 0) return;
    if (pendingSystem.length === 1) {
      result.push({ role: 'user', content: pendingSystem[0]! });
    } else {
      // 多条合并: 保留含 [CRITICAL]/[P0] 标记的安全指令, 其余只保留最后一条
      const critical = pendingSystem.filter(s => /\[CRITICAL\]|\[P0\]/i.test(s));
      const latest = pendingSystem[pendingSystem.length - 1]!;
      if (critical.length > 0 && !critical.includes(latest)) {
        const merged = critical.join('\n---\n') + '\n---\n' + latest;
        result.push({ role: 'user', content: merged.slice(0, 3000) });
      } else if (critical.length > 0) {
        result.push({ role: 'user', content: critical.join('\n---\n').slice(0, 3000) });
      } else {
        result.push({ role: 'user', content: latest });
      }
    }
    pendingSystem = [];
  };

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const isSystemInjection = msg.role === 'user' && content.startsWith('[SYSTEM]');
    if (isSystemInjection) {
      pendingSystem.push(content);
    } else {
      flushPending();
      result.push(msg);
    }
  }
  flushPending();

  return result;
}

const orphanToolToSystem = (msg: ChatMessage): ChatMessage => {
  const anyMsg = msg as any;
  const toolName = anyMsg.name || 'unknown';
  const content = typeof anyMsg.content === 'string' ? anyMsg.content : JSON.stringify(anyMsg.content ?? '');
  return { role: 'system', content: `[tool-result:${toolName}] ${content}` } as ChatMessage;
};

/**
 * 消毒消息数组: 保证 assistant(tool_calls) 与紧随其后的 tool 消息**逐 id 一一配对**
 *
 * OpenAI/DeepSeek 协议要求: assistant 消息里每个 tool_call_id, 后续都必须有对应的
 * tool 消息回复; 少一个就整体 400:
 *   "An assistant message with 'tool_calls' must be followed by tool messages
 *    responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)"
 *
 * ⚠️ 2026-10-11 修复真实 400 事故:
 *   原实现只做「孤立 tool 消息降级」, **从不修剪 assistant 侧的 tool_calls**。
 *   上下文压缩 / token 截断 / 救援降级后, 只要某个 assistant 的 N 个 tool_calls
 *   里有 **部分**(而非全部) tool 回复被丢掉, 就会残留 N 个 id 只配到 M<N 条 tool,
 *   上游直接 400, 且重试是确定性重放 → 3 次全挂。
 *   现在改为: 只保留「确有对应 tool 回复」的 tool_calls, 未配对的一律剔除;
 *   若一个都没配上则整个 tool_calls 摘除(assistant 文本仍保留)。
 */
export function sanitizeToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i] as any;

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      // 收集紧随其后的连续 tool 消息 (协议要求 tool 必须紧跟在 assistant(tool_calls) 之后)
      const toolById = new Set<string>();
      let j = i + 1;
      while (j < messages.length && (messages[j] as any).role === 'tool') {
        const tcId = (messages[j] as any).tool_call_id;
        if (tcId) toolById.add(tcId);
        j++;
      }

      // 只保留有对应 tool 回复的 tool_calls
      const keptCalls = m.tool_calls.filter((tc: any) => tc.id && toolById.has(tc.id));

      if (keptCalls.length === m.tool_calls.length) {
        result.push(messages[i]);
      } else if (keptCalls.length > 0) {
        // 部分配对: 修剪 tool_calls 至已回复的子集 (这是原实现漏掉的 400 根因)
        result.push({ ...m, tool_calls: keptCalls } as ChatMessage);
      } else {
        // 一个都没配上 → 摘除整个 tool_calls; assistant 若还有正文则保留为普通消息
        const { tool_calls: _dropped, ...rest } = m;
        const hasText = typeof m.content === 'string' ? m.content.trim().length > 0 : !!m.content;
        if (hasText) result.push(rest as ChatMessage);
      }

      // 保留命中的 tool 消息; 未命中的降级为 system, 避免协议违规
      for (let k = i + 1; k < j; k++) {
        const t = messages[k] as any;
        if (t.tool_call_id && keptCalls.some((tc: any) => tc.id === t.tool_call_id)) {
          result.push(messages[k]);
        } else {
          result.push(orphanToolToSystem(messages[k]!));
        }
      }
      i = j;
      continue;
    }

    if (m.role === 'tool') {
      // 前面没有 assistant(tool_calls) 的孤立 tool 消息 → 降级为 system 消息
      result.push(orphanToolToSystem(messages[i]!));
      i++;
      continue;
    }

    result.push(messages[i]!);
    i++;
  }

  return result;
}
