import { describe, it, expect } from 'vitest';
import { RouterOptimizer, type ProviderHealth } from './router-optimizer';

describe('RouterOptimizer', () => {
  it('should record requests and track history', () => {
    const optimizer = new RouterOptimizer();
    optimizer.recordRequest('gpt-4', true, 500, 0.01);
    optimizer.recordRequest('gpt-3.5', false, 200, 0.001);
    optimizer.recordRequest('gpt-4', true, 600, 0.012);

    const status = optimizer.getCircuitBreakerStatus('gpt-4');
    expect(status.window_size).toBe(2);
    expect(status.recent_successes).toBe(2);
    expect(status.recent_failures).toBe(0);
    expect(status.failure_rate).toBe(0);
  });

  it('should update provider health and adjust weights', () => {
    const optimizer = new RouterOptimizer();
    optimizer.updateProviders([
      {
        provider_id: 'fast-model',
        total_requests: 100,
        success_count: 95,
        failure_count: 5,
        success_rate: 0.95,
        avg_latency_ms: 300,
        avg_cost_per_request: 0.01,
        current_weight: 0.5,
        circuit_breaker_open: false,
        sliding_window_failure_rate: 0.03,
      },
      {
        provider_id: 'slow-model',
        total_requests: 50,
        success_count: 40,
        failure_count: 10,
        success_rate: 0.8,
        avg_latency_ms: 2000,
        avg_cost_per_request: 0.05,
        current_weight: 0.5,
        circuit_breaker_open: false,
        sliding_window_failure_rate: 0.15,
      },
    ]);

    const weights = optimizer.adjustWeights();
    expect(weights['fast-model']).toBeDefined();
    expect(weights['slow-model']).toBeDefined();
    expect(weights['fast-model']!).toBeGreaterThan(weights['slow-model']!);
  });

  it('should fuse circuit breaker when failure rate > 30%', () => {
    const optimizer = new RouterOptimizer();
    // 注入 5 次请求：3 次失败，2 次成功 = 60% 失败率
    for (let i = 0; i < 3; i++) {
      optimizer.recordRequest('bad-provider', false, 1000, 0.1);
    }
    for (let i = 0; i < 2; i++) {
      optimizer.recordRequest('bad-provider', true, 500, 0.01);
    }

    // 确保 provider 在 registry 中
    optimizer.updateProviders([{
      provider_id: 'bad-provider',
      total_requests: 5, success_count: 2, failure_count: 3,
      success_rate: 0.4, avg_latency_ms: 1000, avg_cost_per_request: 0.1,
      current_weight: 0.2, circuit_breaker_open: false, sliding_window_failure_rate: 0.6,
    }]);

    const fuzed = optimizer.autoFuse();
    expect(fuzed).toContain('bad-provider');
    expect(optimizer.getCircuitBreakerStatus('bad-provider').is_open).toBe(true);
  });

  it('should not fuse when failure rate is low', () => {
    const optimizer = new RouterOptimizer();
    for (let i = 0; i < 10; i++) {
      optimizer.recordRequest('good-provider', true, 200, 0.01);
    }
    optimizer.updateProviders([{
      provider_id: 'good-provider',
      total_requests: 10, success_count: 10, failure_count: 0,
      success_rate: 1.0, avg_latency_ms: 200, avg_cost_per_request: 0.01,
      current_weight: 0.8, circuit_breaker_open: false, sliding_window_failure_rate: 0,
    }]);

    const fuzed = optimizer.autoFuse();
    expect(fuzed).not.toContain('good-provider');
  });

  it('should start shadow test and evaluate progress', () => {
    const optimizer = new RouterOptimizer();
    optimizer.updateProviders([{
      provider_id: 'new-model',
      total_requests: 0, success_count: 0, failure_count: 0,
      success_rate: 0, avg_latency_ms: 0, avg_cost_per_request: 0,
      current_weight: 0, circuit_breaker_open: false, sliding_window_failure_rate: 0,
    }]);

    optimizer.startShadowTest({
      new_provider_id: 'new-model',
      shadow_traffic_percent: 5,
      min_samples_before_switch: 10,
      min_success_rate_threshold: 0.8,
    });

    // 注入 5 次请求（不足 10 样本）
    for (let i = 0; i < 5; i++) {
      optimizer.recordRequest('new-model', true, 300, 0.005);
    }

    const result = optimizer.evaluateShadowTest('new-model');
    expect(result.ready_to_switch).toBe(false);
    expect(result.current_samples).toBe(5);
    expect(result.current_success_rate).toBe(1);
    expect(result.shadow_percent).toBe(5);
  });

  it('should allow switching after shadow test passes', () => {
    const optimizer = new RouterOptimizer();
    optimizer.updateProviders([{
      provider_id: 'new-model',
      total_requests: 20, success_count: 19, failure_count: 1,
      success_rate: 0.95, avg_latency_ms: 250, avg_cost_per_request: 0.008,
      current_weight: 0.05, circuit_breaker_open: false, sliding_window_failure_rate: 0.05,
    }]);

    optimizer.startShadowTest({
      new_provider_id: 'new-model',
      shadow_traffic_percent: 5,
      min_samples_before_switch: 10,
      min_success_rate_threshold: 0.9,
    });

    // 注入足够请求达到 >= 10 样本
    for (let i = 0; i < 10; i++) {
      optimizer.recordRequest('new-model', true, 250, 0.008);
    }

    const result = optimizer.evaluateShadowTest('new-model');
    expect(result.ready_to_switch).toBe(true);
    expect(result.current_samples).toBeGreaterThanOrEqual(10);
    expect(result.current_success_rate).toBeCloseTo(1);
  });

  it('should un-fuse after cooldown', () => {
    const optimizer = new RouterOptimizer();
    optimizer.updateProviders([{
      provider_id: 'fused-provider',
      total_requests: 10, success_count: 2, failure_count: 8,
      success_rate: 0.2, avg_latency_ms: 3000, avg_cost_per_request: 0.5,
      current_weight: 0, circuit_breaker_open: true, sliding_window_failure_rate: 0.8,
    }]);

    // 注入好的请求来恢复
    for (let i = 0; i < 10; i++) {
      optimizer.recordRequest('fused-provider', true, 200, 0.01);
    }

    // 不熔断，但 circuit_breaker_open 仍为 true
    const unFused = optimizer.unFuse('fused-provider');
    // 因为滑动窗口最近 100 次都是成功的，failure_rate = 0
    expect(unFused).toBe(true);
    const status = optimizer.getCircuitBreakerStatus('fused-provider');
    expect(status.is_open).toBe(false);
  });
});
