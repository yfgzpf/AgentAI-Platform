/**
 * ChatView — 主对话视图 (重构版)
 *   - 集成 Thread 卡片式消息渲染
 *   - 集成 Composer 智能输入区
 *   - 流式 SSE 通信
 *   - 上下文压缩: 达到阈值自动摘要+开新对话
 */

/**
 * AutoHideTaskBar - 自动隐藏的任务提示条包装器
 * 用户未操作时自动收起，避免常驻遮挡视线
 */
function AutoHideTaskBar({ children, visible, delay = 8000, onHidden }: { 
  children: React.ReactNode; visible: boolean; delay?: number; onHidden?: () => void;
}) {
  const [show, setShow] = useState(visible);
  
  useEffect(() => {
    if (!visible) { setShow(false); return; }
    setShow(true);
    const timer = setTimeout(() => {
      setShow(false);
      onHidden?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, delay]);
  
  if (!show) return null;
  return <>{children}</>;
}

/** 自动生成对话摘要 (前端本地压缩, 不调LLM) */
function generateConversationSummary(messages: any[]): string {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const toolCalls = messages.flatMap(m => m.segments?.filter((s: any) => s.kind === 'tool') || []);

  // 提取用户需求
  const userNeeds = userMsgs.map(m =>
    m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('').slice(0, 100)
  ).filter(Boolean);

  // 提取AI完成的关键操作
  const toolNames = [...new Set(toolCalls.map((t: any) => t.name))];
  const completedOps = toolNames.length > 0
    ? `已执行操作: ${toolNames.join(', ')}`
    : '';

  // 提取AI回复摘要
  const assistantSummaries = assistantMsgs.slice(-3).map(m => {
    const text = m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('').slice(0, 150);
    return text;
  }).filter(Boolean);

  const lines = [
    '📋 **上一轮对话摘要** (自动生成)',
    '',
    `**用户需求**: ${(userNeeds || []).slice(-3).join(' → ')}`,
  ];
  if (completedOps) lines.push(`**${completedOps}**`);
  if (assistantSummaries.length > 0) {
    lines.push('');
    lines.push('**最近回复要点**:');
    assistantSummaries.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
  }
  lines.push('');
  lines.push('---');
  lines.push('*以上为上下文压缩摘要, AI 可基于此继续对话*');

  return lines.join('\n');
}

/**
 * 检测工具结果中的图片数据并插入 image segment
 * 支持: imageBase64 / imageUrl / screenshot_data
 */
function detectAndInsertImage(
  botId: string,
  toolName: string,
  result: string | undefined,
  updateMessage: (id: string, fn: (m: any) => any) => void,
  onImageDetected?: (url: string, alt: string, filePath?: string) => void,
) {
  if (!result) return;
  // 黑名单: 以下工具永远不会产生图片, 跳过检测
  const NON_IMAGE_TOOLS = new Set(['run_background', 'run_command', 'run_code', 'read_file', 'write_file', 'edit_file', 'execute_command', 'Bash', 'PowerShell', 'list_directory', 'directory_tree', 'search_content', 'search_files', 'glob', 'get_file_info', 'find_references', 'get_outline', 'get_symbols', 'search_codebase']);
  if (NON_IMAGE_TOOLS.has(toolName)) return;
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    // ═══ 提取待插入的图片候选 (url/base64) ═══
    let candidateUrl: string | undefined;
    let candidateBase64: string | undefined;
    let candidateAlt: string | undefined;
    let candidateFilePath: string | undefined;

    // 1. 桌面截图: desktop_automate screenshot 返回 screenshot_data
    if (toolName === 'desktop_automate' && parsed.screenshot_data?.base64) {
      candidateBase64 = parsed.screenshot_data.base64;
      candidateAlt = parsed.screenshot_data.alt || '桌面截图';
      candidateFilePath = parsed.screenshot_data.path;
    }

    // 2. 浏览器截图: browser_screenshot 返回 imageBase64
    else if ((toolName === 'browser_screenshot' || toolName === 'browser_screenshot_full') && parsed.imageBase64) {
      candidateBase64 = parsed.imageBase64;
      candidateAlt = '浏览器截图';
    }

    // 3. 图片生成: generate_image 优先使用 localPath
    else if (toolName === 'generate_image') {
      if (parsed.localPath) {
        const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
        candidateUrl = `${gatewayHttp}/api/files/download?path=${encodeURIComponent(parsed.localPath)}`;
        candidateAlt = parsed.prompt || 'AI 生成图片';
        candidateFilePath = parsed.localPath;
      } else if (parsed.imageUrl || parsed.url) {
        candidateUrl = parsed.imageUrl || parsed.url;
        candidateAlt = parsed.prompt || 'AI图片';
      }
    }

    // 4. 通用检测: 只要有 imageUrl/imageBase64 字段
    else if (parsed.imageUrl || parsed.imageBase64) {
      candidateUrl = parsed.imageUrl;
      candidateBase64 = parsed.imageBase64;
      candidateAlt = parsed.alt || toolName;
    }

    // ═══ 图片去重: 已有相同 url 或 base64 的 image segment 则跳过 ═══
    if (candidateUrl || candidateBase64) {
      candidateAlt = candidateAlt || '图片';
      updateMessage(botId, (m: any) => {
        const existing = m.segments?.find((s: any) => {
          if (s.kind !== 'image') return false;
          if (candidateUrl && s.url === candidateUrl) return true;
          if (candidateBase64 && s.base64 === candidateBase64) return true;
          return false;
        });
        if (existing) return m; // 重复, 不插入
        return {
          ...m,
          segments: [...m.segments, {
            kind: 'image',
            url: candidateUrl,
            base64: candidateBase64,
            alt: candidateAlt,
            filePath: candidateFilePath,
          }],
        };
      });
      if (candidateUrl || candidateFilePath) {
        const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
        const imgDataUrl = candidateFilePath
          ? `${gatewayHttp}/api/files/download?path=${encodeURIComponent(candidateFilePath)}`
          : candidateUrl;
        onImageDetected?.(imgDataUrl || '', candidateAlt!, candidateFilePath);
      }
      return;
    }
  } catch {
    // result 不是 JSON — 检查是否包含图片 URL 或文件路径
    const text = String(result);

    // 0. 优先检测本地文件路径 (格式: "FILE: /path/to/img.png") — 无 CORS 问题
    const fileMatch = text.match(/FILE:\s*([^\s\n]+)/i);
    if (fileMatch) {
      const filePath = fileMatch[1];
      const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
      const imgUrl = `${gatewayHttp}/api/files/download?path=${encodeURIComponent(filePath)}`;
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imgUrl,
          alt: 'AI 生成图片',
          filePath,
        }],
      }));
      return;
    }

    // 1. 从 output 字符串中提取 URL (格式: "URL: https://...")
    const urlMatch = text.match(/URL:\s*(https?:\/\/[^\s\n]+)/i);
    if (urlMatch) {
      const imageUrl = urlMatch[1];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: 'AI 生成图片',
        }],
      }));
      return;
    }

    // 2. 从 Markdown 链接中提取 URL (格式: ![alt](url) 或 [text](url))
    const mdImageMatch = text.match(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i);
    if (mdImageMatch) {
      const imageUrl = mdImageMatch[2];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: mdImageMatch[1] || 'AI 生成图片',
        }],
      }));
      return;
    }

    // 3. 从 Markdown 链接中提取 URL (格式: [text](url)，排除 agentai:// 协议)
    const mdLinkMatch = text.match(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/i);
    if (mdLinkMatch && !mdLinkMatch[2].startsWith('agentai://')) {
      const imageUrl = mdLinkMatch[2];
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: imageUrl,
          alt: mdLinkMatch[1] || 'AI 生成图片',
        }],
      }));
      return;
    }

    // 4. 检查是否包含图片文件路径 (排除 file:/// 协议路径和系统路径)
    const textClean = text.replace(/file:\/\/\/?/gi, '');
    if (textClean !== text) return; // 含 file:// 协议的不是图片
    const nonImageSystemPaths = /\\windows\\|\/windows\/|system32|cmd\.exe|powershell\.exe|Program\s*Files|favicon\.svg|icon\.png|logo\.jpg/i;
    if (nonImageSystemPaths.test(text)) return;
    const imgMatch = text.match(/([^\s`'"]+\.(png|jpg|jpeg|gif|webp|bmp))/i);
    if (imgMatch && !/^\//.test(imgMatch[1])) {
      // SVG 文件通常不是生成的图片，跳过
      if (imgMatch[2] === 'svg') return;
      const imgPath = imgMatch[1];
      const imgName = imgPath.split(/[\\/]/).pop() || imgPath;
      // 通过 gateway API 加载图片
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'text',
          text: `\n\n> 🖼️ **已生成图片**: [${imgName}](agentai://open?path=${encodeURIComponent(imgPath)})\n\n![${imgName}](/api/files/download?path=${encodeURIComponent(imgPath)})\n`,
        }],
      }));
      return;
    }
  }
}

/**
 * ChatView — 主对话视图 (重构版)
 *   - 集成 Thread 卡片式消息渲染
 *   - 集成 Composer 智能输入区
 *   - 流式 SSE 通信
 *   - 会话管理
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Alert, Button, Select, Space, Spin, Tag, App } from 'antd';
import { SyncOutlined, CloseOutlined } from '@ant-design/icons';
import { io, type Socket } from 'socket.io-client';
import { useChatStore } from '../store/chatStore';
import type { ChatMessage } from '../store/chatStore';
import { useModelStore, analyzeComplexity } from '../store/modelStore';
import { useModeStore } from '../store/modeStore';
import { useProfileStore } from '../store';
import { useSessionStore } from '../store/sessionStore';
import type { AppMode } from '../store/modeStore';
import { Composer, type SlashCmd, type ComposerHandle } from './Composer';
import { UserMsg, AssistantMsg, TurnDivider } from './Thread';
import { WorkspaceSummaryBar } from './WorkspaceSummaryBar';
import { WorkspaceSelector } from './WorkspaceSelector';
import { countTokens, formatTokens } from '../services/tokenCounter';
import { Scene3DViewer, type Scene3DData } from './Scene3DViewer';
import { EmotionIndicator } from './EmotionIndicator';
import { analyzeEmotionQuick, type EmotionResult } from '../services/emotion';
import { apiStream, makeChatHandlers, apiApproveFileChange, apiApprovePlan, suggestMode, apiWriteMemory } from '../services/api';
import { MemoryEngine } from '../services/MemoryEngine';
import { TaskChainCard, type StageStatus } from './TaskChainCard';
import { SandboxStatusPanel } from './SandboxStatusPanel';
import { SandboxResultPanel } from './SandboxResultPanel';
import { buildTimelinePrompt } from '../services/AiRules';
import { useTaskStore, useTaskOrchestrator, useTaskResumeStore, TaskStatus } from '../store/taskStore';

/** 任务链阶段标识 (与 SSE plan_stage 事件的 stage 字段对齐) */
type ChainStage = 'plan' | 'solve' | 'verify' | 'fix' | 'report';
import { ApprovalCard } from './ApprovalCard';
import { AskUserCard } from './AskUserCard';
import { ClarificationCard, type ClarificationRequest } from './ClarificationCard';
import { DiffViewer, useDiffEvents } from './DiffViewer';
import { LastSessionHint } from './LastSessionHint';
import { WelcomePanel } from './WelcomePanel';
import { SubagentStatus, type SubagentInfo } from './SubagentStatus';
import { gatewayFallback } from '../services/GatewayFallback';
import { submitFeedback } from '../services/feedbackApi';
import { taskNotifier } from '../services/TaskNotifier';
import { speak, isTtsEnabled as checkTts } from '../services/VoiceService';
import { useSmartScroll } from '../hooks/useSmartScroll';
import { useSessionAutoSave } from '../hooks/useSessionAutoSave';
import type { ParsedAttachment } from '../services/file-parser';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/** 根据文件名猜测图片 MIME 类型 */
function guessImgMimetype(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
  return map[ext] || 'image/png';
}

/* ═══ SSE 帧级渲染优化: 消息行 React.memo (2026-09-05) ═══
 * ChatView 因 updateMessage (rAF ~60fps) 每帧重渲染; 行内闭包回调每次重建会导致
 * React.memo 浅比较失败 → 所有历史消息行全量重建 (含折叠卡片/图片/Markdown 解析)。
 * 方案: 1) 这里对 UserMsg/AssistantMsg 包 React.memo;
 *       2) ChatView 内按"msg 对象引用"缓存每行的绑定回调 (见 getRowBinds),
 *          未变化消息行 props 引用稳定 → 直接跳过渲染, 只剩流式的那一条在动。
 */
