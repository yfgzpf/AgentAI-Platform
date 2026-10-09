/**
 * AgentAI Platform - QQ Bot 独立包
 * -----------------------------------------------------------
 * 架构:
 *   QQBot → wss://api.sgroup.qq.com → 消息处理 → Gateway /v1/qq/message
 *
 * 消息处理:
 *   - 消息去重 (200条环形队列)
 *   - 分片发送 (1500字节/条)
 *   - 远程命令 (/help /new /abort 等)
 *   - 私聊/群@ 消息路由
 *   - 调用 gateway /v1/qq/message 完成 LLM 对话
 *
 * 启动方式:
 *   AGENTAI_QQ_APPID=xxx AGENTAI_QQ_SECRET=xxx pnpm --filter agentai-qqbot dev
 *
 * 环境变量:
 *   AGENTAI_QQ_APPID / AGENTAI_QQ_SECRET / AGENTAI_QQ_SANDBOX
 *   AGENTAI_QQ_GROUPS / AGENTAI_QQ_ADMINS / AGENTAI_QQ_TRIGGER
 *   AGENTAI_GATEWAY_URL (默认 http://127.0.0.1:18789)
 */
export declare function startDefault(): Promise<void>;
