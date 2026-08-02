/**
 * DiffViewer — 增强版代码差异查看器
 * ----------------------------------------------------
 * 功能:
 *   - 行号列 (old/new 两侧对齐)
 *   - 颜色编码 (绿底=新增, 红底=删除, 灰底=上下文)
 *   - 逐行左右对比 (hunk 内保持 alignment)
 *   - 折叠摘要: 文件名 + (+N / -M) + 展开按钮
 *   - 操作栏: 完整文件查看、复制 diff、在编辑器中打开
 *   - 语法高亮 (通过语言标签)
 *   - 编辑统计信息 (新增/删除/修改行数)
 *   - 实时高亮当前编辑行
 */
import React, { useState, useMemo } from 'react';
import { Tooltip } from 'antd';
import { CheckOutlined, CloseOutlined, FileTextOutlined, DownOutlined, RightOutlined, CodeOutlined, CopyOutlined, FolderOpenOutlined, EditOutlined, PlusOutlined, MinusOutlined } from '@ant-design/icons';

interface DiffViewerProps {
  diffText?: string;          // unified diff 文本 (可选, 与 oldContent/newContent 二选一)
  filePath?: string;         // 文件路径 (可选, 可从 diff header 解析)
  oldContent?: string;       // 旧内容 (备选, 用于 old/new 格式)
  newContent?: string;       // 新内容 (备选, 用于 old/new 格式)
  previewId?: string;        // 审批 ID
  onApply?: (previewId: string) => void;
  onReject?: (previewId: string) => void;
  onClose?: () => void;
  applied?: boolean;
  /** 是否默认展开 (默认折叠) */
  defaultExpanded?: boolean;
}

interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldNum: string;
  newNum: string;
  text: string;
}

interface DiffHunk {
  header: string;
  lines: DiffLine[];
  oldStart: number;
  newStart: number;
}

interface DiffResult {
  filePath: string;
  hunks: DiffHunk[];
  stats: { add: number; del: number };
  lang: string;
}

/** 从 unified diff 文本解析 */
function parseUnifiedDiff(diffText: string): DiffResult {
  const lines = diffText.split('\n');
  let filePath = '';
  let currentHunk: DiffHunk | null = null;
  const hunks: DiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let stats = { add: 0, del: 0 };

  for (const line of lines) {
    // File header: --- a/path 或 ### path
    if (line.startsWith('--- a/')) {
      if (!filePath) filePath = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('+++ b/')) {
      if (!filePath) filePath = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('### ')) {
      filePath = line.replace('### ', '').trim();
      continue;
    }
    // Hunk header: @@ -old,count +new,count @@
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? parseInt(match[1]) : 1;
      newLine = match ? parseInt(match[2]) : 1;
      currentHunk = { header: line, lines: [], oldStart: oldLine, newStart: newLine };
      continue;
    }
    if (!currentHunk) continue;

    if (line.startsWith('+ ')) {
      currentHunk.lines.push({ type: 'add', oldNum: '', newNum: String(newLine++), text: line.slice(2) });
      stats.add++;
    } else if (line.startsWith('- ')) {
      currentHunk.lines.push({ type: 'del', oldNum: String(oldLine++), newNum: '', text: line.slice(2) });
      stats.del++;
    } else if (line.startsWith('  ') || line === ' ') {
      currentHunk.lines.push({ type: 'ctx', oldNum: String(oldLine++), newNum: String(newLine++), text: line.slice(2) || '' });
    }
    // 跳过纯 diff 控制行 (--- 分隔线等)
  }
  if (currentHunk) hunks.push(currentHunk);

  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  return { filePath, hunks, stats, lang: ext };
}

