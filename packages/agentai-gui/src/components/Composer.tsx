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
import { Tooltip, Select, Image, message, Dropdown } from 'antd';
import { SendOutlined, StopOutlined, PaperClipOutlined, PictureOutlined, AudioOutlined, GlobalOutlined, CloseOutlined, FileExcelOutlined, FileTextOutlined, BellOutlined, BulbOutlined, MoreOutlined, DesktopOutlined, ThunderboltOutlined, GithubOutlined } from '@ant-design/icons';
import { MessageOutlined as QQIcon } from '@ant-design/icons';
import { useModeStore, MODE_CONFIG, MODE_ORDER } from '../store/modeStore';
import { useModelStore } from '../store/modelStore';
import { GATEWAY_HTTP } from '../services/config';
import { startSpeechRecognition, stopSpeechRecognition, isSpeechRecognitionSupported } from '../services/voice';
import { isTtsEnabled, setTtsEnabled, isWakeEnabled, startWakeWord, stopWakeWord } from '../services/VoiceService';
import VoiceSettings from './VoiceSettings';
import type { VoiceSettingsState } from './VoiceSettings';
import { parseFile, type ParsedAttachment } from '../services/file-parser';
import { PromptOptimizer } from './PromptOptimizer';
import { RemoteEnvironmentButton } from './RemoteEnvironmentButton';

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
  const { activeModelId, setActive: setActiveModel, models, commercialKeys, chatMode } = useModelStore();
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
  const [ttsOn] = useState(isTtsEnabled());
  const [wakeOn, setWakeOn] = useState(isWakeEnabled());
  const [optimizeOpen, setOptimizeOpen] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
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
// [Phase1-P0-fix] 修复: 商用模型无密钥时显式return阻止切换 + 免费模型直接放行
const handleModelChange = (modelId: string) => {
const targetModel = models.find(m => m.id === modelId);
if (!targetModel) return;

// 免费模型(agentai/zhipu)无需密钥，直接切换
const isFreeModel = (m: typeof targetModel) => m.id === 'agentai' || m.id === 'zhipu';
if (isFreeModel(targetModel)) {
setActiveModel(modelId);
return;
}

// 商用模型检查密钥
const apiKeyEnv = targetModel.apiKeyEnv || `${targetModel.id.toUpperCase()}_API_KEY`;
const hasKey = !!localStorage.getItem(apiKeyEnv)
|| !!useModelStore.getState().commercialKeys?.[apiKeyEnv];

if (!hasKey && targetModel.isCommercial) {
message.warning({
content: `「${targetModel.label}」需配置API密钥才能使用，请前往 设置 → 模型配置 输入密钥`,
duration: 6,
key: 'missing-key',
});
return; // ← 显式return：无密钥时不切换模型
}

// 有密钥的商用模型或非商用自定义模型 → 正常切换
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

  // @文件选择: 从工作区获取文件列表
  const [atFiles, setAtFiles] = useState<Array<{ name: string; path: string; isDir: boolean }>>([]);
  useEffect(() => {
    if (!popup || popup.kind !== 'at') { setAtFiles([]); return; }
    const q = popup.query.toLowerCase();
    const ws = workspaceDir || '';
    if (!ws) return;
    // 防抖 300ms
    const timer = setTimeout(async () => {
      try {
        const base = GATEWAY_HTTP;
        const r = await fetch(`${base}/v1/fs/list?dir=${encodeURIComponent(ws)}`);
        if (!r.ok) return;
        const data = await r.json();
        const files = (data.files || data || [])
          .filter((f: any) => {
            const name = (f.name || f.path || '').toLowerCase();
            return !name.startsWith('.') && name !== 'node_modules';
          })
          .filter((f: any) => !q || (f.name || f.path || '').toLowerCase().includes(q))
          .slice(0, 15);
        setAtFiles(files.map((f: any) => ({
          name: f.name || f.path,
          path: f.path || f.name,
          isDir: !!f.isDirectory || !!f.isDir,
        })));
      } catch { /* fetch error */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [popup, workspaceDir]);

  const items: Array<SlashCmd | { name: string; path: string; isDir: boolean }> =
    popup?.kind === 'slash' ? slashItems
    : popup?.kind === 'at' ? atFiles
    : [];
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
    } else if (popup.kind === 'at') {
      // 插入文件路径到 draft
      const file = it as { name: string; path: string };
      const next = draft.replace(/@[^\s]*$/, `@${file.path} `);
      setDraft(next);
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
      ...(dragOver ? { borderTopColor: 'var(--success)' } : {}),
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
          border: '2px dashed var(--success)',
          borderRadius: 8, margin: 4,
          pointerEvents: 'none',
          fontSize: 14, fontWeight: 600, color: 'var(--success)',
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
          color: 'var(--fg-2)',
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

      <div
        className="composer-focus-container"
        style={{
        margin: '6px 12px 8px',
        borderRadius: 12,
        border: mode !== 'auto' ? `1px solid ${activeModeConfig.color}44` : '1px solid var(--border)',
        background: 'var(--panel)',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}>
        {/* 对话改图模式提示 */}
        {chatMode === 'image_edit' && (
          <div style={{
            padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8,
            background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(236,72,153,0.08))',
            borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--accent)',
          }}>
            <PictureOutlined style={{ fontSize: 14 }} />
            <span>🎨 对话改图模式 — 上传图片后输入修改指令</span>
            <button
              className="icon-btn-sm"
              onClick={() => imageInputRef.current?.click()}
              style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'var(--fg)', borderRadius: 4, padding: '2px 10px', fontSize: 11, border: 'none', cursor: 'pointer' }}
            >
              上传图片
            </button>
          </div>
        )}
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
                {att.kind === 'table' && <FileExcelOutlined style={{ color: 'var(--success)', fontSize: 13 }} />}
                {/* 文本文件图标 */}
                {att.kind === 'text' && <FileTextOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />}
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

        {/* ═══ Bottom Bar (精简版: 5核心控件 + 更多菜单) ═══ */}
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

          {/* ── 核心控件 (左): 附件 + 图片 + 更多 ── */}
          <Tooltip title="上传文件">
            <button className="icon-btn-sm" onClick={() => fileInputRef.current?.click()}>
              <PaperClipOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>
          <Tooltip title="插入图片">
            <button className="icon-btn-sm" onClick={() => imageInputRef.current?.click()}>
              <PictureOutlined style={{ fontSize: 12 }} />
            </button>
          </Tooltip>

          {/* ── 更多菜单 (收给低频控件) ── */}
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            menu={{
              items: [
                {
                  key: 'websearch',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <GlobalOutlined style={{ color: webSearch ? 'var(--success)' : 'var(--muted-2)' }} />
                      {webSearch ? '关闭联网搜索' : '开启联网搜索'}
                    </span>
                  ),
                  onClick: () => setWebSearch(v => !v),
                },
                {
                  key: 'thinking',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <BulbOutlined style={{ color: thinking ? 'var(--violet)' : 'var(--muted-2)' }} />
                      {thinking ? '关闭深度思考' : '开启深度思考'}
                    </span>
                  ),
                  onClick: () => onThinkingChange?.(!thinking),
                },
                ...(srSupported ? [{
                  key: 'voice',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <AudioOutlined style={{ color: recording ? 'var(--danger)' : 'var(--muted-2)' }} />
                      {recording ? '停止语音输入' : '开始语音输入'}
                    </span>
                  ),
                  onClick: handleVoiceToggle,
                }] : []),
                {
                  key: 'optimize',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <BulbOutlined style={{ color: 'var(--muted-2)' }} />
                      优化提示词
                    </span>
                  ),
                  onClick: () => {
                    setOptimizeOpen(true);
                  },
                  disabled: optimizeDisabled || !draft.trim(),
                },
                { type: 'divider' as const },
                // 语音播报已移到对话框内部底部栏 (2026-07-31)
                {
                  key: 'wake',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <BellOutlined style={{ color: wakeOn ? 'var(--warning)' : 'var(--muted-2)' }} />
                      {wakeOn ? '关闭语音唤醒' : '开启语音唤醒'}
                    </span>
                  ),
                  onClick: () => {
                    const v = !wakeOn; v ? startWakeWord() : stopWakeWord(); setWakeOn(v);
                  },
                },
              ],
            }}
          >
            <Tooltip title="更多功能">
              <button className="icon-btn-sm" style={{
                color: (webSearch || thinking || recording || ttsOn || wakeOn) ? 'var(--accent)' : undefined,
              }}>
                <MoreOutlined style={{ fontSize: 12 }} />
              </button>
            </Tooltip>
          </Dropdown>

          <span className="ui-divider" />

          {/* ── 模型选择器 (有密钥即显示, 工厂组折叠) ── */}
          {(() => {
            // 过滤: 免费或有密钥或已启用的自定义模型
            const isFree = (m: typeof models[0]) => m.id === 'agentai' || m.id === 'zhipu';
            const hasKey = (m: typeof models[0]) => {
              const envVar = m.apiKeyEnv || `${m.id.toUpperCase()}_API_KEY`;
              return !!commercialKeys[envVar] || !!localStorage.getItem(envVar) || !!localStorage.getItem(`__agentai_key_${m.provider || m.id}`);
            };
            const visibleModels = models.filter(m => isFree(m) || hasKey(m) || m.enabled);
            if (visibleModels.length === 0) return null;

            // 工厂组按 provider 聚合, 独立模型各自一组
            const isFactory = (m: typeof models[0]) => ['superapi', 'sensenova', 'longcat'].includes(m.provider || '');
            const groupMap = new Map<string, { label: string; color: string; models: typeof models; isFactory: boolean }>();
            for (const m of visibleModels) {
              const factory = isFactory(m);
              const gKey = factory ? (m.provider || 'other') : m.id;
              const gLabel = factory ? (m.groupLabel || m.label) : m.label;
              if (!groupMap.has(gKey)) groupMap.set(gKey, { label: gLabel, color: m.color, models: [], isFactory: factory });
              groupMap.get(gKey)!.models.push(m);
            }
            const groupedArr = Array.from(groupMap.entries());

            return (
              <Select
                size="small"
                value={visibleModels.some(m => m.id === activeModelId) ? activeModelId : visibleModels[0]?.id}
                onChange={handleModelChange}
                style={{ width: 170, fontSize: 11 }}
                variant="borderless"
                popupMatchSelectWidth={false}
                getPopupContainer={() => document.body}
                options={groupedArr.map(([gKey, g]) => ({
                  label: <span style={{ fontSize: 9, color: 'var(--muted-2)', fontWeight: 600 }}>{g.label} ({g.models.length})</span>,
                  title: g.label,
                  options: [
// NVIDIA Auto 选项已移除
                    ...g.models.map(m => ({
                      value: m.id,
                      label: (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color || '#888', display: 'inline-block' }} />
                          {m.label}
                        </span>
                      ),
                    })),
                  ],
                }))}
              />
            );
          })()}

          <span style={{ flex: 1 }} />

          {/* ── 模式切换 (紧凑) ── */}
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

          <span className="ui-divider" />

          {/* ── 连接器下拉菜单 (类似 Claude Connectors) ── */}
          <ConnectorsDropdown />

          <span className="ui-divider" />

          {/* ── 语音设置图标 ── */}
          <Tooltip title="语音设置">
            <button
              className="icon-btn-sm"
              onClick={() => setVoiceSettingsOpen(true)}
              style={{ color: 'var(--muted-2)' }}
            >
              <MoreOutlined style={{ fontSize: 10 }} />
            </button>
          </Tooltip>

          <span className="ui-divider" />

          {/* ── 远程环境按钮 ── */}
          <RemoteEnvironmentButton />

          {/* ── 发送/中止 ── */}
          {busy ? (
            <button onClick={onAbort} className="send-btn" style={{ background: 'var(--danger)' }}>
              <StopOutlined style={{ fontSize: 14, color: 'var(--fg)' }} />
            </button>
          ) : (
            <button
              onClick={() => { onSend(draft); setDraft(''); }}
              disabled={disabled || (!draft.trim() && attachments.length === 0)}
              className="send-btn"
              style={{
                background: draft.trim() || attachments.length > 0 ? 'var(--accent)' : 'var(--panel)',
                color: draft.trim() || attachments.length > 0 ? '#fff' : 'var(--muted-2)',
              }}
            >
              <SendOutlined style={{ fontSize: 14 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── PromptOptimizer 浮窗 ── */}
      {optimizeOpen && (
        <PromptOptimizer
          draft={draft}
          onApply={(text) => { setDraft(text); setOptimizeOpen(false); }}
          disabled={optimizeDisabled}
        />
      )}

      {/* ── VoiceSettings 浮窗 ── */}
      <VoiceSettings state={voiceSettings} onChange={setVoiceSettings} externalOpen={voiceSettingsOpen} onExternalOpenConsumed={() => setVoiceSettingsOpen(false)} />

      {/* --- Popup overlay --- */}
      {popup && items.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 12, right: 12,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 8, boxShadow: 'var(--shadow-lg)', padding: 4,
          maxHeight: 200, overflowY: 'auto', zIndex: 100,
        }}>
          <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--muted)', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
            {popup.kind === 'slash' ? '/ 命令' : '@ 选择文件'}
          </div>
          {items.map((item, i) => {
            const isSlash = popup.kind === 'slash';
            const label = isSlash ? (item as SlashCmd).cmd : (item as any).name;
            const desc = isSlash ? (item as SlashCmd).desc : ((item as any).isDir ? '📁 目录' : '📄 文件');
            return (
              <div
                key={label}
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
                }}>{isSlash ? '/' : '@'}</span>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ color: 'var(--muted-2)', fontSize: 11 }}>{desc}</span>
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

/* ════════════════ ConnectorsDropdown — 类似 Claude Connectors 的下拉菜单 ════════════════ */

/** 连接器定义 */
interface ConnectorDef {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'error';
  /** 后端 API 路径 (toggle) */
  toggleApi: string;
}

const ConnectorsDropdown: React.FC = () => {
  const [connectors, setConnectors] = useState<ConnectorDef[]>([
    // ── Android 设备控制 ──
    {
      id: 'android',
      name: 'Android 手机',
      icon: <DesktopOutlined />,
      description: '通用手机自动化 — AI操作微信/抖音/小红书/快手等任何App。需安装Another桌面应用+连接Android设备(USB调试开启)。MCP Server运行在localhost:7070。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/android',
    },
    // ── 浏览器控制 ──
    {
      id: 'browser',
      name: '浏览器控制',
      icon: <ThunderboltOutlined />,
      description: 'AI操控浏览器 — 自动浏览网页、填表、截图、提取数据。需启动Browser Engine服务。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/browser',
    },
    // ── QQ Bot ──
    {
      id: 'qq-bot',
      name: 'QQ Bot',
      icon: <QQIcon />,
      description: 'AI通过QQ接收消息并自动回复。需配置go-cqhttp反向WS连接。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/qq-bot',
    },
    // ── 微信公众号自动化 ──
    {
      id: 'wechat-automation',
      name: '公众号运营',
      icon: <ThunderboltOutlined />,
      description: 'AI全自动运营公众号: 对标拆解→写稿→deAI→质量闸门→配图→发布草稿箱。需配置DeepSeek API Key + 公众号AppID/AppSecret。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/wechat-automation',
    },
    // ── SketchUp 3D 建模 ──
    {
      id: 'sketchup',
      name: 'SketchUp建模',
      icon: <PictureOutlined />,
      description: 'AI直接操控SketchUp进行建模操作(建筑/室内/家具设计)。需安装sketchup-mcp2+Ruby扩展+SketchUp已打开。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/sketchup',
    },
    // 语音播报 TTS 已移至底部栏独立按钮 (2026-07-31)，不再在连接器中显示
    // 原因: 避免与底部栏 SoundOutlined 图标重复造成混淆
    // ── 语音唤醒 ──
    {
      id: 'wake-word',
      name: '语音唤醒',
      icon: <BellOutlined />,
      description: '随时语音唤醒AI助手。需配置麦克风权限和唤醒词模型。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/wake-word',
    },
    // ── 音乐播放 ──
    {
      id: 'music',
      name: '音乐播放',
      icon: <AudioOutlined />,
      description: 'AI根据对话内容推荐并播放音乐。使用Moss音乐代理服务。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/music',
    },
    // ── Git 版本控制 ──
    {
      id: 'git',
      name: 'Git版本控制',
      icon: <GithubOutlined />,
      description: 'AI自动提交代码、创建分支、推送远程仓库。需配置Git SSH密钥。',
      enabled: false,
      status: 'offline',
      toggleApi: '/api/connectors/git',
    },
  ]);
  const [loading, setLoading] = useState(false);

  // 加载连接器状态
  useEffect(() => {
    fetch('/api/connectors/status')
      .then(r => r.json())
      .then(data => {
        setConnectors(prev => prev.map(c => ({
          ...c,
          enabled: data[c.id]?.enabled ?? c.enabled,
          status: data[c.id]?.status ?? c.status,
        })));
      })
      .catch(() => {});
  }, []);

  const toggleConnector = async (id: string) => {
    setLoading(true);
    try {
      const conn = connectors.find(c => c.id === id);
      if (!conn) return;
      
      const response = await fetch(conn.toggleApi, { method: 'POST' });
      if (response.ok) {
        setConnectors(prev => prev.map(c =>
          c.id === id ? { ...c, enabled: !c.enabled, status: !c.enabled ? 'online' : 'offline' } : c
        ));
      }
    } catch (e) {
      console.warn('[ConnectorsDropdown] Toggle failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#52c41a';
      case 'offline': return 'var(--muted-2)';
      case 'error': return '#ff4d4f';
      default: return 'var(--muted-2)';
    }
  };

  const items = connectors.map(conn => ({
    key: conn.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
        <span style={{ color: conn.enabled ? 'var(--accent)' : 'var(--muted-2)' }}>{conn.icon}</span>
        <span style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{conn.name}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{conn.description}</div>
        </span>
        <span
          onClick={(e) => { e.stopPropagation(); toggleConnector(conn.id); }}
          style={{
            width: 16, height: 16, borderRadius: '50%',
            background: getStatusColor(conn.status),
            display: 'inline-block', flexShrink: 0,
            cursor: 'pointer',
          }}
          title={conn.enabled ? '已启用' : '未启用'}
        />
      </div>
    ),
  }));

  return (
    <Dropdown
      menu={{ items }}
      trigger={['click']}
      getPopupContainer={() => document.body}
    >
      <button
        className="icon-btn-sm"
        disabled={loading}
        style={{
          color: connectors.some(c => c.enabled) ? 'var(--accent)' : 'var(--muted-2)',
        }}
        title="外部连接"
      >
        <ThunderboltOutlined style={{ fontSize: 12 }} />
      </button>
    </Dropdown>
  );
};

export { ConnectorsDropdown };
