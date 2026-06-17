// @ts-nocheck
/**
 * 用户行为预判模块 — 提前预测用户下一步行动，主动准备资源
 *
 * 核心能力：
 * 1. 分析历史会话，识别用户行为模式
 * 2. 预测用户下一步行动（如：创建组件后可能要测试）
 * 3. 提前准备资源（模型、技能、数据）
 * 4. 减少用户等待时间，提升体验
 *
 * 安全保护：
 * - 所有预测结果只用于本地缓存准备，不发送到外部服务器
 * - 用户敏感数据（密钥、密码等）不参与预测分析
 * - 预测结果可被用户手动关闭或清除
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 用户行为模式 */
export interface UserBehaviorPattern {
  patternId: string;
  patternType: 'sequential' | 'periodic' | 'contextual' | 'custom';
  description: string;
  frequency: number; // 出现次数
  confidence: number; // 置信度 0-1
  lastOccurrence: string; // ISO时间
  nextActions: string[]; // 预测的下一步行动
  requiredResources: string[]; // 需要准备的资源
}

/** 预测结果 */
export interface PredictionResult {
  predictionId: string;
  timestamp: string;
  predictedActions: string[];
  confidence: number;
  reasoning: string;
  preparedResources: string[];
  safetyCheck: boolean; // 安全检查通过
}

/** 会话分析结果 */
export interface SessionAnalysis {
  sessionId: string;
  userActions: string[];
  context: string;
  timestamp: string;
  extractedPatterns: string[];
}

/** 安全配置 */
export interface SafetyConfig {
  /** 是否启用预测功能 */
  enabled: boolean;
  /** 是否允许分析敏感数据 */
  analyzeSensitiveData: boolean;
  /** 是否允许发送预测结果到外部服务器 */
  sendToExternalServer: boolean;
  /** 预测结果缓存时间（秒） */
  cacheTime: number;
  /** 最大预测数量 */
  maxPredictions: number;
}

const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  enabled: true,
  analyzeSensitiveData: false, // 默认不分析敏感数据
  sendToExternalServer: false, // 默认不发送到外部服务器
  cacheTime: 3600, // 缓存1小时
  maxPredictions: 10, // 最多10个预测
};

// ---------------------------------------------------------------------------
// UserBehaviorPredictor
// ---------------------------------------------------------------------------

export class UserBehaviorPredictor {
  private safetyConfig: SafetyConfig;
  private behaviorPatterns: Map<string, UserBehaviorPattern>;
  private predictionCache: Map<string, PredictionResult>;
  private sessionHistory: SessionAnalysis[];

  constructor(config?: Partial<SafetyConfig>) {
    this.safetyConfig = { ...DEFAULT_SAFETY_CONFIG, ...config };
    this.behaviorPatterns = new Map();
    this.predictionCache = new Map();
    this.sessionHistory = [];

    console.log('[UserBehaviorPredictor] 用户行为预判系统已初始化');
    console.log(`[UserBehaviorPredictor] 安全配置: enabled=${this.safetyConfig.enabled}, analyzeSensitiveData=${this.safetyConfig.analyzeSensitiveData}`);
  }

  // ---------------------------------------------------------------------------
  // 核心功能：分析历史会话，识别行为模式
  // ---------------------------------------------------------------------------

  /**
   * 分析历史会话，提取行为模式
   */
  analyzeSession(session: SessionAnalysis): UserBehaviorPattern[] {
    if (!this.safetyConfig.enabled) {
      console.log('[UserBehaviorPredictor] 预测功能已禁用，跳过分析');
      return [];
    }

    // 安全检查：过滤敏感数据
    const safeActions = this._filterSensitiveActions(session.userActions);
    if (safeActions.length === 0) {
      console.log('[UserBehaviorPredictor] 会话无有效行为数据，跳过分析');
      return [];
    }

    console.log(`[UserBehaviorPredictor] 分析会话 ${session.sessionId}, 有效行为数: ${safeActions.length}`);

    // 提取行为模式
    const patterns = this._extractPatterns(safeActions, session.context);

    // 更新模式库
    for (const pattern of patterns) {
      this._updatePattern(pattern);
    }

    // 记录会话历史
    this.sessionHistory.push({
      ...session,
      userActions: safeActions,
    });

    return patterns;
  }

