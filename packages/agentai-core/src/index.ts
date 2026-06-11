/**
 * AgentAI Core — 核心类型定义
 * ----------------------------------------------------
 * 注意: 智能体运行时逻辑 (LLM 路由 / 工具注册 / 技能管理 / 记忆系统)
 * 全部实现在 @agentai/gateway 中。
 *
 * 本模块保留给未来的可复用核心类型和纯函数，
 * 供 gateway / gui / qqbot / desktop 等包共享引用。
 *
 * 当前仅导出基础接口定义。
 */

export const CORE_VERSION = '0.2.0-alpha';

/** 框架标识 */
export type FrameworkId = 'openclaw' | 'hermes' | 'reasonix';

/** 模型标识 */
export type ModelId = 'agentai' | 'deepseek' | 'openai';

/** 基础消息结构 */
export interface CoreMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];
}

/** 工具定义 (OpenAI 兼容) */
export interface CoreTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
