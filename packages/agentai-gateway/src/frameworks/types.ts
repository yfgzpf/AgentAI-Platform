/**
 * Framework Adapter 接口
 * ----------------------------------------------------
 * 设计目的: 让 OpenClaw 和 Hermes 两个框架能在运行时热切换
 *
 * 学自:
 *   - Hermes smart_model_routing.py (可插拔 provider 思路)
 *   - ZhiY.AI zhiy-agent-core.ts (多智能体角色注册)
 * 自创:
 *   - **runtime 切换**: 不重启 Gateway, 仅换 active adapter
 *   - **统一接口**: 抹平 OpenClaw AgentSession 和 Hermes AIAgent 的差异
 *
 * @see docs/INTEGRATION_ARCHITECTURE.md 第 5 节
 */

import type { ChatMessage, ChatResponse } from '../llm-router.js';

export type FrameworkId = 'openclaw' | 'hermes';

export interface FrameworkCapabilities {
  /** 是否支持 parallel tool dispatch */
  parallelTools: boolean;
  /** 是否支持 skills 热加载 */
  hotReloadSkills: boolean;
  /** 是否支持多智能体编排 */
  multiAgent: boolean;
  /** 是否支持 FTS5 会话 */
  fts5Session: boolean;
  /** 是否支持中文注入扫描 */
  chineseInjectionScan: boolean;
  /** 默认 provider */
  defaultProvider: 'agentai' | 'deepseek' | 'openai';
}

export interface FrameworkContext {
  userId: string;
  workspace: string;
  abortSignal?: AbortSignal;
  /** 共享的三层记忆 (workspace + user) */
  memory?: {
    recall: (limit?: number) => Promise<Array<{ role: string; content: string }>>;
  };
  /** 工具列表 (来自 tool-registry) */
  tools?: Array<{ name: string; description: string; parameters: any }>;
}

export interface FrameworkAdapter {
  /** 框架 ID */
  readonly id: FrameworkId;
  /** 框架名 (中文, 给人看) */
  readonly displayName: string;
  /** 框架版本 (来自原仓库) */
  readonly version: string;
  /** 能力清单 */
  readonly capabilities: FrameworkCapabilities;

  /**
   * 初始化: 框架被激活时调用
   * 学 Hermes AIAgent.__init__ + ZhiY zhiy-agent-core new AgentSession
   */
  init(ctx: FrameworkContext): Promise<void>;

  /**
   * 跑一轮对话
   * 不同框架走不同内部机制:
   *   - OpenClaw: AgentSession.messages 累加 + tool_calls 解析
   *   - Hermes:  AIAgent.chat() with tool dispatcher
   */
  chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse>;

  /**
   * 关闭: 框架被换下时调用
   * 学 ZhiY AgentSession 销毁
   */
  shutdown(): Promise<void>;

  /**
   * 健康检查
   */
  health(): Promise<{ ok: boolean; detail?: string }>;
}
