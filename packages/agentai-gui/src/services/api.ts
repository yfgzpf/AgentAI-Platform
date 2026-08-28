/**
 * API 服务 — 通过 Vite proxy 调用后端
 * 所有请求走 `/v1/*` 相对路径, 自动被 Vite proxy → 127.0.0.1:18789
 */

export interface ApiStreamHandlers {
  onDelta?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onThinking?: (text: string) => void;
  onAutoFix?: (info: { type: string; module?: string; tool?: string; error?: string }) => void;
  onToolStart?: (info: { callId: string; name: string; args: any }) => void;
  onToolResult?: (info: { callId: string; name: string; result: string; ok: boolean; durationMs: number; data?: any }) => void;
  onPlanCreated?: (info: { chainId: string; goal: string; stages: string[]; currentStage: string }) => void;
  onPlanStage?: (info: { chainId: string; stage: string; status: string }) => void;
  onApprovalRequired?: (info: { id: string; type: string; filePath: string; summary: string; riskLevel: string }) => void;
  onAskUser?: (info: { question: string; options: string[] }) => void;
  onSessionRollover?: (info: { ratio: number; promptTokens: number; ctxMax: number; timestamp: number }) => void;
  onClarifyRequired?: (info: { id: string; originalMessage: string; questions: Array<{ id: string; question: string; type: string; options?: string[] }>; ambiguities?: Array<{ type: string; text: string }> }) => void;
  onModelFallback?: (info: { from: string; to: string; reason: string }) => void;
  onSubagentStart?: (info: { id: string; type: string; task: string }) => void;
  onSubagentDone?: (info: { id: string; result: string }) => void;
  onSubagentError?: (info: { id: string; error: string }) => void;
  onToolStuck?: (info: { tool: string; count: number }) => void;
  onMemoryAuto?: (info: { written: number; skipped: number }) => void;
  onWidgetShow?: (info: { widgetType: string; content: any }) => void;
  onProgress?: (info: { step: string; percent?: number; description?: string; toolCount?: number; successCount?: number; failCount?: number }) => void;
  onDone?: (info: { provider?: string; content?: string; usage?: any; displayModel?: string }) => void;
  onError?: (err: string) => void;
}

/**
 * 从 SSE 流解析消息并更新 chatStore messages
 * 适配 ChatView 的 segments 模型
 */
