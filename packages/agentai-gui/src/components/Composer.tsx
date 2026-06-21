/**
 * Composer — 智能输入区 (重写: 图标在对话框内底部)
 * -------------------------------------------------
 * 设计哲学:
 *   - 整个输入区是一个"对话框" (borderRadius 大圆角)
 *   - 所有图标/控件都在对话框内部底部 (BottomBar)
 *   - 文件上传: 选择后在输入框上方显示缩略图/文件名, 不污染对话框文本
 *   - 图片: 缩略图 + 点击放大, base64编码发送给AI
 *   - Excel/文档: 解析内容后作为附件发送
 */
import React, { useEffect, useMemo, useRef, useState, useCallback, useImperativeHandle, type KeyboardEvent, type RefObject, type DragEvent } from 'react';
import { Tooltip, Select, Image, message } from 'antd';
import { SendOutlined, StopOutlined, PaperClipOutlined, PictureOutlined, AudioOutlined, GlobalOutlined, CloseOutlined, FileExcelOutlined, FileTextOutlined, SoundOutlined, BellOutlined, BulbOutlined } from '@ant-design/icons';
import { useModeStore, type AppMode, MODE_CONFIG, MODE_ORDER } from '../store/modeStore';
import { useModelStore } from '../store/modelStore';
import { startSpeechRecognition, stopSpeechRecognition, isSpeechRecognitionSupported } from '../services/voice';
import { isTtsEnabled, setTtsEnabled, isWakeEnabled, startWakeWord, stopWakeWord } from '../services/VoiceService';
import VoiceSettings from './VoiceSettings';
import type { VoiceSettingsState } from './VoiceSettings';
import { parseFile, type ParsedAttachment } from '../services/file-parser';
import { PromptOptimizer } from './PromptOptimizer';

export type SlashCmd = { cmd: string; desc: string; run: () => void };

export interface ComposerHandle {
  /** 从外部设置输入框文本 (如点击建议/编辑消息) */
  setDraft: (text: string) => void;
  /** 获取当前输入框文本 */
  getDraft: () => string;
  /** 聚焦输入框 */
  focus: () => void;
}

type PopupKind = { kind: 'slash'; query: string } | { kind: 'at'; query: string; nonce: number } | null;

const MODE_ENTRIES = MODE_ORDER.map(k => {
  const c = MODE_CONFIG[k];
  return { k, label: c.label, dot: c.color, bg: c.color + '26' };
});

