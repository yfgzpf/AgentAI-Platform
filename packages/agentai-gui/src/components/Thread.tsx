/**
 * Thread — 消息流卡片组件 (自研风格)
 *   - 浮动阴影气泡 + 入场动画
 *   - AssistantText:   Markdown 文本 (带阴影)
 *   - ReasoningCard:   推理过程 (可折叠)
 *   - ShellCard:       Shell 命令执行 (状态: await/running/done/failed)
 *   - ToolCard:        工具调用
 *   - UserMsg:         用户消息 (右对齐渐变气泡)
 *   - TurnDivider:     轮次分隔符 (时间线风格)
 */
import React, { useState, useEffect, useRef } from 'react';
import { Tooltip, Tag } from 'antd';
import { EditOutlined, FileTextOutlined, CaretRightOutlined, SettingOutlined, SearchOutlined, PictureOutlined, VideoCameraOutlined, MessageOutlined, OrderedListOutlined, ToolOutlined, LoadingOutlined } from '@ant-design/icons';
import { Markdown } from './Markdown';
import { StatusIndicator } from './StatusIndicator';
import type { MessageStatus, ChatSegment } from '../store/chatStore';
import { Avatar } from './Avatar';
import { MsgActions } from './MsgActions';
import { DiffViewer } from './DiffViewer';
import { FileCard, FilesFromToolSegment } from './FileCard';
import FileChangeTree from './FileChangeTree';

/* ======================== CSS 动画已移至 agentai-theme.css ======================== */

/* ======================== Turn Divider ======================== */

export const TurnDivider: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px var(--chat-row-padding-x)', opacity: 0.7,
    fontSize: 'var(--tool-font-size)', color: 'var(--muted-2)',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-2)',
  }}>
    <div style={{
      width: 6, height: 6, borderRadius: '50%',
      background: 'var(--accent)', flexShrink: 0,
      boxShadow: '0 0 6px var(--accent)',
    }} />
    <span style={{ fontSize: 10, color: 'var(--muted-2)', fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
      {label}
    </span>
    <div style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, var(--border), transparent)' }} />
  </div>
);

/* ======================== User Message ======================== */

export const UserMsg: React.FC<{
  text: string;
  time?: string;
  status?: MessageStatus;
  messageId?: string;
  onNavigate?: (id: string) => void;
  segments?: ChatSegment[];
  userName?: string;
  userAvatar?: string;
  onResend?: () => void;
  onEdit?: () => void;
  onBookmark?: () => void;
}> = ({ text, time, status, messageId, onNavigate, segments, userName, userAvatar, onResend, onEdit, onBookmark }) => {
  const [copied, setCopied] = useState(false);
  // 过滤出图片段 + 文件标记
  const imageSegments = segments?.filter(s => s.kind === 'image') || [];
  const fileTags = segments?.filter(s => s.kind === 'text' && s.text !== text) || [];
  return (
    <div className="msg-enter" style={{ display: 'flex', padding: `6px var(--chat-row-padding-x)`, gap: 'var(--chat-row-gap)', alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '78%', minWidth: 0, order: 1 }}>
        {time && (
          <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted-2)', marginBottom: 4, paddingRight: 4 }}>
            {time}
          </div>
        )}
        <div className="bubble-enter" style={{
          padding: '10px 16px',
          borderRadius: '16px 16px 4px 16px',
          background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
          color: 'var(--fg-on-accent, #fff)',
          fontSize: 'var(--chat-font-size)', lineHeight: 'var(--chat-line-height)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 4px 16px var(--accent-soft), 0 1px 4px rgba(0,0,0,0.1)',
          position: 'relative',
        }}>
          {/* 图片缩略图 */}
          {imageSegments.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {imageSegments.map((img, i) => (
                <img
                  key={`user-img-${i}`}
                  src={img.base64 ? `data:image/png;base64,${img.base64}` : img.url}
                  alt={img.alt || ''}
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)', cursor: 'zoom-in' }}
                  onClick={() => { const src = img.base64 ? `data:image/png;base64,${img.base64}` : img.url; if (src) window.open(src, '_blank'); }}
                />
              ))}
            </div>
          )}
          {/* 文件标记 (PDF/Excel/文本等非图片附件) */}
          {fileTags.length > 0 && (
            <div style={{ marginBottom: 6, fontSize: 11, opacity: 0.9 }}>
              {fileTags.map((seg, i) => (
                <div key={i}>{(seg as any).text}</div>
              ))}
            </div>
          )}
          {text}
          {/* Status indicator at bottom-right */}
          {status && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, opacity: 0.7 }}>
              <StatusIndicator status={status} messageId={messageId} onNavigate={onNavigate} />
            </div>
          )}
        </div>
        {/* 消息级操作栏: 悬浮在气泡下方 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, gap: 4 }}>
          <MsgActions
            role="user"
            messageId={messageId || ''}
            text={[text, ...fileTags.map(s => (s as any).text)].filter(Boolean).join('\n')}
            onResend={onResend}
            onEdit={onEdit}
            onBookmark={onBookmark}
          />
        </div>
      </div>
      {/* 用户头像 (右对齐) */}
      <div style={{ order: 2, paddingTop: 18 }}>
        <Avatar kind="user" name={userName} src={userAvatar} size={24} />
      </div>
    </div>
  );
};

/* ======================== Assistant Text ======================== */

export const AssistantText: React.FC<{ text: string; streaming?: boolean }> = ({ text, streaming }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  };
  return (
    <div className="bubble-enter" style={{
      padding: '12px 16px',
      borderRadius: 12,
      fontSize: 'var(--chat-font-size)', lineHeight: 'var(--chat-line-height)',
      color: 'var(--fg)',
      wordBreak: 'break-word', overflowX: 'auto',
      background: 'var(--card)',
      border: '1px solid var(--border)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
      position: 'relative',
    }}>
      <Markdown content={text} />
      {streaming && (
        <span style={{
          display: 'inline-block', width: 2, height: 16,
          background: 'var(--accent)', marginLeft: 2,
          animation: 'blink 1s infinite, glowPulse 1.5s ease-in-out infinite',
          verticalAlign: 'text-bottom', borderRadius: 1,
        }} />
      )}
      {/* Copy button */}
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute', top: 4, right: 4,
          padding: '2px 8px', borderRadius: 4, fontSize: 10,
          color: 'var(--muted-2)', background: 'var(--panel)',
          border: '1px solid var(--border)', cursor: 'pointer',
          opacity: 0, transition: 'opacity 0.15s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0'; }}
      >
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  );
};

/* ======================== Tool Collapse Summary ======================== */

