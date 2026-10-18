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

/** 网关绝对地址 (图片/视频必须用绝对地址, <img src> 不走 fetch 拦截器) */
const gatewayHttp = () =>
  (window as any).__AGENTAI_GATEWAY__?.replace(/^ws(s?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';

const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
const VIDEO_EXT = /^(mp4|webm|mov|mkv|avi)$/i;
const AUDIO_EXT = /^(mp3|wav|flac|aac|m4a|ogg)$/i;
const downloadUrl = (p: string) => `${gatewayHttp()}/api/files/download?path=${encodeURIComponent(p)}`;

/** 从工具输出文本里兜底抽路径 (generate_image 的 localPath 在 output 的 `FILE:` 行) */
function pathFromOutput(result: unknown): string {
  if (!result) return '';
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  const fileLine = text.match(/FILE:\s*([^\s\n"']+)/i);
  if (fileLine) return fileLine[1];
  const anyPath = text.match(/(?:已生成|已创建|saved?|wrote|created|output)[:\s]*[`'"]*([A-Za-z]:[^\s`'"]+|\/[^\s`'"]+)\.(\w{2,5})/i);
  return anyPath ? `${anyPath[1]}.${anyPath[2]}` : '';
}

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
              if (!/^(write_file|edit_file|create_file|multi_edit|str_replace|run_code|generate_image|generate_diagram|generate_video)$/i.test(name)) continue;
              // 从 args 提取文件路径 (args 包含 path/file_path/file)
              const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
              let filePath = args?.path || args?.filePath || args?.file_path || args?.file || '';
              // 2026-10-18 修复: generate_image / generate_video 的落盘路径不在 args 里,
              //   只在**输出文本** `FILE: ...` 行 (或 data.localPath)。原来只对 run_code 抽、
              //   且正则过窄 → 生图产物压根不进这个列表, 用户以为"文件没生成"。
              if (!filePath) {
                const dataLocal = (seg as any)?.data?.localPath;
                if (typeof dataLocal === 'string' && dataLocal) filePath = dataLocal;
              }
              if (!filePath) filePath = pathFromOutput(seg.result);
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
   * PDF / 视频等无法就地渲染的格式 → 走工作区预览面板。
   * 与「编辑器」图标是同一条链路: 具体用预览还是 Monaco, 由 Editor.openFile
   * 按文件类型统一路由 (媒体 → 预览, 文本 → 编辑器)。
   */
  const openInPreviewPanel = (filePath: string) => handleOpen(filePath);

  /**
   * 点击行 → 就地展开/收起内容预览 (不跳页)。
   * 首次展开才拉取内容; 响应回来时若用户已点了别的文件, 直接丢弃。
   *
   * 2026-10-18 修复: 图片/视频/音频/PDF **不能**按 utf-8 读 ——
   *   `/v1/files/read` 用 readFileSync(utf-8), 二进制会变成乱码,
   *   而且 >5MB 直接 413。这类文件改为直接给媒体地址就地渲染。
   */
  const handlePreview = async (filePath: string) => {
    if (preview.path === filePath) {
      setPreview({ path: '', content: '', loading: false });
      return;
    }
    const ext = (filePath.split(/[\\/]/).pop() || '').split('.').pop() || '';
    if (IMAGE_EXT.test(ext) || VIDEO_EXT.test(ext) || AUDIO_EXT.test(ext) || /^pdf$/i.test(ext)) {
      // 媒体: 不打文本接口, 直接标记 (渲染时用 downloadUrl)
      setPreview({ path: filePath, content: '', loading: false });
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
      title={<span style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)' }}><FileAddOutlined style={{ marginRight: 4 }} />生成的文件</span>}
      style={{ borderRadius: 'var(--radius-md)', background: 'var(--card)', border: '1px solid var(--border)' }}
      styles={{ body: { padding: '8px 12px', maxHeight: preview.path ? 440 : 200, overflowY: 'auto' } }}
    >
      {files.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>暂无生成文件</span>} style={{ margin: '4px 0' }} />
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
                    padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', fontSize: 'var(--fs-micro)',
                    color: 'var(--fg-2)',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--panel)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isOpen ? 'var(--panel)' : 'transparent'; }}
                >
                  <FileTextOutlined style={{ fontSize: 'var(--fs-sm)', color: langColor, flexShrink: 0 }} />
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{fileName}</span>
                  <Tooltip title="在编辑器中打开">
                    <EditOutlined
                      onClick={(e) => { e.stopPropagation(); handleOpen(f.path); }}
                      style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tooltip title="在文件夹中显示">
                    <FolderOpenOutlined
                      onClick={(e) => { e.stopPropagation(); handleReveal(f.path); }}
                      style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tooltip title="下载">
                    <DownloadOutlined
                      onClick={(e) => { e.stopPropagation(); handleDownload(f.path); }}
                      style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', cursor: 'pointer' }}
                    />
                  </Tooltip>
                  <Tag style={{ fontSize: 'var(--fs-micro)', borderRadius: 'var(--radius-sm)', margin: 0, border: 'none', lineHeight: '16px', padding: '0 4px' }}>
                    {f.action.replace(/_/g, ' ')}
                  </Tag>
                </div>
              </Tooltip>
              {/* 就地内容预览 (点击行展开, 不跳页) */}
              {isOpen && (() => {
                const fExt = (fileName.split('.').pop() || '').toLowerCase();
                // 媒体: 就地渲染 (图片缩略图 / 视频播放器), 不读文本
                if (IMAGE_EXT.test(fExt)) {
                  return (
                    <div style={{ padding: '4px 8px 6px 26px' }}>
                      <img
                        src={downloadUrl(f.path)}
                        alt={fileName}
                        onClick={() => window.open(downloadUrl(f.path), '_blank', 'noopener')}
                        style={{
                          maxWidth: '100%', maxHeight: 220, borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)', cursor: 'zoom-in', display: 'block',
                        }}
                      />
                      <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 4 }}>
                        点击图片在新窗口看原图
                      </div>
                    </div>
                  );
                }
                if (VIDEO_EXT.test(fExt) || AUDIO_EXT.test(fExt)) {
                  return (
                    <div style={{ padding: '4px 8px 6px 26px' }}>
                      {VIDEO_EXT.test(fExt)
                        ? <video src={downloadUrl(f.path)} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 'var(--radius-sm)' }} />
                        : <audio src={downloadUrl(f.path)} controls style={{ width: '100%' }} />}
                    </div>
                  );
                }
                if (/^pdf$/i.test(fExt)) {
                  return (
                    <div style={{ padding: '4px 8px 6px 26px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                      PDF 需在预览面板打开 ——
                      <span
                        onClick={() => openInPreviewPanel(f.path)}
                        style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 4 }}
                      >点此打开</span>
                    </div>
                  );
                }
                if (preview.loading) {
                  return <div style={{ padding: '4px 8px 6px 26px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>加载中…</div>;
                }
                if (preview.content) {
                  return (
                    <pre style={{
                      margin: '0 0 2px 22px', padding: '6px 8px',
                      maxHeight: 200, overflowY: 'auto',
                      fontSize: 'var(--fs-micro)', lineHeight: 1.4,
                      fontFamily: "'Consolas', monospace",
                      color: 'var(--fg-2)', background: 'var(--bg-2)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>{preview.content}</pre>
                  );
                }
                return <div style={{ padding: '4px 8px 6px 26px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>（空文件或读取失败）</div>;
              })()}
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
