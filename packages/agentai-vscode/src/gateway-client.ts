/**
 * Gateway WebSocket 客户端
 * 真连 AgentAI Gateway (ws://127.0.0.1:18789)
 * 学自 Cursor cursor-mcp 的 vscode 自定义 URI 处理
 */

import * as vscode from 'vscode';
import { WebSocket } from 'ws';

export class GatewayClient implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private url: string;
  private ctx: vscode.ExtensionContext;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(url: string, ctx: vscode.ExtensionContext) {
    this.url = url;
    this.ctx = ctx;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws.on('open', () => {
        this.connected = true;
        console.log(`[AgentAI] connected to ${this.url}`);
        resolve();
      });
      this.ws.on('error', (e) => {
        if (!this.connected) reject(e);
      });
      this.ws.on('close', () => {
        this.connected = false;
        console.log('[AgentAI] disconnected, retry in 5s');
        this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), 5000);
      });
    });
  }

  async chat(text: string): Promise<string> {
    if (!this.connected || !this.ws) {
      return '⚠️ Gateway 离线, 请先启动 pnpm dev:gateway';
    }
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            this.ws!.off('message', onMsg);
            resolve(msg.content ?? '(空响应)');
          }
        } catch {}
      };
      this.ws!.on('message', onMsg);
      this.ws!.send(JSON.stringify({
        id,
        type: 'chat',
        messages: [{ role: 'user', content: text }],
      }));
      setTimeout(() => {
        this.ws!.off('message', onMsg);
        resolve('(响应超时 30s)');
      }, 30000);
    });
  }

  async switchFramework(to: 'openclaw' | 'hermes'): Promise<boolean> {
    if (!this.connected || !this.ws) return false;
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id === id) {
            this.ws!.off('message', onMsg);
            resolve(msg.ok === true);
          }
        } catch {}
      };
      this.ws!.on('message', onMsg);
      this.ws!.send(JSON.stringify({ id, type: 'switch', to, abRatio: 1.0 }));
      setTimeout(() => {
        this.ws!.off('message', onMsg);
        resolve(false);
      }, 5000);
    });
  }

  /**
   * HTTP POST (新增, webview 和文件命令用)
   * ws://127.0.0.1:18789 -> http://127.0.0.1:18789
   */
  async httpPost(path: string, body: any): Promise<any> {
    const httpUrl = this.url.replace(/^ws/, 'http');
    const https = await import('https');
    const http = await import('http');
    const { URL } = await import('url');
    const u = new URL(httpUrl + path);
    const lib = u.protocol === 'https:' ? https : http;
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 60_000,
      }, (res) => {
        let chunks = '';
        res.on('data', (c) => chunks += c.toString());
        res.on('end', () => {
          try { resolve(JSON.parse(chunks)); } catch { resolve({ raw: chunks }); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('HTTP request timeout 60s')); });
      req.write(data);
      req.end();
    });
  }

  dispose(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
