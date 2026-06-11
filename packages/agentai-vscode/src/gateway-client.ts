/**
 * Gateway HTTP 客户端 (VSCode 扩展用)
 * ----------------------------------------------------
 * 学自 Cursor cursor-mcp: 统一 HTTP 调用 + 流式 SSE
 * 修复:
 *   - 移除 WS (VSCode 扩展不需要 WS, 统一走 HTTP SSE)
 *   - 用 Node 18+ 原生 fetch 替代 http/https 手动 request
 *   - 添加 SSE 流式方法 streamChat
 *   - 添加自动重连逻辑
 */

import * as vscode from 'vscode';

export class GatewayClient implements vscode.Disposable {
  private baseUrl: string;
  private connected = false;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(url: string, ctx?: vscode.ExtensionContext) {
    // ws:// → http://
    this.baseUrl = url.replace(/^ws/, 'http');
  }

  /** 检查 Gateway 健康状态 (每 15s) */
  async connect(): Promise<void> {
    return this.checkHealth();
  }

  private async checkHealth(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        if (!this.connected) {
          this.connected = true;
          console.log('[AgentAI] Gateway connected');
        }
      } else {
        this.connected = false;
      }
    } catch {
      if (this.connected) {
        this.connected = false;
        console.log('[AgentAI] Gateway lost');
      }
    }
    // 定时检查
    if (this.healthTimer) clearTimeout(this.healthTimer);
    this.healthTimer = setTimeout(() => this.checkHealth(), 15000);
  }

  get isConnected(): boolean { return this.connected; }

  /**
   * HTTP POST (用 Node 18+ 原生 fetch)
   */
  async httpPost(path: string, body: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * SSE 流式对话 (用 fetch + ReadableStream)
   * @param text 用户消息
   * @param onDelta 每段增量回调
   * @param onDone 完成回调
   * @param onError 错误回调
   */
  async streamChat(
    text: string,
    onDelta: (text: string) => void,
    onDone: (fullText: string) => void,
    onError?: (err: string) => void,
  ): Promise<void> {
    try {
      const resp = await fetch(`${this.baseUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          userId: 'vscode-user',
          workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
          stream: true,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!resp.ok || !resp.body) {
        onError?.(`Gateway ${resp.status}`);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        while (buf.includes('\n\n')) {
          const sepIdx = buf.indexOf('\n\n');
          const frame = buf.slice(0, sepIdx);
          buf = buf.slice(sepIdx + 2);

          const dataMatch = frame.match(/^data:\s*(.+)$/m);
          if (!dataMatch?.[1]) continue;

          try {
            const data = JSON.parse(dataMatch[1]);
            const eventType = data.type || '';

            if (eventType === 'delta' && data.delta) {
              fullText += data.delta;
              onDelta(data.delta);
            }
            if (eventType === 'done') {
              onDone(fullText);
              return;
            }
            if (eventType === 'error') {
              onError?.(data.error || 'Unknown error');
              return;
            }
          } catch { /* skip malformed */ }
        }
      }
      // 流自然结束
      onDone(fullText);
    } catch (e: any) {
      onError?.(e.message || String(e));
    }
  }

  dispose(): void {
    if (this.healthTimer) clearTimeout(this.healthTimer);
  }
}