/** 工具调用折叠摘要: 超过阈值时显示 "12 次工具调用 · 10 成功 · 2 失败" */
export const ToolCollapseSummary: React.FC<{
  summary: string;
  total: number;
  tools: ChatSegment[];
}> = ({ summary, total, tools }) => {
  const [expanded, setExpanded] = useState(false);
  // 类型收窄: 只取 kind=tool 的段
  const toolSegments = tools.filter((s): s is Extract<typeof s, { kind: 'tool' }> => s.kind === 'tool');

  if (expanded) {
    return (
      <div style={{ margin: '4px 0' }}>
        <div
          onClick={() => setExpanded(false)}
          style={{
            fontSize: 11, color: 'var(--accent)', cursor: 'pointer',
            padding: '4px 8px', userSelect: 'none',
          }}
        >
          ▲ 收起工具调用
        </div>
        {toolSegments.map((s, i) => {
          if (s.name === 'run_command' || s.name === 'run_background' || s.name === 'Bash' || s.name === 'PowerShell' || s.name === 'execute_command' || s.name === 'run_code') {
            const cmd = extractCommand(s.args) || (s.name === 'run_code' ? '[代码执行]' : '');
            const state: ShellState = s.state === 'running' ? 'running' : s.ok ? 'done' : s.ok === false ? 'failed' : 'running';
            return <ShellCard key={i} command={cmd || s.args || ''} output={s.result} state={state} durationMs={s.durationMs} />;
          }
          return <ToolCard key={i} name={s.name} args={typeof s.args === 'string' ? s.args : JSON.stringify(s.args)} result={s.result} ok={s.ok} durationMs={s.durationMs} />;
        })}
      </div>
    );
  }

  return (
    <div
      onClick={() => setExpanded(true)}
      style={{
        margin: '4px 0', padding: '6px 10px', borderRadius: 6,
        background: 'var(--panel)', border: '1px dashed var(--border)',
        cursor: 'pointer', userSelect: 'none',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 11, color: 'var(--muted)',
      }}
    >
      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>···</span>
      <span>{summary}</span>
      <span style={{ fontSize: 10, opacity: 0.5 }}>点击展开</span>
    </div>
  );
};

/* ======================== Reasoning Card ======================== */

export const ReasoningCard: React.FC<{ text: string; streaming?: boolean }> = ({ text, streaming }) => {
  const [open, setOpen] = useState(streaming || false);
  // 自动折叠: 流式结束后 5 秒自动折叠，用户可手动展开
  const foldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    if (streaming) {
      setOpen(true);
    } else if (open) {
      foldTimerRef.current = setTimeout(() => setOpen(false), 5000);
    }
    return () => { if (foldTimerRef.current) clearTimeout(foldTimerRef.current); };
  }, [streaming]);

  if (!text.trim()) return null;

  return (
    <div className="bubble-enter" style={{
      margin: '6px 0', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden',
      background: 'var(--panel)',
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', cursor: 'pointer',
          userSelect: 'none', fontSize: 11, fontWeight: 500,
          color: 'var(--muted)',
        }}
      >
        <span style={{
          display: 'inline-flex', transition: 'transform 0.2s ease',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 9,
        }}><CaretRightOutlined style={{fontSize:9}} /></span>
        <span style={{
          width: 4, height: 4, borderRadius: '50%',
          background: streaming ? 'var(--accent)' : 'var(--muted)',
          animation: streaming ? 'pulse 1.6s ease-out infinite' : undefined,
        }} />
        <span>推理过程</span>
        {streaming && <span style={{ color: 'var(--accent)', fontSize: 10 }}>进行中..</span>}
        {!streaming && !open && <span style={{ fontSize: 10, opacity: 0.5 }}>点击展开</span>}
      </div>
      {open && (
        <div style={{
          padding: '6px 10px 10px', fontSize: 12, lineHeight: 1.6,
          color: 'var(--muted)', whiteSpace: 'pre-wrap',
          borderTop: '1px solid var(--border)',
          fontFamily: 'inherit',
          maxHeight: 300, overflowY: 'auto',
        }}>
          {text}
          {streaming && <span style={{ animation: 'blink 1s infinite', marginLeft: 1, color: 'var(--accent)' }}><CaretRightOutlined style={{fontSize:9}} /></span>}
        </div>
      )}
    </div>
  );
};

/* ======================== 写入中预览卡片 ======================== */

/** 解析 write_file/create_file 工具的 args，提取 file_path 和 content 预览 */
function parseWriteArgs(args: string | undefined): { filePath: string; contentPreview: string; lineCount: number } | null {
  if (!args) return null;
  let parsed: any;
  try { parsed = typeof args === 'string' ? JSON.parse(args) : args; } catch { return null; }
  if (!parsed) return null;
  const filePath = parsed.file_path || parsed.filePath || parsed.path || parsed.file || '';
  const content = parsed.content || '';
  if (!filePath) return null;
  const lines = content.split('\n');
  return { filePath, contentPreview: lines.slice(0, 8).join('\n'), lineCount: lines.length };
}

const WriteInProgressCard: React.FC<{
  filePath: string;
  contentPreview: string;
  lineCount: number;
}> = ({ filePath, contentPreview, lineCount }) => {
  const [chars, setChars] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timerRef.current = setInterval(() => setChars(c => Math.min(c + 1, contentPreview.length)), 30);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [contentPreview]);
  return (
    <div style={{
      margin: '4px 0 8px 16px',
      borderRadius: 6,
      border: '1px solid var(--border)',
      background: 'var(--panel)',
      overflow: 'hidden',
    }}>
      {/* Header: 文件名 + 写入中动画 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 10px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--accent-soft)',
      }}>
        <FileTextOutlined style={{ color: 'var(--accent)', fontSize: 12 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filePath}
        </span>
        <span style={{ fontSize: 10, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 3 }}>
          <LoadingOutlined style={{ fontSize: 10 }} />
          写入中… {lineCount} 行
        </span>
      </div>
      {/* Content preview with typewriter effect */}
      <pre style={{
        margin: 0, padding: '6px 10px',
        fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5,
        color: 'var(--fg-2)', overflowX: 'auto',
        maxHeight: 120, overflowY: 'auto',
        whiteSpace: 'pre',
      }}>
        {contentPreview.slice(0, chars)}
        <span style={{
          animation: 'blink 1s infinite',
          color: 'var(--accent)',
        }}>{chars < contentPreview.length ? '▌' : ''}</span>
      </pre>
    </div>
  );
};

/* ======================== Thinking Card ======================== */

