/**
 * Framework Adapter 接口
 * ----------------------------------------------------
 * 自研双适配器运行时热切换: agentai (主框架) / pulseflow (强注入防御配置)
 *
 * 设计:
 *   - **runtime 切换**: 不重启 Gateway, 仅换 active adapter
 *   - **统一接口**: 抹平两个适配器内部机制差异
 *   - **能力查询**: 调用方按能力而非框架名选 adapter (decoupling)
 */

import type { ChatMessage, ChatResponse } from '../llm-router.js';

export type FrameworkId = 'agentai' | 'pulseflow';

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
   */
  init(ctx: FrameworkContext): Promise<void>;

  /**
   * 跑一轮对话
   * 不同适配器走不同内部机制:
   *   - agentai: 会话消息累加 + tool_calls 解析
   *   - pulseflow: 4 段式提示 + 注入扫描
   */
  chat(messages: ChatMessage[], ctx: FrameworkContext): Promise<ChatResponse>;

  /**
   * 关闭: 框架被换下时调用
   */
  shutdown(): Promise<void>;

  /**
   * 健康检查
   */
  health(): Promise<{ ok: boolean; detail?: string }>;
}
