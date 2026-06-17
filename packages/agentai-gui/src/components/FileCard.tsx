/**
 * FileCard — AI 文件操作卡片
 * ----------------------------------------------------
 * 适用场景:
 *   - write_file / edit_file  (AI 创建/修改文件)
 *   - read_file              (AI 读取文件)
 *   - 多文件批量生成
 *
 * 显示要素:
 *   - 文件名 + 相对路径
 *   - 操作类型徽标 (新建/修改/读取/批量)
 *   - 语言图标 (按扩展名)
 *   - 行数 / 大小 / 改动统计 (+12 -3)
 *   - 代码预览 (最多 8 行)
 *   - 快捷操作: 在编辑器打开 / 复制 / 在文件树定位
 */
import React, { useState } from 'react';
import { Tooltip, message as antdMsg } from 'antd';

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

export type FileOp = 'create' | 'edit' | 'read' | 'delete' | 'batch';

export interface FileCardProps {
  /** 操作类型 */
  op: FileOp;
  /** 文件绝对或相对路径 */
  path: string;
  /** 文件内容 (用于预览; 过长会被截断) */
  content?: string;
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

export const FileCard: React.FC<FileCardProps> = ({
  op, path, content, size, diffStats, batchCount, ok, onOpenInEditor, onLocateInTree,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { icon, color, lang } = getLangMeta(path);
  const opMeta = OP_META[op];

  const filename = path.split(/[\\/]/).pop() || path;
  const dir = path.slice(0, path.length - filename.length);

  // 内容预览: 8 行截断
  const previewLines = content ? content.split('\n').slice(0, 8) : [];
  const totalLines = content ? content.split('\n').length : 0;
  const truncated = totalLines > 8;

  // 从 window 拿默认 handler (与 ChatView 一致)
  const getAppStore = () => (window as any).__agentai_app_store__;

  const handleOpen = () => {
    if (onOpenInEditor) {
      onOpenInEditor(path);
    } else {
      try {
        const store = getAppStore();
        store?.getState?.()?.setView?.('editor');
        antdMsg.info(`已切换到编辑器: ${filename}`);
      } catch {
        antdMsg.info(`打开文件: ${path}`);
      }
    }
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      antdMsg.success('已复制文件内容');
    });
  };

