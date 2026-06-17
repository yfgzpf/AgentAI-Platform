// @ts-nocheck
/**
 * 智能模型切换处理器 — AI自主决策何时切换到商用API
 *
 * 核心能力：
 * 1. 监控免费模型速率限制状态
 * 2. 当速率限制触发时，自动切换到商用API
 * 3. 自动检查商用API密钥是否存在
 * 4. 没有密钥时，通过AskUser工具向用户获取
 * 5. 实现真实的、完整的、自由化的拟人智能体行为
 *
 * 设计理念：
 * - 优先使用免费模型（降低成本）
 * - 速率限制触发时自动切换（避免任务中断）
 * - AI自主检查密钥（自主决策）
 * - 没有密钥就向用户要（主动获取资源）
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 模型切换决策 */
export interface ModelSwitchDecision {
  shouldSwitch: boolean; // 是否应该切换
  reason: string; // 切换原因
  currentProvider: string; // 当前provider
  targetProvider: string; // 目标provider
  hasApiKey: boolean; // 是否有API密钥
  apiKeySource: 'env' | 'user' | 'none'; // 密钥来源
  estimatedCost: number; // 预估成本
  estimatedTime: number; // 预估时间
}

/** 速率限制状态 */
export interface RateLimitStatus {
  provider: string;
  isLimited: boolean; // 是否触发速率限制
  remainingRequests: number; // 剩余请求次数
  resetTime: string; // 重置时间
  waitTime: number; // 等待时间（秒）
}

/** 商用API配置 */
export interface CommercialApiConfig {
  provider: string;
  apiKeyEnvKey: string; // 环境变量密钥键名
  endpoint: string;
  model: string;
  costPerRequest: number; // 每次请求成本
  rateLimit: number; // 速率限制（每分钟）
}

// ---------------------------------------------------------------------------
// 智能模型切换处理器
// ---------------------------------------------------------------------------

export class SmartModelSwitcher {
  private commercialApiConfigs: Map<string, CommercialApiConfig>;
  private rateLimitStatuses: Map<string, RateLimitStatus>;
  private apiKeyCache: Map<string, boolean>; // 密钥存在状态缓存

  constructor() {
    this.commercialApiConfigs = new Map();
    this.rateLimitStatuses = new Map();
    this.apiKeyCache = new Map();

    // 初始化商用API配置
    this._initCommercialApiConfigs();

    console.log('[SmartModelSwitcher] 智能模型切换处理器已初始化');
    console.log('[SmartModelSwitcher] 支持的商用API: deepseek, openai, zhipu');
  }

  // ---------------------------------------------------------------------------
  // 核心功能：智能模型切换决策
  // ---------------------------------------------------------------------------

  /**
   * 分析是否需要切换模型
   */
  analyzeSwitchNeed(
    currentProvider: string,
    rateLimitStatus: RateLimitStatus,
    taskComplexity: 'simple' | 'medium' | 'complex',
    urgency: 'low' | 'medium' | 'high'
  ): ModelSwitchDecision {
    console.log(`[SmartModelSwitcher] 分析模型切换需求: current=${currentProvider}, limited=${rateLimitStatus.isLimited}`);

    // 检查是否触发速率限制
    if (!rateLimitStatus.isLimited) {
      console.log(`[SmartModelSwitcher] 未触发速率限制，继续使用当前模型`);
      return {
        shouldSwitch: false,
        reason: '速率限制未触发',
        currentProvider,
        targetProvider: currentProvider,
        hasApiKey: true,
        apiKeySource: 'env',
        estimatedCost: 0,
        estimatedTime: 0,
      };
    }

    // 检查任务紧急程度
    if (urgency === 'low' && rateLimitStatus.waitTime < 60) {
      console.log(`[SmartModelSwitcher] 任务不紧急，等待时间短，建议等待`);
      return {
        shouldSwitch: false,
        reason: `等待${rateLimitStatus.waitTime}秒后重试`,
        currentProvider,
        targetProvider: currentProvider,
        hasApiKey: true,
        apiKeySource: 'env',
        estimatedCost: 0,
        estimatedTime: rateLimitStatus.waitTime,
      };
    }

    // 决定切换到哪个商用API
    const targetProvider = this._selectCommercialProvider(taskComplexity);

    // 检查是否有密钥
    const hasApiKey = this._checkApiKey(targetProvider);

    // 计算预估成本和时间
    const estimatedCost = this._estimateCost(targetProvider, taskComplexity);
    const estimatedTime = this._estimateTime(targetProvider, taskComplexity);

    const decision: ModelSwitchDecision = {
      shouldSwitch: true,
      reason: `速率限制触发，任务紧急度${urgency}，切换到${targetProvider}`,
      currentProvider,
      targetProvider,
      hasApiKey,
      apiKeySource: hasApiKey ? 'env' : 'none',
      estimatedCost,
      estimatedTime,
    };

    console.log(`[SmartModelSwitcher] 决策: shouldSwitch=${decision.shouldSwitch}, target=${decision.targetProvider}, hasKey=${decision.hasApiKey}`);

    return decision;
  }