/** 从 old/new 内容生成 diff */
function diffOldNew(oldText: string, newText: string, fileName: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);
  const lines: DiffLine[] = [];
  let add = 0, del = 0;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : '';
    const newLine = i < newLines.length ? newLines[i] : '';
    if (oldLine === newLine) {
      lines.push({ type: 'ctx', oldNum: String(i + 1), newNum: String(i + 1), text: oldLine });
    } else {
      if (i < oldLines.length) {
        lines.push({ type: 'del', oldNum: String(i + 1), newNum: '', text: oldLine });
        del++;
      }
      if (i < newLines.length) {
        lines.push({ type: 'add', oldNum: '', newNum: String(i + 1), text: newLine });
        add++;
      }
    }
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return {
    filePath: fileName,
    hunks: [{ header: `@@ -1,${oldLines.length} +1,${newLines.length} @@`, lines, oldStart: 1, newStart: 1 }],
    stats: { add, del },
    lang: ext,
  };
}

// 语言显示色
const LANG_COLORS: Record<string, string> = {
  ts: '#3178c6', tsx: '#3178c6', js: '#f7df1e', jsx: '#f7df1e',
  py: '#3572A5', rs: '#dea584', go: '#00ADD8', java: '#b07219',
  css: '#563d7c', scss: '#563d7c', html: '#e34c26', json: '#292929',
  md: '#083fa1', yaml: '#cb171e', yml: '#cb171e', toml: '#7f7f7f',
  sql: '#e38c00', sh: '#89e051', ps1: '#012456', vue: '#41b883',
  svelte: '#ff3e00', swift: '#F05138', kt: '#A97BFF', dart: '#00B4AB',
};