/** 深度思考卡片: Agnes AI thinking 模式的思考过程展示 */
export const ThinkingCard: React.FC<{ text: string; streaming?: boolean }> = ({ text, streaming }) => {
  const [open, setOpen] = useState(streaming || false);
  // 自动折叠: 流式结束后 5 秒自动折叠，用户可手动展开
  const foldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    if (streaming) {
      setOpen(true);
    } else if (open) {
      // 流式结束后 5秒后自动折叠
      foldTimerRef.current = setTimeout(() => setOpen(false), 5000);
    }
    return () => { if (foldTimerRef.current) clearTimeout(foldTimerRef.current); };
  }, [streaming]);

  if (!text.trim()) return null;

  return (
    <div className="bubble-enter" style={{
      margin: '6px 0', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden',
      background: 'var(--panel)',
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', cursor: 'pointer',
          userSelect: 'none', fontSize: 11, fontWeight: 500,
          color: 'var(--muted)',
        }}
      >
        <span style={{
          display: 'inline-flex', transition: 'transform 0.2s ease',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 9,
        }}><CaretRightOutlined style={{fontSize:9}} /></span>
        <span style={{
          width: 4, height: 4, borderRadius: '50%',
          background: streaming ? 'var(--accent)' : 'var(--muted)',
          animation: streaming ? 'pulse 1.6s ease-out infinite' : undefined,
        }} />
        <span>思考过程</span>
        {streaming && <span style={{ color: 'var(--accent)', fontSize: 10 }}>思考中...</span>}
        {!streaming && !open && <span style={{ fontSize: 10, opacity: 0.5 }}>点击展开</span>}
      </div>
      {open && (
        <div style={{
          padding: '6px 10px 10px', fontSize: 12, lineHeight: 1.6,
          color: 'var(--muted)', whiteSpace: 'pre-wrap',
          borderTop: '1px solid var(--border)',
          fontFamily: 'inherit',
          maxHeight: 300, overflowY: 'auto',
        }}>
          {text}
          {streaming && <span style={{ animation: 'blink 1s infinite', marginLeft: 1, color: 'var(--accent)' }}><CaretRightOutlined style={{fontSize:9}} /></span>}
        </div>
      )}
    </div>
  );
};

/* ======================== Shell Card ======================== */

export type ShellState = 'await' | 'running' | 'done' | 'failed';

