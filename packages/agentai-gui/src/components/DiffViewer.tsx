/**
 * DiffViewer — AI 修改文件后的 Diff 预览弹窗
 * 使用 Monaco DiffEditor 显示修改前后对比
 */
import React, { useEffect, useState } from 'react';
import { Modal, Button, Spin, message } from 'antd';
import { UndoOutlined, CheckOutlined, CopyOutlined } from '@ant-design/icons';
import { MonacoEditorComponent, detectLangFromPath } from './MonacoEditor';

interface DiffViewerProps {
  filePath: string;
  onClose: () => void;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ filePath, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [oldContent, setOldContent] = useState('');
  const [newContent, setNewContent] = useState('');
  const [error, setError] = useState('');
  const fileName = filePath.split(/[\\/]/).pop() || filePath;
  const lang = detectLangFromPath(filePath);

  useEffect(() => {
    const fetchDiff = async () => {
      try {
        // 获取当前文件内容
        const newRes = await fetch(`/v1/files/read?path=${encodeURIComponent(filePath)}`);
        if (newRes.ok) {
          const data = await newRes.json();
          setNewContent(data.content || '');
        }
        // 获取备份内容 (最近一次)
        const bakRes = await fetch(`/v1/files/backup?path=${encodeURIComponent(filePath)}`);
        if (bakRes.ok) {
          const data = await bakRes.json();
          setOldContent(data.content || '');
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDiff();
  }, [filePath]);

  const handleUndo = async () => {
    try {
      const res = await fetch('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[SYSTEM] 用户请求撤销文件修改: ${filePath}`,
          stream: false,
          model: 'agentai',
          userId: 'user',
          _internal: true,
        }),
      });
      if (res.ok) {
        message.success('已撤销修改');
        onClose();
      }
    } catch {
      message.error('撤销失败');
    }
  };

  const addedLines = newContent.split('\n').length - oldContent.split('\n').length;
  const diffLabel = addedLines > 0 ? `+${addedLines}` : addedLines < 0 ? `${addedLines}` : '±0';

  return (
    <Modal
      open
      onCancel={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>📄 {fileName}</span>
          <span style={{
            fontSize: 11, padding: '1px 6px', borderRadius: 4,
            background: addedLines > 0 ? 'rgba(34,197,94,0.15)' : addedLines < 0 ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.1)',
            color: addedLines > 0 ? '#22c55e' : addedLines < 0 ? '#ef4444' : 'var(--muted)',
          }}>{diffLabel} 行</span>
        </div>
      }
      width="85vw"
      styles={{ body: { height: '65vh', padding: 0, overflow: 'hidden' } }}
      footer={[
        <Button key="undo" icon={<UndoOutlined />} onClick={handleUndo} danger>
          撤销修改
        </Button>,
        <Button key="copy" icon={<CopyOutlined />} onClick={() => {
          navigator.clipboard.writeText(newContent);
          message.success('已复制新内容');
        }}>
          复制
        </Button>,
        <Button key="ok" type="primary" icon={<CheckOutlined />} onClick={onClose}>
          确认
        </Button>,
      ]}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Spin tip="加载中..." />
        </div>
      ) : error ? (
        <div style={{ padding: 20, color: 'var(--danger)' }}>{error}</div>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 12px',
            fontSize: 11, color: 'var(--muted-2)', background: 'var(--panel)',
            borderBottom: '1px solid var(--border)',
          }}>
            <span>修改前 (备份)</span>
            <span>修改后 (当前)</span>
          </div>
          <div style={{ flex: 1, display: 'flex' }}>
            <div style={{ flex: 1, borderRight: '1px solid var(--border)', overflow: 'auto' }}>
              <pre style={{
                margin: 0, padding: 12, fontSize: 12, fontFamily: 'monospace',
                background: '#1e1e1e', color: '#d4d4d4', height: '100%',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{oldContent || '(无备份 - 新文件)'}</pre>
            </div>
            <div style={{ flex: 1, overflow: 'auto' }}>
              <pre style={{
                margin: 0, padding: 12, fontSize: 12, fontFamily: 'monospace',
                background: '#1e1e1e', color: '#d4d4d4', height: '100%',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{newContent || '(空文件)'}</pre>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

/**
 * 全局 Diff 事件监听
 * 在 App 或 ChatView 中使用
 */
export function useDiffEvents() {
  const [diffFile, setDiffFile] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path) setDiffFile(path);
    };
    window.addEventListener('agentai:show-diff', handler);
    return () => window.removeEventListener('agentai:show-diff', handler);
  }, []);

  return { diffFile, clearDiff: () => setDiffFile(null) };
}