  /**
   * 执行模型切换（返回工具调用建议）
   */
  executeSwitch(decision: ModelSwitchDecision): {
    toolCalls: any[];
    userMessage: string;
  } {
    console.log(`[SmartModelSwitcher] 执行模型切换: ${decision.currentProvider} → ${decision.targetProvider}`);

    if (!decision.shouldSwitch) {
      return {
        toolCalls: [],
        userMessage: '',
      };
    }

    // 如果没有密钥，建议使用AskUser工具获取密钥
    if (!decision.hasApiKey) {
      console.log(`[SmartModelSwitcher] 没有密钥，建议使用AskUser工具获取`);

      return {
        toolCalls: [
          {
            name: 'AskUser',
            arguments: {
              question: `当前免费模型触发速率限制，需要切换到商用API ${decision.targetProvider} 以继续执行任务。请问您是否有 ${decision.targetProvider} 的API密钥？`,
              options: [
                {
                  label: '我有密钥，请输入',
                  description: '输入您的API密钥，系统将自动保存到.env文件并添加到信任白名单',
                },
                {
                  label: '我没有密钥，请帮我获取',
                  description: '系统将联网查找获取密钥的方法，并指导您获取密钥',
                },
                {
                  label: '等待免费模型恢复',
                  description: `等待${decision.estimatedTime}秒后继续使用免费模型`,
                },
              ],
              defaultOption: 0,
              allowCustomInput: true,
              customInputPlaceholder: '请输入您的API密钥（可选）',
            },
          },
        ],
        userMessage: `⚠️ **速率限制触发，需要切换模型**

当前免费模型 ${decision.currentProvider} 触发速率限制，剩余请求次数: 0
等待时间: ${decision.estimatedTime}秒

**建议切换到商用API**: ${decision.targetProvider}
- 预估成本: ¥${decision.estimatedCost.toFixed(2)}
- 预估时间: ${decision.estimatedTime}秒

**请选择操作方式**:
1. 输入您的API密钥（系统将自动保存）
2. 让系统帮您获取密钥
3. 等待免费模型恢复`,
      };
    }

    // 如果有密钥，直接切换
    console.log(`[SmartModelSwitcher] 有密钥，直接切换到 ${decision.targetProvider}`);

    return {
      toolCalls: [],
      userMessage: `✅ **自动切换到商用API**

速率限制触发，系统已自动切换到 ${decision.targetProvider}
- 密钥来源: 环境变量
- 预估成本: ¥${decision.estimatedCost.toFixed(2)}
- 预估时间: ${decision.estimatedTime}秒

继续执行任务...`,
    };
  }

  // ---------------------------------------------------------------------------
  // 辅助功能
  // ---------------------------------------------------------------------------

  /**
   * 初始化商用API配置
   */
  private _initCommercialApiConfigs(): void {
    // DeepSeek配置
    this.commercialApiConfigs.set('deepseek', {
      provider: 'deepseek',
      apiKeyEnvKey: 'DEEPSEEK_API_KEY',
      endpoint: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      costPerRequest: 0.001, // ¥0.001每次请求
      rateLimit: 60, // 每分钟60次
    });

    // OpenAI配置
    this.commercialApiConfigs.set('openai', {
      provider: 'openai',
      apiKeyEnvKey: 'OPENAI_API_KEY',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      costPerRequest: 0.002, // ¥0.002每次请求
      rateLimit: 500, // 每分钟500次
    });

    // Zhipu配置
    this.commercialApiConfigs.set('zhipu', {
      provider: 'zhipu',
      apiKeyEnvKey: 'ZHIPU_API_KEY',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4',
      model: 'glm-4-flash',
      costPerRequest: 0.001, // ¥0.001每次请求
      rateLimit: 100, // 每分钟100次
    });
  }

