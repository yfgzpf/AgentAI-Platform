/**
 * RuntimeCapabilityTracker — 系统管控员 AI 的核心感知层
 * ===========================================================================
 * 
 * 职责:
 *   1. 订阅 AgentAILoop 事件 (tool:result, loop:done, reflect:done)
 *   2. 维护「模型 × 任务类型」动态能力矩阵 (EMA 平滑)
 *   3. 将 SelfEval 质量打分、Reflector 诊断、工具成功率回流到能力评分
 *   4. 提供 getDynamicCapabilities() — 让 model-classifier 的静态评分变动态
 *   5. 提供 getHealthReport() — 系统健康治理 API 的数据源
 *   6. 持久化到 .agentai/capability-matrix.json (防抖 30s)
 * 
 * 核心公式:
 *   dynamicScore = staticScore * (1 - runtimeWeight) + runtimeScore * runtimeWeight
 *   runtimeWeight = min(sampleCount / 20, 0.4)  // 样本越多, 运行时数据权重越大, 但不超过 40%
 * 
 * EMA (指数移动平均):
 *   ema = α * newValue + (1 - α) * ema  // α = 0.15, 近期数据权重更高
 * 
 * 设计原则:
 *   - 单例模式 (全进程共享一个 tracker)
 *   - 无阻塞: 所有记录操作都是同步内存写入, 持久化异步防抖
 *   - 容错: 任何异常不影响主流程
 *   - 可观测: 所有数据可通过 API 暴露给前端
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { computeCapabilities, getCapabilitiesById, type ModelCapability, type CapabilityTier } from '../model-classifier.js';

// ===== 类型定义 =====

export type TaskType = 'coding' | 'research' | 'general' | 'industry';

/** 单个「模型 × 任务类型」的运行时统计 */
export interface RuntimeStats {
  /** 模型 ID (provider:subModel) */
  modelId: string;
  /** 任务类型 */
  taskType: TaskType;
  
  // ── EMA 指标 (0-1) ──
  /** 成功率 (EMA) */
  successRate: number;
  /** 工具调用成功率 (EMA) */
  toolCallSuccessRate: number;
  /** 质量分数 (EMA, 来自 SelfEval, 归一化到 0-1) */
  qualityScore: number;
  /** 延迟分数 (EMA, 0-1, 越高越快) */
  latencyScore: number;
  
  // ── 原始累积数据 ──
  /** 总样本数 */
  sampleCount: number;
  /** 总成功次数 */
  totalSuccess: number;
  /** 总失败次数 */
  totalFailure: number;
  /** 平均迭代次数 (EMA) */
  avgIterations: number;
  /** 平均延迟 (ms, EMA) */
  avgLatencyMs: number;
  
  // ── 错误模式 ──
  /** 错误类型频率 (errorType → count) */
  errorPatterns: Record<string, number>;
  /** Reflector 诊断类型频率 (diagnosisType → count) */
  diagnosisPatterns: Record<string, number>;
  
  // ── 时间戳 ──
  /** 最后更新时间 */
  lastUpdated: number;
  /** 创建时间 */
  createdAt: number;
}

/** 动态能力评分 = 静态评分 + 运行时调整 */
export interface DynamicCapability extends ModelCapability {
  /** 静态评分 (来自 computeCapabilities) */
  staticOverall: number;
  /** 运行时评分 (来自 EMA 指标加权) */
  runtimeOverall: number;
  /** 运行时数据权重 (0-0.4, 样本越多越大) */
  runtimeWeight: number;
  /** 样本数 */
  sampleCount: number;
  /** 是否有足够的运行时数据 */
  hasRuntimeData: boolean;
  /** 调整后的能力等级 (可能因运行时表现升降级) */
  dynamicTier: CapabilityTier;
}

