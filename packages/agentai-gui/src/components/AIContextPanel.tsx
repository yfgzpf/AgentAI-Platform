/**
 * AIContextPanel — AI 运行上下文 (可折叠)
 * ----------------------------------------------------
 * 折叠状态: 只显示 Token + 模型 + 状态圆点
 * 展开状态: 显示当前任务、消息数、推理步数、上下文用量详情
 */
import React, { useState } from 'react';
import { Tag, Progress } from 'antd';
import { AimOutlined, CodeOutlined, ThunderboltOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
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
  const [collapsed, setCollapsed] = useState(true);
  const { messages } = useChatStore();
  const msgCount = messages?.length || 0;
  const ctxPct = Math.min(100, Math.round((contextTokens / maxContextTokens) * 100));
  const isActive = msgCount > 0 && !!currentTask;

  // 折叠摘要行
  const summaryRow = (
    <div
      onClick={() => setCollapsed(!collapsed)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '6px 8px', borderRadius: 6,
        fontSize: 11, color: 'var(--fg-2)',
        background: 'transparent', userSelect: 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <AimOutlined style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }} />
      <span style={{ fontWeight: 500 }}>AI 运行上下文</span>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? '#22c55e' : '#6b7280', display: 'inline-block', flexShrink: 0 }} />
      {contextTokens > 0 && (
        <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>
          {(contextTokens / 1000).toFixed(0)}K
        </span>
      )}
      {activeModel && (
        <Tag style={{ fontSize: 9, borderRadius: 2, margin: 0, border: 'none', lineHeight: '16px', padding: '0 4px', marginLeft: 'auto' }}>
          {activeModel}
        </Tag>
      )}
      <span style={{ fontSize: 10, color: 'var(--muted-2)', flexShrink: 0 }}>
        {collapsed ? <RightOutlined /> : <DownOutlined />}
      </span>
    </div>
  );

  if (collapsed) {
    return <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>{summaryRow}</div>;
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      {summaryRow}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px 4px' }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--muted-2)', marginBottom: 2 }}>当前任务</div>
          <div style={{ fontSize: 11, color: 'var(--fg-2)', padding: '4px 8px', background: 'var(--bg-2)', borderRadius: 4, minHeight: 20 }}>
            {currentTask || <span style={{ color: 'var(--muted-2)', fontStyle: 'italic' }}>等待任务...</span>}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div style={{ padding: '4px 6px', background: 'var(--bg-2)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--muted-2)' }}>消息数</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>{msgCount}</div>
          </div>
          <div style={{ padding: '4px 6px', background: 'var(--bg-2)', borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: 'var(--muted-2)' }}>推理步数</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg-2)' }}>{reasoningSteps}</div>
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
            <span>模型: <Tag style={{ fontSize: 9, borderRadius: 2, margin: 0 }}>{activeModel}</Tag></span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--muted-2)', borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? '#22c55e' : '#6b7280', display: 'inline-block' }} />
          {currentTask ? '处理中' : '空闲'}
        </div>
      </div>
    </div>
  );
};
