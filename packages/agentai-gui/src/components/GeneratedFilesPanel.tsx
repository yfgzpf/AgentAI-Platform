/**
 * GeneratedFilesPanel — AI 生成的文件列表
 * -----------------------------------------
 * 从 chatStore 聚合所有 write_file/create_file/edit_file 调用
 * 展示 AI 本次对话中生成/修改的文件。点击行 = 就地展开内容预览 (不跳页);
 * 只有点「编辑器」图标才跳到编辑器页 (2026-10-11: 原先整行点击就跳页, 用户反馈很烦)
 */
import React, { useMemo, useState } from 'react';
import { Card, Tag, Empty, Tooltip, message as antdMsg } from 'antd';
import { FileAddOutlined, FileTextOutlined, DownloadOutlined, FolderOpenOutlined, EditOutlined } from '@ant-design/icons';
import { useChatStore } from '../store/chatStore';

export const GeneratedFilesPanel: React.FC = () => {
  const { messages } = useChatStore();
  // 就地展开预览: { path, content, loading } 合成一个状态, 便于丢弃过期响应
  const [preview, setPreview] = useState<{ path: string; content: string; loading: boolean }>({
    path: '', content: '', loading: false,
  });

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
              let filePath = args?.path || args?.filePath || args?.file_path || args?.file || '';
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

  /**
   * 「编辑器」按钮 → 切到编辑器页打开文件 (唯一会跳页的路径)
   */
  const handleOpen = (filePath: string) => {
    // P0: 先切换页面, 再走 pending 机制打开文件 (Editor 未挂载时事件不丢失)
    window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'editor' } }));
    window.dispatchEvent(new CustomEvent('agentai:open-file-pending', { detail: { path: filePath } }));
    antdMsg.info(`正在打开: ${filePath.split(/[\\/]/).pop()}`);
  };

  /**
   * 点击行 → 就地展开/收起内容预览 (不跳页)。
   * 首次展开才拉取内容; 响应回来时若用户已点了别的文件, 直接丢弃。
   */
  const handlePreview = async (filePath: string) => {
    if (preview.path === filePath) {
      setPreview({ path: '', content: '', loading: false });
      return;
    }
    setPreview({ path: filePath, content: '', loading: true });
    try {
      const res = await fetch(`/v1/files/read?path=${encodeURIComponent(filePath)}`);
      const data = res.ok ? await res.json() : null;
      const content = data?.content ?? '';
      setPreview(prev => (prev.path === filePath ? { path: filePath, content, loading: false } : prev));
    } catch {
      setPreview(prev => (prev.path === filePath ? { path: filePath, content: '', loading: false } : prev));
    }
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
      styles={{ body: { padding: '8px 12px', maxHeight: preview.path ? 440 : 200, overflowY: 'auto' } }}
    >
      {files.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 11, color: 'var(--muted-2)' }}>暂无生成文件</span>} style={{ margin: '4px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {files.map((f, i) => {
            const fileName = f.path.split(/[\\/]/).pop() || f.path;
            const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
            const langColor = ext ? getLangColor(ext) : '#666';
            const isOpen = preview.path === f.path;
            return (
              <div key={`${f.path}-${i}`}>
              <Tooltip title={`${f.path}\n点击展开预览`}>
                <div
                  onClick={() => handlePreview(f.path)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px', borderRadius: 4,
                    cursor: 'pointer', fontSize: 11,
                    color: 'var(--fg-2)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isOpen ? 'var(--panel)' : 'transparent'; }}
                >
                  <FileTextOutlined style={{ fontSize: 12, color: langColor, flexShrink: 0 }} />
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{fileName}</span>
                  <Tooltip title="在编辑器中打开">
                    <EditOutlined
                      onClick={(e) => { e.stopPropagation(); handleOpen(f.path); }}
                      style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
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
              {/* 就地内容预览 (点击行展开, 不跳页) */}
              {isOpen && (
                preview.loading ? (
                  <div style={{ padding: '4px 8px 6px 26px', fontSize: 10, color: 'var(--muted-2)' }}>加载中…</div>
                ) : preview.content ? (
                  <pre style={{
                    margin: '0 0 2px 22px', padding: '6px 8px',
                    maxHeight: 200, overflowY: 'auto',
                    fontSize: 10, lineHeight: 1.4,
                    fontFamily: "'Consolas', monospace",
                    color: 'var(--fg-2)', background: 'var(--bg-2)',
                    border: '1px solid var(--border)', borderRadius: 4,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>{preview.content}</pre>
                ) : (
                  <div style={{ padding: '4px 8px 6px 26px', fontSize: 10, color: 'var(--muted-2)' }}>（空文件或读取失败）</div>
                )
              )}
              </div>
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
