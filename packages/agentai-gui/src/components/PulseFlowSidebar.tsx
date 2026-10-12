/**
 * PulseFlowSidebar — 全能侧栏 (文件夹式结构)
 * ----------------------------------------------------
 * 改进:
 *   - 按日期分组 (今天/昨天/本周/更早)
 *   - 支持自定义文件夹
 *   - 会话列表更清晰
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Input, Tooltip, Popconfirm, Dropdown, Modal, App } from 'antd';
import {
  MessageOutlined, FolderOpenOutlined,
  DeleteOutlined, EditOutlined, SearchOutlined, PlusOutlined,
  FileTextOutlined, DownOutlined, UpOutlined, CloseOutlined,
  PlayCircleOutlined, CheckCircleOutlined, RollbackOutlined,
  FolderOutlined, FolderAddOutlined, MoreOutlined,
  CalendarOutlined, ClockCircleOutlined, BookOutlined,
  ThunderboltOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';
import { useSessionStore, type Session } from '../store/sessionStore';
import { useModelStore } from '../store/modelStore';
import { useTaskStore, type TaskSession } from '../store/taskStore';
import { useProfileStore } from '../store';
import { switchWorkspace, workspaceLabel } from '../utils/workspace-switch';
import WorkspacesPanel from './WorkspacesPanel';

type TabKey = 'sessions' | 'workspaces' | 'files' | 'tasks';

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
  return <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>{label}</span>;
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
      icon: <EditOutlined style={{ fontSize: 'var(--fs-micro)' }} />,
      onClick: () => setEditing(true),
    },
    {
      key: 'delete',
      label: '删除',
      icon: <DeleteOutlined style={{ fontSize: 'var(--fs-micro)' }} />,
      danger: true,
      onClick: () => {
        Modal.confirm({
          title: '确定删除此对话？',
          content: '删除后不可恢复',
          okText: '删除',
          cancelText: '取消',
          okButtonProps: { danger: true },
          onOk: () => onDelete(session.id),
        });
      },
    },
  ];

  return (
    <div
      onClick={() => !editing && onSelect(session.id)}
      onDoubleClick={(e) => { e.stopPropagation(); setDraft(session.title); setEditing(true); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 'var(--radius-sm)',
        cursor: editing ? 'default' : 'pointer',
        color: active ? 'var(--accent)' : 'var(--fg-2)',
        background: active ? 'var(--card)' : 'transparent',
        fontSize: 'var(--fs-sm)',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background 0.12s',
      }}
    >
      {/* 会话图标 */}
      <MessageOutlined style={{ fontSize: 'var(--fs-micro)', color: active ? 'var(--accent)' : 'var(--muted-2)' }} />
      
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
            style={{ height: 20, fontSize: 'var(--fs-micro)' }}
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
              {msgCount > 0 && <span style={{ fontSize: 'var(--fs-micro)' }}>· {msgCount}条消息</span>}
            </div>
          </>
        )}
      </div>
      
      {/* 更多操作 */}
      {!editing && (
        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
          <MoreOutlined style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', cursor: 'pointer', padding: '0 4px' }} />
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
          fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--muted)',
          userSelect: 'none',
        }}
      >
        <span style={{
          transition: 'transform 0.2s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
        }}>
          <DownOutlined style={{ fontSize: 'var(--fs-micro)' }} />
        </span>
        <CalendarOutlined style={{ fontSize: 'var(--fs-micro)' }} />
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

/** 按日期把会话切片 (抽成纯函数 — WorkspaceGroup 内二级分组复用) */
const groupByDate = (sessions: Session[]): Array<{ label: string; sessions: Session[] }> => {
  const groups: Record<string, Session[]> = {};
  sessions.forEach(s => {
    const g = getDateGroup(s.updatedAt);
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });
  return Object.entries(groups)
    .sort(([a], [b]) => getGroupWeight(a) - getGroupWeight(b))
    .map(([label, sess]) => ({ label, sessions: sess.sort((a, b) => b.updatedAt - a.updatedAt) }));
};

