/**
 * WorkspacePanel — 工作区文件树 + 预览面板
 * 后端返回格式: { tree: TreeNode[] }
 * TreeNode = { name, path, type: 'directory'|'file', size, children }
 */
import React, { useState, useCallback, useEffect } from 'react';
import { Button, Typography, Spin } from 'antd';
import {
  FolderOpenOutlined, FileOutlined, FolderOutlined,
  FileTextOutlined, CodeOutlined, CloseOutlined,
} from '@ant-design/icons';

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

  /* ---- 递归渲染树节点 ---- */
  const renderNode = (node: BackendNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'directory';
    const isExpanded = expandedPaths.has(node.path);

    return (
      <div key={node.path}>
        <div
          onClick={() => isDir ? toggleDir(node) : openFile(node.path)}
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
            color: isDir ? 'var(--warning)' : 'var(--muted-2)', fontSize: 11,
            flexShrink: 0, marginRight: 2,
          }}>
            {isDir ? <FolderOutlined /> : getFileIcon(node.name)}
          </span>

          {/* 名称 */}
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis',
            fontWeight: isDir ? 600 : 400,
          }}>
            {node.name}
          </span>
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

  /* ==================== Render ==================== */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
    case 'ts': case 'tsx': case 'js': case 'jsx': case 'tsx': return <CodeOutlined />;
    case 'md': case 'txt': case 'log': return <FileTextOutlined />;
    default: return <FileOutlined />;
  }
}
