import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Tag, Space, Avatar, Badge } from 'antd';
import { SendOutlined, ThunderboltOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import { useFrameworkStore, useChatStore } from '../store';
import { Markdown } from './Markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  framework?: 'openclaw' | 'hermes';
  streaming?: boolean;
  tokens?: { prompt: number; completion: number };
}

export const Chat: React.FC = () => {
  const { active, abRatio } = useFrameworkStore();
  const { messages, appendMessage, updateMessage, clearMessages } = useChatStore();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  // 1. 优先 WS, 失败 fallback HTTP POST
  useEffect(() => {
    const wsUrl = (window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789';
    const httpUrl = wsUrl.replace(/^ws/, 'http');
    let ws: WebSocket;
    let retryTimer: any;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        // WS 构造失败, 用 HTTP fallback
        (window as any).__AGENTAI_USE_HTTP__ = true;
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => console.log('[Chat] Gateway connected via WS');
      ws.onclose = () => {
        console.log('[Chat] Gateway WS disconnected, falling back to HTTP');
        (window as any).__AGENTAI_USE_HTTP__ = true;
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'chat:stream' && msg.id) {
            updateMessage(msg.id, (m: ChatMessage) => ({ ...m, content: m.content + msg.delta, streaming: true }));
          } else if (msg.type === 'chat:done' && msg.id) {
            updateMessage(msg.id, (m: ChatMessage) => ({ ...m, streaming: false, tokens: msg.tokens }));
          } else if (msg.type === 'chat:error' && msg.id) {
            updateMessage(msg.id, (m: ChatMessage) => ({ ...m, streaming: false, content: m.content + '\n\n[错误] ' + msg.error }));
          }
        } catch {}
      };
    };
    connect();
    return () => {
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [updateMessage]);

  // 2. 自动滚到底
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // 3. 发送
  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setInput('');

    const userId = 'msg-' + (++idRef.current);
    appendMessage({ id: userId, role: 'user', content: text, ts: Date.now() });

    const botId = 'msg-' + (++idRef.current);
    appendMessage({ id: botId, role: 'assistant', content: '', ts: Date.now(), framework: active, streaming: true });

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        id: botId,
        messages: [...messages, { id: userId, role: 'user', content: text, ts: Date.now() }],
        framework: active,
      }));
    } else {
      // HTTP fallback
      const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');
      fetch(httpUrl + '/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          userId: '富哥',
          workspace: 'F:\\agentai-platform',
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          updateMessage(botId, (m: ChatMessage) => ({
            ...m,
            streaming: false,
            content: data.content || data.error || '(空响应)',
            tokens: data.usage,
          }));
        })
        .catch((err) => {
          updateMessage(botId, (m: ChatMessage) => ({
            ...m,
            streaming: false,
            content: '[' + active + ' error] HTTP 调用失败: ' + err.message + '\n\n请确认 Gateway 在 18789 端口运行。',
          }));
        });
    }
    setSending(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部: 当前框架 */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #303030', display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Badge status={active === 'openclaw' ? 'processing' : 'success'} />
          <Tag color={active === 'openclaw' ? 'blue' : 'purple'} icon={<ThunderboltOutlined />}>
            {active === 'openclaw' ? 'OpenClaw' : 'Hermes'} {abRatio < 1 ? '(' + (abRatio * 100).toFixed(0) + '% A/B)' : ''}
          </Tag>
        </Space>
        <Button size="small" onClick={clearMessages}>清空</Button>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#888', marginTop: 80 }}>
            <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <p>富哥, 发个消息开始干</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role === 'user' ? 'msg-user' : 'msg-bot'}`} style={{ display: 'flex', marginBottom: 16, flexDirection: m.role === 'user' ? 'row-reverse' : 'row' }}>
            <Avatar icon={m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    style={{ background: m.role === 'user' ? '#4F46E5' : (m.framework === 'hermes' ? '#9333EA' : '#3B82F6'), margin: '0 8px' }} />
            <div className={`msg-bubble ${m.role === 'user' ? 'msg-bubble-user' : 'msg-bubble-bot'}`} style={{ maxWidth: '70%', padding: '8px 12px', borderRadius: 8, background: m.role === 'user' ? '#4F46E5' : '#262626' }}>
              {m.role === 'assistant' ? <Markdown content={m.content} streaming={m.streaming} /> : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
              {m.tokens && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{m.tokens.prompt}+{m.tokens.completion} tokens</div>}
            </div>
          </div>
        ))}
      </div>

      {/* 输入框 */}
      <div style={{ padding: 12, borderTop: '1px solid #303030', display: 'flex', gap: 8 }}>
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="输入消息, Enter 发送, Shift+Enter 换行"
          autoSize={{ minRows: 1, maxRows: 4 }}
          disabled={sending}
        />
        <Button type="primary" icon={<SendOutlined />} onClick={send} loading={sending} disabled={!input.trim()}>发送</Button>
      </div>
    </div>
  );
};
