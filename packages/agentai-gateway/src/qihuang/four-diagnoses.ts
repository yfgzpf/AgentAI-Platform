/**
 * 岐枢四诊系统 (Qihuang Four Diagnoses System)
 * ----------------------------------------------------
 * 将中医"望闻问切"四诊理念映射到 AI 智能体系统：
 *
 * 望 (Observation) - 视觉感知层
 *   └─ 系统状态观察、代码结构扫描、运行时监控
 *
 * 闻 (Auscultation) - 听觉/监听层
 *   └─ 日志监听、事件流分析、用户反馈收集
 *
 * 问 (Inquiry) - 交互问询层
 *   └─ 歧义检测、主动追问、需求澄清
 *
 * 切 (Palpation) - 深度分析层
 *   └─ 根因诊断、模式识别、决策推理
 *
 * @module qihuang/four-diagnoses
 * @see docs/QIHUANG_DESIGN.md
 */

import { AgentAIRouter } from '../llm-router.js';

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/** 四诊类型 */
export type DiagnosisType = 'wang' | 'wen' | 'wen-question' | 'qie';

/** 望诊 - 观察数据 */
export interface WangData {
  // 代码层面
  codeMetrics: {
    fileCount: number;
    lineCount: number;
    complexity: number;
    testCoverage: number;
  };
  // 运行时状态
  runtimeStatus: {
    memoryUsage: number;
    cpuUsage: number;
    activeConnections: number;
    queueLength: number;
  };
  // 系统健康度
  healthScore: number;
  anomalies: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
  }>;
}

/** 闻诊 - 监听数据 */
export interface WenData {
  // 日志分析
  logPatterns: Array<{
    level: 'info' | 'warn' | 'error' | 'fatal';
    pattern: string;
    frequency: number;
    trend: 'increasing' | 'stable' | 'decreasing';
  }>;
  // 错误聚类
  errorClusters: Array<{
    errorType: string;
    count: number;
    stackSignature: string;
    affectedComponents: string[];
  }>;
  // 性能指标
  performanceMetrics: {
    avgResponseTime: number;
    p95ResponseTime: number;
    errorRate: number;
    throughput: number;
  };
}

/** 问诊 - 交互数据 */
export interface WenQuestionData {
  // 用户意图
  userIntent: {
    primary: string;
    secondary: string[];
    confidence: number;
  };
  // 歧义检测
  ambiguities: Array<{
    type: 'vague_verb' | 'unclear_reference' | 'fuzzy_description' | 'unresolved_choice';
    text: string;
    suggestions: string[];
  }>;
  // 信息缺口
  informationGaps: string[];
  // 建议追问
  suggestedQuestions: string[];
}

/** 切诊 - 分析数据 */
export interface QieData {
  // 根因分析
  rootCauses: Array<{
    problem: string;
    cause: string;
    evidence: string[];
    confidence: number;
  }>;
  // 模式识别
  patterns: Array<{
    name: string;
    description: string;
    occurrences: number;
    impact: 'low' | 'medium' | 'high';
  }>;
  // 诊断结论
  diagnosis: {
    summary: string;
    severity: 'healthy' | 'suboptimal' | 'degraded' | 'critical';
    affectedSystems: string[];
  };
  // 治疗建议
  prescriptions: Array<{
    priority: number;
    action: string;
    expectedOutcome: string;
    risk: 'low' | 'medium' | 'high';
  }>;
}

/** 四诊合参 - 综合诊断 */
export interface FourDiagnosesResult {
  timestamp: number;
  wang: WangData;
  wen: WenData;
  wenQuestion: WenQuestionData;
  qie: QieData;
  // 综合判断
  holisticAssessment: {
    overallHealth: number; // 0-100
    primaryConcern: string;
    secondaryConcerns: string[];
    recommendedAction: string;
  };
}

// ═══════════════════════════════════════════════════════════
// 望诊实现 (Observation)
// ═══════════════════════════════════════════════════════════

