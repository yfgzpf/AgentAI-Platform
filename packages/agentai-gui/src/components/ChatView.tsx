import React, { useState, useRef, useCallback } from 'react';
import { Tag, Space, Select, Button, Tooltip, message as msg, Upload } from 'antd';
import { SendOutlined, StopOutlined, UploadOutlined, PictureOutlined, AudioOutlined } from '@ant-design/icons';
import { ChatMessage } from './ChatMessage';
import { useChatStore, ChatSegment } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import { useModeStore } from '../store/modeStore';
import { ModelSwitcher } from './ModelSwitcher';

type AppMode = 'readonly' | 'planning' | 'auto';

const MODE_CONFIG: Record<AppMode, { label: string; color: string; desc: string }> = {
  readonly: { label: '只读', color: 'green', desc: '纯对话，不执行工具' },
  planning: { label: '规划', color: 'orange', desc: '先规划再执行' },
  auto: { label: '自动', color: 'blue', desc: '智能推理 + 工具' },
};

export const ChatView: React.FC = () => {
  const { messages, appendMessage, updateMessage, clearMessages } = useChatStore();
  const { activeModelId } = useModelStore();
  const { mode, setMode } = useModeStore();
  const [loading, setLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 模拟发送 (完整 Gateway 通信)
  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);

    const userId = 'user';
    const botId = `bot-${Date.now()}`;
    appendMessage({ id: userId, role: 'user', segments: [{ kind: 'text', text }], ts: Date.now() });
    appendMessage({ id: botId, role: 'assistant', segments: [], ts: Date.now(), streaming: true, provider: activeModelId });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let provider = activeModelId || 'agentai';
      const gatewayUrl = '/v1/chat';
      const stream = mode === 'readonly';

      const resp = await fetch(gatewayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, stream, model: provider, mode, userId, workspace: '' }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      if (!resp.body || !resp.body.getReader) {
        // 非流式 JSON
        const json = await resp.json();
        if (json.modelHint) msg.info({ content: `🔄 已切换至${json.modelHint}`, key: 'model-switch', duration: 3 });
        updateMessage(botId, (m) => ({
          ...m, segments: json.content ? [{ kind: 'text', text: json.content }] : m.segments,
          streaming: false, provider: json.provider || provider,
        }));
        if (json.toolEvents?.length > 0) {
          for (const ev of json.toolEvents) {
            if (ev.type === 'tool_start') updateMessage(botId, (m) => ({ ...m, segments: [...m.segments, { kind: 'tool', callId: ev.callId, name: ev.name, state: 'running' }] }));
            else if (ev.type === 'tool_result') updateMessage(botId, (m) => {
              const segs = m.segments.map(s => s.kind === 'tool' && s.callId === ev.callId ? { ...s, state: ev.ok ? 'success' : 'error', result: ev.result, ok: ev.ok, durationMs: ev.durationMs } : s);
              return { ...m, segments: segs };
            });
          }
        }
      } else {
        // 流式 SSE
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
            let eventType = '', dataStr = '';
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
                updateMessage(botId, (m) => ({ ...m, segments: [...m.segments, { kind: 'tool', callId: data.callId, name: data.name, state: 'running' }] }));
              } else if (eventType === 'tool_result') {
                updateMessage(botId, (m) => { const segs = m.segments.map(s => s.kind === 'tool' && s.callId === data.callId ? { ...s, state: 'success', result: data.result, ok: true } : s); return { ...m, segments: segs }; });
              } else if (eventType === 'done') {
                updateMessage(botId, (m) => ({ ...m, streaming: false, provider: data.provider }));
              }
            } catch {}
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') updateMessage(botId, (m) => ({ ...m, streaming: false, segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${e.message}` }] }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, activeModelId, mode, appendMessage, updateMessage]);

  const handleStop = useCallback(() => { abortRef.current?.abort(); setLoading(false); }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(inputText); setInputText(''); }
  };

  const handleFileSelect = () => fileInputRef.current?.click();
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) msg.info(`已选择文件: ${file.name}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f0f0f' }}>
      {/* 模式 + 模型 状态栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid #1f1f1f', background: '#141414' }}>
        <Space size={4}>
          {(Object.entries(MODE_CONFIG) as [AppMode, typeof MODE_CONFIG[AppMode]][]).map(([key, cfg]) => (
            <Tag key={key} color={mode === key ? cfg.color : 'default'} style={{ cursor: 'pointer', margin: 0, fontSize: 11 }}
              onClick={() => setMode(key)}>
              {cfg.label}
            </Tag>
          ))}
        </Space>
        <div style={{ flex: 1 }} />
        <ModelSwitcher compact />
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {messages.map(m => <ChatMessage key={m.id} message={m} isUser={m.role === 'user'} userName="User" />)}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#666' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#888', marginBottom: 8 }}>AgentAI Platform</div>
            <div style={{ fontSize: 13, color: '#555' }}>选择模式，输入消息开始</div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #1f1f1f', background: '#141414' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Tooltip title="上传文件">
            <Button icon={<UploadOutlined />} type="text" onClick={handleFileSelect} style={{ color: '#888' }} />
          </Tooltip>
          <input ref={fileInputRef} type="file" onChange={handleFileChange} style={{ display: 'none' }} />
          <Tooltip title="图片">
            <Button icon={<PictureOutlined />} type="text" style={{ color: '#888' }} />
          </Tooltip>
          <Tooltip title="语音">
            <Button icon={<AudioOutlined />} type="text" style={{ color: '#888' }} />
          </Tooltip>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid #262626',
              background: '#0f0f0f', color: '#ddd', fontSize: 14, outline: 'none', resize: 'none',
              fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 120,
            }}
          />
          {loading ? (
            <Button icon={<StopOutlined />} shape="circle" danger onClick={handleStop} />
          ) : (
            <Button type="primary" icon={<SendOutlined />} shape="circle" onClick={() => { handleSend(inputText); setInputText(''); }}
              disabled={!inputText.trim()} />
          )}
        </div>
      </div>
    </div>
  );
};
