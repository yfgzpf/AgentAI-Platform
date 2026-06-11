import React, { useState, useRef, useCallback } from 'react';
import { message as msg } from 'antd';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStore } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import { useModeStore } from '../store/modeStore';
import { useAutoModelStore, analyzeComplexity } from '../store/autoModelStore';
import { apiStream } from '../services/api';

export const ChatView: React.FC = () => {
  const { messages, appendMessage, updateMessage, clearMessages } = useChatStore();
  const { activeModelId } = useModelStore();
  const { mode } = useModeStore();
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(async (text: string) => {
    if (loading) return;
    setLoading(true);

    const userId = 'user';
    const botId = `bot-${Date.now()}`;
    appendMessage({ id: userId, role: 'user', segments: [{ kind: 'text', text }], ts: Date.now() });
    appendMessage({ id: botId, role: 'assistant', segments: [], ts: Date.now(), streaming: true });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // 模型选择: 用户手动选 > 自动分析
      let provider = activeModelId || 'agentai';
      if (!activeModelId || activeModelId === 'agentai') {
        const autoEnabled = useAutoModelStore.getState().enabled;
        if (autoEnabled) {
          const analysis = analyzeComplexity(text);
          if (analysis.isComplex && analysis.suggestedTier) {
            provider = analysis.suggestedTier.apiProvider;
            msg.info({ content: `🔄 已切换至 ${analysis.suggestedTier.label}`, key: 'model-switch', duration: 3 });
          }
        }
      }

      // 检查 Gateway 是否在线 (非流式路径)
      const gatewayUrl = mode === 'readonly' ? '/v1/chat' : '/v1/chat';
      const stream = mode === 'readonly';

      let resp: Response;
      try {
        resp = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, stream, model: provider, mode, userId, workspace: '' }),
          signal: controller.signal,
        });
      } catch {
        // Gateway offline fallback
        resp = await fetch('/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, provider }),
          signal: controller.signal,
        });
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      if (!resp.body || !resp.body.getReader) {
        // 非流式 JSON 响应
        const json = await resp.json();
        const usage = json.usage ? { prompt: json.usage.promptTokens || json.usage.prompt_tokens, completion: json.usage.completionTokens || json.usage.completion_tokens } : undefined;

        if (json.modelHint) {
          msg.info({ content: `🔄 已切换至${json.modelHint}`, key: 'model-switch', duration: 3 });
        }

        updateMessage(botId, (m) => ({
          ...m,
          segments: json.content ? [{ kind: 'text', text: json.content }] : [{ kind: 'text', text: '✨ 🤔 思考中...' }],
          streaming: false,
          tokens: usage || m.tokens,
          provider: json.provider || provider,
        }));

        // 显示工具事件
        if (json.toolEvents?.length > 0) {
          for (const ev of json.toolEvents) {
            if (ev.type === 'tool_start') {
              updateMessage(botId, (m) => ({
                ...m,
                segments: [...m.segments, { kind: 'tool', callId: ev.callId, name: ev.name, state: 'running' }],
              }));
            } else if (ev.type === 'tool_result') {
              updateMessage(botId, (m) => {
                const segs = m.segments.map(s => s.kind === 'tool' && s.callId === ev.callId ? { ...s, state: ev.ok ? 'success' : 'error', result: ev.result, ok: ev.ok, durationMs: ev.durationMs } : s);
                return { ...m, segments: segs };
              });
            }
          }
        }

        if (json.modelHint?.includes('DeepSeek') && json.content?.length > 50) {
          setTimeout(() => {
            msg.info({ content: '💡 审查完成，可在设置中切回 Agnes 节省费用', key: 'switch-back', duration: 5 });
          }, 1000);
        }
      } else {
        // 流式 SSE 响应 (readonly 模式)
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const lines = frame.split('\n').map(l => l.trim());
            let eventType = '';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              if (line.startsWith('data:')) dataStr += line.slice(5).trim();
            }
            if (!eventType) continue;

            try {
              const data = JSON.parse(dataStr);
              if (eventType === 'delta') {
                updateMessage(botId, (m) => {
                  const segs = [...m.segments];
                  const lt = segs.filter(s => s.kind === 'text').pop();
                  if (lt && lt.kind === 'text') lt.text += data.delta || '';
                  else segs.push({ kind: 'text', text: data.delta || '' });
                  return { ...m, segments: segs, streaming: true };
                });
              } else if (eventType === 'tool_start') {
                updateMessage(botId, (m) => ({
                  ...m, segments: [...m.segments, { kind: 'tool', callId: data.callId, name: data.name, state: 'running' }],
                }));
              } else if (eventType === 'tool_result') {
                updateMessage(botId, (m) => {
                  const segs = m.segments.map(s => s.kind === 'tool' && s.callId === data.callId ? { ...s, state: 'success', result: data.result, ok: data.ok, durationMs: data.durationMs } : s);
                  return { ...m, segments: segs };
                });
              } else if (eventType === 'done') {
                updateMessage(botId, (m) => ({ ...m, streaming: false, provider: data.provider }));
              } else if (eventType === 'error') {
                updateMessage(botId, (m) => ({ ...m, streaming: false, segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${data.error || '错误'}` }] }));
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        updateMessage(botId, (m) => ({ ...m, streaming: false, segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${e.message || '请求失败'}` }] }));
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, activeModelId, mode, appendMessage, updateMessage]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {messages.map(m => (
          <ChatMessage key={m.id} message={m} isUser={m.role === 'user'} userName="User" />
        ))}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>AgentAI</div>
            <div style={{ fontSize: 14 }}>输入消息开始对话</div>
          </div>
        )}
      </div>
      <ChatInput onSend={handleSend} onStop={handleStop} loading={loading} />
    </div>
  );
};