type RowBinds = {
  onResend?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onBookmark?: () => void;
  onRegenerate?: () => void;
  onFeedback?: (kind: 'up' | 'down') => void;
  /** 合并 durationMs 后的 usage (原每次渲染新建对象, 破坏 memo) */
  usage?: any;
};
const UserMsgRow = React.memo(UserMsg);
const AssistantMsgRow = React.memo(AssistantMsg);

export const ChatView: React.FC = () => {
  const { messages, appendMessage, updateMessage, clearMessages, removeMessages, setMessages } = useChatStore();
  const { activeModelId, chatMode, setChatMode } = useModelStore();
  const { mode, setMode, setSuggestedMode, recommendEnabled } = useModeStore();
  const { sessions, activeId, createSession, addMessage, updateTitle, setActive } = useSessionStore();
  // 长任务快照: 订阅 resumableTasks 和 activeTaskId 用于顶部提示条
  const resumableTasks = useTaskResumeStore((s) => s.resumableTasks);
  const activeTaskId = useTaskResumeStore((s) => s.activeTaskId);
  const refreshResumable = useTaskResumeStore((s) => s.refreshResumable);
  const setActiveTaskId = useTaskResumeStore((s) => s.setActiveTaskId);
  const prepareResume = useTaskResumeStore((s) => s.prepareResume);
  // 本地状态: 恢复操作进行中
  const [resumingId, setResumingId] = useState<string | null>(null);

  // 组件顶层: workspace 和 industry (供 ProactiveSuggestionCard 等使用)
  // ★ 2026-08-14 修复: 改为响应式订阅, 行业切换后欢迎页自动更新
  const zustandProfile = (useProfileStore((s) => s?.profile) || {}) as Record<string, any>;
const profileWs = zustandProfile?.workspace || localStorage.getItem('agentai.workspace') || '';
const currentWorkspace = profileWs;

// P0: antd message API (用于收藏提示等)
const { message: messageApi } = App.useApp();

const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  const [queuedSends, setQueuedSends] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ParsedAttachment[]>([]);
  // 最近生成的图片（用于对话改图模式无缝衔接）
  const [lastGeneratedImage, setLastGeneratedImage] = useState<ParsedAttachment | null>(null);
  const [scene3D, setScene3D] = useState<Scene3DData | null>(null);
  const [emotionMap, setEmotionMap] = useState<Record<string, EmotionResult>>({});
  const [thinking, setThinking] = useState(true);
  const [subagents, setSubagents] = useState<SubagentInfo[]>([]);
  // 2026-06-24 新增: 透明进度状态
  const [progress, setProgress] = useState<{
    step: string;
    description: string;
    percent: number;
    iteration?: number;
    maxIterations?: number;
    toolCount?: number;
    toolNames?: string;
    successCount?: number;
    failCount?: number;
    durationMs?: number;
  } | null>(null);
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // 2026-09-05: 消息行绑定回调缓存 — key=msg.id, 以 msg 对象引用判定失效
  const rowBindCache = useRef(new Map<string, { key: ChatMessage; b: RowBinds }>());
  // 2026-09-05: 最新 handleSend 引用 — 行缓存里的 onResend 走它, 避免闭包捕获过期 attachments
  const handleSendRef = useRef<(text: string, extra?: ParsedAttachment[]) => void | Promise<void>>(async () => {});
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // P2-1: 使用抽取的 useSmartScroll hook
  const { scrollRef, isScrolledUp, handleScroll, onDone: scrollToTopOnDone, scrollToBottom, reset: resetScroll } = useSmartScroll([messages, queuedSends]);

  // P2-1: 使用抽取的 useSessionAutoSave hook (替换内联自动保存 + 会话切换逻辑)
  useSessionAutoSave(messages, activeId);
  // P0 修复: 会话切换时仅重置滚动 + 清缓存
  // clearMessages 由 useSessionAutoSave hook 负责 (它会在 clear 后立即 setChatMessages 恢复)
  // 此处再调 clearMessages 会与 useSessionAutoSave 竞争, 导致恢复的消息被二次清空
  useEffect(() => {
    resetScroll();
    rowBindCache.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 会话类型感知: 点击生图/生视频会话时自动切换 chatMode
  useEffect(() => {
    if (!activeId) return;
    const session = useSessionStore.getState().sessions.find(s => s.id === activeId);
    if (session?.type === 'image' && chatMode !== 'image_edit') {
      useModelStore.getState().setChatMode('image_edit');
      // P0 修复: 对话改图模式只选支持编辑的模型 (GPT Image / Banana 系列 + Agnes)
      // 之前: 选第一个 image 模型, 可能选到不支持的模型
      const imgModels = useModelStore.getState().models.filter(m => m.modelType === 'image' && m.enabled);
      // 优先选支持编辑的模型: alrc-gpt-image / alrc-nano-banana / agnes
      const editCapable = imgModels.find(m =>
        m.id.includes('gpt-image') || m.id.includes('nano-banana') || m.id.includes('agnes')
      );
      if (editCapable) {
        useModelStore.getState().setActive(editCapable.id);
      } else if (imgModels.length > 0) {
        useModelStore.getState().setActive(imgModels[0].id);
      }
    } else if (session?.type === 'chat' && chatMode === 'image_edit') {
      useModelStore.getState().setChatMode('chat');
    }
  }, [activeId]);

  // 监听 chatMode 变化，显示引导提示
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ mode: string }>;
      if (ce.detail?.mode === 'image_edit' && messages.length === 0) {
        // 首次进入生图模式，添加引导消息
        setTimeout(() => {
          // 获取可用的生图模型列表
          const imageModels = useModelStore.getState().models.filter(m =>
            m.modelType === 'image' && m.enabled
          );
          const modelList = imageModels.length > 0
            ? imageModels.map(m => `• ${m.label}`).join('\n')
            : '• 暂无可用生图模型，请在设置中配置 ALRC 密钥';

          appendMessage({
            id: `welcome-${Date.now()}`,
            role: 'system',
            ts: Date.now(),
            segments: [{ kind: 'text', text: `🎨 **对话改图模式已激活**\n\n您现在可以使用自然语言与 AI 协作生成和编辑图片。\n\n**可用生图模型：**\n${modelList}\n\n**使用方式：**\n• 直接输入图片描述词生成图片（如：画一只橘猫）\n• 上传图片后描述修改需求（如：把背景换成星空）\n• 支持风格迁移、局部编辑、虚拟换装等多种玩法\n\n💡 **提示：** 生图结果会自动保存到历史记录，可在左侧「生图」标签查看` }],
          });
        }, 300);
      }
    };
    window.addEventListener('agentai:switch-chat-mode', handler);
    return () => window.removeEventListener('agentai:switch-chat-mode', handler);
  }, [messages.length]);

  // 智能清空: 先保存记忆再清空
  const smartClear = useCallback(() => {
    try {
      const allText = messages.map(m => ({
        role: m.role,
        content: m.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || '',
      }));
      if (allText.length > 2) {
        MemoryEngine.autoSaveOnTaskComplete(allText, currentWorkspace, '对话清空前自动保存');
        apiWriteMemory({
          userId: 'default',
          workspace: currentWorkspace,
          role: 'assistant',
          content: allText.filter(m => m.role === 'assistant').pop()?.content?.slice(0, 500) || '',
          source: 'frontend-clear',
        });
      }
    } catch { /* best-effort */ }
    clearMessages();
  }, [messages, clearMessages, currentWorkspace]);

  // 监听后端 timeout SSE 事件 — 显示超时恢复提示
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ reason: string; totalMinutes: number; iteration: number }>;
      const info = ce.detail;
      if (info) {
        // 在当前 bot 消息中追加超时提示
        const lastBot = messages.filter(m => m.role === 'assistant').pop();
        if (lastBot) {
          updateMessage(lastBot.id, (m: any) => ({
            ...m,
            segments: [...m.segments, {
              kind: 'text',
              text: `\n\n⏰ **任务超时** (${info.totalMinutes} 分钟, ${info.reason})。可在左侧「任务中心」查看快照并恢复执行。`,
            }],
          }));
        }
      }
    };
    window.addEventListener('agentai:timeout', handler);
    return () => window.removeEventListener('agentai:timeout', handler);
  }, [messages, updateMessage]);

  /* ---- 启动自检: 加载时查询 gateway 健康状态 ---- */
  const [systemReady, setSystemReady] = useState(false);
  const [systemInfo, setSystemInfo] = useState('');

  useEffect(() => {
    if (systemReady) return;
    let cancelled = false;
    const check = async () => {
      try {
        const r = await fetch('/v1/settings/keys?provider=agentai');
        if (!r.ok || cancelled) return;
        const data = await r.json();
        // 简洁查询: 有多少个 key 配置了
        const providers = ['agentai', 'zhipu', 'deepseek'];
        let configured = 0;
        for (const p of providers) {
          try {
            const rr = await fetch(`/v1/settings/keys?provider=${p}`);
            if (rr.ok && (await rr.json()).ok) configured++;
          } catch { /* ignore */ }
        }
        if (cancelled) return;
        const label = import.meta.env.VITE_AGENTAI_MODEL || 'Agnes AI Flash';
        setSystemInfo(`${configured}/${providers.length} API Key 已配置 · ${label}`);
        setSystemReady(true);
      } catch {
        // gateway 离线, 不阻塞
        if (!cancelled) setSystemReady(true);
      }
    };
    check();
    return () => { cancelled = true; };
  }, [systemReady]);

  /* ---- 长任务快照: 进入 ChatView 时拉取可恢复任务 (一次性, 5 分钟后再拉) ---- */
  useEffect(() => {
    refreshResumable();
    const t = setInterval(() => refreshResumable(), 5 * 60_000);
    return () => clearInterval(t);
  }, [refreshResumable]);

  /* ---- Context monitor (token 估算) ---- */
  // 页面关闭/刷新时自动保存记忆
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const allText = messages.map(m => ({
          role: m.role,
          content: m.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || '',
        }));
        if (allText.length > 2) {
          MemoryEngine.autoSaveOnTaskComplete(allText, currentWorkspace, '页面关闭前自动保存');
        }
        // sendBeacon 确保页面关闭时请求能送达
        const lastAsst = allText.filter(m => m.role === 'assistant').pop();
        if (lastAsst?.content && lastAsst.content.length > 30) {
          try {
            const payload = JSON.stringify({
              userId: 'default',
              workspace: currentWorkspace,
              role: 'assistant',
              content: lastAsst.content.slice(0, 500),
              source: 'frontend-beforeunload',
            });
            navigator.sendBeacon('/v1/memory', new Blob([payload], { type: 'application/json' }));
          } catch { /* best-effort */ }
        }
      } catch { /* best-effort */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [messages, currentWorkspace]);

  /* ---- QQ Bot socket.io 桥接: 实时接收 QQ 消息并显示在对话窗口 ---- */
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    // P0 修复: 先清理旧连接 — React StrictMode 下 useEffect 会执行两次
    // 之前: 旧连接的 disconnect 是异步的, 新连接在 disconnect 完成前就创建了
    //       → 多个 socket 连接同时监听 wechat:message → 消息重复显示5次
    // 之后: 先彻底断开旧连接 (disconnect + removeAllListeners), 再创建新连接
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const gatewayWs = (window as any).__AGENTAI_GATEWAY__ || 'ws://127.0.0.1:18789';
    const httpUrl = gatewayWs.replace(/^ws([s]?):\/\//, 'http$1://');
    const sock = io(httpUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = sock;

    sock.on('qq:message', (data: any) => {
      const label = data.source === 'qq-group' ? 'QQ群' : 'QQ私聊';
      const userId = `qq-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      appendMessage({
        id: userId,
        role: 'user',
        segments: [{ kind: 'text', text: data.content }],
        ts: Date.now(),
        status: 'sent',
        // A4: 标记消息来源渠道, 供前端显示渠道图标和「回复到外部渠道」按钮
        framework: `channel:qq:${data.source === 'qq-group' ? 'group' : 'private'}:${data.userId || ''}`,
      } as any);
      // 标记为 qq 消息供后续处理
      setEmotionMap(prev => ({ ...prev, [userId]: { emotion: 'neutral', intensity: 0.5, label: '中性', emoji: '😐' } }));
    });

    sock.on('qq:reply', (data: any) => {
      const label = data.source === 'qq-group' ? `QQ群回复` : 'QQ回复';
      appendMessage({
        id: `qq-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        segments: [{ kind: 'text', text: `[${label}] ${data.content}` }],
        ts: Date.now(),
        status: 'done',
        provider: 'qq-bot',
      });
    });

    // 微信消息桥接
    sock.on('wechat:message', (data: any) => {
      const msgId = `wx-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      appendMessage({
        id: msgId,
        role: 'user',
        segments: [{ kind: 'text', text: data.content }],
        ts: Date.now(),
        status: 'sent',
        // A4: 标记消息来源渠道
        framework: `channel:wechat:private:${data.userId || ''}`,
      } as any);
      setEmotionMap(prev => ({ ...prev, [msgId]: { emotion: 'neutral', intensity: 0.5, label: '中性', emoji: '😐' } }));
    });

    sock.on('wechat:reply', (data: any) => {
      appendMessage({
        id: `wx-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        segments: [{ kind: 'text', text: `[微信回复] ${data.content}` }],
        ts: Date.now(),
        status: 'done',
        provider: 'wechat-bot',
      });
    });

    sock.on('disconnect', (reason: string) => {
      // 静默处理 disconnect, 不显示给用户
      // socket.io 会自动重连, 重连成功后会继续收消息
      // 只有长时间断线才会由 GatewayFallback 检测并通知
      console.debug('[ChatView] WebSocket disconnected:', reason);
    });

    // 2026-06-24 新增: 透明进度监听
    sock.on('progress', (data: any) => {
      setProgress(data);
      // 任务完成时清除进度状态
      if (data.step === 'done') {
        setTimeout(() => setProgress(null), 2000);
      }
    });

    // WebSocket 重连成功提示 (只在真正重连后显示)
    sock.on('reconnect', (attemptNumber: number) => {
      // 不显示重连成功消息, 避免刷屏
    });

    /* ═══ 统一执行结果推送: 自动化/定时任务不再刷屏对话窗口 ═══ */
    // 改为: 成功→静默; 失败→仅桌面通知; 用户可去任务面板查看详情
    sock.on('execution:result', (data: any) => {
      const sourceLabel: Record<string, string> = { workflow: '工作流', automation: '自动化任务', cron: '定时任务' };
      const label = sourceLabel[data.source] || data.source || '任务';
      const eventLabel = data.success ? '✅ 执行成功' : '❌ 执行失败';

      if (data.event === 'done' || data.event === undefined) {
        // 工作流结果仍然显示在对话窗口 (用户主动触发的)
        if (data.source === 'workflow') {
          const durationStr = data.durationMs ? ` (耗时 ${(data.durationMs / 1000).toFixed(1)}s)` : '';
          const errorStr = data.error ? `\n错误: ${data.error}` : '';
          appendMessage({
            id: `exec-${data.source}-${data.id || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: 'assistant',
            segments: [{ kind: 'text', text: `[${label}] ${data.name || '未命名任务'} ${eventLabel}${durationStr}${errorStr}` }],
            ts: Date.now(),
            status: 'done',
            provider: 'system',
          } as any);
        }

        // 自动化/定时任务: 只桌面通知, 不推对话窗口
        // 成功时静默不发通知 (避免刷屏), 失败时通知
        if (!data.success && data.source !== 'workflow') {
          taskNotifier.notifyTaskComplete(
            `❌ ${label} 失败`,
            `${data.name || '未命名任务'}${data.error ? `\n${data.error.slice(0, 200)}` : ''}`,
          );
        }
      }
    });

    /* ═══ 工作流进度实时展示 ═══ */
    sock.on('workflow:started', (data: any) => {
      appendMessage({
        id: `wf-start-${data.executionId}-${Date.now()}`,
        role: 'assistant',
        segments: [{ kind: 'text', text: `[工作流] 🚀 ${data.templateName} 开始执行 (共 ${data.totalSteps} 步)` }],
        ts: Date.now(),
        status: 'done',
        provider: 'system',
      } as any);
    });

    sock.on('workflow:step', (data: any) => {
      const statusIcon: Record<string, string> = { success: '✅', failed: '❌', running: '⏳', skipped: '⏭️' };
      const icon = statusIcon[data.status] || '➡️';
      appendMessage({
        id: `wf-step-${data.executionId}-${data.stepId}-${Date.now()}`,
        role: 'assistant',
        segments: [{ kind: 'text', text: `  ${icon} ${data.stepName}: ${data.status}${data.error ? ' - ' + data.error : ''}` }],
        ts: Date.now(),
        status: 'done',
        provider: 'system',
      } as any);
    });

    return () => { sock.removeAllListeners(); sock.disconnect(); socketRef.current = null; };
  }, []);

  /* ═══ 子智能体事件: 展示思考过程 + 工具调用 ═══ */
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock) return;

    sock.on('subagent:start', (data: any) => {
      setSubagents(prev => [...prev, {
        id: data.id,
        type: data.type || 'sub',
        task: data.task || '',
        status: 'running' as const,
        steps: [],
      }]);
    });

    sock.on('subagent:progress', (data: any) => {
      setSubagents(prev => prev.map(sa => {
        if (sa.id !== data.id) return sa;
        const stepDesc = data.event === 'tool_start'
          ? `🔧 调用工具: ${data.name || ''}`
          : data.event === 'tool_done'
            ? `✅ 工具完成: ${data.name || ''}`
            : data.event === 'progress'
              ? data.description || `迭代 ${data.iteration || ''}`
              : `思考中...`;
        return { ...sa, steps: [...(sa.steps || []), stepDesc].slice(-20) };
      }));
    });

    sock.on('subagent:done', (data: any) => {
      setSubagents(prev => prev.map(sa =>
        sa.id === data.id
          ? { ...sa, status: 'done' as const, result: data.result || '', steps: [...(sa.steps || []), `✅ 完成: ${(data.result || '').slice(0, 100)}`] }
          : sa
      ));
    });

    sock.on('subagent:error', (data: any) => {
      setSubagents(prev => prev.map(sa =>
        sa.id === data.id
          ? { ...sa, status: 'error' as const, steps: [...(sa.steps || []), `❌ 失败: ${data.error || ''}`] }
          : sa
      ));
    });

    return () => {
      sock.off('subagent:start');
      sock.off('subagent:progress');
      sock.off('subagent:done');
      sock.off('subagent:error');
    };
  }, []);

  const CTX_MAX = 1_000_000;
  const FOLD_THRESHOLD = 0.70;
  const tokenInfo = useMemo(() => {
    const result = countTokens(
      messages.flatMap(m => m.segments.filter(s => s.kind === 'text')),
      activeModelId,
      CTX_MAX,
    );
    return {
      tokens: result.tokens,
      ratio: result.ratio,
      nearing: result.ratio >= FOLD_THRESHOLD * 0.7,
      critical: result.ratio >= FOLD_THRESHOLD,
      pct: result.pct,
    };
  }, [messages, activeModelId]);

  /* ---- 文件大小格式化 ---- */
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
  }

  /* ---- Send handler ---- */
  const handleSend = useCallback(async (text: string, extraAttachments?: ParsedAttachment[], opts?: { webSearch?: boolean; isAnswer?: boolean }) => {
    // 追问卡片自动退让: 用户在对话框直接输入时关闭卡片（用 ref 避免闭包陷阱）
    if (askUserCardRef.current) {
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      setLoading(false);
      setAskUserCard(null);
    }

    // 正在处理时: 中断旧对话, 立即发送新消息 (压制模式)
    if (loading) {
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      // 标记正在流式的 bot 消息为已中断
      const streamingMsgs = useChatStore.getState().messages.filter(m => m.streaming);
      for (const m of streamingMsgs) {
        updateMessage(m.id, (prev) => ({
          ...prev, streaming: false, status: 'interrupted' as any,
          segments: [...prev.segments, { kind: 'text', text: '\n\n⚡ 已被新消息中断' }],
        }));
      }
      setLoading(false);
    }

    // 捕获当前附件并发送, 发送后清空 (必须先捕获再检查, 因为 setAttachments 会清空)
    // regenerate 时通过 extraAttachments 传入恢复的附件
    const effectiveAttachments = extraAttachments || attachments;
    const hasText = text.trim();
    const hasAttachments = effectiveAttachments.length > 0;
    if (!hasText && !hasAttachments) return;

    // 纯附件消息: 给 LLM 一个合理的文本提示
    let messageText = text;
    if (!hasText && hasAttachments) {
      const imageCount = effectiveAttachments.filter(a => a.kind === 'image').length;
      const fileCount = effectiveAttachments.length - imageCount;
      messageText = imageCount > 0 && fileCount > 0
        ? `请查看上传的 ${imageCount} 张图片和 ${fileCount} 个文件`
        : imageCount > 0
          ? `请查看上传的 ${imageCount} 张图片`
          : `请查看上传的 ${fileCount} 个文件`;
    }

    // 智能模式推荐: 发送前检测消息意图
    if (recommendEnabled) {
      const suggestion = suggestMode(text, mode);
      if (suggestion) {
        setSuggestedMode(suggestion.mode as any, suggestion.reason);
      }
    }

    // 自动模型推荐: 根据消息复杂度建议更合适的模型
    const autoModel = useModelStore.getState();
    if (autoModel.autoModelEnabled) {
      const analysis = analyzeComplexity(text);
      autoModel.setAutoModelAnalysis(analysis);
      // 分析结果存入 autoModelLastAnalysis, 但当前无 UI 消费它 (TODO: 建议在消息区
      // 显示"建议切换到 <tier.label>"并提供一键采纳)。此处保留计算以便接入时零改动。
    }

    setLoading(true);

    // ═══ 前端直接拦截音乐关键词, 绕过 LLM 直接触发播放 ═══
    const MUSIC_TRIGGERS = /放点音乐|放首歌|听歌|想听音乐|想听歌|来点音乐|音乐播放|开始播放|播放音乐|放音乐|放松.*音乐|听.*音乐|音乐.*放松|累了|background music|play music|play song/i;
    if (MUSIC_TRIGGERS.test(text) && !text.startsWith('/')) {
      window.dispatchEvent(new CustomEvent('agentai:music-action', {
        detail: { action: 'play' },
      }));
      // 通知 StatusBar 弹出播放面板
      window.dispatchEvent(new CustomEvent('agentai:music-action', {
        detail: { action: 'show' },
      }));
    }

    // ═══ 前端直接拦截音乐控制命令 (暂停/切歌/音量) ═══
    const MUSIC_CONTROL: Array<{ pattern: RegExp; action: string; extra?: any }> = [
      { pattern: /暂停|暂停音乐|暂停播放|先暂停/i, action: 'pause' },
      { pattern: /下一首|下[一1]曲|切歌|换一首|下一曲|next/i, action: 'next' },
      { pattern: /上一首|上[一1]曲|上一曲|prev/i, action: 'prev' },
      { pattern: /音量调大|大点声|大声点|调大音量|volume\s*up|音量.*大/i, action: 'volume', extra: { volume: 0.8 } },
      { pattern: /音量调小|小点声|小声点|调小音量|volume\s*down|音量.*小/i, action: 'volume', extra: { volume: 0.2 } },
    ];
    for (const { pattern, action, extra } of MUSIC_CONTROL) {
      if (pattern.test(text)) {
        const detail: any = { action };
        if (extra?.volume !== undefined) detail.volume = extra.volume;
        else if (extra) Object.assign(detail, extra);
        window.dispatchEvent(new CustomEvent('agentai:music-action', { detail }));
        // 纯控制命令不需要走 LLM, 直接返回
        if (action === 'pause' || action === 'next' || action === 'prev') {
          appendMessage({ id: `bot-${Date.now()}`, role: 'assistant', segments: [{ kind: 'text', text: action === 'pause' ? '⏸ 已暂停播放' : action === 'next' ? '⏭ 已切换到下一首' : '⏮ 已切换到上一首' }], ts: Date.now(), status: 'done' });
          setLoading(false);
          return;
        }
        break;
      }
    }

    // regenerate 时使用传入的附件, 不清空用户当前附件状态
    const currentAttachments = extraAttachments || [...attachments];
    if (!extraAttachments) {
      setAttachments([]);
    }

    // Ensure session
    let sessionId = activeId;
    if (!sessionId) {
      sessionId = createSession('新对话');
    }
    // 保存当前 sessionId 供审批回调使用
    setPlanSessionId(sessionId || 'default');
    // 重置审批状态
    setPlanNeedsApproval(false);

    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const botId = `bot-${Date.now()}`;
    // 记录当前会话 ID — SSE 回调中检查是否还在同一会话
    const sendSessionId = activeId;

    // 构建用户消息段: 文本 + 图片缩略图 + 文件标记
    const userSegments: any[] = [{ kind: 'text', text: messageText }];
    for (const att of currentAttachments) {
      if (att.kind === 'image' && att.dataUrl) {
        // dataUrl 是 data:image/png;base64,... 格式, 提取纯base64
        const base64 = att.dataUrl.replace(/^data:image\/\w+;base64,/, '');
        userSegments.push({ kind: 'image', base64, alt: att.name });
      } else {
        // 非图片文件: 在气泡内显示文件信息, 让用户知道已上传
        const icon = att.kind === 'table' ? '📊' : att.kind === 'binary' ? '📎' : '📄';
        userSegments.push({ kind: 'text', text: `${icon} ${att.name} (${formatFileSize(att.size)})` });
      }
    }

    // 标记用户消息为发送中
    appendMessage({ id: userId, role: 'user', segments: userSegments, ts: Date.now(), status: 'sending' });
    appendMessage({ id: botId, role: 'assistant', segments: [], ts: Date.now(), streaming: true, status: 'processing', provider: activeModelId });

    // 更新用户消息为已发送
    const userMsgId = userId;
    setTimeout(() => {
      updateMessage(userMsgId, (m: any) => ({ ...m, status: 'sent' }));
    }, 200);

    // Save to session store
    // 2026-10-05 P0 修复: 传 id=userId ——
    //   让 store 里的消息 id 与流式响应的 id 一致，
    //   否则 ChatView:952 的 findIndex(m => m.id === id) 永远匹配不上，
    //   切会话时这条消息的流式更新会被丢弃（用户看起来就是"内容丢了"）。
    addMessage(sessionId!, { id: userId, role: 'user', content: messageText, ts: Date.now() });

    // 自动更新对话标题：取第一条用户消息前 30 字
    if (sessionId) {
      const session = sessions.find(s => s.id === sessionId);
      if (session && session.title === '新对话' && messageText.trim()) {
        useSessionStore.getState().updateTitle(sessionId, (messageText || '').trim().slice(0, 30));
      }
    }

    // 情绪分析 — 仅使用快速启发式 (不调 LLM, 零延迟, 已集成到对话请求中)
    const quickEmotion = analyzeEmotionQuick(text);
    setEmotionMap(prev => ({ ...prev, [userId]: quickEmotion }));

    const controller = new AbortController();
    abortRef.current = controller;

    // 智能超时保护: 有活动(delta/工具调用)时重置计时器, 只在完全无响应时才中止
    let lastActivityTs = Date.now();
    const IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟无任何活动才超时
    const timeoutChecker = setInterval(() => {
      if (Date.now() - lastActivityTs > IDLE_TIMEOUT && abortRef.current === controller) {
        controller.abort();
        updateMessage(botId, (m: any) => ({
          ...m, streaming: false, status: 'error',
          segments: [...m.segments, { kind: 'text', text: '\n\n⏱ 请求超时 (5 分钟无响应)' }],
        }));
        setLoading(false);
        abortRef.current = null;
        clearInterval(timeoutChecker);
      }
    }, 30000); // 每 30 秒检查一次

    const baseHandlers = makeChatHandlers(botId, (id: string, fn: (m: any) => any) => {
  // 会话隔离: 如果用户已切换到其他会话, 将更新写入原会话而非当前显示
  if (activeId !== sendSessionId) {
    // 用户已切换会话 — 更新原会话的消息 (通过 sessionStore)
    const sessionStore = useSessionStore.getState();
    const session = sessionStore.sessions.find(s => s.id === sendSessionId);
    if (session) {
      // 2026-10-05 P0 修复: 此前 SessionMessage 根本没有 id 字段，
      //   `m.id === id` 恒为 false → msgIdx 恒 -1 → 更新被静默丢弃，
      //   用户看到的就是"生成过程中切会话，内容就没了"。
      //   现在 store 层已补id（addMessage 透传/生成 + migrate 补历史数据）。
      //   兜底: 若该会话最后一条消息没有 id（升级前的历史数据），视为本次生成的消息。
      const msgs = session.messages as any[];
      let msgIdx = msgs.findIndex(m => m.id === id);
      if (msgIdx < 0 && msgs.length > 0 && !msgs[msgs.length - 1].id) {
        msgIdx = msgs.length - 1;
      }
      if (msgIdx >= 0) {
        const updatedMessages = [...msgs];
        updatedMessages[msgIdx] = fn(updatedMessages[msgIdx]);
        useSessionStore.setState({
          sessions: sessionStore.sessions.map(s =>
            s.id === sendSessionId ? { ...s, messages: updatedMessages } : s
          ),
        });
      }
      return; // 不更新当前显示
    }
  }
  // 同一会话 — 正常更新当前显示
  updateMessage(id, fn);
});
    const handlers = {
      ...baseHandlers,
      // 包装 onDelta: 重置超时计时器
      onDelta: (info: any) => { lastActivityTs = Date.now(); baseHandlers.onDelta?.(info); },
      // 缓存工具调用参数 (onToolResult 中需要)
      _toolArgsCache: {} as Record<string, any>,
      // 2026-06-24 新增: 透明进度处理
      onProgress: (info: any) => {
        setProgress(info);
        // 任务完成时清除进度状态
        if (info.step === 'done') {
          setTimeout(() => setProgress(null), 2000);
        }
      },
      onModelFallback: (info: any) => {
        // 模型降级通知: 在消息中显示提示
        updateMessage(botId, (m: any) => ({
          ...m, segments: [...m.segments, { kind: 'text', text: `\n\n⚠️ ${info.reason || '模型已自动切换'} (${info.from} → ${info.to})\n\n` }],
        }));
      },
      onToolStart: (info: any) => {
        lastActivityTs = Date.now(); // 重置超时计时器
        // 缓存 args 供 onToolResult 使用
        handlers._toolArgsCache[info.callId] = info.args;
        updateMessage(botId, (m: any) => ({
          ...m, segments: [...m.segments, { kind: 'tool', callId: info.callId, name: info.name, state: 'running', args: info.args }],
        }));
        // ═══ 浏览器工具自动激活: AI 调 browser_* 时前端自动弹出浏览器面板 ═══
        if (info.name && /^browser_/.test(info.name)) {
          window.dispatchEvent(new CustomEvent('agentai:show-browser', {
            detail: { name: info.name, args: info.args, url: info.args?.url || info.args?.target || '' },
          }));
        }
        // 桥接 → 全局任务编排器
        useTaskOrchestrator.getState().addToolCall({
          callId: info.callId, name: info.name, args: info.args,
          status: 'running', startedAt: Date.now(),
        });
      },
      onToolResult: (info: any) => {
        lastActivityTs = Date.now(); // 重置超时计时器
        updateMessage(botId, (m: any) => {
          const segs = m.segments.map((s: any) =>
            s.kind === 'tool' && s.callId === info.callId
              ? { ...s, state: info.ok ? 'success' as const : 'error' as const, result: info.result, ok: info.ok, durationMs: info.durationMs }
              : s,
          );
          return { ...m, segments: segs };
        });

        // 浏览器操作: 如果工具返回 _iframe_action, 触发前端 iframe 执行
        try {
          const result = typeof info.result === 'string' ? JSON.parse(info.result) : info.result;
          if (result?._iframe_action) {
            window.dispatchEvent(new CustomEvent('agentai:browser-action', {
              detail: result._iframe_action,
            }));
          }
          // 浏览器关闭: AI 调用 browser_close 时自动关闭浏览器面板
          if (info.name === 'browser_close' || result?._browser_action === 'close') {
            window.dispatchEvent(new CustomEvent('pulseflow:browser:close', {
              detail: { reason: result?.output || '任务已完成' },
            }));
          }
          // 音乐控制: 如果工具返回 _music_action, 触发前端音乐播放器
          if (result?._music_action) {
            window.dispatchEvent(new CustomEvent('agentai:music-action', {
              detail: { action: result._music_action, volume: result.volume, trackIndex: result.trackIndex },
            }));
          }
        } catch { /* best-effort */ }

        // 图片检测: 如果工具结果包含图片数据, 自动插入 image segment
        detectAndInsertImage(botId, info.name, info.result, updateMessage, (url, alt, filePath) => {
          const gatewayHttp = (window as any).__AGENTAI_GATEWAY__?.replace(/^ws([s]?):\/\//, 'http$1://') || 'http://127.0.0.1:18789';
          const imgDataUrl = filePath
            ? `${gatewayHttp}/api/files/download?path=${encodeURIComponent(filePath)}`
            : url;
          setLastGeneratedImage({
            name: alt || 'generated.png',
            mimetype: 'image/png',
            size: 0,
            content: `[图片: ${alt}]`,
            dataUrl: imgDataUrl,
            kind: 'image' as const,
          });
        });

        // SVG 图表渲染: generate_diagram 结果自动注入为 text segment
        if (info.name === 'generate_diagram' && info.ok) {
          try {
            const result = typeof info.result === 'string' ? info.result : JSON.stringify(info.result);
            const svgMatch = result.match(/<svg[\s\S]*?<\/svg>/i);
            if (svgMatch) {
              updateMessage(botId, (m: any) => ({
                ...m,
                segments: [...m.segments, { kind: 'text', text: '\n\n```svg\n' + svgMatch[0] + '\n```\n' }],
              }));
            }
          } catch { /* svg extraction best-effort */ }
        }

        // 3D 场景渲染: generate_3d_scene 结果自动渲染为可交互 3D 预览
        if (info.name === 'generate_3d_scene' && info.ok) {
          try {
            const result = typeof info.result === 'string' ? JSON.parse(info.result) : info.result;
            if (result?.data?.scene) {
              setScene3D(result.data.scene);
            }
          } catch { /* 3d scene best-effort */ }
        }

        // 生成文件: 将文件路径写入工具结果 data 字段，供 Threads/FilesFromToolSegment/FileCard 渲染可点击卡片
        // note: tool:start 已携带 args（含 path），FileCard 会直接从 args.path 提取，此处仅需补充从 run_code 输出中解析的路径
        // AI 创建文件后触发文件树刷新事件
        if (info.ok && ['write_file', 'create_file'].includes(info.name)) {
          window.dispatchEvent(new CustomEvent('agentai:file-created', { detail: { toolName: info.name } }));
          try {
            const cachedArgs = handlers._toolArgsCache?.[info.callId] || undefined;
            const args = typeof cachedArgs === 'string' ? JSON.parse(cachedArgs) : cachedArgs;
            let filePath = args?.path || args?.filePath || args?.file || args?.file_path || '';
            // run_code: 从输出文本中提取文件路径
            if (!filePath && info.result) {
              const resultStr = typeof info.result === 'string' ? info.result : JSON.stringify(info.result);
              const fileMatch = resultStr.match(/(?:已生成|已创建|saved?|wrote|created|output)[:\s]*[`'"]*([^\s`'"]+\.\w{2,5})/i);
              if (fileMatch) filePath = fileMatch[1];
            }
            if (filePath) {
              updateMessage(botId, (m: any) => ({
                ...m,
                segments: m.segments.map((s: any) =>
                  s.kind === 'tool' && s.callId === info.callId
                    ? { ...s, data: { ...s.data, generatedPath: filePath } }
                    : s,
                ),
              }));
            }
          } catch { /* best-effort */ }
        }

        // ═══ 桥接 → 全局任务编排器: plan_task 创建计划 ═══
        if (info.name === 'plan_task' && info.ok && info.data?.action === 'plan_created' && info.data?.plan) {
          const plan = info.data.plan;
          const stages = (plan.subtasks || []).map((t: any, i: number) => ({
            key: t.id || `task-${i}`,
            label: t.title || `任务 ${i + 1}`,
            status: (t.status === 'completed' ? 'success' : 'pending') as TaskStatus,
          }));
          useTaskOrchestrator.getState().startTask(
            plan.id || `plan-${Date.now()}`,
            plan.goal || info.result || '任务规划',
            stages,
          );
        }

        // 桥接 → 全局任务编排器: 更新工具调用结果
        useTaskOrchestrator.getState().updateToolCall(info.callId, info.result, info.ok, info.durationMs);

        // 桥接 → 检测代码变更 (write_file / edit_file 等工具)
        try {
          const toolNames = ['write_file', 'edit_file', 'create_file', 'modify_file', 'delete_file', 'replace_in_file', 'multi_edit'];
          if (toolNames.includes(info.name)) {
            const args = typeof info.args === 'string' ? JSON.parse(info.args) : info.args;
            const filePath = args?.path || args?.filePath || args?.file_path || '';
            if (filePath) {
              const changeType = ['delete_file', 'remove_file'].includes(info.name) ? 'deleted'
                : ['create_file', 'write_file'].includes(info.name) && info.ok ? 'created' : 'modified';
              useTaskOrchestrator.getState().addCodeChange({
                filePath,
                type: changeType as 'created' | 'modified' | 'deleted',
                summary: `${info.name}: ${filePath.split(/[\\/]/).pop()}`,
                diff: args?.diff || (typeof args?.content === 'string' ? String(args.content).slice(0, 500) : undefined),
                timestamp: Date.now(),
              });
            }
          }
        } catch { /* best-effort code change detection */ }

        // D2: 广播 AI 代码变更事件 (gateway 回传 lineRanges → 编辑器真实行号装饰)
        try {
          const lr: any[] = info.data?.lineRanges;
          if (Array.isArray(lr) && lr.length > 0) {
            const byFile = new Map<string, any[]>();
            for (const range of lr) {
              const arr = byFile.get(range.file) || [];
              arr.push(range);
              byFile.set(range.file, arr);
            }
            for (const [file, entries] of byFile) {
              window.dispatchEvent(new CustomEvent('agentai:ai-change', {
                detail: { file, tool: info.name, entries },
              }));
            }
          }
        } catch { /* best-effort ai-change broadcast */ }
      },
      onDone: (info: any) => {
        updateMessage(botId, (m: any) => {
          // 兜底: 降级/缓存命中/空流路径没有 delta 事件, 内容只在 done.content 里
          let segments = m.segments;
          const hasText = m.segments?.some((s: any) => s.kind === 'text' && s.text?.trim());
          if (info?.content?.trim() && !hasText) {
            segments = [...(m.segments || []), { kind: 'text', text: info.content }];
          }
          return {
            ...m, segments, streaming: false, provider: info?.displayModel || info?.provider || 'unknown', status: 'done',
            usage: info?.usage,
          };
        });

        // TTS语音播报: AI回复完成时自动播报 (best-effort, 不阻塞)
        setTimeout(() => {
          if (checkTts()) {
            const lastMsg = useChatStore.getState().messages.find((m: any) => m.id === botId);
            const text = lastMsg?.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('');
            if (text) speak(text.slice(0, 500)).catch(() => {}); // 最多播报500字
          }
        }, 100);

        // 自动记忆: 检测任务完成, 保存到 MemoryEngine + 后端持久化
        try {
          const allText = messages.map(m => ({
            role: m.role,
            content: m.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || '',
          }));
          const lastAssistant = allText.filter(m => m.role === 'assistant').pop();
          if (lastAssistant && lastAssistant.content && lastAssistant.content.length > 30) {
            MemoryEngine.autoSaveOnTaskComplete(
              allText,
              currentWorkspace,
              String(lastAssistant.content).slice(0, 80).replace(/\n/g, ' ').trim(),
            );
            // 同步写入后端记忆 (POST /v1/memory)
            apiWriteMemory({
              userId: 'default',
              workspace: currentWorkspace,
              role: 'assistant',
              content: String(lastAssistant.content).slice(0, 500),
              source: 'frontend-auto',
            });
          }
        } catch { /* memory save is best-effort */ }

        // 任务完成通知
        taskNotifier.notifyTaskComplete();
        // 任务链标记完成
        setChainStages(prev => prev.map(s => s.status === 'running' ? { ...s, status: 'success' as StageStatus } : s));
        setChainCurrent('report');
        // 桥接 → 全局任务编排器: 任务完成
        useTaskOrchestrator.getState().finishTask(true);
        // 延迟隐藏编排器 (3秒后自动消失)
        setTimeout(() => {
          setChainId('');
          setChainGoal('');
          setChainStages([]);
          setChainCurrent('plan');
        }, 3000);
      },
      onError: (err: string) => {
        // 结构化的错误卡片, 解析关键信息
        const isTimeout = err.includes('timeout') || err.includes('超时') || err.includes('timed out');
        const details = err.length > 120 ? err.slice(0, 120) + '...' : undefined;
        updateMessage(botId, (m: any) => ({
          ...m, streaming: false, status: 'error',
          segments: [...m.segments, {
            kind: 'error',
            error: err.length > 80 ? err.slice(0, 80) + '...' : err,
            details,
            fix: isTimeout ? '⏰ 任务超时。可在「任务中心」查看快照并恢复执行' :
                 err.includes('rate limit') ? '请求过于频繁，请稍后再试' :
                 err.includes('unauthorized') ? '请检查 API Key 配置' :
                 err.includes('not found') ? '检查文件路径是否正确' : undefined,
          }],
        }));
        // 超时时提示恢复入口
        if (isTimeout) {
          console.warn('[chat] 任务超时, 可在任务中心恢复');
        }
        // 任务链标记失败 + 延迟隐藏
        setChainStages(prev => prev.map(s => s.key === chainCurrent ? { ...s, status: 'failed' as StageStatus } : s));
        // 桥接 → 全局任务编排器: 任务失败
        useTaskOrchestrator.getState().finishTask(false);
        setTimeout(() => { setChainId(''); setChainGoal(''); setChainStages([]); setChainCurrent('plan'); }, 3000);
      },
      onPlanCreated: (info: any) => {
        setChainId(info.chainId || '');
        setChainGoal(info.goal || '');
        setChainCurrent('plan');
        // 检测规划模式审批标志
        if (info.needsApproval) {
          setPlanNeedsApproval(true);
        }
        setChainStages([
          { key: 'plan', status: 'running' },
          { key: 'solve', status: 'pending' },
          { key: 'verify', status: 'pending' },
          { key: 'fix', status: 'pending' },
          { key: 'report', status: 'pending' },
        ]);
        // 桥接 → 全局任务编排器: AI 触发新任务
        const stageLabels: Record<string, string> = {
          plan: '规划', solve: '执行', verify: '验证', fix: '修复', report: '报告',
          explore: '探索', analyze: '分析', implement: '实现', test: '测试', deploy: '部署',
          understand: '理解', execute: '执行',
        };
        // 修复: 处理后端发送的 stages 格式，确保每个 stage 有 status 字段
        const incomingStages = info.stages || [{ key: 'plan', label: '规划' }, { key: 'solve', label: '执行' }, { key: 'verify', label: '验证' }];
        const normalizedStages = incomingStages.map((s: any, index: number) => ({
          key: s.key || `stage-${index}`,
          label: s.label || stageLabels[s.key] || s.key || `阶段 ${index + 1}`,
          status: (s.status || (index === 0 ? 'running' : 'pending')) as TaskStatus,
        }));
        useTaskOrchestrator.getState().startTask(
          info.chainId || `task-${Date.now()}`,
          info.goal || messageText,
          normalizedStages,
        );
        if (info.needsApproval) {
          useTaskOrchestrator.getState().activeTask!.needsApproval = true;
        }
      },
      onPlanStage: (info: any) => {
        const stage = info.stage as ChainStage;
        setChainStages(prev => prev.map(s => {
          if (s.key === stage) return { ...s, status: 'running' as StageStatus };
          if (s.status === 'running') return { ...s, status: 'success' as StageStatus };
          return s;
        }));
        setChainCurrent(stage);
        // 桥接 → 全局任务编排器: 更新阶段状态
        const orchestrator = useTaskOrchestrator.getState();
        // 先把之前 running 的阶段标记为 success
        if (orchestrator.activeTask) {
          for (const s of orchestrator.activeTask.stages) {
            if (s.status === 'running' && s.key !== stage) {
              orchestrator.updateStage(s.key, 'success');
            }
          }
        }
        orchestrator.updateStage(stage, 'running');
      },
      onMemoryAuto: (info: any) => {
        if (info.written > 0) {
          // 通知 AutoMemoryPanel 刷新 (通过自定义事件)
          window.dispatchEvent(new CustomEvent('agentai:memory-updated', {
            detail: { written: info.written, skipped: info.skipped, ts: Date.now() },
          }));
        }
      },
      onApprovalRequired: (info: any) => {
        setApprovalProposal({
          id: info.id,
          type: info.type,
          filePath: info.filePath,
          summary: info.summary,
          riskLevel: info.riskLevel,
          diff: info.diff,
          toolName: info.toolName,
          ts: Date.now(),
        });
      },
      onAskUser: (info: any) => {
        setAskUserCard({ question: info.question, options: info.options || [] });
      },
      onSessionRollover: (info: any) => {
        // 上下文超额 → 自动生成摘要并开新对话
        // 2026-10-05 修正两处隐患:
        //  1) 原来取 messages[0]（**第一条**）当标题, 应为最后一条
        //  2) 原来无条件 clearMessages() + 2 秒延迟 —— 但 setActive(id) 之后当前显示
        //     已切到新会话(本就为空), 再清会清错对象; 且 2 秒内用户新发的消息也会被抹掉。
        //     改为只切会话, 不清当前消息。
        // 注: 后端目前从未 emit 'session_rollover'(全库仅此处消费), 故长期是死代码;
        //     一旦后端接上, 上述行为必须正确。
        const pct = (info.ratio * 100).toFixed(0);
        const summary = "📋 前一个对话已达 " + pct + "% 上下文 (使用 " + info.promptTokens + " tokens / 共 " + info.ctxMax + " tokens)。";
        try { apiWriteMemory({ userId: 'user', workspace: currentWorkspace, role: 'summarize', content: summary }); } catch {}
        try {
          const lastMsg = messages[messages.length - 1];
          const seg = lastMsg?.segments?.[0];
          const lastText = seg && 'text' in seg ? seg.text : '';
          const id = createSession("续: " + (lastText || '上一轮对话').slice(0, 30));
          setActive(id);
        } catch { /* rollover best-effort */ }
      },
      onClarifyRequired: (info: any) => {
        setClarificationReq({
          id: info.id,
          originalMessage: info.originalMessage,
          questions: info.questions,
          ambiguities: info.ambiguities,
        });
      },
      // 子智能体事件: 实时显示 SubagentStatus 组件
      onSubagentStart: (info: any) => {
        lastActivityTs = Date.now();
        setSubagents(prev => {
          const existing = prev.find(a => a.id === info.id);
          if (existing) return prev.map(a => a.id === info.id ? { ...a, status: 'running' as const, task: info.task } : a);
          return [...prev, { id: info.id, type: info.type || 'explore', task: info.task, status: 'running' as const }];
        });
      },
      onSubagentDone: (info: any) => {
        lastActivityTs = Date.now();
        const subagentResult = typeof info.result === 'string' ? info.result : JSON.stringify(info.result || '');
        setSubagents(prev => prev.map(a => a.id === info.id ? { ...a, status: 'done' as const, result: subagentResult } : a));
        // 折叠后延迟移除已完成 Agent
        setTimeout(() => {
          setSubagents(prev => prev.filter(a => a.id !== info.id));
        }, 5000);
      },
      onSubagentError: (info: any) => {
        lastActivityTs = Date.now();
        setSubagents(prev => prev.map(a => a.id === info.id ? { ...a, status: 'error' as const, error: info.error } : a));
      },
      onToolStuck: (info: any) => {
        lastActivityTs = Date.now();
        updateMessage(botId, (m: any) => ({
          ...m, segments: [...m.segments, {
            kind: 'text',
            text: `\n\n> ⚠️ 工具 \`${info.tool}\` 疑似卡死 (${info.count} 次调用)\n`,
          }],
        }));
      },
    };

    try {
      const provider = activeModelId || 'agentai';
      const base = gatewayFallback.url; // 在线=''走proxy, 离线=直连Agnes
      // 修复: 从 profileStore 读取 workspace (而非 localStorage 'agentai.workspace')
      const profileWs = useProfileStore.getState()?.profile?.workspace;
      const ws = profileWs || localStorage.getItem('agentai.workspace') || '';
      // 合并多来源 profile: zustand persist (主) + agentai.profile (补充) + questionnaire (问卷)
      const rawProfile = localStorage.getItem('agentai-user-profile');
      const zustandProfile = rawProfile ? JSON.parse(rawProfile)?.state?.profile : {};
      const rawExtra = localStorage.getItem('agentai.profile');
      const extraProfile = rawExtra ? JSON.parse(rawExtra) : {};
      const rawQuestionnaire = localStorage.getItem('agentai.memory.questionnaire');
      const questionnaire = rawQuestionnaire ? JSON.parse(rawQuestionnaire)?.answers : {};
      const profile = { ...extraProfile, ...zustandProfile, questionnaire };
      // 获取当前模型的上下文窗口大小
      const activeModelConfig = useModelStore.getState().models.find(m => m.id === provider);
      const contextWindow = activeModelConfig?.contextWindow || 128000;
      // 传递模型配置给 gateway (所有模型都传, 包括内置模型)
      const modelConfig = activeModelConfig ? {
        baseURL: activeModelConfig.baseURL,
        modelName: activeModelConfig.models?.[0] || activeModelConfig.label,
        provider: activeModelConfig.provider,
      } : undefined;
      // 长任务快照: 若用户在任务中心激活了 taskId, 把 taskId 透传给后端以恢复上下文
      const activeTaskId = useTaskResumeStore.getState().activeTaskId || undefined;

      if (mode === 'readonly') {
        // 非流式 JSON
        const resp = await fetch(base + '/v1/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: messageText, stream: false, model: provider, mode,
            userId: 'user', workspace: ws, projectDir: ws, profile, contextWindow,
            emotion: quickEmotion,
            attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
            thinking, modelConfig,
            taskId: activeTaskId,  // 长任务快照 ID (跨会话恢复)
          }),
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        updateMessage(botId, (m: any) => ({
          ...m,
          segments: json.content ? [{ kind: 'text', text: json.content }] : m.segments,
          streaming: false, provider: json.provider || provider,
          usage: json.usage || null,
          status: 'done' as const,
        }));
        updateMessage(userMsgId, (m: any) => ({ ...m, status: 'done' as const }));
      } else {
// 流式 SSE
// P0 修复: 只有在编辑器页面才附带当前打开的文件 — 之前无条件读 localStorage
// 用户关闭编辑器/切到对话页后, localStorage 中的 activeFile 残留 → AI 串味
const currentPage = localStorage.getItem('agentai.lastPage') || 'chat';
const activeEditorFile = currentPage === 'editor' ? (localStorage.getItem('agentai.editor.activeFile') || '') : '';
await apiStream(base + '/v1/chat', {
          message: messageText, stream: true, model: provider, mode,
          userId: 'user', workspace: ws, projectDir: ws, profile, contextWindow,
          emotion: quickEmotion,
          activeFile: activeEditorFile || undefined,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          thinking, modelConfig,
          systemRules: buildTimelinePrompt(),
          taskId: activeTaskId,  // 长任务快照 ID (跨会话恢复)
          contextInject: useModelStore.getState().contextInject,
          webSearch: opts?.webSearch || undefined, // P1 修复: webSearch 按钮终于生效
          isAnswer: opts?.isAnswer || undefined, // P0 修复: ask_user 答案不压制旧 loop
        }, handlers, controller.signal);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        updateMessage(botId, (m: any) => ({
          ...m, streaming: false, status: 'error',
          segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${e.message}` }],
        }));
        updateMessage(userMsgId, (m: any) => ({ ...m, status: 'error' }));
      }
    } finally {
      clearInterval(timeoutChecker);
      setLoading(false);
      abortRef.current = null;
      // 消息发送完毕后自动清除 activeTaskId (无论成功失败, 不再显示恢复提示条)
      if (activeTaskId) {
        setActiveTaskId(null);
      }
    }
  }, [loading, activeModelId, mode, appendMessage, updateMessage, activeId, createSession, addMessage, attachments, setAttachments]);
  // 2026-09-05: 保持 handleSendRef 指向最新 handleSend (消息行缓存闭包读取)
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  /** 用户手动中止当前任务 */
  /** 中止后要自动发送的排队消息 (避免 setQueuedSends 内递归调 handleSend) */
  const pendingAbortSendRef = useRef<string | null>(null);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // 记录中止时排队的首条消息 (用户排队就是想替代当前任务)
    // 由 useEffect([loading]) 在 loading=false 后自动发送, 消除两队竞争
    setQueuedSends(prev => {
      if (prev.length > 0) {
        pendingAbortSendRef.current = prev[0];
        return prev.slice(1);
      }
      return prev;
    });
    setLoading(false);
    const lastBot = messages.filter(m => m.role === 'assistant').pop();
    if (lastBot) {
      updateMessage(lastBot.id, (m: any) => ({
        ...m, streaming: false, status: 'done',
        segments: [...m.segments, { kind: 'text', text: '\n\n⏹ 已中止' }],
      }));
    }
  }, [messages, updateMessage, handleSend]);

  /**
   * 重新生成 AI 回复: 删除该 AI 消息及其后所有消息, 重发上一条用户消息
   * 同时恢复图片附件 (base64 数据存储在消息 segments 中)
   */
  const regenerateAssistant = useCallback((messageId: string) => {
    // 2026-09-05: 实时读 store (原闭包依赖 messages → 每帧重建 handler, 破坏消息行 memo)
    const messages = useChatStore.getState().messages;
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx < 0) return;
    // 找上一条用户消息
    let userMsgIdx = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userMsgIdx = i; break; }
    }
    if (userMsgIdx < 0) return;
    const userMsg = messages[userMsgIdx];
    const userText = userMsg.segments
      .filter(s => s.kind === 'text').map(s => (s as any).text).join('');
    // 从消息 segments 中恢复图片附件 (base64 数据持久化在 chatStore 中)
    const restoredAttachments: ParsedAttachment[] = userMsg.segments
      .filter((s): s is { kind: 'image'; base64?: string; alt?: string } => s.kind === 'image')
      .filter(s => s.base64) // 只恢复有 base64 数据的图片
      .map(s => {
        const imgName = s.alt || 'image.png';
        const mime = guessImgMimetype(imgName);
        return {
          name: imgName,
          mimetype: mime,
          size: 0,
          content: `[图片: ${imgName}]`,
          dataUrl: `data:${mime};base64,${s.base64}`,
          kind: 'image' as const,
        };
      });
    // 删除该 AI 消息及之后所有消息
    const idsToRemove = messages.slice(idx).map(m => m.id);
    removeMessages?.(idsToRemove);
    // 重新发送 (携带恢复的附件) — 走 handleSendRef 取最新实现
    handleSendRef.current(userText, restoredAttachments.length > 0 ? restoredAttachments : undefined);
  }, [removeMessages]);

  /**
   * 删除用户消息及其后续 AI 回复
   */
  const deleteMessageAndResponse = useCallback((messageId: string) => {
    // 2026-09-05: 实时读 store (原闭包依赖 messages → 每帧重建 handler, 破坏消息行 memo)
    const messages = useChatStore.getState().messages;
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx < 0) return;
    // 删除该用户消息及之后所有消息（包括 AI 回复）
    const idsToRemove = messages.slice(idx).map(m => m.id);
    removeMessages?.(idsToRemove);
  }, [removeMessages]);

  /**
   * 反馈 (点赞/点踩): 写入 localStorage + 提交后端
   */
  const feedbackMessage = useCallback((messageId: string, kind: 'up' | 'down') => {
    try {
      const key = 'agentai.msg_feedback';
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      const isRevoking = all[messageId] === kind; // 再点同一个 = 撤销
      if (isRevoking) {
        delete all[messageId];
      } else {
        all[messageId] = kind;
      }
      localStorage.setItem(key, JSON.stringify(all));
      // P0 修复: 撤销时不提交后端, 避免撤销被记成点赞
      if (isRevoking) return;
    } catch { /* ignore */ }
    // 提交到后端 (fire-and-forget)
    const sid = activeId;
    if (sid && messageId) {
      // 2026-09-05: 实时读 store (原闭包依赖 messages → 每帧重建 handler, 破坏消息行 memo)
      const msg = useChatStore.getState().messages.find(m => m.id === messageId);
      const text = msg?.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('\n') || '';
      submitFeedback({
        sessionId: sid,
        messageId,
        type: kind === 'up' ? 'thumbs_up' : 'thumbs_down',
        originalOutput: { content: text.slice(0, 500) },
      }).catch(() => { /* 静默失败 */ });
    }
  }, [activeId]);

  /**
   * 收藏: 写入 localStorage, 供笔记面板后续消费
   */
  const bookmarkMessage = useCallback((messageId: string, text: string) => {
    try {
      const key = 'agentai.bookmarks';
      const list: Array<{ id: string; text: string; ts: number }> = JSON.parse(localStorage.getItem(key) || '[]');
      const existing = list.find(b => b.id === messageId);
      if (existing) {
        // 已收藏 → 取消收藏
        const next = list.filter(b => b.id !== messageId);
        localStorage.setItem(key, JSON.stringify(next));
        // P0 修复: 提示与实际操作一致
        messageApi.success('已取消收藏');
      } else {
        list.push({ id: messageId, text: String(text || '').slice(0, 1000), ts: Date.now() });
        localStorage.setItem(key, JSON.stringify(list));
        messageApi.success('⭐ 已收藏');
      }
    } catch { /* ignore */ }
  }, []);

  /**
   * 在编辑器中打开文件: 切换视图到 editor 并触发文件打开事件
   */
  const openFileInEditor = useCallback((path: string) => {
    try {
      // P0: 走 pending 机制, 避免 Editor 未挂载时事件丢失
      window.dispatchEvent(new CustomEvent('agentai:navigate', { detail: { page: 'editor' } }));
      window.dispatchEvent(new CustomEvent('agentai:open-file-pending', { detail: { path } }));
    } catch { /* ignore */ }
  }, []);

  /* ---- Slash commands ---- */
  const slashCommands: SlashCmd[] = [
    { cmd: '/clear', desc: '清空当前对话', run: () => { smartClear(); } },
    { cmd: '/new', desc: '新建对话', run: () => {
      const id = createSession('新对话');
      smartClear();
    }},
    { cmd: '/abort', desc: '中断当前回复', run: () => handleStop() },
    { cmd: '/help', desc: '查看帮助', run: () => {
      appendMessage({ id: 'help', role: 'system', segments: [{ kind: 'text', text: `
**岐枢命令指南**

- \`/clear\` — 清空当前对话
- \`/new\` — 新建对话
- \`/abort\` — 中断当前回复
- \`/help\` — 查看帮助

**模式说明**
- 🔮 **自动模式**: 智能推理 + 自动工具调用
- 📋 **规划模式**: 先制定计划，确认后逐步执行
- 🔍 **审查模式**: 只读分析代码，生成结构化审查报告
- 📖 **只读模式**: 纯对话，不调用工具

**快捷键**
- \`Enter\` 发送 · \`Shift+Enter\` 换行
- \`/\` 打开命令菜单 · \`@\` 提及文件
      `}], ts: Date.now() });
    }},
  ];

  /* ---- Queue management (while busy) ---- */
  const handleQueueWhileBusy = useCallback((text: string) => {
    setQueuedSends(q => [...q, text]);
  }, []);

  const handleDequeue = useCallback((index: number) => {
    setQueuedSends(q => q.filter((_, i) => i !== index));
  }, []);

  /* ---- Message navigation ---- */
  const handleNavigateToMsg = useCallback((messageId: string) => {
    const el = msgRefs.current[messageId];
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // 监听时间线跳转事件 (必须在 handleNavigateToMsg 定义之后)
  useEffect(() => {
    const handler = (e: Event) => {
      const { messageId } = (e as CustomEvent).detail;
      if (messageId) handleNavigateToMsg(messageId);
    };
    window.addEventListener('agentai:navigate-msg', handler);
    return () => window.removeEventListener('agentai:navigate-msg', handler);
  }, [handleNavigateToMsg]);

  /* ═══ 消息行绑定回调缓存 (2026-09-05) ═══
   * 按 msg 对象引用缓存每行的派生 props/闭包; msg 未变 → 返回同一实例,
   * 使 React.memo(UserMsgRow/AssistantMsgRow) 对未变化消息直接跳过重渲染。
   */
  const getRowBinds = useCallback((msg: ChatMessage): RowBinds => {
    const cache = rowBindCache.current;
    const hit = cache.get(msg.id);
    if (hit && hit.key === msg) return hit.b;
    const textSegs = msg.segments.filter(s => s.kind === 'text');
    const text = textSegs[0]?.text || '';
    const fullText = textSegs.map((s: any) => s.text).join('\n');
    const restoredAttachments: ParsedAttachment[] = msg.segments
      .filter((s): s is { kind: 'image'; base64?: string; alt?: string } => s.kind === 'image')
      .filter(s => s.base64)
      .map(s => {
        const imgName = s.alt || 'image.png';
        const mime = guessImgMimetype(imgName);
        return {
          name: imgName,
          mimetype: mime,
          size: 0,
          content: `[图片: ${imgName}]`,
          dataUrl: `data:${mime};base64,${s.base64}`,
          kind: 'image' as const,
        };
      });
    const usage = msg.usage ? { ...msg.usage, durationMs: (msg as any).durationMs || (msg.usage as any).durationMs } : undefined;
    const b: RowBinds = msg.role === 'user' ? {
      onResend: () => handleSendRef.current(text, restoredAttachments.length > 0 ? restoredAttachments : undefined),
      onEdit: () => composerRef.current?.setDraft(text),
      onDelete: () => deleteMessageAndResponse(msg.id),
      onBookmark: () => bookmarkMessage(msg.id, text),
    } : {
      onRegenerate: () => regenerateAssistant(msg.id),
      onFeedback: (kind) => feedbackMessage(msg.id, kind),
      onBookmark: () => bookmarkMessage(msg.id, fullText),
      onEdit: () => composerRef.current?.setDraft(fullText),
      usage,
    };
    cache.set(msg.id, { key: msg, b });
    return b;
  }, [deleteMessageAndResponse, bookmarkMessage, regenerateAssistant, feedbackMessage]);

  // 监听文件树 "添加到上下文" 事件
  useEffect(() => {
    const handler = async (e: Event) => {
      const { filePath, fileName } = (e as CustomEvent).detail;
      if (!filePath) return;
      try {
        // 从后端读取文件内容
        const res = await fetch(`/api/files/download?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) return;
        const blob = await res.blob();
        const text = await blob.text();
        const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext || '');
        const attachment: ParsedAttachment = isImage
          ? { name: fileName, mimetype: `image/${ext}`, size: blob.size, content: `[图片: ${fileName}]`, dataUrl: `data:image/${ext};base64,${btoa(text)}`, kind: 'image' }
          : { name: fileName, mimetype: 'text/plain', size: blob.size, content: text, kind: 'text' };
        setAttachments(prev => [...prev, attachment]);
      } catch {
        // 静默失败
      }
    };
    window.addEventListener('agentai:add-file-context', handler);
    return () => window.removeEventListener('agentai:add-file-context', handler);
  }, []);

  // ── 对话改图模式切换时自动填充最近生成的图片 ──
  useEffect(() => {
    if (chatMode === 'image_edit' && lastGeneratedImage && attachments.length === 0) {
      setAttachments([lastGeneratedImage]);
    }
  }, [chatMode, lastGeneratedImage, attachments.length]);

  /* ✨ 监听建议采纳事件 — 自动将建议 action 发送到对话 */
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ action: string }>;
      const action = ce.detail?.action;
      if (action && typeof action === 'string' && action.trim()) {
        // 自动发送建议的 action 到对话
        handleSend(action.trim());
      }
    };
    window.addEventListener('agentai:suggestion-accept', handler);
    return () => window.removeEventListener('agentai:suggestion-accept', handler);
  }, [handleSend]);

  /* ✨ 监听预置工作流触发事件 — 仅填充输入框, 不自动发送, 用户确认后再发送 */
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ workflow: string; message: string }>;
      const { workflow, message } = ce.detail || {};
      if (workflow && message) {
        composerRef.current?.setDraft(message);
        composerRef.current?.focus();
      }
    };
    window.addEventListener('agentai:trigger-workflow', handler);
    return () => window.removeEventListener('agentai:trigger-workflow', handler);
  }, []);

  /* ---- Drag-drop handler ---- */
  const [dragOver, setDragOver] = useState(false);
  // 任务链状态 (SSE plan events 驱动)
  const [chainGoal, setChainGoal] = useState<string>('');
  const [chainId, setChainId] = useState<string>('');
  const [chainStages, setChainStages] = useState<Array<{ key: ChainStage; status: StageStatus }>>([
    { key: 'plan', status: 'pending' },
    { key: 'solve', status: 'pending' },
    { key: 'verify', status: 'pending' },
    { key: 'fix', status: 'pending' },
    { key: 'report', status: 'pending' },
  ]);
  const [chainCurrent, setChainCurrent] = useState<ChainStage>('plan');
  // 审批提案
  const [approvalProposal, setApprovalProposal] = useState<any>(null);
  // 追问卡片状态 ref (避免 handleSend 闭包陷阱)
  const [askUserCard, setAskUserCard] = useState<{ question: string; options: Array<{ id: string; title: string }> } | null>(null);
  const askUserCardRef = useRef(askUserCard);
  askUserCardRef.current = askUserCard;
  // 追问答案待发送 (避免 React 闭包陷阱)
  const [pendingAnswer, setPendingAnswer] = useState<string | null>(null);
  // Diff 预览
  const { diffFile, diffText, clearDiff } = useDiffEvents();
  // 规划模式审批状态
  const [planNeedsApproval, setPlanNeedsApproval] = useState(false);
  const [planSessionId, setPlanSessionId] = useState<string>('');
// 意图澄清请求 (AI 检测到歧义时弹出卡片)
const [clarificationReq, setClarificationReq] = useState<ClarificationRequest | null>(null);

  /* ---- 追问答案: loading=false 后自动发送 ---- */
  // P0 修复: 追问答案需要传 isAnswer=true 让后端不压制旧 loop
  useEffect(() => {
    if (pendingAnswer && !loading) {
      const answer = pendingAnswer;
      setPendingAnswer(null);
      // 直接用 handleSend 发送, 但在 apiStream 调用中传 isAnswer=true
      // handleSend 中 askUserCardRef.current 已被清空, 不会 abort
      handleSend(answer, undefined, { isAnswer: true } as any);
    }
  }, [pendingAnswer, loading, handleSend]);

  /* ---- 队列消息: loading=false 后自动发送第一条 (含中止触发) ---- */
  useEffect(() => {
    if (loading) return;
    // 优先发送中止时暂存的消息
    const abortMsg = pendingAbortSendRef.current;
    if (abortMsg) {
      pendingAbortSendRef.current = null;
      handleSend(abortMsg);
      return;
    }
    // 再检查普通队列
    if (queuedSends.length > 0) {
      const next = queuedSends[0];
      setQueuedSends(q => q.slice(1));
      handleSend(next);
    }
  }, [loading, queuedSends, handleSend]);

  /* ==================== Render ==================== */
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', height: '100%',
        position: 'relative', background: 'var(--bg)',
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); }}
    >
      {/* ===== 长任务快照: 顶部恢复提示条 (8秒自动隐藏) ===== */}
      {(activeTaskId || resumableTasks.length > 0) && (
        <AutoHideTaskBar 
          visible={true}
          delay={8000}
          onHidden={() => { /* 用户未操作则自动隐藏 */ }}
        >
        <div style={{ padding: '8px 16px 0' }}>
          {activeTaskId && (
            <Alert
              type="info"
              showIcon
              icon={<SyncOutlined spin />}
              message={
                <Space>
                  <span>正在恢复长任务</span>
                  <code style={{ fontSize: 11 }}>{activeTaskId.slice(0, 40)}...</code>
                </Space>
              }
              description="发送消息时, AI 将自动加载此任务之前的进度、已完成步骤、待办和关键决策"
              action={
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={() => setActiveTaskId(null)}
                >
                  取消激活
                </Button>
              }
              style={{ marginBottom: 8 }}
            />
          )}
          {!activeTaskId && resumableTasks.length > 0 && (
            <Alert
              type="warning"
              showIcon
              closable
              onClose={() => setActiveTaskId(null)}
              message={
                <Space>
                  <span>发现 {resumableTasks.length} 个可恢复的长任务</span>
                  <Tag color="orange">跨会话继续</Tag>
                  <span style={{ fontSize: 'var(--tool-font-size)', color: 'var(--text-secondary)', marginLeft: 8 }}>
                    (8秒后自动收起)
                  </span>
                </Space>
              }
              description={
                <Space wrap>
                  {resumableTasks.slice(0, 3).map((t) => (
                    <Button
                      key={t.taskId}
                      size="small"
                      type="primary"
                      icon={resumingId === t.taskId ? <Spin size="small" /> : <SyncOutlined />}
                      disabled={resumingId !== null}
                      onClick={async () => {
                        setResumingId(t.taskId);
                        try {
                          const result = await prepareResume(t.taskId);
                          if (result) {
                            appendMessage({
                              id: `resume-ready-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                              role: 'assistant',
                              segments: [{ kind: 'text', text: `📋 已加载任务「${t.goal || t.taskId.slice(0, 20)}」的进度，输入消息即可继续。` }],
                              ts: Date.now(),
                              status: 'done',
                              provider: 'system',
                            } as any);
                            setActiveTaskId(null); // 选择后立即隐藏
                          } else {
                            appendMessage({
                              id: `resume-fail-${Date.now()}`,
                              role: 'assistant',
                              segments: [{ kind: 'text', text: `⚠️ 无法恢复任务「${t.goal || t.taskId.slice(0, 20)}」，任务数据可能已损坏或丢失。` }],
                              ts: Date.now(),
                              status: 'done',
                              provider: 'system',
                            } as any);
                          }
                        } catch (e: any) {
                          appendMessage({
                            id: `resume-err-${Date.now()}`,
                            role: 'assistant',
                            segments: [{ kind: 'text', text: `❌ 恢复任务失败: ${e.message}` }],
                            ts: Date.now(),
                            status: 'done',
                            provider: 'system',
                          } as any);
                        } finally {
                          setResumingId(null);
                        }
                      }}
                    >
                      {t.goal?.slice(0, 30) || t.taskId.slice(0, 20)}
                    </Button>
                  ))}
                  {resumableTasks.length > 3 && (
                    <span style={{ fontSize: 'var(--ui-font-size)', color: 'var(--text-secondary)' }}>
                      等 {resumableTasks.length - 3} 个...
                    </span>
                  )}
                </Space>
              }
              style={{ marginBottom: 8 }}
            />
          )}
        </div>
        </AutoHideTaskBar>
      )}

      {/* ===== Workspace + 摘要 (可折叠) ===== */}
      <WorkspaceSummaryBar
        messageCount={messages.length}
        tokenInfo={tokenInfo}
        sessionCreatedAt={(() => {
          const s = sessions.find(x => x.id === activeId);
          return s?.createdAt;
        })()}
        onClear={smartClear}
        sessionId={activeId}
        sessionTitle={sessions.find(x => x.id === activeId)?.title}
        onIndustryChange={(industryId, industryLabel) => {
          // 行业切换后自动发送消息让 AI 感知变化
          const label = industryId === 'general' ? '通用模式' : industryLabel;
          const msg = `[系统] 用户行业身份已切换为「${label}」，请立即更新你的专业上下文和记忆，适应当前行业。`;
          if (loading) {
            // AI 正忙时排队等待
            handleQueueWhileBusy(msg);
          } else {
            handleSend(msg);
          }
        }}
      />

      {/* ✨ AI 主动建议 — 已由全局 FloatingSuggestionToast + SSE 接管 */}

      {/* Messages area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: 'auto',
          padding: `var(--chat-scroll-padding-y) 0`,
          position: 'relative',
          maxWidth: '100%',
        }}
      >
        {/* 空状态 (欢迎页): 上轮摘要固定高度, 欢迎区自动占满剩余空间并居中 */}
        {messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            <div style={{ flexShrink: 0 }}>
              <LastSessionHint workspace={useProfileStore.getState()?.profile?.workspace || localStorage.getItem('agentai.workspace') || ''} />
            </div>
            <WelcomePanel handleSend={handleSend} />
          </div>
        )}

        {/* Message list */}
        {/* 对话摘要栏: 超过 8 条消息时显示, 帮助用户导航长对话 */}
        {messages.length > 8 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 12px', margin: '4px 0',
            background: 'var(--panel)', borderRadius: 6,
            border: '1px solid var(--border)',
            fontSize: 10, color: 'var(--muted-2)',
            overflowX: 'auto', whiteSpace: 'nowrap',
          }}>
            <span style={{ flexShrink: 0, fontWeight: 600, color: 'var(--muted)' }}>📑 对话摘要</span>
            {messages.filter(m => m.role === 'user').slice(-5).map((m, idx) => {
              const text = m.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('') || '';
              const short = text.slice(0, 30) + (text.length > 30 ? '...' : '');
              return (
                <span key={idx} style={{
                  flexShrink: 0, padding: '1px 6px',
                  background: 'var(--bg-2)', borderRadius: 3,
                  cursor: 'pointer',
                }} onClick={() => {
                  const el = msgRefs.current[m.id];
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}>
                  {short}
                </span>
              );
            })}
            <span style={{ flexShrink: 0, opacity: 0.5 }}>{messages.length} 条消息</span>
          </div>
        )}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            const textSegs = msg.segments.filter(s => s.kind === 'text');
            const text = textSegs[0]?.text || '';
            const emotion = emotionMap[msg.id];
            const profile = useProfileStore.getState()?.profile;
            // 2026-09-05: 绑定回调走缓存 + React.memo 行 — msg 未变 → 直接跳过重渲染
            const binds = getRowBinds(msg);
            return (
              <div key={msg.id} ref={el => { msgRefs.current[msg.id] = el; }}>
                <UserMsgRow
                  text={text}
                  segments={msg.segments}
                  status={msg.status}
                  messageId={msg.id}
                  onNavigate={handleNavigateToMsg}
                  userName={profile?.name || '你'}
                  userAvatar={undefined}
                  onResend={binds.onResend}
                  onEdit={binds.onEdit}
                  onDelete={binds.onDelete}
                  onBookmark={binds.onBookmark}
                />
                {emotion && (
                  <div style={{ padding: '0 16px 4px', display: 'flex', justifyContent: 'flex-end' }}>
                    <EmotionIndicator {...emotion} compact />
                  </div>
                )}
              </div>
            );
          }
          if (msg.role === 'assistant') {
            const binds = getRowBinds(msg);
            return (
              <div key={msg.id} ref={el => { msgRefs.current[msg.id] = el; }}>
                <AssistantMsgRow
                  segments={msg.segments}
                  pending={!!msg.streaming}
                  model={msg.provider}
                  usage={binds.usage}
                  status={msg.status}
                  messageId={msg.id}
                  onNavigate={handleNavigateToMsg}
                  onRegenerate={binds.onRegenerate}
                  onFeedback={binds.onFeedback}
                  onBookmark={binds.onBookmark}
                  onOpenFile={openFileInEditor}
                  onEdit={binds.onEdit}
                  onDone={scrollToTopOnDone}
                  progress={msg.streaming ? progress : null}
                />
              </div>
            );
          }
          if (msg.role === 'system') {
            // 系统内部指令 ([SYSTEM]/[工具故障报告]等) 不作为独立气泡显示
            // 这些是给 AI 的内部指令, 显示给用户只会造成干扰
            const sysText = msg.segments?.filter(s => s.kind === 'text').map(s => (s as any).text || '').join('') || '';
            const isInternalDirective = sysText.startsWith('[SYSTEM]')
              || sysText.startsWith('[工具故障报告]')
              || sysText.startsWith('[上下文折叠摘要')
              || sysText.startsWith('# 对话历史摘要')
              || sysText.startsWith('[历史摘要');
            if (isInternalDirective) return null; // 静默跳过, 不渲染
            // 用户可见的 system 消息 (如欢迎信息) 正常显示
            return (
              <div key={msg.id} style={{ padding: '8px 16px' }}>
                <AssistantMsg segments={msg.segments} pending={false} />
              </div>
            );
          }
          return null;
        })}

        {/* 3D 可交互场景 (AI 调用 generate_3d_scene 生成) */}
        {scene3D && <Scene3DViewer scene={scene3D} />}

        {/* 子智能体状态实时显示 (P2-9) */}
        {subagents.length > 0 && <SubagentStatus agents={subagents} pending={subagents.some(a => a.status === 'running')} />}

        {/* Bottom padding */}
        <div style={{ height: 8 }} />
      </div>

      {/* P1-6: 浮动「新回复」按钮 — 用户上滑后显示 */}
      {isScrolledUp && messages.length > 0 && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute', bottom: 120, right: 24,
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '6px 14px', borderRadius: 20,
            background: 'var(--accent)', color: '#fff',
            border: 'none', cursor: 'pointer', fontSize: 'var(--ui-font-size)', fontWeight: 600,
            boxShadow: 'var(--shadow-md)', zIndex: 'var(--z-sticky)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>
          新回复
        </button>
      )}

      {/* Empty state margin adjustment */}
      {messages.length === 0 && <div style={{ flex: 1 }} />}


      {/* Queue sends */}
      {queuedSends.length > 0 && (
        <div style={{ padding: '4px 16px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {queuedSends.map((t, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', borderRadius: 4, fontSize: 'var(--tool-font-size)',
              background: 'var(--accent-soft)', border: '1px solid var(--accent)',
              color: 'var(--fg)',
            }}>
              <span style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t}
              </span>
              <span onClick={() => handleDequeue(i)} style={{ cursor: 'pointer', color: 'var(--muted-2)' }}>×</span>
            </span>
          ))}
        </div>
      )}

      {/* Task Chain Card — AI 自动任务编排 (规划模式可审批) */}
      {chainId && (
        <TaskChainCard
          chainId={chainId}
          goal={chainGoal}
          currentStage={chainCurrent}
          stages={chainStages}
          completed={chainStages.filter(s => s.status === 'success').length}
          total={chainStages.length}
          needsApproval={planNeedsApproval}
          onApprove={async () => {
            try {
              await apiApprovePlan(planSessionId, 'approve');
              setPlanNeedsApproval(false);
            } catch (e) {
              console.error('[plan-approval] 确认执行失败:', e);
            }
          }}
          onReject={async () => {
            try {
              await apiApprovePlan(planSessionId, 'reject');
              setPlanNeedsApproval(false);
              // 清理任务链卡片
              setTimeout(() => { setChainId(''); setChainGoal(''); setChainStages([]); }, 1000);
            } catch (e) {
              console.error('[plan-approval] 取消失败:', e);
            }
          }}
        />
      )}

      {/* Sandbox Status Panel — 沙箱状态展示 */}
      {/* Sandbox Result Panel — 沙箱执行结果展示 */}
