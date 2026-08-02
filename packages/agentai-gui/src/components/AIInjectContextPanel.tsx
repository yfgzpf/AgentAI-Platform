/**
 * AIInjectContextPanel — AI上下文注入面板 (可折叠)
 * 
 * 功能:
 *   1. 显示项目说明文件状态 (PROJECT_README.md, PROJECT_CONTEXT.md, PROJECT_STATE.md)
 *   2. 支持预览项目说明文件
 *   3. 显示已注入上下文的文件列表
 *   4. 显示传统上下文注入规则
 *   5. 默认折叠，节省空间
 */

import React, { useState, useEffect } from 'react';
import { List, Tag, Switch, Button, Space, Tooltip, Modal, Drawer, Empty } from 'antd';
import { 
  FileTextOutlined, CodeOutlined, DownOutlined, RightOutlined, 
  SyncOutlined, FileAddOutlined, CheckCircleOutlined, CloseCircleOutlined,
  EyeOutlined, DeleteOutlined, FileOutlined, LinkOutlined
} from '@ant-design/icons';
import { useModelStore } from '../store/modelStore';
import { useContextStore } from '../store/contextStore';
import ReactMarkdown from 'react-markdown';

interface DocFileStatus {
  readme: { exists: boolean; lastModified: number };
  context: { exists: boolean; lastModified: number };
  state: { exists: boolean; lastModified: number };
}

const DOC_NAMES: Record<string, string> = {
  readme: 'PROJECT_README.md',
  context: 'PROJECT_CONTEXT.md',
  state: 'PROJECT_STATE.md',
};

