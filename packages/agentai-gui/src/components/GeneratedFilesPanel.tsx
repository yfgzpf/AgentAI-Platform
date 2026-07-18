/**
 * GeneratedFilesPanel — AI 生成的文件列表
 * -----------------------------------------
 * 从 chatStore 聚合所有 write_file/create_file/edit_file 调用
 * 展示 AI 本次对话中生成/修改的文件，点击可打开
 */
import React, { useMemo } from 'react';
import { Card, Tag, Empty, Tooltip, message as antdMsg } from 'antd';
import { FileAddOutlined, FileTextOutlined, DownloadOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';

export const GeneratedFilesPanel: React.FC = () => {
  const { messages } = useChatStore();

  const files = useMemo(() => {
    const result: { path: string; action: string; ts: number }[] = [];
    const seen = new Set<string>();

    if (messages) {
      for (const msg of messages) {
        if (msg.segments) {
          for (const seg of msg.segments) {
            if (seg.kind === 'tool' && seg.name) {
              const name = seg.name.toLowerCase();
              if (!/^(write_file|edit_file|create_file|multi_edit|str_replace|run_code|generate_image|generate_diagram)$/i.test(name)) continue;
              // 从 args 提取文件路径 (args 包含 path/file_path/file)
              const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
              let filePath = args?.path || args?.file_path || args?.file || '';
              // run_code: 从结果中提取生成的文件路径
              if (!filePath && name === 'run_code' && seg.result) {
                const resultStr = typeof seg.result === 'string' ? seg.result : JSON.stringify(seg.result);
                const fileMatch = resultStr.match(/(?:已生成|已创建|saved?|wrote|created|output)[:\s]*[`'"]*([^\s`'"]+\.\w{2,5})/i);
                if (fileMatch) filePath = fileMatch[1];
              }
              if (filePath && !seen.has(filePath)) {
                seen.add(filePath);
                result.push({ path: filePath, action: seg.name, ts: msg.ts });
              }
            }
          }
        }
      }
    }
    return result;
  }, [messages]);

  const handleOpen = (filePath: string) => {
    // 触发全局事件, Editor 组件监听并打开文件
    window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path: filePath } }));
    // 切换到编辑器视图
    try {
      const store = (window as any).__agentai_app_store__;
      if (store?.getState?.().setView) {
        store.getState().setView('editor');
      }
    } catch { /* optional */ }
    antdMsg.info(`打开: ${filePath.split(/[\\/]/).pop()}`);
  };

  const handleReveal = async (filePath: string) => {
    try {
      const res = await fetch('/v1/fs/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath }),
      });
      const data = await res.json();
      if (data.ok) {
        antdMsg.success(`已在文件夹中显示: ${filePath.split(/[\\/]/).pop()}`);
      } else {
        antdMsg.error(data.error || '打开失败');
      }
    } catch {
      antdMsg.error('打开文件夹失败');
    }
  };

  const handleDownload = (filePath: string) => {
    const a = document.createElement('a');
    a.href = `/api/files/download?path=${encodeURIComponent(filePath)}`;
    a.download = filePath.split(/[\\/]/).pop() || 'file';
    a.click();
    antdMsg.success(`下载: ${filePath.split(/[\\/]/).pop()}`);
  };

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 12, color: 'var(--fg-2)' }}><FileAddOutlined style={{ marginRight: 4 }} />生成的文件</span>}
      style={{ borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px', maxHeight: 200, overflowY: 'auto' } }}
    >
      {files.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 11, color: 'var(--muted-2)' }}>暂无生成文件</span>} style={{ margin: '4px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {files.map((f, i) => {
            const fileName = f.path.split(/[\\/]/).pop() || f.path;
            const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
            const langColor = ext ? getLangColor(ext) : '#666';
            return (
              <Tooltip key={`${f.path}-${i}`} title={`${f.path}\n点击在编辑器中打开`}>
                <div
                  onClick={() => handleOpen(f.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px', borderRadius: 4,
                    cursor: 'pointer', fontSize: 11,
                    color: 'var(--fg-2)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <FileTextOutlined style={{ fontSize: 12, color: langColor, flexShrink: 0 }} />
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{fileName}</span>
                  <Tooltip title="在文件夹中显示">
                    <FolderOpenOutlined
                      onClick={(e) => { e.stopPropagation(); handleReveal(f.path); }}
                      style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tooltip title="下载">
                    <DownloadOutlined
                      onClick={(e) => { e.stopPropagation(); handleDownload(f.path); }}
                      style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tag style={{ fontSize: 9, borderRadius: 2, margin: 0, border: 'none', lineHeight: '16px', padding: '0 4px' }}>
                    {f.action.replace(/_/g, ' ')}
                  </Tag>
                </div>
              </Tooltip>
            );
          })}
        </div>
      )}
    </Card>
  );
};

function getLangColor(ext: string): string {
  const map: Record<string, string> = {
    ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e',
    py: '#3572A5', rs: '#dea584', go: '#00ADD8', java: '#b07219',
    css: '#563d7c', scss: '#563d7c', html: '#e34c26', json: '#292929',
    md: '#083fa1', yml: '#cb171e', yaml: '#cb171e', toml: '#7f7f7f',
    sql: '#e38c00', sh: '#89e051', ps1: '#012456', vue: '#41b883',
    svelte: '#ff3e00', swift: '#F05138', kt: '#A97BFF', dart: '#00B4AB',
  };
  return map[ext] || '#666';
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
