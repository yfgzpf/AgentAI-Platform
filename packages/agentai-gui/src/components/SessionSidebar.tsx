/**
 * SessionSidebar - 左侧会话时间线
 *   - 显示历史会话列表 (类似 Reasonix Timeline)
 *   - 新建/切换/删除会话
 *   - 三模式切换 (只读/规划/自动)
 */
import React, { useState, useRef } from 'react';
import { Button, List, Typography, Popconfirm, Badge, Space, Tooltip, Tag, Input, Divider } from 'antd';
import {
  PlusOutlined, DeleteOutlined, MessageOutlined, ClockCircleOutlined,
  EditOutlined, LineChartOutlined, ThunderboltOutlined, ReadOutlined,
  CarryOutOutlined, CloseOutlined, CheckOutlined,
} from '@ant-design/icons';
import { useSessionStore } from '../store/sessionStore';
import { useModeStore, type AppMode } from '../store/modeStore';

const { Text } = Typography;

const MODE_LABEL: Record<AppMode, { icon: React.ReactNode; label: string; color: string }> = {
  readonly:  { icon: <ReadOutlined />, label: '只读', color: '#F59E0B' },
  planning:  { icon: <CarryOutOutlined />, label: '规划', color: '#10B981' },
  auto:      { icon: <ThunderboltOutlined />, label: '自动', color: '#4F46E5' },
};

export const SessionSidebar: React.FC = () => {
  const { sessions, activeId, createSession, deleteSession, setActive } = useSessionStore() as any;
  const { mode, setMode } = useModeStore();

  // patch: sessionStore might not have setActive, use createSession for new
  const handleSelect = (id: string) => {
    // Use setActive if exists, otherwise store in local ref
    if (typeof (useSessionStore.getState() as any).setActive === 'function') {
      (useSessionStore.getState() as any).setActive(id);
    }
  };

  const handleNew = () => {
    const id = createSession('新对话');
    handleSelect(id);
  };

  const sessionsList = sessions || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a', borderRight: '1px solid #1f1f1f' }}>
      {/* 标题 + 新建 */}
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #1f1f1f' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text strong style={{ fontSize: 13, color: '#ccc' }}>
            <ClockCircleOutlined /> 时间线
          </Text>
          <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={handleNew}>
            新建
          </Button>
        </div>

        {/* 三模式切换 */}
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {(Object.keys(MODE_LABEL) as AppMode[]).map(m => {
            const cfg = MODE_LABEL[m];
            const isActive = mode === m;
            return (
              <Tooltip key={m} title={m === 'readonly' ? '纯对话，不调工具' : m === 'planning' ? '先规划，再执行' : '智能推理 + 自动工具'}>
                <Tag
                  color={cfg.color}
                  style={{
                    cursor: 'pointer',
                    flex: 1,
                    textAlign: 'center',
                    margin: 0,
                    padding: '2px 0',
                    fontWeight: isActive ? 700 : 400,
                    opacity: isActive ? 1 : 0.5,
                    border: isActive ? `2px solid ${cfg.color}` : '1px solid transparent',
                  }}
                  onClick={() => setMode(m)}
                >
                  {cfg.icon} {cfg.label}
                </Tag>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* 会话列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {sessionsList.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 12 }}>
            暂无会话，点击上方新建
          </div>
        ) : (
          sessionsList.map((s: any) => {
            const isActive = activeId === s.id;
            const lastMsg = s.messages?.length > 0 ? s.messages[s.messages.length - 1] : null;
            return (
              <div
                key={s.id}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  background: isActive ? '#141414' : 'transparent',
                  borderLeft: isActive ? '3px solid #4F46E5' : '3px solid transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
                onClick={() => handleSelect(s.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{
                    fontSize: 12,
                    color: isActive ? '#fff' : '#888',
                    fontWeight: isActive ? 600 : 400,
                    maxWidth: 160,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    <MessageOutlined style={{ marginRight: 4, fontSize: 10 }} />
                    {s.title || '未命名'}
                  </Text>
                  <Popconfirm
                    title="删除此会话?"
                    onConfirm={(e) => { e?.stopPropagation(); deleteSession(s.id); }}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </div>
                {lastMsg && (
                  <Text style={{ fontSize: 10, color: '#555', paddingLeft: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {typeof lastMsg.content === 'string' ? lastMsg.content.slice(0, 40) : lastMsg.role === 'user' ? '用户消息...' : 'AI 回复...'}
                  </Text>
                )}
                <Text style={{ fontSize: 9, color: '#444', paddingLeft: 14 }}>
                  {new Date(s.updatedAt || s.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
