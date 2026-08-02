import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Input, message, Tooltip, Button, Spin, Popover, Modal, Tree } from 'antd';
import { FolderOpenOutlined, HomeOutlined, CheckOutlined, InfoCircleOutlined, FolderFilled, HddOutlined } from '@ant-design/icons';
import { useProfileStore } from '../store';
import { gatewayFallback } from '../services/GatewayFallback';

interface FsEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size: number;
}

export const WorkspaceSelector: React.FC = () => {
  const { profile, setProfile } = useProfileStore();
  // 从 profile 或 localStorage 获取工作目录
  const workspace = profile?.workspace || localStorage.getItem('agentai.workspace') || '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(workspace);
  const [loading, setLoading] = useState(false);
  const [aiWorkDir, setAiWorkDir] = useState('');
  const inputRef = useRef<any>(null);

  // 监听工作区变更事件，同步更新显示
  useEffect(() => {
    const handleWorkspaceChange = (e: CustomEvent<{ workspace: string }>) => {
      setValue(e.detail.workspace);
    };
    window.addEventListener('agentai:workspace-changed', handleWorkspaceChange as EventListener);
    return () => window.removeEventListener('agentai:workspace-changed', handleWorkspaceChange as EventListener);
  }, []);

  // 文件夹浏览器状态
  const [browserOpen, setBrowserOpen] = useState(false);
  const [treeData, setTreeData] = useState<any[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [browserLoading, setBrowserLoading] = useState(false);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  /** 获取 AI 工作目录路径 (从 gateway 查询) */
  useEffect(() => {
    fetch(`${gatewayUrl()}/v1/fs/project-root`)
      .then(r => r.json())
      .then(d => { if (d.aiWorkDir) setAiWorkDir(d.aiWorkDir); })
      .catch(() => {});
  }, []);

  /** 获取 Gateway 基础 URL (dev 模式走 Vite proxy → 空串; 生产/Tauri 直接连) */
  const gatewayUrl = () => gatewayFallback.url || 'http://127.0.0.1:18789';

  const applyWorkspace = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    
    // 保存到 localStorage（供 Git 服务和其他组件使用）
    localStorage.setItem('agentai.workspace', trimmed);
    
    setProfile({
      ...profile,
      name: profile?.name || 'User',
      onboardedAt: profile?.onboardedAt || Date.now(),
      language: profile?.language || 'zh',
      workspace: trimmed,
    });
    setEditing(false);
    
    // 触发工作区变更事件，通知其他组件刷新
    window.dispatchEvent(new CustomEvent('agentai:workspace-changed', { detail: { workspace: trimmed } }));
    
    // 同步通知 Gateway 更新工作目录
    fetch(`${gatewayUrl()}/v1/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: trimmed }),
    }).then(r => r.json()).then(d => {
      if (d.ok) setAiWorkDir(d.aiWorkDir);
      else message.warning(d.error || '同步工作目录到 Gateway 失败');
    }).catch(() => {
      // Gateway 不可达时静默失败（本地已保存）
    });
  };

  /** 加载驱动器列表作为树根节点 */
  const loadDrives = useCallback(async () => {
    setBrowserLoading(true);
    try {
      const res = await fetch(`${gatewayUrl()}/v1/fs/drives`);
      const data = await res.json();
      const drives: string[] = data.drives || [];
      const common: string[] = data.common || [];
      // 合并 common 和 drives，去重
      const allRoots = [...new Set([...common, ...drives])];
      const nodes = allRoots.map(root => ({
        key: root,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <HddOutlined style={{ color: 'var(--accent)', fontSize: 12 }} />
            <span style={{ fontSize: 12 }}>{root}</span>
          </span>
        ),
        isLeaf: false,
        path: root,
      }));
      setTreeData(nodes);
    } catch {
      message.warning('获取驱动器列表失败');
    } finally {
      setBrowserLoading(false);
    }
  }, []);

  /** 加载目录子节点 */
  const loadDirEntries = useCallback(async (dirPath: string): Promise<FsEntry[]> => {
    const res = await fetch(`${gatewayUrl()}/v1/fs/list?dir=${encodeURIComponent(dirPath)}`);
    const data = await res.json();
    return (data.entries || []).filter((e: FsEntry) => e.type === 'directory');
  }, []);

  /** 异步加载树子节点 */
  const onLoadData = useCallback(async ({ key }: any) => {
    try {
      const entries = await loadDirEntries(key);
      if (entries.length === 0) {
        // 空目录标记为叶子节点
        setTreeData(prev => updateTreeData(prev, key, []));
        return;
      }
      const nodes = entries.map(e => ({
        key: e.path,
        title: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <FolderFilled style={{ color: '#e8a838', fontSize: 12 }} />
            <span style={{ fontSize: 12 }}>{e.name}</span>
          </span>
        ),
        isLeaf: false,
        path: e.path,
      }));
      setTreeData(prev => updateTreeData(prev, key, nodes));
    } catch { /* ignore */ }
  }, [loadDirEntries]);

  /** 递归更新树数据 */
  const updateTreeData = (list: any[], key: string, children: any[]): any[] => {
    return list.map(node => {
      if (node.key === key) return { ...node, children: children.length > 0 ? children : undefined, isLeaf: children.length === 0 };
      if (node.children) return { ...node, children: updateTreeData(node.children, key, children) };
      return node;
    });
  };

  /** 打开文件夹浏览器 (Gateway API) */
  const handleBrowse = () => {
    setSelectedPath('');
    setBrowserOpen(true);
    loadDrives();
  };

  /** 原生文件夹选择器 (File System Access API 或 webkitdirectory 回退) */
  const handleNativeBrowse = async () => {
    let folderName = '';
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        folderName = dirHandle.name;
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
    }
    // 回退: webkitdirectory
    if (!folderName) {
      const input = document.createElement('input');
      input.type = 'file';
      (input as any).webkitdirectory = true;
      await new Promise<void>((resolve) => {
        input.onchange = (e: any) => {
          const files = e.target?.files;
          if (files?.length) {
            const fullPath = files[0].webkitRelativePath || files[0].name;
            folderName = fullPath.split(/[\\/]/)[0] || fullPath;
          }
          resolve();
        };
        input.click();
      });
    }
    if (!folderName) return;
    // 浏览器无法给出完整路径，改用 Gateway 文件夹浏览器让用户从盘符逐级选择
    setBrowserOpen(true);
    message.info(`已识别文件夹: ${folderName}，请在文件浏览器中逐级定位到该目录`);
  };

  /** 确认选择文件夹 */
  const handleBrowserOk = () => {
    if (!selectedPath) {
      message.warning('请先选择一个文件夹');
      return;
    }
    applyWorkspace(selectedPath);
    message.success(`项目目录: ${selectedPath}`);
    setBrowserOpen(false);
  };

  /** 从 gateway 获取项目根目录真实绝对路径 */
  const handleSetProjectRoot = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${gatewayUrl()}/v1/fs/project-root`);
      const data = await res.json();
      const root = data.projectRoot || data.cwd || '';
      if (root) {
        applyWorkspace(root);
        message.success(`项目目录: ${root}`);
      }
    } catch {
      message.warning('获取项目根目录失败');
    } finally {
      setLoading(false);
    }
  };

  /** 首次加载自动获取项目根目录 (Gateway 不可达立即回退) */
  useEffect(() => {
    if (!workspace) {
      const fallback = () => { setEditing(true); setValue(''); };
      const timer = setTimeout(fallback, 2000); // 2秒超时
      handleSetProjectRoot()
        .then(() => clearTimeout(timer))
        .catch(() => { clearTimeout(timer); fallback(); });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace && !editing) {
    return (
      <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
           onClick={() => { setEditing(true); setValue(''); }}
           title="点击设置工作目录">
        <FolderOpenOutlined style={{ color: 'var(--color-text-muted)', fontSize: 13 }} />
        <Spin size="small" />
        <span style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer' }}>检测项目目录... (点击手动设置)</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
      <FolderOpenOutlined style={{ color: 'var(--accent)', fontSize: 13, flexShrink: 0 }} />

      {editing ? (
        <Input
          ref={inputRef}
          size="small"
          value={value}
          onChange={e => setValue(e.target.value)}
          onPressEnter={() => applyWorkspace(value)}
          onBlur={() => {
            if (value.trim() && value.trim() !== workspace) applyWorkspace(value);
            else setEditing(false);
          }}
          placeholder="F:\agentai-platform"
          style={{ flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          suffix={
            <span style={{ display: 'flex', gap: 2 }}>
              <Button type="text" size="small" onClick={handleNativeBrowse}
                style={{ color: 'var(--accent)', fontSize: 11 }}>本地</Button>
              <Button type="text" size="small" icon={<CheckOutlined />}
                onClick={() => applyWorkspace(value)}
                style={{ color: 'var(--accent)', fontSize: 12 }} />
            </span>
          }
        />
      ) : (
        <Tooltip title="项目操作目录 — AI 在此进行文件读写">
          <span
            onClick={() => { setValue(workspace); setEditing(true); }}
            style={{
              flex: 1, fontSize: 12, color: 'var(--fg)',
              cursor: 'pointer', fontFamily: 'monospace',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              opacity: 0.85,
            }}
          >
            {workspace}
          </span>
        </Tooltip>
      )}

      <Popover
        title="目录说明"
        content={
          <div style={{ fontSize: 11, lineHeight: 1.8, maxWidth: 260 }}>
            <div><b>项目操作目录</b>: {workspace}</div>
            <div style={{ color: 'var(--muted)' }}>→ AI 在此进行文件读写</div>
            <div style={{ marginTop: 6 }}><b>AI 工作目录</b>: {aiWorkDir || '加载中...'}</div>
            <div style={{ color: 'var(--muted)' }}>→ AI 运行时数据(会话/记忆/缓存)</div>
          </div>
        }
        trigger="click"
      >
        <InfoCircleOutlined style={{ color: 'var(--muted-2)', fontSize: 12, flexShrink: 0, cursor: 'pointer' }} />
      </Popover>

      {!editing && (
        <>
          <Tooltip title="浏览选择文件夹 (Gateway)">
            <Button
              size="small" type="text"
              icon={<FolderOpenOutlined />}
              onClick={handleBrowse}
              style={{ color: 'var(--muted-2)', flexShrink: 0 }}
            />
          </Tooltip>
          <Tooltip title="本地选择文件夹 (浏览器直接选)">
            <Button
              size="small" type="text"
              icon={<FolderFilled />}
              onClick={handleNativeBrowse}
              style={{ color: 'var(--accent)', flexShrink: 0, fontSize: 11 }}
            >
              本地
            </Button>
          </Tooltip>
          <Tooltip title="设为项目根目录">
            <Button
              size="small" type="text"
              loading={loading}
              icon={<HomeOutlined />}
              onClick={handleSetProjectRoot}
              style={{ color: 'var(--muted-2)', flexShrink: 0 }}
            />
          </Tooltip>
        </>
      )}

      {/* 文件夹浏览器弹窗 */}
      <Modal
        title="选择项目文件夹"
        open={browserOpen}
        onOk={handleBrowserOk}
        onCancel={() => setBrowserOpen(false)}
        okText="确认选择"
        cancelText="取消"
        okButtonProps={{ disabled: !selectedPath }}
        width={520}
        styles={{ body: { maxHeight: 420, overflow: 'auto', padding: '8px 12px' } }}
      >
        {selectedPath && (
          <div style={{
            marginBottom: 8, padding: '6px 10px',
            background: 'var(--panel)', borderRadius: 4,
            fontSize: 12, fontFamily: 'monospace',
            color: 'var(--accent)', wordBreak: 'break-all',
          }}>
            已选: {selectedPath}
          </div>
        )}
        {browserLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin tip="加载驱动器..." /></div>
        ) : (
          <Tree
            treeData={treeData}
            loadData={onLoadData}
            onSelect={(keys, info) => {
              if (info.node) setSelectedPath(info.node.key as string);
            }}
            selectedKeys={selectedPath ? [selectedPath] : []}
            height={340}
            virtual
          />
        )}
      </Modal>
    </div>
  );
};
