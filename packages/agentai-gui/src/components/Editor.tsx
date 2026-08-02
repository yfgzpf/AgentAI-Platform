/**
 * Editor - PulseFlow 文件编辑器
 * ----------------------------------------------------
 * - 左侧文件树 (懒加载, 盘符级 Open Folder)
 * - 右侧多标签编辑器 (脏标记 / 保存 / AI 改写)
 * - 顶栏: 面包屑 + Open Folder + 搜索 + 工具栏
 * - 状态栏: 文件数 / tab 数 / 自动保存状态
 * - 浏览器内: 不能弹原生目录选择, 通过 Gateway /v1/fs/drives 列盘符 + 手动输入
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useChatStore } from '../store/chatStore';
import {
  Tree, Input, Button, Space, message, Spin, Dropdown, Modal, Empty, Tooltip,
  Tabs, Tag, App,
} from 'antd';
import {
  FolderOutlined, FolderOpenOutlined, FileOutlined, FileTextOutlined, ReloadOutlined, SaveOutlined,
  EditOutlined, FileAddOutlined, FolderAddOutlined,
  SearchOutlined, SendOutlined, CloseOutlined, CheckOutlined,
  DesktopOutlined, HomeOutlined, CodeOutlined, DeleteOutlined, EditOutlined as RenameIcon,
  FolderOpenOutlined as OpenFolderIcon, GlobalOutlined, RobotOutlined,
  AppstoreAddOutlined, EnvironmentOutlined, HddOutlined, BulbOutlined, PushpinOutlined, CopyOutlined,
  CodeOutlined as TerminalOutlined,
} from '@ant-design/icons';
import { useProfileStore } from '../store';
import { EditorChatPanel } from './EditorChatPanel';
import { MonacoEditor, detectLangFromPath, type AICodeDecoration } from './MonacoEditor';
import { useTaskOrchestrator } from '../store/taskOrchestratorStore';
import { FileTimeline } from '../services/FileTimeline';
import { gatewayFallback } from '../services/GatewayFallback';
import { UnifiedWorkspace } from './UnifiedWorkspace';
import { useWorkspaceStore } from '../store/workspaceStore';

interface FsEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
}

interface TreeNode {
  key: string;
  title: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  path: string;
  type: 'directory' | 'file';
  loaded?: boolean;
}

interface OpenFile {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  language: string;
  readonly: boolean;
}

const baseUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

const LANGS: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.json': 'json', '.md': 'markdown', '.txt': 'text',
  '.yml': 'yaml', '.yaml': 'yaml', '.toml': 'text', '.html': 'html', '.css': 'css',
  '.rs': 'rust', '.go': 'go', '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'cpp',
};

const detectLang = (filename: string): string => {
  for (const ext in LANGS) if (filename.endsWith(ext)) return LANGS[ext]!;
  return 'text';
};

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
};

const API = {
  drives: () => fetch(`${baseUrl()}/v1/fs/drives`).then(r => r.json()),
  list: (dir: string) => fetch(`${baseUrl()}/v1/fs/list?dir=${encodeURIComponent(dir)}`).then(r => r.json()),
  read: (p: string) => fetch(`${baseUrl()}/v1/files/read?path=${encodeURIComponent(p)}`).then(r => r.json()),
  write: (p: string, content: string) => fetch(`${baseUrl()}/v1/files/write`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  }).then(r => r.json()),
  mkdir: (p: string) => fetch(`${baseUrl()}/v1/files/mkdir`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  }).then(r => r.json()),
  touch: (p: string, content = '') => fetch(`${baseUrl()}/v1/files/touch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  }).then(r => r.json()),
  rename: (from: string, to: string) => fetch(`${baseUrl()}/v1/files/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  }).then(r => r.json()),
  remove: (p: string) => fetch(`${baseUrl()}/v1/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' }).then(r => r.json()),
};

export const Editor: React.FC = () => {
  const { profile } = useProfileStore();
  const { modal, message: msgApi } = App.useApp();
  const [workspace, setWorkspace] = useState<string>(() => {
    return localStorage.getItem('agentai.workspace') || '';
  });
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeKey, setActiveKeyRaw] = useState<string>('');
  // 包装 setActiveKey: 同时存到 localStorage 让 ChatView 读取
  const setActiveKey = useCallback((key: string) => {
    setActiveKeyRaw(key);
    if (key) {
      localStorage.setItem('agentai.editor.activeFile', key);
    }
  }, []);
  const [searchQ, setSearchQ] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [openFolderModal, setOpenFolderModal] = useState(false);
  const [drivesInfo, setDrivesInfo] = useState<{ drives: string[]; common: string[] }>({ drives: [], common: [] });
  const [customPath, setCustomPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(true); // 默认开启 AI 对话面板
  const [showFileTree, setShowFileTree] = useState(false); // 默认折叠文件树, 给浏览器更多空间
  const [selectedPath, setSelectedPath] = useState<string>(''); // 用于定位文件时选中树节点
  const [showBottomPanel, setShowBottomPanel] = useState(false); // 默认关闭，保持浏览器清爽
  const [bottomPanelTab, setBottomPanelTab] = useState<'terminal' | 'logs' | 'browser' | 'problems'>('terminal');
  const bottomPanelHeight = 180;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [bpHeight, setBpHeight] = useState(180);
  const [aiPanelWidth, setAiPanelWidth] = useState(320); // AI 面板宽度（可拖拽）
  const aiDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // 底部面板拖拽分隔线
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: bpHeight };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - ev.clientY; // drag up = bigger
      setBpHeight(Math.max(80, Math.min(500, dragRef.current.startHeight + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [bpHeight]);

  // AI 面板水平拖拽分隔线
  const onAiDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    aiDragRef.current = { startX: e.clientX, startWidth: aiPanelWidth };
    const onMove = (ev: MouseEvent) => {
      if (!aiDragRef.current) return;
      const delta = aiDragRef.current.startX - ev.clientX; // drag left = bigger
      setAiPanelWidth(Math.max(200, Math.min(600, aiDragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      aiDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [aiPanelWidth]);

  // ===== 加载工作区根 =====
  const loadWorkspace = useCallback(async (dir: string) => {
    if (!dir) return;
    setLoading(true);
    try {
      const data = await API.list(dir);
      if (data.error) {
        msgApi.error(`打开失败: ${data.error}`);
        return;
      }
      const root: TreeNode = {
        key: dir,
        title: <span style={{ color: 'var(--warning)', fontWeight: 600 }}><FolderOpenOutlined style={{ marginRight: 4 }} />{dir.split(/[\\/]/).filter(Boolean).pop() || dir}</span>,
        path: dir,
        type: 'directory',
        isLeaf: false,
        loaded: true,
        children: (data.entries as FsEntry[]).map(buildNode),
      };
      setTree([root]);
      setWorkspace(dir);
      localStorage.setItem('agentai.workspace', dir);
    } catch (e: any) {
      msgApi.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [msgApi]);

  // 启动时: 浏览器为默认中屏, 有缓存就恢复文件树
  useEffect(() => {
    // 默认设为浏览器模式
    useWorkspaceStore.getState().setMode('browser');
    if (workspace) {
      loadWorkspace(workspace);
    } else {
      // 无缓存: 从 Gateway 获取项目根目录
      fetch(`${baseUrl()}/v1/fs/project-root`)
        .then(r => r.json())
        .then(data => {
          const root = data.projectRoot || data.cwd || '';
          if (root) loadWorkspace(root);
        })
        .catch(() => { /* Gateway 不可达, 保持空 */ });
    }
  }, []); // eslint-disable-line

  // ===== 构建树节点 =====
  const buildNode = (e: FsEntry): TreeNode => ({
    key: e.path,
    title: (
      <Space size={4}>
        {e.type === 'directory'
          ? <FolderOutlined style={{ color: 'var(--warning)' }} />
          : iconForFile(e.name)}
        <span style={{ color: 'var(--fg-2)', fontSize: 13 }}>{e.name}</span>
        {e.type === 'file' && e.size > 0 && (
          <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>{fmtSize(e.size)}</span>
        )}
      </Space>
    ),
    path: e.path,
    type: e.type,
    isLeaf: e.type === 'file',
    loaded: false,
    children: e.type === 'directory' ? [] : undefined,
  });

  const iconForFile = (name: string) => {
    if (name.endsWith('.tsx') || name.endsWith('.ts')) return <CodeOutlined style={{ color: '#3178c6' }} />;
    if (name.endsWith('.py')) return <CodeOutlined style={{ color: '#3572A5' }} />;
    if (name.endsWith('.json')) return <CodeOutlined style={{ color: 'var(--fg-2)' }} />;
    if (name.endsWith('.md')) return <FileOutlined style={{ color: 'var(--violet)' }} />;
    return <FileOutlined style={{ color: 'var(--fg-2)' }} />;
  };

  // ===== 递归不可变更新树 (让 AntD Tree 能检测到子节点变化) =====
  const updateTreeData = (list: TreeNode[], key: string, children: TreeNode[]): TreeNode[] => {
    return list.map(node => {
      if (node.key === key) {
        return { ...node, children: children.length > 0 ? children : undefined, loaded: true };
      }
      if (node.children) {
        return { ...node, children: updateTreeData(node.children, key, children) };
      }
      return node;
    });
  };

  // ===== AntD Tree 懒加载 =====
  const onLoadData = async (node: any): Promise<void> => {
    const tn = node as TreeNode;
    if (tn.loaded || tn.type !== 'directory') return;
    const dir = tn.path;
    try {
      const data = await API.list(dir);
      if (data.error) return;
      const entries: FsEntry[] = data.entries || [];
      const children = entries.map(buildNode);
      setTree(prev => updateTreeData(prev, dir, children));
    } catch {}
  };

  // Tree 选中: 文件就打开
  const onTreeSelect = (selectedKeys: React.Key[], info: any) => {
    const node = info.node as TreeNode;
    if (node && node.type === 'file') {
      openFile(node.path);
    }
  };

  // 监听全局事件: 在对话中点击文件时打开
  useEffect(() => {
    const handler = (e: any) => {
      const path = e?.detail?.path;
      if (typeof path === 'string' && path) {
        openFile(path);
      }
    };
    window.addEventListener('agentai:open-file', handler as any);
    
    // 监听定位文件事件（展开文件树并选中）
    const locateHandler = (e: any) => {
      const path = e?.detail?.path;
      if (typeof path === 'string' && path) {
        // 先打开文件
        openFile(path);
        // 然后尝试在文件树中定位（通过设置 selectedPath 触发树展开）
        setSelectedPath(path);
      }
    };
    window.addEventListener('agentai:locate-file', locateHandler as any);
    
    return () => {
      window.removeEventListener('agentai:open-file', handler as any);
      window.removeEventListener('agentai:locate-file', locateHandler as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFiles]);

  // ===== 打开文件 =====
  const openFile = async (filePath: string) => {
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveKey(filePath);
      // 同步到 workspaceStore (让 UnifiedWorkspace 切到编辑器模式)
      useWorkspaceStore.getState().openEditor({
        path: filePath,
        name: existing.name,
        type: 'file',
        ext: existing.name.includes('.') ? '.' + existing.name.split('.').pop()!.toLowerCase() : '',
      });
      return;
    }
    try {
      const data = await API.read(filePath);
      if (data.error) { msgApi.error('打开失败: ' + data.error); return; }
      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      const f: OpenFile = {
        path: filePath,
        name: fileName,
        content: data.content || '',
        dirty: false,
        language: detectLang(filePath),
        readonly: filePath.includes('node_modules') || filePath.includes('\\.git\\'),
      };
      setOpenFiles([...openFiles, f]);
      setActiveKey(filePath);
      // 同步到 workspaceStore
      useWorkspaceStore.getState().openEditor({
        path: filePath,
        name: fileName,
        type: 'file',
        ext: fileName.includes('.') ? '.' + fileName.split('.').pop()!.toLowerCase() : '',
      });
    } catch (e: any) {
      msgApi.error('读文件失败: ' + e.message);
    }
  };

  // ===== 保存 =====
  const saveActive = useCallback(async () => {
    const f = openFiles.find(x => x.path === activeKey);
    if (!f || f.readonly) return;
    const beforeContent = f.dirty ? undefined : await (async () => {
      try { const r = await API.read(f.path); return r.content; } catch { return undefined; }
    })();
    try {
      const data = await API.write(f.path, f.content);
      if (data.error) { msgApi.error('保存失败: ' + data.error); return; }
      setOpenFiles(openFiles.map(x => x.path === f.path ? { ...x, dirty: false } : x));
      msgApi.success(`✅ ${f.name} 已保存`);
      // 记录时间线
      FileTimeline.afterWrite(f.path, f.content, beforeContent, false, ['editor-save']);
    } catch (e: any) {
      msgApi.error('保存失败: ' + e.message);
    }
  }, [activeKey, openFiles, msgApi]);

  // 自动保存 (3 秒无改动)
  useEffect(() => {
    if (!autoSave) return;
    const t = setTimeout(async () => {
      for (const f of openFiles.filter(x => x.dirty)) {
        await API.write(f.path, f.content);
        FileTimeline.afterWrite(f.path, f.content, undefined, false, ['auto-save']);
      }
      setOpenFiles(prev => prev.map(x => x.dirty ? { ...x, dirty: false } : x));
    }, 3000);
    return () => clearTimeout(t);
  }, [openFiles, autoSave]);

  // ===== 编辑 (带 300ms 防抖, 避免每按键 O(n) 数组拷贝) =====
  const editTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editContent = (val: string) => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current);
    editTimerRef.current = setTimeout(() => {
      setOpenFiles(prev => prev.map(f => f.path === activeKey ? { ...f, content: val, dirty: true } : f));
    }, 300);
  };

  // ===== 关闭 tab =====
  const closeTab = (key: string) => {
    const f = openFiles.find(x => x.path === key);
    if (!f) return;
    const doClose = () => {
      const next = openFiles.filter(x => x.path !== key);
      setOpenFiles(next);
      if (activeKey === key) setActiveKey(next[next.length - 1]?.path || '');
    };
    if (f.dirty) {
      modal.confirm({
        title: `${f.name} 未保存, 确定关闭?`,
        okText: '关闭',
        cancelText: '取消',
        onOk: doClose,
      });
    } else doClose();
  };

  // ===== AI 改写 =====
  const aiEdit = async () => {
    const f = openFiles.find(x => x.path === activeKey);
    if (!f) { msgApi.warning('先打开一个文件'); return; }
    if (!aiPrompt.trim()) { msgApi.warning('写点指令'); return; }
    setAiBusy(true);
    try {
      const r = await fetch(`${baseUrl()}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请改写这段 ${f.name} 代码, 需求: ${aiPrompt}\n\n原代码:\n\`\`\`\n${String(f.content || '').slice(0, 6000)}\n\`\`\`\n\n只输出改写后的完整代码, 不要解释, 不要 markdown 围栏。`,
          userId: 'editor',
          workspace: workspace || '',
        }),
      });
      const data = await r.json();
      let code = data.content || '';
      code = code.replace(/^```[\w]*\n/, '').replace(/\n```$/, '').trim();
      editContent(code);
      msgApi.success('✨ AI 已改写, 按 Ctrl+S 保存');
    } catch (e: any) {
      msgApi.error('改写失败: ' + e.message);
    } finally {
      setAiBusy(false);
      setAiPrompt('');
    }
  };

  // ===== 文件操作: 新建 / 重命名 / 删除 =====
  const newFile = async (parentDir: string) => {
    let name = '';
    modal.confirm({
      title: '新建文件',
      content: (
        <Input
          autoFocus
          placeholder="文件名 (例: index.ts)"
          onChange={(e) => { name = e.target.value; }}
          onPressEnter={(e) => (e.target as any).target?.closest('.ant-modal')?.querySelector('.ant-btn-primary')?.click()}
        />
      ),
      onOk: async () => {
        if (!name) { msgApi.warning('请输入文件名'); return Promise.reject(); }
        const p = parentDir.replace(/[\\/]$/, '') + (parentDir.includes('\\') ? '\\' : '/') + name;
        const r = await API.touch(p, '');
        if (r.error) { msgApi.error(r.error); return Promise.reject(); }
        FileTimeline.afterWrite(p, '', undefined, false, ['create']);
        msgApi.success(`已创建 ${name}`);
        await loadWorkspace(workspace);
      },
    });
  };

  const newFolder = async (parentDir: string) => {
    let name = '';
    modal.confirm({
      title: '新建文件夹',
      content: (
        <Input
          autoFocus
          placeholder="文件夹名"
          onChange={(e) => { name = e.target.value; }}
        />
      ),
      onOk: async () => {
        if (!name) { msgApi.warning('请输入名字'); return Promise.reject(); }
        const p = parentDir.replace(/[\\/]$/, '') + (parentDir.includes('\\') ? '\\' : '/') + name;
        const r = await API.mkdir(p);
        if (r.error) { msgApi.error(r.error); return Promise.reject(); }
        msgApi.success(`已创建 ${name}/`);
        await loadWorkspace(workspace);
      },
    });
  };

  const renameItem = async (oldPath: string) => {
    const oldName = oldPath.split(/[\\/]/).pop() || oldPath;
    let newName = oldName;
    modal.confirm({
      title: '重命名',
      content: (
        <Input
          autoFocus
          defaultValue={oldName}
          onChange={(e) => { newName = e.target.value; }}
        />
      ),
      onOk: async () => {
        if (!newName || newName === oldName) return;
        const to = oldPath.replace(/[\\/][^\\/]+$/, (m) => m[0] + newName);
        const r = await API.rename(oldPath, to);
        if (r.error) { msgApi.error(r.error); return Promise.reject(); }
        FileTimeline.recordRename(oldPath, to, false);
        msgApi.success('已重命名');
        await loadWorkspace(workspace);
      },
    });
  };

  const deleteItem = async (p: string, name: string) => {
    modal.confirm({
      title: `确定删除 ${name}?`,
      content: '不可恢复',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        // 删除前先读取内容作为快照
        let beforeContent: string | undefined;
        try { const r = await API.read(p); beforeContent = r.content; } catch { /* ignore */ }
        const r = await API.remove(p);
        if (r.error) { msgApi.error(r.error); return; }
        if (beforeContent !== undefined) FileTimeline.recordDelete(p, beforeContent, false);
        msgApi.success(`已删除 ${name}`);
        setOpenFiles(openFiles.filter(f => !f.path.startsWith(p)));
        if (activeKey.startsWith(p)) setActiveKey('');
        await loadWorkspace(workspace);
      },
    });
  };

  // ===== 节点右键菜单 =====
  const renderContextMenu = (node: TreeNode) => [
    { key: 'open', label: '打开', icon: <OpenFolderIcon />, onClick: () => node.type === 'file' && openFile(node.path) },
    { key: 'newFile', label: '新建文件', icon: <FileAddOutlined />, onClick: () => newFile(node.path) },
    { key: 'newFolder', label: '新建文件夹', icon: <FolderAddOutlined />, onClick: () => newFolder(node.path) },
    { type: 'divider' as const },
    { key: 'rename', label: '重命名', icon: <RenameIcon />, onClick: () => renameItem(node.path) },
    { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => deleteItem(node.path, node.title?.toString() || node.path) },
  ];

  // ===== 打开盘符弹窗 =====
  const openDrivesModal = async () => {
    setOpenFolderModal(true);
    const d = await API.drives();
    setDrivesInfo(d);
  };

  // ===== 状态栏数据 =====
  const active = openFiles.find(f => f.path === activeKey);
  const dirtyCount = openFiles.filter(f => f.dirty).length;
  const fileCount = (() => {
    let n = 0;
    const walk = (nodes: TreeNode[]) => nodes.forEach(node => {
      if (node.type === 'file') n++;
      if (node.children) walk(node.children);
    });
    walk(tree);
    return n;
  })();

  // ===== 渲染 =====
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--editor-bg)' }}>
      {/* ===== 顶栏 ===== */}
      <div style={{ padding: '6px 10px', background: 'var(--editor-header)',
        borderBottom: '1px solid var(--editor-divider)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="small" type="primary" icon={<FolderOpenOutlined />} onClick={openDrivesModal}>
          打开文件夹
        </Button>
        <Tooltip title={showFileTree ? '折叠文件树' : '展开文件树'}>
          <Button size="small" icon={<FolderOutlined />} onClick={() => setShowFileTree(v => !v)} style={{ fontSize: 10 }} />
        </Tooltip>
        <Button size="small" icon={<FileAddOutlined />} disabled={!workspace} onClick={() => newFile(workspace)} title="新建文件到根" />
        <Button size="small" icon={<FolderAddOutlined />} disabled={!workspace} onClick={() => newFolder(workspace)} title="新建文件夹到根" />
        <Button size="small" icon={<ReloadOutlined />} disabled={!workspace} onClick={() => loadWorkspace(workspace)} title="刷新" />
        <div style={{ width: 1, height: 20, background: '#333' }} />
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder="搜文件名..."
          value={searchQ}
          onChange={e => setSearchQ(e.target.value)}
          style={{ width: 180 }}
        />
        <div style={{ flex: 1 }} />
        {/* 精简工具栏: 只保留核心功能 */}
        <Tooltip title={showBottomPanel ? '隐藏终端' : '显示终端'}>
          <Button
            size="small"
            type={showBottomPanel ? 'primary' : 'text'}
            icon={<AppstoreAddOutlined />}
            onClick={() => setShowBottomPanel(v => !v)}
          />
        </Tooltip>
        <Tooltip title={showAiPanel ? '隐藏 AI 面板' : '显示 AI 面板'}>
          <Button
            size="small"
            type={showAiPanel ? 'primary' : 'text'}
            icon={<RobotOutlined />}
            onClick={() => setShowAiPanel(v => !v)}
          />
        </Tooltip>
        <Tag 
          color={autoSave ? 'green' : 'default'} 
          style={{ cursor: 'pointer', fontSize: 11 }} 
          onClick={() => setAutoSave(!autoSave)}
        >
          {autoSave ? '✓ 自动保存' : '自动保存: 关'}
        </Tag>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ===== 主工作区：文件树(左) + 内容区(右) 同一行 ===== */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {/* 左侧文件树（紧凑型，与内容区同行） */}
          {showFileTree && (
            <div style={{
              width: 220, minWidth: 0, flexShrink: 0,
              background: 'var(--editor-tree)',
              borderRight: '1px solid var(--editor-divider)',
              overflow: 'auto', display: 'flex', flexDirection: 'column',
            }}>
              {/* 文件树标题栏 */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px', background: 'var(--editor-header)',
                borderBottom: '1px solid var(--editor-divider)',
                fontSize: 11, color: 'var(--muted)', flexShrink: 0,
              }}>
                <FolderOutlined /> 文件
                <Button size="small" type="text" icon={<FolderOutlined />} onClick={() => setShowFileTree(false)}
                  style={{ fontSize: 9, height: 18, color: '#555' }} title="收起文件树" />
              </div>
              {/* 文件树内容 */}
              <div style={{ flex: 1, overflow: 'auto', padding: 4 }}>
                {loading ? (
                  <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
                ) : tree.length > 0 ? (
                  <Tree
                    showLine={{ showLeafIcon: false }}
                    blockNode
                    treeData={tree}
                    loadData={onLoadData}
                    onSelect={(keys, info) => { onTreeSelect(keys, info); }}
                    defaultExpandAll={false}
                    defaultExpandedKeys={[workspace]}
                    titleRender={(node: any) => {
                      const tn = node as TreeNode;
                      return (
                        <Dropdown menu={{ items: renderContextMenu(tn) }} trigger={['contextMenu']}>
                          <span style={{ display: 'inline-block', width: '100%', fontSize: 12 }}>{tn.title}</span>
                        </Dropdown>
                      );
                    }}
                  />
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<div style={{ color: '#666', fontSize: 11 }}>还没打开文件夹</div>}
                  />
                )}
              </div>
            </div>
          )}

          {/* 右侧内容区: UnifiedWorkspace (编辑器/浏览器/预览三模式) */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <UnifiedWorkspace />

            {/* ---- 可拖拽分隔线 ---- */}
            <div
              onMouseDown={onDividerMouseDown}
              style={{
                height: 5, cursor: 'row-resize', background: '#1a1a1a', borderTop: '1px solid #333',
                borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, userSelect: 'none',
              }}
              title="拖拽调整大小"
            >
              <div style={{ width: 60, height: 3, borderRadius: 2, background: '#3a3a3a' }} />
            </div>

            {/* ---- 下区: 终端/问题/日志 ---- */}
            <div style={{ height: showBottomPanel ? bpHeight : 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
              {/* 底部 Tab 栏 */}
              <div style={{ height: 28, display: 'flex', alignItems: 'center', background: 'var(--editor-tab-bar)', borderBottom: '1px solid var(--editor-divider)', padding: '0 8px', gap: 4, flexShrink: 0 }}>
                {(['terminal', 'problems', 'logs'] as const).map(tab => (
                  <div
                    key={tab}
                    onClick={() => setBottomPanelTab(tab)}
                    style={{
                      padding: '2px 12px', cursor: 'pointer', borderRadius: 3, fontSize: 12,
                      color: bottomPanelTab === tab ? 'var(--editor-tab-active-fg)' : 'var(--muted)',
                      background: bottomPanelTab === tab ? 'var(--editor-tab-active)' : 'transparent',
                    }}
                  >
                    {tab === 'terminal' ? '◉ 终端' : tab === 'problems' ? '✕ 问题' : '◎ 日志'}
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <div
                  onClick={() => setShowBottomPanel(v => !v)}
                  style={{ cursor: 'pointer', color: '#666', fontSize: 11, padding: '0 4px' }}
                  title="关闭面板"
                >
                  ✕
                </div>
              </div>
              {/* 底部内容: 从 ChatStore 的消息中提取编译错误和 run_code 输出 */}
              <BottomPanelContent tab={bottomPanelTab} />
            </div>
          </div>

          {/* ===== 右侧 AI 对话面板（与内容区并排，可拖拽调宽） ===== */}
          {showAiPanel && (
            <>
              {/* 垂直拖拽分隔线 */}
              <div
                onMouseDown={onAiDividerMouseDown}
                style={{
                  width: 4, cursor: 'col-resize', background: '#1a1a1a',
                  borderLeft: '1px solid #333', borderRight: '1px solid #333',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, userSelect: 'none',
                }}
                title="拖拽调整 AI 面板宽度"
              >
                <div style={{ width: 2, height: 20, borderRadius: 1, background: '#3a3a3a' }} />
              </div>
              {/* AI 面板容器 */}
              <div style={{ width: aiPanelWidth, minWidth: 0, flexShrink: 0, overflow: 'hidden' }}>
                <EditorChatPanel workspaceDir={workspace} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* ===== 状态栏 ===== */}
      <div style={{ padding: '3px 12px', background: 'var(--editor-footer)', borderTop: '1px solid var(--editor-divider)', color: 'var(--muted-2)', fontSize: 11, display: 'flex', gap: 16 }}>
        <FolderOutlined /> {tree.length} 个根
        <FileOutlined /> {fileCount} 个文件
        <CopyOutlined /> {openFiles.length} tab
        {dirtyCount > 0 && <span style={{ color: 'var(--warning)' }}>● {dirtyCount} 未保存</span>}
        <div style={{ flex: 1 }} />
        <PushpinOutlined /> {workspace || '未打开'}
        {active && <span><FileTextOutlined /> {active.name} · {active.language} · {active.content.length} 字符</span>}
      </div>

      {/* ===== Open Folder 弹窗 ===== */}
      <Modal
        title={<><FolderOpenOutlined /> 打开文件夹</>}
        open={openFolderModal}
        onCancel={() => setOpenFolderModal(false)}
        footer={null}
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>
              <BulbOutlined /> 输入完整路径, 例: <code>F:\agentai-platform</code>
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                size="large"
                prefix={<FolderOpenOutlined />}
                placeholder="F:\agentai-platform\packages\agentai-gui"
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                onPressEnter={() => { setCustomPath(pathInput); loadWorkspace(pathInput); setOpenFolderModal(false); }}
              />
              <Button
                type="primary"
                size="large"
                icon={<CheckOutlined />}
                onClick={() => { setCustomPath(pathInput); loadWorkspace(pathInput); setOpenFolderModal(false); }}
                disabled={!pathInput.trim()}
              >
                打开
              </Button>
            </Space.Compact>
          </div>

          {drivesInfo.drives.length > 0 && (
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}><HddOutlined /> 盘符</div>
              <Space wrap>
                {drivesInfo.drives.map(d => (
                  <Button
                    key={d}
                    icon={<DesktopOutlined />}
                    onClick={() => { setPathInput(d); loadWorkspace(d); setOpenFolderModal(false); }}
                  >
                    {d}
                  </Button>
                ))}
              </Space>
            </div>
          )}

          {drivesInfo.common.length > 0 && (
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>⭐ 常用</div>
              <Space direction="vertical" style={{ width: '100%' }}>
                {drivesInfo.common.map((c: string) => (
                  <Button
                    key={c}
                    block
                    icon={<HomeOutlined />}
                    onClick={() => { setPathInput(c); loadWorkspace(c); setOpenFolderModal(false); }}
                    style={{ textAlign: 'left' }}
                  >
                    {c}
                  </Button>
                ))}
              </Space>
            </div>
          )}

          <div style={{ color: '#555', fontSize: 11, textAlign: 'center', padding: 8, background: '#1a1a1a', borderRadius: 4 }}>
            🛡️ 不会访问 node_modules / .git / dist / out 等构建产物目录
          </div>
        </Space>
      </Modal>
    </div>
  );
};

/**
 * MonacoEditorWithAI — 包装组件, 注入 AI 代码修改装饰
 * 从 taskOrchestratorStore 读取代码变更, 转为 Monaco decorations
 */
const MonacoEditorWithAI: React.FC<React.ComponentProps<typeof MonacoEditor>> = (props) => {
  const { activeTask, lastCompletedTask } = useTaskOrchestrator();

  // 从当前活跃任务 + 最近完成任务中提取代码变更
  const aiDecorations: AICodeDecoration[] = [];

  if (activeTask) {
    for (const change of activeTask.codeChanges) {
      aiDecorations.push({
        filePath: change.filePath,
        type: change.type,
        summary: change.summary,
      });
    }
  }
  // 也显示最近完成任务的变更 (折叠摘要状态时)
  if (lastCompletedTask && !activeTask) {
    for (const change of lastCompletedTask.codeChanges) {
      aiDecorations.push({
        filePath: change.filePath,
        type: change.type,
        summary: change.summary,
      });
    }
  }

  return (
    <MonacoEditor
      {...props}
      aiDecorations={aiDecorations}
    />
  );
};

/**
 * BottomPanelContent — 底部面板内容
 * - terminal: 真实终端 (xterm.js) + AI run_code 输出
 * - problems: 显示 write_file/multi_edit 的编译错误
 * - logs: Gateway 日志输出
 */
const BottomPanelContent: React.FC<{ tab: string }> = ({ tab }) => {
  const messages = useChatStore(s => s.messages);
  const terminalRef = useRef<HTMLDivElement>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  // 模拟终端功能 - 使用 styled pre 模拟真实终端
  if (tab === 'terminal') {
    const recentRuns = messages
      .flatMap(m => m.segments || [])
      .filter((s: any) => s.kind === 'tool' && (s.name === 'run_code' || s.name === 'Bash' || s.name === 'PowerShell' || s.name === 'execute_command') && s.state !== 'running')
      .slice(-10)
      .reverse();

    return (
      <div style={{
        padding: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#0c0c0c',
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      }}>
        {/* 终端标题栏 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          fontSize: 11,
          color: 'var(--muted-2)',
        }}>
          <span><TerminalOutlined style={{ marginRight: 4 }} /> Terminal</span>
          <span>{recentRuns.length} 条记录</span>
        </div>

        {/* 终端内容区 */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          fontSize: 12,
          lineHeight: 1.5,
        }}>
          {recentRuns.length === 0 ? (
            <div style={{ color: 'var(--muted-2)' }}>
              <div style={{ marginBottom: 8, opacity: 0.6 }}>
                <div>PulseFlow Terminal v1.0</div>
                <div>AI 命令执行输出将显示在这里</div>
                <div style={{ marginTop: 4, fontStyle: 'italic' }}>提示: AI 工具调用 (Bash/PowerShell/run_code) 的结果会自动显示在此</div>
              </div>
            </div>
          ) : (
            recentRuns.map((seg: any, i: number) => {
              const resultText = typeof seg.result === 'string' ? seg.result : JSON.stringify(seg.result || '');
              let codeText = typeof seg.args?.code === 'string' ? seg.args.code : '';
              if (!codeText) codeText = seg.args?.command || seg.args?.cmd || '';
              if (!codeText) codeText = JSON.stringify(seg.args || '');;
              const isError = !seg.ok;
              const toolName = seg.name || 'run_code';

              return (
                <div key={i} style={{
                  marginBottom: 8,
                  paddingBottom: 8,
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}>
                  {/* 命令行 */}
                  <div style={{
                    color: '#4ade80',
                    fontSize: 11,
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: 3,
                      background: isError ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.1)',
                      color: isError ? '#f87171' : '#4ade80',
                      fontSize: 9,
                      fontWeight: 600,
                    }}>
                      {toolName.toUpperCase()}
                    </span>
                    <span>$ {codeText.slice(0, 150)}{codeText.length > 150 ? '...' : ''}</span>
                  </div>

                  {/* 输出 */}
                  <pre style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: isError ? 'var(--danger)' : 'var(--fg-2)',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 200,
                    overflow: 'auto',
                    paddingLeft: 12,
                    borderLeft: isError ? '3px solid var(--danger)' : '3px solid var(--success)',
                  }}>
                    {resultText.slice(0, 1000)}
                    {resultText.length > 1000 && '\n... (截断)'}
                  </pre>

                  {/* 耗时和状态 */}
                  {seg.durationMs != null && (
                    <div style={{
                      fontSize: 10,
                      color: 'var(--muted-2)',
                      marginTop: 4,
                      paddingLeft: 12,
                    }}>
                      ⏱️ {(seg.durationMs / 1000).toFixed(2)}s · {isError ? '❌ 失败' : '✅ 成功'}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  if (tab === 'problems') {
    // 从 write_file / multi_edit 工具结果中提取编译错误
    const compileErrors = messages
      .flatMap(m => m.segments || [])
      .filter((s: any) => s.kind === 'tool' && (s.name === 'write_file' || s.name === 'multi_edit') && !s.ok)
      .flatMap((s: any) => {
        const resultText = typeof s.result === 'string' ? s.result : JSON.stringify(s.result || '');
        if (!resultText.includes('编译错误')) return [];
        const errorPart = resultText.split('编译错误')[1] || resultText;
        return errorPart.split('\n').filter((l: string) => l.trim()).map((l: string) => ({
          file: s.args?.file_path || s.args?.path || 'unknown',
          message: l.replace(/⚠️|请立即修复|:/g, '').trim().slice(0, 200),
        }));
      });
    if (compileErrors.length === 0) {
      return <div style={{ padding: 8, color: 'var(--success)' }}>✅ 当前无编译错误</div>;
    }
    return (
      <div style={{ padding: 4 }}>
        {compileErrors.map((e: any, i: number) => (
          <div key={i} style={{
            display: 'flex', gap: 6, padding: '3px 8px',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            cursor: 'pointer',
          }}
            onClick={() => window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path: e.file } }))}
          >
            <span style={{ color: '#ef4444', flexShrink: 0 }}>✕</span>
            <span style={{ color: '#f87171', flex: 1, fontSize: 11 }}>{e.message}</span>
            <span style={{ color: '#666', fontSize: 10, flexShrink: 0 }}>{e.file.split(/[\\/]/).pop()}</span>
          </div>
        ))}
      </div>
    );
  }

  // logs tab
  return <div style={{ padding: 8, color: '#888' }}>日志输出区 — Gateway 日志将在此显示</div>;
};
