/**
 * FileCard — AI 文件操作卡片 (精简折叠版)
 * ----------------------------------------------------
 * 核心设计:
 *   - read_file: 只显示文件名 + 语言 + 大小，不显示内容 (纯导航)
 *   - write/edit: 折叠内容预览，只显示文件名 + 变更统计
 *   - 全部默认折叠，不占聊天篇幅
 *   - 点击 "打开" 才真正跳转编辑器
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

/**
 * 单个文件卡片 — 精简折叠版
 * 设计原则:
 *   - read: 只显示文件名，内容不可见 (不需要看)
 *   - write/edit: 显示文件名 + 变更数 + "查看详情" 展开/收起
 *   - 默认全部折叠，保持对话干净
 */
export const FileCard: React.FC<FileCardProps> = ({
  op, path, content, size, diffStats, batchCount, ok, onOpenInEditor, onLocateInTree,
}) => {
  const [expanded, setExpanded] = useState(false);
  const { icon, color, lang } = getLangMeta(path);
  const opMeta = OP_META[op];

  const filename = path.split(/[\\/]/).pop() || path;
  const dir = path.slice(0, path.length - filename.length);

  // ═══ 通用 handler (定义在 return 前, 避免 read 模式提前 return 后找不到) ═══
  const handleOpen = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (onOpenInEditor) {
      onOpenInEditor(path);
    } else {
      try {
        const store = (window as any).__agentai_app_store__;
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
      const store = (window as any).__agentai_app_store__;
      store?.getState?.()?.setView?.('editor');
      antdMsg.info(`定位到: ${path}`);
    }
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

  // ─── read 模式: 纯导航卡片 ───
  // 只显示文件名 + 语言徽标 + 大小，无任何内容预览
  if (op === 'read') {
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
          onClick={handleOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', cursor: 'pointer',
          }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color, color: '#fff',
            fontSize: 8, fontWeight: 700,
            flexShrink: 0,
          }}>{icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 600, color: 'var(--fg)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{filename}</div>
            {dir && (
              <div style={{
                fontSize: 9, color: 'var(--muted-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{dir}</div>
            )}
          </div>
          {size != null && (
            <span style={{ fontSize: 9, color: 'var(--muted-2)', flexShrink: 0 }}>{formatBytes(size)}</span>
          )}
          <span style={{
            fontSize: 8, padding: '1px 5px', borderRadius: 3,
            background: opMeta.bg, color: opMeta.color, flexShrink: 0,
          }}>{opMeta.icon} 已读取</span>
        </div>
      </div>
    );
  }

  // ─── write/edit/batch 模式: 折叠内容预览 ───
  const previewLines = content ? content.split('\n').slice(0, 6) : [];
  const totalLines = content ? content.split('\n').length : 0;
  const truncated = totalLines > 6;

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
          fontSize: 8, fontWeight: 700,
          flexShrink: 0,
        }}>{icon}</div>

        {/* 文件名 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--fg)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{filename}</div>
          {dir && (
            <div style={{
              fontSize: 9, color: 'var(--muted-2)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{dir}</div>
          )}
        </div>

        {/* 操作徽标 */}
        <span style={{
          fontSize: 8, fontWeight: 700,
          padding: '1px 5px', borderRadius: 3,
          background: opMeta.bg, color: opMeta.color,
          whiteSpace: 'nowrap',
        }}>{opMeta.icon} {opMeta.label}</span>

        {/* 改动统计 */}
        {diffStats && (diffStats.added > 0 || diffStats.removed > 0) && (
          <span style={{
            fontSize: 10, fontFamily: 'monospace',
            display: 'inline-flex', gap: 3,
          }}>
            {diffStats.added > 0 && <span style={{ color: 'var(--success)' }}>+{diffStats.added}</span>}
            {diffStats.removed > 0 && <span style={{ color: 'var(--danger)' }}>-{diffStats.removed}</span>}
          </span>
        )}

        {/* 状态 */}
        {ok === false && (
          <span style={{ fontSize: 9, color: 'var(--danger)' }}>✗</span>
        )}

        {/* 展开/收起按钮 — 只在 write/edit 模式显示 */}
        {content && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{
              fontSize: 9, color: 'var(--accent)', background: 'transparent',
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
          display: 'flex', gap: 8, fontSize: 9, color: 'var(--muted-2)',
        }}>
          {size != null && <span>{formatBytes(size)}</span>}
          {totalLines > 0 && <span>{totalLines} 行</span>}
          <span>{lang}</span>
        </div>
      )}

      {/* 展开时: 内容预览 + 操作按钮 */}
      {expanded && content && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <pre style={{
            margin: 0, padding: '8px 12px',
            fontSize: 10, lineHeight: 1.4,
            fontFamily: "'Consolas', monospace",
            color: 'var(--fg-2)',
            background: 'var(--bg-2)',
            maxHeight: 180, overflowY: 'auto',
            borderBottom: '1px solid var(--border)',
          }}>
            {previewLines.join('\n')}
            {truncated && (
              <span style={{ color: 'var(--muted-2)', display: 'block', marginTop: 3 }}>
                ... 共 {totalLines} 行, 在编辑器查看完整内容
              </span>
            )}
          </pre>
          <div style={{
            display: 'flex', gap: 3, padding: '4px 8px',
            background: 'var(--panel)',
          }}>
            <ActionButton onClick={handleOpen} icon="📝" label="打开" />
            <ActionButton onClick={handleLocate} icon="📂" label="定位" />
            <ActionButton onClick={handleCopy} icon="📋" label="复制" />
            <ActionButton onClick={handleDownload} icon="⬇" label="下载" />
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
        padding: '2px 6px', borderRadius: 3, fontSize: 10,
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
 *   - 全部默认折叠, 保持对话干净
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
  const writeCards: React.ReactNode[] = [];
  const readCards: React.ReactNode[] = [];

  for (const seg of segments) {
    const n = (seg.name || '').toLowerCase();
    const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
    const result = typeof seg.result === 'string' ? safeJson(seg.result) : seg.result;

    // write_file / create_file
    if (n === 'write_file' || n === 'create_file') {
      const path = args?.path || args?.filePath || args?.file || '';
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
    else if (n === 'edit_file' || n === 'patch_file' || n === 'str_replace') {
      const path = args?.path || args?.filePath || args?.file || '';
      if (path) {
        writeCards.push(
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

  return <div style={{ marginTop: 4 }}>{allCards}</div>;
};

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

export default FileCard;
