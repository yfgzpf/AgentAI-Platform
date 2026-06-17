// @ts-nocheck
/**
 * 速率限制监控器 (RateLimiter)
 * ----------------------------------------------------
 * 智能控制每个模型的请求速率，避免触发API提供商的限流机制。
 * 
 * 核心能力:
 *   - 实时监控每个模型的请求次数（RPM/TPM）
 *   - 动态计算剩余可用配额
 *   - 智能分配任务到可用模型
 *   - 自动降级到速率限制宽松的模型
 * 
 * @example
 * const limiter = new RateLimiter();
 * limiter.recordRequest('zhipu', 1000); // 记录请求
 * const available = limiter.getAvailableModels(); // 获取可用模型
 * const bestModel = limiter.selectBestModel(taskComplexity); // 选择最佳模型
 */

export interface RateLimitConfig {
  provider: string;
  /** 每分钟最大请求数 (Requests Per Minute) */
  rpm: number;
  /** 每分钟最大token数 (Tokens Per Minute) */
  tpm: number;
  /** 每小时最大请求数 */
  rph?: number;
  /** 每天最大请求数 */
  rpd?: number;
  /** 重置时间（秒） */
  resetAfter?: number;
}

export interface UsageRecord {
  provider: string;
  timestamp: number;
  tokens: number;
  success: boolean;
}

export interface ProviderStatus {
  provider: string;
  currentRpm: number;
  currentTpm: number;
  remainingRpm: number;
  remainingTpm: number;
  isAvailable: boolean;
  resetIn?: number;
}

/**
 * 默认速率限制配置（根据各API提供商的官方文档）
 */
const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  zhipu: {
    provider: 'zhipu',
    rpm: 60, // 智谱API: 60 RPM（免费版）
    tpm: 60000, // 60K TPM
    rph: 3600, // 3600 RPH
    resetAfter: 60, // 60秒后重置
  },
  agentai: {
    provider: 'agentai',
    rpm: 30, // Agnes AI: 30 RPM（免费版）
    tpm: 30000,
    rph: 1800,
    resetAfter: 60,
  },
  deepseek: {
    provider: 'deepseek',
    rpm: 100, // DeepSeek: 100 RPM（付费版）
    tpm: 100000,
    rph: 6000,
    resetAfter: 60,
  },
  cline: {
    provider: 'cline',
    rpm: 50, // Cline.bot: 50 RPM（免费版）
    tpm: 50000,
    rph: 3000,
    resetAfter: 60,
  },
  openai: {
    provider: 'openai',
    rpm: 500, // OpenAI: 500 RPM（付费版）
    tpm: 200000,
    rph: 30000,
    resetAfter: 60,
  },
};

export class RateLimiter {
  private usageRecords: UsageRecord[] = [];
  private rateLimits: Record<string, RateLimitConfig>;
  private lastCleanup: number = Date.now();

  constructor(customLimits?: Record<string, RateLimitConfig>) {
    this.rateLimits = { ...DEFAULT_RATE_LIMITS, ...customLimits };
  }

  /**
   * 记录一次API请求
   * @param provider - 提供商名称
   * @param tokens - 本次请求消耗的token数
   * @param success - 是否成功
   */
  recordRequest(provider: string, tokens: number, success: boolean = true): void {
    this.usageRecords.push({
      provider,
      timestamp: Date.now(),
      tokens,
      success,
    });

    // 每5分钟清理一次过期记录
    if (Date.now() - this.lastCleanup > 5 * 60 * 1000) {
      this.cleanupOldRecords();
      this.lastCleanup = Date.now();
    }
  }

  /**
   * 获取某个提供商的当前状态
   */
  getProviderStatus(provider: string): ProviderStatus {
    const config = this.rateLimits[provider];
    if (!config) {
      return {
        provider,
        currentRpm: 0,
        currentTpm: 0,
        remainingRpm: 0,
        remainingTpm: 0,
        isAvailable: false,
      };
    }

    // 计算最近1分钟的请求次数
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentRecords = this.usageRecords.filter(
      r => r.provider === provider && r.timestamp >= oneMinuteAgo
    );

    const currentRpm = recentRecords.length;
    const currentTpm = recentRecords.reduce((sum, r) => sum + r.tokens, 0);

    const remainingRpm = Math.max(0, config.rpm - currentRpm);
    const remainingTpm = Math.max(0, config.tpm - currentTpm);

    // 判断是否可用（剩余配额 > 10%）
    const isAvailable = remainingRpm > config.rpm * 0.1 && remainingTpm > config.tpm * 0.1;

    return {
      provider,
      currentRpm,
      currentTpm,
      remainingRpm,
      remainingTpm,
      isAvailable,
      resetIn: config.resetAfter,
    };
  }

