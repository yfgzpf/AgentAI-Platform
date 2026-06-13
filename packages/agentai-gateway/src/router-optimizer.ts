/**
 * 智能路由权重优化器 — 在 llm-router.ts 之上提供动态权重调整
 * 
 * 核心逻辑：
 * - 读取 tool-registry 历史 dispatch 数据 + knowledge-cache 中的 result_score
 * - 成功率高 + 成本低 + 延迟低 的 provider 权重上升
 * - 新模型灰度 Shadow Test（5% 流量，跑够统计显著性再切量）
 * - Circuit Breaker 增强：基于滑动窗口（最近 100 次）计算失败率
 * - 不修改 llm-router.ts，只提供装饰器式 upgrade
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Provider 健康度评分 */
export interface ProviderHealth {
  provider_id: string;
  total_requests: number;
  success_count: number;
  failure_count: number;
  success_rate: number;
  avg_latency_ms: number;
  avg_cost_per_request: number;
  current_weight: number; // 0-1, 路由权重
  circuit_breaker_open: boolean;
  sliding_window_failure_rate: number; // 最近 100 次
}

/** 灰度测试配置 */
export interface ShadowTestConfig {
  new_provider_id: string;
  shadow_traffic_percent: number; // 0-100, 默认 5
  min_samples_before_switch: number; // 默认 100
  min_success_rate_threshold: number; // 默认 0.9
  duration_minutes?: number;
}

/** 路由优化器状态 */
export interface RouterOptimizerState {
  providers: Record<string, ProviderHealth>;
  shadow_tests: ShadowTestConfig[];
  last_adjustment_at: string;
}

// ---------------------------------------------------------------------------
// RouterOptimizer
// ---------------------------------------------------------------------------

const WEIGHT_ADJUSTMENT_WINDOW = 100; // 滑动窗口大小
const CIRCUIT_BREAKER_FAILURE_RATE = 0.3; // 失败率 > 30% 熔断
const SHADOW_BASELINE_TRAFFIC = 5; // 灰度基准流量 5%

export class RouterOptimizer {
  private state: RouterOptimizerState;
  private requestHistory: Array<{
    provider_id: string;
    success: boolean;
    latency_ms: number;
    cost: number;
    timestamp: number;
  }>;

  constructor(initialState?: Partial<RouterOptimizerState>) {
    this.state = initialState ? {
      providers: initialState.providers ?? {},
      shadow_tests: initialState.shadow_tests ?? [],
      last_adjustment_at: initialState.last_adjustment_at ?? new Date().toISOString(),
    } : { providers: {}, shadow_tests: [], last_adjustment_at: new Date().toISOString() };
    this.requestHistory = [];
  }

  // ---- 数据录入 ----

  /** 记录一次请求结果（用于滑动窗口统计） */
  recordRequest(providerId: string, success: boolean, latencyMs: number, cost: number): void {
    this.requestHistory.push({
      provider_id: providerId,
      success,
      latency_ms: latencyMs,
      cost,
      timestamp: Date.now(),
    });

    // 维护历史长度
    if (this.requestHistory.length > 10000) {
      this.requestHistory = this.requestHistory.slice(-5000);
    }
  }

  /** 更新 Provider 的基础健康度数据 */
  updateProviderHealth(ph: ProviderHealth): void {
    this.state.providers[ph.provider_id] = ph;
  }

  /** 批量更新 */
  updateProviders(healthList: ProviderHealth[]): void {
    for (const ph of healthList) {
      this.state.providers[ph.provider_id] = ph;
    }
  }

  // ---- 权重调整 ----

  /**
   * 计算最优路由权重
   * 
   * 评分公式：score = w1 * success_rate * 100 + w2 * (1 - normalized_latency) * 50 - w3 * normalized_cost * 50
   * 其中 w1=0.5, w2=0.3, w3=0.2
   * 然后根据分数做 softmax 归一化得到权重
   */
  adjustWeights(options?: {
    w1?: number; // success rate weight
    w2?: number; // latency weight
    w3?: number; // cost weight
    force?: boolean; // 强制重新调整
  }): Record<string, number> {
    const w1 = options?.w1 ?? 0.5;
    const w2 = options?.w2 ?? 0.3;
    const w3 = options?.w3 ?? 0.2;

    const providers = Object.values(this.state.providers);
    if (providers.length === 0) return {};

    // 过滤掉熔断中的 provider
    const eligible = providers.filter((p) => !p.circuit_breaker_open);
    if (eligible.length === 0) return {};

    // 计算每个 provider 的 raw score
    const scores = eligible.map((p) => {
      const successScore = p.success_rate * 100;
      const latencyScore = Math.max(0, (1 - p.avg_latency_ms / 5000)) * 50; // 假设 5s 是最差延迟
      const costScore = Math.max(0, (1 - p.avg_cost_per_request / 1.0)) * 50; // 假设 $1 是最贵

      const total = w1 * successScore + w2 * latencyScore + w3 * costScore;
      return { provider_id: p.provider_id, rawScore: total, health: p };
    });

    // Softmax 归一化
    const maxScore = Math.max(...scores.map((s) => s.rawScore));
    let sumExp = 0;
    for (const s of scores) {
      // 防溢出
      const shifted = Math.exp(s.rawScore - maxScore) * 100;
      s.health.current_weight = shifted;
      sumExp += shifted;
    }

    // 归一化为 0-1
    const weights: Record<string, number> = {};
    for (const s of scores) {
      weights[s.provider_id] = parseFloat((s.health.current_weight / sumExp).toFixed(4));
    }

    this.state.last_adjustment_at = new Date().toISOString();

    // 更新 registry
    for (const s of scores) {
      s.health.current_weight = weights[s.provider_id] ?? 0;
      this.state.providers[s.provider_id] = s.health;
    }

    return weights;
  }