export const AIInjectContextPanel: React.FC = () => {
  const [collapsed, setCollapsed] = useState(true);
  const [docStatus, setDocStatus] = useState<DocFileStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; content: string } | null>(null);
  const { contextInject, setContextInject } = useModelStore();
  const { injectedFiles, removeInjectedFile, clearInjectedFiles } = useContextStore();

  // 获取文档状态
  const fetchDocStatus = async () => {
    try {
      const res = await fetch('/v1/project-docs/status');
      if (res.ok) {
        const data = await res.json();
        setDocStatus(data.files);
      }
    } catch (e) {
      console.error('Failed to fetch doc status:', e);
    }
  };

  // 首次加载和展开时获取状态
  useEffect(() => {
    if (!collapsed) {
      fetchDocStatus();
    }
  }, [collapsed]);

  // 调用 auto_project_doc 工具
  const callAutoProjectDoc = async (action: string) => {
    setLoading(true);
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `调用 auto_project_doc 工具，action=${action}` }],
          model: 'agentai',
          tools: [{ type: 'function', function: { name: 'auto_project_doc' } }],
        }),
      });
      if (res.ok) {
        await fetchDocStatus();
      }
    } catch (e) {
      console.error('Failed to call auto_project_doc:', e);
    } finally {
      setLoading(false);
    }
  };

  // 预览文件
  const previewDocFile = async (docId: string) => {
    const fileName = DOC_NAMES[docId];
    try {
      const res = await fetch(`/v1/project-docs/read?file=${docId}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewFile({ name: fileName, content: data.content || '文件为空' });
        setPreviewOpen(true);
      }
    } catch (e) {
      console.error('Failed to read doc file:', e);
    }
  };

  const docFiles = [
    { id: 'readme', name: 'PROJECT_README.md', desc: '项目架构说明', color: 'var(--accent)' },
    { id: 'context', name: 'PROJECT_CONTEXT.md', desc: '当前任务上下文', color: 'var(--success)' },
    { id: 'state', name: 'PROJECT_STATE.md', desc: '实时项目状态', color: 'var(--warning)' },
  ];

  const rules = [
    { id: 'readme', name: '项目README', type: 'file' as const, pattern: 'README.md', enabled: contextInject.readme },
    { id: 'packageJson', name: 'package.json', type: 'file' as const, pattern: 'package.json', enabled: contextInject.packageJson },
    { id: 'activeFile', name: '当前打开文件', type: 'code' as const, pattern: '${currentFile}', enabled: contextInject.activeFile },
  ];

  const getIcon = (type: string) => {
    switch (type) {
      case 'file': return <FileTextOutlined />;
      case 'code': return <CodeOutlined />;
      default: return null;
    }
  };

  const formatTime = (ts: number) => {
    if (!ts) return '未创建';
    const date = new Date(ts);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return date.toLocaleDateString();
  };

  // 折叠摘要行
  const summaryRow = (
    <div
      onClick={() => setCollapsed(!collapsed)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        padding: '6px 8px', borderRadius: 6,
        fontSize: 11, color: 'var(--fg-2)',
        background: 'transparent', userSelect: 'none',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <CodeOutlined style={{ fontSize: 12, color: 'var(--accent)', flexShrink: 0 }} />
      <span style={{ fontWeight: 500 }}>AI 上下文注入</span>
      <span style={{ fontSize: 10, color: 'var(--muted-2)', marginLeft: 'auto' }}>
        {injectedFiles.length > 0 && <Tag style={{ fontSize: 9, marginRight: 4, padding: '0 4px', lineHeight: '14px' }}>{injectedFiles.length} 文件</Tag>}
        {rules.filter(r => r.enabled).length}/{rules.length} 启用
      </span>
      <span style={{ fontSize: 10, color: 'var(--muted-2)', flexShrink: 0 }}>
        {collapsed ? <RightOutlined /> : <DownOutlined />}
      </span>
    </div>
  );

  if (collapsed) {
    return (
      <>
        <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 2 }}>{summaryRow}</div>
        
        {/* 预览抽屉 */}
        <Drawer
          title={previewFile?.name}
          placement="right"
          width={600}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          styles={{ body: { padding: 0, background: 'var(--bg)' } }}
        >
          {previewFile && (
            <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
              <ReactMarkdown>{previewFile.content}</ReactMarkdown>
            </div>
          )}
        </Drawer>
      </>
    );
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
      {summaryRow}
      
      {/* 项目文档文件状态 */}
      <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ fontSize: 12 }} />
          项目说明文件
          <Space size="small" style={{ marginLeft: 'auto' }}>
            <Tooltip title="审查项目并生成文件">
              <Button
                size="small"
                icon={<FileAddOutlined />}
                loading={loading}
                onClick={() => callAutoProjectDoc('review')}
                style={{ fontSize: 10 }}
              >
                审查
              </Button>
            </Tooltip>
            <Tooltip title="刷新状态">
              <Button
                size="small"
                icon={<SyncOutlined />}
                onClick={fetchDocStatus}
                style={{ fontSize: 10 }}
              />
            </Tooltip>
          </Space>
        </div>
        <List
          size="small"
          dataSource={docFiles}
          renderItem={item => {
            const status = docStatus?.[item.id as keyof DocFileStatus];
            const exists = status?.exists || false;
            return (
              <List.Item
                actions={[
                  exists && (
                    <Tooltip title="预览">
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined style={{ fontSize: 12 }} />}
                        onClick={() => previewDocFile(item.id)}
                        style={{ padding: '0 4px', height: 20 }}
                      />
                    </Tooltip>
                  )
                ].filter(Boolean)}
                style={{ padding: '4px 0', fontSize: 11 }}
              >
                <List.Item.Meta
                  avatar={
                    exists 
                      ? <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 12 }} />
                      : <CloseCircleOutlined style={{ color: 'var(--danger)', fontSize: 12 }} />
                  }
                  title={
                    <span style={{ fontSize: 11, color: exists ? 'var(--fg)' : 'var(--muted)' }}>
                      {item.name}
                    </span>
                  }
                  description={
                    <div style={{ fontSize: 10, color: 'var(--muted-2)' }}>
                      {item.desc} · {status ? formatTime(status.lastModified) : '未知'}
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>

      {/* 已注入的文件列表 */}
      {injectedFiles.length > 0 && (
        <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>
              <LinkOutlined style={{ fontSize: 12, marginRight: 4 }} />
              已注入文件 ({injectedFiles.length})
            </span>
            <Button
              type="text"
              size="small"
              danger
              style={{ fontSize: 10, padding: '0 4px', height: 20 }}
              onClick={clearInjectedFiles}
            >
              清空
            </Button>
          </div>
          <List
            size="small"
            dataSource={injectedFiles}
            renderItem={item => (
              <List.Item
                actions={[
                  <Tooltip title="移除">
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined style={{ fontSize: 12, color: 'var(--danger)' }} />}
                      onClick={() => removeInjectedFile(item.path)}
                      style={{ padding: '0 4px', height: 20 }}
                    />
                  </Tooltip>
                ]}
                style={{ padding: '2px 0', fontSize: 10 }}
              >
                <FileOutlined style={{ fontSize: 10, color: 'var(--accent)', marginRight: 4 }} />
                <span style={{ 
                  fontSize: 10, 
                  color: 'var(--fg-2)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 120
                }}>
                  {item.name}
                </span>
              </List.Item>
            )}
          />
        </div>
      )}

      {/* 传统上下文注入规则 */}
      <div style={{ paddingTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--fg)', marginBottom: 8 }}>
          <CodeOutlined style={{ fontSize: 12, marginRight: 4 }} />
          自动上下文注入
        </div>
        <List
          size="small"
          dataSource={rules}
          renderItem={item => (
            <List.Item
              actions={[
                <Switch
                  size="small"
                  checked={item.enabled}
                  onChange={(v) => setContextInject(item.id as any, v)}
                />
              ]}
              style={{ padding: '4px 0', fontSize: 11 }}
            >
              <List.Item.Meta
                avatar={<span style={{ fontSize: 12, color: 'var(--muted)' }}>{getIcon(item.type)}</span>}
                title={<span style={{ fontSize: 11 }}>{item.name}</span>}
                description={<Tag style={{ fontSize: 9, margin: 0 }}>{item.pattern}</Tag>}
              />
            </List.Item>
          )}
        />
      </div>

      {/* 预览抽屉 */}
      <Drawer
        title={previewFile?.name}
        placement="right"
        width={600}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        styles={{ body: { padding: 0, background: 'var(--bg)' } }}
      >
        {previewFile && (
          <div style={{ padding: 16, fontSize: 13, lineHeight: 1.6 }}>
            <ReactMarkdown>{previewFile.content}</ReactMarkdown>
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default AIInjectContextPanel;
