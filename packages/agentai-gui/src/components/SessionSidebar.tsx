/**
 * SessionSidebar — 左侧会话时间线 (参考 deepseek-reasonix Sidebar)
 *   - 新建会话 / 切换会话 / 删除会话
 *   - 会话搜索
 *   - 状态指示器 (运行中/完成/错误)
 *   - 三模式切换 (只读/规划/自动)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Typography, Popconfirm, Tooltip, type InputRef } from 'antd';
import { PlusOutlined, SearchOutlined, DeleteOutlined, SettingOutlined } from '@ant-design/icons';
import { useModeStore, type AppMode } from '../store/modeStore';

const { Text } = Typography;

/* ---- Session data type (minimal) ---- */
export interface SessionItem {
  id: string;
  name: string;
  summary?: string;
  messageCount: number;
  mtime: string;
}

export const SessionSidebar: React.FC = () => {
  const { mode, setMode } = useModeStore();
  const [query, setQuery] = useState('');
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const searchRef = useRef<InputRef>(null);

  /* ---- session CRUD (demo — hook up to real API later) ---- */
  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/sessions');
      if (r.ok) {
        const data = await r.json();
        setSessions(data.items || []);
      }
    } catch {
      // fallback: empty list
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    // auto-refresh every 30s
    const id = setInterval(fetchSessions, 30000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  const handleNew = useCallback(async () => {
    try {
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `对话 ${sessions.length + 1}` }),
      });
      if (r.ok) {
        const data = await r.json();
        setActiveId(data.id);
        await fetchSessions();
      }
    } catch {}
  }, [sessions.length, fetchSessions]);

  const handleSelect = useCallback(async (id: string) => {
    setActiveId(id);
    setLoading(id);
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      if (r.ok) {
        const data = await r.json();
        // hydrate messages into chatStore
        if (data.messages) {
          localStorage.setItem(`session:${id}:messages`, JSON.stringify(data.messages));
        }
      }
    } catch {} finally {
      setLoading(null);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await fetchSessions();
    } catch {}
  }, [fetchSessions]);

  /* ---- filtered list ---- */
  const filtered = query
    ? sessions.filter(s =>
        (s.summary || s.name).toLowerCase().includes(query.toLowerCase())
      )
    : sessions;

  /* ---- helpers ---- */
  function prettyName(s: SessionItem): string {
    if (s.summary?.trim()) return s.summary.trim();
    return s.name.replace(/^desktop-/, '').replace(/[-_]+/g, ' ');
  }

  function relativeTime(ms: number): string {
    if (ms < 60_000) return '刚刚';
    const min = ms / 60_000;
    if (min < 60) return `${Math.floor(min)} 分钟前`;
    const hr = min / 60;
    if (hr < 24) return `${Math.floor(hr)} 小时前`;
    const d = hr / 24;
    if (d < 7) return `${Math.floor(d)} 天前`;
    return `${Math.floor(d / 7)} 周前`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ---- header: new chat + commands ---- */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleNew}
          style={{
            flex: 1, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            fontSize: 14, fontWeight: 500, borderRadius: 6, background: 'var(--accent)', color: '#fff',
            border: 'none', cursor: 'pointer',
          }}
        >
          <PlusOutlined style={{ fontSize: 14 }} />
          <span>新建对话</span>
        </button>
        <Tooltip title="设置">
          <Button type="text" icon={<SettingOutlined style={{ fontSize: 14 }} />} style={{ width: 30, height: 30 }} />
        </Tooltip>
      </div>

      {/* ---- search ---- */}
      <div style={{ padding: '0 12px 10px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px',
          borderRadius: 6, background: 'var(--card)', border: '1px solid var(--border)',
        }}>
          <SearchOutlined style={{ color: 'var(--muted-2)', fontSize: 13 }} />
          <Input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索会话..."
            bordered={false}
            autoFocus={false}
            style={{ background: 'transparent', boxShadow: 'none' }}
          />
        </div>
      </div>

      {/* ---- session list ---- */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 12px' }}>
        {/* section label */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>最近</span>
          <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{sessions.length}</span>
        </div>

        {/* empty state */}
        {sessions.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--muted-2)', fontFamily: 'monospace' }}>
            暂无会话
          </div>
        )}

        {/* session items */}
        {filtered.map(s => {
          const active = s.id === activeId;
          const isLoading = loading === s.id;
          const mtime = Date.parse(s.mtime);
          const updated = Number.isFinite(mtime) ? relativeTime(Date.now() - mtime) : s.mtime;
          return (
            <div
              key={s.id}
              data-active={active}
              onClick={() => handleSelect(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 8px 6px 22px', borderRadius: 6,
                cursor: 'pointer', color: active ? 'var(--fg)' : 'var(--fg-2)',
                background: active ? 'var(--panel)' : 'transparent',
                position: 'relative',
                opacity: isLoading ? 0.7 : active ? 1 : 0.85,
                pointerEvents: isLoading ? 'none' : 'auto',
              }}
            >
              {/* state dot */}
              <span style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: isLoading || active ? 'var(--accent)' : 'var(--border-strong)',
                animation: isLoading ? 'pulse 1.6s ease-out infinite' : undefined,
              }} />

              {/* body */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  fontSize: 14, fontWeight: 600,
                }}>
                  {prettyName(s)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>
                  {isLoading ? '加载中...' : (
                    <>
                      <span>{s.messageCount} 条消息</span>
                      <span style={{ margin: '0 4px' }}>.</span>
                      <span>{updated}</span>
                    </>
                  )}
                </div>
              </div>

              {/* delete button */}
              <Popconfirm
                title="删除此会话?"
                onConfirm={(e) => {
                  e?.stopPropagation();
                  handleDelete(s.id);
                }}
                onCancel={(e) => e?.stopPropagation()}
              >
                <Button
                  type="text"
                  danger
                  size="small"
                  icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                  onClick={(e) => e.stopPropagation()}
                  style={{ opacity: 0.5 }}
                />
              </Popconfirm>
            </div>
          );
        })}
      </div>

      {/* ---- footer: mode switch + settings ---- */}
      <div style={{
        borderTop: '1px solid var(--border)', padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* mode tags */}
        <div style={{ display: 'flex', gap: 4 }}>
          {MODE_OPTS.map(({ k, label, dot, desc }) => {
            const active = mode === k;
            return (
              <Tooltip key={k} title={desc}>
                <button
                  onClick={() => setMode(k)}
                  style={{
                    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    padding: '2px 0', borderRadius: 4, fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    color: active ? '#fff' : 'var(--muted)',
                    background: active ? dot : 'transparent',
                    border: active ? `1.5px solid ${dot}` : '1px solid transparent',
                    cursor: 'pointer', margin: 0,
                    opacity: active ? 1 : 0.5,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: dot, flexShrink: 0 }} />
                  {label}
                </button>
              </Tooltip>
            );
          })}
        </div>

        {/* settings link */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 6px', borderRadius: 4, cursor: 'pointer',
          fontSize: 12, color: 'var(--muted)',
        }}>
          <span style={{ width: 13, height: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <SettingOutlined style={{ fontSize: 13 }} />
          </span>
          <span>设置</span>
        </div>
      </div>
    </div>
  );
};

/* ---- mode options ---- */
const MODE_OPTS: Array<{ k: AppMode; label: string; dot: string; desc: string }> = [
  { k: 'readonly', label: '只读', dot: 'oklch(62% 0.12 145)', desc: '纯对话，不执行工具' },
  { k: 'planning', label: '规划', dot: 'oklch(72% 0.14 85)', desc: '先规划再执行' },
  { k: 'auto', label: '自动', dot: 'oklch(68% 0.16 280)', desc: '智能推理 + 工具' },
];
