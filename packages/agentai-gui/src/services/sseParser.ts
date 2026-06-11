import type { ChatSegment } from '../store/chatStore';

export type SSEType = 'thinking' | 'delta' | 'tool_start' | 'tool_result' | 'plan' | 'usage' | 'done' | 'error';

export interface SSEEvent {
  type: SSEType;
  data: any;
}

export function parseSSE(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const typeMap: Record<string, SSEType> = {
    thinking: 'thinking', delta: 'delta', tool_start: 'tool_start',
    tool_result: 'tool_result', plan: 'plan', usage: 'usage', done: 'done', error: 'error',
  };

  // Split by double newline
  const frames = raw.split('\n\n').filter(Boolean);
  for (const frame of frames) {
    const lines = frame.split('\n').map(l => l.trim());
    let eventType = '';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
    }

    // Fallback: parse data: {"type":"delta","delta":"..."} format
    if (!eventType && dataStr) {
      try {
        const parsed = JSON.parse(dataStr);
        if (parsed.type) eventType = parsed.type;
      } catch {}
    }

    if (eventType && dataStr) {
      const type = typeMap[eventType] || (eventType as SSEType);
      try {
        events.push({ type, data: JSON.parse(dataStr) });
      } catch {
        events.push({ type, data: { text: dataStr } });
      }
    }
  }
  return events;
}
