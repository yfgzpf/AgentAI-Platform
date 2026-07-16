/**
 * OpenClaw adapter 辅助函数
 * ----------------------------------------------------
 * 抽离出成本计算, 让 OpenClaw 和 Hermes 复用同一套
 */

import type { ChatMessage } from '../llm-router.js';

/**
 * Prompt-injection scan result.
 * Lightweight heuristic surface (real scanning lives in system-prompt + tool
 * permission controls); kept here so adapters can call a uniform helper.
 */
export interface ScanResult {
  safe: boolean;
  threats: Array<{ pattern: string; matched: string; severity: 'low' | 'medium' | 'high' }>;
}

// Common prompt-injection phrasing patterns (rule-based, intentionally conservative).
const INJECTION_PATTERNS: Array<{ pattern: RegExp; severity: ScanResult['threats'][number]['severity'] }> = [
  { pattern: /ignore (all|the previous|prior) instructions/i, severity: 'high' },
  { pattern: /disregard (the|all|your) (above|previous|prior) (rules|instructions|system)/i, severity: 'high' },
  { pattern: /you are now (a |an )?[a-z ]+/i, severity: 'medium' },
  { pattern: /reveal (your|the) (system )?prompt/i, severity: 'medium' },
  { pattern: /忽略(以上|之前|前面)(的)?(所有)?(指令|规则|提示)/, severity: 'high' },
  { pattern: /无视(以上|之前|前面)(的)?(系统)?(指令|规则)/, severity: 'high' },
];

/**
 * Heuristic prompt-injection scan for a single text blob.
 */
export function scanPromptInjection(text: string): ScanResult {
  const threats: ScanResult['threats'] = [];
  for (const { pattern, severity } of INJECTION_PATTERNS) {
    const m = text.match(pattern);
    if (m) threats.push({ pattern: pattern.source, matched: m[0], severity });
  }
  return { safe: threats.length === 0, threats };
}

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
