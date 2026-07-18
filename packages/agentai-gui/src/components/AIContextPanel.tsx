/**
 * AIContextPanel — AI 运行上下文动态展示
 * ----------------------------------------------------
 * 实时显示 AI 当前处理状态:
 *   - 当前任务/目标
 *   - 消息数/推理步数
 *   - 上下文 tokens 使用量
 *   - 活跃模型
 *
 * 数据源: chatStore 中的当前消息 + SSE 事件
 */
import React from 'react';
import { Card, Tag, Progress } from 'antd';
import { AimOutlined, CodeOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';

interface Props {
  currentTask?: string;
  activeModel?: string;
  contextTokens?: number;
  maxContextTokens?: number;
  reasoningSteps?: number;
}

export const AIContextPanel: React.FC<Props> = ({
  currentTask, activeModel, contextTokens = 0, maxContextTokens = 128000, reasoningSteps = 0,
}) => {
  const { messages } = useChatStore();
  const msgCount = messages?.length || 0;
  const ctxPct = Math.min(100, Math.round((contextTokens / maxContextTokens) * 100));

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}><AimOutlined style={{ marginRight: 4 }} />AI 运行上下文</span>}
      style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px' } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--muted-2)', marginBottom: 2 }}>当前任务</div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', padding: '4px 8px', background: 'var(--bg-2)', borderRadius: 4, minHeight: 20 }}>
            {currentTask || <span style={{ color: 'var(--muted-2)', fontStyle: 'italic' }}>等待任务...</span>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div style={{ padding: '4px 6px', background: 'var(--bg-2)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--muted-2)' }}>消息数</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{msgCount}</div>
          </div>
          <div style={{ padding: '4px 6px', background: 'var(--bg-2)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--muted-2)' }}>推理步数</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-2)' }}>{reasoningSteps}</div>
          </div>
        </div>

        {contextTokens > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--muted-2)', marginBottom: 2 }}>
              <span><CodeOutlined style={{ marginRight: 2 }} />上下文用量</span>
              <span>{(contextTokens / 1000).toFixed(0)}K / {(maxContextTokens / 1000).toFixed(0)}K</span>
            </div>
            <Progress percent={ctxPct} size="small" strokeColor={ctxPct > 80 ? '#ef4444' : ctxPct > 60 ? '#f59e0b' : '#6366f1'} trailColor="var(--border)" showInfo={false} style={{ margin: 0 }} />
          </div>
        )}

        {activeModel && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted-2)' }}>
            <ThunderboltOutlined style={{ fontSize: 10 }} />
            <span>模型: <Tag style={{ fontSize: 9, borderRadius: 3, margin: 0 }}>{activeModel}</Tag></span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--muted-2)', borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: msgCount > 0 && currentTask ? '#22c55e' : '#6b7280', display: 'inline-block' }} />
          {currentTask ? '处理中' : '空闲'}
        </div>
      </div>
    </Card>
  );
};
