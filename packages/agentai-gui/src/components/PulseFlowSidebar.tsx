/**
 * PulseFlowSidebar — 全能侧栏 (文件夹式结构)
 * ----------------------------------------------------
 * 改进:
 *   - 按日期分组 (今天/昨天/本周/更早)
 *   - 支持自定义文件夹
 *   - 会话列表更清晰
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Input, Tooltip, Popconfirm, Dropdown, Modal } from 'antd';
import {
  MessageOutlined, FolderOpenOutlined, SyncOutlined,
  DeleteOutlined, EditOutlined, SearchOutlined, PlusOutlined,
  FileTextOutlined, DownOutlined, UpOutlined, CloseOutlined,
  PlayCircleOutlined, CheckCircleOutlined, RollbackOutlined,
  FolderOutlined, FolderAddOutlined, MoreOutlined,
  CalendarOutlined, ClockCircleOutlined, BookOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';
import { useSessionStore, type Session } from '../store/sessionStore';
import { useTaskOrchestrator, type TaskSession } from '../store/taskOrchestratorStore';
import { useProfileStore } from '../store';

type TabKey = 'sessions' | 'files' | 'tasks';

/** 文件夹类型 */
interface SessionFolder {
  id: string;
  name: string;
  createdAt: number;
}

/** 获取日期分组标签 */
const getDateGroup = (timestamp: number): string => {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';
  if (diffDays < 7) return '本周';
  if (diffDays < 30) return '本月';
  return '更早';
};

/** 日期分组排序权重 */
const getGroupWeight = (group: string): number => {
  switch (group) {
    case '今天': return 0;
    case '昨天': return 1;
    case '本周': return 2;
    case '本月': return 3;
    case '更早': return 4;
    default: return 5;
  }
};

const RelativeTime: React.FC<{ ts: number }> = ({ ts }) => {
  const [label, setLabel] = useState('');
  useEffect(() => {
    const diff = Date.now() - ts;
    if (diff < 60000) setLabel('刚刚');
    else {
      const m = Math.floor(diff / 60000);
      if (m < 60) setLabel(m + '分钟前');
      else {
        const h = Math.floor(m / 60);
        if (h < 24) setLabel(h + '小时前');
        else {
          const d = Math.floor(h / 24);
          setLabel(d < 7 ? d + '天前' : Math.floor(d / 7) + '周前');
        }
      }
    }
  }, [ts]);
  return <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>{label}</span>;
};

/** 单个会话列表项 */
const SessionListItem: React.FC<{ 
  session: Session; 
  active: boolean; 
  onSelect: (id: string) => void; 
  onDelete: (id: string) => void;
  onRename?: (id: string, title: string) => void;
}> = ({ session, active, onSelect, onDelete, onRename }) => {
  const { updateTitle, clearSessionMessages } = useSessionStore.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<any>(null);
  
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select?.(); } }, [editing]);
  
  const commitTitle = () => {
    const t = draft.trim();
    if (t && t !== session.title) {
      updateTitle(session.id, t);
      onRename?.(session.id, t);
    } else {
      setDraft(session.title);
    }
    setEditing(false);
  };
  
  const msgCount = session.messages?.length || 0;
  
  // 右键菜单
  const items = [
    {
      key: 'rename',
      label: '重命名',
      icon: <EditOutlined style={{ fontSize: 11 }} />,
      onClick: () => setEditing(true),
    },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined style={{ fontSize: 11 }} />,
      danger: true,
      popConfirm: {
        title: '确定删除此对话？',
        onConfirm: () => onDelete(session.id),
      },
    },
  ];

  return (
    <div
      onClick={() => !editing && onSelect(session.id)}
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(session.title); setEditing(true); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 5,
        cursor: editing ? 'default' : 'pointer',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        background: active ? 'var(--card)' : 'transparent',
        fontSize: 12,
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background 0.12s',
      }}
    >
      {/* 会话图标 */}
      <MessageOutlined style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--muted-2)' }} />
      
      {/* 会话信息 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <Input
            ref={inputRef}
            size="small"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onPressEnter={commitTitle}
            onBlur={commitTitle}
            style={{ height: 20, fontSize: 11 }}
          />
        ) : (
          <>
            <div style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontWeight: active ? 600 : 400,
            }}>
              {session.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 1 }}>
              <RelativeTime ts={session.updatedAt} />
              {msgCount > 0 && <span style={{ fontSize: 9 }}>· {msgCount}条消息</span>}
            </div>
          </>
        )}
      </div>
      
      {/* 更多操作 */}
      {!editing && (
        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
          <MoreOutlined style={{ fontSize: 10, color: 'var(--muted-2)', cursor: 'pointer', padding: '0 4px' }} />
        </Dropdown>
      )}
    </div>
  );
};