export const DiffViewer: React.FC<DiffViewerProps> = ({
  diffText, filePath: propPath, oldContent, newContent,
  previewId, onApply, onReject, onClose, applied,
  defaultExpanded = false,
}) => {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
  const [viewMode, setViewMode] = useState<'side' | 'unified'>('unified');

  const result = useMemo(() => {
    if (diffText) return parseUnifiedDiff(diffText);
    if (oldContent && newContent) return diffOldNew(oldContent, newContent, propPath || 'file');
    return { filePath: '', hunks: [], stats: { add: 0, del: 0 }, lang: '' };
  }, [diffText, oldContent, newContent, propPath]);

  const displayPath = propPath || result.filePath;
  const lang = result.lang;
  const langColor = LANG_COLORS[lang] || '#6b7280';
  const filename = displayPath.split(/[\\/]/).pop() || displayPath;
  const dir = displayPath.slice(0, displayPath.length - filename.length);

  const handleCopyDiff = (e: React.MouseEvent) => {
    e.stopPropagation();
    const content = diffText || `--- a/${displayPath}\n+++ b/${displayPath}\n${result.hunks.map(h => h.header + '\n' + h.lines.map(l => (l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.text).join('\n')).join('\n')}`;
    navigator.clipboard.writeText(content).then(() => {
      // 可通过 antd message 通知
      const evt = new CustomEvent('agentai:toast', { detail: { type: 'success', msg: '已复制 diff' } });
      window.dispatchEvent(evt);
    });
  };

  const handleOpenFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (displayPath) {
      window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path: displayPath } }));
    }
  };

  // 计算编辑统计信息
  const totalAdded = result.stats.add;
  const totalDeleted = result.stats.del;
  const totalModified = result.hunks.reduce((sum, hunk) => 
    sum + hunk.lines.filter(l => l.type !== 'ctx').length, 0
  );
  const hasChanges = totalAdded > 0 || totalDeleted > 0;

  // 每个文件修改行的渲染 (unified 视图)
  const renderUnified = (hunk: DiffHunk, hi: number) => (
    <div key={hi}>
      {/* Hunk header */}
      <div style={{
        padding: '2px 12px', fontSize: 11, fontFamily: 'monospace',
        color: '#6366f1', background: 'rgba(99,102,241,0.06)',
        borderTop: hi > 0 ? '1px solid var(--border)' : 'none',
        borderBottom: '1px solid var(--border)',
      }}>
        @@ -{hunk.oldStart},{hunk.oldStart + hunk.lines.filter(l => l.type !== 'add').length} +{hunk.newStart},{hunk.newStart + hunk.lines.filter(l => l.type !== 'del').length} @@
      </div>
      {hunk.lines.map((l, li) => (
        <div
          key={li}
          style={{
            display: 'flex', minHeight: 21,
            background: l.type === 'add' ? 'rgba(34,197,94,0.08)' : l.type === 'del' ? 'rgba(239,68,68,0.08)' : 'transparent',
            borderLeft: l.type === 'add' ? '3px solid #22c55e' : l.type === 'del' ? '3px solid #ef4444' : '3px solid transparent',
            fontSize: 12, lineHeight: '21px', fontFamily: "'Consolas', 'Cascadia Code', monospace",
          }}
        >
          {/* 行号 - old */}
          <span style={{
            width: 40, textAlign: 'right', paddingRight: 6,
            fontSize: 10, color: '#999', userSelect: 'none',
            background: l.type === 'del' ? 'rgba(239,68,68,0.12)' : 'transparent',
          }}>
            {l.oldNum}
          </span>
          {/* 行号 - new */}
          <span style={{
            width: 40, textAlign: 'right', paddingRight: 8,
            fontSize: 10, color: '#999', userSelect: 'none',
            borderRight: '1px solid var(--border)',
            background: l.type === 'add' ? 'rgba(34,197,94,0.12)' : 'transparent',
          }}>
            {l.newNum}
          </span>
          {/* 内容 */}
          <span style={{
            paddingLeft: 8, flex: 1,
            whiteSpace: 'pre', overflowX: 'auto',
            color: l.type === 'add' ? '#16a34a' : l.type === 'del' ? '#dc2626' : 'var(--fg-2)',
          }}>
            {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '} {l.text}
          </span>
        </div>
      ))}
    </div>
  );

  // 左右对照视图
  const renderSideBySide = (hunk: DiffHunk, hi: number) => {
    // 构建左右列: 左列显示 old 行, 右列显示 new 行
    const leftLines: { num: string; text: string; type: 'del' | 'ctx' | 'empty' }[] = [];
    const rightLines: { num: string; text: string; type: 'add' | 'ctx' | 'empty' }[] = [];
    for (const l of hunk.lines) {
      if (l.type === 'del') {
        leftLines.push({ num: l.oldNum, text: l.text, type: 'del' });
        rightLines.push({ num: '', text: '', type: 'empty' });
      } else if (l.type === 'add') {
        leftLines.push({ num: '', text: '', type: 'empty' });
        rightLines.push({ num: l.newNum, text: l.text, type: 'add' });
      } else {
        leftLines.push({ num: l.oldNum, text: l.text, type: 'ctx' });
        rightLines.push({ num: l.newNum, text: l.text, type: 'ctx' });
      }
    }

    return (
      <div key={hi} style={{ display: 'flex', borderTop: hi > 0 ? '1px solid var(--border)' : 'none' }}>
        {/* 左列: 修改前 */}
        <div style={{ flex: 1, overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
          {leftLines.map((l, li) => (
            <div key={li} style={{
              display: 'flex', minHeight: 21,
              background: l.type === 'del' ? 'rgba(239,68,68,0.08)' : 'transparent',
              borderLeft: l.type === 'del' ? '3px solid #ef4444' : '3px solid transparent',
              fontSize: 12, lineHeight: '21px', fontFamily: "'Consolas', 'Cascadia Code', monospace",
            }}>
              <span style={{ width: 40, textAlign: 'right', paddingRight: 8, fontSize: 10, color: '#999', userSelect: 'none' }}>{l.num}</span>
              <span style={{
                flex: 1, paddingLeft: 4, whiteSpace: 'pre', overflow: 'hidden',
                color: l.type === 'del' ? '#dc2626' : 'var(--fg-2)',
                textOverflow: 'ellipsis',
              }}>{l.text}</span>
            </div>
          ))}
        </div>
        {/* 右列: 修改后 */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {rightLines.map((l, li) => (
            <div key={li} style={{
              display: 'flex', minHeight: 21,
              background: l.type === 'add' ? 'rgba(34,197,94,0.08)' : 'transparent',
              borderLeft: l.type === 'add' ? '3px solid #22c55e' : '3px solid transparent',
              fontSize: 12, lineHeight: '21px', fontFamily: "'Consolas', 'Cascadia Code', monospace",
            }}>
              <span style={{ width: 40, textAlign: 'right', paddingRight: 8, fontSize: 10, color: '#999', userSelect: 'none' }}>{l.num}</span>
              <span style={{
                flex: 1, paddingLeft: 4, whiteSpace: 'pre', overflow: 'hidden',
                color: l.type === 'add' ? '#16a34a' : 'var(--fg-2)',
                textOverflow: 'ellipsis',
              }}>{l.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const hasContent = result.hunks.length > 0;

  return (
    <div style={{
      margin: '6px 0', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--card)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
    }}>
      {/* ─── Header ─── */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 10px', cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* 折叠图标 */}
        <span style={{ fontSize: 9, color: 'var(--muted-2)', transition: 'transform 0.2s', flexShrink: 0 }}>
          {collapsed ? <RightOutlined /> : <DownOutlined />}
        </span>
        {/* 语言彩色标记 */}
        {lang && (
          <span style={{
            width: 20, height: 20, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: langColor, color: '#fff',
            fontSize: 7, fontWeight: 700, flexShrink: 0,
          }}>{lang.toUpperCase()}</span>
        )}
        {/* 文件名 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)' }}>{filename}</span>
          {dir && (
            <span style={{ fontSize: 9, color: 'var(--muted-2)', marginLeft: 4 }}>{dir}</span>
          )}
        </div>
        {/* 修改统计 - 增强版 */}
        {hasChanges && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
            {totalAdded > 0 && (
              <Tooltip title={`新增 ${totalAdded} 行`}>
                <span style={{ 
                  fontSize: 10, 
                  fontFamily: 'monospace', 
                  color: '#16a34a', 
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '1px 4px',
                  background: 'rgba(34,197,94,0.1)',
                  borderRadius: 3,
                }}>
                  <PlusOutlined style={{ fontSize: 8 }} />
                  {totalAdded}
                </span>
              </Tooltip>
            )}
            {totalDeleted > 0 && (
              <Tooltip title={`删除 ${totalDeleted} 行`}>
                <span style={{ 
                  fontSize: 10, 
                  fontFamily: 'monospace', 
                  color: '#dc2626', 
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 2,
                  padding: '1px 4px',
                  background: 'rgba(239,68,68,0.1)',
                  borderRadius: 3,
                }}>
                  <MinusOutlined style={{ fontSize: 8 }} />
                  {totalDeleted}
                </span>
              </Tooltip>
            )}
            {totalModified > 0 && (
              <Tooltip title={`共修改 ${totalModified} 行`}>
                <span style={{ 
                  fontSize: 9, 
                  color: 'var(--muted-2)',
                  marginLeft: 4,
                }}>
                  · {totalModified}行变更
                </span>
              </Tooltip>
            )}
          </div>
        )}
        {/* 状态标签 */}
        {applied && (
          <span style={{ fontSize: 9, color: '#16a34a', background: 'rgba(34,197,94,0.1)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
            已应用
          </span>
        )}
      </div>

      {/* ─── Diff 内容 ─── */}
      {!collapsed && hasContent && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          {/* 视图切换 + 操作栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', background: 'var(--panel)',
            borderBottom: '1px solid var(--border)',
            fontSize: 10,
          }}>
            {/* 视图切换 */}
            <span
              onClick={() => setViewMode('unified')}
              style={{
                padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                background: viewMode === 'unified' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'unified' ? '#fff' : 'var(--muted-2)',
                fontWeight: viewMode === 'unified' ? 500 : 400,
              }}
            >统一</span>
            <span
              onClick={() => setViewMode('side')}
              style={{
                padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                background: viewMode === 'side' ? 'var(--accent)' : 'transparent',
                color: viewMode === 'side' ? '#fff' : 'var(--muted-2)',
                fontWeight: viewMode === 'side' ? 500 : 400,
              }}
            >左右</span>
            <div style={{ flex: 1 }} />
            {/* 操作按钮 */}
            <Tooltip title="复制 diff">
              <CopyOutlined onClick={handleCopyDiff} style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer', padding: 2 }} />
            </Tooltip>
            {displayPath && (
              <Tooltip title="在编辑器中打开">
                <CodeOutlined onClick={handleOpenFile} style={{ fontSize: 11, color: 'var(--muted-2)', cursor: 'pointer', padding: 2 }} />
              </Tooltip>
            )}
            {/* 审批按钮 */}
            {!applied && previewId && onReject && (
              <Tooltip title="拒绝">
                <CloseOutlined
                  onClick={(e) => { e.stopPropagation(); onReject(previewId); }}
                  style={{ fontSize: 11, color: '#ef4444', cursor: 'pointer', padding: 2 }}
                />
              </Tooltip>
            )}
            {!applied && previewId && onApply && (
              <Tooltip title="确认应用">
                <CheckOutlined
                  onClick={(e) => { e.stopPropagation(); onApply(previewId); }}
                  style={{ fontSize: 11, color: '#22c55e', cursor: 'pointer', padding: 2, fontWeight: 700 }}
                />
              </Tooltip>
            )}
            {onClose && (
              <Tooltip title="关闭">
                <CloseOutlined onClick={onClose} style={{ fontSize: 10, color: 'var(--muted-2)', cursor: 'pointer', padding: 2 }} />
              </Tooltip>
            )}
          </div>
          {/* Diff 内容 */}
          <div style={{ maxHeight: 400, overflow: 'auto', padding: '2px 0' }}>
            {result.hunks.map((hunk, hi) =>
              viewMode === 'side' ? renderSideBySide(hunk, hi) : renderUnified(hunk, hi)
            )}
          </div>
        </div>
      )}
      {/* 无 diff 内容 */}
      {!collapsed && !hasContent && (
        <div style={{ padding: '12px', fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
          无差异内容
        </div>
      )}
    </div>
  );
};

/**
 * 从 AI 文本回复中解析 all diff 块
 */
export function renderDiffsFromText(text: string): { segments: Array<{ type: 'text' | 'diff'; content: string }> } {
  const segments: Array<{ type: 'text' | 'diff'; content: string }> = [];
  const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = diffRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'diff', content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }
  return { segments };
}

/* ===== Diff 事件系统 (保持兼容) ===== */

const DIFF_SHOW_EVENT = 'pulseflow:diff:show';
const DIFF_HIDE_EVENT = 'pulseflow:diff:hide';

export interface ShowDiffDetail {
  file: string;
  diffText?: string;
}

export function showDiff(file: string, diffText?: string): void {
  window.dispatchEvent(new CustomEvent<ShowDiffDetail>(DIFF_SHOW_EVENT, { detail: { file, diffText } }));
}

export function hideDiff(): void {
  window.dispatchEvent(new CustomEvent(DIFF_HIDE_EVENT));
}

export function useDiffEvents(): { diffFile: string | null; diffText: string; clearDiff: () => void } {
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>('');

  const clearDiff = React.useCallback(() => {
    setDiffFile(null);
    setDiffText('');
  }, []);

  React.useEffect(() => {
    const onShow = (e: Event) => {
      const ce = e as CustomEvent<ShowDiffDetail>;
      setDiffFile(ce.detail?.file ?? null);
      setDiffText(ce.detail?.diffText ?? '');
    };
    const onHide = () => clearDiff();
    window.addEventListener(DIFF_SHOW_EVENT, onShow as EventListener);
    window.addEventListener(DIFF_HIDE_EVENT, onHide as EventListener);
    return () => {
      window.removeEventListener(DIFF_SHOW_EVENT, onShow as EventListener);
      window.removeEventListener(DIFF_HIDE_EVENT, onHide as EventListener);
    };
  }, [clearDiff]);

  return { diffFile, diffText, clearDiff };
}
