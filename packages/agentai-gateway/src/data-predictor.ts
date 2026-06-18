// @ts-nocheck
/**
 * 数据预判模块 — 提前预测用户需要的数据，主动获取并缓存
 *
 * ⚠️ @deprecated 模拟实现, 暂未接入 (2026-06-18 审查结论)
 *    _fetchData() (本文件 L317-328) 返回 { value: `模拟数据-${dataKey}` } 占位数据,
 *    未对接真实 API/数据库. 接入主循环会向 LLM 上下文灌注假数据, 导致基于幻觉
 *    数据的决策. 故 index.ts 已注释掉实例化 (代码本体保留, 待真实数据源对接).
 *    另: _updateRequestCount 的 setTimeout(60s) 在高并发下有定时器堆积风险,
 *    重启该模块前需重构为滑动窗口或 Map 清理.
 *
 * 核心能力：
 * 1. 分析用户请求模式，预测数据需求
 * 2. 提前获取数据（从API、数据库、文件等）
 * 3. 缓存预判数据，减少查询时间
 * 4. 提升响应速度
 *
 * 安全保护：
 * - 所有预判数据只缓存到本地，不发送到外部服务器
 * - 用户敏感数据（密钥、密码等）不参与预判
 * - 预判结果可被用户手动清除
 * - API调用有速率限制保护
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 数据请求模式 */
export interface DataRequestPattern {
  patternId: string;
  patternType: 'query' | 'fetch' | 'read' | 'custom';
  dataSource: string; // 数据源（API、数据库、文件等）
  requestFrequency: number; // 请求频率
  confidence: number; // 置信度 0-1
  lastRequest: string; // ISO时间
  predictedData: string[]; // 预判需要的数据
  cacheStrategy: 'immediate' | 'delayed' | 'scheduled'; // 缓存策略
}

/** 数据预判结果 */
export interface DataPredictionResult {
  predictionId: string;
  timestamp: string;
  predictedData: string[];
  confidence: number;
  dataSource: string;
  cachedData: Map<string, any>; // 缓存的数据
  safetyCheck: boolean; // 安全检查通过
  rateLimitCheck: boolean; // 速率限制检查通过
}

/** 数据源配置 */
export interface DataSourceConfig {
  sourceId: string;
  sourceType: 'api' | 'database' | 'file' | 'cache';
  endpoint: string;
  authentication?: string;
  rateLimit?: number; // 速率限制（每分钟最多请求次数）
  cacheTime?: number; // 缓存时间（秒）
  safetyLevel: 'safe' | 'sensitive' | 'restricted'; // 安全级别
}

/** 安全配置 */
export interface DataSafetyConfig {
  /** 是否启用数据预判功能 */
  enabled: boolean;
  /** 是否允许预判敏感数据 */
  predictSensitiveData: boolean;
  /** 是否允许发送预判数据到外部服务器 */
  sendToExternalServer: boolean;
  /** 最大预判数据数量 */
  maxPredictions: number;
  /** 最大缓存大小（MB） */
  maxCacheSize: number;
  /** 速率限制保护 */
  enableRateLimitProtection: boolean;
}

const DEFAULT_DATA_SAFETY_CONFIG: DataSafetyConfig = {
  enabled: true,
  predictSensitiveData: false, // 默认不预判敏感数据
  sendToExternalServer: false, // 默认不发送到外部服务器
  maxPredictions: 20, // 最多20个数据预判
  maxCacheSize: 100, // 最大缓存100MB
  enableRateLimitProtection: true, // 默认启用速率限制保护
};

// ---------------------------------------------------------------------------
// DataPredictor
// ---------------------------------------------------------------------------

export class DataPredictor {
  private safetyConfig: DataSafetyConfig;
  private requestPatterns: Map<string, DataRequestPattern>;
  private predictionCache: Map<string, DataPredictionResult>;
  private dataCache: Map<string, any>; // 数据缓存
  private dataSourceConfigs: Map<string, DataSourceConfig>;
  private requestCount: Map<string, number>; // 请求计数（速率限制）