/** 系统健康报告 */
export interface HealthReport {
  /** 生成时间 */
  timestamp: number;
  /** 追踪的模型总数 */
  trackedModels: number;
  /** 总样本数 */
  totalSamples: number;
  /** 模型健康摘要 */
  models: Array<{
    modelId: string;
    label: string;
    /** 综合健康分 (0-1) */
    healthScore: number;
    /** 静态能力分 */
    staticOverall: number;
    /** 动态能力分 */
    dynamicOverall: number;
    /** 是否升级了 */
    tierChanged: boolean;
    staticTier: CapabilityTier;
    dynamicTier: CapabilityTier;
    /** 样本数 */
    sampleCount: number;
    /** 成功率 */
    successRate: number;
    /** 工具调用成功率 */
    toolCallSuccessRate: number;
    /** 质量分 */
    qualityScore: number;
    /** 平均延迟 */
    avgLatencyMs: number;
    /** 主要错误模式 */
    topErrors: Array<{ pattern: string; count: number }>;
  }>;
  /** 系统级建议 */
  recommendations: string[];
}

// ===== 常量 =====

/** EMA 平滑系数 (越小越平滑, 越大越敏感) */
const EMA_ALPHA = 0.15;

/** 运行时数据最大权重 (样本充足时, 运行时数据最多影响 40% 的评分) */
const MAX_RUNTIME_WEIGHT = 0.40;

/** 达到最大权重所需的样本数 */
const SAMPLES_FOR_MAX_WEIGHT = 20;

/** 持久化防抖间隔 (ms) */
const PERSIST_DEBOUNCE_MS = 30_000;

/** 矩阵最大条目数 (LRU 淘汰) */
const MAX_ENTRIES = 500;

/** 持久化文件路径 */
const DATA_DIR = process.env.AGENTAI_DATA_DIR || path.join(process.cwd(), '.agentai');
const MATRIX_FILE = path.join(DATA_DIR, 'capability-matrix.json');

/** 任务类型 → 能力维度权重 (不同任务类型看重不同能力) */
const TASK_WEIGHTS: Record<TaskType, { success: number; toolCall: number; quality: number; latency: number }> = {
  coding:   { success: 0.30, toolCall: 0.35, quality: 0.25, latency: 0.10 },
  research: { success: 0.25, toolCall: 0.15, quality: 0.40, latency: 0.20 },
  general:  { success: 0.30, toolCall: 0.20, quality: 0.30, latency: 0.20 },
  industry: { success: 0.25, toolCall: 0.25, quality: 0.35, latency: 0.15 },
};

// ===== 单例 =====

let _instance: RuntimeCapabilityTracker | null = null;

/**
 * 获取单例实例
 */
export function getTracker(): RuntimeCapabilityTracker {
  if (!_instance) {
    _instance = new RuntimeCapabilityTracker();
  }
  return _instance;
}

// ===== 核心 Tracker =====

export class RuntimeCapabilityTracker extends EventEmitter {
  /** 动态能力矩阵: key = `${modelId}::${taskType}` */
  private matrix = new Map<string, RuntimeStats>();
  /** 持久化防抖定时器 */
  private persistTimer: NodeJS.Timeout | null = null;
  /** 是否已从磁盘加载 */
  private loaded = false;
  
  constructor() {
    super();
    this.loadFromDisk();
  }
  
  // ═════════════════════════════════════════════════════════════════════════
  //  公开 API: 记录运行时数据
  // ═════════════════════════════════════════════════════════════════════════
  
  /**
   * 记录一次工具调用结果
   * 由 AgentAILoop 的 'tool:result' 事件触发
   */
  recordToolResult(
    modelId: string,
    taskType: TaskType,
    _toolName: string,
    success: boolean,
    _durationMs: number,
  ): void {
    try {
      const stats = this.getOrCreate(modelId, taskType);
      stats.sampleCount++;
      
      // 工具调用成功率 EMA
      const successVal = success ? 1 : 0;
      stats.toolCallSuccessRate = this.ema(stats.toolCallSuccessRate, successVal);
      
      // 如果是失败, 记录错误模式
      if (!success) {
        const errorKey = this.classifyToolError(_toolName);
        stats.errorPatterns[errorKey] = (stats.errorPatterns[errorKey] || 0) + 1;
      }
      
      // 延迟分数 EMA (200ms → 1.0, 5000ms → 0.1)
      if (_durationMs > 0) {
        const latScore = Math.max(0.1, 1.0 - Math.min(_durationMs / 5000, 0.9));
        stats.latencyScore = this.ema(stats.latencyScore, latScore);
        stats.avgLatencyMs = this.ema(stats.avgLatencyMs, _durationMs);
      }
      
      stats.lastUpdated = Date.now();
      this.schedulePersist();
      this.emit('stats:updated', { modelId, taskType, stats });
    } catch (e) {
      // 容错: 不影响主流程
    }
  }
  
