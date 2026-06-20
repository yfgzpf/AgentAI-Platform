/**
 * AIToolCallPanel — AI 工具调用过程可视化
 * ----------------------------------------------------
 * 实时展示 AI 调用工具的完整流程:
 *   - 工具调用链 (Tool Call Chain)
 *   - 每个工具的状态 (pending/running/success/error)
 *   - 工具参数、结果、耗时
 *
 * 数据源: chatStore messages 中的 tool segments
 */
import React, { useState } from 'react';
import { Card, Tag, Tooltip, Button, Space } from 'antd';
import {
  ApiOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, ClockCircleOutlined, ClearOutlined, CodeOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';

interface ToolCallItem {
  callId: string;
  name: string;
  state: 'running' | 'success' | 'error';
  args?: string;
  result?: string;
  durationMs?: number;
  ts?: number;
}

export const AIToolCallPanel: React.FC = () => {
  const { messages } = useChatStore();
  const [showAll, setShowAll] = useState(false);

  const toolCalls: ToolCallItem[] = [];
  if (messages) {
    for (const msg of messages) {
      if (msg.segments) {
        for (const seg of msg.segments) {
          if (seg.kind === 'tool') {
            toolCalls.push({
              callId: seg.callId || `tool-${toolCalls.length}`,
              name: seg.name || 'unknown',
              state: seg.state === 'running' ? 'running' : seg.state === 'success' ? 'success' : 'error',
              args: seg.args,
              result: seg.result,
              durationMs: seg.durationMs,
              ts: msg.ts,
            });
          }
        }
      }
    }
  }

  const visible = showAll ? toolCalls : toolCalls.slice(-5);
  const hasMore = toolCalls.length > 5;

  return (
    <Card
      size="small"
      title={
        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>
          <ApiOutlined style={{ marginRight: 4 }} />
          AI 工具调用
          <Tag style={{ marginLeft: 6, fontSize: 9, borderRadius: 3 }}>
            {toolCalls.filter(t => t.state === 'running').length} 运行中
          </Tag>
        </span>
      }
      extra={
        toolCalls.length > 0 && (
          <Space size={2}>
            <Button size="small" type="text"
              icon={showAll ? <ClearOutlined /> : <CodeOutlined />}
              onClick={() => setShowAll(v => !v)}
              style={{ color: 'var(--muted-2)', fontSize: 10, height: 22 }}
            />
          </Space>
        )
      }
      style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px', maxHeight: 280, overflowY: 'auto' } }}
    >
      {toolCalls.length === 0 ? (
        <div style={{ fontSize: 10, color: 'var(--muted-2)', textAlign: 'center', padding: 8 }}>
          暂无工具调用记录
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visible.map((tc) => (
            <div key={tc.callId} style={{
              padding: '4px 8px', borderRadius: 4,
              background: tc.state === 'running'
                ? 'rgba(99,102,241,0.08)'
                : tc.state === 'success'
                  ? 'rgba(34,197,94,0.06)'
                  : 'rgba(239,68,68,0.06)',
              border: `1px solid ${
                tc.state === 'running' ? 'rgba(99,102,241,0.2)' :
                tc.state === 'success' ? 'rgba(34,197,94,0.2)' :
                'rgba(239,68,68,0.2)'
              }`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {tc.state === 'running' ? (
                  <LoadingOutlined style={{ fontSize: 10, color: '#6366f1' }} />
                ) : tc.state === 'success' ? (
                  <CheckCircleOutlined style={{ fontSize: 10, color: '#22c55e' }} />
                ) : (
                  <CloseCircleOutlined style={{ fontSize: 10, color: '#ef4444' }} />
                )}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)', flex: 1 }}>
                  {tc.name}
                  {tc.state === 'running' && (
                    <Tag style={{ marginLeft: 4, fontSize: 8, borderRadius: 2, lineHeight: '14px', height: 16 }} color="processing">
                      执行中
                    </Tag>
                  )}
                </span>
                {tc.durationMs != null && (
                  <Tooltip title="耗时">
                    <span style={{ fontSize: 9, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 2 }}>
                      <ClockCircleOutlined style={{ fontSize: 8 }} />
                      {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  </Tooltip>
                )}
              </div>
              {tc.args && (
                <div style={{ marginTop: 2, fontSize: 9, color: 'var(--muted-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                  {(typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)).slice(0, 120)}{(typeof tc.args === 'string' ? tc.args.length : JSON.stringify(tc.args).length) > 120 ? '...' : ''}
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <div onClick={() => setShowAll(v => !v)} style={{
              textAlign: 'center', fontSize: 10, color: 'var(--muted-2)',
              cursor: 'pointer', padding: 4, background: 'var(--bg-2)', borderRadius: 4,
            }}>
              {showAll ? '收起' : `还有 ${toolCalls.length - 5} 条调用...`}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