interface Props {
  onSend: (text: string) => void;
  onAbort: () => void;
  busy: boolean;
  disabled?: boolean;
  slashCommands: SlashCmd[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  workspaceDir?: string;
  queuedSends?: string[];
  onQueueWhileBusy?: (text: string) => void;
  onDequeueSend?: (i: number) => void;
  /** 提示词优化: 是否禁用 */
  optimizeDisabled?: boolean;
  onBrowseWorkspace?: () => void;
  /** 附件列表 (由Composer管理, 外部通过ref获取) */
  attachments?: ParsedAttachment[];
  onAttachmentsChange?: (files: ParsedAttachment[]) => void;
  /** 是否开启思考模式 */
  thinking?: boolean;
  onThinkingChange?: (v: boolean) => void;
}

const ComposerBase = ({
  onSend, onAbort, busy, disabled,
  slashCommands, textareaRef,
  workspaceDir, queuedSends, onQueueWhileBusy, onDequeueSend,
  onBrowseWorkspace,
  optimizeDisabled,
  attachments = [], onAttachmentsChange,
  thinking = false, onThinkingChange,
}: Props, ref: React.Ref<ComposerHandle>) => {
  const { mode, setMode, suggestedMode, suggestionReason, acceptSuggestion, clearSuggestion } = useModeStore();
  const activeModeConfig = MODE_CONFIG[mode];
  const { activeModelId, setActive: setActiveModel, models } = useModelStore();
  const [draft, setDraft] = useState('');
  const [popup, setPopup] = useState<PopupKind>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [parsing, setParsing] = useState(false); // 文件解析中

  // URL 检测: 从 draft 中提取链接, 显示为链接卡片
  const detectedUrls = useMemo(() => {
    const urlRegex = /https?:\/\/[^\s<>"']+/gi;
    const matches = draft.match(urlRegex);
    if (!matches) return [];
    return [...new Set(matches)].map(url => {
      let label = '链接';
      try {
        const u = new URL(url);
        const host = u.hostname.replace('www.', '');
        if (host.includes('weixin.qq.com') || host.includes('mp.weixin')) label = '微信文章';
        else if (host.includes('github.com')) label = 'GitHub';
        else if (host.includes('zhihu.com')) label = '知乎';
        else if (host.includes('juejin.cn')) label = '掘金';
        else if (host.includes('csdn.net')) label = 'CSDN';
        else if (host.includes('bilibili.com')) label = 'B站';
        else if (host.includes('xiaohongshu.com')) label = '小红书';
        else if (host.includes('youtube.com')) label = 'YouTube';
        else if (host.includes('twitter.com') || host.includes('x.com')) label = 'X/Twitter';
        else if (host.includes('stackoverflow.com')) label = 'StackOverflow';
        else label = host.split('.').slice(-2, -1)[0] || host;
      } catch { /* invalid url */ }
      return { url, label };
    });
  }, [draft]);
  const [ttsOn, setTtsOn] = useState(isTtsEnabled());
  const [wakeOn, setWakeOn] = useState(isWakeEnabled());
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettingsState>(() => {
    try {
      const raw = localStorage.getItem('agentai.tts.settings');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { enabled: isTtsEnabled(), engine: 'browser', voice: '', rate: 1.0, pitch: 1.0 };
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const srSupported = isSpeechRecognitionSupported();

  // 暴露 setDraft / getDraft / focus 给父组件 (用于建议提示/编辑消息)
  useImperativeHandle(ref, () => ({
    setDraft: (text: string) => setDraft(text),
    getDraft: () => draft,
    focus: () => textareaRef.current?.focus(),
  }), [draft]);

  const activeModel = models.find(m => m.id === activeModelId);

  // 模型切换时的密钥检查
  const handleModelChange = (modelId: string) => {
    const targetModel = models.find(m => m.id === modelId);
    if (targetModel) {
      const hasKey = !!localStorage.getItem(targetModel.apiKeyEnv);
      if (!hasKey && targetModel.isCommercial) {
        message.warning({ content: `「${targetModel.label}」需配置密钥，请前往 设置 → 模型配置 输入密钥后使用`, duration: 5, key: 'missing-key' });
      }
    }
    setActiveModel(modelId);
  };

  /* ---- 粘贴 & 拖拽文件处理 ---- */
  const [dragOver, setDragOver] = useState(false);

  /** 处理粘贴事件: Ctrl+V 粘贴图片/文件 — 绑定到 textarea 和外层容器 */
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;

    const fileItems: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      // 检查两种情形: kind='file' 或 kind='text' 但 type 以 image/ 开头
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) fileItems.push(file);
      } else if (item.type.startsWith('image/')) {
        // 部分浏览器把剪贴板图片视为 text/plain + 包含 base64
        const blob = e.clipboardData?.files?.[i];
        if (blob) fileItems.push(blob);
      }
    }
    // 也检查 clipboardData.files (更直接)
    if (e.clipboardData?.files?.length) {
      for (let i = 0; i < e.clipboardData.files.length; i++) {
        const f = e.clipboardData.files[i];
        if (f.type.startsWith('image/') && !fileItems.find(x => x.name === f.name && x.size === f.size)) {
          fileItems.push(f);
        }
      }
    }
    if (fileItems.length === 0) return;

    e.preventDefault();
    e.stopPropagation();
    setParsing(true);
    const parsed = await Promise.all(fileItems.map(f => parseFile(f)));
    onAttachmentsChange?.([...attachments, ...parsed]);
    setParsing(false);
  }, [attachments, onAttachmentsChange]);

