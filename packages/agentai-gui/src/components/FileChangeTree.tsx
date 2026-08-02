/**
 * FileChangeTree — AI 文件变更聚合树 (折叠/展开)
 * ----------------------------------------------------
 * 放在 AI 回复顶部，让开发者一眼看清本轮改了哪些文件。
 * 聚合逻辑与 FilesFromToolSegment 一致，但展示为紧凑摘要条。
 */
import React, { useState, useMemo } from 'react';
import { CaretRightOutlined } from '@ant-design/icons';

/* ========== 类型 ========== */

interface FileEntry {
  path: string;
  op: 'create' | 'edit' | 'read' | 'delete';
  added: number;
  removed: number;
  ok?: boolean;
}

interface FileChangeTreeProps {
  segments: Array<{
    name: string;
    args?: any;
    result?: any;
    ok?: boolean;
  }>;
  onOpen?: (path: string) => void;
}

/* ========== 元数据 ========== */

const OP_META: Record<string, { label: string; color: string; bg: string }> = {
  create: { label: '新建', color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  edit:   { label: '修改', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  read:   { label: '读取', color: '#6366F1', bg: 'rgba(99,102,241,0.12)' },
  delete: { label: '删除', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
};

/* ========== 工具函数 ========== */

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * 操作优先级: delete > create > edit > read
 * 同一文件多次出现时，较高优先级的操作覆盖较低的
 */
const OP_PRIORITY: Record<string, number> = {
  delete: 4,
  create: 3,
  edit: 2,
  read: 1,
};

/** 从 segment 列表提取文件操作列表，按优先级去重 */
function extractFiles(segments: FileChangeTreeProps['segments']): FileEntry[] {
  const fileMap = new Map<string, FileEntry>();

  for (const seg of segments) {
    const n = (seg.name || '').toLowerCase();
    const args = typeof seg.args === 'string' ? safeJson(seg.args) : seg.args;
    const result = typeof seg.result === 'string' ? safeJson(seg.result) : seg.result;

    let path = '',
        op: FileEntry['op'] = 'read',
        added = 0,
        removed = 0;

    if (n === 'write_file' || n === 'create_file') {
      path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      op = 'create';
      const content = typeof args?.content === 'string' ? args.content : '';
      added = content ? content.split('\n').length : 0;
    } else if (n === 'edit_file' || n === 'patch_file' || n === 'str_replace' || n === 'multi_edit') {
      path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      op = 'edit';
      const resultData = result?.data || {};
      const data = typeof resultData === 'string' ? safeJson(resultData) : resultData;
      const oldContent = data?.oldContent;
      const newContent = data?.newContent || (typeof result?.content === 'string' ? result.content : undefined);
      const editFromData = data?.edits?.[0];
      const resolvedOld = oldContent || editFromData?.oldContent;
      const resolvedNew = newContent || editFromData?.newContent;
      const oldLines = resolvedOld ? resolvedOld.split('\n').length : 0;
      const newLines = resolvedNew ? resolvedNew.split('\n').length : 0;
      added = Math.max(0, newLines - oldLines);
      removed = Math.max(0, oldLines - newLines);
    } else if (n === 'read_file' || n === 'view_file' || n === 'cat_file') {
      path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      op = 'read';
    } else if (n === 'delete_file' || n === 'remove_file') {
      path = args?.path || args?.filePath || args?.file || args?.file_path || '';
      op = 'delete';
    }

    if (!path) continue;

    const existing = fileMap.get(path);
    const newP = OP_PRIORITY[op] || 0;

    if (!existing || newP >= (OP_PRIORITY[existing.op] || 0)) {
      fileMap.set(path, { path, op, added, removed, ok: seg.ok });
    }
  }

  // 排序：先写/删后读，文件内保持顺序
  return Array.from(fileMap.values()).sort((a, b) => {
    const pa = OP_PRIORITY[a.op] || 0;
    const pb = OP_PRIORITY[b.op] || 0;
    return pb - pa; // 降序：delete > create > edit > read
  });
}

/** 截短路径：去掉项目根前缀，只保留相对部分 */
function shortenPath(p: string): string {
  // 统一分隔符
  const normalized = p.replace(/\\/g, '/');
  // 尝试去掉常见的项目根前缀
  const markers = [
    'agentai-platform/',
    'agentai-gateway/',
    'agentai-gui/',
    'agentai-core/',
    'agentai-desktop/',
    'agentai-qqbot/',
    'agentai-vscode/',
    'agentai-skills/',
  ];
  for (const m of markers) {
    const idx = normalized.indexOf(m);
    if (idx !== -1) {
      return normalized.slice(idx);
    }
  }
  // fallback: 只取文件名
  const parts = normalized.split('/');
  return parts.slice(-2).join('/');
}

/* ========== 主组件 ========== */

const FileChangeTree: React.FC<FileChangeTreeProps> = ({ segments, onOpen }) => {
  const [expanded, setExpanded] = useState(false);
  const files = useMemo(() => extractFiles(segments), [segments]);

  if (files.length === 0) return null;

  const createCount = files.filter(f => f.op === 'create').length;
  const editCount = files.filter(f => f.op === 'edit').length;
  const readCount = files.filter(f => f.op === 'read').length;
  const deleteCount = files.filter(f => f.op === 'delete').length;

  const totalAdded = files.reduce((s, f) => s + f.added, 0);
  const totalRemoved = files.reduce((s, f) => s + f.removed, 0);

  // 构建摘要文字
  const summaryParts: string[] = [];
  if (editCount) summaryParts.push(`修改 ${editCount}`);
  if (createCount) summaryParts.push(`新建 ${createCount}`);
  if (deleteCount) summaryParts.push(`删除 ${deleteCount}`);
  if (readCount) summaryParts.push(`读取 ${readCount}`);

  return (
    <div style={{
      margin: '0 0 6px',
      borderRadius: 6,
      border: '1px solid var(--border)',
      overflow: 'hidden',
    }}>
      {/* ===== 折叠状态 ===== */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          cursor: 'pointer',
          background: 'var(--bg-2)',
          userSelect: 'none',
          fontSize: 11,
        }}
      >
        {/* 文件图标 */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" style={{ color: 'var(--muted-2)' }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>

        {/* 摘要: 修改/新建/删除 各多少个文件 */}
        <span style={{ fontWeight: 500, color: 'var(--fg-2)' }}>
          {summaryParts.join(' · ')}
        </span>

        {/* 行级统计 */}
        {totalAdded > 0 && (
          <span style={{ color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>
            +{totalAdded}
          </span>
        )}
        {totalRemoved > 0 && (
          <span style={{ color: '#EF4444', fontWeight: 600, fontFamily: 'monospace' }}>
            -{totalRemoved}
          </span>
        )}

        {/* 展开箭头 */}
        <span style={{
          marginLeft: 'auto',
          color: 'var(--muted-2)',
          transition: 'transform 0.2s',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          display: 'inline-flex',
          alignItems: 'center',
        }}>
          <CaretRightOutlined style={{ fontSize: 9 }} />
        </span>
      </div>

      {/* ===== 展开态：文件列表 ===== */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '3px 0' }}>
          {files.map((f, i) => {
            const meta = OP_META[f.op] || OP_META.read;
            return (
              <div
                key={f.path}
                onClick={() => onOpen?.(f.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 8px',
                  fontSize: 11,
                  cursor: onOpen ? 'pointer' : undefined,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {/* 操作标签 */}
                <span style={{
                  display: 'inline-block',
                  padding: '0 4px',
                  borderRadius: 3,
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: '16px',
                  color: meta.color,
                  background: meta.bg,
                  minWidth: 24,
                  textAlign: 'center',
                  flexShrink: 0,
                }}>
                  {meta.label}
                </span>

                {/* 文件路径 */}
                <span style={{
                  color: 'var(--fg)',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'monospace',
                }}>
                  {shortenPath(f.path)}
                </span>

                {/* diff 统计 */}
                {f.added > 0 && (
                  <span style={{ color: '#10B981', fontFamily: 'monospace', flexShrink: 0 }}>
                    +{f.added}
                  </span>
                )}
                {f.removed > 0 && (
                  <span style={{ color: '#EF4444', fontFamily: 'monospace', flexShrink: 0 }}>
                    -{f.removed}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FileChangeTree;
