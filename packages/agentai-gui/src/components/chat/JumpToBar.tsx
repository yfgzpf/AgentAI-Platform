/**
 * JumpToBar — 对话区悬浮"跳到时间线"小按钮组 (批次8.8, 2026-10-12)
 * ------------------------------------------------------------------
 * 需求: 长对话不用从头翻, 一键定位到
 *   ⬇ 最新   → 末条消息
 *   ⊙ 改代码 → 最近一次 kind==='tool' 且 args.path 存在的段 (最近一次改文件)
 *   ▣ 工具   → 最近一次工具调用
 * 实现: 复用 MessageList 已有的 msgRefs (msg.id → HTMLDivElement), 点了 scrollIntoView。
 * 纯函数 findJumpTarget 导出供单测 (不渲染)。
 * 全走 CSS 变量 (var(--panel)/var(--fg)/var(--accent)/var(--border)/var(--shadow-sm))。
 */
import React, { useState } from 'react';
import type { ChatMessage } from '../../store/chatStore';

export type JumpKind = 'latest' | 'code' | 'tool';

/** 纯函数: 找某类"跳到时间线"目标的 msg.id (最新 / 最近改代码 / 最近工具调用)。
 *  无可跳目标返回 undefined (调用方据此隐藏对应按钮)。 */
export function findJumpTarget(messages: ChatMessage[], kind: JumpKind): string | undefined {
  if (!messages?.length) return undefined;
  if (kind === 'latest') return messages[messages.length - 1].id;
  if (kind === 'code') {
    // 最近一次 kind==='tool' 且 args 带 path 的段 (改文件/写文件/编辑)
    for (let i = messages.length - 1; i >= 0; i--) {
      const seg = (messages[i].segments || []).find(
        s => s.kind === 'tool' && !!(s as any).args?.path,
      ) as any;
      if (seg) return messages[i].id;
    }
    return undefined;
  }
  // kind === 'tool': 最近一次任何工具调用
  for (let i = messages.length - 1; i >= 0; i--) {
    const seg = (messages[i].segments || []).find(s => s.kind === 'tool') as any;
    if (seg) return messages[i].id;
  }
  return undefined;
}

const BTN: React.CSSProperties = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)',
  background: 'var(--panel)', color: 'var(--fg)', cursor: 'pointer',
  boxShadow: 'var(--shadow-sm)', fontSize: 'var(--fs-sm)', lineHeight: 1,
};

export const JumpToBar: React.FC<{
  messages: ChatMessage[];
  msgRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  /** 可选: 外部已实现滚动; 缺省时用 msgRefs + scrollIntoView */
  onNavigate?: (messageId: string) => void;
}> = ({ messages, msgRefs, onNavigate }) => {
  const [visible, setVisible] = useState(false);

  const go = (kind: JumpKind) => {
    const id = findJumpTarget(messages, kind);
    if (!id) return;
    if (onNavigate) { onNavigate(id); return; }
    const el = msgRefs.current?.[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const hasLatest = messages.length > 3; // 消息太少不值得显
  const hasCode = !!findJumpTarget(messages, 'code');
  const hasTool = !!findJumpTarget(messages, 'tool');
  if (!hasLatest && !hasCode && !hasTool) return null;

  // 悬浮按钮组, 贴对话区右下, 点对话区滚动时自动淡入
  const btn = (kind: JumpKind, glyph: string, title: string, show: boolean) => (
    show ? (
      <button key={kind} onClick={() => go(kind)} title={title}
        style={BTN}>
        {glyph}
      </button>
    ) : null
  );

  return (
    <div
      onMouseEnter={() => setVisible(true)}
      style={{
        position: 'absolute', right: 12, bottom: 12,
        display: 'flex', flexDirection: 'column', gap: 6,
        opacity: visible ? 1 : 0.85, transition: 'opacity 0.15s',
        zIndex: 5,
      }}
    >
      {btn('code', '⊙', '跳到最近一次改代码', hasCode)}
      {btn('tool', '▣', '跳到最近一次工具调用', hasTool)}
      {btn('latest', '⬇', '跳到最新消息', hasLatest)}
    </div>
  );
};

export default JumpToBar;