  /** 拖拽文件: 拖入 */
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragOver) setDragOver(true);
  }, [dragOver]);

  /** 拖拽文件: 离开 */
  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  /** 拖拽文件: 释放 */
  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = e.dataTransfer?.files;
    if (!files?.length) return;

    setParsing(true);
    const parsed = await Promise.all(Array.from(files).map(f => parseFile(f)));
    onAttachmentsChange?.([...attachments, ...parsed]);
    setParsing(false);
  }, [attachments, onAttachmentsChange]);

  /* ---- popup items ---- */
  const slashItems = useMemo(() => {
    if (!popup || popup.kind !== 'slash') return [];
    const q = popup.query.toLowerCase();
    return q ? slashCommands.filter(c => c.cmd.toLowerCase().includes(q)) : slashCommands;
  }, [popup, slashCommands]);

  const items = popup?.kind === 'slash' ? slashItems : [];
  useEffect(() => { setActiveIdx(0); }, [items.length]);

  const prevDraftRef = useRef(draft);
  useEffect(() => {
    const prev = prevDraftRef.current;
    prevDraftRef.current = draft;
    if (draft === '/' && prev !== '/') setPopup({ kind: 'slash', query: '' });
  }, [draft]);

  /* ---- handlers ---- */
  const handleChange = (v: string) => {
    setDraft(v);
    const trail = v.match(/(^|\s)([/@])([^\s]*)$/);
    if (trail) {
      const sigil = trail[2];
      const query = trail[3] ?? '';
      if (sigil === '/') setPopup({ kind: 'slash', query });
      else setPopup({ kind: 'at', query, nonce: Date.now() });
    } else if (popup) setPopup(null);
  };

  const pickItem = (idx: number) => {
    const it = items[idx];
    if (!it || !popup) return;
    if (popup.kind === 'slash') {
      const cmd = (it as SlashCmd).cmd;
      const next = draft.replace(/[/][^\s]*$/, '').trimEnd();
      setDraft(next);
      (it as SlashCmd).run();
    }
    setPopup(null);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (popup && items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, items.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickItem(activeIdx); return; }
      if (e.key === 'Escape') { setPopup(null); e.preventDefault(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const hasContent = draft.trim() || attachments.length > 0;
      if (!hasContent) return;
      if (busy) {
        // 排队，不中止前任务
        if (draft.trim()) {
          onQueueWhileBusy?.(draft.trim());
          setDraft('');
        }
      } else {
        onSend(draft);
        setDraft('');
      }
    }
  };

  /* ---- Voice recording ---- */
  const handleVoiceToggle = () => {
    if (recording) {
      stopSpeechRecognition();
      setRecording(false);
      return;
    }
    setRecording(true);
    startSpeechRecognition(
      (result) => { if (result.final) setDraft(draft + result.text); },
      (err) => { console.warn('[Voice]', err); setRecording(false); },
      { lang: 'zh-CN', continuous: true, interim: true },
    );
  };

  return (
    <div style={{
      position: 'relative', borderTop: '1px solid var(--border)',
      background: 'var(--bg-2)',
      ...(dragOver ? { borderTopColor: '#4ade80' } : {}),
    }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {/* 拖拽高亮提示 */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(74,222,128,0.08)',
          border: '2px dashed #4ade80',
          borderRadius: 8, margin: 4,
          pointerEvents: 'none',
          fontSize: 14, fontWeight: 600, color: '#4ade80',
          letterSpacing: 1,
        }}>
          📎 释放文件以上传
        </div>
      )}
      {/* Queued sends chips */}
      {queuedSends && queuedSends.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: 'var(--muted)', paddingTop: 2 }}>排队 ({queuedSends.length}):</span>
          {queuedSends.map((t, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 8px', borderRadius: 4, fontSize: 11,
              background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)',
            }}>
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
              {onDequeueSend && <span onClick={() => onDequeueSend(i)} style={{ cursor: 'pointer', color: 'var(--muted-2)', marginLeft: 2 }}>×</span>}
            </span>
          ))}
        </div>
      )}

      {/* ═══════ 主对话输入框 ═══════ */}
      {/* 模式推荐提示条 */}
      {suggestedMode && suggestedMode !== mode && (
        <div style={{
          margin: '0 12px 4px',
          padding: '6px 12px',
          borderRadius: 8,
          background: MODE_CONFIG[suggestedMode].color + '18',
          border: `1px solid ${MODE_CONFIG[suggestedMode].color}44`,
          fontSize: 12,
          color: '#ddd',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: MODE_CONFIG[suggestedMode].color, flexShrink: 0 }}>💡</span>
          <span style={{ flex: 1 }}>AI 建议切换到「{MODE_CONFIG[suggestedMode].label}」模式 — {suggestionReason}</span>
          <span
            onClick={() => { acceptSuggestion(); }}
            style={{ color: MODE_CONFIG[suggestedMode].color, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
          >切换</span>
          <span
            onClick={() => { clearSuggestion(); }}
            style={{ color: 'var(--muted-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >忽略</span>
        </div>
      )}

      <div style={{
        margin: '6px 12px 8px',
        borderRadius: 12,
        border: mode !== 'auto' ? `1px solid ${activeModeConfig.color}44` : '1px solid var(--border)',
        background: 'var(--panel)',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        {/* URL 链接卡片 */}
        {detectedUrls.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 12px 0', borderBottom: '1px solid var(--border)' }}>
            {detectedUrls.map((u, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 12, fontSize: 11,
                background: 'rgba(99,102,241,0.1)', color: 'var(--accent)',
                border: '1px solid rgba(99,102,241,0.2)',
                maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 10 }}>🔗</span>
                <span style={{ fontWeight: 600 }}>{u.label}</span>
              </span>
            ))}
          </div>
        )}
        {/* Textarea */}
        <textarea
          ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          placeholder={activeModeConfig.placeholder}
          rows={2}
          disabled={false}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: 'none',
            borderBottom: mode !== 'auto' ? `1px solid ${activeModeConfig.color}44` : 'none',
            background: 'transparent',
            color: 'var(--fg)',
            fontSize: 13, lineHeight: 1.5,
            outline: 'none', resize: 'none', fontFamily: 'inherit',
            minHeight: 36, maxHeight: 120,
            boxSizing: 'border-box',
          }}
        />

        {/* ═══ 附件预览区 (输入框上方, 不污染文本) ═══ */}
        {attachments.length > 0 && (
          <div style={{
            display: 'flex', gap: 6, padding: '4px 8px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-2)',
            flexWrap: 'wrap', alignItems: 'center',
          }}>
            {attachments.map((att, i) => (
              <div key={i} style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 6px', borderRadius: 6,
                background: att.kind === 'image' ? 'rgba(99,102,241,0.08)' : 'var(--panel)',
                border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--fg-2)',
              }}>
                {/* 图片缩略图 */}
                {att.kind === 'image' && att.dataUrl && (
                  <Image
                    src={att.dataUrl}
                    alt={att.name}
                    width={32}
                    height={32}
                    style={{ borderRadius: 3, objectFit: 'cover', cursor: 'pointer' }}
                    preview={{ mask: null }}
                  />
                )}
                {/* Excel图标 */}
                {att.kind === 'table' && <FileExcelOutlined style={{ color: '#22c55e', fontSize: 13 }} />}
                {/* 文本文件图标 */}
                {att.kind === 'text' && <FileTextOutlined style={{ color: '#60a5fa', fontSize: 13 }} />}
                {/* 文件名 */}
                <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
                {/* 删除按钮 */}
                <span
                  onClick={() => onAttachmentsChange?.(attachments.filter((_, j) => j !== i))}
                  style={{ cursor: 'pointer', color: 'var(--muted-2)', fontSize: 10, marginLeft: 2 }}
                >
                  <CloseOutlined style={{ fontSize: 9 }} />
                </span>
              </div>
            ))}
            {parsing && <span style={{ fontSize: 10, color: 'var(--muted)' }}>解析中...</span>}
          </div>
        )}

        {/* ═══ Bottom Bar (图标在对话框内底部) ═══ */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '4px 8px 6px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-2)',
        }}>
          {/* 隐藏的文件/图片选择器 */}
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} multiple
            onChange={async (e) => {
              const files = e.target.files;
              if (!files?.length) return;
              setParsing(true);
              const parsed = await Promise.all(Array.from(files).map(f => parseFile(f)));
              onAttachmentsChange?.([...attachments, ...parsed]);
              setParsing(false);
              e.target.value = '';
            }} />
          <input type="file" ref={imageInputRef} style={{ display: 'none' }} accept="image/*" multiple
            onChange={async (e) => {
              const files = e.target.files;
              if (!files?.length) return;
              setParsing(true);
              const parsed = await Promise.all(Array.from(files).map(f => parseFile(f)));
              onAttachmentsChange?.([...attachments, ...parsed]);
              setParsing(false);
              e.target.value = '';
            }} />

          {/* Left: 附件/图片/语音 */}
          <Tooltip title="上传文件">
            <button style={iconBtn} onClick={() => fileInputRef.current?.click()}>
              <PaperClipOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
          <Tooltip title="插入图片">
            <button style={iconBtn} onClick={() => imageInputRef.current?.click()}>
              <PictureOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
          <Tooltip title={webSearch ? '关闭联网搜索' : '开启联网搜索'}>
            <button onClick={() => setWebSearch(v => !v)} style={{
              ...iconBtn,
              color: webSearch ? '#4ade80' : undefined,
              background: webSearch ? 'rgba(74,222,128,0.12)' : undefined,
            }}>
              <GlobalOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
          {/* 提示词优化: 与其他图标并齐 */}
          <PromptOptimizer
            draft={draft}
            onApply={(text) => setDraft(text)}
            disabled={optimizeDisabled}
          />
          {srSupported && (
            <Tooltip title={recording ? '停止' : '语音输入'}>
              <button onClick={handleVoiceToggle} style={{
                ...iconBtn,
                color: recording ? '#ef4444' : undefined,
                animation: recording ? 'pulse 1.2s ease-out infinite' : undefined,
              }}>
                <AudioOutlined style={{ fontSize: 12 }} />
              </button>
            </Tooltip>
          )}
          {/* 音色选择设置 */}
          <VoiceSettings
            state={voiceSettings}
            onChange={(s) => {
              setVoiceSettings(s);
              setTtsOn(s.enabled);
            }}
          />
          {/* 语音唤醒开关 */}
          <Tooltip title={wakeOn ? '关闭语音唤醒' : '开启语音唤醒'}>
            <button onClick={() => { const v = !wakeOn; v ? startWakeWord() : stopWakeWord(); setWakeOn(v); }} style={{
              ...iconBtn,
              color: wakeOn ? '#F59E0B' : undefined,
              background: wakeOn ? 'rgba(245,158,11,0.12)' : undefined,
            }}>
              <BellOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
          {/* 思考模式开关 (通用: 根据模型自动适配思考机制) */}
          <Tooltip title={thinking ? '关闭深度思考' : '开启深度思考 (编码/推理/Agent任务推荐)'}>
            <button onClick={() => onThinkingChange?.(!thinking)} style={{
              ...iconBtn,
              color: thinking ? '#8B5CF6' : undefined,
              background: thinking ? 'rgba(139,92,246,0.12)' : undefined,
            }}>
              <BulbOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>

          <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />

          {/* 模型选择器 (拉宽显示完整模型名) */}
          {models.length > 0 && (
            <Select
              size="small"
              value={activeModelId}
              onChange={handleModelChange}
              style={{ width: 180, fontSize: 11 }}
              variant="borderless"
              options={models.map(m => ({
                value: m.id,
                label: (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: m.color || '#888', display: 'inline-block',
                    }} />
                    {m.label}
                  </span>
                ),
              }))}
            />
          )}

          <span style={{ flex: 1 }} />

          {/* 右侧: 模式切换 + 发送/中止 */}
          {MODE_ENTRIES.map(({ k, label, dot }) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 2,
                padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: mode === k ? 600 : 400,
                color: mode === k ? '#fff' : 'var(--muted-2)',
                background: mode === k ? dot : 'transparent',
                border: 'none', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}

          <span style={{ width: 1, height: 14, background: 'var(--border)', margin: '0 4px' }} />

          {/* 发送/中止 */}
          {busy ? (
            <button onClick={onAbort} style={sendBtnStyle}>
              <StopOutlined style={{ fontSize: 14 }} />
            </button>
          ) : (
            <button
              onClick={() => { onSend(draft); setDraft(''); }}
              disabled={disabled || (!draft.trim() && attachments.length === 0)}
              style={{
                ...sendBtnStyle,
                background: draft.trim() || attachments.length > 0 ? 'var(--accent)' : 'var(--panel)',
                color: draft.trim() || attachments.length > 0 ? '#fff' : 'var(--muted-2)',
              }}
            >
              <SendOutlined style={{ fontSize: 14 }} />
            </button>
          )}
        </div>
      </div>

      {/* --- Popup overlay --- */}
      {popup && items.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 12, right: 12,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 4,
          maxHeight: 200, overflowY: 'auto', zIndex: 100,
        }}>
          {items.map((item, i) => {
            const cmd = item as SlashCmd;
            return (
              <div
                key={cmd.cmd}
                data-active={i === activeIdx}
                onClick={() => pickItem(i)}
                onMouseEnter={() => setActiveIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, color: 'var(--fg-2)',
                  background: i === activeIdx ? 'var(--panel-2)' : 'transparent',
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: 4,
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>/</span>
                <span style={{ fontWeight: 600 }}>{cmd.cmd}</span>
                <span style={{ color: 'var(--muted-2)', fontSize: 11 }}>{cmd.desc}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Composer = React.forwardRef(ComposerBase);

const iconBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 4,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', border: 'none', background: 'transparent',
  color: 'var(--muted-2)', transition: 'all 0.15s',
};

const sendBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', cursor: 'pointer', flexShrink: 0,
  transition: 'all 0.15s',
};
