"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayClient = void 0;
const vscode = __importStar(require("vscode"));
class GatewayClient {
    baseUrl;
    connected = false;
    healthTimer = null;
    constructor(url, ctx) {
        // ws:// → http://
        this.baseUrl = url.replace(/^ws/, 'http');
    }
    /** 检查 Gateway 健康状态 (每 15s) */
    async connect() {
        return this.checkHealth();
    }
    async checkHealth() {
        try {
            const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                if (!this.connected) {
                    this.connected = true;
                    console.log('[AgentAI] Gateway connected');
                }
            }
            else {
                this.connected = false;
            }
        }
        catch {
            if (this.connected) {
                this.connected = false;
                console.log('[AgentAI] Gateway lost');
            }
        }
        // 定时检查
        if (this.healthTimer)
            clearTimeout(this.healthTimer);
        this.healthTimer = setTimeout(() => this.checkHealth(), 15000);
    }
    get isConnected() { return this.connected; }
    /**
     * HTTP POST (用 Node 18+ 原生 fetch)
     */
    async httpPost(path, body) {
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
    async streamChat(text, onDelta, onDone, onError) {
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
                if (done)
                    break;
                buf += decoder.decode(value, { stream: true });
                while (buf.includes('\n\n')) {
                    const sepIdx = buf.indexOf('\n\n');
                    const frame = buf.slice(0, sepIdx);
                    buf = buf.slice(sepIdx + 2);
                    const dataMatch = frame.match(/^data:\s*(.+)$/m);
                    if (!dataMatch?.[1])
                        continue;
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
                    }
                    catch { /* skip malformed */ }
                }
            }
            // 流自然结束
            onDone(fullText);
        }
        catch (e) {
            onError?.(e.message || String(e));
        }
    }
    dispose() {
        if (this.healthTimer)
            clearTimeout(this.healthTimer);
    }
}
exports.GatewayClient = GatewayClient;
//# sourceMappingURL=gateway-client.js.map