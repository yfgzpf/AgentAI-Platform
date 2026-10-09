/**
 * QQ 客户端 - 反向 WebSocket 接收 + HTTP API 发送
 * -----------------------------------------------------------
 * 协议: go-cqhttp 1.0+ 的 "正向 WebSocket" / "反向 WebSocket" 都支持
 * 我们用反向 WS (go-cqhttp 连我们) - 更稳, 不用暴露端口
 */
import { EventEmitter } from 'events';
import { GatewayProxy } from './gateway-proxy.js';
export interface CQMessage {
    /** 消息 ID */
    message_id: number;
    /** 消息类型 group/private */
    message_type: 'group' | 'private';
    /** 发送者 QQ */
    user_id: number;
    /** 群号 (群消息) */
    group_id?: number;
    /** 消息内容 (CQ 码) */
    raw_message: string;
    /** 纯文本消息 (去掉 CQ 码) */
    message: string;
    /** 发送者昵称 */
    sender: {
        user_id: number;
        nickname: string;
        card?: string;
    };
    /** 时间戳 */
    time: number;
    /** 机器人自己的 QQ (用于过滤) */
    self_id: number;
}
export interface QQClientOpts {
    triggerPrefix: string;
    allowedGroups: number[];
    adminQQ: number[];
}
export declare class QQClient extends EventEmitter {
    private gateway;
    private opts;
    private ws;
    private httpApi;
    private reconnectTimer;
    private connected;
    constructor(gateway: GatewayProxy, opts: QQClientOpts);
    /** 连反向 WS, go-cqhttp 主动连入 */
    connect(reverseWsUrl: string): Promise<void>;
    private scheduleReconnect;
    private handleFrame;
    /** 通过 go-cqhttp HTTP API 发送消息 */
    private sendMessage;
    disconnect(): void;
}