  // ---- Circuit Breaker 增强 ----

  /**
   * 检查指定 provider 是否需要熔断
   * 基于最近 WEIGHT_ADJUSTMENT_WINDOW 次请求的滑动窗口
   */
  getCircuitBreakerStatus(providerId: string): {
    is_open: boolean;
    failure_rate: number;
    window_size: number;
    recent_failures: number;
    recent_successes: number;
  } {
    const history = this._getRecentHistory(providerId);
    if (history.length === 0) {
      return { is_open: false, failure_rate: 0, window_size: 0, recent_failures: 0, recent_successes: 0 };
    }

    const recent = history.slice(-WEIGHT_ADJUSTMENT_WINDOW);
    const failures = recent.filter((r) => !r.success).length;
    const successes = recent.filter((r) => r.success).length;
    const failureRate = failures / recent.length;

    const isOpen = failureRate > CIRCUIT_BREAKER_FAILURE_RATE;

    return {
      is_open: isOpen,
      failure_rate: parseFloat(failureRate.toFixed(4)),
      window_size: recent.length,
      recent_failures: failures,
      recent_successes: successes,
    };
  }

  /** 自动熔断高失败率的 provider */
  autoFuse(): string[] {
    const providerIds = Object.keys(this.state.providers);
    const fuzed: string[] = [];

    for (const pid of providerIds) {
      const status = this.getCircuitBreakerStatus(pid);
      if (status.is_open && !this.state.providers[pid]?.circuit_breaker_open) {
        this.state.providers[pid] = {
          ...this.state.providers[pid]!,
          circuit_breaker_open: true,
        };
        fuzed.push(pid);
      }
    }

    return fuzed;
  }

  /** 解除熔断 */
  unFuse(providerId: string): boolean {
    const ph = this.state.providers[providerId];
    if (!ph) return false;

    const status = this.getCircuitBreakerStatus(providerId);
    if (!status.is_open) {
      ph.circuit_breaker_open = false;
      this.state.providers[providerId] = ph;
      return true;
    }
    return false;
  }

  // ---- Shadow Test 灰度路由 ----

  /** 启动一个灰度测试 */
  startShadowTest(config: ShadowTestConfig): ShadowTestConfig {
    // 检查新 provider 是否存在
    if (!this.state.providers[config.new_provider_id]) {
      throw new Error(`Provider ${config.new_provider_id} not found in registry`);
    }

    // 避免重复启动
    const existing = this.state.shadow_tests.find((st) => st.new_provider_id === config.new_provider_id);
    if (existing) {
      throw new Error(`Shadow test already running for ${config.new_provider_id}`);
    }

    const tc = {
      ...config,
      shadow_traffic_percent: config.shadow_traffic_percent ?? SHADOW_BASELINE_TRAFFIC,
      min_samples_before_switch: config.min_samples_before_switch ?? 100,
      min_success_rate_threshold: config.min_success_rate_threshold ?? 0.9,
    };
    this.state.shadow_tests.push(tc);
    return tc;
  }

  /** 检查灰度测试是否满足切换条件 */
  evaluateShadowTest(providerId: string): {
    ready_to_switch: boolean;
    current_samples: number;
    current_success_rate: number;
    shadow_percent: number;
  } {
    const shadow = this.state.shadow_tests.find((st) => st.new_provider_id === providerId);
    if (!shadow) {
      throw new Error(`No shadow test for ${providerId}`);
    }

    const history = this._getRecentHistory(providerId);
    const samples = history.length;
    const successes = history.filter((r) => r.success).length;
    const successRate = samples > 0 ? successes / samples : 0;

    const ready =
      samples >= shadow.min_samples_before_switch &&
      successRate >= shadow.min_success_rate_threshold;

    return {
      ready_to_switch: ready,
      current_samples: samples,
      current_success_rate: parseFloat(successRate.toFixed(4)),
      shadow_percent: shadow.shadow_traffic_percent,
    };
  }

  /** 停止灰度测试 */
  stopShadowTest(providerId: string): boolean {
    const idx = this.state.shadow_tests.findIndex((st) => st.new_provider_id === providerId);
    if (idx < 0) return false;
    this.state.shadow_tests.splice(idx, 1);
    return true;
  }

  /** 获取所有灰度测试状态 */
  getAllShadowTests(): Array<{
    config: ShadowTestConfig;
    status: {
      ready_to_switch: boolean;
      current_samples: number;
      current_success_rate: number;
      shadow_percent: number;
    };
  }> {
    return this.state.shadow_tests.map((st) => ({
      config: st,
      status: this.evaluateShadowTest(st.new_provider_id),
    }));
  }

  // ---- 快照与恢复 ----

  /** 获取优化器完整快照 */
  getState(): RouterOptimizerState {
    return { ...this.state, providers: { ...this.state.providers } };
  }

  /** 恢复快照 */
  restoreState(state: RouterOptimizerState): void {
    this.state = { ...state, providers: { ...state.providers } };
  }

  // ---- 内部辅助 ----

  /** 获取指定 provider 的请求历史（最近 1000 条） */
  private _getRecentHistory(providerId: string): Array<{
    success: boolean;
    latency_ms: number;
    cost: number;
    timestamp: number;
  }> {
    return this.requestHistory
      .filter((r) => r.provider_id === providerId)
      .slice(-1000)
      .map((r) => ({
        success: r.success,
        latency_ms: r.latency_ms,
        cost: r.cost,
        timestamp: r.timestamp,
      }));
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------
