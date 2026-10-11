/**
 * FileCard — AI 文件操作卡片 (精简折叠版)
 * ----------------------------------------------------
 * 核心设计:
 *   - read_file: 只显示文件名 + 语言 + 大小，点击卡片就地展开全文 (不跳页)
 *   - write/edit: 折叠内容预览，只显示文件名 + 变更统计
 *   - 全部默认折叠，不占聊天篇幅
 *   - 只有点「编辑器」按钮才跳转编辑器页 (2026-10-11: 原先整行点击就跳页, 用户反馈很烦)
 */
import React, { useState, useMemo } from 'react';
import { Tooltip, message as antdMsg } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';

const LANG_META: Record<string, { icon: string; color: string }> = {
  ts: { icon: 'TS', color: '#3178C6' },
  tsx: { icon: 'TSX', color: '#3178C6' },
  js: { icon: 'JS', color: '#F7DF1E' },
  jsx: { icon: 'JSX', color: '#F7DF1E' },
  py: { icon: 'PY', color: '#3776AB' },
  rs: { icon: 'RS', color: '#CE422B' },
  go: { icon: 'GO', color: '#00ADD8' },
  java: { icon: 'JAVA', color: '#B07219' },
  json: { icon: '{}', color: '#5A5A5A' },
  md: { icon: 'MD', color: '#083FA1' },
  css: { icon: '#', color: '#264DE4' },
  html: { icon: '<>', color: '#E34F26' },
  vue: { icon: 'V', color: '#4FC08D' },
  yaml: { icon: 'Y', color: '#CB171E' },
  toml: { icon: 'T', color: '#9C4221' },
  sql: { icon: 'SQL', color: '#E38C00' },
  sh: { icon: '$_', color: '#4EAA25' },
  default: { icon: '📄', color: '#6B7280' },
};

function getLangMeta(path: string): { icon: string; color: string; lang: string } {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const m = LANG_META[ext] || LANG_META.default;
  return { ...m, lang: ext || 'text' };
}