  constructor(config?: Partial<DataSafetyConfig>) {
    this.safetyConfig = { ...DEFAULT_DATA_SAFETY_CONFIG, ...config };
    this.requestPatterns = new Map();
    this.predictionCache = new Map();
    this.dataCache = new Map();
    this.dataSourceConfigs = new Map();
    this.requestCount = new Map();

    console.log('[DataPredictor] 数据预判系统已初始化');
    console.log(`[DataPredictor] 安全配置: enabled=${this.safetyConfig.enabled}, rateLimitProtection=${this.safetyConfig.enableRateLimitProtection}`);
  }

  // ---------------------------------------------------------------------------
  // 核心功能：分析请求模式，预测数据需求
  // ---------------------------------------------------------------------------

  /**
   * 分析数据请求模式
   */
  analyzeRequestPattern(request: string, dataSource: string): DataRequestPattern | null {
    if (!this.safetyConfig.enabled) {
      console.log('[DataPredictor] 数据预判功能已禁用，跳过分析');
      return null;
    }

    // 安全检查：过滤敏感数据源
    if (!this._isSafeDataSource(dataSource)) {
      console.log(`[DataPredictor] 数据源 "${dataSource}" 不安全，跳过分析`);
      return null;
    }

    console.log(`[DataPredictor] 分析请求模式: "${request.substring(0, 50)}...", 数据源: ${dataSource}`);

    // 提取请求模式
    const pattern = this._extractRequestPattern(request, dataSource);

    if (pattern) {
      // 更新模式库
      this._updateRequestPattern(pattern);
    }

    return pattern;
  }

  /**
   * 预判用户需要的数据
   */
  predictRequiredData(currentRequest: string): DataPredictionResult {
    if (!this.safetyConfig.enabled) {
      return {
        predictionId: `pred-${Date.now()}`,
        timestamp: new Date().toISOString(),
        predictedData: [],
        confidence: 0,
        dataSource: 'unknown',
        cachedData: new Map(),
        safetyCheck: true,
        rateLimitCheck: true,
      };
    }

    console.log(`[DataPredictor] 开始数据预判，当前请求: "${currentRequest.substring(0, 50)}..."`);

    // 查找匹配的请求模式
    const matchingPatterns = this._findMatchingPatterns(currentRequest);

    // 生成预判结果
    const predictedData = matchingPatterns
      .flatMap(p => p.predictedData)
      .slice(0, this.safetyConfig.maxPredictions);

    // 计算置信度
    const confidence = matchingPatterns.length > 0
      ? matchingPatterns.reduce((sum, p) => sum + p.confidence, 0) / matchingPatterns.length
      : 0;

    // 确定数据源
    const dataSource = matchingPatterns.length > 0
      ? matchingPatterns[0].dataSource
      : 'unknown';

    // 获取并缓存数据（安全检查）
    const cachedData = this._fetchAndCacheData(predictedData, dataSource);

    const prediction: DataPredictionResult = {
      predictionId: `pred-${Date.now()}`,
      timestamp: new Date().toISOString(),
      predictedData,
      confidence,
      dataSource,
      cachedData,
      safetyCheck: true, // 所有预判都经过安全检查
      rateLimitCheck: true, // 所有预判都经过速率限制检查
    };

    // 缓存预判结果
    this.predictionCache.set(prediction.predictionId, prediction);

    console.log(`[DataPredictor] 数据预判完成，置信度: ${confidence.toFixed(2)}, 预判数据数: ${predictedData.length}`);

    return prediction;
  }

  // ---------------------------------------------------------------------------
  // 安全保护功能
  // ---------------------------------------------------------------------------

