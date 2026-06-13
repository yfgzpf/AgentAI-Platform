import { GATEWAY_HTTP } from './config';

export interface ApiStreamHandlers {
  onDelta?: (text: string) => void;
  onToolStart?: (info: { callId: string; name: string; args: any }) => void;
  onToolResult?: (info: { callId: string; name: string; result: string; ok: boolean; durationMs: number }) => void;
  onDone?: (info: { provider?: string; content?: string; usage?: any }) => void;
  onError?: (err: string) => void;
}

/**
 * 从 SSE 流解析消息并更新 chatStore messages
 * 适配 ChatView 的 segments 模型
 */
export function makeChatHandlers(
  botId: string,
  updateMessage: (id: string, fn: (m: any) => any) => void,
) {
  return {
    onDelta: (text: string) => {
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        const lt = segs.filter((s: any) => s.kind === 'text').pop();
        if (lt && lt.kind === 'text') lt.text += text;
        else segs.push({ kind: 'text', text });
        return { ...m, segments: segs, streaming: true };
      });
    },
    onToolStart: (info: any) => {
      updateMessage(botId, (m: any) => ({
        ...m, segments: [...m.segments, { kind: 'tool', callId: info.callId, name: info.name, state: 'running' }],
      }));
    },
    onToolResult: (info: any) => {
      updateMessage(botId, (m: any) => {
        const segs = m.segments.map((s: any) =>
          s.kind === 'tool' && s.callId === info.callId
            ? { ...s, state: info.ok ? 'success' : 'error', result: info.result, ok: info.ok, durationMs: info.durationMs }
            : s,
        );
        return { ...m, segments: segs };
      });
    },
    onDone: (info: any) => {
      updateMessage(botId, (m: any) => ({ ...m, streaming: false, provider: info.provider }));
    },
    onError: (err: string) => {
      updateMessage(botId, (m: any) => ({ ...m, streaming: false, segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${err}` }] }));
    },
  } as ApiStreamHandlers;
}

export async function apiStream(url: string, body: any, handlers: ApiStreamHandlers, signal?: AbortSignal): Promise<void> {
  try {
    const resp = await fetch(GATEWAY_HTTP + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!resp.ok) { handlers.onError?.(`HTTP ${resp.status}`); return; }
    if (!resp.body) { handlers.onError?.('No response body'); return; }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sepIdx: number;
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const lines = frame.split('\n').map(l => l.trim());
        let eventType = '';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }

        if (!eventType && dataStr) {
          try { const p = JSON.parse(dataStr); if (p.type) eventType = p.type; } catch {}
        }

        if (!eventType || !dataStr) continue;

        try {
          const data = JSON.parse(dataStr);
          switch (eventType) {
            case 'delta': handlers.onDelta?.(data.delta || data.text || ''); break;
            case 'tool_start': handlers.onToolStart?.(data); break;
            case 'tool_result': handlers.onToolResult?.(data); break;
            case 'done': handlers.onDone?.({ provider: data.provider, content: data.content, usage: data.usage }); break;
            case 'error': handlers.onError?.(data.error || data.text || 'Unknown error'); break;
          }
        } catch {}
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') handlers.onError?.(e.message || String(e));
  }
}

export async function apiPost<T = any>(url: string, body: any): Promise<T> {
  const resp = await fetch(GATEWAY_HTTP + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return resp.json() as T;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const resp = await fetch(GATEWAY_HTTP + url);
  return resp.json() as T;
}

export async function apiWriteMemory(data: { userId: string; workspace: string; role: string; content: string; source?: string }): Promise<void> {
  try { await apiPost('/v1/memory', data); } catch {}
}
