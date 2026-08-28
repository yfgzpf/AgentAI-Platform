/**
 * useUsageStats — 用量统计 Hook
 * ----------------------------------------------------
 * 收集对话/生图/生视频的 token 用量和成本，按日/月聚合
 */
import { useState, useEffect, useCallback } from 'react';

interface UsageStats {
  tokensToday: number;
  tokensMonth: number;
  costToday: number;
  costMonth: number;
  callsToday: number;
  callsMonth: number;
  imagesGenerated: number;
  lastUpdated: number;
}

const STORAGE_KEY = 'agentai-usage-stats';

const defaultStats: UsageStats = {
  tokensToday: 0,
  tokensMonth: 0,
  costToday: 0,
  costMonth: 0,
  callsToday: 0,
  callsMonth: 0,
  imagesGenerated: 0,
  lastUpdated: 0,
};

export function useUsageStats() {
  const [stats, setStats] = useState<UsageStats>(defaultStats);
  const [loaded, setLoaded] = useState(false);

  // 保存到 localStorage
  const saveStats = useCallback((newStats: UsageStats) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newStats));
    } catch (e) {
      console.error('[useUsageStats] save error:', e);
    }
  }, []);

  // 添加用量
  const addUsage = useCallback((params: {
    tokens?: number;
    cost?: number;
    isImage?: boolean;
  }) => {
    setStats(prev => {
      const updated: UsageStats = {
        ...prev,
        tokensToday: prev.tokensToday + (params.tokens || 0),
        tokensMonth: prev.tokensMonth + (params.tokens || 0),
        costToday: prev.costToday + (params.cost || 0),
        costMonth: prev.costMonth + (params.cost || 0),
        callsToday: prev.callsToday + 1,
        callsMonth: prev.callsMonth + 1,
        imagesGenerated: prev.imagesGenerated + (params.isImage ? 1 : 0),
        lastUpdated: Date.now(),
      };
      saveStats(updated);
      return updated;
    });
  }, [saveStats]);

  // 重置统计
  const resetStats = useCallback(() => {
    setStats(defaultStats);
    saveStats(defaultStats);
  }, [saveStats]);

  // 格式化显示
  const formatTokens = useCallback((n: number): string => {
    if (n < 1000) return `${n}`;
    if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
    return `${(n / 1000000).toFixed(1)}M`;
  }, []);

  const formatCost = useCallback((n: number): string => {
    if (n < 0.01) return '¥0.00';
    if (n < 1) return `¥${n.toFixed(3)}`;
    return `¥${n.toFixed(2)}`;
  }, []);

  // 从 localStorage 加载
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: UsageStats = JSON.parse(raw);
        const now = new Date();
        const lastDate = new Date(parsed.lastUpdated);

        // 新的一天，重置日统计
        if (now.toDateString() !== lastDate.toDateString()) {
          parsed.tokensToday = 0;
          parsed.costToday = 0;
          parsed.callsToday = 0;
        }

        // 新的月份，重置月度统计
        if (now.getMonth() !== lastDate.getMonth() ||
          now.getFullYear() !== lastDate.getFullYear()) {
          parsed.tokensMonth = 0;
          parsed.costMonth = 0;
          parsed.callsMonth = 0;
          parsed.imagesGenerated = 0;
        }

        setStats({ ...defaultStats, ...parsed });
      }
    } catch (e) {
      console.error('[useUsageStats] load error:', e);
    }
    setLoaded(true);
  }, []);

  // 监听用量更新事件
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent;
      const { tokens, cost, isImage } = ce.detail || {};
      if (tokens || cost) {
        addUsage({ tokens, cost, isImage });
      }
    };
    window.addEventListener('agentai:usage-update', handler);
    return () => window.removeEventListener('agentai:usage-update', handler);
  }, [addUsage]);

  return { stats, addUsage, resetStats, loaded, formatTokens, formatCost };
}

export type { UsageStats };