  /**
   * 获取所有可用模型（按剩余配额排序）
   */
  getAvailableModels(): ProviderStatus[] {
    const providers = Object.keys(this.rateLimits);
    const statuses = providers.map(p => this.getProviderStatus(p));
    
    // 过滤可用模型，按剩余配额排序（优先使用配额多的）
    return statuses
      .filter(s => s.isAvailable)
      .sort((a, b) => {
        // 优先选择剩余RPM多的
        if (a.remainingRpm !== b.remainingRpm) {
          return b.remainingRpm - a.remainingRpm;
        }
        // 其次选择剩余TPM多的
        return b.remainingTpm - a.remainingTpm;
      });
  }

  /**
   * 智能选择最佳模型（根据任务复杂度和剩余配额）
   * @param estimatedTokens - 预估本次任务需要的token数
   * @param preferredProvider - 用户偏好的提供商（可选）
   */
  selectBestModel(estimatedTokens: number, preferredProvider?: string): string | null {
    const availableModels = this.getAvailableModels();
    
    if (availableModels.length === 0) {
      console.warn('[rate-limiter] 所有模型都达到速率限制，建议等待或使用备用方案');
      return null;
    }

    // 如果用户指定了偏好提供商，且该提供商可用，优先使用
    if (preferredProvider) {
      const preferred = availableModels.find(s => s.provider === preferredProvider);
      if (preferred && preferred.remainingTpm >= estimatedTokens) {
        return preferred.provider;
      }
    }

    // 选择剩余TPM足够且剩余RPM最多的模型
    const suitableModels = availableModels.filter(s => s.remainingTpm >= estimatedTokens);
    
    if (suitableModels.length === 0) {
      // 没有足够TPM的模型，选择剩余TPM最多的（可能需要降级处理）
      console.warn(`[rate-limiter] 没有模型有足够TPM(${estimatedTokens})，选择剩余最多的`);
      return availableModels[0]?.provider || null;
    }

    return suitableModels[0].provider;
  }

  /**
   * 预测某个模型是否可以处理任务
   */
  canHandleRequest(provider: string, estimatedTokens: number): boolean {
    const status = this.getProviderStatus(provider);
    return status.isAvailable && status.remainingTpm >= estimatedTokens;
  }

  /**
   * 获取所有模型的状态摘要（用于监控和日志）
   */
  getStatusSummary(): string {
    const providers = Object.keys(this.rateLimits);
    const lines = providers.map(p => {
      const status = this.getProviderStatus(p);
      const usagePercent = Math.round((status.currentRpm / this.rateLimits[p].rpm) * 100);
      return `${p}: ${status.currentRpm}/${this.rateLimits[p].rpm} RPM (${usagePercent}%) - ${status.isAvailable ? '✅可用' : '❌限流'}`;
    });
    return lines.join('\n');
  }

  /**
   * 清理过期记录（保留最近5分钟）
   */
  private cleanupOldRecords(): void {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    this.usageRecords = this.usageRecords.filter(r => r.timestamp >= fiveMinutesAgo);
    console.log(`[rate-limiter] 清理过期记录，当前记录数: ${this.usageRecords.length}`);
  }

  /**
   * 更新速率限制配置（动态调整）
   */
  updateRateLimit(provider: string, config: Partial<RateLimitConfig>): void {
    this.rateLimits[provider] = { ...this.rateLimits[provider], ...config };
    console.log(`[rate-limiter] 更新${provider}速率限制: RPM=${config.rpm}, TPM=${config.tpm}`);
  }

  /**
   * 重置某个提供商的速率限制（手动恢复）
   */
  resetProvider(provider: string): void {
    // 清除该提供商的所有记录
    this.usageRecords = this.usageRecords.filter(r => r.provider !== provider);
    console.log(`[rate-limiter] 重置${provider}速率限制，已清除所有记录`);
  }
}

/**
 * 全局速率限制器实例
 */
export const globalRateLimiter = new RateLimiter();