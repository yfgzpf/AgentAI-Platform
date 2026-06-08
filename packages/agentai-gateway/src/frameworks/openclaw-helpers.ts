/**
 * OpenClaw adapter 辅助函数
 * ----------------------------------------------------
 * 抽离出注入扫描 / 成本计算, 让 OpenClaw 和 Hermes 复用同一套
 */

import type { ChatMessage } from '../llm-router.js';
import { scanPromptInjection, type ScanResult } from '../llm-router.js';

export { scanPromptInjection };
export type { ScanResult };

/**
 * 简化 usage 计算 (真实数据由 LLM provider 返回)
 */
export function computeUsage(_provider: string, _content: string): {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  cacheHit: boolean;
} {
  // 简化估算: 1 字符 ≈ 0.5 token
  return {
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    cacheHit: false,
  };
}

/**
 * 扫描 ChatMessage 数组 (兼容多层 content)
 */
export function scanMessages(messages: ChatMessage[]): ScanResult {
  const allThreats: ScanResult['threats'] = [];
  for (const m of messages) {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const r = scanPromptInjection(content);
    allThreats.push(...r.threats);
  }
  return { safe: allThreats.length === 0, threats: allThreats };
}
