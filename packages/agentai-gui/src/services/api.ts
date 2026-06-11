declare global { interface Window { __AGENTAI_GATEWAY__?: string; } }
const GATEWAY_URL = (typeof window !== 'undefined' ? window.__AGENTAI_GATEWAY__ : '') || '';

export interface ApiStreamHandlers {
  onDelta?: (text: string) => void;
  onToolStart?: (info: { callId: string; name: string; args: any }) => void;
  onToolResult?: (info: { callId: string; name: string; result: string; ok: boolean; durationMs: number }) => void;
  onDone?: (info: { provider: string; content?: string; usage?: any }) => void;
  onError?: (err: string) => void;
}

export async function apiStream(url: string, body: any, handlers: ApiStreamHandlers, signal?: AbortSignal): Promise<void> {
  try {
    const resp = await fetch(GATEWAY_URL + url, {
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
  const resp = await fetch(GATEWAY_URL + url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return resp.json() as T;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const resp = await fetch(GATEWAY_URL + url);
  return resp.json() as T;
}

export async function apiWriteMemory(data: { userId: string; workspace: string; role: string; content: string; source?: string }): Promise<void> {
  try { await apiPost('/v1/memory', data); } catch {}
}
