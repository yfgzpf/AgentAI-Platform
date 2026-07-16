/**
 * SessionSidebarEnhanced - 增强版会话侧栏
 * 
 * 参考 Reasonix 界面设计：
 * 1. 显示对话历史列表（带摘要）
 * 2. 支持重命名和删除
 * 3. 显示日期
 * 4. 搜索功能
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Input, Tooltip, Popconfirm, Modal, message } from 'antd';
import {
  PlusOutlined, SearchOutlined, DeleteOutlined,
  EditOutlined, ClockCircleOutlined,
  MessageOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';
import { useProfileStore } from '../store';
import { useSessionStore } from '../store/sessionStore';

export const SessionSidebarEnhanced: React.FC<{
  onNewChat?: () => void;
}> = ({ onNewChat }) => {
  const { clearMessages, messages } = useChatStore();
  const { profile } = useProfileStore();
  const { 
    activeId, 
    createSession, 
    deleteSession, 
    setActive, 
    getMySessions,
    updateTitle,
    addMessage
  } = useSessionStore();
  
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // 自动保存消息到当前会话
  useEffect(() => {
    if (activeId && messages.length > 0) {
      // 获取最后一条消息
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && !lastMsg._saved) {
        addMessage(activeId, {
          role: lastMsg.role === 'user' ? 'user' : 'assistant',
          content: typeof lastMsg.text === 'string' ? lastMsg.text : JSON.stringify(lastMsg),
          ts: Date.now(),
        });
        // 标记为已保存
        lastMsg._saved = true;
      }
    }
  }, [messages, activeId, addMessage]);

  /* ---- 过滤 + 排序 ---- */
  const filtered = useMemo(() => {
    const mySessions = getMySessions();
    let list = query
      ? mySessions.filter(s => 
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          s.messages.some(m => m.content.toLowerCase().includes(query.toLowerCase()))
        )
      : mySessions;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [query, getMySessions]);

  /* ---- 新建对话 ---- */
  const handleNew = useCallback(() => {
    clearMessages();
    const id = createSession('新对话');
    setActive(id);
    onNewChat?.();
  }, [clearMessages, createSession, setActive, onNewChat]);

  /* ---- 切换对话 ---- */
  const handleSelect = useCallback((sessionId: string) => {
    setActive(sessionId);
    clearMessages();
    
    // 加载消息到 chatStore
    const mySessions = getMySessions();
    const session = mySessions.find(s => s.id === sessionId);
    if (session) {
      for (const msg of session.messages) {
        useChatStore.getState().appendMessage({
          id: `restored-${msg.ts}`,
          role: msg.role as 'user' | 'assistant',
          segments: [{ kind: 'text', text: msg.content }],
          ts: msg.ts,
          status: 'done',
          _saved: true, // 标记为已保存，避免重复保存
        });
      }
    }
  }, [getMySessions, clearMessages, setActive]);

  /* ---- 删除会话 ---- */
  const handleDelete = useCallback((sessionId: string) => {
    Modal.confirm({
      title: '删除对话',
      content: '确定要删除这个对话吗？删除后无法恢复。',
      okText: '删除',
      cancelText: '取消',
      okType: 'danger',
      onOk() {
        deleteSession(sessionId);
        if (activeId === sessionId) {
          clearMessages();
        }
        message.success('对话已删除');
      },
    });
  }, [deleteSession, activeId, clearMessages]);

  /* ---- 重命名 ---- */
  const startRename = useCallback((sessionId: string, currentTitle: string) => {
    setEditingId(sessionId);
    setEditTitle(currentTitle);
  }, []);

  const commitRename = useCallback(() => {
    if (editingId && editTitle.trim()) {
      updateTitle(editingId, editTitle.trim());
      setEditingId(null);
      setEditTitle('');
      message.success('重命名成功');
    }
  }, [editingId, editTitle, updateTitle]);

  /* ---- 格式化时间 ---- */
  function formatDate(ts: number): string {
    const date = new Date(ts);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return '今天';
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays}天前`;
    
    // 显示具体日期
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  /* ---- 生成对话摘要 ---- */
  function generateSummary(msgs: any[]): string {
    if (msgs.length === 0) return '';
    
    // 取第一条用户消息作为摘要
    const firstUserMsg = msgs.find(m => m.role === 'user');
    if (firstUserMsg) {
      const text = firstUserMsg.content.slice(0, 50);
      return text.length > 50 ? text + '...' : text;
    }
    
    return `(${msgs.length}条消息)`;
  }

  return (
    <div style={{
      width: 260,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg)',
      borderRight: '1px solid var(--border)',
    }}>
      {/* 头部 */}
      <div style={{
        padding: '16px',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* 搜索框 */}
        <Input
          placeholder="搜索历史记录..."
          prefix={<SearchOutlined style={{ color: 'var(--muted)' }} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          style={{ marginBottom: 12 }}
        />
        
        {/* 新建按钮 */}
        <button
          onClick={handleNew}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '8px',
            borderRadius: 8,
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <PlusOutlined />
          新建对话
        </button>
      </div>

      {/* 对话列表 */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
      }}>
        {filtered.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px 16px',
            color: 'var(--muted)',
            fontSize: 13,
          }}>
            <MessageOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
            {query ? '没有找到匹配的对话' : '暂无对话历史'}
          </div>
        ) : (
          filtered.map((session) => {
            const isActive = session.id === activeId;
            const summary = generateSummary(session.messages);
            
            return (
              <div
                key={session.id}
                onClick={() => !editingId && handleSelect(session.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: '12px',
                  borderRadius: 8,
                  marginBottom: 4,
                  cursor: 'pointer',
                  background: isActive ? 'var(--panel)' : 'transparent',
                  borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive && !editingId) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--card)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive && !editingId) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                {/* 内容区 */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* 标题或编辑框 */}
                  {editingId === session.id ? (
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={commitRename}
                      onPressEnter={commitRename}
                      autoFocus
                      size="small"
                      style={{ marginBottom: 4 }}
                    />
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}>
                      <span style={{
                        fontSize: 14,
                        fontWeight: 500,
                        color: 'var(--fg)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}>
                        {session.title || '未命名对话'}
                      </span>
                      
                      {/* 操作按钮 */}
                      <div style={{ display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s' }}
                        onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                        onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
                      >
                        <Tooltip title="重命名">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(session.id, session.title);
                            }}
                            style={{
                              padding: '2px 6px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              color: 'var(--muted)',
                              fontSize: 12,
                            }}
                          >
                            <EditOutlined />
                          </button>
                        </Tooltip>
                        
                        <Tooltip title="删除">
                          <Popconfirm
                            title="确定删除？"
                            onConfirm={() => handleDelete(session.id)}
                          >
                            <button
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                padding: '2px 6px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                color: 'var(--muted)',
                                fontSize: 12,
                              }}
                            >
                              <DeleteOutlined />
                            </button>
                          </Popconfirm>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                  
                  {/* 摘要 */}
                  {summary && (
                    <div style={{
                      fontSize: 12,
                      color: 'var(--muted-2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 2,
                    }}>
                      {summary}
                    </div>
                  )}
                  
                  {/* 时间和消息数 */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 11,
                    color: 'var(--muted-2)',
                    marginTop: 4,
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <ClockCircleOutlined />
                      {formatDate(session.updatedAt)}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                      <MessageOutlined />
                      {session.messages.length}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部用户信息 */}
      <div style={{
        padding: '16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #667eea, #764ba2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 14,
          fontWeight: 600,
        }}>
          {(profile?.name || 'U').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>
            {profile?.name || '未登录'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>
            在线
          </div>
        </div>
      </div>
    </div>
  );
};
