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
// ═══════════════════════════════════════════════════════════
// 望诊实现 (Observation)
// ═══════════════════════════════════════════════════════════
export class WangDiagnosis {
    async observe() {
        return {
            codeMetrics: await this.scanCodeMetrics(),
            runtimeStatus: await this.collectRuntimeMetrics(),
            healthScore: 0,
            anomalies: [],
        };
    }
    async scanCodeMetrics() {
        // TODO: 集成代码分析工具
        return {
            fileCount: 0,
            lineCount: 0,
            complexity: 0,
            testCoverage: 0,
        };
    }
    async collectRuntimeMetrics() {
        // TODO: 集成系统监控
        return {
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
            cpuUsage: 0,
            activeConnections: 0,
            queueLength: 0,
        };
    }
    /** 检测异常模式 */
    detectAnomalies(data) {
        const anomalies = [];
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
    logBuffer = [];
    /** 收集日志 */
    collectLog(level, message, meta) {
        this.logBuffer.push(JSON.stringify({ level, message, meta, ts: Date.now() }));
        if (this.logBuffer.length > 1000) {
            this.logBuffer = this.logBuffer.slice(-500);
        }
    }
    async analyze() {
        return {
            logPatterns: this.analyzeLogPatterns(),
            errorClusters: this.clusterErrors(),
            performanceMetrics: await this.analyzePerformance(),
        };
    }
    analyzeLogPatterns() {
        // 简单的日志模式分析
        const patterns = new Map();
        for (const log of this.logBuffer) {
            try {
                const parsed = JSON.parse(log);
                const key = `${parsed.level}:${parsed.message.slice(0, 50)}`;
                const existing = patterns.get(key);
                if (existing) {
                    existing.count++;
                }
                else {
                    patterns.set(key, { level: parsed.level, count: 1 });
                }
            }
            catch {
                // 忽略解析错误
            }
        }
        return [...patterns.entries()]
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, 10)
            .map(([pattern, data]) => ({
            level: data.level,
            pattern,
            frequency: data.count,
            trend: 'stable',
        }));
    }
    clusterErrors() {
        // TODO: 实现错误聚类算法
        return [];
    }
    async analyzePerformance() {
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
    analyzeInput(input) {
        const ambiguities = this.detectAmbiguities(input);
        const informationGaps = this.identifyGaps(input);
        return {
            userIntent: this.extractIntent(input),
            ambiguities,
            informationGaps,
            suggestedQuestions: this.generateQuestions(ambiguities, informationGaps),
        };
    }
    detectAmbiguities(input) {
        const ambiguities = [];
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
    identifyGaps(input) {
        const gaps = [];
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
    extractIntent(input) {
        // 简单的意图提取
        const intents = {
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
    generateQuestions(ambiguities, gaps) {
        const questions = [];
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
    llmRouter;
    constructor(llmRouter) {
        this.llmRouter = llmRouter;
    }
    /** 深度分析 */
    async analyze(wang, wen, wenQuestion) {
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
    async identifyRootCauses(wang, wen) {
        const causes = [];
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
    inferCause(anomaly) {
        const causeMap = {
            memory_usage: '可能存在内存泄漏或未释放的资源',
            queue_backlog: '处理能力不足或下游依赖响应慢',
            cpu_usage: '计算密集型任务过多或存在死循环',
        };
        return causeMap[anomaly.type] || '需要进一步分析';
    }
    recognizePatterns(wang, wen) {
        const patterns = [];
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
    formulateDiagnosis(wang, wen, causes) {
        // 计算严重程度
        let severity = 'healthy';
        const criticalCount = wang.anomalies.filter(a => a.severity === 'critical').length;
        const highErrorRate = wen.performanceMetrics.errorRate > 0.1;
        if (criticalCount > 0 || highErrorRate) {
            severity = 'critical';
        }
        else if (wang.anomalies.length > 2 || wen.performanceMetrics.errorRate > 0.05) {
            severity = 'degraded';
        }
        else if (wang.anomalies.length > 0) {
            severity = 'suboptimal';
        }
        return {
            summary: this.generateSummary(causes, severity),
            severity,
            affectedSystems: this.identifyAffectedSystems(causes),
        };
    }
    generateSummary(causes, severity) {
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
    identifyAffectedSystems(causes) {
        const systems = new Set();
        for (const cause of causes) {
            if (cause.evidence.some(e => e.includes('内存')))
                systems.add('内存管理');
            if (cause.evidence.some(e => e.includes('队列')))
                systems.add('任务调度');
            if (cause.evidence.some(e => e.includes('错误')))
                systems.add('错误处理');
        }
        return [...systems];
    }
    generatePrescriptions(causes, patterns) {
        const prescriptions = [];
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
    wang;
    wen;
    wenQuestion;
    qie;
    constructor(llmRouter) {
        this.wang = new WangDiagnosis();
        this.wen = new WenDiagnosis();
        this.wenQuestion = new WenQuestionDiagnosis();
        this.qie = new QieDiagnosis(llmRouter);
    }
    /** 执行完整四诊 */
    async diagnose(userInput) {
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
    calculateHealthScore(wang) {
        let score = 100;
        // 异常扣分
        for (const anomaly of wang.anomalies) {
            const deductions = { low: 5, medium: 15, high: 25, critical: 40 };
            score -= deductions[anomaly.severity];
        }
        // 资源使用扣分
        if (wang.runtimeStatus.memoryUsage > 512)
            score -= 10;
        if (wang.runtimeStatus.queueLength > 50)
            score -= 15;
        return Math.max(0, Math.min(100, score));
    }
    synthesize(wang, wen, wenQuestion, qie) {
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
    getDefaultWenQuestionData() {
        return {
            userIntent: { primary: 'system_check', secondary: [], confidence: 1.0 },
            ambiguities: [],
            informationGaps: [],
            suggestedQuestions: [],
        };
    }
    /** 获取闻诊实例（用于日志收集） */
    getWenDiagnosis() {
        return this.wen;
    }
}
// 单例导出
let system = null;
export function getFourDiagnosesSystem(llmRouter) {
    if (!system) {
        system = new FourDiagnosesSystem(llmRouter);
    }
    return system;
}
