/**
 * SessionSidebar — 左侧会话侧栏
 *   - 顶部: 品牌 + 折叠按钮
 *   - 快速操作: 新建对话 / 搜索 / 技能
 *   - 会话列表: 按更新时间倒序，显示对话摘要
 *   - 点击切换对话
 *   - 底部: 用户信息 + 设置入口
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Input, Tooltip, Popconfirm } from 'antd';
import {
  PlusOutlined, SearchOutlined, DeleteOutlined,
  AppstoreOutlined,
  UserOutlined, SettingOutlined,
  ClockCircleOutlined, MessageOutlined,
  ThunderboltOutlined, MenuFoldOutlined,
  EditOutlined, BookOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';
import { useProfileStore } from '../store';
import { useSessionStore } from '../store/sessionStore';

export const SessionSidebar: React.FC<{
  onGuideClick?: () => void;
  onToggleCollapse?: () => void;
}> = ({ onGuideClick, onToggleCollapse }) => {
  const { clearMessages } = useChatStore();
  const { profile } = useProfileStore();
  const { activeId, createSession, deleteSession, setActive, getMySessions } = useSessionStore();
  const [query, setQuery] = useState('');

  const userName = profile?.name || '未登录';

  /* ---- 过滤 + 排序 ---- */
  const filtered = useMemo(() => {
    // 使用 getMySessions 获取当前用户的会话列表
    const mySessions = getMySessions();
    let list = query
      ? mySessions.filter(s => s.title.toLowerCase().includes(query.toLowerCase()))
      : mySessions;
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [query, getMySessions]);

  /* ---- 新建对话 ---- */
  const handleNew = useCallback(() => {
    clearMessages();
    createSession('新对话');
  }, [clearMessages, createSession]);

  /* ---- 切换对话 ---- */
  const handleSelect = useCallback((sessionId: string) => {
    setActive(sessionId);
    clearMessages();
    // 从 sessionStore 加载消息到 chatStore
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
        });
      }
    }
  }, [getMySessions, clearMessages, setActive]);

  /* ---- 删除会话 ---- */
  const handleDelete = useCallback((sessionId: string) => {
    deleteSession(sessionId);
    if (activeId === sessionId) {
      clearMessages();
    }
  }, [deleteSession, activeId, clearMessages]);

  function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    const min = diff / 60_000;
    if (min < 60) return `${Math.floor(min)}分钟前`;
    const hr = min / 60;
    if (hr < 24) return `${Math.floor(hr)}小时前`;
    const d = hr / 24;
    if (d < 7) return `${Math.floor(d)}天前`;
    return `${Math.floor(d / 7)}周前`;
  }

  /* === 紧凑按钮 (行) === */
  const NavRow: React.FC<{
    icon: React.ReactNode; label: string; shortcut?: string;
    onClick?: () => void; active?: boolean;
  }> = ({ icon, label, shortcut, onClick, active }) => (
    <button
      onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 10px', borderRadius: 6,
        fontSize: 13, fontWeight: 500, color: active ? 'var(--fg)' : 'var(--fg-2)',
        background: active ? 'var(--panel)' : 'transparent',
        border: 'none', cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--card)'; }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontSize: 14, color: active ? 'var(--accent)' : 'var(--muted)', display: 'inline-flex' }}>
        {icon}
      </span>
      <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
      {shortcut && (
        <span style={{
          fontSize: 10, color: 'var(--muted-2)',
          fontFamily: 'ui-monospace, monospace', letterSpacing: 0.5,
        }}>{shortcut}</span>
      )}
    </button>
  );

  /* === 会话条目（支持标题双击编辑） === */
  const SessionItem: React.FC<{ s: { id: string; title: string; messages: any[]; updatedAt: number } }> = ({ s }) => {
    const active = s.id === activeId;
    const updated = relativeTime(s.updatedAt);
    const msgCount = s.messages.length;
    const { updateTitle, clearSessionMessages } = useSessionStore();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(s.title);
    const inputRef = useRef<any>(null);

    useEffect(() => {
      if (editing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select?.();
      }
    }, [editing]);

    const commitTitle = useCallback(() => {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== s.title) {
        updateTitle(s.id, trimmed);
      } else {
        setDraft(s.title);
      }
      setEditing(false);
    }, [draft, s.id, s.title, updateTitle]);

    return (
      <div
        onClick={() => { if (!editing) handleSelect(s.id); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 10px', borderRadius: 6,
          cursor: 'pointer',
          color: active ? 'var(--fg)' : 'var(--fg-2)',
          background: active ? 'var(--panel)' : 'transparent',
          position: 'relative',
          transition: 'background 0.12s',
          borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        }}
        onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--card)'; }}
        onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <MessageOutlined style={{
          fontSize: 11, color: active ? 'var(--accent)' : 'var(--muted-2)', flexShrink: 0,
        }} />
        <div style={{ flex: 1, minWidth: 0 }} onDoubleClick={(e) => { e.stopPropagation(); setDraft(s.title); setEditing(true); }}>
          {editing ? (
            <Input
              ref={inputRef}
              size="small"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onPressEnter={commitTitle}
              onBlur={commitTitle}
              onClick={e => e.stopPropagation()}
              style={{ height: 22, fontSize: 12, padding: '0 6px' }}
            />
          ) : (
            <>
              <div style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: 12.5, fontWeight: active ? 600 : 500,
              }}>{s.title}</div>
              <div style={{
                fontSize: 10, color: 'var(--muted-2)', marginTop: 1,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <ClockCircleOutlined style={{ fontSize: 9 }} />
                <span>{updated}</span>
                {msgCount > 0 && (
                  <>
                    <span>·</span>
                    <span>{msgCount} 条消息</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {msgCount > 0 && (
            <Popconfirm
              title="清空此会话消息?"
              onConfirm={(e) => { e?.stopPropagation(); clearSessionMessages(s.id); }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <button
                onClick={(e) => e.stopPropagation()}
                style={{
                  opacity: 0, padding: 2, border: 'none', background: 'transparent',
                  color: 'var(--muted-2)', cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                className="sess-act-btn"
              >
                <EditOutlined style={{ fontSize: 10 }} />
              </button>
            </Popconfirm>
          )}
          <Popconfirm
            title="删除此会话?"
            onConfirm={(e) => { e?.stopPropagation(); handleDelete(s.id); }}
            onCancel={(e) => e?.stopPropagation()}
          >
            <button
              onClick={(e) => e.stopPropagation()}
              style={{
                opacity: 0, padding: 2, border: 'none', background: 'transparent',
                color: 'var(--muted-2)', cursor: 'pointer',
                transition: 'opacity 0.15s',
              }}
              className="sess-act-btn"
            >
              <DeleteOutlined style={{ fontSize: 11 }} />
            </button>
          </Popconfirm>
        </div>
        <style>{`
          [class*="sess-act-btn"]:hover { opacity: 1 !important; }
        `}</style>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--panel)' }}>
      {/* ═════ 顶部: 折叠按钮 (不再重复显示LOGO, 顶部已有) ═════ */}
      {onToggleCollapse && (
        <div style={{
          display: 'flex', justifyContent: 'flex-end',
          padding: '6px 8px 4px',
          borderBottom: '1px solid var(--border)',
        }}>
          <Tooltip title="收起侧栏" placement="bottom">
            <button
              onClick={onToggleCollapse}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 24, height: 24, borderRadius: 4,
                background: 'transparent', border: 'none',
                color: 'var(--muted-2)', cursor: 'pointer',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--card)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <MenuFoldOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* ═════ 快速操作 (新建/搜索) ═════ */}
      <div style={{ padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavRow icon={<PlusOutlined />} label="新建对话" shortcut="Ctrl+N" onClick={handleNew} />
        <NavRow
          icon={<SearchOutlined />}
          label="搜索对话"
          shortcut="Ctrl+K"
          onClick={() => {
            const el = document.querySelector<HTMLInputElement>('input[placeholder*="搜索"]');
            el?.focus();
          }}
        />
        <NavRow
          icon={<AppstoreOutlined />}
          label="技能"
          onClick={() => {
            window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'skills' } }));
          }}
        />
      </div>

      {/* ═════ 搜索框 ═════ */}
      <div style={{ padding: '6px 10px 8px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
          borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)',
        }}>
          <SearchOutlined style={{ color: 'var(--muted-2)', fontSize: 12 }} />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索对话..."
            variant="borderless"
            size="small"
            style={{ background: 'transparent', boxShadow: 'none', fontSize: 12, padding: 0 }}
          />
        </div>
      </div>

      {/* ═════ 会话列表 ═════ */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 8px' }}>
        {filtered.length === 0 ? (
          <div style={{
            padding: '24px 12px', fontSize: 12, color: 'var(--muted-2)',
            textAlign: 'center',
          }}>
            {query ? '未找到匹配的对话' : '暂无对话，点击上方「新建对话」开始'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {filtered.map(s => (
              <SessionItem key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>

      {/* ═════ 底部: 用户信息 + 设置 ═════ */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '8px 10px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, #6366F1 0%, #EC4899 100%)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 12, fontWeight: 700,
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}>
          {userName.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12, fontWeight: 600, color: 'var(--fg)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{userName}</div>
        </div>
        <Tooltip title="使用指南 & API Key 获取">
          <button
            onClick={onGuideClick}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              gap: 4,
              padding: '4px 10px',
              background: 'var(--accent-soft)', border: '1px solid var(--accent)',
              color: 'var(--accent)', cursor: 'pointer', borderRadius: 4,
              fontSize: 11, fontWeight: 600,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
          >
            <BookOutlined style={{ fontSize: 12 }} />
            <span>帮助</span>
          </button>
        </Tooltip>
        <Tooltip title="设置">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'settings' } }))}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, padding: 0,
              background: 'transparent', border: 'none',
              color: 'var(--muted-2)', cursor: 'pointer', borderRadius: 4,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--card)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'; }}
          >
            <SettingOutlined style={{ fontSize: 12 }} />
          </button>
        </Tooltip>
      </div>

      {/* 版本号 */}
      <div style={{
        textAlign: 'center', fontSize: 9, color: 'var(--muted-2)',
        padding: '2px 0 4px', borderTop: '1px solid var(--border)',
      }}>
        v0.4.0 · alpha
      </div>
    </div>
  );
};
