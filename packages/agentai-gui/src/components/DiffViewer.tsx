/**
 * DiffViewer — Claude Code 式 diff 预览组件
 * 渲染 unified diff 格式，绿色=新增，红色=删除
 */
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Tooltip } from 'antd';
import { CheckOutlined, CloseOutlined, FileTextOutlined, PlusOutlined, MinusOutlined } from '@ant-design/icons';

interface DiffViewerProps {
  diffText: string;
  filePath?: string;
  previewId?: string;
  onApply?: (previewId: string) => void;
  onReject?: (previewId: string) => void;
  onClose?: () => void;
  applied?: boolean;
}

interface DiffHunk {
  header: string;
  lines: Array<{ type: 'add' | 'del' | 'ctx'; num: string; text: string }>;
}

function parseDiff(diffText: string): { filePath: string; hunks: DiffHunk[]; stats: { add: number; del: number } } {
  const lines = diffText.split('\n');
  let filePath = '';
  let currentHunk: DiffHunk | null = null;
  const hunks: DiffHunk[] = [];
  let oldLine = 0;
  let newLine = 0;
  let stats = { add: 0, del: 0 };

  for (const line of lines) {
    // File header: ### filename
    if (line.startsWith('### ')) {
      filePath = line.replace('### ', '').trim();
      continue;
    }
    // Hunk header
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
      if (match) { oldLine = parseInt(match[1]); newLine = parseInt(match[2]); }
      currentHunk = { header: line, lines: [] };
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith('+ ')) {
      currentHunk.lines.push({ type: 'add', num: String(newLine++), text: line.slice(2) });
      stats.add++;
    } else if (line.startsWith('- ')) {
      currentHunk.lines.push({ type: 'del', num: String(oldLine++), text: line.slice(2) });
      stats.del++;
    } else if (line.startsWith('  ') || line === ' ') {
      currentHunk.lines.push({ type: 'ctx', num: '', text: line.slice(2) || '' });
      oldLine++;
      newLine++;
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return { filePath, hunks, stats };
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diffText, filePath: propPath, previewId, onApply, onReject, onClose, applied }) => {
  const [collapsed, setCollapsed] = useState(false);
  const { filePath, hunks, stats } = useMemo(() => parseDiff(diffText), [diffText]);
  const displayPath = propPath || filePath;

  return (
    <div style={{
      background: '#1a1a22',
      borderRadius: 8,
      margin: '8px 0',
      border: '1px solid #2a2a38',
      overflow: 'hidden',
      fontFamily: 'Consolas, "Cascadia Code", monospace',
      fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: '#20202a',
        borderBottom: '1px solid #2a2a38',
        cursor: 'pointer',
      }} onClick={() => setCollapsed(!collapsed)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined style={{ color: '#888', fontSize: 14 }} />
          <span style={{ color: '#ccc', fontWeight: 500 }}>{displayPath}</span>
          <span style={{ color: '#4caf50', fontSize: 12 }}>+{stats.add}</span>
          <span style={{ color: '#f44336', fontSize: 12 }}>-{stats.del}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!applied && previewId && onReject && (
            <Tooltip title="拒绝此修改">
              <CloseOutlined
                style={{ color: '#f44336', cursor: 'pointer', padding: 4 }}
                onClick={(e) => { e.stopPropagation(); onReject(previewId); }}
              />
            </Tooltip>
          )}
          {!applied && previewId && onApply && (
            <Tooltip title="确认应用修改">
              <CheckOutlined
                style={{ color: '#4caf50', cursor: 'pointer', padding: 4, fontSize: 16 }}
                onClick={(e) => { e.stopPropagation(); onApply(previewId); }}
              />
            </Tooltip>
          )}
          {applied && (
            <span style={{ color: '#4caf50', fontSize: 12 }}>✅ 已应用</span>
          )}
          {onClose && (
            <Tooltip title="关闭预览">
              <CloseOutlined
                style={{ color: '#888', cursor: 'pointer', padding: 4, fontSize: 14 }}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
              />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Diff Content */}
      {!collapsed && (
        <div style={{ maxHeight: 400, overflow: 'auto', padding: '4px 0' }}>
          {hunks.map((hunk, hi) => (
            <div key={hi}>
              <div style={{ color: '#666', padding: '2px 12px', fontSize: 12 }}>
                {hunk.header}
              </div>
              {hunk.lines.map((l, li) => (
                <div
                  key={li}
                  style={{
                    padding: '1px 12px',
                    display: 'flex',
                    background: l.type === 'add' ? 'rgba(76,175,80,0.1)' : l.type === 'del' ? 'rgba(244,67,54,0.1)' : 'transparent',
                    borderLeft: l.type === 'add' ? '3px solid #4caf50' : l.type === 'del' ? '3px solid #f44336' : '3px solid transparent',
                    minHeight: 20,
                  }}
                >
                  <span style={{ color: '#555', width: 28, textAlign: 'right', marginRight: 12, flexShrink: 0, userSelect: 'none' }}>
                    {l.num}
                  </span>
                  <span style={{
                    color: l.type === 'add' ? '#a5d6a7' : l.type === 'del' ? '#ef9a9a' : '#aaa',
                    whiteSpace: 'pre',
                    wordBreak: 'break-all',
                  }}>
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * 从 AI 文本回复中解析所有 diff 块，渲染为交互式预览
 */
export function renderDiffsFromText(text: string, onApply?: (id: string) => void): { segments: Array<{ type: 'text' | 'diff'; content: string; previewId?: string }> } {
  const segments: Array<{ type: 'text' | 'diff'; content: string; previewId?: string }> = [];

  // 匹配 ```diff ... ``` 代码块
  const diffRegex = /```diff\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = diffRegex.exec(text)) !== null) {
    // 前面文本
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'diff', content: match[1], previewId: undefined });
    lastIndex = match.index + match[0].length;
  }

  // 剩余文本
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }

  return { segments };
}

/* ============================================================ */
/*  useDiffEvents — 全局 diff 事件订阅 hook                     */
/* ============================================================ */
/**
 * 使用 window 自定义事件实现跨组件 diff 状态共享。
 *
 * 触发方式 (任何地方可调用):
 *   import { showDiff, hideDiff } from '@/components/DiffViewer';
 *   showDiff('src/components/ChatView.tsx');   // 弹出 diff 预览
 *   hideDiff();                                // 关闭 diff 预览
 *
 * ChatView 用法:
 *   const { diffFile, clearDiff } = useDiffEvents();
 *   {diffFile && <DiffViewer filePath={diffFile} onClose={clearDiff} />}
 *
 * 设计原因:
 *   - 不引入额外状态管理 (Redux/Zustand) — Diff 是低频操作
 *   - 跨组件简单通讯 — window CustomEvent 即可
 *   - 多订阅者支持 — 每个 useDiffEvents 都会收到通知
 */
const DIFF_SHOW_EVENT = 'pulseflow:diff:show';
const DIFF_HIDE_EVENT = 'pulseflow:diff:hide';

export interface ShowDiffDetail {
  file: string;
  diffText?: string;
}

export function showDiff(file: string, diffText?: string): void {
  const detail: ShowDiffDetail = { file, diffText };
  window.dispatchEvent(new CustomEvent<ShowDiffDetail>(DIFF_SHOW_EVENT, { detail }));
}

export function hideDiff(): void {
  window.dispatchEvent(new CustomEvent(DIFF_HIDE_EVENT));
}

export function useDiffEvents(): { diffFile: string | null; diffText: string; clearDiff: () => void } {
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState<string>('');

  const clearDiff = useCallback(() => {
    setDiffFile(null);
    setDiffText('');
  }, []);

  useEffect(() => {
    const onShow = (e: Event) => {
      const ce = e as CustomEvent<ShowDiffDetail>;
      setDiffFile(ce.detail?.file ?? null);
      setDiffText(ce.detail?.diffText ?? '');
    };
    const onHide = () => {
      clearDiff();
    };
    window.addEventListener(DIFF_SHOW_EVENT, onShow as EventListener);
    window.addEventListener(DIFF_HIDE_EVENT, onHide as EventListener);
    return () => {
      window.removeEventListener(DIFF_SHOW_EVENT, onShow as EventListener);
      window.removeEventListener(DIFF_HIDE_EVENT, onHide as EventListener);
    };
  }, [clearDiff]);

  return { diffFile, diffText, clearDiff };
}