/**
 * SessionsByWorkspace — 工作区分组 (2026-10-12, 对齐 WorkBuddy 的层级)
 * 一级: 工作区 (可折叠, 当前工作区默认展开且置顶)
 * 二级: 日期 (复用 SessionsByDateGroup)
 */
const SessionsByWorkspace: React.FC<{
  label: string;
  wsKey: string;
  isCurrent: boolean;
  sessions: Session[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ label, wsKey, isCurrent, sessions, activeId, onSelect, onDelete }) => {
  // 当前工作区默认展开, 其余默认折叠 (避免历史工作区把当前会话挤出视野)
  const [collapsed, setCollapsed] = useState(!isCurrent && wsKey !== '未分类');
  const byDate = useMemo(() => groupByDate(sessions), [sessions]);

  return (
    <div style={{ marginBottom: 6 }}>
      {/* 工作区标题 */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        title={wsKey === '未分类' ? '未绑定工作区的历史会话' : wsKey}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 8px', cursor: 'pointer',
          fontSize: 'var(--fs-sm)', fontWeight: 600,
          color: isCurrent ? 'var(--accent)' : 'var(--fg-2)',
          background: isCurrent ? 'var(--accent-soft)' : 'transparent',
          borderRadius: 'var(--radius-md)',
          userSelect: 'none',
        }}
      >
        <span style={{
          transition: 'transform 0.2s',
          transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          display: 'inline-flex',
        }}>
          <DownOutlined style={{ fontSize: 'var(--fs-micro)' }} />
        </span>
        <FolderOpenOutlined style={{ fontSize: 'var(--fs-micro)' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: 'var(--muted-2)', fontWeight: 400, flexShrink: 0 }}>({sessions.length})</span>
      </div>

      {/* 会话列表 — 工作区展开后按日期二级分组 */}
      {!collapsed && (
        <div style={{ paddingLeft: 8 }}>
          {byDate.map(g => (
            <SessionsByDateGroup
              key={g.label}
              groupLabel={g.label}
              sessions={g.sessions}
              activeId={activeId}
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
  { key: 'sessions', label: '会话', icon: <MessageOutlined style={{ fontSize: 'var(--fs-sm)' }} /> },
  { key: 'workspaces', label: '工作区', icon: <AppstoreOutlined style={{ fontSize: 'var(--fs-sm)' }} /> },
  { key: 'files', label: '文件', icon: <FolderOpenOutlined style={{ fontSize: 'var(--fs-sm)' }} /> },
  { key: 'tasks', label: '工作流', icon: <ThunderboltOutlined style={{ fontSize: 'var(--fs-sm)' }} /> },
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
          onContextMenu={(e) => {
            e.preventDefault();
            // P0 新增: 右键菜单 — 发送文件到对话
            if (!isDir) {
              window.dispatchEvent(new CustomEvent('agentai:add-file-context', { detail: { path: node.path } }));
            }
          }}
          style={{ 
            paddingLeft: depth * 12 + 4, 
            padding: '2px 4px', 
            fontSize: 'var(--fs-micro)', 
            cursor: 'pointer',
            borderRadius: 'var(--radius-sm)', 
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
          {isHighlighted && <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-micro)', color: 'var(--accent)' }}>◀</span>}
        </div>
        {isDir && isExpanded && node.children && (
          <div>{node.children.map(c => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (!workspace) return <div style={{ padding: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>请先设置工作目录</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 4px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{workspace}</span>
        <button onClick={loadTree} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-2)', fontSize: 'var(--fs-micro)', padding: 2 }}>⟳</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '2px 0' }}>
        {loading ? <div style={{ padding: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>加载中...</div>
          : tree.length === 0 ? <div style={{ padding: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>空目录</div>
          : tree.map(n => renderNode(n, 0))}
      </div>
    </div>
  );
};

/** Gateway HTTP base */
const GW_HTTP = (() => {
  const gw = (typeof window !== 'undefined' ? (window as any).__AGENTAI_GATEWAY__ : '') || 'ws://127.0.0.1:18789';
  return gw.replace(/^ws([s]?):\/\//, 'http$1://');
})();

/** 预置工作流卡片 */
const PresetWorkflowList: React.FC = () => {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${GW_HTTP}/api/preset-workflows`);
      if (r.ok) {
        const j = await r.json();
        setWorkflows(j.workflows || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTrigger = (w: any) => {
    // 构建结构化触发消息
    let msg = `我要执行「${w.description || w.name}」工作流。\n\n`;

    // 执行步骤
    if (w.stages && w.stages.length > 0) {
      msg += `执行步骤:\n`;
      w.stages.forEach((s: any) => {
        msg += `${s.step}. ${s.description}\n`;
      });
      msg += '\n';
    }

    // 参数
    if (w.parameters && w.parameters.length > 0) {
      msg += `需要以下参数:\n`;
      w.parameters.forEach((p: any) => {
        const req = p.required ? '必填' : '可选';
        const def = p.default !== undefined ? `, 默认: ${p.default}` : '';
        const opts = p.options ? `, 可选值: ${p.options.map((o: any) => o.value).join('/')}` : '';
        msg += `- ${p.label} (${req}${def}${opts}): ${p.placeholder || p.description || p.name}\n`;
      });
      msg += '\n';
    }

    // 示例
    if (w.examples && w.examples.length > 0) {
      const ex = w.examples[0];
      msg += `示例: ${ex.title} — ${ex.description}\n`;
      if (ex.input) {
        msg += `示例输入: ${JSON.stringify(ex.input, null, 2)}\n`;
      }
      msg += '\n';
    }

    msg += `请根据以上工作流信息开始执行。如果缺少必填参数，请使用默认值或询问我。使用你可用的工具逐步完成每个步骤。`;

    window.dispatchEvent(new CustomEvent('agentai:trigger-workflow', {
      detail: {
        workflow: w.name,
        message: msg,
        parameters: w.parameters,
      },
    }));
  };

  if (loading) {
    return <div style={{ padding: 12, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>加载工作流...</div>;
  }

  if (workflows.length === 0) {
    return (
      <div style={{ padding: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <ThunderboltOutlined style={{ fontSize: 'var(--fs-xl)', color: 'var(--muted-2)', marginBottom: 8 }} />
          <div>暂无预置工作流</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 4px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <ThunderboltOutlined style={{ fontSize: 'var(--fs-micro)' }} />
        <span style={{ flex: 1 }}>预置工作流 ({workflows.length})</span>
        <button onClick={load} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-2)', fontSize: 'var(--fs-micro)', padding: 2 }}>⟳</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
        {workflows.map((w) => (
          <div
            key={w.name}
            onClick={() => handleTrigger(w)}
            style={{
              padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 4,
              display: 'flex', alignItems: 'flex-start', gap: 6,
              border: '1px solid var(--border)',
              transition: 'background 0.12s, border-color 0.12s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'var(--accent-soft)';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
            }}
          >
            <span style={{ fontSize: 'var(--fs-lg)', flexShrink: 0 }}>{w.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{w.description || w.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}>
                <span style={{
                  fontSize: 'var(--fs-micro)', color: 'var(--accent)',
                  background: 'var(--accent-soft)', padding: '0 4px', borderRadius: 'var(--radius-sm)',
                }}>{w.category}</span>
                <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>~{w.estimatedTime}分钟</span>
              </div>
            </div>
          </div>
        ))}
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
  // antd message API (点进历史会话切工作区时提示) — 需在 antd <App> 上下文内
  const { message: messageApi } = App.useApp();
  // ★ 修复: 从 getState() 静态快照改为 hook 响应式订阅
  // 原代码用 getState() 只读一次渲染时的快照, store 变化后组件不重渲染,
  // 导致「删除会话后列表不消失」「点击会话不高亮激活」「新建会话不出现」。
  const { createSession, deleteSession, updateTitle, activeId } = useSessionStore();
  const localSessions = useSessionStore((s) => s.getMySessions());

  // 批次8: gateway 为主 + 本地缓存 — 拉 /api/sessions (每条已带 workspace),
  // 与本地 sessionStore 按 id 合并 (gateway 优先, 本地未同步的补在后面)。
  // gateway 不可达时静默降级为纯本地。
  const [gatewaySessions, setGatewaySessions] = useState<Session[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${GW_HTTP}/api/sessions`);
        if (!r.ok) return;
        const json = await r.json();
        const list: any[] = json?.sessions || [];
        if (cancelled || !list.length) return;
        const mapped: Session[] = list.map((g: any) => ({
          id: g.sessionId,
          title: g.name || `会话 ${g.sessionId?.slice(-4)}`,
          messages: [],
          createdAt: g.createdAt || 0,
          updatedAt: g.updatedAt || 0,
          workspace: g.workspace || undefined,
          userId: g.userId || 'default',
        }));
        setGatewaySessions(mapped);
      } catch { /* gateway 不可达 → 保持空, 纯本地 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const sessions = useMemo(() => {
    const byId = new Map<string, Session>();
    // ✅ 修复 (批次8.6): 只显示**本地已同步**的会话 (sessionStore 里有 id)。
    //   gateway 侧栏只用来"补充 updatedAt 更权威的时间戳", 不把纯 gateway 的
    //   checkpoint 灌进列表 —— 否则用户看到一堆"会话 xxx + N 条消息"的占位项,
    //   而不是"摘要 + 真实标题", 且点这些项时工作区切不动 (见 onSelect)。
    for (const s of localSessions) byId.set(s.id, s);
    // 仅对本地已有的 id 覆盖 updatedAt (gateway 是权威时间戳)
    const localIds = new Set(localSessions.map(s => s.id));
    for (const g of gatewaySessions) {
      if (localIds.has(g.id)) {
        const local = byId.get(g.id)!;
        byId.set(g.id, { ...local, updatedAt: Math.max(local.updatedAt || 0, g.updatedAt || 0) });
      }
    }
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [localSessions, gatewaySessions]);

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
  
  // 按工作区分组会话 (2026-10-12 — 对齐 WorkBuddy: 工作区是一级容器, 会话是其子节点)
  // 组内再按日期二级分组 (groupByDate 复用于 WorkspaceGroup, 无重复逻辑)
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return q ? sessions.filter(s => s.title.toLowerCase().includes(q)) : sessions;
  }, [sessions, searchQuery]);

  const groupedByWorkspace = useMemo(() => {
    const groups: Record<string, Session[]> = {};
    filteredSessions.forEach(s => {
      // 空 / 迁移默认值 '未指定工作区' 统一收进 '未分类' 桶 (一个空桶, 清爽)
      const raw = (s.workspace || '').trim();
      const key = (!raw || raw === '未指定工作区') ? '未分类' : raw;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    });
    // 当前工作区置顶, 其余按最近更新排序
    const cur = workspace.replace(/[\\/]+$/, '');
    return Object.entries(groups)
      .map(([ws, sess]) => ({
        ws,
        label: workspaceLabel(ws, '未分类'),
        isCurrent: !!cur && ws.replace(/[\\/]+$/, '') === cur,
        sessions: sess.sort((a, b) => b.updatedAt - a.updatedAt),
        lastAt: Math.max(...sess.map(s => s.updatedAt)),
      }))
      .sort((a, b) => (a.isCurrent === b.isCurrent ? b.lastAt - a.lastAt : a.isCurrent ? -1 : 1));
  }, [filteredSessions, workspace]);

  const handleNewSession = (type: 'chat' | 'image' | 'video' = 'chat') => {
    const titles = { chat: '新对话', image: '生图任务', video: '生视频任务' };
    // 2026-10-12: 新会话绑定当前工作区 — 否则侧栏按工作区分组时会全部落到"未分类",
    // 且点进历史会话无法把工作区切回原处。
    createSession(titles[type], undefined, type, workspace);
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
                onClick={() => handleNewSession('chat')}
                style={{
                  width: '100%', padding: '6px 8px', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-micro)',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  border: '1px solid var(--accent)', cursor: 'pointer', fontWeight: 500,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  marginBottom: 6,
                }}
              >
                <PlusOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                新对话
              </button>
              
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索会话..."
                variant="borderless"
                size="small"
                prefix={<SearchOutlined style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }} />}
                style={{
                  background: 'var(--card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '4px 8px',
                  fontSize: 'var(--fs-micro)',
                }}
              />
            </div>
            
            {/* 会话列表 — 按工作区分组 (一级) → 日期 (二级) */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>
              {groupedByWorkspace.length === 0 ? (
                <div style={{
                  padding: '20px 8px',
                  textAlign: 'center',
                  color: 'var(--muted-2)',
                  fontSize: 'var(--fs-micro)',
                }}>
                  {searchQuery ? '未找到匹配的会话' : '暂无对话'}
                </div>
              ) : (
                groupedByWorkspace.map(g => (
                  <SessionsByWorkspace
                    key={g.ws}
                    wsKey={g.ws}
                    label={g.label}
                    isCurrent={g.isCurrent}
                    sessions={g.sessions}
                    activeId={activeId || undefined}
                    onSelect={id => {
                      // ★ 修复 (批次8.6): 从**合并后的** sessions 里查 (含 gateway 补的 workspace),
                      //   而不是只查本地 sessionStore —— 否则对"只在 gateway 里"的会话
                      //   session=undefined, switchWorkspace 被跳过 → 点击不切工作区。
                      const session = sessions.find(s => s.id === id)
                        || useSessionStore.getState().sessions.find(s => s.id === id);
                      // 点击生图会话时自动切换到 image_edit 模式并选择生图模型
                      if (session?.type === 'image') {
                        useModelStore.getState().setChatMode('image_edit');
                        const imgModels = useModelStore.getState().models.filter(m => m.modelType === 'image' && m.enabled);
                        if (imgModels.length > 0) useModelStore.getState().setActive(imgModels[0].id);
                      }
                      // ★ 恢复该会话原本的工作区 —— 进旧会话后文件/工具才在正确目录跑
                      if (session?.workspace) {
                        if (switchWorkspace(session.workspace)) {
                          messageApi.info(`已切换到工作区：${workspaceLabel(session.workspace)}`);
                        }
                      }
                      useSessionStore.getState().setActive(id);
                    }}
                    onDelete={id => {
                      deleteSession(id);
                      // ★ 修复: 删除当前激活会话后自动切换到相邻会话, 避免空白/残留旧消息
                      if (activeId === id) {
                        const remaining = useSessionStore.getState().getMySessions();
                        if (remaining.length > 0) {
                          useSessionStore.getState().setActive(remaining[0].id);
                        } else {
                          chatStore.clearMessages();
                        }
                      }
                    }}
                  />
                ))
              )}
            </div>
          </div>
        );
      case 'files':
        return <FileTreePanel workspace={workspace} onFileOpen={onFileOpen} />;
      case 'workspaces':
        return <WorkspacesPanel />;
      case 'tasks':
        return <PresetWorkflowList />;
    }
  };

  return (
    <div className="pf-panel-enter" style={{
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
              flex: 1, padding: '10px 4px', fontSize: 'var(--fs-micro)',
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
      
      {/* 内容区 — key 绑定 activeTab: tab 切换时重挂载播放 pf-fade-in 淡入 */}
      <div key={activeTab} className="pf-fade-in" style={{ flex: 1, overflow: 'hidden', padding: '4px 6px', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </div>
      
      {/* 底部用户信息 + 使用说明入口 */}
      <div style={{
        padding: '8px 10px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-micro)',
      }}>
        <span style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366F1,#EC4899)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--fg-on-accent)', fontSize: 'var(--fs-micro)', fontWeight: 700, flexShrink: 0,
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
              color: 'var(--muted-2)', cursor: 'pointer', fontSize: 'var(--fs-md)', padding: 2,
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--accent)'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.color = 'var(--muted-2)'}
          >
            <BookOutlined style={{ fontSize: 'var(--fs-md)' }} />
          </button>
        </Tooltip>
        <Tooltip title="设置">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'settings' } }))}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--muted-2)', cursor: 'pointer', fontSize: 'var(--fs-md)', padding: 2,
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
