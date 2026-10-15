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
import { SendOutlined, StopOutlined, PaperClipOutlined, PictureOutlined, AudioOutlined, GlobalOutlined, CloseOutlined, FileExcelOutlined, FileTextOutlined, BellOutlined, BulbOutlined, MoreOutlined, DesktopOutlined, ThunderboltOutlined, GithubOutlined, StarOutlined, ExperimentOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
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
import { ModelSourceTag } from './ModelSourceTag';
import { isModelVisible, groupModels } from '../utils/modelPicker';

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
onSend: (text: string, opts?: { webSearch?: boolean }) => void;
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

/**
 * 2026-10-15: 任务归属判断 (系统层 prompt 出口的前端镜像, agentai-loop.ts:1703)
 * 用户反馈: 工作区设成 C 盘某目录, 但任务跟它无关时, AI 老在原地打转。
 * 前端在 Composer 顶部弹一条轻提示 — 关键词启发式匹配 + 顶层目录匹配,
 * 不阻断发送, 只提醒"新建目录/切换工作区/继续在这里做"。
 */
function detectTaskWorkspaceMismatch(draftText: string, workspaceDir: string | undefined): { text: string; dir: string } | null {
  const txt = (draftText || '').trim();
  if (txt.length < 4) return null; // 太短不判, 避免误报
  const ws = (workspaceDir || '').trim();
  if (!ws) return null; // 没设工作区, 无从比
  const lower = txt.toLowerCase();
  const wsLower = ws.toLowerCase();

  // ① 明确要"另起炉灶" — 关键词
  const newDirKeywords = /另[建存设放开新]|新建[一目工文夹项]|换个[目工]录|别[在到]这个[目工]录|换个[目工]录|新[开建]始/.test(txt);

  // ② 目标里点了别的绝对路径 — 跨盘/跨目录
  const otherPath = txt.match(/[A-Za-z]:[\\/][^\s"'\`<>|*?]+/g) || [];
  const crossPath = otherPath.some(p => {
    const pw = p.toLowerCase().replace(/\//g, '\\');
    return wsLower.includes(pw.slice(0, pw.lastIndexOf('\\') > -1 ? pw.lastIndexOf('\\') : 0)) === false
      && !wsLower.includes(pw.split('\\').filter(Boolean).pop()!); // 目标路径最后一段不在 ws 里
  });

  // ③ 任务关键词跟工作区目录名也完全无关 (粗判)
  const wsLeaf = (ws.split(/[\\/]/).filter(Boolean).pop() || '').toLowerCase();
  const taskMatchesWs = wsLeaf.length >= 2 && (lower.includes(wsLeaf) || wsLower.includes(wsLeaf));
  if (taskMatchesWs) return null; // 任务明显跟工作区相关, 不提示

  if (newDirKeywords || crossPath) {
    return { text: '这个任务似乎跟当前工作区无直接关系', dir: ws };
  }
  return null;
}

/** 提示条: 显示在 Composer 顶部, 用户点"继续在这里做"即消失 (localStorage 记忆) */
const MISMATCH_DISMISS_KEY = 'agentai.workspace.mismatchDismissed';
function useWorkspaceMismatchDismiss(workspaceDir: string): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!workspaceDir) return;
    try {
      const raw = localStorage.getItem(MISMATCH_DISMISS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, number>;
      // 同一 workspace 内 60s 内只提示一次
      if (saved[workspaceDir] && Date.now() - saved[workspaceDir] < 60_000) setDismissed(true);
    } catch { /* ignore */ }
  }, [workspaceDir]);
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      const saved: Record<string, number> = {};
      const raw = localStorage.getItem(MISMATCH_DISMISS_KEY);
      if (raw) Object.assign(saved, JSON.parse(raw));
      saved[workspaceDir || '_none'] = Date.now();
      localStorage.setItem(MISMATCH_DISMISS_KEY, JSON.stringify(saved));
    } catch { /* ignore */ }
  }, [workspaceDir]);
  return [dismissed, dismiss];
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
  const { activeModelId, setActive: setActiveModel, models, commercialKeys, chatMode, backendProviders } = useModelStore();
  const [draft, setDraft] = useState('');
  const [popup, setPopup] = useState<PopupKind>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recording, setRecording] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [parsing, setParsing] = useState(false); // 文件解析中
  // 工作区疑似不匹配提示 (2026-10-15): 关键词启发, 不阻断, 可关
  const [mismatchDismissed, dismissMismatch] = useWorkspaceMismatchDismiss(workspaceDir || '');
  const mismatch = useMemo(
    () => (busy ? null : detectTaskWorkspaceMismatch(draft, workspaceDir)),
    [draft, workspaceDir, busy],
  );

  // 2026-10-15: 切换工作区后自动把任务词填回 draft (用户点"切换工作区"按钮后,
  // 选完新目录, 原输入不丢 — 监听 agentai:workspace-changed 事件, 用当前 draft
  // 保留原文本, 再追加一句"已切换工作区, 继续执行"提示)
  const lastDraftRef = useRef('');
  useEffect(() => { lastDraftRef.current = draft; }, [draft]);
  useEffect(() => {
    const onWsChanged = (e: Event) => {
      const newWs = (e as CustomEvent<{ workspace: string }>).detail?.workspace;
      if (!newWs) return;
      const prev = lastDraftRef.current.trim();
      if (!prev) return; // 没原 draft 就不做
      // 用户刚切换工作区 → 保留原文, 追加一句提示让 AI 知道新目录
      setDraft((d) => (d.trim() ? d : prev) + `\n(已切换工作区到 ${newWs}, 请基于此继续, 别再用旧路径)`);
    };
    window.addEventListener('agentai:workspace-changed', onWsChanged);
    return () => window.removeEventListener('agentai:workspace-changed', onWsChanged);
  }, []);

  // ★ 行业感知: 检测是否为中医问诊模式 (2026-08-10)
  const [currentIndustry, setCurrentIndustry] = useState('general');
  useEffect(() => {
    const updateIndustry = () => {
      let extraProfile: any = {};
      try { const raw = localStorage.getItem('agentai.profile'); if (raw) extraProfile = JSON.parse(raw); } catch {}
      let zustandProfile: any = {};
      try { const raw = localStorage.getItem('agentai-user-profile'); if (raw) zustandProfile = JSON.parse(raw)?.state?.profile || {}; } catch {}
      setCurrentIndustry(extraProfile?.industry || zustandProfile?.industry || 'general');
    };
    updateIndustry();
    // 监听 storage 变化 (跨 tab 同步)
    window.addEventListener('storage', updateIndustry);
    return () => window.removeEventListener('storage', updateIndustry);
  }, []);
  const isMedicalMode = currentIndustry === 'medical';

  // ★ 舌诊摄像头状态
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  // ★ 渗透测试授权弹窗 (2026-10-15: 授权入口从"系统页/改 JSON"挪到对话框图标,
  //   跟 /scope /pentest 斜杠命令同一 API; 请求带 x-workspace 头, 跟 AI 工具侧写同一份 scope.json)
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeTargets, setScopeTargets] = useState<string[]>([]);
  const [scopeMaxRps, setScopeMaxRps] = useState<number>(5);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeNew, setScopeNew] = useState('');
  const [scopePendingCount, setScopePendingCount] = useState(0);

  const scopeBaseUrl = GATEWAY_HTTP || 'http://127.0.0.1:18789';

  // ⚠️ 2026-10-16 修复: workspace 走 URL 查询参数 (可编码中文), 不再走 x-workspace header —
  // header 只允许 ASCII, 中文工作区路径 (如 F:\目录已检查\澳彩) 会令 undici 抛
  // "Cannot convert to ByteString", 请求发不出去。跟 ScopeManager 同一修法。
  const scopeUrl = useCallback((path: string) =>
    workspaceDir ? `${scopeBaseUrl}/${path}?workspace=${encodeURIComponent(workspaceDir)}` : `${scopeBaseUrl}/${path}`,
  [scopeBaseUrl, workspaceDir]);

  const scopeLoad = useCallback(async () => {
    try {
      const r = await fetch(scopeUrl('v1/pentest/scope'));
      const d = await r.json();
      if (d.ok) { setScopeTargets(d.targets || []); setScopeMaxRps(d.max_rps || 5); }
      try {
        const rp = await fetch(scopeUrl('v1/pentest/scope/pending'));
        const dp = await rp.json();
        setScopePendingCount(dp.ok ? (dp.pending?.length || 0) : 0);
      } catch { /* 旧网关无此端点 */ }
    } catch { /* 弹窗打开时再提示 */ }
  }, [scopeUrl]);

  useEffect(() => {
    if (!scopeOpen) return;
    setScopeLoading(true);
    void scopeLoad().finally(() => setScopeLoading(false));
  }, [scopeOpen, scopeLoad]);

  // /scope 斜杠命令 → 窗口事件 → 打开授权弹窗 (Composer 与 ChatView 解耦, 同 agentai:show-browser 套路)
  useEffect(() => {
    const onOpen = () => setScopeOpen(true);
    window.addEventListener('agentai:open-scope', onOpen);
    return () => window.removeEventListener('agentai:open-scope', onOpen);
  }, []);

  const scopeGrant = async () => {
    const t = scopeNew.trim();
    if (!t) return;
    setScopeNew('');
    try {
      const r = await fetch(scopeUrl('v1/pentest/scope'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: t }),
      });
      const d = await r.json();
      if (d.ok) { message.success(d.granted ? `已授权 ${d.target}` : `${d.target} 已在授权范围`); void scopeLoad(); }
      else message.error(d.error || '授权失败 (确认网关在线)');
    } catch { message.error('授权请求失败 (网关不可达?)'); }
  };

  const scopeRevoke = async (host: string) => {
    try {
      const r = await fetch(scopeUrl('v1/pentest/scope'), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: host }),
      });
      const d = await r.json();
      if (d.ok) { message.success(`已取消授权 ${d.target}`); void scopeLoad(); }
      else message.error(d.error || '取消授权失败');
    } catch { message.error('取消授权请求失败'); }
  };

  // ★ 舌诊拍照: 打开摄像头
  const openTongueCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOpen(true);
    } catch (err: any) {
      message.error('无法访问摄像头: ' + (err.message || '请检查权限设置'));
    }
  };

  // ★ 舌诊拍照: 截图并作为附件发送
  const captureTongueImage = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/jpeg', 0.85);
    closeTongueCamera();
    // 作为图片附件加入
    onAttachmentsChange?.([...attachments, {
      kind: 'image' as const,
      name: `舌象_${new Date().toLocaleTimeString('zh-CN').replace(/:/g, '-')}.jpg`,
      mimetype: 'image/jpeg',
      size: Math.round(base64.length * 0.75),
      content: '[舌象照片]',
      dataUrl: base64,
    }]);
    message.success('舌象照片已捕获，可输入"请分析舌象"后发送');
  };

  // ★ 舌诊拍照: 关闭摄像头
  const closeTongueCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

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

  // @文件选择: 从工作区获取文件列表 + 目录钻取 (2026-10-15: 点目录进下一级)
  const [atFiles, setAtFiles] = useState<Array<{ name: string; path: string; isDir: boolean }>>([]);
  // 钻取目录状态: 当前正在浏览的子目录 (空串 = 工作区根)
  const [atDir, setAtDir] = useState('');
  useEffect(() => {
    if (!popup || popup.kind !== 'at') { setAtFiles([]); setAtDir(''); return; }
    const q = popup.query.toLowerCase();
    const ws = workspaceDir || '';
    if (!ws) return;
    // 钻取中的目录 (如 "src/components/") — 从 @query 里抽: 含 / 或 \ 的部分是路径, 其余是过滤词
    let browseDir = ws;
    let filter = q;
    const slashIdx = q.indexOf('/');
    const backslashIdx = q.indexOf('\\');
    const splitAt = [slashIdx, backslashIdx].filter(i => i >= 0).sort((a, b) => a - b)[0];
    if (splitAt !== undefined && splitAt > 0) {
      // @src/comp → 钻到 <ws>/src/, 过滤词 comp
      browseDir = ws + q.slice(0, splitAt + 1).replace(/\\/g, '/');
      filter = q.slice(splitAt + 1).toLowerCase();
    }
    // 防抖 300ms
    const timer = setTimeout(async () => {
      try {
        const base = GATEWAY_HTTP;
        const r = await fetch(`${base}/v1/fs/list?dir=${encodeURIComponent(browseDir)}`);
        if (!r.ok) return;
        const data = await r.json();
        // /v1/fs/list 返回 { entries: [{ name, path, type, size }] } — 取 entries, 判 type
        const raw: any[] = data?.entries || data?.files || (Array.isArray(data) ? data : []);
        const files = raw
          .filter((f: any) => {
            const name = (f.name || f.path || '').toLowerCase();
            return name && !name.startsWith('.') && name !== 'node_modules';
          })
          .filter((f: any) => !filter || (f.name || '').toLowerCase().includes(filter))
          .slice(0, 20);
        setAtDir(browseDir !== ws ? browseDir.replace(/^.*?\/?\//, '') : '');
        setAtFiles(files.map((f: any) => ({
          name: f.name || f.path,
          path: f.path || f.name,
          // entries 用 type: 'directory'|'file'; 兼容旧字段 isDirectory/isDir
          isDir: f.type === 'directory' || !!f.isDirectory || !!f.isDir,
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
      // 插入文件路径到 draft; 目录 → 追加 / 继续钻取 (留在 @ 弹层里进下一级)
      const file = it as { name: string; path: string; isDir?: boolean };
      if (file.isDir) {
        // 目录: @路径/ → 触发 effect 按新 query 钻取 (query 里含 / 就进 browseDir)
        const rel = file.path.replace(/^.*?(\/|\\)/, ''); // 取最后一段目录名
        // 保持 @ 弹层: 把 @query 替换成 <已敲的部分><dir>/, 让 handleChange 识别成 @
        const currentAt = (draft.match(/@[^\s]*$/) || [''])[0];
        const prefix = currentAt.startsWith('@') ? currentAt.slice(1) : '';
        const drill = prefix + rel + '/';
        setDraft(draft.replace(/@[^\s]*$/, `@${drill}`));
        // 保持弹层, 用新 nonce 触发重新 fetch (钻到下一级)
        setPopup({ kind: 'at', query: drill, nonce: Date.now() });
      } else {
        const next = draft.replace(/@[^\s]*$/, `@${file.path} `);
        setDraft(next);
        setPopup(null);
      }
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
      // P0 修复: 中文输入法正在组字时 Enter 用于选词, 不发送消息
      if (composingRef.current) return;
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
        onSend(draft, { webSearch });
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
          position: 'absolute', inset: 0, zIndex: 'var(--z-sticky)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(74,222,128,0.08)',
          border: '2px dashed var(--success)',
          borderRadius: 'var(--radius-md)', margin: 4,
          pointerEvents: 'none',
          fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--success)',
          letterSpacing: 1,
        }}>
          📎 释放文件以上传
        </div>
      )}
      {/* Queued sends chips */}
      {queuedSends && queuedSends.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '6px 12px 0', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', paddingTop: 2 }}>排队 ({queuedSends.length}):</span>
          {queuedSends.map((t, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-micro)',
              background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)',
            }}>
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
              {onDequeueSend && <span onClick={() => onDequeueSend(i)} style={{ cursor: 'pointer', color: 'var(--muted-2)', marginLeft: 2 }}>×</span>}
            </span>
          ))}
        </div>
      )}

      {/* 工作区疑似不匹配提示 (2026-10-15): 关键词启发, 不阻断, 可关 */}
      {mismatch && !mismatchDismissed && (
        <div style={{
          margin: '0 12px 4px',
          padding: '6px 12px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(250,173,20,0.10)',
          border: '1px solid rgba(250,173,20,0.40)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--fg-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--warning)', flexShrink: 0 }}>⚠️</span>
          <span style={{ flex: 1, minWidth: 120 }}>
            {mismatch.text} ({mismatch.dir})。继续在这里做, 或「新建目录」/「切换工作区」:
          </span>
          <button
            type="button"
            onClick={() => {
              dismissMismatch();
              // 追加提示让 AI 自选专属目录 (agentai-loop.ts:1703 任务归属判断出口)
              const tip = '\n(提示: 这个任务跟当前工作区无直接关系, 如需新建产出, 请自建专属目录如 output/<task> 或 .agentai/scratch, 别散落在工作区根目录污染它; 若用户指定了目标目录就写到那。)';
              setDraft((d) => d + tip);
            }}
            style={{
              border: '1px solid rgba(250,173,20,0.5)', background: 'transparent',
              color: 'var(--warning)', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', fontSize: 'var(--fs-micro)', fontWeight: 600,
              padding: '2px 8px', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            自建目录
          </button>
          <button
            type="button"
            onClick={() => {
              // 触发 WorkspaceSelector 弹目录选择 (它内部 setBrowserOpen(true) 由
              // "agentai:workspace-select" 自定义事件驱动, 下方 ChatView 监听)。
              dismissMismatch();
              window.dispatchEvent(new CustomEvent('agentai:workspace-select'));
            }}
            style={{
              border: '1px solid var(--border)', background: 'var(--panel)',
              color: 'var(--fg-2)', borderRadius: 'var(--radius-sm)',
              cursor: 'pointer', fontSize: 'var(--fs-micro)', fontWeight: 600,
              padding: '2px 8px', fontFamily: 'inherit', flexShrink: 0,
            }}
          >
            切换工作区
          </button>
          <button
            type="button"
            onClick={dismissMismatch}
            title="忽略这条提示 (本会话 60s 内不再弹)"
            style={{
              border: 'none', background: 'transparent',
              color: 'var(--muted-2)', cursor: 'pointer', fontSize: 'var(--fs-md)',
              flexShrink: 0, padding: 0, lineHeight: 1, fontFamily: 'inherit',
            }}
          >✕</button>
        </div>
      )}

      {/* ═══════ 主对话输入框 ═══════ */}
      {/* 模式推荐提示条 */}
      {suggestedMode && suggestedMode !== mode && (
        <div style={{
          margin: '0 12px 4px',
          padding: '6px 12px',
          borderRadius: 'var(--radius-md)',
          background: MODE_CONFIG[suggestedMode].color + '18',
          border: `1px solid ${MODE_CONFIG[suggestedMode].color}44`,
          fontSize: 'var(--fs-sm)',
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
        borderRadius: 'var(--radius-lg)',
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
            borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-micro)', color: 'var(--accent)',
          }}>
            <PictureOutlined style={{ fontSize: 'var(--fs-md)' }} />
            <span>🎨 对话改图模式 — 上传图片后输入修改指令</span>
            <button
              className="icon-btn-sm"
              onClick={() => imageInputRef.current?.click()}
              style={{ marginLeft: 'auto', background: 'var(--accent)', color: 'var(--fg)', borderRadius: 'var(--radius-sm)', padding: '2px 10px', fontSize: 'var(--fs-micro)', border: 'none', cursor: 'pointer' }}
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
                padding: '2px 8px', borderRadius: 'var(--radius-lg)', fontSize: 'var(--fs-micro)',
                background: 'rgba(99,102,241,0.1)', color: 'var(--accent)',
                border: '1px solid rgba(99,102,241,0.2)',
                maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: 'var(--fs-micro)' }}>🔗</span>
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
            fontSize: 'var(--fs-md)', lineHeight: 1.5,
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
                padding: '2px 6px', borderRadius: 'var(--radius-md)',
                background: att.kind === 'image' ? 'rgba(99,102,241,0.08)' : 'var(--panel)',
                border: '1px solid var(--border)',
                fontSize: 'var(--fs-micro)', color: 'var(--fg-2)',
              }}>
                {/* 图片缩略图 */}
                {att.kind === 'image' && att.dataUrl && (
                  <Image
                    src={att.dataUrl}
                    alt={att.name}
                    width={32}
                    height={32}
                    style={{ borderRadius: 'var(--radius-sm)', objectFit: 'cover', cursor: 'pointer' }}
                    preview={{ mask: null }}
                  />
                )}
                {/* Excel图标 */}
                {att.kind === 'table' && <FileExcelOutlined style={{ color: 'var(--success)', fontSize: 'var(--fs-md)' }} />}
                {/* 文本文件图标 */}
                {att.kind === 'text' && <FileTextOutlined style={{ color: 'var(--accent)', fontSize: 'var(--fs-md)' }} />}
                {/* 文件名 */}
                <span style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.name}
                </span>
                {/* 删除按钮 */}
                <span
                  onClick={() => onAttachmentsChange?.(attachments.filter((_, j) => j !== i))}
                  style={{ cursor: 'pointer', color: 'var(--muted-2)', fontSize: 'var(--fs-micro)', marginLeft: 2 }}
                >
                  <CloseOutlined style={{ fontSize: 'var(--fs-micro)' }} />
                </span>
              </div>
            ))}
            {parsing && <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>解析中...</span>}
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
              <PaperClipOutlined style={{ fontSize: 'var(--fs-sm)' }} />
            </button>
          </Tooltip>
          <Tooltip title="插入图片">
            <button className="icon-btn-sm" onClick={() => imageInputRef.current?.click()}>
              <PictureOutlined style={{ fontSize: 'var(--fs-sm)' }} />
            </button>
          </Tooltip>

          <Tooltip title="渗透测试授权 (加可测目标, 与 /scope /pentest 同一份范围)">
            <button className="icon-btn-sm" onClick={() => setScopeOpen(true)}>
              <SafetyCertificateOutlined style={{ fontSize: 'var(--fs-sm)' }} />
            </button>
          </Tooltip>

          {/* ★ 舌诊拍照 (仅中医行业显示) */}
          {isMedicalMode && (
            <Tooltip title="舌诊拍照">
              <button
                className="icon-btn-sm"
                onClick={openTongueCamera}
                style={{ color: '#1abc9c', border: '1px solid #1abc9c40' }}
              >
                👅
              </button>
            </Tooltip>
          )}

          {/* ★ 渗透测试授权弹窗 (点 🔒 图标开; 与 /scope /pentest 斜杠命令同一份 scope.json) */}
          {scopeOpen && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.55)', zIndex: 'var(--z-dragging)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={(e) => { if (e.target === e.currentTarget) setScopeOpen(false); }}>
              <div style={{
                width: 440, maxHeight: '70vh', overflowY: 'auto',
                borderRadius: 'var(--radius-lg)', background: 'var(--panel)',
                border: '1px solid var(--border)', boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
                padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <SafetyCertificateOutlined style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 'var(--fs-sm)' }}>渗透测试授权</span>
                  <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)' }}>· 与 AI 挖洞同一份范围</span>
                  <button className="icon-btn-sm" onClick={() => setScopeOpen(false)} style={{ marginLeft: 'auto' }}>✕</button>
                </div>

                <div style={{
                  fontSize: 'var(--fs-micro)', color: 'var(--warning)', marginBottom: 10,
                  padding: '5px 8px', borderRadius: 'var(--radius-sm)',
                  background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.25)',
                }}>
                  只加平台明文授权资产 (补天/盒子 in-scope 清单)。通配符域名 (如 *.bestpay.com.cn) 直接填。
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input
                    style={{
                      flex: 1, fontSize: 'var(--fs-micro)', padding: '5px 8px',
                      borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                      background: 'var(--card)', color: 'var(--fg)', outline: 'none',
                    }}
                    placeholder="目标域名, 如 *.bestpay.com.cn"
                    value={scopeNew}
                    onChange={e => setScopeNew(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void scopeGrant(); }}
                  />
                  <button
                    className="icon-btn-sm"
                    style={{
                      border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                      background: 'var(--accent)', color: 'var(--fg-on-accent)',
                      fontSize: 'var(--fs-micro)', padding: '4px 10px',
                    }}
                    onClick={() => void scopeGrant()}
                  >
                    授权
                  </button>
                </div>

                {scopePendingCount > 0 && (
                  <div style={{
                    fontSize: 'var(--fs-micro)', color: '#d48806', marginBottom: 8,
                    padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.35)',
                  }}>
                    ⏳ 有 {scopePendingCount} 个 AI 发起的授权提案待你确认 — 在左侧「渗透测试授权」系统页确认后才生效 (AI 不能自我授权)
                  </div>
                )}

                {scopeTargets.length === 0 ? (
                  <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', textAlign: 'center', padding: '12px 0' }}>
                    {scopeLoading ? '加载中…' : '尚未授权任何目标 — 添加后 AI 挖洞即可放行'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
                    {scopeTargets.map(t => (
                      <div key={t} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--card)', border: '1px solid var(--border)',
                        fontSize: 'var(--fs-micro)',
                      }}>
                        <SafetyCertificateOutlined style={{ color: 'var(--success)', flexShrink: 0 }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' }}>{t}</span>
                        <button
                          className="icon-btn-sm"
                          style={{ color: 'var(--danger)', border: 'none', background: 'none', cursor: 'pointer', padding: '0 4px' }}
                          onClick={() => void scopeRevoke(t)}
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', marginTop: 8 }}>
                  速率上限 {scopeMaxRps} rps (限频防打崩目标)
                </div>
              </div>
            </div>
          )}

          {/* ★ 舌诊摄像头弹窗 */}
          {cameraOpen && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.7)', zIndex: 'var(--z-dragging)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }} onClick={(e) => { if (e.target === e.currentTarget) closeTongueCamera(); }}>
              <div style={{
                width: 480, borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                background: '#000', boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              }}>
                <div style={{
                  padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'linear-gradient(135deg, #1abc9c, #16a085)',
                  color: 'var(--fg-on-accent)',
                }}>
                  <span style={{ fontWeight: 600 }}>👅 中医舌诊 — 拍摄舌象</span>
                  <button onClick={closeTongueCamera} style={{ color: 'var(--fg-on-accent)', cursor: 'pointer', fontSize: 'var(--fs-lg)', background: 'none', border: 'none' }}>✕</button>
                </div>
                {/* 摄像头预览 */}
                <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block' }} />
                {/* 隐藏的 canvas 用于截图 */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                {/* 提示 + 按钮 */}
                <div style={{ padding: 12, textAlign: 'center', background: '#111' }}>
                  <p style={{ color: 'var(--muted)', fontSize: 'var(--fs-sm)', margin: '0 0 10px' }}>
                    请将舌头伸出对准镜头，保持自然光线，点击下方按钮拍摄
                  </p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button
                      onClick={captureTongueImage}
                      style={{
                        padding: '8px 24px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-md)', fontWeight: 600,
                        background: '#1abc9c', color: 'var(--fg-on-accent)', border: 'none', cursor: 'pointer',
                        transition: 'transform 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      📸 拍摄舌象
                    </button>
                    <button
                      onClick={closeTongueCamera}
                      style={{
                        padding: '8px 16px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-md)',
                        background: 'transparent', color: 'var(--muted)', border: '1px solid #444', cursor: 'pointer',
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 更多菜单 (收给低频控件) ── */}
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            menu={{
              items: [
                {
                  key: 'websearch',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                      <GlobalOutlined style={{ color: webSearch ? 'var(--success)' : 'var(--muted-2)' }} />
                      {webSearch ? '关闭联网搜索' : '开启联网搜索'}
                    </span>
                  ),
                  onClick: () => setWebSearch(v => !v),
                },
                {
                  key: 'thinking',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                      <BulbOutlined style={{ color: thinking ? 'var(--violet)' : 'var(--muted-2)' }} />
                      {thinking ? '关闭深度思考' : '开启深度思考'}
                    </span>
                  ),
                  onClick: () => onThinkingChange?.(!thinking),
                },
                ...(srSupported ? [{
                  key: 'voice',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
                      <AudioOutlined style={{ color: recording ? 'var(--danger)' : 'var(--muted-2)' }} />
                      {recording ? '停止语音输入' : '开始语音输入'}
                    </span>
                  ),
                  onClick: handleVoiceToggle,
                }] : []),
                {
                  key: 'optimize',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
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
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)' }}>
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
                <MoreOutlined style={{ fontSize: 'var(--fs-sm)' }} />
              </button>
            </Tooltip>
          </Dropdown>

          <span className="ui-divider" />

          {/* ── 模型选择器 (有密钥即显示, 中转站按密钥分组折叠) ── */}
          {(() => {
            // 过滤/分组规则与 ModelSelector 共用 utils/modelPicker.ts
            const hasBackendKey = (provider?: string) =>
              !!provider && backendProviders.some(p => p.name === provider && p.hasKey);
            const visibleModels = models.filter(m => isModelVisible(m, { commercialKeys, hasBackendKey }));
            if (visibleModels.length === 0) return null;

            const groupedArr = groupModels(visibleModels);
            const renderOption = (m: typeof models[0]) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color || '#888', display: 'inline-block' }} />
                {m.label}
                <ModelSourceTag model={m} dense />
              </span>
            );

            return (
              <Select
                size="small"
                value={visibleModels.some(m => m.id === activeModelId) ? activeModelId : visibleModels[0]?.id}
                onChange={handleModelChange}
                style={{ width: 200, fontSize: 'var(--fs-micro)' }}
                variant="borderless"
                popupMatchSelectWidth={false}
                getPopupContainer={() => document.body}
                // 单模型不套分组头 —— 否则组名与唯一一项的标签逐字重复
                // (混用分组项与独立项, antd Select 支持两者并存)
                options={groupedArr.flatMap((g): any[] =>
                  g.models.length > 1
                    ? [{
                        label: <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', fontWeight: 600 }}>{g.label} ({g.models.length})</span>,
                        title: g.label,
                        options: [
// NVIDIA Auto 选项已移除
                          ...g.models.map(m => ({ value: m.id, label: renderOption(m) })),
                        ],
                      }]
                    : g.models.map(m => ({ value: m.id, label: renderOption(m) }))
                )}
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
                padding: '1px 5px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-micro)', fontWeight: mode === k ? 600 : 400,
                color: mode === k ? '#fff' : 'var(--muted-2)',
                background: mode === k ? dot : 'transparent',
                border: 'none', cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}

          <span className="ui-divider" />

          {/* ── 对话改图模式切换 (移入对话框内) ── */}
          <Tooltip title={chatMode === 'image_edit' ? '切换回普通对话' : '🎨 对话改图模式'}>
            <button
              onClick={() => {
                const newMode = chatMode === 'image_edit' ? 'chat' : 'image_edit';
                useModelStore.getState().setChatMode(newMode);
                // 切换到图片模式时，自动选择支持图片的模型
                if (newMode === 'image_edit') {
                  const imageModels = models.filter(m =>
                    m.capabilities?.includes('image') ||
                    m.capabilities?.includes('multimodal') ||
                    ['zhipu', 'doubao-chat', 'qwen-chat', 'longcat-2.0', 'factory-gpt-image-2', 'factory-nano-banana-2'].includes(m.id)
                  );
                  if (imageModels.length > 0 && !imageModels.find(m => m.id === activeModelId)) {
                    setActiveModel(imageModels[0].id);
                  }
                }
              }}
              className="icon-btn-sm"
              style={{
                color: chatMode === 'image_edit' ? 'var(--accent)' : 'var(--muted-2)',
                background: chatMode === 'image_edit' ? 'var(--accent-soft)' : 'transparent',
              }}
            >
              <ExperimentOutlined style={{ fontSize: 'var(--fs-sm)' }} />
            </button>
          </Tooltip>

          {/* ── 提示词优化 (直接显示在对话框内，不折叠) ── */}
          <Tooltip title="✨ 优化提示词">
            <button
              onClick={() => setOptimizeOpen(true)}
              disabled={optimizeDisabled || !draft.trim()}
              className="icon-btn-sm"
              style={{
                color: draft.trim() && !optimizeDisabled ? '#a855f7' : 'var(--muted-3)',
                cursor: draft.trim() && !optimizeDisabled ? 'pointer' : 'not-allowed',
              }}
            >
              <StarOutlined style={{ fontSize: 'var(--fs-sm)' }} />
            </button>
          </Tooltip>

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
              <MoreOutlined style={{ fontSize: 'var(--fs-micro)' }} />
            </button>
          </Tooltip>

          <span className="ui-divider" />

          {/* ── 远程环境按钮 ── */}
          <RemoteEnvironmentButton />

          {/* ── 发送/中止 ── */}
          {busy ? (
            <button onClick={onAbort} className="send-btn" style={{ background: 'var(--danger)' }}>
              <StopOutlined style={{ fontSize: 'var(--fs-md)', color: 'var(--fg)' }} />
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
              <SendOutlined style={{ fontSize: 'var(--fs-md)' }} />
            </button>
          )}
        </div>
      </div>

      {/* ── PromptOptimizer 浮窗 (挂载即自动触发 LLM 优化) ── */}
      {optimizeOpen && (
        <PromptOptimizer
          draft={draft}
          onApply={(text) => setDraft(text)}
          onClose={() => setOptimizeOpen(false)}
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
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 4,
          maxHeight: 200, overflowY: 'auto', zIndex: 'var(--z-dropdown)',
        }}>
          <div style={{ padding: '4px 8px', fontSize: 'var(--fs-micro)', color: 'var(--muted)', borderBottom: '1px solid var(--border)', marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {popup.kind === 'slash' ? '/ 命令' : '@ 选择文件'}
              {popup.kind === 'at' && atDir ? ` · ${atDir}` : ''}
            </span>
            {popup.kind === 'at' && atDir ? (
              <button
                type="button"
                onClick={() => {
                  // 回退一级: 把 @query 里最后一个 / 之后的部分清掉
                  const atPart = (draft.match(/@[^\s]*$/) || [''])[0].slice(1);
                  const lastSlash = atPart.lastIndexOf('/');
                  const up = lastSlash > 0 ? atPart.slice(0, lastSlash) : '';
                  setDraft(draft.replace(/@[^\s]*$/, up ? `@${up}` : '@'));
                  setPopup({ kind: 'at', query: up, nonce: Date.now() });
                }}
                style={{
                  border: 'none', background: 'var(--panel-2)', color: 'var(--muted)',
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 'var(--fs-micro)',
                  padding: '1px 6px', flexShrink: 0, fontFamily: 'inherit',
                }}
                title="回上一级"
              >
                ⬆ 上级
              </button>
            ) : null}
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
                  padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  fontSize: 'var(--fs-sm)', color: 'var(--fg-2)',
                  background: i === activeIdx ? 'var(--panel-2)' : 'transparent',
                }}
              >
                <span style={{
                  width: 20, height: 20, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-soft)', color: 'var(--accent)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'var(--fs-micro)', fontWeight: 700, flexShrink: 0,
                }}>{isSlash ? '/' : '@'}</span>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ color: 'var(--muted-2)', fontSize: 'var(--fs-micro)' }}>{desc}</span>
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
  width: 24, height: 24, borderRadius: 'var(--radius-sm)',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', border: 'none', background: 'transparent',
  color: 'var(--muted-2)', transition: 'all 0.15s',
};

const sendBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 'var(--radius-md)',
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
      case 'online': return 'var(--success)';
      case 'offline': return 'var(--muted-2)';
      case 'error': return 'var(--danger)';
      default: return 'var(--muted-2)';
    }
  };

  const items = connectors.map(conn => ({
    key: conn.id,
    label: (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
        <span style={{ color: conn.enabled ? 'var(--accent)' : 'var(--muted-2)' }}>{conn.icon}</span>
        <span style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 500 }}>{conn.name}</div>
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{conn.description}</div>
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
      getPopupContainer={(trigger) => trigger.parentElement || document.body}
    >
      <button
        className="icon-btn-sm"
        disabled={loading}
        style={{
          color: connectors.some(c => c.enabled) ? 'var(--accent)' : 'var(--muted-2)',
        }}
        title="外部连接"
      >
        <ThunderboltOutlined style={{ fontSize: 'var(--fs-sm)' }} />
      </button>
    </Dropdown>
  );
};

export { ConnectorsDropdown };