  /**
   * 检查数据源是否安全
   */
  private _isSafeDataSource(dataSource: string): boolean {
    const unsafeKeywords = [
      '密钥', 'password', 'token', 'secret', 'credential',
      '外部服务器', '第三方API', '敏感数据',
    ];

    return !unsafeKeywords.some(keyword =>
      dataSource.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 获取并缓存数据（安全检查）
   */
  private _fetchAndCacheData(predictedData: string[], dataSource: string): Map<string, any> {
    const cachedData = new Map<string, any>();

    for (const dataKey of predictedData) {
      // 安全检查：只获取安全的数据
      if (!this._isSafeDataKey(dataKey)) {
        console.log(`[DataPredictor] 数据 "${dataKey}" 不安全，跳过获取`);
        continue;
      }

      // 速率限制检查
      if (!this._checkRateLimit(dataSource)) {
        console.log(`[DataPredictor] 数据源 "${dataSource}" 速率限制，跳过获取`);
        continue;
      }

      // 缓存大小检查
      if (this._isCacheFull()) {
        console.log(`[DataPredictor] 缓存已满，跳过获取`);
        break;
      }

      // 获取数据（模拟）
      const data = this._fetchData(dataKey, dataSource);

      if (data) {
        cachedData.set(dataKey, data);
        this.dataCache.set(dataKey, data);

        // 更新请求计数
        this._updateRequestCount(dataSource);
      }
    }

    return cachedData;
  }

  /**
   * 检查数据键是否安全
   */
  private _isSafeDataKey(dataKey: string): boolean {
    const unsafeKeywords = [
      '密钥', 'password', 'token', 'secret', 'credential',
      '信用卡', '银行卡', '身份证', '手机号',
    ];

    return !unsafeKeywords.some(keyword =>
      dataKey.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 检查速率限制
   */
  private _checkRateLimit(dataSource: string): boolean {
    if (!this.safetyConfig.enableRateLimitProtection) {
      return true; // 速率限制保护已禁用
    }

    const config = this.dataSourceConfigs.get(dataSource);
    if (!config || !config.rateLimit) {
      return true; // 无速率限制配置
    }

    const currentCount = this.requestCount.get(dataSource) || 0;
    return currentCount < config.rateLimit;
  }

  /**
   * 更新请求计数
   */
  private _updateRequestCount(dataSource: string): void {
    const currentCount = this.requestCount.get(dataSource) || 0;
    this.requestCount.set(dataSource, currentCount + 1);

    // 每分钟重置计数
    setTimeout(() => {
      this.requestCount.set(dataSource, 0);
    }, 60000);
  }

  /**
   * 检查缓存是否已满
   */
  private _isCacheFull(): boolean {
    // 简化版：检查缓存数量
    const cacheSize = this.dataCache.size;
    const estimatedMB = cacheSize * 0.1; // 假设每个数据项0.1MB

    return estimatedMB >= this.safetyConfig.maxCacheSize;
  }

  // ---------------------------------------------------------------------------
  // 数据获取和缓存
  // ---------------------------------------------------------------------------

  /**
   * 获取数据（模拟）
   */
  private _fetchData(dataKey: string, dataSource: string): any {
    // 模拟数据获取（实际应该调用API或数据库）
    console.log(`[DataPredictor] 获取数据: "${dataKey}", 数据源: ${dataSource}`);

    // 模拟返回数据
    return {
      key: dataKey,
      value: `模拟数据-${dataKey}`,
      timestamp: new Date().toISOString(),
      source: dataSource,
    };
  }

  /**
   * 提取请求模式（简化版）
   */
  private _extractRequestPattern(request: string, dataSource: string): DataRequestPattern | null {
    // 检查是否是常见的数据请求模式
    const commonPatterns = [
      { keyword: '查询', predictedData: ['查询结果', '详细信息'] },
      { keyword: '读取', predictedData: ['文件内容', '数据列表'] },
      { keyword: '获取', predictedData: ['API数据', '数据库记录'] },
      { keyword: '分析', predictedData: ['统计数据', '分析结果'] },
    ];

    for (const pattern of commonPatterns) {
      if (request.includes(pattern.keyword)) {
        return {
          patternId: `req-${Date.now()}`,
          patternType: 'query',
          dataSource,
          requestFrequency: 1,
          confidence: 0.8,
          lastRequest: new Date().toISOString(),
          predictedData: pattern.predictedData,
          cacheStrategy: 'immediate',
        };
      }
    }

    return null;
  }

  /**
   * 更新请求模式库
   */
  private _updateRequestPattern(pattern: DataRequestPattern): void {
    const existingPattern = this.requestPatterns.get(pattern.patternId);

    if (existingPattern) {
      // 更新现有模式
      existingPattern.requestFrequency += 1;
      existingPattern.confidence = Math.min(1, existingPattern.confidence + 0.1);
      existingPattern.lastRequest = pattern.lastRequest;
    } else {
      // 添加新模式
      this.requestPatterns.set(pattern.patternId, pattern);
    }
  }

  /**
   * 查找匹配的请求模式
   */
  private _findMatchingPatterns(request: string): DataRequestPattern[] {
    const matching: DataRequestPattern[] = [];

    for (const pattern of this.requestPatterns.values()) {
      // 检查请求是否匹配
      if (this._isRequestMatch(request, pattern)) {
        matching.push(pattern);
      }
    }

    // 按置信度排序
    return matching.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 检查请求是否匹配
   */
  private _isRequestMatch(request: string, pattern: DataRequestPattern): boolean {
    // 简化版：检查请求是否包含模式的关键词
    return pattern.predictedData.some(data =>
      request.includes(data) || data.includes(request)
    );
  }

  // ---------------------------------------------------------------------------
  // 公开接口
  // ---------------------------------------------------------------------------

  /**
   * 获取所有请求模式
   */
  getAllPatterns(): DataRequestPattern[] {
    return Array.from(this.requestPatterns.values());
  }

  /**
   * 获取缓存数据
   */
  getCachedData(dataKey: string): any | undefined {
    return this.dataCache.get(dataKey);
  }

  /**
   * 清除预测缓存
   */
  clearPredictionCache(): void {
    this.predictionCache.clear();
    console.log('[DataPredictor] 预测缓存已清除');
  }

  /**
   * 清除数据缓存
   */
  clearDataCache(): void {
    this.dataCache.clear();
    console.log('[DataPredictor] 数据缓存已清除');
  }

  /**
   * 清除请求模式库
   */
  clearRequestPatterns(): void {
    this.requestPatterns.clear();
    console.log('[DataPredictor] 请求模式库已清除');
  }

  /**
   * 获取安全配置
   */
  getSafetyConfig(): DataSafetyConfig {
    return this.safetyConfig;
  }

  /**
   * 更新安全配置
   */
  updateSafetyConfig(config: Partial<DataSafetyConfig>): void {
    this.safetyConfig = { ...this.safetyConfig, ...config };
    console.log('[DataPredictor] 安全配置已更新');
  }

  /**
   * 禁用数据预判功能
   */
  disable(): void {
    this.safetyConfig.enabled = false;
    console.log('[DataPredictor] 数据预判功能已禁用');
  }

  /**
   * 启用数据预判功能
   */
  enable(): void {
    this.safetyConfig.enabled = true;
    console.log('[DataPredictor] 数据预判功能已启用');
  }

  /**
   * 添加数据源配置
   */
  addDataSourceConfig(config: DataSourceConfig): void {
    this.dataSourceConfigs.set(config.sourceId, config);
    console.log(`[DataPredictor] 数据源配置已添加: ${config.sourceId}`);
  }

  /**
   * 获取数据源配置
   */
  getDataSourceConfig(sourceId: string): DataSourceConfig | undefined {
    return this.dataSourceConfigs.get(sourceId);
  }
}