  /**
   * 预测用户下一步行动
   */
  predictNextActions(currentContext: string): PredictionResult {
    if (!this.safetyConfig.enabled) {
      return {
        predictionId: `pred-${Date.now()}`,
        timestamp: new Date().toISOString(),
        predictedActions: [],
        confidence: 0,
        reasoning: '预测功能已禁用',
        preparedResources: [],
        safetyCheck: true,
      };
    }

    console.log(`[UserBehaviorPredictor] 开始预测，当前上下文: ${currentContext}`);

    // 查找匹配的行为模式
    const matchingPatterns = this._findMatchingPatterns(currentContext);

    // 生成预测结果
    const predictedActions = matchingPatterns
      .flatMap(p => p.nextActions)
      .slice(0, this.safetyConfig.maxPredictions);

    // 计算置信度
    const confidence = matchingPatterns.length > 0
      ? matchingPatterns.reduce((sum, p) => sum + p.confidence, 0) / matchingPatterns.length
      : 0;

    // 生成推理说明
    const reasoning = matchingPatterns.length > 0
      ? `基于 ${matchingPatterns.length} 个历史模式预测`
      : '无匹配的历史模式';

    // 准备资源（安全检查）
    const preparedResources = this._prepareResources(predictedActions);

    const prediction: PredictionResult = {
      predictionId: `pred-${Date.now()}`,
      timestamp: new Date().toISOString(),
      predictedActions,
      confidence,
      reasoning,
      preparedResources,
      safetyCheck: true, // 所有预测都经过安全检查
    };

    // 缓存预测结果
    this.predictionCache.set(prediction.predictionId, prediction);

    console.log(`[UserBehaviorPredictor] 预测完成，置信度: ${confidence.toFixed(2)}, 预测行动数: ${predictedActions.length}`);

    return prediction;
  }

  // ---------------------------------------------------------------------------
  // 安全保护功能
  // ---------------------------------------------------------------------------

  /**
   * 过滤敏感行为数据（密钥、密码、个人信息等）
   */
  private _filterSensitiveActions(actions: string[]): string[] {
    const sensitiveKeywords = [
      '密钥', 'API Key', 'password', '密码', 'token', 'secret',
      '信用卡', '银行卡', '身份证', '手机号', '邮箱',
      'private', 'credential', 'auth',
    ];

    return actions.filter(action => {
      // 检查是否包含敏感关键词
      const containsSensitive = sensitiveKeywords.some(keyword =>
        action.toLowerCase().includes(keyword.toLowerCase())
      );

      if (containsSensitive) {
        console.log(`[UserBehaviorPredictor] 过滤敏感行为: "${action.substring(0, 30)}..."`);
        return false;
      }

      return true;
    });
  }

  /**
   * 准备资源（安全检查）
   */
  private _prepareResources(predictedActions: string[]): string[] {
    const resources: string[] = [];

    for (const action of predictedActions) {
      // 安全检查：只准备安全的资源
      if (this._isSafeResource(action)) {
        resources.push(this._getRequiredResource(action));
      }
    }

    return resources;
  }

