/**
 * useModelMetrics - 模型性能指标 Hook
 * =====================================
 * Phase 3: 模型选择器对比
 * 获取各模型的平均性能指标，用于在模型选择器中显示
 */

import { useState, useEffect, useCallback } from 'react';

export interface ModelMetrics {
  modelId: string;
  provider: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgTTFT: number;
  avgLatency: number;
  avgCost: number;
  totalCost: number;
  successRate: number;
  lastCallAt: number;
}

interface UseModelMetricsReturn {
  metrics: ModelMetrics[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  getModelMetrics: (modelId: string) => ModelMetrics | undefined;
}

export function useModelMetrics(): UseModelMetricsReturn {
  const [metrics, setMetrics] = useState<ModelMetrics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/v1/metrics/models');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (data.ok && Array.isArray(data.models)) {
        setMetrics(data.models);
      } else {
        throw new Error(data.error || 'Invalid response');
      }
    } catch (err: any) {
      console.error('[useModelMetrics] fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    // 每30秒自动刷新
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const getModelMetrics = useCallback((modelId: string) => {
    return metrics.find(m => m.modelId === modelId);
  }, [metrics]);

  return {
    metrics,
    loading,
    error,
    refresh: fetchMetrics,
    getModelMetrics,
  };
}
