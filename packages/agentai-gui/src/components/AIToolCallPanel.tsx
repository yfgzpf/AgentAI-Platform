/**
 * AIToolCallPanel — 当前轮次工具调用快照
 * -----------------------------------------
 * 从 chatStore 最后一轮消息中提取工具调用记录，
 * 实时展示成功/失败/进行中的工具调用
 */
import React, { useMemo } from 'react';
import { Tag, Tooltip } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, ToolOutlined } from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';

export const AIToolCallPanel: React.FC = () => {
  const { messages } = useChatStore();

  const toolCalls = useMemo(() => {
    const result: { name: string; status: 'success' | 'failed' | 'running'; args?: string; ts: number }[] = [];
    if (!messages) return result;
    // 取最后一条 AI 消息中的工具调用
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.segments) {
        for (const seg of msg.segments) {
          if (seg.kind === 'tool' && seg.name) {
            const status = seg.ok === false ? 'failed' : seg.result ? 'success' : 'running';
            result.push({ name: seg.name, status, args: typeof seg.args === 'string' ? seg.args : JSON.stringify(seg.args), ts: msg.ts || Date.now() });
          }
        }
        if (result.length > 0) break; // 只取最后一轮
      }
    }
    return result;
  }, [messages]);

  const successCount = toolCalls.filter(t => t.status === 'success').length;
  const failedCount = toolCalls.filter(t => t.status === 'failed').length;
  const runningCount = toolCalls.filter(t => t.status === 'running').length;

  const summaryLabel = () => {
    const parts: string[] = [];
    if (toolCalls.length > 0) parts.push(`${toolCalls.length} 次调用`);
    if (successCount > 0) parts.push(`✅${successCount}`);
    if (failedCount > 0) parts.push(`❌${failedCount}`);
    if (runningCount > 0) parts.push(`⏳${runningCount}`);
    return parts.join(' · ') || '暂无调用';
  };

  return (
    <div style={{ padding: '4px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--fg-2)', marginBottom: 6 }}>
        <ToolOutlined style={{ fontSize: 12, color: 'var(--accent)' }} />
        <span style={{ fontWeight: 500 }}>工具调用</span>
        <span style={{ fontSize: 10, color: 'var(--muted-2)', marginLeft: 'auto' }}>{summaryLabel()}</span>
      </div>
      {toolCalls.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--muted-2)', fontStyle: 'italic', padding: '4px 0' }}>
          等待 AI 调用工具...
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {toolCalls.map((t, i) => (
            <Tooltip key={`${t.name}-${i}`} title={`${t.name} · ${t.status === 'running' ? '进行中' : t.status === 'success' ? '成功' : '失败'}`}>
              <Tag
                style={{
                  fontSize: 9, borderRadius: 2, margin: 0, border: 'none',
                  lineHeight: '18px', padding: '0 5px', cursor: 'default',
                  background: t.status === 'success' ? 'var(--bg-2)' : t.status === 'failed' ? 'var(--danger-soft)' : 'var(--violet-soft)',
                  color: t.status === 'success' ? 'var(--fg-2)' : t.status === 'failed' ? 'var(--danger)' : 'var(--violet)',
                }}
              >
                {t.status === 'running' ? <LoadingOutlined style={{ marginRight: 2 }} /> :
                 t.status === 'success' ? <CheckCircleFilled style={{ marginRight: 2, fontSize: 9 }} /> :
                 <CloseCircleFilled style={{ marginRight: 2, fontSize: 9 }} />}
                {t.name.replace(/_/g, ' ')}
              </Tag>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
};
