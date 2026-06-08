/**
 * Editor - Trae 风格文件编辑器
 * ----------------------------------------------------
 * - 左侧文件树 (懒加载, 盘符级 Open Folder)
 * - 右侧多标签编辑器 (脏标记 / 保存 / AI 改写)
 * - 顶栏: 面包屑 + Open Folder + 搜索 + 工具栏
 * - 状态栏: 文件数 / tab 数 / 自动保存状态
 * - 浏览器内: 不能弹原生目录选择, 通过 Gateway /v1/fs/drives 列盘符 + 手动输入
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Tree, Input, Button, Space, message, Spin, Dropdown, Modal, Empty, Tooltip,
  Breadcrumb, Tabs, Tag, Segmented, App,
} from 'antd';
import {
  FolderOutlined, FolderOpenOutlined, FileOutlined, ReloadOutlined, SaveOutlined,
  EditOutlined, FileAddOutlined, FolderAddOutlined,
  SearchOutlined, RobotOutlined, CloseOutlined, CheckOutlined,
  DesktopOutlined, HomeOutlined, CodeOutlined, DeleteOutlined, EditOutlined as RenameIcon,
  FolderOpenOutlined as OpenFolderIcon,
} from '@ant-design/icons';
import { useProfileStore } from '../store';

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

const httpUrl = ((window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789').replace(/^ws/, 'http');

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
  drives: () => fetch(`${httpUrl}/v1/fs/drives`).then(r => r.json()),
  list: (dir: string) => fetch(`${httpUrl}/v1/fs/list?dir=${encodeURIComponent(dir)}`).then(r => r.json()),
  read: (p: string) => fetch(`${httpUrl}/v1/files/read?path=${encodeURIComponent(p)}`).then(r => r.json()),
  write: (p: string, content: string) => fetch(`${httpUrl}/v1/files/write`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  }).then(r => r.json()),
  mkdir: (p: string) => fetch(`${httpUrl}/v1/files/mkdir`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p }),
  }).then(r => r.json()),
  touch: (p: string, content = '') => fetch(`${httpUrl}/v1/files/touch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: p, content }),
  }).then(r => r.json()),
  rename: (from: string, to: string) => fetch(`${httpUrl}/v1/files/rename`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  }).then(r => r.json()),
  remove: (p: string) => fetch(`${httpUrl}/v1/files?path=${encodeURIComponent(p)}`, { method: 'DELETE' }).then(r => r.json()),
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
  const [activeKey, setActiveKey] = useState<string>('');
  const [searchQ, setSearchQ] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [openFolderModal, setOpenFolderModal] = useState(false);
  const [drivesInfo, setDrivesInfo] = useState<{ drives: string[]; common: string[] }>({ drives: [], common: [] });
  const [customPath, setCustomPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [autoSave, setAutoSave] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        title: <span style={{ color: '#facc15', fontWeight: 600 }}>📁 {dir.split(/[\\/]/).filter(Boolean).pop() || dir}</span>,
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

  // 启动时: 有缓存就恢复, 否则保持空 (显示欢迎页)
  useEffect(() => {
    if (workspace) loadWorkspace(workspace);
  }, []); // eslint-disable-line

  // ===== 构建树节点 =====
  const buildNode = (e: FsEntry): TreeNode => ({
    key: e.path,
    title: (
      <Space size={4}>
        {e.type === 'directory'
          ? <FolderOutlined style={{ color: '#facc15' }} />
          : iconForFile(e.name)}
        <span style={{ color: '#ddd', fontSize: 13 }}>{e.name}</span>
        {e.type === 'file' && e.size > 0 && (
          <span style={{ color: '#555', fontSize: 10 }}>{fmtSize(e.size)}</span>
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
    if (name.endsWith('.py')) return <CodeOutlined style={{ color: '#3776ab' }} />;
    if (name.endsWith('.json')) return <CodeOutlined style={{ color: '#93c5fd' }} />;
    if (name.endsWith('.md')) return <FileOutlined style={{ color: '#c084fc' }} />;
    return <FileOutlined style={{ color: '#93c5fd' }} />;
  };

  // ===== AntD Tree 懒加载 =====
  const onLoadData = async (node: any): Promise<void> => {
    if (node.children && node.children.length > 0) return;
    const dir = (node as TreeNode).path;
    try {
      const data = await API.list(dir);
      if (data.error) return;
      const entries: FsEntry[] = data.entries || [];
      node.children = entries.map(buildNode);
      node.loaded = true;
      setTree([...tree]);
    } catch {}
  };

  // Tree 选中: 文件就打开
  const onTreeSelect = (selectedKeys: React.Key[], info: any) => {
    const node = info.node as TreeNode;
    if (node && node.type === 'file') {
      openFile(node.path);
    }
  };

  // ===== 打开文件 =====
  const openFile = async (filePath: string) => {
    const existing = openFiles.find(f => f.path === filePath);
    if (existing) {
      setActiveKey(filePath);
      return;
    }
    try {
      const data = await API.read(filePath);
      if (data.error) { msgApi.error('打开失败: ' + data.error); return; }
      const f: OpenFile = {
        path: filePath,
        name: filePath.split(/[\\/]/).pop() || filePath,
        content: data.content || '',
        dirty: false,
        language: detectLang(filePath),
        readonly: filePath.includes('node_modules') || filePath.includes('\\.git\\'),
      };
      setOpenFiles([...openFiles, f]);
      setActiveKey(filePath);
    } catch (e: any) {
      msgApi.error('读文件失败: ' + e.message);
    }
  };

  // ===== 保存 =====
  const saveActive = useCallback(async () => {
    const f = openFiles.find(x => x.path === activeKey);
    if (!f || f.readonly) return;
    try {
      const data = await API.write(f.path, f.content);
      if (data.error) { msgApi.error('保存失败: ' + data.error); return; }
      setOpenFiles(openFiles.map(x => x.path === f.path ? { ...x, dirty: false } : x));
      msgApi.success(`✅ ${f.name} 已保存`);
    } catch (e: any) {
      msgApi.error('保存失败: ' + e.message);
    }
  }, [activeKey, openFiles, msgApi]);

  // 自动保存 (3 秒无改动)
  useEffect(() => {
    if (!autoSave) return;
    const t = setTimeout(() => {
      openFiles.filter(f => f.dirty).forEach(f => {
        API.write(f.path, f.content);
        setOpenFiles(prev => prev.map(x => x.path === f.path ? { ...x, dirty: false } : x));
      });
    }, 3000);
    return () => clearTimeout(t);
  }, [openFiles, autoSave]);

  // ===== 编辑 =====
  const editContent = (val: string) => {
    setOpenFiles(prev => prev.map(f => f.path === activeKey ? { ...f, content: val, dirty: true } : f));
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
      const r = await fetch(`${httpUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `请改写这段 ${f.name} 代码, 需求: ${aiPrompt}\n\n原代码:\n\`\`\`\n${f.content.slice(0, 6000)}\n\`\`\`\n\n只输出改写后的完整代码, 不要解释, 不要 markdown 围栏。`,
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
      msgApi.error('AI 失败: ' + e.message);
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
        const r = await API.remove(p);
        if (r.error) { msgApi.error(r.error); return; }
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

  // ===== 面包屑 =====
  const breadcrumbItems = workspace
    ? workspace.split(/[\\/]/).filter(Boolean).map((seg, i, arr) => {
        const path = arr.slice(0, i + 1).join(workspace.includes('\\') ? '\\' : '/');
        const isLast = i === arr.length - 1;
        const fullPath = workspace.includes('\\')
          ? (i === 0 ? `${seg}\\` : (i === arr.length - 1 ? `${arr.slice(0, i + 1).join('\\')}` : `${arr.slice(0, i + 1).join('\\')}\\`))
          : `/${arr.slice(0, i + 1).join('/')}`;
        return {
          title: isLast
            ? <span style={{ color: '#facc15' }}>{seg}</span>
            : <a onClick={() => i === 0 ? null : loadWorkspace(fullPath)} style={{ color: '#93c5fd' }}>{seg}</a>,
        };
      })
    : [];

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
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f0f0f' }}>
      {/* ===== 顶栏 ===== */}
      <div style={{ padding: '6px 10px', background: '#1a1a1a', borderBottom: '1px solid #333', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="small" type="primary" icon={<FolderOpenOutlined />} onClick={openDrivesModal}>
          打开文件夹
        </Button>
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
        <Tag color={autoSave ? 'green' : 'default'} style={{ cursor: 'pointer' }} onClick={() => setAutoSave(!autoSave)}>
          {autoSave ? '✓ 自动保存' : '自动保存'}
        </Tag>
        <Segmented
          size="small"
          value={autoSave ? 'on' : 'off'}
          onChange={(v) => setAutoSave(v === 'on')}
          options={[{ label: '关', value: 'off' }, { label: '开', value: 'on' }]}
        />
      </div>

      {/* ===== 面包屑 ===== */}
      {workspace && (
        <div style={{ padding: '4px 12px', background: '#141414', borderBottom: '1px solid #222' }}>
          <Breadcrumb items={breadcrumbItems} style={{ fontSize: 12 }} />
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ===== 左侧文件树 ===== */}
        <div style={{ width: 300, background: '#0a0a0a', borderRight: '1px solid #333', overflow: 'auto', padding: 4 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
          ) : tree.length > 0 ? (
            <Tree
              showLine={{ showLeafIcon: false }}
              blockNode
              treeData={tree}
              loadData={onLoadData}
              onSelect={onTreeSelect}
              defaultExpandAll={false}
              defaultExpandedKeys={[workspace]}
              onRightClick={({ node }) => {
                // Right click handled via context menu in dropdown below
              }}
              titleRender={(node: any) => {
                const tn = node as TreeNode;
                return (
                  <Dropdown menu={{ items: renderContextMenu(tn) }} trigger={['contextMenu']}>
                    <span style={{ display: 'inline-block', width: '100%' }}>{tn.title}</span>
                  </Dropdown>
                );
              }}
            />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div style={{ color: '#888', padding: 16, textAlign: 'center' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
                  <div style={{ fontSize: 14, color: '#ccc' }}>还没打开文件夹</div>
                  <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>
                    点上面 <b style={{ color: '#4F46E5' }}>「打开文件夹」</b> 选个目录
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    style={{ marginTop: 16 }}
                    icon={<FolderOpenOutlined />}
                    onClick={openDrivesModal}
                  >
                    Open Folder
                  </Button>
                </div>
              }
            />
          )}
        </div>

        {/* ===== 右侧编辑区 ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {openFiles.length > 0 ? (
            <>
              <Tabs
                type="editable-card"
                activeKey={activeKey}
                onChange={setActiveKey}
                onEdit={(targetKey, action) => {
                  if (action === 'remove') closeTab(targetKey as string);
                }}
                hideAdd
                size="small"
                items={openFiles.map(f => ({
                  key: f.path,
                  closable: true,
                  label: (
                    <span style={{ color: f.dirty ? '#facc15' : '#ddd' }}>
                      {f.dirty ? '● ' : ''}{f.name}
                    </span>
                  ),
                  children: (
                    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      {/* 工具栏 */}
                      <div style={{ padding: 6, background: '#141414', borderBottom: '1px solid #333', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<SaveOutlined />}
                          onClick={saveActive}
                          disabled={!active?.dirty || active?.readonly}
                        >
                          保存 (Ctrl+S)
                        </Button>
                        <Tag color="blue">{active?.language}</Tag>
                        {active?.readonly && <Tag color="orange">只读</Tag>}
                        <div style={{ flex: 1 }} />
                        <Input
                          size="small"
                          placeholder="AI 改写指令, 例: 加错误处理"
                          value={aiPrompt}
                          onChange={e => setAiPrompt(e.target.value)}
                          onPressEnter={aiEdit}
                          style={{ width: 260 }}
                          disabled={aiBusy}
                        />
                        <Button
                          size="small"
                          icon={<RobotOutlined />}
                          loading={aiBusy}
                          onClick={aiEdit}
                          disabled={!aiPrompt.trim() || active?.readonly}
                        >
                          AI 改写
                        </Button>
                      </div>
                      {/* 编辑区 */}
                      <div style={{ flex: 1, position: 'relative' }}>
                        <textarea
                          ref={textareaRef}
                          value={active?.content || ''}
                          onChange={e => editContent(e.target.value)}
                          onKeyDown={(e) => {
                            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                              e.preventDefault();
                              saveActive();
                            }
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              const target = e.currentTarget;
                              const start = target.selectionStart;
                              const end = target.selectionEnd;
                              const newVal = target.value.substring(0, start) + '  ' + target.value.substring(end);
                              editContent(newVal);
                              setTimeout(() => { target.selectionStart = target.selectionEnd = start + 2; }, 0);
                            }
                          }}
                          spellCheck={false}
                          readOnly={active?.readonly}
                          style={{
                            width: '100%', height: '100%',
                            background: '#1e1e1e', color: '#d4d4d4',
                            border: 'none', outline: 'none',
                            padding: 12,
                            fontFamily: 'Consolas, "Courier New", monospace',
                            fontSize: 13, lineHeight: 1.6,
                            resize: 'none',
                          }}
                        />
                      </div>
                    </div>
                  ),
                }))}
              />
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#666' }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>✨</div>
              <div style={{ fontSize: 18, color: '#aaa', marginBottom: 8 }}>{profile?.name || '你'}, 欢迎来到 Trae 风格编辑器</div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 24, textAlign: 'center', maxWidth: 480 }}>
                打开本地文件夹 → 树状浏览 → 点击文件编辑 → Ctrl+S 保存<br/>
                右键节点: 新建/重命名/删除 · 点 🤖 让 AI 帮你改代码
              </div>
              <Button
                type="primary"
                size="large"
                icon={<FolderOpenOutlined />}
                onClick={openDrivesModal}
              >
                打开文件夹
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ===== 状态栏 ===== */}
      <div style={{ padding: '3px 12px', background: '#0a0a0a', borderTop: '1px solid #222', color: '#666', fontSize: 11, display: 'flex', gap: 16 }}>
        <span>🌳 {tree.length} 个根</span>
        <span>📄 {fileCount} 个文件</span>
        <span>📑 {openFiles.length} tab</span>
        {dirtyCount > 0 && <span style={{ color: '#facc15' }}>● {dirtyCount} 未保存</span>}
        <div style={{ flex: 1 }} />
        <span>📍 {workspace || '未打开'}</span>
        {active && <span>📝 {active.name} · {active.language} · {active.content.length} 字符</span>}
      </div>

      {/* ===== Open Folder 弹窗 ===== */}
      <Modal
        title="📁 打开文件夹"
        open={openFolderModal}
        onCancel={() => setOpenFolderModal(false)}
        footer={null}
        width={520}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
              💡 输入完整路径, 例: <code>F:\agentai-platform</code> 或 <code>C:\Users\你\Desktop\project</code>
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
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>💽 盘符</div>
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
