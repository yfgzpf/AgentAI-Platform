/**
 * AgentRunner - 绕过 Gateway 直调 LLM API 的流式聊天
 * 仅用于调试模式 (?debug=true), 正常流程走 Gateway
 */
import { GATEWAY_HTTP } from './config';

export interface AgentRunnerHandlers {
  onDelta?: (text: string) => void;
  onDone?: (info: { content: string; usage?: any }) => void;
  onError?: (err: string) => void;
}

/**
 * 直调 LLM API (非流式)
 */
export async function streamChat(
  message: string,
  handlers: AgentRunnerHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const resp = await fetch(GATEWAY_HTTP + '/v1/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, stream: false }),
      signal,
    });
    if (!resp.ok) { handlers.onError?.(`HTTP ${resp.status}`); return; }
    const data = await resp.json();
    handlers.onDone?.({ content: data.content || data.error || '', usage: data.usage });
  } catch (e: any) {
    if (e.name !== 'AbortError') handlers.onError?.(e.message || String(e));
  }
}