export class WangDiagnosis {
  async observe(): Promise<WangData> {
    return {
      codeMetrics: await this.scanCodeMetrics(),
      runtimeStatus: await this.collectRuntimeMetrics(),
      healthScore: 0,
      anomalies: [],
    };
  }

  private async scanCodeMetrics(): Promise<WangData['codeMetrics']> {
    // TODO: 集成代码分析工具
    return {
      fileCount: 0,
      lineCount: 0,
      complexity: 0,
      testCoverage: 0,
    };
  }

  private async collectRuntimeMetrics(): Promise<WangData['runtimeStatus']> {
    // TODO: 集成系统监控
    return {
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
      cpuUsage: 0,
      activeConnections: 0,
      queueLength: 0,
    };
  }

  /** 检测异常模式 */
  detectAnomalies(data: WangData): WangData['anomalies'] {
    const anomalies: WangData['anomalies'] = [];

    // 内存使用异常
    if (data.runtimeStatus.memoryUsage > 1024) {
      anomalies.push({
        type: 'memory_usage',
        severity: 'high',
        description: `内存使用过高: ${data.runtimeStatus.memoryUsage.toFixed(0)}MB`,
      });
    }

    // 队列堆积
    if (data.runtimeStatus.queueLength > 100) {
      anomalies.push({
        type: 'queue_backlog',
        severity: 'critical',
        description: `任务队列堆积: ${data.runtimeStatus.queueLength} 个任务`,
      });
    }

    return anomalies;
  }
}

// ═══════════════════════════════════════════════════════════
// 闻诊实现 (Auscultation)
// ═══════════════════════════════════════════════════════════

export class WenDiagnosis {
  private logBuffer: string[] = [];

  /** 收集日志 */
  collectLog(level: string, message: string, meta?: any): void {
    this.logBuffer.push(JSON.stringify({ level, message, meta, ts: Date.now() }));
    if (this.logBuffer.length > 1000) {
      this.logBuffer = this.logBuffer.slice(-500);
    }
  }

  async analyze(): Promise<WenData> {
    return {
      logPatterns: this.analyzeLogPatterns(),
      errorClusters: this.clusterErrors(),
      performanceMetrics: await this.analyzePerformance(),
    };
  }

  private analyzeLogPatterns(): WenData['logPatterns'] {
    // 简单的日志模式分析
    const patterns: Map<string, { level: string; count: number }> = new Map();

    for (const log of this.logBuffer) {
      try {
        const parsed = JSON.parse(log);
        const key = `${parsed.level}:${parsed.message.slice(0, 50)}`;
        const existing = patterns.get(key);
        if (existing) {
          existing.count++;
        } else {
          patterns.set(key, { level: parsed.level, count: 1 });
        }
      } catch {
        // 忽略解析错误
      }
    }

    return [...patterns.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([pattern, data]) => ({
        level: data.level as any,
        pattern,
        frequency: data.count,
        trend: 'stable',
      }));
  }

  private clusterErrors(): WenData['errorClusters'] {
    // TODO: 实现错误聚类算法
    return [];
  }

