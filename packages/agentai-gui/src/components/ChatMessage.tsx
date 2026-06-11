import React from 'react';
import { Tooltip } from 'antd';
import { User, Bot, Sparkles, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Markdown } from './Markdown';
import type { ChatMessage as ChatMessageType } from '../store/chatStore';

interface Props {
  message: ChatMessageType;
  isUser: boolean;
  userName: string;
  isMemory?: boolean;
  onRetry?: () => void;
}

export const ChatMessage: React.FC<Props> = ({ message, isUser, userName, isMemory, onRetry }) => {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', opacity: isMemory ? 0.55 : 1 }}>
      <div style={{
        width: 32, height: 32, borderRadius: isUser ? 10 : '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, flexShrink: 0,
        background: isUser ? 'linear-gradient(135deg, var(--color-primary), #7C3AED)' : 'linear-gradient(135deg, #6366F1, #4F46E5)',
        color: '#fff', boxShadow: isUser ? '0 0 12px rgba(79,70,229,0.3)' : '0 0 8px rgba(99,102,241,0.2)',
      }}>
        {isUser ? (userName[0] || 'U').toUpperCase() : <Bot size={16} />}
      </div>

      <div style={{ maxWidth: '88%', minWidth: 80 }}>
        {!isUser && message.provider && (
          <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'var(--color-bg-soft)', padding: '1px 6px', borderRadius: 4 }}>
              {message.provider}
            </span>
          </div>
        )}

        {isMemory && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4, fontStyle: 'italic' }}>📜 历史记忆</div>}

        <div style={{
          padding: '12px 16px', borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
          background: isUser ? 'linear-gradient(135deg, var(--color-primary), #7C3AED)' : 'var(--color-bg-elevated)',
          color: isUser ? '#fff' : 'var(--color-text)',
          fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.segments.map((s, i) => {
            if (s.kind === 'text') return <Markdown key={i} content={s.text} streaming={message.streaming && i === message.segments.length - 1} />;
            if (s.kind === 'tool') {
              return (
                <div key={i} style={{ margin: '8px 0', padding: 8, background: 'var(--color-bg-soft)', borderRadius: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {s.ok ? <CheckCircle size={14} color="var(--color-success)" /> : s.state === 'running' ? <Clock size={14} color="var(--color-info)" /> : <XCircle size={14} color="var(--color-error)" />}
                    <span style={{ fontWeight: 600 }}>{s.name}</span>
                    {s.durationMs && <span style={{ color: 'var(--color-text-muted)', marginLeft: 'auto' }}>{s.durationMs}ms</span>}
                  </div>
                  {s.result && <pre style={{ margin: 0, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{s.result.slice(0, 500)}</pre>}
                </div>
              );
            }
            return null;
          })}
          {message.streaming && <span style={{ display: 'inline-block', width: 2, height: 16, background: 'var(--color-primary)', marginLeft: 2, animation: 'blink 1s infinite' }} />}
        </div>

        {onRetry && !isUser && !message.streaming && (
          <div style={{ marginTop: 4 }}>
            <span onClick={onRetry} style={{ fontSize: 11, color: 'var(--color-text-muted)', cursor: 'pointer' }}>🔄 重新生成</span>
          </div>
        )}
      </div>
    </div>
  );
};
