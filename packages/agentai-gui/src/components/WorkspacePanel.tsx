/**
 * WorkspacePanel — 工作区文件树 + 预览面板 + 右键菜单
 * 后端返回格式: { tree: TreeNode[] }
 * TreeNode = { name, path, type: 'directory'|'file', size, children }
 * 
 * 功能:
 *   1. 文件树浏览
 *   2. 文件预览
 *   3. 右键菜单: 注入到 AI 上下文 / 在编辑器中打开 / 复制路径
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Typography, Spin, Dropdown, Menu, message } from 'antd';
import {
  FolderOpenOutlined, FileOutlined, FolderOutlined,
  FileTextOutlined, CodeOutlined, CloseOutlined,
  EyeOutlined, CopyOutlined, LinkOutlined, EditOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { useContextStore } from '../store/contextStore';

const { Text } = Typography;

/** 后端树节点类型 */
interface BackendNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  children?: BackendNode[];
}

export const WorkspacePanel: React.FC<{
  workspaceDir?: string;
  onFileSelect?: (path: string) => void;
  selectedFile?: string | null;
}> = ({ workspaceDir, onFileSelect, selectedFile }) => {
  const [tree, setTree] = useState<BackendNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [contextMenuFile, setContextMenuFile] = useState<BackendNode | null>(null);
  
  const { addInjectedFile, removeInjectedFile, isFileInjected, injectedFiles } = useContextStore();
  const fileTreeRef = useRef<HTMLDivElement>(null);

  /* ---- 加载根目录树 ---- */
  useEffect(() => {
    if (!workspaceDir) return;
    setLoading(true);
    setError(null);
    fetch(`/v1/files?workspace=${encodeURIComponent(workspaceDir)}`)
      .then(r => r.json())
      .then(data => {
        if (data.tree && Array.isArray(data.tree)) {
          setTree(data.tree);
        } else if (data.error) {
          setError(data.error);
          setTree([]);
        } else {
          setTree([]);
        }
      })
      .catch((e) => { setError(String(e)); setTree([]); })
      .finally(() => setLoading(false));
  }, [workspaceDir]);

  /* ---- 切换目录展开/折叠 ---- */
  const toggleDir = useCallback((node: BackendNode) => {
    const next = new Set(expandedPaths);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    setExpandedPaths(next);
  }, [expandedPaths]);

  /* ---- 打开文件预览 ---- */
  const openFile = useCallback(async (path: string) => {
    if (!path) return;
    onFileSelect?.(path);
    setPreviewLoading(true);
    try {
      const r = await fetch(`/v1/files/read?path=${encodeURIComponent(path)}`);
      const data = await r.json();
      if (data.content !== undefined) {
        setPreview({ path, content: data.content });
      } else if (data.error) {
        setPreview({ path, content: `加载失败: ${data.error}` });
      }
    } catch (e: any) {
      setPreview({ path, content: `加载失败: ${e.message}` });
    } finally {
      setPreviewLoading(false);
    }
  }, [onFileSelect]);

  /* ---- 右键菜单处理 ---- */
  const handleContextMenu = (e: React.MouseEvent, node: BackendNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setContextMenuFile(node);
  };

  /* ---- 注入文件到 AI 上下文 ---- */
  const injectToContext = async (node: BackendNode) => {
    if (node.type === 'directory') {
      message.warning('暂不支持注入目录');
      return;
    }
    
    // 如果已注入，则移除
    if (isFileInjected(node.path)) {
      removeInjectedFile(node.path);
      message.success(`已从上下文移除: ${node.name}`);
      return;
    }

    // 读取文件内容
    try {
      const r = await fetch(`/v1/files/read?path=${encodeURIComponent(node.path)}`);
      const data = await r.json();
      if (data.content !== undefined) {
        addInjectedFile({
          path: node.path,
          name: node.name,
          content: data.content,
        });
        message.success(`已注入到上下文: ${node.name}`);
      } else {
        message.error('读取文件失败');
      }
    } catch (e) {
      message.error('读取文件失败');
    }
    setContextMenuPos(null);
  };

  /* ---- 复制文件路径 ---- */
  const copyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    message.success('路径已复制');
    setContextMenuPos(null);
  };

  /* ---- 在编辑器中打开 ---- */
  const openInEditor = (path: string) => {
    onFileSelect?.(path);
    setContextMenuPos(null);
  };

  /* ---- 递归渲染树节点 ---- */
  const renderNode = (node: BackendNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'directory';
    const isExpanded = expandedPaths.has(node.path);
    const isInjected = isFileInjected(node.path);

    return (
      <div key={node.path}>
        <div
          onClick={() => isDir ? toggleDir(node) : openFile(node.path)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px 2px 0', paddingLeft: depth * 14 + 4,
            borderRadius: 3, cursor: 'pointer', fontSize: 11,
            color: selectedFile === node.path ? 'var(--accent)' : 'var(--fg-2)',
            background: selectedFile === node.path ? 'var(--accent-soft)' : 'transparent',
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {/* 展开箭头 (目录) */}
          {isDir ? (
            <span style={{
              fontSize: 8, color: 'var(--muted-2)', width: 12,
              display: 'inline-flex', justifyContent: 'center', flexShrink: 0,
              transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.1s',
            }}>▶</span>
          ) : (
            <span style={{ width: 12, flexShrink: 0 }} />
          )}

          {/* 图标 */}
          <span style={{
            color: isDir ? 'var(--warning)' : isInjected ? 'var(--accent)' : 'var(--muted-2)', 
            fontSize: 11,
            flexShrink: 0, marginRight: 2,
          }}>
            {isDir ? <FolderOutlined /> : isInjected ? <CheckCircleOutlined /> : getFileIcon(node.name)}
          </span>

          {/* 名称 */}
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis',
            fontWeight: isDir ? 600 : 400,
            color: isInjected ? 'var(--accent)' : undefined,
          }}>
            {node.name}
          </span>
          
          {/* 注入标记 */}
          {isInjected && (
            <span style={{ 
              fontSize: 8, 
              color: 'var(--accent)', 
              marginLeft: 4,
              padding: '0 2px',
              borderRadius: 2,
              background: 'var(--accent-soft)'
            }}>
              已注入
            </span>
          )}
        </div>

        {/* 子节点 */}
        {isDir && isExpanded && node.children && node.children.length > 0 && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  /* ---- 右键菜单组件 ---- */
  const ContextMenu = () => {
    if (!contextMenuPos || !contextMenuFile) return null;
    
    const isDir = contextMenuFile.type === 'directory';
    const isInjected = isFileInjected(contextMenuFile.path);

    return (
      <div
        style={{
          position: 'fixed',
          left: contextMenuPos.x,
          top: contextMenuPos.y,
          zIndex: 1000,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          minWidth: 160,
          padding: '4px 0',
        }}
      >
        {/* 注入到 AI 上下文 */}
        {!isDir && (
          <div
            onClick={() => injectToContext(contextMenuFile)}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: isInjected ? '#ff4d4f' : 'var(--accent)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            {isInjected ? <><LinkOutlined /> 从上下文移除</> : <><LinkOutlined /> 注入到 AI 上下文</>}
          </div>
        )}
        
        {/* 在编辑器中打开 */}
        {!isDir && (
          <div
            onClick={() => openInEditor(contextMenuFile.path)}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--fg)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <EditOutlined /> 在编辑器中打开
          </div>
        )}
        
        {/* 预览文件 */}
        {!isDir && (
          <div
            onClick={() => { openFile(contextMenuFile.path); setContextMenuPos(null); }}
            style={{
              padding: '6px 12px',
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--fg)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <EyeOutlined /> 预览文件
          </div>
        )}
        
        <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
        
        {/* 复制路径 */}
        <div
          onClick={() => copyPath(contextMenuFile.path)}
          style={{
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--fg)',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <CopyOutlined /> 复制路径
        </div>
      </div>
    );
  };

  /* ---- 点击其他地方关闭右键菜单 ---- */
  useEffect(() => {
    const handleClick = () => setContextMenuPos(null);
    if (contextMenuPos) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenuPos]);

  /* ==================== Render ==================== */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} ref={fileTreeRef}>
      {/* 头部: 当前工作区路径 */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 10,
        color: 'var(--muted-2)', background: 'var(--panel)',
      }}>
        <FolderOpenOutlined style={{ fontSize: 11 }} />
        <Text style={{ fontSize: 10, color: 'var(--muted-2)' }} ellipsis>
          {workspaceDir || '未设置工作区'}
        </Text>
        {injectedFiles.length > 0 && (
          <span style={{ 
            fontSize: 9, 
            color: 'var(--accent)',
            marginLeft: 'auto',
            padding: '1px 4px',
            borderRadius: 3,
            background: 'var(--accent-soft)'
          }}>
            {injectedFiles.length} 已注入
          </span>
        )}
      </div>

      {/* 文件树区域 */}
      <div style={{ flex: 1, overflow: 'auto', padding: '2px 4px' }}>
        {!workspaceDir ? (
          <EmptyHint text="请先设置工作区目录" />
        ) : loading ? (
          <div style={{ padding: 12, textAlign: 'center' }}><Spin size="small" /></div>
        ) : error ? (
          <EmptyHint text={`加载失败: ${error}`} />
        ) : tree.length === 0 ? (
          <EmptyHint text="目录为空或无法访问" />
        ) : (
          <div>{tree.map(n => renderNode(n, 0))}</div>
        )}
      </div>

      {/* 文件预览区域 */}
      {preview && (
        <div style={{
          borderTop: '1px solid var(--border)', maxHeight: 160, overflow: 'auto',
          background: 'var(--bg-2)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '3px 8px', fontSize: 10, color: 'var(--muted-2)',
            borderBottom: '1px solid var(--border)', background: 'var(--panel)',
          }}>
            <span style={{ fontWeight: 600 }}>
              {preview.path.split(/[/\\]/).pop()}
            </span>
            <Button
              type="text" size="small"
              icon={<CloseOutlined style={{ fontSize: 10 }} />}
              style={{ height: 20, width: 20, color: 'var(--muted-2)' }}
              onClick={() => setPreview(null)}
            />
          </div>
          <pre style={{
            margin: 0, padding: '6px 10px', fontSize: 10,
            color: 'var(--muted)', fontFamily: 'monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 130, overflow: 'auto',
          }}>
            {previewLoading ? '加载中...' : String(preview.content || '').slice(0, 3000)}
          </pre>
        </div>
      )}

      {/* 右键菜单 */}
      <ContextMenu />
    </div>
  );
};

/* ---- 空状态提示 ---- */
const EmptyHint: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ padding: 12, textAlign: 'center', color: 'var(--muted-2)', fontSize: 11 }}>
    {text}
  </div>
);

/* ---- 文件图标 ---- */
function getFileIcon(name: string): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts': case 'tsx': case 'js': case 'jsx': return <CodeOutlined />;
    case 'md': case 'txt': case 'log': return <FileTextOutlined />;
    default: return <FileOutlined />;
  }
}
