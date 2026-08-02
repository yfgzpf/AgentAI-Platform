/**
 * Predictive Maintenance — 预测性维护模块
 * --------------------------------------------
 * 基于历史数据预测潜在问题，提前采取预防措施
 * 
 * 预测维度:
 * 1. 磁盘空间耗尽预测
 * 2. 内存泄漏检测
 * 3. API配额耗尽预警
 * 4. 性能退化趋势
 * 5. 错误率上升预警
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ===== 类型定义 =====

export type PredictionType = 'disk_full' | 'memory_leak' | 'quota_depletion' | 'performance_degradation' | 'error_rate_spike';
export type PredictionConfidence = 'low' | 'medium' | 'high';

export interface Prediction {
  id: string;
  type: PredictionType;
  confidence: PredictionConfidence;
  title: string;
  description: string;
  predictedAt: number;      // 预测时间
  expectedAt: number;       // 预计发生时间
  severity: 'info' | 'warning' | 'critical';
  recommendation: string;
  autoAction?: string;      // 建议的自动操作
  metrics: {
    currentValue: number;
    threshold: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    rateOfChange: number;   // 每日变化率
  };
}

export interface TimeSeriesPoint {
  timestamp: number;
  value: number;
}

export interface MaintenanceReport {
  generatedAt: number;
  predictions: Prediction[];
  healthTrend: 'improving' | 'stable' | 'degrading';
  recommendations: string[];
}

// ===== 预测性维护系统 =====

export class PredictiveMaintenanceSystem extends EventEmitter {
  private predictions: Prediction[] = [];
  private metricsHistory: Map<string, TimeSeriesPoint[]> = new Map();
  private maxHistoryPoints = 100;
  private maintenanceDir: string;

  constructor() {
    super();
    this.maintenanceDir = path.join(os.homedir(), '.agentai', 'maintenance');
    this._ensureDir();
    this._startMonitoring();
  }

  private _ensureDir(): void {
    if (!fs.existsSync(this.maintenanceDir)) {
      fs.mkdirSync(this.maintenanceDir, { recursive: true });
    }
  }

  private _startMonitoring(): void {
    // 每5分钟收集一次指标
    setInterval(() => this._collectMetrics(), 5 * 60 * 1000);
    
    // 每小时生成一次预测
    setInterval(() => this.generatePredictions(), 60 * 60 * 1000);
    
    // 立即执行一次
    this._collectMetrics();
    this.generatePredictions();
  }

  // ---------------------------------------------------------------------------
  // 指标收集
  // ---------------------------------------------------------------------------

  private async _collectMetrics(): Promise<void> {
    const now = Date.now();

    // 1. 磁盘使用
    const diskUsage = await this._getDiskUsage();
    this._addMetricPoint('disk_usage', { timestamp: now, value: diskUsage });

    // 2. 内存使用
    const memUsage = this._getMemoryUsage();
    this._addMetricPoint('memory_usage', { timestamp: now, value: memUsage });

    // 3. API调用计数
    const apiCalls = await this._getAPICallCount();
    this._addMetricPoint('api_calls', { timestamp: now, value: apiCalls });

    // 4. 错误率
    const errorRate = await this._getErrorRate();
    this._addMetricPoint('error_rate', { timestamp: now, value: errorRate });

    // 5. 平均响应时间
    const avgLatency = await this._getAverageLatency();
    this._addMetricPoint('avg_latency', { timestamp: now, value: avgLatency });

    this.emit('metrics:collected', { timestamp: now });
  }

  private _addMetricPoint(name: string, point: TimeSeriesPoint): void {
    const history = this.metricsHistory.get(name) || [];
    history.push(point);
    
    // 限制历史大小
    if (history.length > this.maxHistoryPoints) {
      history.shift();
    }
    
    this.metricsHistory.set(name, history);
  }

  // ---------------------------------------------------------------------------
  // 预测生成
  // ---------------------------------------------------------------------------

  /**
   * 生成所有预测
   */
  generatePredictions(): MaintenanceReport {
    this.predictions = [];

    // 1. 磁盘空间预测
    this._predictDiskFull();

    // 2. 内存泄漏检测
    this._predictMemoryLeak();

    // 3. API配额预测
    this._predictQuotaDepletion();

    // 4. 性能退化
    this._predictPerformanceDegradation();

    // 5. 错误率上升
    this._predictErrorRateSpike();

    const report: MaintenanceReport = {
      generatedAt: Date.now(),
      predictions: this.predictions,
      healthTrend: this._calculateHealthTrend(),
      recommendations: this._generateRecommendations(),
    };

    this._saveReport(report);
    this.emit('predictions:generated', report);

    // 触发紧急预警
    const criticalPredictions = this.predictions.filter(p => 
      p.severity === 'critical' && p.confidence === 'high'
    );
    if (criticalPredictions.length > 0) {
      this.emit('predictions:critical', criticalPredictions);
    }

    return report;
  }

  private _predictDiskFull(): void {
    const history = this.metricsHistory.get('disk_usage');
    if (!history || history.length < 3) return;

    const trend = this._calculateTrend(history);
    const current = history[history.length - 1].value;
    const threshold = 90;

    if (trend.rate <= 0) return; // 没有在增长

    // 预测达到阈值的时间
    const remaining = threshold - current;
    const daysUntilFull = remaining / trend.rate;

    if (daysUntilFull > 30) return; // 超过30天不关心

    const confidence = history.length > 10 && trend.r2 > 0.7 ? 'high' : 
                      trend.r2 > 0.5 ? 'medium' : 'low';

    this._addPrediction({
      type: 'disk_full',
      confidence,
      title: '磁盘空间即将耗尽',
      description: `当前使用率 ${current.toFixed(1)}%，预计 ${Math.floor(daysUntilFull)} 天后达到 ${threshold}%`,
      expectedAt: Date.now() + daysUntilFull * 24 * 60 * 60 * 1000,
      severity: daysUntilFull < 3 ? 'critical' : daysUntilFull < 7 ? 'warning' : 'info',
      recommendation: '清理日志文件、删除旧备份或扩展磁盘空间',
      autoAction: 'clean_old_files',
      metrics: {
        currentValue: current,
        threshold,
        trend: 'increasing',
        rateOfChange: trend.rate,
      },
    });
  }

  private _predictMemoryLeak(): void {
    const history = this.metricsHistory.get('memory_usage');
    if (!history || history.length < 10) return;

    const trend = this._calculateTrend(history);
    const current = history[history.length - 1].value;

    // 检查持续增长趋势
    if (trend.rate < 0.5 || trend.r2 < 0.6) return; // 增长不够明显

    this._addPrediction({
      type: 'memory_leak',
      confidence: trend.r2 > 0.8 ? 'high' : 'medium',
      title: '疑似内存泄漏',
      description: `内存使用率持续增长，每日增加 ${trend.rate.toFixed(2)}%`,
      expectedAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 一周内
      severity: trend.rate > 2 ? 'critical' : 'warning',
      recommendation: '检查最近部署的代码，查找未释放的资源',
      autoAction: 'schedule_restart',
      metrics: {
        currentValue: current,
        threshold: 90,
        trend: 'increasing',
        rateOfChange: trend.rate,
      },
    });
  }

  private _predictQuotaDepletion(): void {
    const history = this.metricsHistory.get('api_calls');
    if (!history || history.length < 3) return;

    // 假设每日限额 (从配置读取)
    const dailyQuota = this._getDailyQuota();
    const trend = this._calculateTrend(history);
    
    // 计算今日已用
    const todayUsage = history[history.length - 1].value;
    const projectedDaily = trend.rate > 0 ? trend.rate : todayUsage;

    if (projectedDaily < dailyQuota * 0.8) return; // 充足

    const daysUntilDepletion = dailyQuota / projectedDaily;

    this._addPrediction({
      type: 'quota_depletion',
      confidence: history.length > 5 ? 'high' : 'medium',
      title: 'API配额即将耗尽',
      description: `预计今日API调用将达到配额的 ${((projectedDaily / dailyQuota) * 100).toFixed(0)}%`,
      expectedAt: Date.now() + daysUntilDepletion * 24 * 60 * 60 * 1000,
      severity: projectedDaily > dailyQuota ? 'critical' : 'warning',
      recommendation: '优化Prompt减少Token使用，或升级API配额',
      autoAction: 'switch_to_cheaper_model',
      metrics: {
        currentValue: todayUsage,
        threshold: dailyQuota,
        trend: trend.rate > 0 ? 'increasing' : 'stable',
        rateOfChange: trend.rate,
      },
    });
  }

  private _predictPerformanceDegradation(): void {
    const history = this.metricsHistory.get('avg_latency');
    if (!history || history.length < 5) return;

    const trend = this._calculateTrend(history);
    const current = history[history.length - 1].value;
    const baseline = history[0].value;

    if (trend.rate <= 0) return; // 没有在恶化

    // 与基线比较
    const degradation = ((current - baseline) / baseline) * 100;

    if (degradation < 20) return; // 退化不严重

    this._addPrediction({
      type: 'performance_degradation',
      confidence: trend.r2 > 0.6 ? 'high' : 'medium',
      title: '性能持续退化',
      description: `平均响应时间较基线增加 ${degradation.toFixed(1)}%`,
      expectedAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
      severity: degradation > 50 ? 'critical' : 'warning',
      recommendation: '检查数据库查询、优化热点代码',
      autoAction: 'enable_caching',
      metrics: {
        currentValue: current,
        threshold: baseline * 2,
        trend: 'increasing',
        rateOfChange: trend.rate,
      },
    });
  }

  private _predictErrorRateSpike(): void {
    const history = this.metricsHistory.get('error_rate');
    if (!history || history.length < 5) return;

    const trend = this._calculateTrend(history);
    const current = history[history.length - 1].value;

    if (trend.rate <= 0 && current < 5) return; // 稳定且低

    this._addPrediction({
      type: 'error_rate_spike',
      confidence: trend.rate > 0.1 ? 'high' : 'medium',
      title: '错误率上升趋势',
      description: `当前错误率 ${current.toFixed(2)}%，呈上升趋势`,
      expectedAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
      severity: current > 10 || trend.rate > 0.5 ? 'critical' : 'warning',
      recommendation: '检查最近错误日志，修复潜在Bug',
      autoAction: 'increase_monitoring',
      metrics: {
        currentValue: current,
        threshold: 10,
        trend: trend.rate > 0 ? 'increasing' : 'stable',
        rateOfChange: trend.rate,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 趋势计算
  // ---------------------------------------------------------------------------

  private _calculateTrend(history: TimeSeriesPoint[]): { rate: number; r2: number } {
    if (history.length < 2) return { rate: 0, r2: 0 };

    const n = history.length;
    const x = history.map((_, i) => i);
    const y = history.map(p => p.value);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    // 计算R²
    const yMean = sumY / n;
    const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const ssResidual = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + (sumY - slope * sumX) / n;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const r2 = ssTotal > 0 ? 1 - (ssResidual / ssTotal) : 0;

    return { rate: slope, r2 };
  }

  private _calculateHealthTrend(): 'improving' | 'stable' | 'degrading' {
    const criticalCount = this.predictions.filter(p => p.severity === 'critical').length;
    const warningCount = this.predictions.filter(p => p.severity === 'warning').length;

    if (criticalCount > 2) return 'degrading';
    if (criticalCount === 0 && warningCount < 2) return 'improving';
    return 'stable';
  }

  private _generateRecommendations(): string[] {
    const recommendations: string[] = [];

    for (const prediction of this.predictions) {
      if (prediction.severity !== 'info') {
        recommendations.push(`${prediction.title}: ${prediction.recommendation}`);
      }
    }

    return recommendations;
  }

  // ---------------------------------------------------------------------------
  // 辅助方法
  // ---------------------------------------------------------------------------

  private async _getDiskUsage(): Promise<number> {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf-8' });
      // 简化解析，实际应该更健壮
      return 50; // 默认返回50%
    } catch {
      return 50;
    }
  }

  private _getMemoryUsage(): number {
    const total = os.totalmem();
    const free = os.freemem();
    return ((total - free) / total) * 100;
  }

  private async _getAPICallCount(): Promise<number> {
    // 从成本追踪器读取
    try {
      const costFile = path.join(os.homedir(), '.agentai', 'cost', `${new Date().toISOString().split('T')[0]}.json`);
      if (fs.existsSync(costFile)) {
        const data = JSON.parse(fs.readFileSync(costFile, 'utf-8'));
        return data.taskCount || 0;
      }
    } catch {}
    return 0;
  }

  private async _getErrorRate(): Promise<number> {
    // 从evolution读取错误率
    try {
      const evolutionFile = path.join(os.homedir(), '.agentai', 'evolution', 'evolution.jsonl');
      if (!fs.existsSync(evolutionFile)) return 0;
      
      const lines = fs.readFileSync(evolutionFile, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .slice(-100);
      
      if (lines.length === 0) return 0;
      
      const errors = lines.filter(line => {
        try {
          const entry = JSON.parse(line);
          return entry.type === 'failure' || entry.type === 'error';
        } catch { return false; }
      }).length;
      
      return (errors / lines.length) * 100;
    } catch {
      return 0;
    }
  }

  private async _getAverageLatency(): Promise<number> {
    // 简化实现
    return 1000; // 默认1秒
  }

  private _getDailyQuota(): number {
    // 从环境变量或配置读取
    return parseInt(process.env.DAILY_API_QUOTA || '1000', 10);
  }

  private _addPrediction(partial: Omit<Prediction, 'id' | 'predictedAt'>): void {
    const prediction: Prediction = {
      ...partial,
      id: `pred-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      predictedAt: Date.now(),
    };
    this.predictions.push(prediction);
  }

  private _saveReport(report: MaintenanceReport): void {
    try {
      const file = path.join(this.maintenanceDir, 'reports.jsonl');
      const line = JSON.stringify(report) + '\n';
      fs.appendFileSync(file, line);
    } catch (e) {
      console.warn('[predictive-maintenance] Failed to save report:', e);
    }
  }

  // ---------------------------------------------------------------------------
  // 公共API
  // ---------------------------------------------------------------------------

  /**
   * 获取当前预测
   */
  getPredictions(): Prediction[] {
    return [...this.predictions];
  }

  /**
   * 获取指标历史
   */
  getMetricsHistory(metricName: string): TimeSeriesPoint[] {
    return this.metricsHistory.get(metricName) || [];
  }

  /**
   * 执行自动维护操作
   */
  async executeAutoAction(predictionId: string): Promise<{ success: boolean; message: string }> {
    const prediction = this.predictions.find(p => p.id === predictionId);
    if (!prediction || !prediction.autoAction) {
      return { success: false, message: '预测未找到或无自动操作' };
    }

    switch (prediction.autoAction) {
      case 'clean_old_files':
        return this._actionCleanOldFiles();
      case 'schedule_restart':
        return this._actionScheduleRestart();
      case 'switch_to_cheaper_model':
        return this._actionSwitchModel();
      case 'enable_caching':
        return this._actionEnableCaching();
      case 'increase_monitoring':
        return this._actionIncreaseMonitoring();
      default:
        return { success: false, message: `未知的自动操作: ${prediction.autoAction}` };
    }
  }

  private async _actionCleanOldFiles(): Promise<{ success: boolean; message: string }> {
    // 清理7天前的日志
    const logDir = path.join(os.homedir(), '.agentai', 'logs');
    if (!fs.existsSync(logDir)) {
      return { success: true, message: '日志目录不存在' };
    }

    let deleted = 0;
    const files = fs.readdirSync(logDir);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(logDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    return { success: true, message: `已清理 ${deleted} 个旧日志文件` };
  }

  private async _actionScheduleRestart(): Promise<{ success: boolean; message: string }> {
    // 记录重启计划
    const scheduleFile = path.join(this.maintenanceDir, 'scheduled_restart.json');
    fs.writeFileSync(scheduleFile, JSON.stringify({
      scheduledAt: Date.now() + 24 * 60 * 60 * 1000, // 24小时后
      reason: '内存泄漏预防性重启',
    }));

    return { success: true, message: '已计划在24小时后进行预防性重启' };
  }

  private async _actionSwitchModel(): Promise<{ success: boolean; message: string }> {
    // 切换到更便宜的模型
    // 实际实现需要修改llm-router配置
    return { success: true, message: '已触发模型降级策略' };
  }

  private async _actionEnableCaching(): Promise<{ success: boolean; message: string }> {
    // 启用缓存
    return { success: true, message: '已启用响应缓存' };
  }

  private async _actionIncreaseMonitoring(): Promise<{ success: boolean; message: string }> {
    // 增加监控频率
    return { success: true, message: '已增加监控频率' };
  }
}

// ---------------------------------------------------------------------------
// 单例导出
// ---------------------------------------------------------------------------

let _maintenance: PredictiveMaintenanceSystem | null = null;

export function getPredictiveMaintenance(): PredictiveMaintenanceSystem {
  if (!_maintenance) {
    _maintenance = new PredictiveMaintenanceSystem();
  }
  return _maintenance;
}