function formatBytes(b?: number): string {
  if (b == null) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 就地展开的渲染行上限。
 * 内容整体塞进 DOM 会卡死页面 —— 本项目实测出现过单文件 30,528 行的变更，
 * 那是 3 万个 <div>。超过上限先渲染前 N 行，由用户点「显示全部」再补全。
 */
const PREVIEW_LINE_CAP = 400;

export type FileOp = 'create' | 'edit' | 'read' | 'delete' | 'batch';

export interface FileCardProps {
  /** 操作类型 */
  op: FileOp;
  /** 文件绝对或相对路径 */
  path: string;
  /** 文件内容 (用于预览; 过长会被截断) */
  content?: string;
  /** 旧内容 (用于行级 diff 显示, edit 模式有效) */
  oldContent?: string;
  /** 文件大小 (字节) */
  size?: number;
  /** 改动行数 (新增 +, 删除 -) */
  diffStats?: { added: number; removed: number };
  /** 是否多文件批量操作 (显示"+N 个文件") */
  batchCount?: number;
  /** 工具调用结果 (成功/失败) */
  ok?: boolean;
  /** 点击"在编辑器打开"回调 */
  onOpenInEditor?: (path: string) => void;
  /** 点击"在文件树定位"回调 */
  onLocateInTree?: (path: string) => void;
}

const OP_META: Record<FileOp, { label: string; color: string; bg: string; icon: string }> = {
  create: { label: '新建', color: '#10B981', bg: 'rgba(16,185,129,0.12)', icon: '✚' },
  edit:   { label: '修改', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: '✎' },
  read:   { label: '读取', color: '#6366F1', bg: 'rgba(99,102,241,0.12)', icon: '👁' },
  delete: { label: '删除', color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: '🗑' },
  batch:  { label: '批量', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)', icon: '📚' },
};

/**
 * 单个文件卡片 — 精简折叠版
 * 设计原则:
 *   - read: 只显示文件名，内容不可见 (不需要看)
 *   - write/edit: 显示文件名 + 变更数 + "查看详情" 展开/收起
 *   - 默认全部折叠，保持对话干净
 */
export const FileCard: React.FC<FileCardProps> = ({
  op, path, content, oldContent, size, diffStats, batchCount, ok, onOpenInEditor, onLocateInTree,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showContent, setShowContent] = useState(false);
  // 就地展开时的「显示全部」开关 (超过 PREVIEW_LINE_CAP 才用得上)
  const [showAll, setShowAll] = useState(false);
  // read 模式上游常不带 content → 首次展开时按需拉取并缓存
  const [fetched, setFetched] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const { icon, color, lang } = getLangMeta(path);
  const opMeta = OP_META[op];

  // 计算编辑统计信息 (提升到顶层, 保证 hooks 无条件调用)
  const editStats = useMemo(() => {
    if (!oldContent || !content) return null;
    const oldLines = oldContent.split('\n');
    const newLines = content.split('\n');
    let added = 0;
    let removed = 0;

    // 简单的行级diff统计
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    added = newLines.filter(line => !oldSet.has(line)).length;
    removed = oldLines.filter(line => !newSet.has(line)).length;

    return { added, removed, total: oldLines.length };
  }, [oldContent, content]);

  const filename = path.split(/[\\/]/).pop() || path;
  const dir = path.slice(0, path.length - filename.length);

  // ═══ 通用 handler (定义在 return 前, 避免 read 模式提前 return 后找不到) ═══
  
  /**
   * 行内展开/收起全文 (read 模式)。上游未传 content 时按需拉取一次。
   * 这是「点卡片就地看内容」的主路径 —— 不跳页。
   */
  const toggleInline = async () => {
    if (showContent) { setShowContent(false); return; }
    setShowContent(true);
    if (content != null || fetched != null) return; // 已有内容, 不重复拉
    setFetching(true);
    try {
      const res = await fetch(`/v1/files/read?path=${encodeURIComponent(path)}`);
      const data = res.ok ? await res.json() : null;
      setFetched(data?.content ?? '');
    } catch {
      setFetched('');
    } finally {
      setFetching(false);
    }
  };

  /**
   * 「编辑器」按钮 → 自动切换到编辑器页面 + 打开文件 (唯一会跳页的路径)
   */
  const handleOpen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    // P0: 走 pending 机制, 先切换页面再打开文件
    window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'editor' } }));
    window.dispatchEvent(new CustomEvent('agentai:open-file-pending', { detail: { path } }));
    
    if (onOpenInEditor) onOpenInEditor(path);
    antdMsg.info(`正在打开: ${filename}`);
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    // read 卡片的 content 可能是展开时按需拉回来的
    const text = content ?? fetched ?? '';
    if (!text) {
      antdMsg.warning('内容不可用, 无法复制');
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      antdMsg.success('已复制文件内容');
    });
  };

  /**
   * "定位"按钮 → 在左侧文件树中展开并高亮该文件（不跳转页面）
   */
  const handleLocate = (e: React.MouseEvent) => {
    e?.stopPropagation();
    // 触发全局事件：让左侧 PulseFlowSidebar 切换到"文件"tab + 展开到目标文件
    window.dispatchEvent(new CustomEvent('agentai:sidebar-locate-file', { 
      detail: { path, tab: 'files' } 
    }));
    
    if (onLocateInTree) {
      onLocateInTree(path);
    }
    antdMsg.info(`已定位: ${filename}`);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (content) {
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      antdMsg.success(`已下载: ${filename}`);
    } else {
      const url = `/api/files/download?path=${encodeURIComponent(path)}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
  };

  // ─── read 模式: 就地展开全文 (点卡片不跳页) ───
  // 只显示文件名 + 语言徽标 + 大小; 点整行 = 展开/收起内容, 不跳编辑器。
  // 跳编辑器只有底部「编辑器」按钮这一条路径 (用户反馈: 老跳编辑器很不方便)。
  if (op === 'read') {
    // read_file 的卡片上游不带 content (FilesFromToolSegment 只传 path) → 展开时按需拉取
    const body = content ?? fetched ?? '';
    const allLines = body ? body.split('\n') : [];
    const totalLines = allLines.length;
    const shownLines = showAll ? allLines : allLines.slice(0, PREVIEW_LINE_CAP);
    const capReached = !showAll && totalLines > PREVIEW_LINE_CAP;

    return (
      <div
        style={{
          margin: '3px 0', borderRadius: 8, overflow: 'hidden',
          background: 'var(--card)',
          border: `1px solid ${ok === false ? 'var(--danger)' : 'var(--border)'}`,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = ok === false ? 'var(--danger)' : 'var(--border)'; }}
      >
        <div
          onClick={() => { void toggleInline(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', cursor: 'pointer',
          }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color, color: '#fff',
            fontSize: 'var(--fs-micro)', fontWeight: 700,
            flexShrink: 0,
          }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{filename}</div>
            {dir && (
              <div style={{
                fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{dir}</div>
            )}
          </div>
          {size != null && (
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', flexShrink: 0 }}>{formatBytes(size)}</span>
          )}
          <span style={{
            fontSize: 'var(--fs-micro)', padding: '1px 5px', borderRadius: 3,
            background: opMeta.bg, color: opMeta.color, flexShrink: 0,
          }}>{opMeta.icon} 已读取</span>
          
          {/* 查看内容按钮 (点行与点它等价) */}
          <button
            onClick={(e) => { e.stopPropagation(); void toggleInline(); }}
            style={{
              fontSize: 'var(--fs-micro)', color: 'var(--accent)', background: 'transparent',
              border: 'none', cursor: 'pointer', padding: '0 4px', flexShrink: 0,
            }}
          >
            {showContent ? '收起 ▲' : '查看内容 ▼'}
          </button>
        </div>
        
        {/* 展开的内容预览 (就地展开, 不跳页) */}
        {showContent && (
          <div style={{ borderTop: '1px solid var(--border)' }}>
            {fetching ? (
              <div style={{ padding: '8px 12px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>加载中…</div>
            ) : totalLines === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>
                {content == null && fetched == null ? '（内容不可用）' : '（空文件或读取失败）'}
              </div>
            ) : (
            <pre style={{
              margin: 0, padding: '8px 12px',
              fontSize: 'var(--fs-micro)', lineHeight: 1.4,
              fontFamily: "'Consolas', monospace",
              color: 'var(--fg-2)',
              background: 'var(--bg-2)',
              maxHeight: 300,
              overflowY: 'auto',
              borderBottom: '1px solid var(--border)',
            }}>
              {shownLines.map((line, idx) => (
                <div key={idx} style={{ display: 'flex' }}>
                  <span style={{ 
                    width: 24, 
                    textAlign: 'right', 
                    paddingRight: 8, 
                    color: 'var(--muted-2)', 
                    userSelect: 'none',
                    opacity: 0.5,
                    flexShrink: 0,
                  }}>{idx + 1}</span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>{line || '\u00A0'}</span>
                </div>
              ))}
            </pre>
            )}
            {capReached && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 12px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
                borderBottom: '1px solid var(--border)',
              }}>
                <span>已显示前 {PREVIEW_LINE_CAP} 行 / 共 {totalLines} 行</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
                  style={{
                    fontSize: 'var(--fs-micro)', color: 'var(--accent)', background: 'transparent',
                    border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >显示全部</button>
              </div>
            )}
            <div style={{
              display: 'flex', gap: 3, padding: '4px 8px',
              background: 'var(--panel)',
            }}>
              <ActionButton onClick={handleOpen} icon="📝" label="编辑器" />
              <ActionButton onClick={handleLocate} icon="📂" label="定位" />
              <ActionButton onClick={handleCopy} icon="📋" label="复制" />
              <ActionButton onClick={handleDownload} icon="⬇" label="下载" />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── write/edit/batch 模式: 折叠内容预览 + 编辑高亮 ───
  const allLines = content ? content.split('\n') : [];
  const totalLines = allLines.length;
  // 同 read 模式: 超过上限先渲染前 N 行, 避免超大文件把页面卡死
  const shownLines = showAll ? allLines : allLines.slice(0, PREVIEW_LINE_CAP);
  // diff 分支渲染的是 DiffPreviewLines, 不受 shownLines 影响 → 只有纯文本分支才提示截断
  const isDiffMode = oldContent != null && oldContent !== content;
  const capReached = !showAll && !isDiffMode && totalLines > PREVIEW_LINE_CAP;

  return (
    <div
      style={{
        margin: '3px 0', borderRadius: 8, overflow: 'hidden',
        background: 'var(--card)',
        border: `1px solid ${ok === false ? 'var(--danger)' : 'var(--border)'}`,
        boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = ok === false ? 'var(--danger)' : 'var(--border)'; }}
    >
      {/* Header — 始终可见 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', cursor: 'default',
        }}
      >
        {/* 语言徽标 */}
        <div style={{
          width: 24, height: 24, borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: color, color: '#fff',
          fontSize: 'var(--fs-micro)', fontWeight: 700,
          flexShrink: 0,
        }}>{icon}</div>

        {/* 文件名 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--fg)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{filename}</div>
          {dir && (
            <div style={{
              fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{dir}</div>
          )}
        </div>

        {/* 操作徽标 */}
        <span style={{
          fontSize: 'var(--fs-micro)', fontWeight: 700,
          padding: '1px 5px', borderRadius: 3,
          background: opMeta.bg, color: opMeta.color,
          whiteSpace: 'nowrap',
        }}>{opMeta.icon} {opMeta.label}</span>

        {/* 改动统计 */}
        {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
          <span style={{
            fontSize: 'var(--fs-micro)', fontFamily: 'monospace',
            display: 'inline-flex', gap: 3,
          }}>
            {diffStats.added > 0 && <span style={{ color: 'var(--success)' }}>+{diffStats.added}</span>}
            {diffStats.removed > 0 && <span style={{ color: 'var(--danger)' }}>-{diffStats.removed}</span>}
          </span>
        )}

        {/* 状态 */}
        {ok === false && (
          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--danger)' }}>✗</span>
        )}

        {/* 展开/收起按钮 — 只在 write/edit 模式显示 */}
        {content && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              fontSize: 'var(--fs-micro)', color: 'var(--accent)', background: 'transparent',
              border: 'none', cursor: 'pointer', padding: '0 4px', flexShrink: 0,
            }}
          >
            {expanded ? '收起 ▲' : '查看详情 ▼'}
          </button>
        )}
      </div>

      {/* 元信息行 (默认) */}
      {!expanded && (size != null || content) && (
        <div style={{
          padding: '0 10px 5px 42px',
          display: 'flex', gap: 8, fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
        }}>
          {size != null && <span>{formatBytes(size)}</span>}
          {totalLines > 0 && <span>{totalLines} 行</span>}
          <span>{lang}</span>
        </div>
      )}

      {/* 展开时: 内容预览 + 操作按钮 (edit 模式走行级 diff) */}
      {expanded && content && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {isDiffMode ? (
            /* 行级 diff 渲染 (edit 模式, 有旧内容) */
            <DiffPreviewLines oldContent={oldContent!} newContent={content} />
          ) : (
            /* 纯文本预览 (create 模式或 read) */
            <pre style={{
              margin: 0, padding: '8px 12px',
              fontSize: 'var(--fs-micro)', lineHeight: 1.4,
              fontFamily: "'Consolas', monospace",
              color: 'var(--fg-2)',
              background: 'var(--bg-2)',
              maxHeight: 300,
              overflowY: 'auto',
              borderBottom: '1px solid var(--border)',
            }}>
              {shownLines.map((line, idx) => (
                <div key={idx} style={{ 
                  display: 'flex',
                  minHeight: '1.4em',
                }}>
                  <span style={{ 
                    width: 24, 
                    textAlign: 'right', 
                    paddingRight: 8, 
                    color: 'var(--muted-2)', 
                    userSelect: 'none',
                    opacity: 0.5,
                    flexShrink: 0,
                    borderRight: '1px solid var(--border)',
                    marginRight: 8,
                  }}>{idx + 1}</span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1 }}>
                    {line || '\u00A0'}
                  </span>
                </div>
              ))}
            </pre>
          )}

          {capReached && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '4px 12px', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span>已显示前 {PREVIEW_LINE_CAP} 行 / 共 {totalLines} 行</span>
              <button
                onClick={(e) => { e.stopPropagation(); setShowAll(true); }}
                style={{
                  fontSize: 'var(--fs-micro)', color: 'var(--accent)', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: 0,
                }}
              >显示全部</button>
            </div>
          )}
          
          {/* 编辑统计信息 */}
          {editStats && (
            <div style={{
              padding: '4px 12px',
              fontSize: 'var(--fs-micro)',
              color: 'var(--muted-2)',
              display: 'flex',
              gap: 12,
              borderBottom: '1px solid var(--border)',
            }}>
              <span>原始: {editStats.total} 行</span>
              <span style={{ color: 'var(--success)' }}>+{editStats.added} 新增</span>
              <span style={{ color: 'var(--danger)' }}>-{editStats.removed} 删除</span>
            </div>
          )}
          
          <div style={{
            display: 'flex', gap: 3, padding: '4px 8px',
            background: 'var(--panel)',
          }}>
            <ActionButton onClick={handleOpen} icon="📝" label="编辑器" />
            <ActionButton onClick={handleLocate} icon="📂" label="定位" />
            <ActionButton onClick={handleCopy} icon="📋" label="复制" />
            <ActionButton onClick={handleDownload} icon="⬇" label="下载" />
            {path.toLowerCase().endsWith('.html') || path.toLowerCase().endsWith('.htm') ? (
              <ActionButton 
                onClick={(e) => {
                  e.stopPropagation();
                  window.dispatchEvent(new CustomEvent('agentai:preview-html', { detail: { path } }));
                }} 
                icon="🌐" 
                label="预览" 
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

/** 小按钮组件 */
function ActionButton({ onClick, icon, label }: {
  onClick: (e: React.MouseEvent) => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        padding: '2px 6px', borderRadius: 3, fontSize: 'var(--fs-micro)',
        color: 'var(--fg-2)', background: 'transparent',
        border: '1px solid var(--border)', cursor: 'pointer',
        transition: 'all 0.1s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; }}
    >
      <span>{icon}</span> {label}
    </button>
  );
}

/**
 * 工具 segments → FileCard 列表 (精简折叠版)
 *
 * 设计原则:
 *   - 写入/修改文件优先显示
 *   - read_file 文件排在后面 (用户不需要看读取的内容)
 *   - 默认全部折叠, 保持对话干净 (参考 ZCode 整洁风格)
 */
export const FilesFromToolSegment: React.FC<{
  segments: Array<{
    name: string;
    args?: any;
    result?: any;
    ok?: boolean;
  }>;
  onOpen?: (path: string) => void;
}> = ({ segments, onOpen }) => {
  const [collapsed, setCollapsed] = useState(true); // 默认折叠
  const writeCards: React.ReactNode[] = [];
  const readCards: React.ReactNode[] = [];

  for (const seg of segments) {
    const n = (seg.name || '').toLowerCase();
    const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
    const result = typeof seg.result === 'string' ? safeJson(seg.result) : seg.result;

    // write_file / create_file
    if (n === 'write_file' || n === 'create_file') {
      const path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      if (path) {
        const content = typeof args?.content === 'string' ? args.content : '';
        writeCards.push(
          <FileCard
            key={`${path}-w`}
            op="create"
            path={path}
            content={content}
            ok={seg.ok}
            diffStats={{ added: content.split('\n').length, removed: 0 }}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
    // edit_file / patch_file
    else if (n === 'edit_file' || n === 'patch_file' || n === 'str_replace' || n === 'multi_edit') {
      const path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      if (path) {
        // 从 result.data 提取 oldContent (后端 write_file/multi_edit 新增返回)
        const resultData = result?.data || {};
        const data = typeof resultData === 'string' ? safeJson(resultData) : resultData;
        const oldContent = data?.oldContent || undefined;
        const newContent = data?.newContent || (typeof result?.content === 'string' ? result.content : undefined);
        // multi_edit: edits 数组情况下用第一项的 oldContent
        const editFromData = data?.edits?.[0];
        const resolvedOld = oldContent || editFromData?.oldContent || undefined;
        const resolvedNew = newContent || editFromData?.newContent || undefined;
        // 计算 diffStats
        const oldLines = resolvedOld ? resolvedOld.split('\n').length : 0;
        const newLines = resolvedNew ? resolvedNew.split('\n').length : 0;
        const added = Math.max(0, newLines - oldLines);
        const removed = Math.max(0, oldLines - newLines);
        writeCards.push(
          <FileCard
            key={`${path}-e`}
            op="edit"
            path={path}
            content={resolvedNew}
            oldContent={resolvedOld}
            ok={seg.ok}
            diffStats={{ added, removed }}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
    // read_file / view_file
    else if (n === 'read_file' || n === 'view_file' || n === 'cat_file') {
      const path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      if (path) {
        readCards.push(
          <FileCard
            key={`${path}-r`}
            op="read"
            path={path}
            ok={seg.ok}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
  }

  const allCards = [...writeCards, ...readCards];
  if (allCards.length === 0) return null;

  // 统计信息
  const writeCount = writeCards.length;
  const readCount = readCards.length;
  const summaryParts: string[] = [];
  if (writeCount > 0) summaryParts.push(`${writeCount} 个文件变更`);
  if (readCount > 0) summaryParts.push(`${readCount} 个文件读取`);
  const summary = summaryParts.join(' · ');

  // 折叠态: 只显示一行摘要
  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          margin: '4px 0', padding: '6px 10px', borderRadius: 6,
          background: 'var(--panel)', border: '1px dashed var(--border)',
          cursor: 'pointer', userSelect: 'none',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 'var(--tool-font-size, 11px)', color: 'var(--muted)',
        }}
      >
        <FileTextOutlined style={{ color: 'var(--accent)', fontSize: 'var(--fs-micro)' }} />
        <span>{summary}</span>
        <span style={{ fontSize: 'var(--fs-micro)', opacity: 0.5 }}>点击展开</span>
      </div>
    );
  }

  // 展开态: 显示所有文件卡片 + 收起按钮
  return (
    <div style={{ marginTop: 4 }}>
      {/* 收起按钮 */}
      <div
        onClick={() => setCollapsed(true)}
        style={{
          fontSize: 'var(--fs-micro)', color: 'var(--accent)', cursor: 'pointer',
          padding: '4px 8px', userSelect: 'none', marginBottom: 2,
        }}
      >
        ▲ 收起文件列表
      </div>
      {allCards}
    </div>
  );
};

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * 行级 diff 渲染 (绿色=新增, 红色=删除, 灰色=上下文)
 * 用于 edit 模式展开时替代纯文本预览
 */
const DiffPreviewLines: React.FC<{ oldContent: string; newContent: string }> = ({ oldContent, newContent }) => {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const rows: React.ReactNode[] = [];

  // 简易 LCS diff: 逐行比较
  let li = 0, ni = 0;
  while (li < oldLines.length || ni < newLines.length) {
    const ol = li < oldLines.length ? oldLines[li] : null;
    const nl = ni < newLines.length ? newLines[ni] : null;

    if (ol === nl) {
      rows.push(
        <div key={`ctx-${li}`} style={{ display: 'flex', minHeight: 18, fontSize: 'var(--fs-micro)', lineHeight: '18px', fontFamily: "'Consolas', monospace" }}>
          <span style={{ width: 28, textAlign: 'right', paddingRight: 4, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none' }}>{li + 1}</span>
          <span style={{ width: 28, textAlign: 'right', paddingRight: 6, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none', borderRight: '1px solid var(--border)' }}>{ni + 1}</span>
          <span style={{ flex: 1, paddingLeft: 6, whiteSpace: 'pre', overflow: 'hidden', color: 'var(--fg-2)' }}>{ol}</span>
        </div>
      );
      li++; ni++;
    } else {
      // 有差异: 显示被删行
      if (ol !== null) {
        rows.push(
          <div key={`del-${li}`} style={{ display: 'flex', minHeight: 18, fontSize: 'var(--fs-micro)', lineHeight: '18px', fontFamily: "'Consolas', monospace", background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444' }}>
            <span style={{ width: 28, textAlign: 'right', paddingRight: 4, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none' }}>{li + 1}</span>
            <span style={{ width: 28, textAlign: 'right', paddingRight: 6, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none', borderRight: '1px solid var(--border)' }}></span>
            <span style={{ flex: 1, paddingLeft: 6, whiteSpace: 'pre', overflow: 'hidden', color: '#dc2626' }}>- {ol}</span>
          </div>
        );
        li++;
      }
      // 显示新增行
      if (nl !== null) {
        rows.push(
          <div key={`add-${ni}`} style={{ display: 'flex', minHeight: 18, fontSize: 'var(--fs-micro)', lineHeight: '18px', fontFamily: "'Consolas', monospace", background: 'rgba(34,197,94,0.08)', borderLeft: '3px solid #22c55e' }}>
            <span style={{ width: 28, textAlign: 'right', paddingRight: 4, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none' }}></span>
            <span style={{ width: 28, textAlign: 'right', paddingRight: 6, fontSize: 'var(--fs-micro)', color: '#999', userSelect: 'none', borderRight: '1px solid var(--border)' }}>{ni + 1}</span>
            <span style={{ flex: 1, paddingLeft: 6, whiteSpace: 'pre', overflow: 'hidden', color: '#16a34a' }}>+ {nl}</span>
          </div>
        );
        ni++;
      }
    }
  }

  return (
    <div style={{ maxHeight: 240, overflow: 'auto', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)' }}>
      {rows}
    </div>
  );
};

export default FileCard;
