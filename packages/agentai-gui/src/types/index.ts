/**
 * 全局类型定义
 */

/** 聚合平台 Provider 信息 */
export interface ProviderInfo {
  name: string;
  hasKey: boolean;
  tripped: boolean;
  modelCount: number;
  isPaid: boolean;
  bestAvailableModel: string | null;
}

/** 持久化存储格式 */
export interface PersistedModelState {
  models?: Array<{
    id: string;
    label: string;
    enabled?: boolean;
    isBuiltIn?: boolean;
    provider?: string;
    groupLabel?: string;
    [key: string]: unknown;
  }>;
  chatMode?: 'chat' | 'image_edit';
  activeModelId?: string;
  commercialKeys?: Record<string, string>;
}

/** Token 用量信息 */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  cacheHit?: boolean;
  source?: 'api' | 'estimated';
}

/** Chat 消息段类型 */
export type ChatSegment =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; callId: string; name: string; args?: Record<string, unknown>; state?: string; result?: string; ok?: boolean; durationMs?: number }
  | { kind: 'image'; url?: string; base64?: string; alt?: string; filePath?: string }
  | { kind: 'error'; error: string; details?: string; fix?: string }
  | { kind: 'video'; url: string; poster?: string; alt?: string }
  | { kind: 'widget'; title: string; contentType: 'svg' | 'html'; content: string; width?: number | null; height?: number | null };

/** 消息状态 */
export type MessageStatus = 'sending' | 'sent' | 'received' | 'processing' | 'done' | 'error';

/** 聊天消息 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  segments: ChatSegment[];
  ts: number;
  provider?: string;
  framework?: string;
  streaming?: boolean;
  status?: MessageStatus;
  usage?: TokenUsage | null;
}