  private async analyzePerformance(): Promise<WenData['performanceMetrics']> {
    // TODO: 集成性能监控
    return {
      avgResponseTime: 0,
      p95ResponseTime: 0,
      errorRate: 0,
      throughput: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// 问诊实现 (Inquiry)
// ═══════════════════════════════════════════════════════════

export class WenQuestionDiagnosis {
  /** 分析用户输入，检测歧义 */
  analyzeInput(input: string): WenQuestionData {
    const ambiguities = this.detectAmbiguities(input);
    const informationGaps = this.identifyGaps(input);

    return {
      userIntent: this.extractIntent(input),
      ambiguities,
      informationGaps,
      suggestedQuestions: this.generateQuestions(ambiguities, informationGaps),
    };
  }

  private detectAmbiguities(input: string): WenQuestionData['ambiguities'] {
    const ambiguities: WenQuestionData['ambiguities'] = [];

    // 模糊动词检测
    const vagueVerbs = ['搞', '弄', '整', '处理', '看看'];
    for (const verb of vagueVerbs) {
      if (input.includes(verb)) {
        ambiguities.push({
          type: 'vague_verb',
          text: verb,
          suggestions: ['请具体说明操作类型', '例如：创建、修改、删除、查询'],
        });
      }
    }

    // 指代不明检测
    const unclearRefs = ['这个', '那个', '它', '这里'];
    for (const ref of unclearRefs) {
      if (input.includes(ref)) {
        ambiguities.push({
          type: 'unclear_reference',
          text: ref,
          suggestions: ['请明确指定对象名称或路径'],
        });
      }
    }

    // 模糊描述检测
    const fuzzyDescs = ['好看', '差不多', '合适', '优化'];
    for (const desc of fuzzyDescs) {
      if (input.includes(desc)) {
        ambiguities.push({
          type: 'fuzzy_description',
          text: desc,
          suggestions: ['请提供具体标准或示例'],
        });
      }
    }

    // 未决选择检测
    const choicePatterns = ['还是', '或者', '哪一个'];
    for (const pattern of choicePatterns) {
      if (input.includes(pattern)) {
        ambiguities.push({
          type: 'unresolved_choice',
          text: pattern,
          suggestions: ['请明确选择其中一个选项'],
        });
      }
    }

    return ambiguities;
  }

  private identifyGaps(input: string): string[] {
    const gaps: string[] = [];

    // 缺少目标路径
    if (/修改|创建|删除/.test(input) && !/文件|路径|目录/.test(input)) {
      gaps.push('缺少目标文件或路径信息');
    }

    // 缺少具体标准
    if (/优化|改进/.test(input) && !/性能|内存|速度/.test(input)) {
      gaps.push('缺少优化目标和标准');
    }

    return gaps;
  }

  private extractIntent(input: string): WenQuestionData['userIntent'] {
    // 简单的意图提取
    const intents: Record<string, string> = {
      '创建': 'create',
      '修改': 'modify',
      '删除': 'delete',
      '查询': 'query',
      '分析': 'analyze',
      '优化': 'optimize',
    };

    let primary = 'general';
    for (const [cn, en] of Object.entries(intents)) {
      if (input.includes(cn)) {
        primary = en;
        break;
      }
    }

    return {
      primary,
      secondary: [],
      confidence: 0.7,
    };
  }

  private generateQuestions(
    ambiguities: WenQuestionData['ambiguities'],
    gaps: string[]
  ): string[] {
    const questions: string[] = [];

    for (const a of ambiguities) {
      questions.push(`关于"${a.text}"：${a.suggestions[0]}`);
    }

    for (const g of gaps) {
      questions.push(`信息缺口：${g}`);
    }

    return questions;
  }
}

// ═══════════════════════════════════════════════════════════
// 切诊实现 (Palpation)
// ═══════════════════════════════════════════════════════════

export class QieDiagnosis {
  private llmRouter: AgentAIRouter;

  constructor(llmRouter: AgentAIRouter) {
    this.llmRouter = llmRouter;
  }

  /** 深度分析 */
  async analyze(
    wang: WangData,
    wen: WenData,
    wenQuestion: WenQuestionData
  ): Promise<QieData> {
    const rootCauses = await this.identifyRootCauses(wang, wen);
    const patterns = this.recognizePatterns(wang, wen);
    const diagnosis = this.formulateDiagnosis(wang, wen, rootCauses);
    const prescriptions = this.generatePrescriptions(rootCauses, patterns);

    return {
      rootCauses,
      patterns,
      diagnosis,
      prescriptions,
    };
  }

  private async identifyRootCauses(
    wang: WangData,
    wen: WenData
  ): Promise<QieData['rootCauses']> {
    const causes: QieData['rootCauses'] = [];

    // 基于异常检测根因
    for (const anomaly of wang.anomalies) {
      causes.push({
        problem: anomaly.description,
        cause: this.inferCause(anomaly),
        evidence: [`望诊发现: ${anomaly.type}`],
        confidence: 0.8,
      });
    }

    // 基于错误聚类检测根因
    for (const cluster of wen.errorClusters.slice(0, 3)) {
      causes.push({
        problem: `${cluster.errorType} 错误高发`,
        cause: `组件 ${cluster.affectedComponents.join(', ')} 存在缺陷`,
        evidence: [`闻诊统计: ${cluster.count} 次出现`],
        confidence: 0.75,
      });
    }

    return causes;
  }

  private inferCause(anomaly: WangData['anomalies'][0]): string {
    const causeMap: Record<string, string> = {
      memory_usage: '可能存在内存泄漏或未释放的资源',
      queue_backlog: '处理能力不足或下游依赖响应慢',
      cpu_usage: '计算密集型任务过多或存在死循环',
    };
    return causeMap[anomaly.type] || '需要进一步分析';
  }

  private recognizePatterns(wang: WangData, wen: WenData): QieData['patterns'] {
    const patterns: QieData['patterns'] = [];

    // 检测性能退化模式
    if (wen.performanceMetrics.avgResponseTime > 1000) {
      patterns.push({
        name: '性能退化',
        description: '平均响应时间超过 1 秒',
        occurrences: 1,
        impact: 'high',
      });
    }

    // 检测错误率上升模式
    if (wen.performanceMetrics.errorRate > 0.05) {
      patterns.push({
        name: '错误率上升',
        description: `错误率达到 ${(wen.performanceMetrics.errorRate * 100).toFixed(1)}%`,
        occurrences: 1,
        impact: 'high',
      });
    }

    return patterns;
  }

  private formulateDiagnosis(
    wang: WangData,
    wen: WenData,
    causes: QieData['rootCauses']
  ): QieData['diagnosis'] {
    // 计算严重程度
    let severity: QieData['diagnosis']['severity'] = 'healthy';
    const criticalCount = wang.anomalies.filter(a => a.severity === 'critical').length;
    const highErrorRate = wen.performanceMetrics.errorRate > 0.1;

    if (criticalCount > 0 || highErrorRate) {
      severity = 'critical';
    } else if (wang.anomalies.length > 2 || wen.performanceMetrics.errorRate > 0.05) {
      severity = 'degraded';
    } else if (wang.anomalies.length > 0) {
      severity = 'suboptimal';
    }

    return {
      summary: this.generateSummary(causes, severity),
      severity,
      affectedSystems: this.identifyAffectedSystems(causes),
    };
  }

  private generateSummary(
    causes: QieData['rootCauses'],
    severity: QieData['diagnosis']['severity']
  ): string {
    const severityDesc = {
      healthy: '系统运行正常',
      suboptimal: '系统运行基本正常，存在轻微问题',
      degraded: '系统性能下降，需要关注',
      critical: '系统存在严重问题，需要立即处理',
    };

    if (causes.length === 0) {
      return severityDesc[severity];
    }

    return `${severityDesc[severity]}。主要问题: ${causes[0].problem}`;
  }

  private identifyAffectedSystems(causes: QieData['rootCauses']): string[] {
    const systems = new Set<string>();
    for (const cause of causes) {
      if (cause.evidence.some(e => e.includes('内存'))) systems.add('内存管理');
      if (cause.evidence.some(e => e.includes('队列'))) systems.add('任务调度');
      if (cause.evidence.some(e => e.includes('错误'))) systems.add('错误处理');
    }
    return [...systems];
  }

  private generatePrescriptions(
    causes: QieData['rootCauses'],
    patterns: QieData['patterns']
  ): QieData['prescriptions'] {
    const prescriptions: QieData['prescriptions'] = [];

    for (let i = 0; i < causes.length; i++) {
      const cause = causes[i];
      prescriptions.push({
        priority: i + 1,
        action: `修复: ${cause.cause}`,
        expectedOutcome: `解决: ${cause.problem}`,
        risk: cause.confidence > 0.8 ? 'low' : 'medium',
      });
    }

    for (const pattern of patterns) {
      if (pattern.impact === 'high') {
        prescriptions.push({
          priority: prescriptions.length + 1,
          action: `处理模式: ${pattern.name}`,
          expectedOutcome: pattern.description,
          risk: 'medium',
        });
      }
    }

    return prescriptions.sort((a, b) => a.priority - b.priority);
  }
}

// ═══════════════════════════════════════════════════════════
// 四诊合参 - 主控制器
// ═══════════════════════════════════════════════════════════

export class FourDiagnosesSystem {
  private wang: WangDiagnosis;
  private wen: WenDiagnosis;
  private wenQuestion: WenQuestionDiagnosis;
  private qie: QieDiagnosis;

  constructor(llmRouter: AgentAIRouter) {
    this.wang = new WangDiagnosis();
    this.wen = new WenDiagnosis();
    this.wenQuestion = new WenQuestionDiagnosis();
    this.qie = new QieDiagnosis(llmRouter);
  }

  /** 执行完整四诊 */
  async diagnose(userInput?: string): Promise<FourDiagnosesResult> {
    // 并行执行望、闻、问
    const [wangData, wenData] = await Promise.all([
      this.wang.observe(),
      this.wen.analyze(),
    ]);

    // 望诊后处理异常
    wangData.anomalies = this.wang.detectAnomalies(wangData);
    wangData.healthScore = this.calculateHealthScore(wangData);

    // 问诊（如果有用户输入）
    const wenQuestionData = userInput
      ? this.wenQuestion.analyzeInput(userInput)
      : this.getDefaultWenQuestionData();

    // 切诊（综合分析）
    const qieData = await this.qie.analyze(wangData, wenData, wenQuestionData);

    return {
      timestamp: Date.now(),
      wang: wangData,
      wen: wenData,
      wenQuestion: wenQuestionData,
      qie: qieData,
      holisticAssessment: this.synthesize(wangData, wenData, wenQuestionData, qieData),
    };
  }

  private calculateHealthScore(wang: WangData): number {
    let score = 100;

    // 异常扣分
    for (const anomaly of wang.anomalies) {
      const deductions = { low: 5, medium: 15, high: 25, critical: 40 };
      score -= deductions[anomaly.severity];
    }

    // 资源使用扣分
    if (wang.runtimeStatus.memoryUsage > 512) score -= 10;
    if (wang.runtimeStatus.queueLength > 50) score -= 15;

    return Math.max(0, Math.min(100, score));
  }

  private synthesize(
    wang: WangData,
    wen: WenData,
    wenQuestion: WenQuestionData,
    qie: QieData
  ): FourDiagnosesResult['holisticAssessment'] {
    // 综合判断
    const healthIndicators = [
      wang.healthScore,
      (1 - wen.performanceMetrics.errorRate) * 100,
      wenQuestion.userIntent.confidence * 100,
      qie.diagnosis.severity === 'healthy' ? 100 :
        qie.diagnosis.severity === 'suboptimal' ? 80 :
        qie.diagnosis.severity === 'degraded' ? 60 : 30,
    ];

    const overallHealth = healthIndicators.reduce((a, b) => a + b, 0) / healthIndicators.length;

    return {
      overallHealth: Math.round(overallHealth),
      primaryConcern: qie.diagnosis.summary,
      secondaryConcerns: qie.rootCauses.slice(1).map(c => c.problem),
      recommendedAction: qie.prescriptions[0]?.action || '系统运行正常，无需特别处理',
    };
  }

  private getDefaultWenQuestionData(): WenQuestionData {
    return {
      userIntent: { primary: 'system_check', secondary: [], confidence: 1.0 },
      ambiguities: [],
      informationGaps: [],
      suggestedQuestions: [],
    };
  }

  /** 获取闻诊实例（用于日志收集） */
  getWenDiagnosis(): WenDiagnosis {
    return this.wen;
  }
}

// 单例导出
let system: FourDiagnosesSystem | null = null;

export function getFourDiagnosesSystem(llmRouter: AgentAIRouter): FourDiagnosesSystem {
  if (!system) {
    system = new FourDiagnosesSystem(llmRouter);
  }
  return system;
}
