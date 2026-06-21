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
  onToolResult?: (info: { callId: string; name: string; result: string; ok: boolean; durationMs: number }) => void;
  onPlanCreated?: (info: { chainId: string; goal: string; stages: string[]; currentStage: string }) => void;
  onPlanStage?: (info: { chainId: string; stage: string; status: string }) => void;
  onApprovalRequired?: (info: { id: string; type: string; filePath: string; summary: string; riskLevel: string }) => void;
  onAskUser?: (info: { question: string; options: string[] }) => void;
  onModelFallback?: (info: { from: string; to: string; reason: string }) => void;
  onSubagentStart?: (info: { id: string; type: string; task: string }) => void;
  onSubagentDone?: (info: { id: string; result: string }) => void;
  onSubagentError?: (info: { id: string; error: string }) => void;
  onToolStuck?: (info: { tool: string; count: number }) => void;
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
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        const lt = segs.filter((s: any) => s.kind === 'text').pop();
        if (lt && lt.kind === 'text') lt.text += text;
        else segs.push({ kind: 'text', text });
        return { ...m, segments: segs, streaming: true };
      });
    },
    onReasoning: (text: string) => {
      // 推理过程 → 插入 reasoning segment (前端会渲染为可折叠卡片)
      // 当LLM调工具时, 之前的文本输出就是推理过程, 需要把text→reasoning
      updateMessage(botId, (m: any) => {
        const segs = [...m.segments];
        // 把已有的 text segments 转为 reasoning (LLM在调工具前的文字就是推理)
        const converted = segs.map((s: any) =>
          s.kind === 'text' ? { ...s, kind: 'reasoning' } : s
        );
        // 追加到已有的 reasoning segment 或创建新的
        const lastSeg = converted[converted.length - 1];
        if (lastSeg && lastSeg.kind === 'reasoning') {
          lastSeg.text += text;
        } else {
          converted.push({ kind: 'reasoning', text });
        }
        return { ...m, segments: converted, streaming: true };
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
        ...m, segments: [...m.segments, { kind: 'tool', callId: info.callId, name: info.name, state: 'running' }],
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
            ? { ...s, state: info.ok ? 'success' : 'error', result: info.result, ok: info.ok, durationMs: info.durationMs }
            : s,
        );
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
    },
    onError: (err: string) => {
      updateMessage(botId, (m: any) => ({ ...m, streaming: false, status: 'error', segments: [...m.segments, { kind: 'text', text: `\n\n❌ ${err}` }] }));
    },
  } as ApiStreamHandlers;
}

export async function apiStream(url: string, body: any, handlers: ApiStreamHandlers, signal?: AbortSignal): Promise<void> {
  const MAX_RETRIES = 3;
  let retries = 0;

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
              case 'approval_required': handlers.onApprovalRequired?.(data); break;
              case 'ask_user': handlers.onAskUser?.(data); break;
              case 'model_fallback': handlers.onModelFallback?.(data); break;
              case 'subagent_start': handlers.onSubagentStart?.(data); break;
              case 'subagent_done': handlers.onSubagentDone?.(data); break;
              case 'subagent_error': handlers.onSubagentError?.(data); break;
              case 'tool_stuck': handlers.onToolStuck?.(data); break;
              case 'done': handlers.onDone?.({ provider: data.provider, content: data.content, usage: data.usage, displayModel: data.displayModel }); return;
              case 'error': handlers.onError?.(data.error || data.text || 'Unknown error'); return;
            }
          } catch {}
        }
      }
      // 正常结束 (SSE 流关闭, 但没有 done 事件)
      return;
    } catch (e: any) {
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

/** 拼接完整 URL: dev 用相对路径走 proxy, 打包后用 GATEWAY_HTTP */
function apiUrl(path: string): string {
  const isDev = import.meta.env.DEV;
  if (isDev) return path;
  const base = gatewayFallback.isOnline ? GATEWAY_HTTP : gatewayFallback.url;
  return base + path;
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
