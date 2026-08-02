/**
 * A/B Testing Framework — A/B测试框架
 * --------------------------------------------
 * 支持Prompt、策略、模型的对比测试
 * 
 * 功能:
 * 1. 创建A/B测试实验
 * 2. 流量分配与分流
 * 3. 指标收集与统计
 * 4. 胜率计算与置信区间
 * 5. 自动选择优胜方案
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== 类型定义 =====

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
export type ExperimentType = 'prompt' | 'model' | 'strategy' | 'parameter';

export interface ExperimentVariant {
  id: string;
  name: string;
  description: string;
  // 变体配置
  config: {
    prompt?: string;
    model?: string;
    parameters?: Record<string, any>;
    strategy?: string;
  };
  // 流量分配比例 (0-1)
  trafficAllocation: number;
  // 统计
  stats: {
    impressions: number;
    successes: number;
    failures: number;
    avgLatency: number;
    avgTokenCost: number;
    userSatisfaction: number;
  };
}

export interface Experiment {
  id: string;
  name: string;
  description: string;
  type: ExperimentType;
  status: ExperimentStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  
  // 目标指标
  primaryMetric: 'success_rate' | 'latency' | 'cost' | 'satisfaction';
  secondaryMetrics: string[];
  
  // 变体
  variants: ExperimentVariant[];
  controlVariantId: string;
  
  // 目标样本量
  targetSampleSize: number;
  
  // 最小可检测效果
  mde: number; // Minimum Detectable Effect (e.g., 0.05 = 5%)
  
  // 置信水平
  confidenceLevel: number;
  
  // 结果
  winner?: string;
  results?: ExperimentResult;
}

export interface ExperimentResult {
  winnerId: string;
  confidence: number;
  uplift: number; // 相对提升
  pValue: number;
  sampleSize: number;
  duration: number;
  metrics: Record<string, {
    control: number;
    treatment: number;
    diff: number;
    confidenceInterval: [number, number];
  }>;
}

export interface Assignment {
  experimentId: string;
  variantId: string;
  userId: string;
  timestamp: number;
}

// ===== A/B测试框架 =====

export class ABTestingFramework extends EventEmitter {
  private experiments: Map<string, Experiment> = new Map();
  private assignments: Map<string, Assignment> = new Map(); // userId -> Assignment
  private abTestDir: string;

  constructor() {
    super();
    this.abTestDir = path.join(os.homedir(), '.agentai', 'ab-testing');
    this._ensureDir();
    this._loadExperiments();
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this.abTestDir)) {
      fs.mkdirSync(this.abTestDir, { recursive: true });
    }
  }

  private _loadExperiments(): void {
    try {
      const file = path.join(this.abTestDir, 'experiments.json');
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
        for (const exp of data.experiments || []) {
          this.experiments.set(exp.id, exp);
        }
      }
    } catch (e) {
      console.warn('[ab-testing] Failed to load experiments:', e);
    }
  }

  private _saveExperiments(): void {
    try {
      const file = path.join(this.abTestDir, 'experiments.json');
      const data = {
        updatedAt: Date.now(),
        experiments: Array.from(this.experiments.values()),
      };
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn('[ab-testing] Failed to save experiments:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 实验管理
  // ---------------------------------------------------------------------------

  /**
   * 创建新实验
   */
  createExperiment(params: {
    name: string;
    description: string;
    type: ExperimentType;
    primaryMetric: Experiment['primaryMetric'];
    variants: Omit<ExperimentVariant, 'id' | 'stats'>[];
    controlVariantId?: string;
    targetSampleSize?: number;
    mde?: number;
    confidenceLevel?: number;
  }): Experiment {
    const id = `exp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 为变体分配ID和初始化统计
    const variants: ExperimentVariant[] = params.variants.map((v, i) => ({
      ...v,
      id: `variant-${id}-${i}`,
      stats: {
        impressions: 0,
        successes: 0,
        failures: 0,
        avgLatency: 0,
        avgTokenCost: 0,
        userSatisfaction: 0,
      },
    }));

    // 默认第一个为对照组
    const controlId = params.controlVariantId || variants[0].id;

    // 验证流量分配总和为1
    const totalAllocation = variants.reduce((sum, v) => sum + v.trafficAllocation, 0);
    if (Math.abs(totalAllocation - 1) > 0.001) {
      // 自动归一化
      variants.forEach(v => v.trafficAllocation /= totalAllocation);
    }

    const experiment: Experiment = {
      id,
      name: params.name,
      description: params.description,
      type: params.type,
      status: 'draft',
      createdAt: Date.now(),
      primaryMetric: params.primaryMetric,
      secondaryMetrics: ['latency', 'cost', 'satisfaction'],
      variants,
      controlVariantId: controlId,
      targetSampleSize: params.targetSampleSize || 1000,
      mde: params.mde || 0.05,
      confidenceLevel: params.confidenceLevel || 0.95,
    };

    this.experiments.set(id, experiment);
    this._saveExperiments();
    
    this.emit('experiment:created', experiment);
    
    return experiment;
  }

  /**
   * 启动实验
   */
  startExperiment(experimentId: string): { success: boolean; message: string } {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return { success: false, message: '实验未找到' };
    }

    if (exp.status !== 'draft' && exp.status !== 'paused') {
      return { success: false, message: `无法从 ${exp.status} 状态启动` };
    }

    exp.status = 'running';
    exp.startedAt = Date.now();
    
    this._saveExperiments();
    this.emit('experiment:started', exp);
    
    return { success: true, message: '实验已启动' };
  }

  /**
   * 暂停实验
   */
  pauseExperiment(experimentId: string): { success: boolean; message: string } {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return { success: false, message: '实验未找到' };
    }

    if (exp.status !== 'running') {
      return { success: false, message: '只有运行中的实验可以暂停' };
    }

    exp.status = 'paused';
    this._saveExperiments();
    this.emit('experiment:paused', exp);
    
    return { success: true, message: '实验已暂停' };
  }

  /**
   * 停止实验并选择优胜者
   */
  completeExperiment(experimentId: string, winnerId?: string): { success: boolean; message: string; result?: ExperimentResult } {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return { success: false, message: '实验未找到' };
    }

    if (exp.status !== 'running' && exp.status !== 'paused') {
      return { success: false, message: '实验未在运行' };
    }

    // 计算结果
    const result = this._calculateResults(exp);
    
    // 如果没有指定winner，使用统计结果
    exp.winner = winnerId || result.winnerId;
    exp.results = result;
    exp.status = 'completed';
    exp.endedAt = Date.now();
    
    this._saveExperiments();
    this.emit('experiment:completed', exp);
    
    return { success: true, message: `实验已完成，优胜者: ${exp.winner}`, result };
  }

  /**
   * 删除实验
   */
  deleteExperiment(experimentId: string): { success: boolean; message: string } {
    const exp = this.experiments.get(experimentId);
    if (!exp) {
      return { success: false, message: '实验未找到' };
    }

    if (exp.status === 'running') {
      return { success: false, message: '请先停止运行中的实验' };
    }

    this.experiments.delete(experimentId);
    this._saveExperiments();
    
    return { success: true, message: '实验已删除' };
  }

  // ---------------------------------------------------------------------------
  // 流量分配
  // ---------------------------------------------------------------------------

  /**
   * 为用户分配实验变体
   */
  assignVariant(experimentId: string, userId: string): ExperimentVariant | null {
    const exp = this.experiments.get(experimentId);
    if (!exp || exp.status !== 'running') {
      return null;
    }

    // 检查是否已分配
    const existingKey = `${experimentId}:${userId}`;
    const existing = this.assignments.get(existingKey);
    if (existing) {
      return exp.variants.find(v => v.id === existing.variantId) || null;
    }

    // 基于用户ID的哈希进行确定性分配
    const hash = this._hashString(`${experimentId}:${userId}`);
    let cumulativeProbability = 0;

    for (const variant of exp.variants) {
      cumulativeProbability += variant.trafficAllocation;
      if (hash <= cumulativeProbability) {
        // 记录分配
        this.assignments.set(existingKey, {
          experimentId,
          variantId: variant.id,
          userId,
          timestamp: Date.now(),
        });
        
        // 增加曝光计数
        variant.stats.impressions++;
        this._saveExperiments();
        
        return variant;
      }
    }

    // 默认返回最后一个
    return exp.variants[exp.variants.length - 1];
  }

  /**
   * 记录实验结果
   */
  recordOutcome(experimentId: string, variantId: string, outcome: {
    success: boolean;
    latency: number;
    tokenCost: number;
    userSatisfaction?: number;
  }): void {
    const exp = this.experiments.get(experimentId);
    if (!exp) return;

    const variant = exp.variants.find(v => v.id === variantId);
    if (!variant) return;

    // 更新统计
    if (outcome.success) {
      variant.stats.successes++;
    } else {
      variant.stats.failures++;
    }

    // 更新平均值
    const n = variant.stats.impressions;
    variant.stats.avgLatency = (variant.stats.avgLatency * (n - 1) + outcome.latency) / n;
    variant.stats.avgTokenCost = (variant.stats.avgTokenCost * (n - 1) + outcome.tokenCost) / n;
    
    if (outcome.userSatisfaction !== undefined) {
      variant.stats.userSatisfaction = (variant.stats.userSatisfaction * (n - 1) + outcome.userSatisfaction) / n;
    }

    this._saveExperiments();
    this.emit('experiment:outcome', { experimentId, variantId, outcome });

    // 检查是否达到目标样本量
    const totalSamples = exp.variants.reduce((sum, v) => sum + v.stats.impressions, 0);
    if (totalSamples >= exp.targetSampleSize && exp.status === 'running') {
      this.emit('experiment:sample_size_reached', exp);
    }
  }

  // ---------------------------------------------------------------------------
  // 统计分析
  // ---------------------------------------------------------------------------

  private _calculateResults(exp: Experiment): ExperimentResult {
    const control = exp.variants.find(v => v.id === exp.controlVariantId);
    const treatments = exp.variants.filter(v => v.id !== exp.controlVariantId);
    
    if (!control || treatments.length === 0) {
      throw new Error('无效的实验配置');
    }

    // 选择最佳处理组
    let bestTreatment = treatments[0];
    let bestMetric = this._getMetricValue(bestTreatment, exp.primaryMetric);
    
    for (const treatment of treatments.slice(1)) {
      const metric = this._getMetricValue(treatment, exp.primaryMetric);
      if (metric > bestMetric) {
        bestTreatment = treatment;
        bestMetric = metric;
      }
    }

    const controlMetric = this._getMetricValue(control, exp.primaryMetric);
    const uplift = controlMetric > 0 ? (bestMetric - controlMetric) / controlMetric : 0;
    
    // 简化的统计检验 (实际应使用更严格的统计方法)
    const pValue = this._calculatePValue(control, bestTreatment, exp.primaryMetric);
    const confidence = 1 - pValue;

    const result: ExperimentResult = {
      winnerId: confidence >= exp.confidenceLevel ? bestTreatment.id : control.id,
      confidence,
      uplift,
      pValue,
      sampleSize: exp.variants.reduce((sum, v) => sum + v.stats.impressions, 0),
      duration: exp.endedAt && exp.startedAt ? exp.endedAt - exp.startedAt : 0,
      metrics: {
        [exp.primaryMetric]: {
          control: controlMetric,
          treatment: bestMetric,
          diff: bestMetric - controlMetric,
          confidenceInterval: this._calculateConfidenceInterval(control, bestTreatment, exp.primaryMetric),
        },
      },
    };

    // 添加次要指标
    for (const metric of exp.secondaryMetrics) {
      const controlVal = this._getMetricValue(control, metric as any);
      const treatmentVal = this._getMetricValue(bestTreatment, metric as any);
      result.metrics[metric] = {
        control: controlVal,
        treatment: treatmentVal,
        diff: treatmentVal - controlVal,
        confidenceInterval: [0, 0], // 简化
      };
    }

    return result;
  }

  private _getMetricValue(variant: ExperimentVariant, metric: Experiment['primaryMetric']): number {
    switch (metric) {
      case 'success_rate':
        return variant.stats.impressions > 0 
          ? variant.stats.successes / variant.stats.impressions 
          : 0;
      case 'latency':
        return variant.stats.avgLatency;
      case 'cost':
        return variant.stats.avgTokenCost;
      case 'satisfaction':
        return variant.stats.userSatisfaction;
      default:
        return 0;
    }
  }

  private _calculatePValue(control: ExperimentVariant, treatment: ExperimentVariant, metric: Experiment['primaryMetric']): number {
    // 简化实现：使用两比例z检验的近似
    const p1 = this._getMetricValue(control, metric);
    const p2 = this._getMetricValue(treatment, metric);
    const n1 = control.stats.impressions;
    const n2 = treatment.stats.impressions;

    if (n1 === 0 || n2 === 0) return 1;

    const p = (p1 * n1 + p2 * n2) / (n1 + n2);
    const se = Math.sqrt(p * (1 - p) * (1/n1 + 1/n2));
    
    if (se === 0) return 1;

    const z = Math.abs(p1 - p2) / se;
    
    // 简化的p值计算 (标准正态分布尾部概率)
    return 2 * (1 - this._normalCDF(z));
  }

  private _calculateConfidenceInterval(control: ExperimentVariant, treatment: ExperimentVariant, metric: Experiment['primaryMetric']): [number, number] {
    const diff = this._getMetricValue(treatment, metric) - this._getMetricValue(control, metric);
    const se = Math.sqrt(
      (this._getMetricValue(control, metric) * (1 - this._getMetricValue(control, metric))) / control.stats.impressions +
      (this._getMetricValue(treatment, metric) * (1 - this._getMetricValue(treatment, metric))) / treatment.stats.impressions
    );
    
    const margin = 1.96 * se; // 95% CI
    return [diff - margin, diff + margin];
  }

  private _normalCDF(x: number): number {
    // 简化的标准正态CDF
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
  }

  private _hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    // 归一化到0-1
    return (Math.abs(hash) % 10000) / 10000;
  }

  // ---------------------------------------------------------------------------
  // 公共API
  // ---------------------------------------------------------------------------

  /**
   * 获取所有实验
   */
  getExperiments(status?: ExperimentStatus): Experiment[] {
    const exps = Array.from(this.experiments.values());
    if (status) {
      return exps.filter(e => e.status === status);
    }
    return exps;
  }

  /**
   * 获取单个实验
   */
  getExperiment(id: string): Experiment | undefined {
    return this.experiments.get(id);
  }

  /**
   * 获取实验统计
   */
  getExperimentStats(experimentId: string): {
    totalSamples: number;
    daysRunning: number;
    currentWinner: string;
    confidence: number;
  } | null {
    const exp = this.experiments.get(experimentId);
    if (!exp) return null;

    const totalSamples = exp.variants.reduce((sum, v) => sum + v.stats.impressions, 0);
    const daysRunning = exp.startedAt 
      ? Math.floor((Date.now() - exp.startedAt) / (24 * 60 * 60 * 1000))
      : 0;

    // 计算当前领先者
    let bestVariant = exp.variants[0];
    let bestMetric = this._getMetricValue(bestVariant, exp.primaryMetric);
    
    for (const variant of exp.variants.slice(1)) {
      const metric = this._getMetricValue(variant, exp.primaryMetric);
      if (metric > bestMetric) {
        bestVariant = variant;
        bestMetric = metric;
      }
    }

    return {
      totalSamples,
      daysRunning,
      currentWinner: bestVariant.name,
      confidence: exp.results?.confidence || 0,
    };
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _abTesting: ABTestingFramework | null = null;

export function getABTestingFramework(): ABTestingFramework {
  if (!_abTesting) {
    _abTesting = new ABTestingFramework();
  }
  return _abTesting;
}
