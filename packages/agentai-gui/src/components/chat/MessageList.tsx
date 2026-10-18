/**
 * MessageList — 消息列表 (2026-10-12 第二批拆分, 从 ChatView.tsx 搬出)
 * --------------------------------------------------
 * 原位置: ChatView.tsx:1816-1911 (对话摘要栏 + messages.map 三分支)。
 * 职责: 长对话摘要导航栏 + user/assistant/system 三类消息行分发。
 *
 * ⚠️ SSE 帧级渲染优化 (原 ChatView.tsx:65-83 注释) —
 * ChatView 因 updateMessage (rAF ~60fps) 每帧重渲染; 行内闭包回调每次重建
 * 会导致 React.memo 浅比较失败 → 所有历史消息行全量重建。
 * 方案: 1) 这里对 UserMsg/AssistantMsg 包 React.memo;
 *       2) ChatView 内按"msg 对象引用"缓存每行的绑定回调 (getRowBinds),
 *          未变化消息行 props 引用稳定 → 直接跳过渲染, 只剩流式的那一条在动。
 * 该机制随本文件一起搬走, 行为不变。
 *
 * ⚠️ 本文件位于 components/chat/ — eslint 禁内联 style, 样式走 class
 * (agentai-theme.css 的 .chat-summary-* / .msg-*)。
 */
import React from 'react';
import type { ChatMessage } from '../../store/chatStore';
import { UserMsg, AssistantMsg } from '../Thread';
import { EmotionIndicator } from '../EmotionIndicator';
import type { EmotionResult } from '../../services/emotion';
import { useProfileStore } from '../../store';
import type { RowBinds, StreamProgress } from './types';

const UserMsgRow = React.memo(UserMsg);
const AssistantMsgRow = React.memo(AssistantMsg);

export interface MessageListProps {
  messages: ChatMessage[];
  emotionMap: Record<string, EmotionResult>;
  /** 流式进度 (仅流式中的 assistant 行消费) */
  progress: StreamProgress | null;
  /** msg.id → DOM 引用, 供摘要栏滚动定位 (ChatView 持有, 跨组件共享) */
  msgRefs: React.RefObject<Record<string, HTMLDivElement | null>>;
  /** 行绑定回调缓存查询 (ChatView 的 getRowBinds) */
  getRowBinds: (msg: ChatMessage) => RowBinds;
  onNavigate: (messageId: string) => void;
  onOpenFile: (path: string) => void;
  /** assistant 行流式结束回调 (ChatView: scrollToTopOnDone) */
  onDone: () => void;
}

/** system 消息静默规则: 内部指令不渲染 (与 ChatView 原逻辑逐字一致) */
function isInternalDirective(sysText: string): boolean {
  return sysText.startsWith('[SYSTEM]')
    || sysText.startsWith('[工具故障报告]')
    || sysText.startsWith('[上下文折叠摘要')
    || sysText.startsWith('# 对话历史摘要')
    || sysText.startsWith('[历史摘要');
}

export const MessageList: React.FC<MessageListProps> = ({
  messages, emotionMap, progress, msgRefs, getRowBinds,
  onNavigate, onOpenFile, onDone,
}) => {
  return (
    <>
      {/* 对话摘要栏: 超过 8 条消息时显示, 帮助用户导航长对话 */}
      {messages.length > 8 && (
        <div className="chat-summary-bar">
          <span className="chat-summary-title">📑 对话摘要</span>
          {messages.filter(m => m.role === 'user').slice(-5).map((m, idx) => {
            const text = m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('') || '';
            const short = text.slice(0, 30) + (text.length > 30 ? '...' : '');
            return (
              <span
                key={idx}
                className="chat-summary-chip"
                onClick={() => {
                  const el = msgRefs.current?.[m.id];
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                {short}
              </span>
            );
          })}
          <span className="chat-summary-count">{messages.length} 条消息</span>
        </div>
      )}

      {messages.map((msg, _i) => {
        if (msg.role === 'user') {
          const textSegs = msg.segments.filter(s => s.kind === 'text');
          const text = textSegs[0]?.text || '';
          const emotion = emotionMap[msg.id];
          const profile = useProfileStore.getState()?.profile;
          // 2026-09-05: 绑定回调走缓存 + React.memo 行 — msg 未变 → 直接跳过重渲染
          const binds = getRowBinds(msg);
          return (
            <div key={msg.id} ref={el => { if (msgRefs.current) msgRefs.current[msg.id] = el; }}>
              <UserMsgRow
                text={text}
                segments={msg.segments}
                status={msg.status}
                messageId={msg.id}
                onNavigate={onNavigate}
                userName={profile?.name || '你'}
                userAvatar={undefined}
                onResend={binds.onResend}
                onEdit={binds.onEdit}
                onDelete={binds.onDelete}
                onBookmark={binds.onBookmark}
              />
              {emotion && (
                <div className="msg-emotion-row">
                  <EmotionIndicator {...emotion} compact />
                </div>
              )}
            </div>
          );
        }
        if (msg.role === 'assistant') {
          const binds = getRowBinds(msg);
          return (
            <div key={msg.id} ref={el => { if (msgRefs.current) msgRefs.current[msg.id] = el; }}>
              <AssistantMsgRow
                segments={msg.segments}
                pending={!!msg.streaming}
                model={msg.provider}
                usage={binds.usage}
                status={msg.status}
                messageId={msg.id}
                onNavigate={onNavigate}
                onRegenerate={binds.onRegenerate}
                onFeedback={binds.onFeedback}
                onBookmark={binds.onBookmark}
                onOpenFile={onOpenFile}
                onEdit={binds.onEdit}
                onDone={onDone}
                progress={msg.streaming ? progress : null}
              />
            </div>
          );
        }
        if (msg.role === 'system') {
          // 系统内部指令 ([SYSTEM]/[工具故障报告]等) 不作为独立气泡显示
          // 这些是给 AI 的内部指令, 显示给用户只会造成干扰
          const sysText = msg.segments?.filter(s => s.kind === 'text').map(s => (s as any).text || '').join('') || '';
          if (isInternalDirective(sysText)) return null; // 静默跳过, 不渲染
          // 用户可见的 system 消息 (如欢迎信息) 正常显示
          return (
            <div key={msg.id} className="msg-system-row">
              <AssistantMsg segments={msg.segments} pending={false} />
            </div>
          );
        }
        return null;
      })}
    </>
  );
};

export default MessageList;