  /**
   * 记录一次 loop 完成
   * 由 AgentAILoop 的 'loop:done' 事件触发
   */
  recordLoopCompletion(
    modelId: string,
    taskType: TaskType,
    success: boolean,
    iterations: number,
    qualityScore?: number, // 来自 SelfEval, 范围 0-1
  ): void {
    try {
      const stats = this.getOrCreate(modelId, taskType);
      
      // 成功率 EMA
      const successVal = success ? 1 : 0;
      stats.successRate = this.ema(stats.successRate, successVal);
      
      if (success) stats.totalSuccess++;
      else stats.totalFailure++;
      
      // 迭代次数 EMA
      stats.avgIterations = this.ema(stats.avgIterations, iterations);
      
      // 质量分 EMA (如果有 SelfEval 打分)
      if (qualityScore !== undefined && qualityScore >= 0 && qualityScore <= 1) {
        stats.qualityScore = this.ema(stats.qualityScore, qualityScore);
      }
      
      stats.lastUpdated = Date.now();
      this.schedulePersist();
      this.emit('stats:updated', { modelId, taskType, stats });
    } catch (e) {
      // 容错
    }
  }
  
  /**
   * 记录 Reflector 诊断结果
   * 由 Reflector 的反思流程触发
   */
  recordReflectorDiagnosis(
    modelId: string,
    taskType: TaskType,
    diagnosisType: string,
  ): void {
    try {
      const stats = this.getOrCreate(modelId, taskType);
      stats.diagnosisPatterns[diagnosisType] = (stats.diagnosisPatterns[diagnosisType] || 0) + 1;
      stats.lastUpdated = Date.now();
      this.schedulePersist();
    } catch (e) {
      // 容错
    }
  }
  
  // ═════════════════════════════════════════════════════════════════════════
  //  公开 API: 查询动态能力
  // ═════════════════════════════════════════════════════════════════════════
  
  /**
   * 获取模型的动态能力评分
   * 将静态评分与运行时数据融合
   */
  getDynamicCapabilities(modelId: string, taskType: TaskType = 'general'): DynamicCapability {
    const staticCap = getCapabilitiesById(
      modelId.includes(':') ? modelId.split(':')[0]! : modelId,
      modelId.includes(':') ? modelId.split(':')[1] : undefined,
    );
    
    const stats = this.getStats(modelId, taskType);
    const runtimeWeight = this.computeRuntimeWeight(stats?.sampleCount || 0);
    
    if (!stats || stats.sampleCount < 3) {
      // 数据不足, 直接返回静态评分
      return {
        ...staticCap,
        staticOverall: staticCap.overall,
        runtimeOverall: staticCap.overall,
        runtimeWeight: 0,
        sampleCount: stats?.sampleCount || 0,
        hasRuntimeData: false,
        dynamicTier: staticCap.tier,
      };
    }
    
    // 计算运行时综合分
    const weights = TASK_WEIGHTS[taskType] || TASK_WEIGHTS.general;
    const runtimeOverall =
      stats.successRate * weights.success +
      stats.toolCallSuccessRate * weights.toolCall +
      stats.qualityScore * weights.quality +
      stats.latencyScore * weights.latency;
    
    // 融合: dynamicScore = static * (1 - w) + runtime * w
    const dynamicOverall = staticCap.overall * (1 - runtimeWeight) + runtimeOverall * runtimeWeight;
    
    // 动态等级: 运行时表现好可以升级, 差可以降级
    const dynamicTier = this.computeDynamicTier(staticCap, dynamicOverall, stats);
    
    return {
      ...staticCap,
      overall: dynamicOverall, // 覆盖 overall 为动态分
      staticOverall: staticCap.overall,
      runtimeOverall,
      runtimeWeight,
      sampleCount: stats.sampleCount,
      hasRuntimeData: true,
      dynamicTier,
    };
  }
  
  /**
   * 获取原始运行时统计
   */
  getStats(modelId: string, taskType: TaskType): RuntimeStats | undefined {
    return this.matrix.get(`${modelId}::${taskType}`);
  }
  