  /**
   * 检查资源是否安全
   */
  private _isSafeResource(action: string): boolean {
    const unsafeKeywords = [
      '密钥', 'password', 'token', 'secret', 'credential',
      '外部服务器', '第三方API',
    ];

    return !unsafeKeywords.some(keyword =>
      action.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  /**
   * 获取行动所需的资源
   */
  private _getRequiredResource(action: string): string {
    // 根据行动类型返回所需资源
    if (action.includes('测试') || action.includes('test')) {
      return 'vitest,jest,testing-framework';
    }
    if (action.includes('部署') || action.includes('deploy')) {
      return 'docker,kubernetes,deployment-tools';
    }
    if (action.includes('文档') || action.includes('docs')) {
      return 'markdown,documentation-tools';
    }
    if (action.includes('视频') || action.includes('video')) {
      return 'video-generation-model,ffmpeg';
    }
    if (action.includes('图像') || action.includes('image')) {
      return 'image-generation-model,canvas-tools';
    }

    return 'general-resources';
  }

  // ---------------------------------------------------------------------------
  // 行为模式提取和匹配
  // ---------------------------------------------------------------------------

  /**
   * 提取行为模式（简化版）
   */
  private _extractPatterns(actions: string[], context: string): UserBehaviorPattern[] {
    const patterns: UserBehaviorPattern[] = [];

    // 识别顺序模式（如：创建组件 → 测试组件）
    for (let i = 0; i < actions.length - 1; i++) {
      const currentAction = actions[i];
      const nextAction = actions[i + 1];

      // 检查是否是常见的顺序模式
      if (this._isSequentialPattern(currentAction, nextAction)) {
        patterns.push({
          patternId: `seq-${Date.now()}-${i}`,
          patternType: 'sequential',
          description: `${currentAction} → ${nextAction}`,
          frequency: 1,
          confidence: 0.8,
          lastOccurrence: new Date().toISOString(),
          nextActions: [nextAction],
          requiredResources: [this._getRequiredResource(nextAction)],
        });
      }
    }

    // 识别周期模式（如：每周一早上生成报告）
    // 简化版：暂时不实现

    return patterns;
  }

  /**
   * 检查是否是顺序模式
   */
  private _isSequentialPattern(current: string, next: string): boolean {
    const sequentialPatterns = [
      ['创建', '测试'],
      ['开发', '部署'],
      ['设计', '实现'],
      ['查询', '分析'],
      ['读取', '处理'],
      ['生成', '优化'],
    ];

    return sequentialPatterns.some(([first, second]) =>
      current.includes(first) && next.includes(second)
    );
  }

  /**
   * 更新行为模式库
   */
  private _updatePattern(pattern: UserBehaviorPattern): void {
    const existingPattern = this.behaviorPatterns.get(pattern.patternId);

    if (existingPattern) {
      // 更新现有模式
      existingPattern.frequency += 1;
      existingPattern.confidence = Math.min(1, existingPattern.confidence + 0.1);
      existingPattern.lastOccurrence = pattern.lastOccurrence;
    } else {
      // 添加新模式
      this.behaviorPatterns.set(pattern.patternId, pattern);
    }
  }

  /**
   * 查找匹配的行为模式
   */
  private _findMatchingPatterns(context: string): UserBehaviorPattern[] {
    const matching: UserBehaviorPattern[] = [];

    for (const pattern of this.behaviorPatterns.values()) {
      // 检查上下文是否匹配
      if (this._isContextMatch(context, pattern)) {
        matching.push(pattern);
      }
    }

    // 按置信度排序
    return matching.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 检查上下文是否匹配
   */
  private _isContextMatch(context: string, pattern: UserBehaviorPattern): boolean {
    // 简化版：检查上下文是否包含模式的关键词
    const keywords = pattern.description.split(' → ');
    return keywords.some(keyword => context.includes(keyword));
  }

  // ---------------------------------------------------------------------------
  // 公开接口
  // ---------------------------------------------------------------------------

  /**
   * 获取所有行为模式
   */
  getAllPatterns(): UserBehaviorPattern[] {
    return Array.from(this.behaviorPatterns.values());
  }

  /**
   * 清除预测缓存
   */
  clearPredictionCache(): void {
    this.predictionCache.clear();
    console.log('[UserBehaviorPredictor] 预测缓存已清除');
  }

  /**
   * 清除行为模式库
   */
  clearBehaviorPatterns(): void {
    this.behaviorPatterns.clear();
    console.log('[UserBehaviorPredictor] 行为模式库已清除');
  }

  /**
   * 获取安全配置
   */
  getSafetyConfig(): SafetyConfig {
    return this.safetyConfig;
  }

  /**
   * 更新安全配置
   */
  updateSafetyConfig(config: Partial<SafetyConfig>): void {
    this.safetyConfig = { ...this.safetyConfig, ...config };
    console.log('[UserBehaviorPredictor] 安全配置已更新');
  }

  /**
   * 禁用预测功能
   */
  disable(): void {
    this.safetyConfig.enabled = false;
    console.log('[UserBehaviorPredictor] 预测功能已禁用');
  }

  /**
   * 启用预测功能
   */
  enable(): void {
    this.safetyConfig.enabled = true;
    console.log('[UserBehaviorPredictor] 预测功能已启用');
  }
}