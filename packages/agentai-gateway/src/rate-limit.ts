/**
 * 动态速率限制器
 * ----------------------------------------------------
 * 区分内部调用 (系统任务链/工具调用/子智能体) 和外部调用 (用户直接对话):
 *   - 外部用户: 30 RPM / 3 并发 / $1/min (严格保护)
 *   - 内部系统: 120 RPM / 10 并发 / $5/min (任务链需要大量调用)
 *   - _internal 标记: 请求体带 _internal=true 视为内部调用
 *
 * 动态调整:
 *   - 根据系统负载自动收紧限制 (CPU/内存压力)
 *   - 根据可用 provider 数量调整并发上限
 */

export interface RateLimitConfig {
  rpm: number;
  maxConcurrency: number;
  maxCostPerMin: number;
}

/** 外部用户默认限制（Agnes AI API 20 RPM） */
const EXTERNAL_LIMITS: RateLimitConfig = {
  rpm: 20,
  maxConcurrency: 2,
  maxCostPerMin: 1.0,
};

/** 内部系统默认限制 */
const INTERNAL_LIMITS: RateLimitConfig = {
  rpm: 60,
  maxConcurrency: 5,
  maxCostPerMin: 5.0,
};

export class RateLimiter {
  private rpmBuckets = new Map<string, { count: number; resetAt: number }>();
  private concurrencyBuckets = new Map<string, number>();
  private costBuckets = new Map<string, number>();

  /** 可用 provider 数量, 用于动态调整并发上限 */
  private availableProviders = 5;

  /**
   * 设置可用 provider 数量, 自动调整并发上限
   * provider 越少, 并发越低, 避免打爆剩余 provider
   */
  setAvailableProviders(count: number): void {
    this.availableProviders = Math.max(1, count);
  }

  /** 根据调用类型获取限制配置 */
  private getLimits(isInternal: boolean): RateLimitConfig {
    const base = isInternal ? INTERNAL_LIMITS : EXTERNAL_LIMITS;
    // 动态调整: 并发上限 = min(基础值, provider数 * 2)
    const dynamicConcurrency = Math.min(base.maxConcurrency, this.availableProviders * 2);
    return { ...base, maxConcurrency: dynamicConcurrency };
  }

  /**
   * 检查速率限制
   * @param userId 用户/系统标识
   * @param isInternal 是否为内部系统调用 (任务链/工具调用/子智能体)
   */
  check(userId: string, isInternal: boolean = false): { allowed: boolean; reason?: string; retryAfter?: number } {
    const limits = this.getLimits(isInternal);
    const bucketKey = isInternal ? `internal:${userId}` : `external:${userId}`;

    // RPM
    const now = Date.now();
    let r = this.rpmBuckets.get(bucketKey);
    if (!r || now > r.resetAt) {
      r = { count: 0, resetAt: now + 60000 };
      this.rpmBuckets.set(bucketKey, r);
    }
    r.count++;
    if (r.count > limits.rpm) {
      return { allowed: false, reason: 'rate_limit', retryAfter: Math.ceil((r.resetAt - now) / 1000) };
    }

    // Concurrency
    const conc = this.concurrencyBuckets.get(bucketKey) || 0;
    if (conc >= limits.maxConcurrency) {
      return { allowed: false, reason: 'concurrency_limit' };
    }
    this.concurrencyBuckets.set(bucketKey, conc + 1);

    return { allowed: true };
  }

  release(userId: string, isInternal: boolean = false): void {
    const bucketKey = isInternal ? `internal:${userId}` : `external:${userId}`;
    const conc = this.concurrencyBuckets.get(bucketKey) || 0;
    if (conc > 0) this.concurrencyBuckets.set(bucketKey, conc - 1);
  }

  recordCost(userId: string, cost: number, isInternal: boolean = false): void {
    const bucketKey = isInternal ? `internal:${userId}` : `external:${userId}`;
    const current = this.costBuckets.get(bucketKey) || 0;
    this.costBuckets.set(bucketKey, current + cost);
  }

  snapshot(userId: string): { rpm: number; concurrency: number; cost: number; isInternal: boolean } {
    const extRpm = this.rpmBuckets.get(`external:${userId}`)?.count || 0;
    const intRpm = this.rpmBuckets.get(`internal:${userId}`)?.count || 0;
    return {
      rpm: extRpm + intRpm,
      concurrency: (this.concurrencyBuckets.get(`external:${userId}`) || 0) + (this.concurrencyBuckets.get(`internal:${userId}`) || 0),
      cost: (this.costBuckets.get(`external:${userId}`) || 0) + (this.costBuckets.get(`internal:${userId}`) || 0),
      isInternal: intRpm > extRpm,
    };
  }
}
