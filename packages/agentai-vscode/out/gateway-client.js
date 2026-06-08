"use strict";
/**
 * Gateway WebSocket 客户端
 * 真连 AgentAI Gateway (ws://127.0.0.1:18789)
 * 学自 Cursor cursor-mcp 的 vscode 自定义 URI 处理
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GatewayClient = void 0;
const ws_1 = require("ws");
class GatewayClient {
    ws = null;
    url;
    ctx;
    connected = false;
    reconnectTimer = null;
    constructor(url, ctx) {
        this.url = url;
        this.ctx = ctx;
    }
    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new ws_1.WebSocket(this.url);
            }
            catch (e) {
                reject(e);
                return;
            }
            this.ws.on('open', () => {
                this.connected = true;
                console.log(`[AgentAI] connected to ${this.url}`);
                resolve();
            });
            this.ws.on('error', (e) => {
                if (!this.connected)
                    reject(e);
            });
            this.ws.on('close', () => {
                this.connected = false;
                console.log('[AgentAI] disconnected, retry in 5s');
                this.reconnectTimer = setTimeout(() => this.connect().catch(() => { }), 5000);
            });
        });
    }
    async chat(text) {
        if (!this.connected || !this.ws) {
            return '⚠️ Gateway 离线, 请先启动 pnpm dev:gateway';
        }
        return new Promise((resolve) => {
            const id = Math.random().toString(36).slice(2);
            const onMsg = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id === id) {
                        this.ws.off('message', onMsg);
                        resolve(msg.content ?? '(空响应)');
                    }
                }
                catch { }
            };
            this.ws.on('message', onMsg);
            this.ws.send(JSON.stringify({
                id,
                type: 'chat',
                messages: [{ role: 'user', content: text }],
            }));
            setTimeout(() => {
                this.ws.off('message', onMsg);
                resolve('(响应超时 30s)');
            }, 30000);
        });
    }
    async switchFramework(to) {
        if (!this.connected || !this.ws)
            return false;
        return new Promise((resolve) => {
            const id = Math.random().toString(36).slice(2);
            const onMsg = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id === id) {
                        this.ws.off('message', onMsg);
                        resolve(msg.ok === true);
                    }
                }
                catch { }
            };
            this.ws.on('message', onMsg);
            this.ws.send(JSON.stringify({ id, type: 'switch', to, abRatio: 1.0 }));
            setTimeout(() => {
                this.ws.off('message', onMsg);
                resolve(false);
            }, 5000);
        });
    }
    dispose() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.ws?.close();
    }
}
exports.GatewayClient = GatewayClient;
//# sourceMappingURL=gateway-client.js.map