  const handleLocate = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onLocateInTree) {
      onLocateInTree(path);
    } else {
      const store = getAppStore();
      store?.getState?.()?.setView?.('editor');
      antdMsg.info(`定位到: ${path}`);
    }
  };

  return (
    <div
      className="bubble-enter"
      style={{
        margin: '6px 0', borderRadius: 10, overflow: 'hidden',
        background: 'var(--card)',
        border: `1px solid ${ok === false ? 'var(--danger)' : 'var(--border)'}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = ok === false ? 'var(--danger)' : 'var(--border)'; }}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        {/* 语言徽标 */}
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: color, color: '#fff',
          fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
          flexShrink: 0,
          boxShadow: `0 1px 4px ${color}40`,
        }}>
          {icon}
        </div>

        {/* 文件名 + 路径 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, color: 'var(--fg)',
          }}>
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{filename}</span>
            {batchCount && batchCount > 1 && (
              <span style={{
                fontSize: 9, color: 'var(--muted)',
                background: 'var(--bg-2)', padding: '0 5px', borderRadius: 3,
              }}>+{batchCount - 1}</span>
            )}
          </div>
          {dir && (
            <div style={{
              fontSize: 10, color: 'var(--muted-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontFamily: 'monospace',
            }}>
              {dir}
            </div>
          )}
        </div>

        {/* 操作徽标 */}
        <span style={{
          fontSize: 9, fontWeight: 700,
          padding: '2px 7px', borderRadius: 4,
          background: opMeta.bg, color: opMeta.color,
          whiteSpace: 'nowrap',
        }}>
          {opMeta.icon} {opMeta.label}
        </span>

        {/* 状态 */}
        {ok === false && (
          <span style={{ fontSize: 10, color: 'var(--danger)' }}>✗ 失败</span>
        )}

        {/* 改动统计 */}
        {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
          <span style={{
            fontSize: 10, fontFamily: 'monospace',
            display: 'inline-flex', gap: 4,
          }}>
            {diffStats.added > 0 && <span style={{ color: 'var(--success)' }}>+{diffStats.added}</span>}
            {diffStats.removed > 0 && <span style={{ color: 'var(--danger)' }}>-{diffStats.removed}</span>}
          </span>
        )}

        {/* 展开箭头 */}
        <span style={{
          fontSize: 9, color: 'var(--muted-2)',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
      </div>

      {/* 折叠时: 元信息行 */}
      {!expanded && (size != null || content) && (
        <div style={{
          padding: '0 12px 8px 48px',
          display: 'flex', gap: 10, fontSize: 10, color: 'var(--muted-2)',
        }}>
          {size != null && <span>{formatBytes(size)}</span>}
          {totalLines > 0 && <span>{totalLines} 行</span>}
          <span style={{ color: 'var(--muted)' }}>{lang}</span>
        </div>
      )}

      {/* 展开时: 代码预览 + 操作按钮 */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          animation: 'msgSlideIn 0.2s ease',
        }}>
          {/* 代码预览 */}
          {content && (
            <pre style={{
              margin: 0, padding: '10px 14px',
              fontSize: 11, lineHeight: 1.5,
              fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
              color: 'var(--fg-2)',
              background: 'var(--bg-2)',
              maxHeight: 240, overflowY: 'auto',
              borderBottom: '1px solid var(--border)',
            }}>
              {previewLines.join('\n')}
              {truncated && (
                <span style={{ color: 'var(--muted-2)', display: 'block', marginTop: 4 }}>
                  ... 还有 {totalLines - 8} 行 (在编辑器中查看完整内容)
                </span>
              )}
            </pre>
          )}

          {/* 操作按钮 */}
          <div style={{
            display: 'flex', gap: 4, padding: '6px 10px',
            background: 'var(--panel)',
          }}>
            <Tooltip title="在编辑器中打开">
              <button
                onClick={handleOpen}
                style={actionBtnStyle}
              >
                <span>📝</span> 打开
              </button>
            </Tooltip>
            <Tooltip title="在文件树定位">
              <button
                onClick={handleLocate}
                style={actionBtnStyle}
              >
                <span>📂</span> 定位
              </button>
            </Tooltip>
            {content && (
              <Tooltip title="复制文件内容">
                <button onClick={handleCopy} style={actionBtnStyle}>
                  <span>📋</span> 复制
                </button>
              </Tooltip>
            )}
            <div style={{ flex: 1 }} />
            {size != null && (
              <span style={{ fontSize: 10, color: 'var(--muted-2)', alignSelf: 'center' }}>
                {formatBytes(size)} · {totalLines} 行
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const actionBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 3,
  padding: '3px 8px', borderRadius: 4, fontSize: 11,
  color: 'var(--fg-2)', background: 'transparent',
  border: '1px solid var(--border)', cursor: 'pointer',
  transition: 'all 0.12s',
};

/** 工具 segments → FileCard 列表
 *  解析 tool 的 args.result, 识别 write_file/edit_file/read_file 等
 */
export interface FileCardFromToolOpts {
  /** 是否在 onClick 时跳到该消息 */
  onOpen?: (path: string) => void;
}

export const FilesFromToolSegment: React.FC<{
  segments: Array<{
    name: string;
    args?: any;
    result?: any;
    ok?: boolean;
  }>;
  onOpen?: (path: string) => void;
}> = ({ segments, onOpen }) => {
  const cards: React.ReactNode[] = [];

  for (const seg of segments) {
    const n = (seg.name || '').toLowerCase();
    const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
    const result = typeof seg.result === 'string' ? safeJson(seg.result) : seg.result;

    // write_file / create_file
    if (n === 'write_file' || n === 'create_file') {
      const path = args?.path || args?.filePath || args?.file || '';
      if (path) {
        cards.push(
          <FileCard
            key={`${path}-w`}
            op="create"
            path={path}
            content={typeof args?.content === 'string' ? args.content : ''}
            ok={seg.ok}
            diffStats={{ added: (args?.content || '').split('\n').length, removed: 0 }}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
    // edit_file / patch_file
    else if (n === 'edit_file' || n === 'patch_file' || n === 'str_replace') {
      const path = args?.path || args?.filePath || args?.file || '';
      if (path) {
        cards.push(
          <FileCard
            key={`${path}-e`}
            op="edit"
            path={path}
            content={typeof result?.content === 'string' ? result.content : undefined}
            ok={seg.ok}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
    // read_file / view_file
    else if (n === 'read_file' || n === 'view_file' || n === 'cat_file') {
      const path = args?.path || args?.filePath || args?.file || '';
      if (path) {
        cards.push(
          <FileCard
            key={`${path}-r`}
            op="read"
            path={path}
            content={typeof result?.content === 'string' ? result.content : undefined}
            ok={seg.ok}
            onOpenInEditor={onOpen}
          />
        );
      }
    }
  }

  if (cards.length === 0) return null;
  return <>{cards}</>;
};

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

export default FileCard;
