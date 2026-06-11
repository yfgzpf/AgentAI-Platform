import type { ApiStreamHandlers } from './api';

/** 直接从浏览器调 LLM API (绕过 Gateway, 用于调试) */
export async function streamChat(
  provider: string,
  messages: { role: string; content: string }[],
  apiKey: string,
  callbacks: ApiStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrls: Record<string, string> = {
    agentai: 'https://apihub.agnes-ai.com/v1',
    deepseek: 'https://api.deepseek.com/v1',
    openai: 'https://api.openai.com/v1',
  };
  const models: Record<string, string> = {
    agentai: 'agnes-2.0-flash',
    deepseek: 'deepseek-v4-flash',
    openai: 'gpt-4o-mini',
  };
  const baseUrl = baseUrls[provider] || baseUrls.agentai;
  const model = models[provider] || models.agentai;

  if (!apiKey) { callbacks.onError?.('API Key 未配置'); return; }

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });

    if (!resp.ok) { callbacks.onError?.(`API error: ${resp.status}`); return; }
    if (!resp.body) { callbacks.onError?.('No response body'); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallBuf = new Map<number, { id?: string; name?: string; args: string }>();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (!d || d === '[DONE]') continue;
          try {
            const chunk = JSON.parse(d);
            const delta = chunk.choices?.[0]?.delta || {};
            if (delta.content) {
              content += delta.content;
              callbacks.onDelta?.(delta.content);
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                let buf = toolCallBuf.get(tc.index);
                if (!buf) { buf = { args: '' }; toolCallBuf.set(tc.index, buf); }
                if (tc.id) buf.id = tc.id;
                if (tc.function?.name) buf.name = tc.function.name;
                if (tc.function?.arguments) buf.args += tc.function.arguments;
              }
            }
            if (chunk.usage) {
              callbacks.onDone?.({ provider, content, usage: chunk.usage });
            }
          } catch {}
        }
      }
    }
    callbacks.onDone?.({ provider, content });
  } catch (e: any) {
    if (e.name !== 'AbortError') callbacks.onError?.(e.message);
  }
}