export const ShellCard: React.FC<{
  command: string;
  output?: string;
  state: ShellState;
  durationMs?: number;
  onApprove?: () => void;
  onReject?: () => void;
}> = ({ command, output, state, durationMs, onApprove, onReject }) => {
  const stateColors: Record<ShellState, string> = {
    await: 'var(--warning)',
    running: 'var(--accent)',
    done: 'var(--success)',
    failed: 'var(--danger)',
  };
  const stateLabels: Record<ShellState, string> = {
    await: '等待确认',
    running: '执行中',
    done: '已完成',
    failed: '失败',
  };

  const borderColor = state === 'done' ? 'var(--success)' as const
    : state === 'failed' ? 'var(--danger)' as const
    : state === 'running' ? 'var(--accent)' as const
    : 'var(--border)' as const;

  return (
    <div className="bubble-enter" style={{
      margin: '8px 0', borderRadius: 10,
      border: `1px solid ${borderColor}`,
      overflow: 'hidden',
      background: 'var(--bg-2)',
      boxShadow: state === 'running'
        ? '0 2px 12px rgba(99,102,241,0.12)'
        : '0 1px 6px rgba(0,0,0,0.04)',
      transition: 'box-shadow 0.3s ease',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', fontSize: 11,
        background: 'var(--panel)', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ color: stateColors[state], fontWeight: 700 }}>$</span>
        <code style={{
          flex: 1, fontSize: 11, color: 'var(--fg-2)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {command}
        </code>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          color: stateColors[state], fontSize: 10, fontWeight: 600,
        }}>
          {state === 'running' && (
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: stateColors[state],
              animation: 'pulse 1.6s ease-out infinite',
            }} />
          )}
          {stateLabels[state]}
          {durationMs != null && state !== 'running' && state !== 'await' && (
            <span style={{ color: 'var(--muted-2)', fontWeight: 400 }}>({(durationMs / 1000).toFixed(1)}s)</span>
          )}
        </span>
      </div>

      {/* Output */}
      {output && (
        <div style={{
          padding: '8px 12px', fontSize: 11, lineHeight: 1.5,
          color: 'var(--muted)', whiteSpace: 'pre-wrap', overflowX: 'auto',
          maxHeight: 200, overflowY: 'auto',
          fontFamily: "'Cascadia Code', 'Fira Code', monospace",
        }}>
          {output.slice(0, 5000)}
          {output.length > 5000 && <span style={{ color: 'var(--muted-2)', display: 'block', marginTop: 4 }}>... (截断于 5000 字符)</span>}
        </div>
      )}

      {/* Approval buttons */}
      {state === 'await' && onApprove && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onApprove}
            style={{
              padding: '3px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: 'var(--success)', color: 'var(--fg)', border: 'none', cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(34,197,94,0.3)',
            }}
          >
            允许执行
          </button>
          {onReject && (
            <button
              onClick={onReject}
              style={{
                padding: '3px 12px', borderRadius: 4, fontSize: 11,
                background: 'transparent', color: 'var(--muted)',
                border: '1px solid var(--border)', cursor: 'pointer',
              }}
            >
              拒绝
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ======================== Tool Card ======================== */

export const ToolCard: React.FC<{
  name: string;
  args?: string;
  result?: string;
  ok?: boolean;
  durationMs?: number;
}> = ({ name, args, result, ok, durationMs }) => {
  // 检测是否为 diff 工具: 有结果时自动展开, 让用户直接看到 +/- 编辑内容
  const isDiffTool = !!name.match(/^(write_file|edit_file|str_replace|apply_patch)$/i);
  const [expanded, setExpanded] = useState(isDiffTool && !!result);

  const statusColor = ok === true ? 'var(--success)' : ok === false ? 'var(--danger)' : 'var(--muted)';
  const statusLabel = ok === true ? '完成' : ok === false ? '失败' : '进行中';

  // 检测 diff 内容: write_file/edit_file 工具结果可能包含 unified diff
  const [diffFileName, setDiffFileName] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [oldContent, setOldContent] = useState<string>('');
  const [newContent, setNewContent] = useState<string>('');

  React.useEffect(() => {
    if (!result || !name.match(/^(write_file|edit_file|str_replace|apply_patch)$/i)) return;
    // 尝试从 result 中解析 diff
    // 格式: --- a/path/to/file\n+++ b/path/to/file\n@@ ... @@\n+ ...\n- ...
    const diffMatch = result.match(/^---\s+a\/[^\n]+\n\+\+\+\s+b\/([^\n]+)\n([\s\S]*)$/m);
    if (diffMatch) {
      setDiffFileName(diffMatch[1]);
      setDiffContent(diffMatch[2]);
      return;
    }
    // 尝试解析 old/new 格式
    const oldMatch = result.match(/__OLD_CONTENT__\n([\s\S]*?)\n__NEW_CONTENT__/);
    const newMatch = result.match(/__NEW_CONTENT__\n([\s\S]*?)\n__/);
    if (oldMatch && newMatch) {
      setOldContent(oldMatch[1]);
      setNewContent(newMatch[1]);
    }
  }, [result, name]);

  const hasDiff = !!diffContent || (!!oldContent && !!newContent);

  return (
    <div className="bubble-enter" style={{
      margin: '6px 0', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden',
      background: 'var(--panel)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.03)',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', cursor: 'pointer', fontSize: 11,
          color: 'var(--fg-2)', userSelect: 'none',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span style={{ color: statusColor, fontSize: 11, fontWeight: 700 }}>
          {ok === true ? '✓' : ok === false ? '✗' : '◐'}
        </span>
        <span style={{ fontWeight: 600, fontSize: 11 }}>{name}</span>
        {durationMs != null && (
          <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
            {(durationMs / 1000).toFixed(1)}s
          </span>
        )}
        {/* 结果预览摘要 (不展开即可看到) */}
        {result && ok && !expanded && (
          <span style={{
            flex: 1, fontSize: 10, color: 'var(--muted-2)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: 'nowrap', maxWidth: 200, marginLeft: 4,
            opacity: 0.6,
          }}>
            {result.replace(/^\[([^\]]+)\]\s*/, '').replace(/[\\n\\r]+/g, ' ').slice(0, 60)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 9, color: 'var(--muted-2)',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}><CaretRightOutlined style={{fontSize:9}} /></span>
      </div>
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          animation: 'msgSlideIn 0.2s ease',
        }}>
          {args && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--muted-2)', borderBottom: '1px solid var(--border)' }}>
              <div style={{ marginBottom: 2, fontWeight: 600 }}>参数:</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>{(typeof args === 'string' ? args : JSON.stringify(args, null, 2)).slice(0, 300)}</pre>
            </div>
          )}
          {hasDiff && (
            <div style={{ padding: '4px 8px' }}>
              <DiffViewer
                diffText={diffContent}
                filePath={diffFileName || undefined}
                oldContent={oldContent}
                newContent={newContent}
                defaultExpanded={false}
              />
            </div>
          )}
          {result != null && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: ok ? 'var(--muted)' : 'var(--danger)' }}>
              <div style={{ marginBottom: 2, fontWeight: 600 }}>结果:</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', maxHeight: 150, overflowY: 'auto' }}>
                {result.slice(0, 1000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ======================== Widget Card ======================== */

const WidgetCard: React.FC<{
  widget: Extract<ChatSegment, { kind: 'widget' }>;
}> = ({ widget }) => {
  const [visible, setVisible] = useState(false);
  const [iframeSrc, setIframeSrc] = useState<string>('');

  useEffect(() => {
    if (!visible) return;
    let src = '';
    if (widget.contentType === 'svg') {
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 400" width="${widget.width || '100%'}" height="${widget.height || 400}">${widget.content.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;
      src = 'data:image/svg+xml,' + encodeURIComponent(wrapped);
    } else {
      const blob = new Blob([widget.content], { type: 'text/html' });
      src = URL.createObjectURL(blob);
    }
    setIframeSrc(src);
  }, [widget.content, widget.contentType, widget.width, widget.height, visible]);

  return (
    <div className="bubble-enter" style={{
      margin: '8px 0',
      borderRadius: 10,
      border: '1px solid var(--border)',
      background: 'var(--card)',
      overflow: 'hidden',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    }}>
      {/* Header */}
      <div onClick={() => setVisible(v => !v)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', cursor: 'pointer',
        background: 'var(--panel)',
        borderBottom: visible ? '1px solid var(--border)' : 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🖼️</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-2)' }}>{widget.title}</span>
          <span style={{ fontSize: 9, color: 'var(--muted-2)', background: 'var(--accent-soft)', padding: '0 4px', borderRadius: 4 }}>
            {widget.contentType === 'svg' ? 'SVG' : 'HTML'}
          </span>
        </div>
        <span style={{
          fontSize: 10, color: 'var(--accent)',
          transform: visible ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s ease',
        }}><CaretRightOutlined style={{fontSize:9}} /></span>
      </div>
      {visible && (
        <div style={{
          padding: 0,
          maxHeight: 600,
          overflow: 'auto',
        }}>
          <iframe
            src={iframeSrc}
            style={{
              width: '100%',
              height: widget.height ? `${widget.height}px` : '300px',
              border: 'none',
            }}
            title={widget.title}
            onLoad={() => {
              if (widget.contentType === 'html' && iframeSrc.startsWith('blob:')) {
                URL.revokeObjectURL(iframeSrc);
              }
            }}
          />
        </div>
      )}
    </div>
  );
};

/* ======================== Activity Timeline (Unified) ======================== */

/** 进度数据类型 (从 ChatView progress 状态传入) */
export interface ActivityProgress {
  step: string;
  description: string;
  percent: number;
  iteration?: number;
  maxIterations?: number;
  toolCount?: number;
  successCount?: number;
  failCount?: number;
}

/** 工具名称 → 图标 (参考 ZCode 整洁风格) */
const activityToolIcon = (name: string): React.ReactNode => {
  // 子智能体调用 - 自创优雅头像 (SVG 内联图标)
  if (/^spawn_subagent|subagent|子智能体/i.test(name)) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
        <circle cx="12" cy="8" r="4" fill="var(--accent)" opacity="0.9"/>
        <path d="M12 14c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5z" fill="var(--accent)" opacity="0.7"/>
        <circle cx="18" cy="6" r="2.5" fill="var(--violet)" opacity="0.8"/>
        <path d="M18 10c-1.5 0-2.5.8-2.5 2v.5h5V12c0-1.2-1-2-2.5-2z" fill="var(--violet)" opacity="0.6"/>
      </svg>
    );
  }
  if (/^write_file|edit_file|create_file|replace_in_file|modify_file|delete_file|patch|str_replace/i.test(name)) return <EditOutlined />;
  if (/^read_file|view_file|cat|get_file_contents/i.test(name)) return <FileTextOutlined />;
  if (/^run_command|run_background|exec_command/i.test(name)) return <CaretRightOutlined />;
  if (/^run_code|execute_code|python|javascript|node/i.test(name)) return <SettingOutlined />;
  if (/^web_search|search_content|fetch_url|http_get/i.test(name)) return <SearchOutlined />;
  if (/^generate_image|create_image|draw|paint/i.test(name)) return <PictureOutlined />;
  if (/^generate_video|create_video/i.test(name)) return <VideoCameraOutlined />;
  if (/^ask_user|question|ask_human/i.test(name)) return <MessageOutlined />;
  if (/^plan_task|create_plan|task_orchestrat/i.test(name)) return <OrderedListOutlined />;
  return <ToolOutlined />;
};

/** 检测是否为子智能体调用 */
const isSubagentCall = (name: string): boolean => {
  return /^spawn_subagent|subagent/i.test(name);
};

/** 从参数中提取子智能体类型和任务描述 */
const getSubagentInfo = (args: any): { type: string; task?: string; prompt?: string } => {
  try {
    const parsed = typeof args === 'string' ? JSON.parse(args) : args;
    return {
      type: parsed?.type || parsed?.subagentType || '专家',
      task: parsed?.task || parsed?.description || '',
      prompt: parsed?.prompt || parsed?.systemPrompt || '',
    };
  } catch {
    return { type: '专家' };
  }
};

/**
 * 统一活动时间线: 将推理、思考、工具调用合并为一条垂直时间线
 * 替代之前分散的"推理卡片"+"工具卡片"两个独立容器
 *
 * 设计 (参考 ZCode 整洁风格):
 * - 折叠态: 紧凑一行摘要 "5 次操作 · 4✓ · 1✗ · 12.3s"
 * - 流式态: 显示当前活动 + 内联进度条 (不展开详情)
 * - 展开态: 垂直时间线, 每条活动可单独展开详情
 * - 自动折叠: 完成后 2s 自动收起 (给用户足够时间看到结果)
 * - 子智能体调用: 显示为 "🔍 子智能体: Explore" 格式, 整洁清晰
 */
export const ActivityTimeline: React.FC<{
  segments: ChatSegment[];
  pending: boolean;
  progress?: ActivityProgress | null;
}> = ({ segments, pending, progress }) => {
  // 按原始顺序提取活动段 (推理/思考/工具)
  type ActivitySeg = Extract<ChatSegment, { kind: 'reasoning' }> | Extract<ChatSegment, { kind: 'thinking' }> | Extract<ChatSegment, { kind: 'tool' }>;
  const activities = segments.filter((s): s is ActivitySeg =>
    s.kind === 'reasoning' || s.kind === 'thinking' || s.kind === 'tool',
  );

  const toolSegs = activities.filter((s): s is Extract<ChatSegment, { kind: 'tool' }> => s.kind === 'tool');
  const thinkSegs = activities.filter(s => s.kind === 'reasoning' || s.kind === 'thinking');

  const successCount = toolSegs.filter(s => s.ok).length;
  const failCount = toolSegs.filter(s => s.ok === false).length;
  const runningCount = toolSegs.filter(s => s.state === 'running').length;
  const totalDuration = toolSegs.reduce((sum, s) => sum + (s.durationMs || 0), 0);

  const [open, setOpen] = useState(pending);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // 流式时展开, 完成后 2s 自动折叠 (给用户足够时间看到结果)
  const foldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    if (pending) {
      setOpen(true);
    } else if (open) {
      foldTimerRef.current = setTimeout(() => setOpen(false), 2000);
    }
    return () => { if (foldTimerRef.current) clearTimeout(foldTimerRef.current); };
  }, [pending]);

  // 无活动且非流式时不渲染
  if (activities.length === 0 && !pending) return null;

  // 构建摘要文字
  const summaryParts: string[] = [];
  if (toolSegs.length > 0) summaryParts.push(`${toolSegs.length} 次操作`);
  if (successCount > 0) summaryParts.push(`${successCount}✓`);
  if (failCount > 0) summaryParts.push(`${failCount}✗`);
  if (thinkSegs.length > 0 && toolSegs.length === 0) summaryParts.push('推理过程');
  if (totalDuration > 0) summaryParts.push(`${(totalDuration / 1000).toFixed(1)}s`);
  const summary = summaryParts.join(' · ') || '活动中..';

  // 当前活动描述 (流式时)
  const currentActivity = pending
    ? (runningCount > 0
        ? `${runningCount} 个工具执行中`
        : progress?.description || '思考中...')
    : summary;

  return (
    <div className="bubble-enter" style={{
      margin: '6px 0', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden',
      background: 'var(--panel)',
    }}>
      {/* ===== Header: 摘要 + 进度 ===== */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', cursor: 'pointer',
          userSelect: 'none', fontSize: 11, fontWeight: 500,
          color: 'var(--muted)',
        }}
      >
        <span style={{
          display: 'inline-flex', transition: 'transform 0.2s ease',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 9,
        }}><CaretRightOutlined style={{fontSize:9}} /></span>
        {pending && (
          <span style={{
            width: 5, height: 5, borderRadius: '50%',
            background: 'var(--accent)',
            animation: 'pulse 1.6s ease-out infinite',
            flexShrink: 0,
          }} />
        )}
        <span style={{
          color: pending ? 'var(--accent)' : 'var(--muted)',
          fontWeight: pending ? 600 : 500,
        }}>
          {currentActivity}
        </span>
        {/* 成功/失败统计 (完成后) */}
        {!pending && toolSegs.length > 0 && (
          <span style={{ fontSize: 10, opacity: 0.7 }}>
            {successCount > 0 && <span style={{ color: 'var(--success)' }}>{successCount}✓</span>}
            {successCount > 0 && failCount > 0 && ' · '}
            {failCount > 0 && <span style={{ color: 'var(--danger)' }}>{failCount}✗</span>}
          </span>
        )}
        {!pending && !open && <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 4 }}>点击展开</span>}
        {/* 内联进度条 (流式时) */}
        {pending && progress && (
          <div style={{
            flex: 1, height: 3, borderRadius: 2,
            background: 'rgba(128,128,128,0.1)',
            overflow: 'hidden', maxWidth: 120, marginLeft: 'auto',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, progress.percent)}%`,
              background: 'var(--accent)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
        )}
      </div>

      {/* ===== Timeline (展开时) ===== */}
      {open && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '4px 6px',
          maxHeight: 500, overflowY: 'auto',
        }}>
          {activities.map((s, i) => {
            // 推理/思考段: 紧凑文本行
            if (s.kind === 'reasoning' || s.kind === 'thinking') {
              const text = (s as any).text || '';
              const isLast = pending && i === activities.length - 1;
              return (
                <div key={`a-${i}`} style={{
                  display: 'flex', gap: 6, padding: '3px 6px',
                  fontSize: 11, lineHeight: 1.5,
                  color: 'var(--muted)', fontStyle: 'italic',
                }}>
                  <span style={{ flexShrink: 0, opacity: 0.5 }}>💭</span>
                  <span style={{
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 120, overflowY: 'auto',
                  }}>
                    {text.slice(0, 500)}
                    {text.length > 500 && '...'}
                    {isLast && (
                      <span style={{
                        animation: 'blink 1s infinite',
                        marginLeft: 1, color: 'var(--accent)',
                      }}><CaretRightOutlined style={{fontSize:9}} /></span>
                    )}
                  </span>
                </div>
              );
            }
            // 工具行: 紧凑行 + 可展开详情 (参考 ZCode 整洁风格)
            if (s.kind === 'tool') {
              const isRunning = s.state === 'running';
              const statusIcon = s.ok === true ? '✓' : s.ok === false ? '✗' : '◐';
              const statusColor = s.ok === true ? 'var(--success)' : s.ok === false ? 'var(--danger)' : 'var(--accent)';
              const isExpanded = expandedIdx === i;
              const icon = activityToolIcon(s.name);
              // 检测是否为子智能体调用
              const isSubagent = isSubagentCall(s.name);
              const subagentInfo = isSubagent ? getSubagentInfo(s.args) : null;

              return (
                <div key={`a-${i}`}>
                  {/* 紧凑行 - 子智能体调用有特殊样式 */}
                  <div
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: isSubagent ? '4px 8px' : '3px 6px',
                      cursor: 'pointer', fontSize: 'var(--tool-font-size, 11px)',
                      color: 'var(--fg-2)', userSelect: 'none',
                      borderRadius: 4, transition: 'background 0.1s',
                      background: isSubagent ? 'var(--accent-soft)' : undefined,
                      border: isSubagent ? '1px solid var(--border)' : undefined,
                    }}
                    onMouseEnter={e => { if (!isSubagent) (e.currentTarget as HTMLElement).style.background = 'var(--bg-2)'; }}
                    onMouseLeave={e => { if (!isSubagent) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 12 }}>{icon}</span>
                    {/* 子智能体显示类型和任务摘要 */}
                    <span style={{ fontWeight: isSubagent ? 700 : 600, color: isSubagent ? 'var(--accent)' : undefined }}>
                      {isSubagent ? `子智能体: ${subagentInfo?.type}` : s.name}
                    </span>
                    {/* 子智能体任务描述预览 */}
                    {isSubagent && subagentInfo?.task && (
                      <span style={{
                        fontSize: 10, color: 'var(--muted-2)',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', maxWidth: 200, marginLeft: 4,
                      }}>
                        — {subagentInfo.task.slice(0, 50)}{subagentInfo.task.length > 50 ? '...' : ''}
                      </span>
                    )}
                    {/* 参数预览 (子智能体不显示参数预览) */}
                    {s.args && !isExpanded && !isSubagent && (
                      <span style={{
                        fontSize: 10, color: 'var(--muted-2)',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', maxWidth: 150,
                      }}>
                        {typeof s.args === 'string' ? s.args : JSON.stringify(s.args)}
                      </span>
                    )}
                    <span style={{ flex: 1 }} />
                    {/* 状态 */}
                    <span style={{
                      color: statusColor, fontWeight: 700, fontSize: 11,
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}>
                      {isRunning && (
                        <span style={{
                          width: 4, height: 4, borderRadius: '50%',
                          background: statusColor,
                          animation: 'pulse 1.2s ease-out infinite',
                        }} />
                      )}
                      {statusIcon}
                    </span>
                    {/* 耗时 */}
                    {s.durationMs != null && !isRunning && (
                      <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
                        {(s.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                    <span style={{
                      fontSize: 9, color: 'var(--muted-2)',
                      transition: 'transform 0.2s ease',
                      transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}><CaretRightOutlined style={{fontSize:9}} /></span>
                  </div>
                  {/* 写入中实时预览: write_file/create_file/edit_file 等工具执行时展示文件内容 */}
                  {/* 2026-08-03: 工具完成后自动折叠, 不占据窗口 */}
                  {isRunning && /^write_file|create_file|edit_file|multi_edit|str_replace$/i.test(s.name) && (() => {
                    const w = parseWriteArgs(typeof s.args === 'string' ? s.args : JSON.stringify(s.args));
                    return w ? <WriteInProgressCard key={`write-preview-${i}`} {...w} /> : null;
                  })()}
                  {/* 展开详情: 复用现有 ShellCard / ToolCard */}
                  {isExpanded && (
                    <div style={{ padding: '2px 6px 4px' }}>
                      {isSubagent ? (
                        // 子智能体专用展开视图
                        <div style={{
                          padding: '8px 12px',
                          background: 'var(--bg-2)',
                          borderRadius: 6,
                          border: '1px solid var(--border)',
                          fontSize: 11,
                        }}>
                          {/* 类型标签 */}
                          <div style={{ marginBottom: 8 }}>
                            <Tag color="purple" style={{ fontSize: 10 }}>
                              {subagentInfo?.type}
                            </Tag>
                          </div>
                          
                          {/* 任务描述 */}
                          {subagentInfo?.task && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 4 }}>📋 任务描述:</div>
                              <div style={{
                                padding: '6px 8px',
                                background: 'var(--card)',
                                borderRadius: 4,
                                border: '1px solid var(--border)',
                                maxHeight: 100,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {subagentInfo.task}
                              </div>
                            </div>
                          )}
                          
                          {/* 提示词 (如果有) */}
                          {subagentInfo?.prompt && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 4 }}>💡 系统提示:</div>
                              <div style={{
                                padding: '6px 8px',
                                background: 'var(--card)',
                                borderRadius: 4,
                                border: '1px solid var(--border)',
                                maxHeight: 150,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontSize: 10,
                              }}>
                                {subagentInfo.prompt}
                              </div>
                            </div>
                          )}
                          
                          {/* 执行结果 */}
                          {s.result && (
                            <div>
                              <div style={{ color: 'var(--muted)', fontSize: 10, marginBottom: 4 }}>✅ 执行结果:</div>
                              <div style={{
                                padding: '6px 8px',
                                background: 'var(--card)',
                                borderRadius: 4,
                                border: '1px solid var(--border)',
                                maxHeight: 200,
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                              }}>
                                {typeof s.result === 'string' ? s.result : JSON.stringify(s.result, null, 2)}
                              </div>
                            </div>
                          )}
                          
                          {/* 耗时 */}
                          {s.durationMs != null && (
                            <div style={{ marginTop: 8, textAlign: 'right', color: 'var(--muted-2)', fontSize: 10 }}>
                              ⏱️ {(s.durationMs / 1000).toFixed(1)}s
                            </div>
                          )}
                        </div>
                      ) : s.name === 'run_command' || s.name === 'run_background' || s.name === 'Bash' || s.name === 'PowerShell' || s.name === 'execute_command' || s.name === 'run_code' ? (
                        <ShellCard
                          command={extractCommand(s.args) || (s.name === 'run_code' ? '[代码执行]' : '') || (typeof s.args === 'string' ? s.args : JSON.stringify(s.args)) || ''}
                          output={s.result}
                          state={isRunning ? 'running' : s.ok ? 'done' : s.ok === false ? 'failed' : 'running'}
                          durationMs={s.durationMs}
                        />
                      ) : (
                        <ToolCard
                          name={s.name}
                          args={typeof s.args === 'string' ? s.args : JSON.stringify(s.args)}
                          result={s.result}
                          ok={s.ok}
                          durationMs={s.durationMs}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
};

/* ======================== Assistant Message (full) ======================== */

export const AssistantMsg: React.FC<{
  segments: ChatSegment[];
  pending: boolean;
  model?: string;
  time?: string;
  status?: MessageStatus;
  messageId?: string;
  onNavigate?: (id: string) => void;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    cacheHit?: boolean;
    source?: 'api' | 'estimated';
    durationMs?: number; // Phase 2: 实时显示 - 响应时间
  } | null;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
  onBookmark?: () => void;
  onOpenFile?: (path: string) => void;
  onEdit?: () => void;
  onDone?: () => void;
  progress?: ActivityProgress | null;
}> = ({ segments, pending, model, time, status, messageId, onNavigate, usage, onRegenerate, onFeedback, onBookmark, onOpenFile, onEdit, onDone, progress }) => {
  const fmtUsage = (u: typeof usage) => {
    if (!u) return null;
    const parts: string[] = [];
    // Phase 2: 实时显示 - 添加响应时间
    if (u.durationMs && u.durationMs > 0) {
      parts.push(`⏱️ ${(u.durationMs / 1000).toFixed(1)}s`);
    }
    // 输入/输出 token 拆分显示, 与官方账单对齐
    if (u.prompt_tokens != null) parts.push(`入${u.prompt_tokens}`);
    if (u.completion_tokens != null) parts.push(`出${u.completion_tokens}`);
    if (parts.length === 0 && u.total_tokens) parts.push(`${u.total_tokens} tokens`);
    // 缓存命中公示
    if (u.cacheHit) parts.push('⚡缓存命中');
    // 估算模式标记 (透明度) 区分官方 / 估算
    if (u.source === 'estimated') parts.push('~估算');
    if (u.cost && u.cost > 0) parts.push(`💰 ¥${u.cost.toFixed(4)}`);
    return parts.length ? parts.join(' · ') : null;
  };

  // 工具段 (用于文件卡片检测和文件列表)
  type ToolSeg = Extract<ChatSegment, { kind: 'tool' }>;
  const toolSegments = segments.filter((s): s is ToolSeg => s.kind === 'tool');
  const nonToolSegments = segments.filter(s => s.kind !== 'tool' && s.kind !== 'reasoning' && s.kind !== 'thinking');
  const textSegments = nonToolSegments.filter(s => s.kind === 'text');
  const nonTextSegments = nonToolSegments.filter(s => s.kind !== 'text');

  // AI 完成后通知父组件滚动到底部 (仅当 pending 从 true → false 时触发一次)
  const prevPendingRef = useRef(false);
  React.useEffect(() => {
    if (prevPendingRef.current && !pending && onDone) onDone();
    prevPendingRef.current = pending;
  }, [pending, onDone]);

  return (
    <div className="msg-enter" style={{ display: 'flex', gap: 'var(--chat-row-gap)', padding: `6px var(--chat-row-padding-x)`, alignItems: 'flex-start' }}>
      {/* AI 头像 (按 provider 动态显示) */}
      <Avatar
        kind="ai"
        name={model || '岐黄'}
        state={pending ? 'pending' : status === 'error' ? 'error' : 'done'}
        size={parseInt(getComputedStyle(document.documentElement).getPropertyValue('--chat-avatar-size')) || 24}
        messageId={messageId}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)' }}>
            PulseFlow
          </span>
          {model && (
            <span style={{
              fontSize: 9, color: 'var(--accent)',
              padding: '0 5px', borderRadius: 6,
              background: 'var(--accent-soft)',
              opacity: 0.75,
            }}>
              {model}
            </span>
          )}
          {time && <span style={{ fontSize: 10, color: 'var(--muted-2)' }}>{time}</span>}
          {pending && (
            <span style={{
              fontSize: 9, color: 'var(--accent)',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{
                width: 3, height: 3, borderRadius: '50%',
                background: 'var(--accent)',
                animation: 'pulse 1.2s ease-out infinite',
              }} />
              回复中
            </span>
          )}
        </div>

        {/* ===== AI 文件变更树 (聚合摘要, 放在最顶部) ===== */}
        {!pending && toolSegments.length > 0 && (
          <>
            <FileChangeTree
              segments={toolSegments}
              onOpen={onOpenFile}
            />
            {/* ===== 代码编辑 Diff 独立卡片: write_file/edit_file 直接显示 +/- 内容 ===== */}
            {toolSegments.filter(s =>
              /^(write_file|edit_file|str_replace|apply_patch)$/i.test(s.name || '')
            ).map((s, i) => {
              if (!s.result) return null;
              // 尝试解析 unified diff
              const dm = String(s.result).match(/^---\s+a\/[^\n]+\n\+\+\+\s+b\/([^\n]+)\n([\s\S]*)$/m);
              if (dm) {
                const fileName = (s as any).name === dm[1] ? dm[1] : dm[1];
                return (
                  <div key={`diff-${i}`} style={{ margin: '4px 0' }}>
                    <DiffViewer
                      diffText={dm[2]}
                      filePath={fileName}
                      defaultExpanded={true}
                    />
                  </div>
                );
              }
              // 尝试 old/new 格式
              const oldM = String(s.result).match(/__OLD_CONTENT__\n([\s\S]*?)\n__NEW_CONTENT__/);
              const newM = String(s.result).match(/__NEW_CONTENT__\n([\s\S]*?)\n__/);
              if (oldM && newM) {
                return (
                  <div key={`diff-${i}`} style={{ margin: '4px 0' }}>
                    <DiffViewer
                      oldContent={oldM[1]}
                      newContent={newM[1]}
                      defaultExpanded={true}
                    />
                  </div>
                );
              }
              return null;
            })}
          </>
        )}

        {/* ===== 统一活动时间线 (替代分散的推理卡+工具卡) ===== */}
        <ActivityTimeline segments={segments} pending={pending} progress={progress} />

        {/* 3. 最终回答文本 (最后展示) */}
        {textSegments.map((s, i) => {
          if (s.kind === 'text') {
            return <AssistantText key={`nt-${i}`} text={s.text}
              streaming={pending && i === textSegments.length - 1} />;
          }
          return null;
        })}

        {/* 4. 非文本非工具段: 图片 / 错误卡片 / 视频 / widget (紧跟最终回复) */}
        {nonTextSegments.filter(s => s.kind === 'image' || s.kind === 'error' || s.kind === 'video' || s.kind === 'widget').map((s, i) => {
          if (s.kind === 'image') {
            // ═══ 修复: 用 s.id 唯一 key 防重复渲染 ═══
            const imgKey = (s as any).id || `img-${i}-${Date.now()}`;
            return <ImageCard key={imgKey} url={(s as any).url}
              base64={(s as any).base64} alt={(s as any).alt} filePath={(s as any).filePath} />;
          }
          if (s.kind === 'error') {
            return <ErrorCard key={`nt-${i}`} error={(s as any).error} details={(s as any).details} fix={(s as any).fix} />;
          }
          if (s.kind === 'video') {
            return <VideoPlayer key={`nt-${i}`} url={(s as any).url} poster={(s as any).poster} alt={(s as any).alt} />;
          }
          if (s.kind === 'widget') {
            return <WidgetCard key={`nt-${i}`} widget={s as Extract<ChatSegment, { kind: 'widget' }>} />;
          }
          return null;
        })}

        {/* Footer: status + token usage */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, paddingLeft: 2 }}>
          {status && (
            <StatusIndicator status={status} messageId={messageId} onNavigate={onNavigate} />
          )}
          {!pending && usage && fmtUsage(usage) && (
            <div style={{
              fontSize: 10, color: 'var(--muted-2)',
              display: 'flex', alignItems: 'center', gap: 4, opacity: 0.5,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              {fmtUsage(usage)}
            </div>
          )}
        </div>

        {/* AI 生成/读取的文件 (显示在 token 用量下方) */}
        {segments.some(s => s.kind === 'tool' && /^(write|edit|read|create|cat|patch|view|str_replace)/i.test(s.name || '')) && (
          <FilesFromToolSegment
            segments={segments.filter(s => s.kind === 'tool') as any}
            onOpen={onOpenFile}
          />
        )}

        {/* 消息级操作栏 */}
        {!pending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, paddingLeft: 2 }}>
            <MsgActions
              role="assistant"
              messageId={messageId || ''}
              text={segments.filter(s => s.kind === 'text').map(s => (s as any).text).join('\n')}
              onRegenerate={onRegenerate}
              onFeedback={onFeedback}
              onBookmark={onBookmark}
            />
            {onEdit && (
              <Tooltip title="在编辑器中继续">
                <button
                  onClick={onEdit}
                  style={{
                    fontSize: 10, color: 'var(--muted-2)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '0 4px', width: 18, height: 18,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <span>✏️</span>
                </button>
              </Tooltip>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/* ======================== Image Card ======================== */

export const ImageCard: React.FC<{
  url?: string;
  base64?: string;
  alt?: string;
  filePath?: string;
}> = ({ url, base64, alt, filePath }) => {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const src = base64 ? `data:image/png;base64,${base64}` : url;

  return (
    <div className="bubble-enter" style={{
      margin: '6px 0', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--panel)',
    }}>
      <div style={{
        padding: '5px 10px', fontSize: 10, color: 'var(--muted-2)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <span>{alt || '截图/图片'}</span>
        {filePath && <span style={{ marginLeft: 'auto' }}>{filePath}</span>}
      </div>
      <div style={{ padding: 8, display: 'flex', justifyContent: 'center', background: 'var(--bg)', minHeight: 120 }}>
        {error ? (
          <div style={{ padding: '40px 20px', color: 'var(--danger)', fontSize: 12, textAlign: 'center', width: '100%' }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>⚠️</div>
            图片加载失败
          </div>
        ) : !loaded && (
          <div style={{ width: '100%', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {/* 骨架屏占位: 固定高度防止 layout shift */}
            <div style={{
              width: '100%', height: 120, borderRadius: 6,
              background: 'linear-gradient(90deg, var(--panel) 25%, var(--border) 50%, var(--panel) 75%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s infinite',
            }} />
          </div>
        )}
        {src && (
          <img
            src={src}
            alt={alt || ''}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{
              maxWidth: '100%', maxHeight: 240, borderRadius: 4, cursor: 'zoom-in',
              display: loaded ? 'block' : 'none',
              objectFit: 'contain',
              transition: 'opacity 0.15s ease',
              opacity: loaded ? 1 : 0,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
          />
        )}
      </div>
    </div>
  );
};

/* ======================== Error Card ======================== */

const ErrorCard: React.FC<{ error: string; details?: string; fix?: string }> = ({ error, details, fix }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      margin: '6px 0', borderRadius: 8, overflow: 'hidden',
      border: '1px solid rgba(239,68,68,0.3)',
      background: 'rgba(239,68,68,0.06)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 10px', fontSize: 12, fontWeight: 500,
        color: 'var(--danger)',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style={{ flex: 1 }}>{error}</span>
        {(details || fix) && (
          <span
            onClick={() => setExpanded(v => !v)}
            style={{ cursor: 'pointer', fontSize: 10, color: 'var(--muted-2)', userSelect: 'none' }}
          >
            {expanded ? '▲ 收起' : '▼ 详情'}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{
          padding: '6px 10px 10px',
          borderTop: '1px solid rgba(239,68,68,0.15)',
          fontSize: 11, lineHeight: 1.6, color: 'var(--fg-2)',
          whiteSpace: 'pre-wrap',
        }}>
          {details && <div style={{ marginBottom: fix ? 6 : 0 }}>📋 {details}</div>}
          {fix && (
            <div style={{
              padding: '5px 8px', borderRadius: 4,
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.2)',
              color: 'var(--success)', marginTop: 4,
            }}>
              💡 建议修复: {fix}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ======================== Video Player ======================== */

const VideoPlayer: React.FC<{ url: string; poster?: string; alt?: string }> = ({ url, poster, alt }) => {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div style={{
        margin: '6px 0', borderRadius: 8, padding: '12px 16px',
        background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
        fontSize: 12, color: 'var(--fg-2)',
      }}>
        <span style={{ color: 'var(--danger)' }}>⚠️</span> 视频加载失败: {alt || url}
        <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 4, wordBreak: 'break-all' }}>
          {url}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      margin: '6px 0', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--border)', background: 'var(--bg)',
    }}>
      {alt && (
        <div style={{
          padding: '4px 8px', fontSize: 10, color: 'var(--muted-2)',
          background: 'rgba(255,255,255,0.05)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}>
          🎬 {alt}
        </div>
      )}
      <video
        src={url}
        poster={poster}
        controls
        preload="metadata"
        onError={() => setError(true)}
        style={{ width: '100%', maxHeight: 480, display: 'block', outline: 'none' }}
      >
        <p style={{ padding: 20, color: 'var(--muted-2)', fontSize: 12, textAlign: 'center' }}>
          您的浏览器不支持视频播放
        </p>
      </video>
    </div>
  );
};



function extractCommand(args: any): string | undefined {
  if (!args) return undefined;
  try {
    const v = typeof args === 'string' ? JSON.parse(args) : args;
    if (v && typeof v.command === 'string') return v.command;
  } catch { /* ignore */ }
  return undefined;
}

/* ======================== 用户审核卡片 ======================== */
interface ReviewAction {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}

export const UserReviewCard: React.FC<{
  text: string;
  actions: ReviewAction[];
}> = ({ text, actions }) => (
  <div className="msg-enter" style={{
    display: 'flex', flexDirection: 'column', gap: 8,
    margin: 'var(--chat-card-margin-y) var(--chat-card-margin-x)', padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  }}>
    <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={a.onClick}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 12px', borderRadius: 6,
            fontSize: 12, fontWeight: a.primary ? 600 : 400,
            cursor: 'pointer', border: '1px solid var(--border)',
            background: a.primary
              ? (a.danger ? '#ef4444' : 'var(--accent)')
              : 'var(--panel)',
            color: a.primary ? '#fff' : 'var(--fg-2)',
            transition: 'all 0.15s',
          }}
        >
          <span>{a.icon}</span>
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  </div>
);

/* ======================== 追问卡片 ======================== */
export const FollowUpCard: React.FC<{
  questions: string[];
  onSelect: (q: string) => void;
}> = ({ questions, onSelect }) => (
  <div className="msg-enter" style={{
    margin: 'var(--chat-card-margin-y) var(--chat-card-margin-x)', padding: '8px 12px',
    borderRadius: 10,
    background: 'var(--bg-2)',
    border: '1px dashed var(--border)',
  }}>
    <div style={{ fontSize: 10, color: 'var(--muted-2)', marginBottom: 6 }}>
      追问建议:
    </div>
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {questions.map((q, i) => (
        <button
          key={i}
          onClick={() => onSelect(q)}
          style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11,
            cursor: 'pointer', border: '1px solid var(--border)',
            background: 'var(--card)', color: 'var(--fg-2)',
            transition: 'all 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLElement).style.color = 'var(--fg-2)'; }}
        >
          {q} →        </button>
      ))}
    </div>
  </div>
);
