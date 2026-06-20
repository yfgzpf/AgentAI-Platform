/**
 * Thread — 消息流卡片组件 (ZYAI + Reasonix 融合风格)
 *   - 浮动阴影气泡 + 入场动画
 *   - AssistantText:   Markdown 文本 (带阴影)
 *   - ReasoningCard:   推理过程 (可折叠)
 *   - ShellCard:       Shell 命令执行 (状态: await/running/done/failed)
 *   - ToolCard:        工具调用
 *   - UserMsg:         用户消息 (右对齐渐变气泡)
 *   - TurnDivider:     轮次分隔线 (时间线风格)
 */
import React, { useState } from 'react';
import { Tooltip } from 'antd';
import { Markdown } from './Markdown';
import { StatusIndicator } from './StatusIndicator';
import type { MessageStatus, ChatSegment } from '../store/chatStore';
import { Avatar } from './Avatar';
import { MsgActions } from './MsgActions';
import { FileCard, FilesFromToolSegment } from './FileCard';
import { DiffViewer } from './DiffViewer';

/* ======================== CSS 动画注入 ======================== */
const styleId = 'thread-animations';
if (!document.getElementById(styleId)) {
  const sheet = document.createElement('style');
  sheet.id = styleId;
  sheet.textContent = `
    @keyframes msgSlideIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes bubbleIn {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0; }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%      { opacity: 0.5; transform: scale(1.3); }
    }
    @keyframes glowPulse {
      0%, 100% { box-shadow: 0 0 4px rgba(99,102,241,0.3); }
      50%      { box-shadow: 0 0 12px rgba(99,102,241,0.6); }
    }
    .msg-enter {
      animation: msgSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .bubble-enter {
      animation: bubbleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
  `;
  document.head.appendChild(sheet);
}

/* ======================== Turn Divider ======================== */

export const TurnDivider: React.FC<{ label: string }> = ({ label }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '20px 16px 10px', opacity: 0.7,
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
  // 过滤出图片段 + 文件标记段
  const imageSegments = segments?.filter(s => s.kind === 'image') || [];
  const fileTags = segments?.filter(s => s.kind === 'text' && s.text !== text) || [];
  return (
    <div className="msg-enter" style={{ display: 'flex', padding: '6px 16px', gap: 10, alignItems: 'flex-start', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '78%', minWidth: 0, order: 1 }}>
        {time && (
          <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--muted-2)', marginBottom: 4, paddingRight: 4 }}>
            {time}
          </div>
        )}
        <div className="bubble-enter" style={{
          padding: '10px 16px',
          borderRadius: '16px 16px 4px 16px',
          background: 'linear-gradient(135deg, #6366F1, #4F46E5)',
          color: '#fff',
          fontSize: 14, lineHeight: 1.6,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 4px 16px rgba(99,102,241,0.25), 0 1px 4px rgba(0,0,0,0.1)',
          position: 'relative',
        }}>
          {/* 图片缩略图 */}
          {imageSegments.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {imageSegments.map((img, i) => (
                <img
                  key={i}
                  src={img.base64 ? `data:image/png;base64,${img.base64}` : img.url}
                  alt={img.alt || ''}
                  style={{ width: 80, height: 80, borderRadius: 8, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }}
                />
              ))}
            </div>
          )}
          {/* 文件标记 (PDF/Excel/文本等非图片附件) */}
          {fileTags.length > 0 && (
            <div style={{ marginBottom: 6, fontSize: 11, opacity: 0.9 }}>
              {fileTags.map((seg, i) => (
                <div key={i}>{seg.text}</div>
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
            text={[text, ...fileTags.map(s => s.text)].filter(Boolean).join('\n')}
            onResend={onResend}
            onEdit={onEdit}
            onBookmark={onBookmark}
          />
        </div>
      </div>
      {/* 用户头像 — 右对齐 */}
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
      fontSize: 14, lineHeight: 1.7,
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
        {copied ? '✓ 已复制' : '复制'}
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
          if (s.name === 'run_command' || s.name === 'run_background') {
            const cmd = extractCommand(s.args);
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
        }}>▶</span>
        <span style={{
          width: 4, height: 4, borderRadius: '50%',
          background: streaming ? 'var(--accent)' : 'var(--muted)',
          animation: streaming ? 'pulse 1.6s ease-out infinite' : undefined,
        }} />
        <span>推理过程</span>
        {streaming && <span style={{ color: 'var(--accent)', fontSize: 10 }}>进行中...</span>}
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
          {streaming && <span style={{ animation: 'blink 1s infinite', marginLeft: 1, color: 'var(--accent)' }}>▌</span>}
        </div>
      )}
    </div>
  );
};

/* ======================== Thinking Card ======================== */

