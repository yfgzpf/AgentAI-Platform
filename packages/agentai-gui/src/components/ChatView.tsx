/**
 * ChatView — 主对话视图 (重构版)
 *   - 集成 Thread 卡片式消息渲染
 *   - 集成 Composer 智能输入区
 *   - 流式 SSE 通信
 *   - 上下文压缩: 达到阈值自动摘要+开新对话
 */

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
    `**用户需求**: ${userNeeds.slice(-3).join(' → ')}`,
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
) {
  if (!result) return;
  try {
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;

    // 1. 桌面截图: desktop_automate screenshot 返回 screenshot_data
    if (toolName === 'desktop_automate' && parsed.screenshot_data?.base64) {
      const base64 = parsed.screenshot_data.base64;
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          base64,
          alt: parsed.screenshot_data.alt || '桌面截图',
          filePath: parsed.screenshot_data.path,
        }],
      }));
      return;
    }

    // 2. 浏览器截图: browser_screenshot 返回 imageBase64
    if ((toolName === 'browser_screenshot' || toolName === 'browser_screenshot_full') && parsed.imageBase64) {
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          base64: parsed.imageBase64,
          alt: '浏览器截图',
        }],
      }));
      return;
    }

    // 3. 图片生成: generate_image 返回 imageUrl
    if (toolName === 'generate_image' && (parsed.imageUrl || parsed.url)) {
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: parsed.imageUrl || parsed.url,
          alt: parsed.prompt || 'AI图片',
        }],
      }));
      return;
    }

    // 4. 通用检测: 只要有 imageUrl/imageBase64 字段
    if (parsed.imageUrl || parsed.imageBase64) {
      updateMessage(botId, (m: any) => ({
        ...m,
        segments: [...m.segments, {
          kind: 'image',
          url: parsed.imageUrl,
          base64: parsed.imageBase64,
          alt: parsed.alt || toolName,
        }],
      }));
      return;
    }
  } catch {
    // result 不是 JSON — 检查是否包含图片文件路径
    const text = String(result);
    const imgMatch = text.match(/([^\s`'"]+\.(png|jpg|jpeg|gif|webp|bmp|svg))/i);
    if (imgMatch) {
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
import { io, type Socket } from 'socket.io-client';
import { useChatStore } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import { useModeStore } from '../store/modeStore';
import { useProfileStore } from '../store';
import { useSessionStore } from '../store/sessionStore';
import type { AppMode } from '../store/modeStore';
import { Composer, type SlashCmd, type ComposerHandle } from './Composer';
import { UserMsg, AssistantMsg, TurnDivider } from './Thread';
import { WorkspaceSummaryBar } from './WorkspaceSummaryBar';
import { ProactiveSuggestionCard } from './ProactiveSuggestionCard';
import { WorkspaceSelector } from './WorkspaceSelector';
import { countTokens, formatTokens } from '../services/tokenCounter';
import { EmotionIndicator } from './EmotionIndicator';
import { analyzeEmotion, analyzeEmotionQuick, type EmotionResult } from '../services/emotion';
import { apiStream, makeChatHandlers, apiApproveFileChange, apiApprovePlan, suggestMode } from '../services/api';
import { MemoryEngine } from '../services/MemoryEngine';
import { TaskChainCard, type StageStatus } from './TaskChainCard';
import { SandboxStatusPanel } from './SandboxStatusPanel';
import { SandboxResultPanel } from './SandboxResultPanel';
import { buildTimelinePrompt } from '../services/AiRules';
import { analyzeComplexity, useAutoModelStore } from '../store/autoModelStore';
import { useTaskOrchestrator } from '../store/taskOrchestratorStore';

/** 任务链阶段标识 (与 SSE plan_stage 事件的 stage 字段对齐) */
type ChainStage = 'plan' | 'solve' | 'verify' | 'fix' | 'report';
import { ApprovalCard } from './ApprovalCard';
import { AskUserCard } from './AskUserCard';
import { DiffViewer, useDiffEvents } from './DiffViewer';
import { gatewayFallback } from '../services/GatewayFallback';
import { taskNotifier } from '../services/TaskNotifier';
import { speak, isTtsEnabled as checkTts } from '../services/VoiceService';
import type { ParsedAttachment } from '../services/file-parser';

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB

/** 根据文件名猜测图片 MIME 类型 */
function guessImgMimetype(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
  return map[ext] || 'image/png';
}

export const ChatView: React.FC = () => {
  const { messages, appendMessage, updateMessage, clearMessages, removeMessages } = useChatStore();
  const { activeModelId } = useModelStore();
  const { mode, setMode, setSuggestedMode, recommendEnabled } = useModeStore();
  const { sessions, activeId, createSession, addMessage, updateTitle } = useSessionStore();

  // 组件顶层: workspace 和 industry (供 ProactiveSuggestionCard 等使用)
  const profileWs = useProfileStore.getState()?.profile?.workspace;
  const currentWorkspace = profileWs || localStorage.getItem('agentai.workspace') || '';
  let zustandProfile: any = {};
  try { const raw = localStorage.getItem('agentai-user-profile'); if (raw) zustandProfile = JSON.parse(raw)?.state?.profile || {}; } catch { /* ignore */ }
  let extraProfile: any = {};
  try { const raw = localStorage.getItem('agentai.profile'); if (raw) extraProfile = JSON.parse(raw); } catch { /* ignore */ }
  const currentIndustry = extraProfile?.industry || zustandProfile?.industry || 'general';

  // 行业快捷指令: 根据用户选择的行业返回对应的快捷操作
  const getIndustryQuickActions = (industry: string) => {
    const INDUSTRY_ACTIONS: Record<string, Array<{ label: string; prompt: string }>> = {
      decoration: [
        { label: '📋 快速报价', prompt: '帮我做一份装修报价单，我告诉你户型和面积' },
        { label: '📐 材料算量', prompt: '帮我计算装修材料用量' },
        { label: '🎨 效果图参考', prompt: '帮我生成一张装修效果图' },
        { label: '📅 施工排期', prompt: '帮我制定一份施工进度计划表' },
        { label: '📄 方案书', prompt: '帮我生成一份客户装修方案书' },
        { label: '🏗️ 施工规范', prompt: '查询装修施工验收标准' },
      ],
      ecommerce: [
        { label: '📊 数据分析', prompt: '帮我分析店铺数据表现' },
        { label: '📝 商品文案', prompt: '帮我写一段商品详情文案' },
        { label: '🎯 营销方案', prompt: '帮我制定一个营销推广方案' },
        { label: '📦 库存管理', prompt: '帮我做一份库存盘点表' },
      ],
      education: [
        { label: '📚 教案生成', prompt: '帮我写一份教学教案' },
        { label: '📝 试卷出题', prompt: '帮我出一套考试试卷' },
        { label: '📊 成绩分析', prompt: '帮我分析学生成绩数据' },
        { label: '📋 课程大纲', prompt: '帮我制定一份课程大纲' },
      ],
      developer: [
        { label: '🔍 审查代码', prompt: '审查当前项目代码质量' },
        { label: '🏗️ 项目架构', prompt: '帮我分析这个项目的架构' },
        { label: '🐛 修复 Bug', prompt: '帮我排查和修复这个问题' },
        { label: '⚡ 性能优化', prompt: '帮我分析和优化性能瓶颈' },
      ],
      comic: [
        { label: '🎨 角色设计', prompt: '帮我设计一个漫画角色' },
        { label: '📖 分镜脚本', prompt: '帮我写一段漫画分镜脚本' },
        { label: '🖼️ 场景插画', prompt: '帮我生成一张场景插画' },
      ],
    };
    // 通用行业只显示基础操作
    return INDUSTRY_ACTIONS[industry] || [
      { label: '💬 开始对话', prompt: '你好，请介绍一下你能做什么' },
      { label: '📄 写文档', prompt: '帮我写一份文档' },
      { label: '🔍 搜索信息', prompt: '帮我搜索' },
    ];
  };

  const [loading, setLoading] = useState(false);
  const [queuedSends, setQueuedSends] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<ParsedAttachment[]>([]);
  const [emotionMap, setEmotionMap] = useState<Record<string, EmotionResult>>({});
  const [thinking, setThinking] = useState(true);
  const msgRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const abortRef = useRef<AbortController | null>(null);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 智能清空: 先保存记忆再清空
  const smartClear = useCallback(() => {
    try {
      const allText = messages.map(m => ({
        role: m.role,
        content: m.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || '',
      }));
      if (allText.length > 2) {
        MemoryEngine.autoSaveOnTaskComplete(allText, '', '对话清空前自动保存');
      }
    } catch { /* best-effort */ }
    clearMessages();
  }, [messages, clearMessages]);

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
        const label = process.env.AGENTAI_MODEL || 'Agnes AI Flash';
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
          MemoryEngine.autoSaveOnTaskComplete(allText, '', '页面关闭前自动保存');
        }
      } catch { /* best-effort */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [messages]);

  /* ---- QQ Bot socket.io 桥接: 实时接收 QQ 消息并显示在对话窗口 ---- */
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
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
      const label = data.source === 'qq-group' ? `QQ群` : 'QQ私聊';
      const userId = `qq-msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      appendMessage({
        id: userId,
        role: 'user',
        segments: [{ kind: 'text', text: `[${label}] ${data.content}` }],
        ts: Date.now(),
        status: 'sent',
      });
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
        segments: [{ kind: 'text', text: `[微信] ${data.content}` }],
        ts: Date.now(),
        status: 'sent',
      });
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

    return () => { sock.disconnect(); };
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

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, queuedSends]);

  /* ---- 文件大小格式化 ---- */
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
  }

  /* ---- Send handler ---- */
  const handleSend = useCallback(async (text: string, extraAttachments?: ParsedAttachment[]) => {
    // 追问卡片自动退让: 用户在对话框直接输入时关闭卡片（用 ref 避免闭包陷阱）
    if (askUserCardRef.current) {
      if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
      setLoading(false);
      setAskUserCard(null);
    }

    // 正在处理时排队，不中止前一个任务
    if (loading) {
      if (text.trim()) {
        setQueuedSends(prev => [...prev, text]);
      }
      return;
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
    const autoModel = useAutoModelStore.getState();
    if (autoModel.enabled) {
      const analysis = analyzeComplexity(text);
      autoModel.setAnalysis(analysis);
      if (analysis.suggestedTier && analysis.isComplex) {
        console.log(`[autoModel] 复杂度 ${analysis.score}, 建议: ${analysis.suggestedTier.label}`);
      }
    }

    setLoading(true);

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

    const userId = `user-${Date.now()}`;
    const botId = `bot-${Date.now()}`;

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
    addMessage(sessionId!, { role: 'user', content: messageText, ts: Date.now() });

    // 自动更新对话标题：取第一条用户消息前 30 字
    if (sessionId) {
      const session = sessions.find(s => s.id === sessionId);
      if (session && session.title === '新对话' && messageText.trim()) {
        useSessionStore.getState().updateTitle(sessionId, messageText.trim().slice(0, 30));
      }
    }

    // 情绪分析 (并行, 不阻塞回复)
    // 快速启发式分析 (不调LLM, 立即可用)
    const quickEmotion = analyzeEmotionQuick(text);
    setEmotionMap(prev => ({ ...prev, [userId]: quickEmotion }));
    // 异步LLM精确分析 (覆盖启发式结果)
    analyzeEmotion(text).then(emotion => {
      setEmotionMap(prev => ({ ...prev, [userId]: emotion }));
    }).catch(() => { /* ignore */ });

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

    const baseHandlers = makeChatHandlers(botId, updateMessage);
    const handlers = {
      ...baseHandlers,
      // 包装 onDelta: 重置超时计时器
      onDelta: (info: any) => { lastActivityTs = Date.now(); baseHandlers.onDelta?.(info); },
      // 缓存工具调用参数 (onToolResult 中需要)
      _toolArgsCache: {} as Record<string, any>,
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
          // 音乐控制: 如果工具返回 _music_action, 触发前端音乐播放器
          if (result?._music_action) {
            window.dispatchEvent(new CustomEvent('agentai:music-action', {
              detail: { action: result._music_action, volume: result.volume, trackIndex: result.trackIndex },
            }));
          }
        } catch { /* best-effort */ }

        // 图片检测: 如果工具结果包含图片数据, 自动插入 image segment
        detectAndInsertImage(botId, info.name, info.result, updateMessage);

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

        // 生成文件: 在对话中显示可点击的文件链接（不注入文件内容）
        if (['write_file', 'create_file', 'run_code'].includes(info.name) && info.ok) {
          try {
            // 从缓存读取 args（不依赖 orchestrator store）
            const cachedArgs = handlers._toolArgsCache[info.callId];
            const args = typeof cachedArgs === 'string' ? JSON.parse(cachedArgs) : cachedArgs;
            let filePath = args?.file_path || args?.path || '';
            // run_code: 从结果中提取文件路径
            if (!filePath && info.name === 'run_code' && info.result) {
              const resultStr = typeof info.result === 'string' ? info.result : JSON.stringify(info.result);
              const fileMatch = resultStr.match(/(?:已生成|已创建|saved?|wrote|created|output)[:\s]*[`'"]*([^\s`'"]+\.\w{2,5})/i);
              if (fileMatch) filePath = fileMatch[1];
            }
            if (filePath) {
              const fileName = filePath.split(/[\\/]/).pop() || filePath;
              updateMessage(botId, (m: any) => ({
                ...m,
                segments: [...m.segments, { kind: 'text', text: `\n\n> 📄 **已生成文件**: [${fileName}](agentai://open?path=${encodeURIComponent(filePath)}) · [查看修改](agentai://diff?path=${encodeURIComponent(filePath)})\n> 📂 路径: \`${filePath}\`\n` }],
              }));
            }
          } catch { /* file link best-effort */ }
        }

        // 桥接 → 全局任务编排器: 更新工具调用结果
        useTaskOrchestrator.getState().updateToolCall(info.callId, info.result, info.ok, info.durationMs);

        // 桥接 → 检测代码变更 (write_file / edit_file 等工具)
        try {
          const toolNames = ['write_file', 'edit_file', 'create_file', 'modify_file', 'delete_file', 'replace_in_file'];
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
                diff: args?.diff || args?.content?.slice(0, 500),
                timestamp: Date.now(),
              });
            }
          }
        } catch { /* best-effort code change detection */ }
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

        // TTS语音播报: AI回复完成时自动播报
        try {
          if (checkTts()) {
            const lastMsg = useChatStore.getState().messages.find((m: any) => m.id === botId);
            const text = lastMsg?.segments?.filter((s: any) => s.kind === 'text').map((s: any) => s.text).join('');
            if (text) speak(text.slice(0, 500)); // 最多播报500字
          }
        } catch { /* TTS is best-effort */ }

        // 自动记忆: 检测任务完成, 保存到 MemoryEngine
        try {
          const allText = messages.map(m => ({
            role: m.role,
            content: m.segments?.filter(s => s.kind === 'text').map(s => s.text).join('') || '',
          }));
          const lastAssistant = allText.filter(m => m.role === 'assistant').pop();
          if (lastAssistant && lastAssistant.content.length > 30) {
            MemoryEngine.autoSaveOnTaskComplete(
              allText,
              '', // workspace (由 EditorRightPanel 处理)
              lastAssistant.content.slice(0, 80).replace(/\n/g, ' ').trim(),
            );
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
        updateMessage(botId, (m: any) => ({ ...m, streaming: false, status: 'error', segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${err}` }] }));
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
        };
        const stageKeys = info.stages || ['plan', 'solve', 'verify', 'fix', 'report'];
        useTaskOrchestrator.getState().startTask(
          info.chainId || `task-${Date.now()}`,
          info.goal || messageText,
          stageKeys.map((key: string) => ({
            key,
            label: stageLabels[key] || key,
            status: key === 'plan' ? 'running' as const : 'pending' as const,
          })),
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
      // 自定义模型需传递 baseURL 和 modelName 给 gateway
      const modelConfig = activeModelConfig && !activeModelConfig.isBuiltIn ? {
        baseURL: activeModelConfig.baseURL,
        modelName: activeModelConfig.models?.[0] || activeModelConfig.label,
        provider: activeModelConfig.provider,
      } : undefined;

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
        // 自动附带当前编辑器打开的文件 (让 AI 知道用户在看什么)
        const activeEditorFile = localStorage.getItem('agentai.editor.activeFile') || '';
        await apiStream(base + '/v1/chat', {
          message: messageText, stream: true, model: provider, mode,
          userId: 'user', workspace: ws, projectDir: ws, profile, contextWindow,
          emotion: quickEmotion,
          activeFile: activeEditorFile || undefined,
          attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
          thinking, modelConfig,
          systemRules: buildTimelinePrompt(),
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
    }
  }, [loading, activeModelId, mode, appendMessage, updateMessage, activeId, createSession, addMessage, attachments, setAttachments]);

  /** 用户手动中止当前任务 */
  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
    const lastBot = messages.filter(m => m.role === 'assistant').pop();
    if (lastBot) {
      updateMessage(lastBot.id, (m: any) => ({
        ...m, streaming: false, status: 'done',
        segments: [...m.segments, { kind: 'text', text: '\n\n⏹ 已中止' }],
      }));
    }
    // 中止后立即发送排队的第一条消息（用户排队就是想替代当前任务）
    setQueuedSends(prev => {
      if (prev.length > 0) {
        const [first, ...rest] = prev;
        // 延迟发送，等 loading=false 生效
        setTimeout(() => handleSend(first), 100);
        return rest;
      }
      return prev;
    });
  }, [messages, updateMessage, handleSend]);

  /**
   * 重新生成 AI 回复: 删除该 AI 消息及其后所有消息, 重发上一条用户消息
   * 同时恢复图片附件 (base64 数据存储在消息 segments 中)
   */
  const regenerateAssistant = useCallback((messageId: string) => {
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
    // 重新发送 (携带恢复的附件)
    handleSend(userText, restoredAttachments.length > 0 ? restoredAttachments : undefined);
  }, [messages, handleSend, removeMessages]);

  /**
   * 反馈 (点赞/点踩): 写入 localStorage, 不再依赖后端
   */
  const feedbackMessage = useCallback((messageId: string, kind: 'up' | 'down') => {
    try {
      const key = 'agentai.msg_feedback';
      const all = JSON.parse(localStorage.getItem(key) || '{}');
      if (all[messageId] === kind) delete all[messageId];
      else all[messageId] = kind;
      localStorage.setItem(key, JSON.stringify(all));
    } catch { /* ignore */ }
  }, []);

  /**
   * 收藏: 写入 localStorage, 供笔记面板后续消费
   */
  const bookmarkMessage = useCallback((messageId: string, text: string) => {
    try {
      const key = 'agentai.bookmarks';
      const list: Array<{ id: string; text: string; ts: number }> = JSON.parse(localStorage.getItem(key) || '[]');
      if (list.find(b => b.id === messageId)) {
        // 已收藏, 取消
        const next = list.filter(b => b.id !== messageId);
        localStorage.setItem(key, JSON.stringify(next));
      } else {
        list.push({ id: messageId, text: text.slice(0, 1000), ts: Date.now() });
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch { /* ignore */ }
  }, []);

  /**
   * 在编辑器中打开文件: 切换视图到 editor 并触发文件打开事件
   */
  const openFileInEditor = useCallback((path: string) => {
    try {
      // 触发全局事件, 由 Editor 组件监听
      window.dispatchEvent(new CustomEvent('agentai:open-file', { detail: { path } }));
      // 切换视图
      const store = (window as any).__agentai_app_store__;
      if (store?.getState?.().setView) {
        store.getState().setView('editor');
      }
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
**x-agent 命令指南**

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
  const { diffFile, clearDiff } = useDiffEvents();
  // 规划模式审批状态
  const [planNeedsApproval, setPlanNeedsApproval] = useState(false);
  const [planSessionId, setPlanSessionId] = useState<string>('');

  /* ---- 追问答案: loading=false 后自动发送 ---- */
  useEffect(() => {
    if (pendingAnswer && !loading) {
      handleSend(pendingAnswer);
      setPendingAnswer(null);
    }
  }, [pendingAnswer, loading, handleSend]);

  /* ---- Auto-save: 每30秒保存到 sessionStore ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const timer = setInterval(() => {
      for (const msg of messages) {
        const textSegs = msg.segments.filter(s => s.kind === 'text');
        const text = textSegs[0]?.text || '';  // 只取用户输入文本, 文件标记不存 session
        if (!text) continue;
        addMessage(activeId!, { role: msg.role, content: text, ts: msg.ts });
      }
    }, 30000);
    autoSaveTimerRef.current = timer;
    return () => { clearInterval(timer); autoSaveTimerRef.current = null; };
  }, [activeId, messages.length]);

  /* ---- 保存最后一条消息到 sessionStore ---- */
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const last = messages[messages.length - 1];
    const text = last.segments.filter(s => s.kind === 'text').map(s => s.text).join('').slice(0, 200);
    if (text && !last.streaming) {
      addMessage(activeId, { role: last.role, content: text, ts: last.ts });
    }
  }, [messages.length]);

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

      {/* AI 主动建议 */}
      <ProactiveSuggestionCard
        workspace={currentWorkspace}
        industry={currentIndustry}
        onAction={(action) => {
          if (loading) {
            handleQueueWhileBusy(action);
          } else {
            handleSend(action);
          }
        }}
        visible={messages.length === 0}
      />

      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '8px 0',
          position: 'relative',
        }}
      >
        {/* Welcome screen when empty */}
        {messages.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', padding: 40,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
              有什么可以帮你的？
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 24 }}>
              {systemInfo || 'x-agent'}
            </div>
            {/* 行业快捷指令 — 根据用户选择的行业动态显示 */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 480 }}>
              {getIndustryQuickActions(currentIndustry).map(action => (
                <button
                  key={action.label}
                  onClick={() => { composerRef.current?.setDraft(action.prompt); composerRef.current?.focus(); }}
                  style={{
                    padding: '5px 12px', borderRadius: 6, fontSize: 12,
                    background: 'var(--panel)', border: '1px solid var(--border)',
                    color: 'var(--fg-2)', cursor: 'pointer',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            const textSegs = msg.segments.filter(s => s.kind === 'text');
            const text = textSegs[0]?.text || '';
            const emotion = emotionMap[msg.id];
            const profile = useProfileStore.getState()?.profile;
            // 从消息 segments 中恢复图片附件 (base64 数据持久化在 chatStore 中)
            const restoredAttachments: ParsedAttachment[] = msg.segments
              .filter((s): s is { kind: 'image'; base64?: string; alt?: string } => s.kind === 'image')
              .filter(s => s.base64)
              .map(s => ({
                name: s.alt || 'image.png',
                mimetype: 'image/png',
                size: 0,
                content: `[图片: ${s.alt || 'image.png'}]`,
                dataUrl: `data:image/png;base64,${s.base64}`,
                kind: 'image' as const,
              }));
            return (
              <div key={msg.id} ref={el => msgRefs.current[msg.id] = el}>
                <UserMsg
                  text={text}
                  segments={msg.segments}
                  status={msg.status}
                  messageId={msg.id}
                  onNavigate={handleNavigateToMsg}
                  userName={profile?.name || '你'}
                  userAvatar={undefined}
                  onResend={() => handleSend(text, restoredAttachments.length > 0 ? restoredAttachments : undefined)}
                  onEdit={() => composerRef.current?.setDraft(text)}
                  onBookmark={() => bookmarkMessage(msg.id, text)}
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
            return (
              <div key={msg.id} ref={el => msgRefs.current[msg.id] = el}>
                <AssistantMsg
                  segments={msg.segments}
                  pending={!!msg.streaming}
                  model={msg.provider}
                  usage={msg.usage}
                  status={msg.status}
                  messageId={msg.id}
                  onNavigate={handleNavigateToMsg}
                  onRegenerate={() => regenerateAssistant(msg.id)}
                  onFeedback={(kind) => feedbackMessage(msg.id, kind)}
                  onBookmark={() => bookmarkMessage(msg.id, msg.segments.filter(s => s.kind === 'text').map((s: any) => s.text).join('\n'))}
                  onOpenFile={(path) => openFileInEditor(path)}
                  onEdit={() => {
                    const last = msg.segments.filter(s => s.kind === 'text').map((s: any) => s.text).join('\n');
                    composerRef.current?.setDraft(last);
                  }}
                />
              </div>
            );
          }
          if (msg.role === 'system') {
            return (
              <div key={msg.id} style={{ padding: '8px 16px' }}>
                <AssistantMsg segments={msg.segments} pending={false} />
              </div>
            );
          }
          return null;
        })}

        {/* Bottom padding */}
        <div style={{ height: 8 }} />
      </div>

      {/* Empty state margin adjustment */}
      {messages.length === 0 && <div style={{ flex: 1 }} />}

      {/* Queue sends */}
      {queuedSends.length > 0 && (
        <div style={{ padding: '4px 16px 0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {queuedSends.map((t, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 10px', borderRadius: 4, fontSize: 11,
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
            // 中止当前等待 + 设置待发送答案
            if (abortRef.current) {
              abortRef.current.abort();
              abortRef.current = null;
            }
            setLoading(false);
            setAskUserCard(null);
            setPendingAnswer(answerText);
          }}
        />
      )}

      {/* Diff 预览 — AI 修改文件后的对比 */}
      {diffFile && <DiffViewer filePath={diffFile} onClose={clearDiff} />}

      {/* Context Monitor — 上下文长度提醒 */}
      {messages.length > 3 && tokenInfo.nearing && (
        <div style={{
          margin: '4px 16px 0', padding: '5px 10px', borderRadius: 6,
          background: tokenInfo.critical ? 'rgba(239,68,68,0.1)' : 'rgba(250,204,21,0.08)',
          border: `1px solid ${tokenInfo.critical ? 'rgba(239,68,68,0.25)' : 'rgba(250,204,21,0.2)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Progress bar */}
            <div style={{
              flex: 1, height: 4, borderRadius: 2,
              background: 'rgba(255,255,255,0.06)',
            }}>
              <div style={{
                width: `${tokenInfo.pct}%`, height: '100%', borderRadius: 2,
                background: tokenInfo.critical
                  ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                  : 'linear-gradient(90deg, #eab308, #f59e0b)',
                transition: 'width 0.4s ease',
              }} />
            </div>
            <span style={{
              fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
              color: tokenInfo.critical ? '#ef4444' : '#eab308',
            }}>
              {tokenInfo.pct}%
            </span>
            {tokenInfo.critical && (
              <button
                onClick={() => {
                  // 创新功能: 自动整理摘要 → 发送到新对话
                  const summary = generateConversationSummary(messages);
                  smartClear();
                  const id = createSession('新对话 (续)');
                  // 延迟发送摘要到新对话, 让用户看到上下文被保留
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
                  fontSize: 10, padding: '2px 8px', borderRadius: 4,
                  background: 'var(--accent)', color: '#fff', border: 'none',
                  cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 600,
                }}
              >
                + 新对话 (带摘要)
              </button>
            )}
          </div>
          <div style={{ fontSize: 9, color: tokenInfo.critical ? '#ef4444' : '#eab308', marginTop: 3, opacity: 0.8 }}>
            {tokenInfo.critical
              ? `对话已接近上下文上限 (${formatTokens(tokenInfo.tokens)} tokens)，建议创建新对话`
              : `对话上下文 ${formatTokens(tokenInfo.tokens)} tokens`}
          </div>
        </div>
      )}

      {/* 工作目录选择 */}
      <WorkspaceSelector />

      {/* 轻量级 loading 指示器 (详细进度由 TaskChainCard 展示) */}
      {loading && !chainId && (
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
          onSend={(text) => handleSend(text)}
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
          position: 'absolute', inset: 0, zIndex: 999,
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
