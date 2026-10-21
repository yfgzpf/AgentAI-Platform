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
  onSubagentProgress?: (info: { id: string; event: string; iteration?: number; step?: number; description?: string; toolName?: string; result?: string }) => void;
  /** 2026-10-21: 主任务进入「等服务端子智能体」状态 (富哥: 主导方不断去看完成没有, 不中断) */
  onSubagentWaiting?: (info: { count: number; sessionId?: string }) => void;
  onToolStuck?: (info: { tool: string; count: number; detail?: string }) => void;
  /** 2026-10-17 P0: 长耗时工具执行期间每 30s 发一次心跳, 用于续上 idle 计时器 */
  onToolHeartbeat?: (info: { callId: string; name: string; pending?: number; retry?: number }) => void;
  onMemoryAuto?: (info: { written: number; skipped: number }) => void;
  onWidgetShow?: (info: { widgetType: string; content: any }) => void;
  onProgress?: (info: { step: string; percent?: number; description?: string; toolCount?: number; successCount?: number; failCount?: number }) => void;
  onDone?: (info: { provider?: string; content?: string; usage?: any; displayModel?: string }) => void;
  onError?: (err: string) => void;
  /** 2026-10-17: 非致命提示 (如本地限流即将自动重试), 只告知不报错 */
  onNotice?: (info: { kind: string; text: string; retryAfterSec?: number }) => void;
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
        // 2026-09-04 修复: 原 lt.text = newText 就地改写共享 segment 对象 → 破坏 store 不可变快照语义,
        // 影响 memo/增量渲染正确性。改为"定位 index + 复制替换"。
        let lastTextIdx = -1;
        for (let i = segs.length - 1; i >= 0; i--) {
          if (segs[i].kind === 'text') { lastTextIdx = i; break; }
        }
        let newText = '';
        if (lastTextIdx >= 0) {
          const lt = segs[lastTextIdx];
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
          segs[lastTextIdx] = { ...lt, text: newText };
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
          // 2026-09-04: 复制替换, 避免就地改写共享 segment
          segs[segs.length - 1] = { ...lastSeg, text: lastSeg.text + text };
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
          // 2026-09-04: 复制替换, 避免就地改写共享 segment
          segs[segs.length - 1] = { ...lastSeg, text: lastSeg.text + text };
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
          // 2026-09-04: 复制替换, 避免就地改写共享 segment
          segs[segs.length - 1] = { ...lastSeg, text: lastSeg.text + `\n🔧 ${label}` };
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
            const fp = pathMatch?.[1];
            if (fp) {
              filePath = fp;
              imgAlt = `本地图片: ${fp.split(/[\\\/]/).pop()}`;
            }
          }

          if (imgUrl || imgBase64 || filePath) {
            segs.push({ kind: 'image', url: imgUrl, base64: imgBase64, alt: imgAlt, filePath } as any);
          }
        }
        return { ...m, segments: segs };
      });

      // D2: 广播 AI 代码变更事件 (lineRanges → 真实行号装饰)
      const lr: any[] = (info as any).data?.lineRanges;
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
  // 断线恢复: 记录已接收的 delta 文本, 重试时传给后端
  let receivedDelta = '';

  while (retries <= MAX_RETRIES) {
    try {
      // 重试时在 body 中注入 _retry 标记和已收到的文本, 让后端知道这是恢复
      const reqBody = retries > 0 ? { ...body, _retry: true, _receivedDelta: receivedDelta } : body;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
        signal,
      });
      if (!resp.ok) {
        // 2026-10-17 P0: 原来只丢 `HTTP ${status}`, 把响应体和 Retry-After 全丢了 →
        //   用户只看到裸文案 "HTTP 429", 既不知道是自己发太快, 也不知道要等多久。
        //   现在: ①读错误体拿 reason/retryAfter ②对 429 退避后重试(不占用用户一次输入)
        const retryAfterHeader = resp.headers.get('Retry-After');
        let detail = '';
        try { detail = await resp.text(); } catch { /* body 可能已消费 */ }
        let parsed: any = {};
        try { parsed = detail ? JSON.parse(detail) : {}; } catch { /* 非 JSON 就保留原文 */ }
        const retryAfterSec = Number(retryAfterHeader || parsed.retryAfter || 0) || 0;

        if (resp.status === 429 && retries < MAX_RETRIES) {
          // 网关本地限流 (rate-limit.ts: 外部 20 RPM / 并发 2)。
          // 这是**我们自己**造的 429, 不是模型服务返回的 —— 等一下重发即可,
          // 不该把错误抛给用户让他自己再点一次。
          const waitMs = Math.min(Math.max(retryAfterSec, 1) * 1000, 60_000);
          retries++;
          console.warn(`[api] 命中本地限流 (429), ${waitMs}ms 后自动重试 (${retries}/${MAX_RETRIES})`);
          handlers.onNotice?.({
            kind: 'rate_limit',
            text: `请求过快, 等待 ${Math.ceil(waitMs / 1000)} 秒后自动重试…`,
            retryAfterSec: Math.ceil(waitMs / 1000),
          });
          if (signal?.aborted) return;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        const reason = parsed.error || parsed.reason || (detail && !detail.startsWith('<') ? detail.slice(0, 120) : '');
        const hint = resp.status === 429
          ? `本地限流 (每分钟请求数超限), 请稍候再试${retryAfterSec ? ` (约 ${retryAfterSec}s)` : ''}`
          : resp.status === 401 || resp.status === 403 ? '鉴权失败, 请检查 API Key 配置'
            : resp.status === 404 ? '接口不存在, 网关版本可能不匹配'
              : '';
        handlers.onError?.(`HTTP ${resp.status}${reason ? ` — ${reason}` : ''}${hint ? `\n${hint}` : ''}`);
        return;
      }
      if (!resp.body) { handlers.onError?.('No response body'); return; }

      reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        // ⚠️ 关键修复: 必须在 break 前先处理 value, 否则末包 (可能含 done 事件, 与 res.end() 同一 TCP 段)
        //   会被直接丢弃 → 前端永远收不到 done → 消息永久卡在 streaming 转圈 (即"说一句话就断了")
        if (value) {
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
              case 'delta': const _delta = data.delta || data.text || ''; receivedDelta += _delta; handlers.onDelta?.(_delta); break;
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
              case 'subagent_progress': handlers.onSubagentProgress?.(data); break;
              case 'subagent_waiting': handlers.onSubagentWaiting?.(data); break; // 2026-10-21: 主任务等服务端子任务
case 'tool_stuck': handlers.onToolStuck?.(data); break;
case 'tool_heartbeat': handlers.onToolHeartbeat?.(data); break; // 2026-10-17 P0: 长耗时工具心跳, 喂 idle 计时器
case 'widget_show': handlers.onWidgetShow?.(data); break;
case 'progress': handlers.onProgress?.(data); break;
// 灵魂层事件: 注入为特殊 segment + dispatch 全局事件
case 'mood':
  window.dispatchEvent(new CustomEvent('agentai:mood', { detail: data }));
  break;
case 'inner_voice': window.dispatchEvent(new CustomEvent('agentai:inner-voice', { detail: data })); break;
case 'curiosity': window.dispatchEvent(new CustomEvent('agentai:curiosity', { detail: data })); break;
case 'debate': window.dispatchEvent(new CustomEvent('agentai:debate', { detail: data })); break;
case 'dream': window.dispatchEvent(new CustomEvent('agentai:dream', { detail: data })); break;
              case 'timeout': window.dispatchEvent(new CustomEvent('agentai:timeout', { detail: data })); break;
              case 'resume': handlers.onNotice?.({ kind: 'reconnect', text: data?.msg || 'SSE 断线恢复中…' }); break;
              case 'context_compressed': handlers.onNotice?.({ kind: 'compress', text: `已自动压缩上下文 (保留 ${data.after} 条消息, 压缩 ${data.compressed} 条)` }); break;
              case 'working_memory': handlers.onNotice?.({ kind: 'memory', text: `已生成工作记忆摘要 (第 ${data.iteration} 轮)` }); break;
              case 'done': handlers.onDone?.({ provider: data.provider, content: data.content, usage: data.usage, displayModel: data.displayModel }); return;
              case 'error': handlers.onError?.(data.error || data.text || 'Unknown error'); return;
            }
          } catch {}
        }
        }
        if (done) break;
      }
      // 流结束但未收到 done 事件: 视为传输在 done 前中断, 在重试额度内自动续跑
      //   (不占用户一次输入; 与 429 退避同理, 避免"长任务跑一半连接断了就得重说")。
      //   注: 若后端真的已跑完并发送过 done, 内层循环会走 `case 'done'` 直接 return,
      //   永远到不了这里 —— 所以能到这里是**确实没收到 done**, 重试是合理恢复。
      if (receivedDelta.trim() && retries < MAX_RETRIES) {
        console.warn(`[api] SSE 在 done 前中断, 自动重试续跑 (${retries + 1}/${MAX_RETRIES})`);
        if (reader) { try { reader.cancel(); } catch {} reader = null; }
        retries++;
        const backoff = 1000 * retries; // 1s, 2s, 3s
        if (signal?.aborted) return;
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      // 重试耗尽或确无内容: 兜底收尾, 绝不卡死转圈 (这正是"说一句话就断了"的根因之一)。
      if (receivedDelta.trim()) {
        handlers.onDone?.({ content: receivedDelta });
      } else {
        handlers.onError?.('连接已断开, 未收到任何回复');
      }
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
import { GATEWAY_HTTP, IS_DEV } from './config';

/** 拼接完整 URL: 统一使用 GATEWAY_HTTP (与 fetchInterceptor 一致) */
export function apiUrl(path: string): string {
  // GATEWAY_HTTP:
  //   开发态 = '' (相对路径, 走 Vite proxy)
  //   生产态 = 'http://127.0.0.1:18789' (直连)
  // fetchInterceptor 也会处理相对路径, 两者一致, 不会双重重定向
  const base = GATEWAY_HTTP;
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