/** 深度思考卡片 — Agnes AI thinking 模式的思考过程展示 */
export const ThinkingCard: React.FC<{ text: string; streaming?: boolean }> = ({ text, streaming }) => {
  const [open, setOpen] = useState(streaming || false);
  // 自动折叠: 流式结束后 5 秒自动折叠，用户可手动展开
  const foldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (foldTimerRef.current) clearTimeout(foldTimerRef.current);
    if (streaming) {
      setOpen(true);
    } else if (open) {
      // 流式结束 → 5秒后自动折叠
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
        }}>▶</span>
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
          {streaming && <span style={{ animation: 'blink 1s infinite', marginLeft: 1, color: 'var(--accent)' }}>▌</span>}
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
          {output.slice(0, 2000)}
          {output.length > 2000 && <span style={{ color: 'var(--muted-2)', display: 'block', marginTop: 4 }}>... (截断至 2000 字符)</span>}
        </div>
      )}

      {/* Approval buttons */}
      {state === 'await' && onApprove && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onApprove}
            style={{
              padding: '3px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: 'var(--success)', color: '#fff', border: 'none', cursor: 'pointer',
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
  const [expanded, setExpanded] = useState(false);

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
          {ok === true ? '✓' : ok === false ? '✗' : '○'}
        </span>
        <span style={{ fontWeight: 600, fontSize: 11 }}>{name}</span>
        {durationMs != null && (
          <span style={{ color: 'var(--muted-2)', fontSize: 10 }}>
            {(durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 9, color: 'var(--muted-2)',
          transition: 'transform 0.2s ease',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
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
            <div style={{ padding: '6px 10px' }}>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 10, color: 'var(--fg-2)' }}>
                📝 代码变更预览
              </div>
              <DiffViewer
                diff={diffContent}
                oldContent={oldContent}
                newContent={newContent}
                fileName={diffFileName ?? undefined}
                collapsed={false}
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
  } | null;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
  onBookmark?: () => void;
  onOpenFile?: (path: string) => void;
  onEdit?: () => void;
}> = ({ segments, pending, model, time, status, messageId, onNavigate, usage, onRegenerate, onFeedback, onBookmark, onOpenFile, onEdit }) => {
  const fmtUsage = (u: typeof usage) => {
    if (!u) return null;
    const parts: string[] = [];
    // 入/出 token 拆分显示, 与官方账单对齐
    if (u.prompt_tokens != null) parts.push(`↑${u.prompt_tokens}`);
    if (u.completion_tokens != null) parts.push(`↓${u.completion_tokens}`);
    if (parts.length === 0 && u.total_tokens) parts.push(`${u.total_tokens} tokens`);
    // 缓存命中公示
    if (u.cacheHit) parts.push('⚡ 缓存命中');
    // 估算模式标记 (透明度, 区分官方 / 估算)
    if (u.source === 'estimated') parts.push('~估算');
    if (u.cost && u.cost > 0) parts.push(`¥${u.cost.toFixed(4)}`);
    return parts.length ? parts.join(' · ') : null;
  };

  // 工具调用合并容器状态
  type ToolSeg = Extract<ChatSegment, { kind: 'tool' }>;
  const toolSegments = segments.filter((s): s is ToolSeg => s.kind === 'tool');
  const nonToolSegments = segments.filter(s => s.kind !== 'tool' && s.kind !== 'reasoning' && s.kind !== 'thinking');
  const thinkSegments = segments.filter(s => s.kind === 'reasoning' || s.kind === 'thinking');
  const [toolsOpen, setToolsOpen] = useState(true);
  const [thinkOpen, setThinkOpen] = useState(true);
  const successCount = toolSegments.filter(s => s.ok).length;
  const failCount = toolSegments.filter(s => s.ok === false).length;
  const runningCount = toolSegments.filter(s => s.state === 'running').length;

  // 任务完成后自动折叠工具容器和思考容器
  React.useEffect(() => {
    if (pending) {
      setToolsOpen(true);
      setThinkOpen(true);
    } else {
      if (toolSegments.length > 0 && runningCount === 0) {
        const t1 = setTimeout(() => setToolsOpen(false), 2000);
        return () => clearTimeout(t1);
      }
      if (thinkSegments.length > 0) {
        const t2 = setTimeout(() => setThinkOpen(false), 3000);
        return () => clearTimeout(t2);
      }
    }
  }, [pending, toolSegments.length, runningCount, thinkSegments.length]);

  return (
    <div className="msg-enter" style={{ display: 'flex', gap: 10, padding: '6px 16px', alignItems: 'flex-start' }}>
      {/* AI 头像 — 按 provider 动态显示 */}
      <Avatar
        kind="ai"
        name={model || 'x-agent'}
        state={pending ? 'pending' : status === 'error' ? 'error' : 'done'}
        size={24}
        messageId={messageId}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-2)' }}>
            x-agent
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

        {/* 非工具段: 文本 / 图片 */}
        {nonToolSegments.map((s, i) => {
          if (s.kind === 'text') {
            return <AssistantText key={`nt-${i}`} text={s.text}
              streaming={pending && i === nonToolSegments.length - 1} />;
          }
          if (s.kind === 'image') {
            return <ImageCard key={`nt-${i}`} url={s.url}
              base64={s.base64} alt={s.alt} filePath={s.filePath} />;
          }
          return null;
        })}

        {/* 推理/思考过程: 合并到一个可折叠容器 */}
        {thinkSegments.length > 0 && (
          <div style={{
            margin: '6px 0', borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'hidden', background: 'var(--panel)',
          }}>
            <div
              onClick={() => setThinkOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', cursor: 'pointer',
                userSelect: 'none', fontSize: 11, fontWeight: 500,
                color: 'var(--muted)',
              }}
            >
              <span style={{
                display: 'inline-flex', transition: 'transform 0.2s ease',
                transform: thinkOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                fontSize: 9,
              }}>▶</span>
              {pending && (
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'pulse 1.6s ease-out infinite',
                }} />
              )}
              <span>推理过程</span>
              {pending && <span style={{ color: 'var(--accent)', fontSize: 10 }}>进行中...</span>}
            </div>
            {thinkOpen && (
              <div style={{
                padding: '6px 10px 10px',
                borderTop: '1px solid var(--border)',
                fontSize: 12, lineHeight: 1.7,
                color: 'var(--muted)', fontStyle: 'italic',
                whiteSpace: 'pre-wrap',
                maxHeight: 400, overflowY: 'auto',
              }}>
                {thinkSegments.map((s, i) => (
                  <div key={`tk-${i}`}>
                    {(s as any).text}
                    {pending && i === thinkSegments.length - 1 && (
                      <span style={{
                        animation: 'blink 1s infinite',
                        marginLeft: 1, color: 'var(--accent)',
                      }}>▌</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 工具调用: 合并到一个可折叠容器 */}
        {toolSegments.length > 0 && (
          <div style={{
            margin: '6px 0', borderRadius: 8,
            border: '1px solid var(--border)',
            overflow: 'hidden', background: 'var(--panel)',
          }}>
            <div
              onClick={() => setToolsOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', cursor: 'pointer',
                userSelect: 'none', fontSize: 11, fontWeight: 500,
                color: 'var(--muted)',
              }}
            >
              <span style={{
                display: 'inline-flex', transition: 'transform 0.2s ease',
                transform: toolsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                fontSize: 9,
              }}>▶</span>
              {pending && runningCount > 0 && (
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: 'var(--accent)',
                  animation: 'pulse 1.6s ease-out infinite',
                }} />
              )}
              <span>{toolSegments.length} 次工具调用</span>
              <span style={{ marginLeft: 'auto', fontSize: 10 }}>
                {successCount > 0 && `${successCount} 成功`}
                {successCount > 0 && failCount > 0 && ' · '}
                {failCount > 0 && `${failCount} 失败`}
                {runningCount > 0 && ` · ${runningCount} 执行中`}
              </span>
            </div>
            {toolsOpen && (
              <div style={{
                padding: '4px 6px',
                borderTop: '1px solid var(--border)',
              }}>
                {toolSegments.map((s, i) => {
                  if (s.name === 'run_command' || s.name === 'run_background') {
                    const cmd = extractCommand(s.args);
                    const state: ShellState = s.state === 'running'
                      ? 'running' : s.ok ? 'done'
                      : s.ok === false ? 'failed' : 'running';
                    return <ShellCard key={`t-${i}`}
                      command={cmd || s.args || ''}
                      output={s.result} state={state}
                      durationMs={s.durationMs} />;
                  }
                  return <ToolCard key={`t-${i}`} name={s.name}
                    args={typeof s.args === 'string'
                      ? s.args : JSON.stringify(s.args)}
                    result={s.result} ok={s.ok}
                    durationMs={s.durationMs} />;
                })}
              </div>
            )}
          </div>
        )}

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

        {/* AI 生成/读取的文件 — 显示在 token 用量下方 */}
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
                  <span>→</span>
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
      <div style={{ padding: 8, display: 'flex', justifyContent: 'center', background: '#000' }}>
        {error ? (
          <div style={{ padding: 20, color: 'var(--danger)', fontSize: 12 }}>
            图片加载失败
          </div>
        ) : !loaded && (
          <div style={{ padding: 20, color: 'var(--muted-2)', fontSize: 12 }}>
            加载中...
          </div>
        )}
        {src && (
          <img
            src={src}
            alt={alt || ''}
            onLoad={() => setLoaded(true)}
            onError={() => setError(true)}
            style={{
              maxWidth: '100%', maxHeight: 480, borderRadius: 4,
              display: loaded ? 'block' : 'none',
              objectFit: 'contain',
            }}
          />
        )}
      </div>
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
    margin: '0 16px 8px', padding: '12px 14px',
    borderRadius: 10,
    background: 'var(--card)',
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
    margin: '0 16px 8px', padding: '8px 12px',
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
          {q} →
        </button>
      ))}
    </div>
  </div>
);
