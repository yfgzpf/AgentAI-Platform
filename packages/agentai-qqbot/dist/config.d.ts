export interface QQConfig {
    /** Gateway HTTP 地址, 用于调 /v1/qq/message */
    gatewayUrl: string;
    /** 触发前缀, 例如 "@bot " (留空 = 群内所有消息) */
    triggerPrefix: string;
    /** 允许的群号列表, 留空 = 所有群 */
    allowedGroups: number[];
    /** 管理员 QQ 号 (可执行管理命令) */
    adminQQ: number[];
    /** 离线时是否继续运行 */
    allowOffline: boolean;
    /** go-cqhttp 子进程配置 */
    goCqHttp: {
        autoStart: boolean;
        /** 子进程可执行路径 */
        binaryPath: string;
        /** 配置文件路径 */
        configPath: string;
        /** 反向 WebSocket 地址 (本包监听 go-cqhttp 连入) */
        reverseWsUrl: string;
        /** go-cqhttp HTTP API 地址 (本包调它发消息) */
        httpApiUrl: string;
        /** QQ 账号 */
        qq: number;
        /** QQ 密码 (不推荐明文, 建议扫码) */
        password?: string;
    };
}
export declare const QQConfig: {
    load(): QQConfig;
};
