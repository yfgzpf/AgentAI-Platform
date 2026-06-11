export class RateLimiter {
  private rpmBuckets = new Map<string, { count: number; resetAt: number }>();
  private concurrencyBuckets = new Map<string, number>();
  private costBuckets = new Map<string, number>();

  constructor(
    private rpm: number = 30,
    private maxConcurrency: number = 3,
    private maxCostPerMin: number = 1.0,
  ) {}

  check(userId: string): { allowed: boolean; reason?: string; retryAfter?: number } {
    // RPM
    const now = Date.now();
    let r = this.rpmBuckets.get(userId);
    if (!r || now > r.resetAt) {
      r = { count: 0, resetAt: now + 60000 };
      this.rpmBuckets.set(userId, r);
    }
    r.count++;
    if (r.count > this.rpm) {
      return { allowed: false, reason: 'rate_limit', retryAfter: Math.ceil((r.resetAt - now) / 1000) };
    }

    // Concurrency
    const conc = this.concurrencyBuckets.get(userId) || 0;
    if (conc >= this.maxConcurrency) {
      return { allowed: false, reason: 'concurrency_limit' };
    }
    this.concurrencyBuckets.set(userId, conc + 1);

    return { allowed: true };
  }

  release(userId: string): void {
    const conc = this.concurrencyBuckets.get(userId) || 0;
    if (conc > 0) this.concurrencyBuckets.set(userId, conc - 1);
  }

  recordCost(userId: string, cost: number): void {
    const current = this.costBuckets.get(userId) || 0;
    this.costBuckets.set(userId, current + cost);
  }

  snapshot(userId: string): { rpm: number; concurrency: number; cost: number } {
    return {
      rpm: this.rpmBuckets.get(userId)?.count || 0,
      concurrency: this.concurrencyBuckets.get(userId) || 0,
      cost: this.costBuckets.get(userId) || 0,
    };
  }
}