/** 按日期分组的会话 */
const SessionsByDateGroup: React.FC<{
  groupLabel: string;
  sessions: Session[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ groupLabel, sessions, activeId, onSelect, onDelete }) => {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ marginBottom: 4 }}>
      {/* 分组标题 */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 8px', cursor: 'pointer',
          fontSize: 10, fontWeight: 600, color: 'var(--muted)',
          userSelect: 'none',
        }}
      >
        <span style={{
          transition: 'transform 0.2s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        }}>
          <DownOutlined style={{ fontSize: 8 }} />
        </span>
        <CalendarOutlined style={{ fontSize: 10 }} />
        <span>{groupLabel}</span>
        <span style={{ color: 'var(--muted-2)', fontWeight: 400 }}>({sessions.length})</span>
      </div>
      
      {/* 会话列表 */}
      {!collapsed && (
        <div style={{ paddingLeft: 16 }}>
          {sessions.map(s => (
            <SessionListItem
              key={s.id}
              session={s}
              active={s.id === activeId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'sessions', label: '会话', icon: <MessageOutlined style={{ fontSize: 12 }} /> },
  { key: 'files', label: '文件', icon: <FolderOpenOutlined style={{ fontSize: 12 }} /> },
  { key: 'tasks', label: '任务', icon: <SyncOutlined style={{ fontSize: 12 }} /> },
];

/* ════════════ File tree panel ════════════ */
interface FsNode { name: string; path: string; type: 'file' | 'dir'; children?: FsNode[]; }
const FileTreePanel: React.FC<{ workspace: string; onFileOpen?: (path: string) => void }> = ({ workspace, onFileOpen }) => {
  const [tree, setTree] = useState<FsNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [highlightPath, setHighlightPath] = useState<string>(''); // 高亮目标文件

  const loadTree = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const r = await fetch(`/v1/files?workspace=${encodeURIComponent(workspace)}`);
      const data = await r.json();
      if (data?.tree) setTree(Array.isArray(data.tree) ? data.tree : [data.tree]);
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspace]);

  useEffect(() => { loadTree(); }, [loadTree]);

  // 监听 AI 创建文件事件 → 自动刷新
  useEffect(() => {
    const h = () => loadTree();
    window.addEventListener('agentai:file-created', h);
    return () => window.removeEventListener('agentai:file-created', h);
  }, [loadTree]);

  // 监听定位文件事件 → 展开到目标文件并高亮
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ path: string }>;
      const targetPath = ce.detail?.path;
      if (!targetPath) return;
      
      // 设置高亮路径
      setHighlightPath(targetPath);
      
      // 展开所有父目录
      const newExpanded: Record<string, boolean> = {};
      let current = targetPath;
      while (current && current !== workspace) {
        newExpanded[current] = true;
        const parent = current.replace(/[/\\][^/\\]+$/, '') || current;
        if (parent === current) break;
        current = parent;
      }
      setExpanded(prev => ({ ...prev, ...newExpanded }));
      
      // 5秒后清除高亮
      setTimeout(() => setHighlightPath(''), 5000);
    };
    
    window.addEventListener('agentai:sidebar-locate-file', handler);
    return () => window.removeEventListener('agentai:sidebar-locate-file', handler);
  }, [workspace]);

  /**
   * 递归展开到目标路径的所有父目录
   */
  const expandToPath = useCallback((targetPath: string) => {
    const newExpanded: Record<string, boolean> = { ...expanded };
    
    // 从目标路径向上，展开每个父目录
    let current = targetPath;
    while (current && current.length > workspace.length) {
      // 检查是否是树中的节点
      const checkInTree = (nodes: FsNode[]): boolean => {
        for (const node of nodes) {
          if (current.startsWith(node.path)) {
            newExpanded[node.path] = true;
            if (node.children) checkInTree(node.children);
            return true;
          }
        }
        return false;
      };
      checkInTree(tree);
      
      // 移到最后一个路径分隔符
      const lastSep = Math.max(current.lastIndexOf('/'), current.lastIndexOf('\\'));
      if (lastSep <= 0) break;
      current = current.slice(0, lastSep);
    }
    
    setExpanded(newExpanded);
  }, [tree, expanded, workspace]);

  const renderNode = (node: FsNode, depth: number): React.ReactNode => {
    const isExpanded = expanded[node.path];
    const isDir = node.type === 'dir';
    const isHighlighted = node.path === highlightPath;
    
    return (
      <div key={node.path}>
        <div
          onClick={() => {
            if (isDir) setExpanded(p => ({ ...p, [node.path]: !p[node.path] }));
            else onFileOpen?.(node.path);
          }}
          style={{ 
            paddingLeft: depth * 12 + 4, 
            padding: '2px 4px', 
            fontSize: 11, 
            cursor: 'pointer',
            borderRadius: 3, 
            display: 'flex', 
            alignItems: 'center', 
            gap: 4,
            color: 'var(--fg-2)', 
            whiteSpace: 'nowrap', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis',
            background: isHighlighted ? 'rgba(99,102,241,0.15)' : undefined,
            border: isHighlighted ? '1px solid rgba(99,102,241,0.4)' : '1px solid transparent',
          }}
          onMouseEnter={e => { if (!isHighlighted) (e.currentTarget as HTMLElement).style.background = 'var(--card)'; }}
          onMouseLeave={e => { if (!isHighlighted) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          {isDir ? (isExpanded ? '📂' : '📁') : '📄'}
          <span style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis',
            fontWeight: isHighlighted ? 600 : 'normal',
            color: isHighlighted ? 'var(--accent)' : undefined,
          }}>{node.name}</span>
          {isHighlighted && <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--accent)' }}>◀</span>}
        </div>
        {isDir && isExpanded && node.children && (
          <div>{node.children.map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (!workspace) return <div style={{ padding: 8, fontSize: 11, color: 'var(--muted-2)' }}>请先设置工作目录</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 4px', fontSize: 10, color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{workspace}</span>
        <button onClick={loadTree} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-2)', fontSize: 10, padding: 2 }}>⟳</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
        {loading ? <div style={{ padding: 8, fontSize: 11, color: 'var(--muted-2)' }}>加载中...</div>
          : tree.length === 0 ? <div style={{ padding: 8, fontSize: 11, color: 'var(--muted-2)' }}>空目录</div>
          : tree.map(n => renderNode(n, 0))}
      </div>
    </div>
  );
};

export const PulseFlowSidebar: React.FC<{ width?: number; onFileOpen?: (path: string) => void; compact?: boolean }> = ({ width = 260, onFileOpen, compact = false }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const { profile } = useProfileStore();
  const workspace = profile?.workspace || localStorage.getItem('agentai.workspace') || '';
  const { createSession, deleteSession, getMySessions, updateTitle } = useSessionStore.getState();
  const sessions = getMySessions();
  const activeId = useSessionStore.getState().activeId;
  const chatStore = useChatStore.getState();

  // 监听定位文件事件 → 自动切换到"文件"tab
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ path: string; tab?: string }>;
      // 切换到指定的 tab（默认是 'files'）
      if (ce.detail?.tab) {
        setActiveTab(ce.detail.tab as TabKey);
      } else {
        setActiveTab('files');
      }
    };
    window.addEventListener('agentai:sidebar-locate-file', handler);
    return () => window.removeEventListener('agentai:sidebar-locate-file', handler);
  }, []);
  
  // 按日期分组会话
  const groupedSessions = useMemo(() => {
    const filtered = searchQuery
      ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : sessions;
    
    const groups: Record<string, Session[]> = {};
    filtered.forEach(s => {
      const group = getDateGroup(s.updatedAt);
      if (!groups[group]) groups[group] = [];
      groups[group].push(s);
    });
    
    // 按日期排序
    return Object.entries(groups)
      .sort(([a], [b]) => getGroupWeight(a) - getGroupWeight(b))
      .map(([label, sess]) => ({ label, sessions: sess.sort((a, b) => b.updatedAt - a.updatedAt) }));
  }, [sessions, searchQuery]);

  const handleNewSession = () => {
    createSession('新对话');
    chatStore.clearMessages();
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    // TODO: 实现文件夹创建逻辑
    setShowNewFolderModal(false);
    setNewFolderName('');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'sessions':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* 操作栏 */}
            <div style={{ padding: '6px 4px' }}>
              <button
                onClick={handleNewSession}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 11,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent)', cursor: 'pointer', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  marginBottom: 6,
                }}
              >
                <PlusOutlined style={{ fontSize: 10 }} />
                新对话
              </button>
              
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索会话..."
                variant="borderless"
                size="small"
                prefix={<SearchOutlined style={{ fontSize: 10, color: 'var(--muted-2)' }} />}
                style={{
                  background: 'var(--card)',
                  borderRadius: 6,
                  padding: '4px 8px',
                  fontSize: 11,
                }}
              />
            </div>
            
            {/* 会话列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
              {groupedSessions.length === 0 ? (
                <div style={{
                  padding: '20px 8px',
                  textAlign: 'center',
                  color: 'var(--muted-2)',
                  fontSize: 11,
                }}>
                  {searchQuery ? '未找到匹配的会话' : '暂无对话'}
                </div>
              ) : (
                groupedSessions.map(group => (
                  <SessionsByDateGroup
                    key={group.label}
                    groupLabel={group.label}
                    sessions={group.sessions}
                    activeId={activeId || undefined}
                    onSelect={id => { useSessionStore.getState().setActive(id); }}
                    onDelete={id => { deleteSession(id); }}
                  />
                ))
              )}
            </div>
          </div>
        );
      case 'files':
        return <FileTreePanel workspace={workspace} onFileOpen={onFileOpen} />;
      case 'tasks':
        return (
          <div style={{ padding: 8, fontSize: 11, color: 'var(--muted-2)' }}>
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <SyncOutlined style={{ fontSize: 24, color: 'var(--muted-2)', marginBottom: 8 }} />
              <div>任务面板开发中...</div>
            </div>
          </div>
        );
    }
  };

  return (
    <div style={{
      width, height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--panel)', borderRight: '1px solid var(--border)',
    }}>
      {/* 标签页 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              flex: 1, padding: '10px 4px', fontSize: 11,
              fontWeight: activeTab === tab.key ? 600 : 400,
              background: activeTab === tab.key ? 'var(--accent-soft)' : 'transparent',
              color: activeTab === tab.key ? 'var(--accent)' : 'var(--fg-2)',
              border: 'none',
              borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            {tab.icon}
            {!compact && <span>{tab.label}</span>}
          </button>
        ))}
      </div>
      
      {/* 内容区 */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '4px 6px', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </div>
      
      {/* 底部用户信息 + 使用说明入口 */}
      <div style={{
        padding: '8px 10px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
      }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366F1,#EC4899)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 10, fontWeight: 700, flexShrink: 0,
        }}>
          {(profile?.name?.charAt(0) || 'U').toUpperCase()}
        </span>
        <span style={{
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: 'var(--fg)', fontWeight: 500,
        }}>
          {profile?.name || '未登录'}
        </span>
        <Tooltip title="使用说明 (系统完整能力文档)">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('agentai:show-guide'))}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--muted-2)', cursor: 'pointer', fontSize: 14, padding: 2,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'}
          >
            <BookOutlined style={{ fontSize: 13 }} />
          </button>
        </Tooltip>
        <Tooltip title="设置">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'settings' } }))}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--muted-2)', cursor: 'pointer', fontSize: 14, padding: 2,
            }}
          >
            ⚙
          </button>
        </Tooltip>
      </div>
      
      {/* 新建文件夹弹窗 */}
      <Modal
        title="新建文件夹"
        open={showNewFolderModal}
        onOk={handleCreateFolder}
        onCancel={() => { setShowNewFolderModal(false); setNewFolderName(''); }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          value={newFolderName}
          onChange={e => setNewFolderName(e.target.value)}
          placeholder="输入文件夹名称"
          onPressEnter={handleCreateFolder}
          autoFocus
        />
      </Modal>
    </div>
  );
};