  /**
   * 选择商用provider
   */
  private _selectCommercialProvider(taskComplexity: 'simple' | 'medium' | 'complex'): string {
    // 根据任务复杂度选择provider
    if (taskComplexity === 'complex') {
      // 复杂任务：优先OpenAI（能力强）
      if (this._checkApiKey('openai')) {
        return 'openai';
      }
      // 次选DeepSeek（性价比高）
      if (this._checkApiKey('deepseek')) {
        return 'deepseek';
      }
      // 最后选Zhipu（国产）
      return 'zhipu';
    }

    if (taskComplexity === 'medium') {
      // 中等任务：优先DeepSeek（性价比高）
      if (this._checkApiKey('deepseek')) {
        return 'deepseek';
      }
      // 次选Zhipu（国产）
      if (this._checkApiKey('zhipu')) {
        return 'zhipu';
      }
      // 最后选OpenAI（能力强）
      return 'openai';
    }

    // 简单任务：优先Zhipu（国产、便宜）
    if (this._checkApiKey('zhipu')) {
      return 'zhipu';
    }
    // 次选DeepSeek（性价比高）
    if (this._checkApiKey('deepseek')) {
      return 'deepseek';
    }
    // 最后选OpenAI（能力强）
    return 'openai';
  }

  /**
   * 检查API密钥是否存在
   */
  private _checkApiKey(provider: string): boolean {
    // 检查缓存
    if (this.apiKeyCache.has(provider)) {
      return this.apiKeyCache.get(provider)!;
    }

    // 检查环境变量
    const config = this.commercialApiConfigs.get(provider);
    if (!config) {
      return false;
    }

    const apiKey = process.env[config.apiKeyEnvKey];
    const hasKey = apiKey && apiKey.length > 0;

    // 缓存结果
    this.apiKeyCache.set(provider, hasKey);

    console.log(`[SmartModelSwitcher] 检查密钥: ${provider}, hasKey=${hasKey}`);

    return hasKey;
  }

  /**
   * 预估成本
   */
  private _estimateCost(provider: string, taskComplexity: 'simple' | 'medium' | 'complex'): number {
    const config = this.commercialApiConfigs.get(provider);
    if (!config) {
      return 0;
    }

    // 根据任务复杂度预估请求次数
    const requestCount = taskComplexity === 'complex' ? 10 : taskComplexity === 'medium' ? 5 : 2;

    return config.costPerRequest * requestCount;
  }

  /**
   * 预估时间
   */
  private _estimateTime(provider: string, taskComplexity: 'simple' | 'medium' | 'complex'): number {
    // 根据任务复杂度预估时间（秒）
    return taskComplexity === 'complex' ? 30 : taskComplexity === 'medium' ? 15 : 5;
  }

  // ---------------------------------------------------------------------------
  // 公开接口
  // ---------------------------------------------------------------------------

  /**
   * 更新速率限制状态
   */
  updateRateLimitStatus(provider: string, status: RateLimitStatus): void {
    this.rateLimitStatuses.set(provider, status);
    console.log(`[SmartModelSwitcher] 更新速率限制状态: ${provider}, limited=${status.isLimited}`);
  }

  /**
   * 获取速率限制状态
   */
  getRateLimitStatus(provider: string): RateLimitStatus | undefined {
    return this.rateLimitStatuses.get(provider);
  }

  /**
   * 清除密钥缓存（重新检查）
   */
  clearApiKeyCache(): void {
    this.apiKeyCache.clear();
    console.log('[SmartModelSwitcher] 密钥缓存已清除');
  }

  /**
   * 获取商用API配置
   */
  getCommercialApiConfig(provider: string): CommercialApiConfig | undefined {
    return this.commercialApiConfigs.get(provider);
  }

  /**
   * 获取所有商用API配置
   */
  getAllCommercialApiConfigs(): CommercialApiConfig[] {
    return Array.from(this.commercialApiConfigs.values());
  }
}