  /**
   * 获取所有被追踪的模型 ID
   */
  getTrackedModels(): string[] {
    const ids = new Set<string>();
    for (const key of this.matrix.keys()) {
      ids.add(key.split('::')[0] || '');
    }
    return [...ids];
  }
  
  /**
   * 生成系统健康报告
   * 这是治理 API 的核心数据源
   */
  async getHealthReport(): Promise<HealthReport> {
    const { MODELS } = await import('../model-classifier.js');
    const recommendations: string[] = [];
    const modelReports: HealthReport['models'] = [];
    let totalSamples = 0;
    
    for (const [key, stats] of this.matrix) {
      const [modelId, taskType] = key.split('::');
      if (!modelId || !taskType) continue;
      totalSamples += stats.sampleCount;
      
      // 获取静态能力
      const staticCap = getCapabilitiesById(
        modelId.includes(':') ? modelId.split(':')[0]! : modelId,
        modelId.includes(':') ? modelId.split(':')[1] : undefined,
      );
      
      // 获取动态能力
      const dynCap = this.getDynamicCapabilities(modelId, taskType as TaskType);
      
      // 找到模型标签
      const meta = MODELS.find((m: any) => m.id === modelId);
      const label = meta?.label || modelId;
      
      // 提取 top 错误
      const topErrors = Object.entries(stats.errorPatterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([pattern, count]) => ({ pattern, count }));
      
      const tierChanged = dynCap.dynamicTier !== staticCap.tier;
      
      modelReports.push({
        modelId: modelId!,
        label,
        healthScore: dynCap.overall,
        staticOverall: staticCap.overall,
        dynamicOverall: dynCap.overall,
        tierChanged,
        staticTier: staticCap.tier,
        dynamicTier: dynCap.dynamicTier,
        sampleCount: stats.sampleCount,
        successRate: stats.successRate,
        toolCallSuccessRate: stats.toolCallSuccessRate,
        qualityScore: stats.qualityScore,
        avgLatencyMs: stats.avgLatencyMs,
        topErrors,
      });
      
      // 生成建议
      if (tierChanged) {
        if (dynCap.dynamicTier === 'autonomous' && staticCap.tier !== 'autonomous') {
          recommendations.push(`⬆️ 模型 ${label} 运行时表现优异, 建议升级为自主模式 (成功率 ${(stats.successRate * 100).toFixed(0)}%)`);
        } else if (dynCap.dynamicTier === 'supervised' && staticCap.tier !== 'supervised') {
          recommendations.push(`⬇️ 模型 ${label} 运行时表现不佳, 建议降级为监督模式 (成功率 ${(stats.successRate * 100).toFixed(0)}%)`);
        }
      }
      
      // 低工具调用成功率
      if (stats.sampleCount > 5 && stats.toolCallSuccessRate < 0.6) {
        recommendations.push(`⚠️ 模型 ${label} 工具调用成功率仅 ${(stats.toolCallSuccessRate * 100).toFixed(0)}%, 考虑减少可用工具或增加引导`);
      }
      
      // 高延迟
      if (stats.avgLatencyMs > 3000) {
        recommendations.push(`🐌 模型 ${label} 平均延迟 ${stats.avgLatencyMs.toFixed(0)}ms, 考虑切换到更快的模型`);
      }
    }
    
    // 按健康分排序
    modelReports.sort((a, b) => b.healthScore - a.healthScore);
    
    return {
      timestamp: Date.now(),
      trackedModels: this.getTrackedModels().length,
      totalSamples,
      models: modelReports,
      recommendations,
    };
  }
  
  // ═════════════════════════════════════════════════════════════════════════
  //  内部方法
  // ═════════════════════════════════════════════════════════════════════════
  
