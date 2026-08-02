/**
 * EditorChatPanel — 编辑器内 AI 对话面板 (Trae 风格)
 * ----------------------------------------------------
 * 与首页 ChatView 功能一致:
 *   - 模型切换选择
 *   - Composer (文件/图片/语音/联网)
 *   - 消息流 (UserMsg / AssistantMsg)
 *   - SSE 流式通信
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Select, Tooltip, Button } from 'antd';
import { SendOutlined, StopOutlined, PaperClipOutlined, PictureOutlined,
  AudioOutlined, GlobalOutlined, RobotOutlined, CloseOutlined,
  AudioMutedOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useEditorChatStore } from '../store/editorChatStore';
import { useModelStore } from '../store/modelStore';
import { UserMsg, AssistantMsg } from './Thread';
import { apiStream, makeChatHandlers } from '../services/api';
import { gatewayFallback } from '../services/GatewayFallback';
import { startSpeechRecognition, stopSpeechRecognition, isSpeechRecognitionSupported } from '../services/voice';
import { useBrowserState, useBrowserActions, buildBrowserContext, BrowserStateBus } from '../services/BrowserStateBus';
import { openGlobalBrowser } from './GlobalBrowserDrawer';
import { AskUserCard } from './AskUserCard';
import { Scene3DViewer, type Scene3DData } from './Scene3DViewer';

interface Props {
  workspaceDir?: string;
}

export const EditorChatPanel: React.FC<Props> = ({ workspaceDir }) => {
  const { messages, appendMessage, updateMessage, clearMessages } = useEditorChatStore();
  const { activeModelId, setActive: setActiveModel, models } = useModelStore();
  const browserState = useBrowserState();
  const actionHistory = useBrowserActions();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [webSearch, setWebSearch] = useState(false);
  const [recording, setRecording] = useState(false);
  const srSupported = isSpeechRecognitionSupported();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [askUserCard, setAskUserCard] = useState<{ question: string; options: Array<{ id: string; title: string }> } | null>(null);
  const [scene3D, setScene3D] = useState<Scene3DData | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  const editorMsgs = messages || [];

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [editorMsgs]);

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || loading) return;
    setDraft('');
    setLoading(true);

    const userId = 'editor-user';
    const botId = `editor-bot-${Date.now()}`;

    // v3.2: 注入浏览器实时状态 (URL/元素/最近动作) 到 LLM 上下文
    const browserCtx = buildBrowserContext(browserState);
    const textWithCtx = `[系统注入] ${browserCtx}\n\n[用户消息] ${text}`;

    appendMessage({ id: userId, role: 'user', segments: [{ kind: 'text', text }], ts: Date.now(), status: 'sending' });
    appendMessage({ id: botId, role: 'assistant', segments: [], ts: Date.now(), streaming: true, status: 'processing', provider: activeModelId });

    setTimeout(() => updateMessage(userId, (m: any) => ({ ...m, status: 'sent' })), 200);

    const controller = new AbortController();
    abortRef.current = controller;

    const baseHandlers = makeChatHandlers(botId, updateMessage);
    const handlers = {
      ...baseHandlers,
      // 🔧 修复: 编辑页面缺少浏览器工具自动显示逻辑 (ChatView 有, EditorChatPanel 遗漏)
      // AI 调用 browser_* 工具时, 前端自动弹出浏览器面板
      onToolStart: (info: any) => {
        baseHandlers.onToolStart?.(info);  // 默认行为: 更新 UI 显示工具调用
        if (info.name && /^browser_/.test(info.name)) {
          window.dispatchEvent(new CustomEvent('agentai:show-browser', {
            detail: { name: info.name, args: info.args, url: info.args?.url || info.args?.target || '' },
          }));
        }
      },
      // 🔧 修复: 编辑页面缺少 ask_user 追问处理 (ChatView 有, EditorChatPanel 遗漏)
      onAskUser: (info: any) => {
        setAskUserCard({ question: info.question, options: info.options || [] });
      },
      // 3D 场景渲染: generate_3d_scene 结果自动渲染为可交互 3D 预览
      onToolResult: (info: any) => {
        baseHandlers.onToolResult?.(info);
        if (info.name === 'generate_3d_scene' && info.ok) {
          try {
            const result = typeof info.result === 'string' ? JSON.parse(info.result) : info.result;
            if (result?.data?.scene) setScene3D(result.data.scene);
          } catch { /* best-effort */ }
        }
      },
      onDone: (info: any) => {
        updateMessage(botId, (m: any) => {
          // 兜底: 降级路径不走 delta, 内容只在 done.content 里
          let segments = m.segments;
          const hasText = m.segments?.some((s: any) => s.kind === 'text' && s.text?.trim());
          if (info?.content?.trim() && !hasText) {
            segments = [...(m.segments || []), { kind: 'text', text: info.content }];
          }
          return {
            ...m, segments, streaming: false, provider: info.provider, status: 'done',
            usage: info.usage,
          };
        });
        setLoading(false);
      },
      onError: (err: string) => {
        updateMessage(botId, (m: any) => ({
          ...m, streaming: false, status: 'error',
          segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${err}` }],
        }));
        setLoading(false);
      },
    };

    try {
      const base = gatewayFallback.url;
      const rawProfile = localStorage.getItem('agentai.profile');
      const profile = rawProfile ? JSON.parse(rawProfile) : {};
      // v3.2: 传递浏览器实时状态给 gateway
      const enrichedProfile = {
        ...profile,
        _browserState: {
          url: browserState.activeTabUrl,
          title: browserState.pageTitle,
          elements: (browserState.elements || []).slice(0, 30),
          recentActions: (browserState.actionHistory || []).slice(0, 5),
          playwrightConnected: browserState.playwrightConnected,
        },
      };
      await apiStream(base + '/v1/chat', {
        message: textWithCtx,  // 注入浏览器状态
        model: activeModelId || 'agentai',
        workspace: workspaceDir || localStorage.getItem('agentai.workspace') || '',
        stream: true,
        mode: 'auto',
        userId: localStorage.getItem('agentai.deviceUserId') || `editor-${Date.now()}`,
        profile: enrichedProfile,
      }, handlers, controller.signal);
    } catch (e: any) {
      if (e.name !== 'AbortError') handlers.onError?.(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [draft, loading, activeModelId, workspaceDir, appendMessage, updateMessage]);

  // 🔧 修复: 追问卡片回答后自动发送 (与 ChatView 行为一致)
  useEffect(() => {
    if (pendingAnswer && !loading) {
      handleSend(pendingAnswer);
      setPendingAnswer(null);
    }
  }, [pendingAnswer, loading, handleSend]);

  const handleAbort = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleVoiceToggle = () => {
    if (recording) {
      stopSpeechRecognition();
      setRecording(false);
      return;
    }
    setRecording(true);
    startSpeechRecognition(
      (result) => { if (result.final) setDraft(prev => prev + result.text); },
      (err) => { console.warn('[Voice]', err); setRecording(false); },
      { lang: 'zh-CN', continuous: true, interim: true },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const iconBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 4, border: 'none',
    background: 'transparent', color: 'var(--muted-2)', cursor: 'pointer',
    fontSize: 11, padding: 0,
  };

  return (
    <div style={{
      width: '100%', height: '100%', background: '#121212',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* v3.2 浏览器实时状态栏 — 让用户知道 AI 看到的浏览器状态 */}
      <div
        onClick={() => openGlobalBrowser()}
        style={{
          padding: '4px 10px', borderBottom: '1px solid #333',
          display: 'flex', alignItems: 'center', gap: 6,
          background: browserState.activeTabUrl
            ? 'linear-gradient(90deg, rgba(205, 122, 58, 0.12) 0%, rgba(26, 26, 34, 0.4) 100%)'
            : '#161616',
          cursor: 'pointer',
          fontSize: 10, color: '#999',
        }}
        title="点击打开浏览器"
      >
        <GlobalOutlined style={{ color: browserState.activeTabUrl ? '#CD7A3A' : '#666' }} />
        {browserState.activeTabUrl ? (
          <>
            <span style={{ color: '#ccc', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {browserState.pageTitle || browserState.activeTabUrl}
            </span>
            <span style={{ color: '#666' }}>·</span>
            <span style={{ color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {browserState.activeTabUrl}
            </span>
            {browserState.elements.length > 0 && (
              <span style={{ color: '#666', fontSize: 9 }}>
                [{browserState.elements.length} 元素]
              </span>
            )}
            {browserState.playwrightConnected && (
              <span style={{ color: '#4caf50', fontSize: 9 }}>● 引擎已连接</span>
            )}
            {actionHistory.length > 0 && actionHistory[0].result === 'pending' && (
              <span style={{ color: '#CD7A3A', fontSize: 9 }}>⏳ {actionHistory[0].action}</span>
            )}
          </>
        ) : (
          <span style={{ color: '#666' }}>浏览器未启动 — 点击右下角 🌐 唤起</span>
        )}
        <span style={{ flex: 1 }} />
        <Button
          type="text" size="small"
          onClick={(e) => { e.stopPropagation(); openGlobalBrowser(); }}
          style={{ color: '#CD7A3A', fontSize: 10, padding: '0 6px', height: 18 }}
        >
          {browserState.activeTabUrl ? '查看' : '打开'}
        </Button>
      </div>

      {/* 头部 */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid #333',
        display: 'flex', alignItems: 'center', gap: 4,
        background: '#1a1a1a',
      }}>
        <img src="./logo1.jpg" alt="AI" style={{ width: 16, height: 16, borderRadius: 3, objectFit: 'cover' }} />
        <span style={{ fontSize: 11, color: '#ccc', fontWeight: 600, marginRight: 4 }}>AI 对话</span>
        <Select
          size="small"
          value={activeModelId}
          onChange={setActiveModel}
          style={{ flex: 1, fontSize: 10 }}
          variant="borderless"
          options={models.map(m => ({
            value: m.id,
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color, display: 'inline-block' }} />
                {m.label}
              </span>
            ),
          }))}
        />
        <Tooltip title="新对话">
          <Button size="small" type="text" style={{ color: '#888', height: 20, width: 20, fontSize: 9, padding: 0 }}
            onClick={() => clearMessages()}>
            <PlusOutlined style={{ fontSize: 10 }} />
          </Button>
        </Tooltip>
        <Button size="small" type="text" style={{ color: '#888', height: 20, width: 20, fontSize: 9, padding: 0 }}
          onClick={() => clearMessages()}>×</Button>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '4px 6px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {editorMsgs.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#666', fontSize: 11, padding: 20, marginTop: 20 }}>
            <img src="./logo1.jpg" alt="AI" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover', marginBottom: 8 }} />
            <div style={{ fontWeight: 600, color: '#888', fontSize: 12 }}>AI 对话</div>
            <div style={{ marginTop: 4, lineHeight: 1.6 }}>
              输入代码相关的问题<br />AI 可读取当前工作目录文件
            </div>
          </div>
        ) : (
          editorMsgs.map((msg) => (
            msg.role === 'user'
              ? <UserMsg key={msg.id} text={msg.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || ''} status={msg.status} />
              : <AssistantMsg key={msg.id} segments={msg.segments || []} pending={!!msg.streaming} status={msg.status} usage={msg.usage} />
          ))
        )}
      </div>

      {/* Ask User Card — AI 追问问卷 */}
      {askUserCard && (
        <AskUserCard
          question={askUserCard.question}
          options={askUserCard.options}
          onClose={() => {
            if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
            setLoading(false);
            setAskUserCard(null);
          }}
          onAnswer={(answer) => {
            const answerText = Array.isArray(answer) ? answer.join(', ') : answer;
            if (abortRef.current) {
              abortRef.current.abort();
              abortRef.current = null;
            }
            setLoading(false);
            setAskUserCard(null);
            // 🔧 修复: 自动发送答案 (与 ChatView 行为一致), 不再只填入输入框
            setPendingAnswer(answerText);
          }}
        />
      )}

      {/* 3D 可交互场景 (AI 调用 generate_3d_scene 生成) */}
      {scene3D && <Scene3DViewer scene={scene3D} />}

      {/* Composer 输入区 */}
      <div style={{ borderTop: '1px solid #333', padding: '4px 8px 6px', background: '#1a1a1a' }}>
        {/* 隐藏文件选择器 */}
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) setDraft(prev => prev + `\n[上传文件] ${Array.from(files).map(f => f.name).join(', ')} [/上传文件]`);
            e.target.value = '';
          }} />
        <input type="file" ref={imageInputRef} style={{ display: 'none' }} accept="image/*" multiple
          onChange={(e) => {
            const files = e.target.files;
            if (files?.length) setDraft(prev => prev + `\n[图片] ${Array.from(files).map(f => f.name).join(', ')} [/图片]`);
            e.target.value = '';
          }} />

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入 AI 指令... (Enter 发送)"
          rows={2}
          disabled={loading}
          style={{
            width: '100%', padding: '6px 8px',
            border: '1px solid #333', borderRadius: 8,
            background: '#0f0f0f', color: '#ddd',
            fontSize: 12, lineHeight: 1.4,
            outline: 'none', resize: 'none', fontFamily: 'inherit',
            minHeight: 32, maxHeight: 80, boxSizing: 'border-box',
          }}
        />

        {/* 底部图标栏 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 4 }}>
          <Tooltip title="上传文件">
            <span style={{ ...iconBtn }} onClick={() => fileInputRef.current?.click()}>
              <PaperClipOutlined style={{ fontSize: 11 }} />
            </span>
          </Tooltip>
          <Tooltip title="插入图片">
            <span style={{ ...iconBtn }} onClick={() => imageInputRef.current?.click()}>
              <PictureOutlined style={{ fontSize: 11 }} />
            </span>
          </Tooltip>
          <Tooltip title={webSearch ? '关闭联网搜索' : '开启联网搜索'}>
            <span onClick={() => setWebSearch(v => !v)} style={{
              ...iconBtn, color: webSearch ? '#4ade80' : undefined,
              background: webSearch ? 'rgba(74,222,128,0.12)' : undefined,
            }}>
              <GlobalOutlined style={{ fontSize: 11 }} />
            </span>
          </Tooltip>
          {srSupported ? (
            <Tooltip title={recording ? '停止录音' : '语音输入'}>
              <span onClick={handleVoiceToggle} style={{
                ...iconBtn,
                color: recording ? '#ef4444' : undefined,
                animation: recording ? 'pulse 1.2s ease-out infinite' : undefined,
              }}>
                <AudioOutlined style={{ fontSize: 11 }} />
              </span>
            </Tooltip>
          ) : (
            <Tooltip title="语音输入 (浏览器不支持)">
              <span style={{ ...iconBtn, opacity: 0.3, cursor: 'not-allowed' }}>
                <AudioMutedOutlined style={{ fontSize: 11 }} />
              </span>
            </Tooltip>
          )}

          <div style={{ flex: 1 }} />

          {loading ? (
            <span onClick={handleAbort} style={{
              padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
              background: '#ef4444', color: '#fff', fontSize: 10,
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              <StopOutlined style={{ fontSize: 10 }} /> 停止
            </span>
          ) : (
            <span onClick={() => handleSend()} style={{
              padding: '2px 8px', borderRadius: 4,
              cursor: draft.trim() ? 'pointer' : 'default',
              background: draft.trim() ? '#6366F1' : '#333',
              color: draft.trim() ? '#fff' : '#666',
              fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>
              <SendOutlined style={{ fontSize: 10 }} /> 发送
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
