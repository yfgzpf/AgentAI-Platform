/**
 * QQ 官方机器人 SDK
 * ----------------------------------------------------
 * 只做 3 件事:
 *   1. Token 管理
 *   2. WebSocket 连接 (鉴权/心跳/重连)
 *   3. 事件分发 (message.private / message.group / online / bot_error)
 *
 * 协议: QQ Bot API v2 (QQ群机器人)
 * 参照: QQ 开放平台文档
 */
import { EventEmitter } from 'node:events';
export interface QQBotConfig {
    appid: string;
    secret: string;
    sandbox?: boolean;
}
export interface C2CMessage {
    author: {
        user_openid: string;
    };
    content: string;
    id: string;
    timestamp: string;
}
export interface GroupMessage {
    author: {
        member_openid: string;
    };
    content: string;
    id: string;
    timestamp: string;
    group_openid: string;
}
export declare class QQBot extends EventEmitter {
    private config;
    private token;
    private tokenExpiresAt;
    private ws;
    private heartbeatTimer;
    private seq;
    private sessionId;
    private closed;
    private readyReceived;
    constructor(config: QQBotConfig);
    private get baseUrl();
    private sanitizeHeartbeatInterval;
    private validateGatewayUrl;
    private ensureToken;
    private getGateway;
    private sendOp;
    private handlePayload;
    private reconnect;
    private cleanup;
    private connect;
    start(): Promise<void>;
    stop(): Promise<void>;
    sendPrivateMessage(openid: string, content: string, msgId?: string, msgSeq?: number): Promise<void>;
    sendGroupMessage(groupOpenid: string, content: string, msgId?: string, msgSeq?: number): Promise<void>;
}
export declare function splitQQMessage(text: string, maxBytes?: number): string[];
