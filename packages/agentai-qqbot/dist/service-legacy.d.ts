/**
 * 旧版 go-cqhttp 兼容服务 (保留向后兼容)
 * 推荐迁移到 QQOfficialBot (官方 SDK)
 */
import { QQConfig } from './config.js';
export declare class QQBotService {
    private config;
    private client;
    private gateway;
    private goCq;
    constructor(config: QQConfig);
    start(): Promise<void>;
}
