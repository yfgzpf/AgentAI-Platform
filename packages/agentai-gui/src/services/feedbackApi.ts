/**
 * feedbackApi.ts — 用户反馈 API 客户端
 * =====================================
 * 包装 Gateway /api/monitoring/feedback/* 端点
 */
import { apiPost, apiGet, apiUrl } from './api';

export interface FeedbackPayload {
  sessionId: string;
  messageId: string;
  type: 'thumbs_up' | 'thumbs_down' | 'correction' | 'detailed';
  comment?: string;
  originalOutput?: { content: string; toolCalls?: string[]; model?: string; latency?: number };
  context?: { taskType?: string; workspace?: string; userId?: string };
}

export interface FeedbackStats {
  totalCount: number;
  thumbsUp: number;
  thumbsDown: number;
  correctionCount: number;
  detailedCount: number;
  averageRating: number;
  trend7d: { positive: number; negative: number; neutral: number };
  tagDistribution: Record<string, number>;
}

/**
 * 提交用户反馈到后端
 */
export async function submitFeedback(payload: FeedbackPayload): Promise<{ ok: boolean; id: string; timestamp: number }> {
  return apiPost('/api/monitoring/feedback/submit', payload);
}

/**
 * 获取反馈统计
 */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  return apiGet('/api/monitoring/feedback/stats');
}

/**
 * 获取最近反馈列表
 */
export async function getRecentFeedback(limit = 20): Promise<{ count: number; feedbacks: any[] }> {
  return apiGet(`/api/monitoring/feedback/recent?limit=${limit}`);
}