export function makeChatHandlers(
  botId: string,
  updateMessage: (id: string, fn: (m: any) => any) => void,
) {
  return {
    onDelta: (text: string) => {
      // P1 修复: 重复回复去重 — 如果追加后文本末尾出现重复段落, 截断
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        const lt = segs.filter((s: any) => s.kind === 'text').pop();
        let newText = '';
        if (lt && lt.kind === 'text') {
          newText = lt.text + text;
          // 去重: 检查最后 50 字符是否在前面已出现过
          if (newText.length > 100) {
            const tail = newText.slice(-50);
            const body = newText.slice(0, -50);
            if (body.includes(tail)) {
              // 重复了, 不追加
              newText = lt.text;
            }
          }
          lt.text = newText;
        } else {
          newText = text;
          segs.push({ kind: 'text', text: newText });
        }
        return { ...m, segments: segs, streaming: true };
      });
    },
    onReasoning: (text: string) => {
      // 推理过程 → 插入 reasoning segment (前端会渲染为可折叠卡片)
      // 当LLM调工具时, 之前的文本输出就是推理过程, 需要把text→reasoning
      // 仅追加到已有的 reasoning segment, 不将已有的 text 转为 reasoning
      // (空的 reasoning 事件已在后端去除, 不会出现"调工具时text消失"的问题)
      if (!text) return;
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        const lastSeg = segs[segs.length - 1];
        if (lastSeg && lastSeg.kind === 'reasoning') {
          lastSeg.text += text;
        } else {
          segs.push({ kind: 'reasoning', text });
        }
        return { ...m, segments: segs, streaming: true };
      });
    },
    onThinking: (text: string) => {
      // 深度思考过程 → 插入 thinking segment (前端渲染为紫色可折叠卡片)
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        const lastSeg = segs[segs.length - 1];
        if (lastSeg && lastSeg.kind === 'thinking') {
          lastSeg.text += text;
        } else {
          segs.push({ kind: 'thinking', text });
        }
        return { ...m, segments: segs, streaming: true };
      });
    },
    onToolStart: (info: any) => {
      updateMessage(botId, (m: any) => ({
        ...m, segments: [...m.segments, { kind: 'tool', callId: info.callId, name: info.name, args: info.args || undefined, state: 'running' }],
      }));
    },
    onAutoFix: (info: any) => {
      // 自主修复事件 → 插入 reasoning segment 展示修复过程
      const fixLabels: Record<string, string> = {
        missing_module: `自动安装依赖: ${info.module || ''}`,
        encoding_error: '自动修复编码问题',
        path_not_found: '自动探索正确路径',
        permission_error: '自动切换执行方式',
        code_error: `自动修复代码错误: ${(info.error || '').slice(0, 50)}`,
        network_error: '网络错误自动重试',
        missing_tool: `自动实现缺失工具: ${info.tool || ''}`,
        parse_error: '自动切换文件解析方式',
      };
      const label = fixLabels[info.type] || `自主修复: ${info.type}`;
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        // 追加到已有 reasoning 或创建新的
        const lastSeg = segs[segs.length - 1];
        if (lastSeg && lastSeg.kind === 'reasoning') {
          lastSeg.text += `\n🔧 ${label}`;
        } else {
          segs.push({ kind: 'reasoning', text: `🔧 ${label}` });
        }
        return { ...m, segments: segs, streaming: true };
      });
    },
    onToolResult: (info: any) => {
      updateMessage(botId, (m: any) => {
        const segs = m.segments.map((s: any) =>
          s.kind === 'tool' && s.callId === info.callId
            ? { ...s, state: info.ok ? 'success' : 'error', result: info.result, ok: info.ok, durationMs: info.durationMs, data: info.data }
            : s,
        );
        // P0 修复: generate_image / browser_screenshot 等工具返回的图片 → 提取 URL 创建 image segment
        if (info.ok && info.name && /^(generate_image|create_image|draw|paint|browser_screenshot|capture_screen|capture_and_read)$/i.test(info.name)) {
          const result = info.result || '';
          const data = info.data;
          // 从 data 中提取图片 URL/base64
          let imgUrl: string | undefined;
          let imgBase64: string | undefined;
          let imgAlt = info.name === 'generate_image' ? 'AI 生成图片' : '截图';

          if (data?.url) imgUrl = data.url;
          else if (data?.image_url) imgUrl = data.image_url;
          else if (data?.base64) imgBase64 = data.base64;
          else if (data?.image_base64) imgBase64 = data.image_base64;
          // 从 result 文本中提取 URL
          if (!imgUrl && !imgBase64) {
            const urlMatch = result.match(/(https?:\/\/[^\s"'\)]+\.(?:png|jpg|jpeg|webp|gif))/i);
            if (urlMatch) imgUrl = urlMatch[1];
          }
          // 从 result 文本中提取本地文件路径
          let filePath: string | undefined;
          if (!imgUrl && !imgBase64) {
            const pathMatch = result.match(/([A-Za-z]:[\\\/][^\s"'<>|]+\.(?:png|jpg|jpeg|webp))/i);
            if (pathMatch) {
              filePath = pathMatch[1];
              imgAlt = `本地图片: ${filePath.split(/[\\\/]/).pop()}`;
            }
          }

          if (imgUrl || imgBase64 || filePath) {
            segs.push({ kind: 'image', url: imgUrl, base64: imgBase64, alt: imgAlt, filePath } as any);
          }
        }
        return { ...m, segments: segs };
      });
    },
    onDone: (info: any) => {
      updateMessage(botId, (m: any) => {
        // 降级/缓存命中/空流路径: 后端不触发 delta 事件, 内容只在 done.content 里
        // 必须兜底注入, 否则用户看到空消息 + "none" provider 标签
        let segments = m.segments;
        const hasText = m.segments?.some((s: any) => s.kind === 'text' && s.text?.trim());
        if (info.content && info.content.trim() && !hasText) {
          segments = [...(m.segments || []), { kind: 'text', text: info.content }];
        }
        return {
          ...m, segments, streaming: false, provider: info.provider, status: 'done',
          usage: info.usage, // { prompt_tokens, completion_tokens, cost?, ... }
        };
      });
      // 追踪用量统计
      if (info.usage) {
        const tokens = info.usage.total_tokens || info.usage.prompt_tokens || 0;
        const cost = info.usage.cost || 0;
        window.dispatchEvent(new CustomEvent('agentai:usage-update', {
          detail: { tokens, cost, isImage: false },
        }));
      }
    },
    onError: (err: string) => {
      updateMessage(botId, (m: any) => ({ ...m, streaming: false, status: 'error', segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${err}` }] }));
    },
  } as ApiStreamHandlers;
}

export async function apiStream(url: string, body: any, handlers: ApiStreamHandlers, signal?: AbortSignal): Promise<void> {
  const MAX_RETRIES = 3;
  let retries = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  while (retries <= MAX_RETRIES) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      if (!resp.ok) { handlers.onError?.(`HTTP ${resp.status}`); return; }
      if (!resp.body) { handlers.onError?.('No response body'); return; }

      reader = resp.body.getReader();
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
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }

          if (!eventType && dataStr) {
            try { const p = JSON.parse(dataStr); if (p.type) eventType = p.type; } catch {}
          }

          if (!eventType || !dataStr) continue;

          try {
            const data = JSON.parse(dataStr);
            switch (eventType) {
              case 'delta': handlers.onDelta?.(data.delta || data.text || ''); break;
              case 'thinking': handlers.onThinking?.(data.text || data.delta || ''); break;
              case 'reasoning': handlers.onReasoning?.(data.text || ''); break;
              case 'auto_fix': handlers.onAutoFix?.(data); break;
              case 'tool_start': handlers.onToolStart?.(data); break;
              case 'tool_result': handlers.onToolResult?.(data); break;
              case 'plan_created': handlers.onPlanCreated?.(data); break;
              case 'plan_stage': handlers.onPlanStage?.(data); break;
              case 'memory_auto': handlers.onMemoryAuto?.(data); break;
              case 'approval_required': handlers.onApprovalRequired?.(data); break;
              case 'ask_user': handlers.onAskUser?.(data); break;
              case 'clarify:required': handlers.onClarifyRequired?.(data); break;
              case 'session:rollover': handlers.onSessionRollover?.(data); break;
              case 'model_fallback': handlers.onModelFallback?.(data); break;
              case 'subagent_start': handlers.onSubagentStart?.(data); break;
              case 'subagent_done': handlers.onSubagentDone?.(data); break;
              case 'subagent_error': handlers.onSubagentError?.(data); break;
case 'tool_stuck': handlers.onToolStuck?.(data); break;
case 'widget_show': handlers.onWidgetShow?.(data); break;
case 'progress': handlers.onProgress?.(data); break;
// 灵魂层事件: 注入为特殊 segment + dispatch 全局事件
case 'mood':
  window.dispatchEvent(new CustomEvent('agentai:mood', { detail: data }));
  break;
case 'inner_voice': updateMessage(botId, (m: any) => ({ ...m, segments: [...m.segments, { kind: 'reasoning', text: `[内心独白] ${data.text || ''}` }] })); break;
case 'curiosity': updateMessage(botId, (m: any) => ({ ...m, segments: [...m.segments, { kind: 'reasoning', text: `[好奇心] ${data.question || data.text || ''}` }] })); break;
case 'debate': updateMessage(botId, (m: any) => ({ ...m, segments: [...m.segments, { kind: 'reasoning', text: `[内部辩论] ${data.recommendation || data.synthesis || ''}` }] })); break;
case 'dream': updateMessage(botId, (m: any) => ({ ...m, segments: [...m.segments, { kind: 'reasoning', text: `[梦境记忆] ${data.summary || ''}` }] })); break;
              case 'done': handlers.onDone?.({ provider: data.provider, content: data.content, usage: data.usage, displayModel: data.displayModel }); return;
              case 'error': handlers.onError?.(data.error || data.text || 'Unknown error'); return;
            }
          } catch {}
        }
      }
      // 正常结束 (SSE 流关闭, 但没有 done 事件)
      return;
    } catch (e: any) {
      // 确保 reader 被释放, 防止光标/缓冲残留
      if (reader) { try { reader.cancel(); } catch {} reader = null; }
      if (e.name === 'AbortError') return; // 用户主动取消, 不重试
      retries++;
      if (retries > MAX_RETRIES) {
        handlers.onError?.(e.message || String(e));
        return;
      }
      // 指数退避重试: 1s, 2s, 4s
      const delay = Math.min(1000 * Math.pow(2, retries - 1), 4000);
      console.warn(`[api] SSE 断线, ${delay}ms 后重试 (${retries}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/**
 * API 服务 — 调用后端 Gateway
 * dev 模式走 Vite proxy ('/v1/*'), 打包后走 GATEWAY_HTTP 直连
 */
import { GATEWAY_HTTP } from './config';
import { gatewayFallback } from './GatewayFallback';

/** 判断是否开发模式 (非 Tauri + Vite dev server) */
function isDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri 环境绝不是 dev 模式
  if ((window as any).__TAURI_INTERNALS__ || window.location?.protocol === 'tauri:') return false;
  return window.location?.hostname === 'localhost' || 
         window.location?.hostname === '127.0.0.1' ||
         window.location?.port === '5173' ||
         window.location?.port === '5174' ||
         window.location?.port === '5176';
}

/** 拼接完整 URL: 始终使用 gatewayFallback.url 获取正确地址 */
export function apiUrl(path: string): string {
  // 始终使用 gatewayFallback.url，它已处理开发/生产环境
  const base = gatewayFallback.isOnline ? GATEWAY_HTTP : gatewayFallback.url;
  // 确保 path 以 / 开头
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return base + normalizedPath;
}

export async function apiPost<T = any>(url: string, body: any): Promise<T> {
  const resp = await fetch(apiUrl(url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return resp.json() as T;
}

export async function apiGet<T = any>(url: string): Promise<T> {
  const resp = await fetch(apiUrl(url));
  return resp.json() as T;
}

/**
 * 统一 api 对象 — 提供 chat / post / get 等便捷方法
 * 供 DecorAI 等组件以 api.chat(...) / api.post(...) 方式调用
 */
export const api = {
  /** 非流式 chat 调用 */
  async chat(body: { model: string; messages: any[]; temperature?: number }): Promise<{ content: string }> {
    const resp = await fetch(apiUrl('/v1/chat/completions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }),
    });
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || data?.content || '';
    return { content };
  },

  post: apiPost,
  get: apiGet,
};

export async function apiWriteMemory(data: { userId: string; workspace: string; role: string; content: string; source?: string }): Promise<void> {
  try { await apiPost('/v1/memory', data); } catch {}
}

/**
 * 审批 API — 文件修改审批
 */
export async function apiApproveFileChange(sessionId: string, approvalId: string, decision: 'approve' | 'reject'): Promise<any> {
  return apiPost('/v1/chat/approve', { sessionId, approvalId, decision });
}

/**
 * 审批 API — 规划模式审批
 */
export async function apiApprovePlan(sessionId: string, decision: 'approve' | 'reject'): Promise<any> {
  return apiPost('/v1/chat/approve', { sessionId, decision });
}

/**
 * 智能模式推荐 — 纯前端启发式 (不调后端)
 * 根据消息内容特征推荐最合适的运行模式
 */
export function suggestMode(text: string, currentMode: string): { mode: string; reason: string } | null {
  const lower = text.toLowerCase();

  // 审查意图检测
  const reviewPatterns = /审查|review|检查.*代码|代码.*检查|安全.*审计|audit|看看.*有没有.*问题|code.*review|静态分析|lint|代码.*质量|quality.*code/i;
  if (reviewPatterns.test(lower) && currentMode !== 'review') {
    return { mode: 'review', reason: '检测到审查意图，建议使用审查模式获取结构化报告' };
  }

  // 规划意图检测
  const planPatterns = /规划|计划|方案设计|设计.*架构|重写.*方案|migration|方案|制定.*计划|plan.*design/i;
  if (planPatterns.test(lower) && currentMode !== 'planning') {
    return { mode: 'planning', reason: '检测到规划意图，建议先制定执行计划再逐步推进' };
  }

  // 纯问答（不需要工具的简短问题）
  const chatPatterns = /^(什么是|为什么|如何|怎么|解释|tell me|what is|why is|how to|who is|when is|where is)/i;
  if (chatPatterns.test(lower) && currentMode !== 'readonly' && text.length < 50) {
    return { mode: 'readonly', reason: '这是一个知识问答，不需要工具调用' };
  }

  return null;
}
