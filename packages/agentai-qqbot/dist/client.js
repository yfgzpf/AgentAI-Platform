/**
 * QQ 客户端 - 反向 WebSocket 接收 + HTTP API 发送
 * -----------------------------------------------------------
 * 协议: go-cqhttp 1.0+ 的 "正向 WebSocket" / "反向 WebSocket" 都支持
 * 我们用反向 WS (go-cqhttp 连我们) - 更稳, 不用暴露端口
 */
import { EventEmitter } from 'events';
import axios from 'axios';
import chalk from 'chalk';
export class QQClient extends EventEmitter {
    gateway;
    opts;
    ws = null;
    httpApi;
    reconnectTimer = null;
    connected = false;
    constructor(gateway, opts) {
        super();
        this.gateway = gateway;
        this.opts = opts;
        // 默认连本机的 go-cqhttp HTTP API
        this.httpApi = process.env.AGENTAI_QQ_HTTP_API || 'http://127.0.0.1:5700';
    }
    /** 连反向 WS, go-cqhttp 主动连入 */
    async connect(reverseWsUrl) {
        const urlObj = new URL(reverseWsUrl);
        const port = parseInt(urlObj.port || '5700', 10);
        const { WebSocketServer } = await import('ws');
        return new Promise((resolve, reject) => {
            // 反向 WS: 我们是 server, go-cqhttp 是 client
            const wss = new WebSocketServer({ port, host: urlObj.hostname });
            console.log(chalk.gray(`   监听反向 WS: ${reverseWsUrl}`));
            const onConnection = (ws) => {
                console.log(chalk.green('✅ go-cqhttp 已连入'));
                this.ws = ws;
                this.connected = true;
                ws.on('message', (data) => this.handleFrame(data.toString()));
                ws.on('close', () => {
                    console.log(chalk.yellow('⚠️  go-cqhttp 断开, 等 5s 重连'));
                    this.connected = false;
                    this.scheduleReconnect();
                });
                ws.on('error', (e) => console.error(chalk.red('WS 错误:'), e));
                resolve();
            };
            wss.on('connection', onConnection);
            wss.on('error', (e) => {
                if (!this.connected)
                    reject(e);
            });
        });
    }
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // 重连靠 go-cqhttp 自己重试, 我们只 reset state
            this.connected = true; // 简化: 假定 go-cqhttp 会在它自己重连时触发 close -> connection
        }, 5000);
    }
    async handleFrame(raw) {
        let frame;
        try {
            frame = JSON.parse(raw);
        }
        catch {
            return;
        }
        // go-cqhttp 上报: { post_type: 'message', ... }
        if (frame.post_type !== 'message')
            return;
        const msg = {
            message_id: frame.message_id,
            message_type: frame.message_type,
            user_id: frame.user_id,
            group_id: frame.group_id,
            raw_message: frame.raw_message,
            message: frame.message,
            sender: frame.sender,
            time: frame.time,
            self_id: frame.self_id,
        };
        // 忽略自己发的
        if (msg.user_id === msg.self_id)
            return;
        // 白名单
        if (this.opts.allowedGroups.length > 0 && msg.group_id && !this.opts.allowedGroups.includes(msg.group_id))
            return;
        // 触发前缀
        const stripped = msg.message.trim();
        if (this.opts.triggerPrefix && !stripped.startsWith(this.opts.triggerPrefix))
            return;
        const prompt = this.opts.triggerPrefix ? stripped.slice(this.opts.triggerPrefix.length) : stripped;
        if (!prompt)
            return;
        console.log(chalk.blue(`[QQ] ${msg.group_id ? `群 ${msg.group_id}` : '私聊'} ${msg.sender.nickname}: ${prompt}`));
        try {
            const reply = await this.gateway.qqMessage(msg.user_id, msg.group_id ?? 'private', prompt);
            console.log(chalk.gray(`[QQ] <- ${reply.provider ?? '?'}: ${reply.reply?.slice(0, 100)}`));
            await this.sendMessage(msg, reply.reply || '(空响应)');
        }
        catch (e) {
            console.error(chalk.red('[QQ] Gateway 调用失败:'), e.message);
            await this.sendMessage(msg, `❌ Gateway 错误: ${e.message}`);
        }
    }
    /** 通过 go-cqhttp HTTP API 发送消息 */
    async sendMessage(msg, content) {
        const endpoint = msg.message_type === 'group' ? '/send_group_msg' : '/send_private_msg';
        const payload = {
            message: [{ type: 'text', data: { text: content } }],
            message_type: msg.message_type,
            auto_escape: false,
        };
        if (msg.message_type === 'group') {
            payload.group_id = msg.group_id;
        }
        else {
            payload.user_id = msg.user_id;
        }
        try {
            await axios.post(`${this.httpApi}${endpoint}`, payload, { timeout: 10_000 });
        }
        catch (e) {
            console.error(chalk.red('[QQ] 发送失败:'), e.message);
        }
    }
    disconnect() {
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        this.ws?.close();
    }
}
//# sourceMappingURL=client.js.map