  /**
   * 获取或创建统计条目
   */
  private getOrCreate(modelId: string, taskType: TaskType): RuntimeStats {
    const key = `${modelId}::${taskType}`;
    let stats = this.matrix.get(key);
    if (!stats) {
      // LRU 淘汰
      if (this.matrix.size >= MAX_ENTRIES) {
        const oldestKey = this.findOldestKey();
        if (oldestKey) this.matrix.delete(oldestKey);
      }
      
      stats = {
        modelId,
        taskType,
        successRate: 0.5,
        toolCallSuccessRate: 0.5,
        qualityScore: 0.5,
        latencyScore: 0.5,
        sampleCount: 0,
        totalSuccess: 0,
        totalFailure: 0,
        avgIterations: 0,
        avgLatencyMs: 0,
        errorPatterns: {},
        diagnosisPatterns: {},
        lastUpdated: Date.now(),
        createdAt: Date.now(),
      };
      this.matrix.set(key, stats);
    }
    return stats;
  }
  
  /**
   * EMA 更新
   */
  private ema(current: number, newValue: number, alpha: number = EMA_ALPHA): number {
    return alpha * newValue + (1 - alpha) * current;
  }
  
  /**
   * 计算运行时数据权重
   * 样本越多, 运行时数据权重越大, 但不超过 MAX_RUNTIME_WEIGHT
   */
  private computeRuntimeWeight(sampleCount: number): number {
    return Math.min(sampleCount / SAMPLES_FOR_MAX_WEIGHT, 1.0) * MAX_RUNTIME_WEIGHT;
  }
  
  /**
   * 根据运行时表现计算动态等级
   * 核心逻辑: 运行时表现持续好 → 升级; 持续差 → 降级
   */
  private computeDynamicTier(
    staticCap: ModelCapability,
    dynamicOverall: number,
    stats: RuntimeStats,
  ): CapabilityTier {
    // 样本不足 5 个, 不改变等级
    if (stats.sampleCount < 5) return staticCap.tier;
    
    // 成功率极低 (< 40%) → 强制降级到 supervised
    if (stats.successRate < 0.40) return 'supervised';
    
    // 成功率高 + 工具调用好 + 动态分高 → 可升级
    if (dynamicOverall >= 0.65 && stats.successRate >= 0.75 && stats.toolCallSuccessRate >= 0.70) {
      return 'autonomous';
    }
    
    // 成功率中等 + 支持工具 → guided
    if (dynamicOverall >= 0.40 && stats.successRate >= 0.55) {
      return 'guided';
    }
    
    return 'supervised';
  }
  
  /**
   * 分类工具错误模式
   */
  private classifyToolError(toolName: string): string {
    // 按工具类别分类错误
    if (['read_file', 'write_file', 'multi_edit', 'list_directory'].includes(toolName)) {
      return 'file_error';
    }
    if (['run_code', 'create_tool'].includes(toolName)) {
      return 'execution_error';
    }
    if (['web_search', 'web_fetch'].includes(toolName)) {
      return 'network_error';
    }
    if (['search_codebase', 'search_content'].includes(toolName)) {
      return 'search_error';
    }
    return 'other_error';
  }
  
  /**
   * 找到最老的条目 (用于 LRU 淘汰)
   */
  private findOldestKey(): string | null {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [key, stats] of this.matrix) {
      if (stats.lastUpdated < oldestTime) {
        oldestTime = stats.lastUpdated;
        oldest = key;
      }
    }
    return oldest;
  }
  
  // ═════════════════════════════════════════════════════════════════════════
  //  持久化
  // ═════════════════════════════════════════════════════════════════════════
  
  /**
   * 防抖持久化
   */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }
  
  /**
   * 保存到磁盘
   */
  private persist(): void {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const data = {
        version: 1,
        savedAt: Date.now(),
        entries: [...this.matrix.values()],
      };
      fs.writeFileSync(MATRIX_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      // 容错: 持久化失败不影响运行
    }
  }
  
  /**
   * 从磁盘加载
   */
  private loadFromDisk(): void {
    if (this.loaded) return;
    this.loaded = true;
    
    try {
      if (!fs.existsSync(MATRIX_FILE)) return;
      const raw = fs.readFileSync(MATRIX_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (!data.entries || !Array.isArray(data.entries)) return;
      
      for (const entry of data.entries) {
        const key = `${entry.modelId}::${entry.taskType}`;
        this.matrix.set(key, entry);
      }
    } catch (e) {
      // 容错: 加载失败从空白开始
    }
  }
  
  /**
   * 强制刷新 (用于测试或 API 调用)
   */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
  }
}