<SandboxResultPanel />

      {/* Approval Card — AI 修改审批 (真正接入后端) */}
      {approvalProposal && (
        <ApprovalCard
          proposal={approvalProposal}
          onApprove={async (id) => {
            try {
              await apiApproveFileChange(planSessionId, id, 'approve');
              setApprovalProposal(null);
            } catch (e) {
              console.error('[approval] 批准失败:', e);
            }
          }}
          onReject={async (id) => {
            try {
              await apiApproveFileChange(planSessionId, id, 'reject');
              setApprovalProposal(null);
            } catch (e) {
              console.error('[approval] 拒绝失败:', e);
            }
          }}
        />
      )}

      {/* Clarification Card — 意图澄清 (AI 检测到歧义) */}
      {clarificationReq && (
        <ClarificationCard
          request={clarificationReq}
          onResolved={(id) => {
            setClarificationReq(null);
          }}
        />
      )}

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
            const answerText = Array.isArray(answer)
              ? answer.join(', ')
              : answer;
            // 不 abort 当前 SSE — 让后端保留 loop 上下文
            // 只关闭卡片 UI
            setAskUserCard(null);
            // 标记为追问答案, 后端不走压制模式
            setPendingAnswer(answerText);
            // 不设 loading=false — 让 useEffect 知道这是追问答案
          }}
        />
      )}

      {/* Diff 预览 — AI 修改文件后的对比 */}
      {diffFile && <DiffViewer diffText={diffText} filePath={diffFile} onClose={clearDiff} />}

      {/* Context Monitor — 上下文长度提醒 (单行紧凑版) */}
      {messages.length > 3 && tokenInfo.nearing && (
        <div style={{
          margin: '4px 16px 0', padding: '4px 10px', borderRadius: 6,
          background: tokenInfo.critical ? 'rgba(239,68,68,0.1)' : 'rgba(250,204,21,0.08)',
          border: `1px solid ${tokenInfo.critical ? 'rgba(239,68,68,0.25)' : 'rgba(250,204,21,0.2)'}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {/* Progress bar */}
          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', minWidth: 40 }}>
            <div style={{
              width: `${tokenInfo.pct}%`, height: '100%', borderRadius: 2,
              background: tokenInfo.critical ? 'var(--danger)' : 'var(--warning)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap', color: tokenInfo.critical ? 'var(--danger)' : 'var(--warning)' }}>
            {tokenInfo.pct}%
          </span>
          <span style={{ fontSize: 9, color: tokenInfo.critical ? 'var(--danger)' : 'var(--warning)', opacity: 0.8, whiteSpace: 'nowrap' }}>
            {formatTokens(tokenInfo.tokens)} tokens
          </span>
          {tokenInfo.critical && (
            <button
              onClick={() => {
                const summary = generateConversationSummary(messages);
                smartClear();
                const id = createSession('新对话 (续)');
                setTimeout(() => {
                  appendMessage({
                    id: `summary-${Date.now()}`,
                    role: 'system',
                    segments: [{ kind: 'text', text: summary }],
                    ts: Date.now(),
                    status: 'done',
                  });
                }, 300);
              }}
              style={{
                fontSize: 'var(--tool-font-size)', padding: '2px 8px', borderRadius: 4,
                background: 'var(--accent)', color: '#fff', border: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600,
              }}
            >
              + 新对话
            </button>
          )}
        </div>
      )}

      {/* 工作目录选择 */}
      <WorkspaceSelector />

      {/* 透明进度显示 — 仅在没有流式消息时显示 (流式时进度已内联到 ActivityTimeline) */}
      {progress && !messages.some(m => m.streaming) && (
        <div style={{
          margin: '0 12px 6px', padding: '6px 12px',
          borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--ui-font-size)', color: 'var(--fg)',
        }}>
          {/* 进度条 */}
          <div style={{
            flex: 1, height: 6, borderRadius: 3,
            background: 'rgba(255,255,255,0.06)',
            overflow: 'hidden'
          }}>
            <div style={{
              height: '100%',
              width: `${progress.percent}%`,
              background: progress.percent >= 100 ? 'var(--success)' : 'var(--accent)',
              borderRadius: 3,
              transition: 'width 0.3s ease'
            }} />
          </div>
          {/* 进度信息 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 200 }}>
            <span style={{ fontWeight: 600 }}>{progress.percent}%</span>
            <span style={{ color: 'var(--muted)', fontSize: 'var(--tool-font-size)' }}>{progress.description}</span>
          </div>
          {/* 工具调用统计 */}
          {progress.toolCount && (
            <div style={{ fontSize: 'var(--tool-font-size)', color: 'var(--muted)' }}>
              {progress.successCount || 0}✓ · {progress.failCount || 0}✗
            </div>
          )}
        </div>
      )}

      {/* 轻量级 loading 指示器 (详细进度由 TaskChainCard 展示) */}
      {loading && !chainId && !progress && (
        <div style={{
          margin: '0 12px 6px', padding: '4px 10px',
          borderRadius: 6, background: 'var(--panel)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--muted)',
        }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
          <span>AI 思考中...</span>
        </div>
      )}

      {/* Composer */}
      <div style={{ position: 'relative' }}>
        <Composer
          ref={composerRef}
          onSend={(text, opts) => handleSend(text, undefined, opts)}
          onAbort={handleStop}
          busy={loading}
          slashCommands={slashCommands}
          textareaRef={textareaRef}
          queuedSends={queuedSends}
          onQueueWhileBusy={handleQueueWhileBusy}
          onDequeueSend={handleDequeue}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          thinking={thinking}
          onThinkingChange={setThinking}
          optimizeDisabled={loading}
        />
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 'var(--z-dropdown)',
          background: 'oklch(20% 0.006 255 / 0.6)',
          border: '2px dashed var(--accent)',
          display: 'grid', placeItems: 'center',
          color: 'var(--fg)', fontSize: 14, fontWeight: 500,
          pointerEvents: 'none',
        }}>
          Drop to attach as @-mention
        </div>
      )}
    </div>
  );
};
