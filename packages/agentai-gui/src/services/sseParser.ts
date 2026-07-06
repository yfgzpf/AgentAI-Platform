import type { ChatSegment } from '../store/chatStore';

export type SSEType = 'thinking' | 'delta' | 'reasoning' | 'auto_fix' | 'tool_start' | 'tool_result' | 'plan' | 'usage' | 'iteration' | 'reflect' | 'done' | 'error' | 'widget';

export interface SSEEvent {
  type: SSEType;
  data: any;
}

export function parseSSE(raw: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const typeMap: Record<string, SSEType> = {
    thinking: 'thinking', delta: 'delta', reasoning: 'reasoning', auto_fix: 'auto_fix', tool_start: 'tool_start',
    tool_result: 'tool_result', plan: 'plan', usage: 'usage', iteration: 'iteration', reflect: 'reflect', done: 'done', error: 'error',
    widget: 'widget', // render_widget 工具返回的 widget 渲染事件
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
      // 跳过 HTML 错误页等非 JSON 响应 (gateway 502/503 时可能返回 nginx 默认页面)
      if (dataStr.trimStartsWith('<') || dataStr.trimStartsWith('<!')) {
        console.warn('[sse] 跳过非 JSON 数据:', dataStr.slice(0, 80));
        continue;
      }
      try {
        events.push({ type, data: JSON.parse(dataStr) });
      } catch {
        events.push({ type, data: { text: dataStr } });
      }
    }
  }
  return events;
}
