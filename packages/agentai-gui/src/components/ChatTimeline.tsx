/**
 * ChatTimeline — 对话时间线面板 (参考 Reasonix 风格)
 *   - 显示当前对话的所有轮次
 *   - 鼠标悬停显示消息摘要
 *   - 点击跳转到对应消息
 *   - 区分用户/AI消息
 *   - 显示工具调用次数
 */
import React, { useMemo, useState } from 'react';
import { useChatStore, type ChatMessage } from '../store/chatStore';

interface TurnItem {
  id: string;
  role: 'user' | 'assistant';
  summary: string;
  toolCount: number;
  ts: number;
  index: number;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  const min = diff / 60_000;
  if (min < 60) return `${Math.floor(min)}分钟前`;
  const hr = min / 60;
  if (hr < 24) return `${Math.floor(hr)}小时前`;
  return `${Math.floor(hr / 24)}天前`;
}

function extractSummary(msg: ChatMessage, maxLen = 40): string {
  const text = msg.segments
    .filter(s => s.kind === 'text')
    .map(s => s.text)
    .join('')
    .trim();
  if (!text) {
    const tools = msg.segments.filter(s => s.kind === 'tool');
    if (tools.length > 0) return `调用 ${tools.length} 个工具`;
    return '...';
  }
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

export const ChatTimeline: React.FC<{
  onNavigate?: (messageId: string) => void;
}> = ({ onNavigate }) => {
  const messages = useChatStore(s => s.messages);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // 将消息列表转为轮次列表
  const turns = useMemo<TurnItem[]>(() => {
    const items: TurnItem[] = [];
    let idx = 0;
    for (const msg of messages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        items.push({
          id: msg.id,
          role: msg.role,
          summary: extractSummary(msg),
          toolCount: msg.segments.filter(s => s.kind === 'tool').length,
          ts: msg.ts,
          index: idx++,
        });
      }
    }
    return items;
  }, [messages]);

  const roundCount = useMemo(() => {
    // 一轮 = 一对 user + assistant
    const userCount = turns.filter(t => t.role === 'user').length;
    return userCount;
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted-2)', fontSize: 12 }}>
        暂无对话
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部统计 */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>
          对话时间线
        </span>
        <span style={{
          fontSize: 10, color: 'var(--accent)', fontWeight: 600,
          padding: '1px 6px', borderRadius: 4,
          background: 'var(--accent-soft)',
        }}>
          {roundCount} 轮
        </span>
      </div>

      {/* 时间线列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {turns.map((turn, i) => {
          const isHovered = hoveredId === turn.id;
          const isUser = turn.role === 'user';
          // 检测是否是新轮次的开始 (user消息前有assistant消息)
          const prevTurn = i > 0 ? turns[i - 1] : null;
          const isNewRound = isUser && (!prevTurn || prevTurn.role === 'assistant');

          return (
            <div key={turn.id}>
              {/* 轮次分隔 */}
              {isNewRound && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 4px 2px', fontSize: 10,
                  color: 'var(--muted-2)', fontWeight: 600,
                }}>
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%',
                    background: 'var(--accent-soft)', color: 'var(--accent)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 9, fontWeight: 700,
                  }}>
                    {Math.floor(i / 2) + 1}
                  </span>
                  <span>第 {Math.floor(i / 2) + 1} 轮</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}

              {/* 消息条目 */}
              <div
                onClick={() => onNavigate?.(turn.id)}
                onMouseEnter={() => setHoveredId(turn.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6,
                  padding: '4px 6px', borderRadius: 6,
                  cursor: 'pointer',
                  background: isHovered ? 'var(--panel)' : 'transparent',
                  transition: 'background 0.15s',
                  borderLeft: isHovered ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                {/* 角色图标 */}
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 9, fontWeight: 700, flexShrink: 0, marginTop: 1,
                  background: isUser
                    ? 'linear-gradient(135deg, #6366F1, #4F46E5)'
                    : 'var(--accent-soft)',
                  color: isUser ? '#fff' : 'var(--accent)',
                }}>
                  {isUser ? 'U' : 'A'}
                </span>

                {/* 内容 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: isHovered ? 'var(--fg)' : 'var(--fg-2)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    lineHeight: 1.4,
                  }}>
                    {turn.summary}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                    <span style={{ fontSize: 9, color: 'var(--muted-2)' }}>
                      {relativeTime(turn.ts)}
                    </span>
                    {turn.toolCount > 0 && (
                      <span style={{
                        fontSize: 9, color: 'var(--violet)', fontWeight: 600,
                        padding: '0 3px', borderRadius: 2,
                        background: 'oklch(0.7 0.1 300 / 0.15)',
                      }}>
                        {turn.toolCount} 工具
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
