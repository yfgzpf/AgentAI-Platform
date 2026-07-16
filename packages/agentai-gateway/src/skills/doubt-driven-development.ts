/**
 * Doubt-Driven Development — 质疑模式
 * 
 * 当涉及生产环境、安全相关、或不可逆操作时，AI 自动启动"质疑模式"，
 * 防止自信满满地搞砸事情。
 * 
 * 流程:
 * 1. CLAIM — 先说出自己的方案
 * 2. EXTRACT — 提取关键假设
 * 3. DOUBT — 自己找漏洞
 * 4. RECONCILE — 权衡利弊
 * 5. STOP — 如果还不够确定，请求人工确认
 */

export interface DoubtAnalysis {
  /** 方案概述 */
  claim: string;
  /** 关键假设列表 */
  assumptions: string[];
  /** 潜在问题/漏洞 */
  doubts: {
    pattern: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    impact?: string;
  }[];
  /** 权衡分析 */
  reconciliation: {
    pros: string[];
    cons: string[];
    alternatives: string[];
  };
  /** 最终建议 */
  recommendation: 'proceed' | 'proceed-with-caution' | 'seek-human-input' | 'abort';
  /** 理由 */
  reason: string;
}

/**
 * 高风险操作检测器
 */
export class DoubtDetector {
  /**
   * 检测任务是否属于高风险类别
   */
  static detectRisk(task: string): { isHighRisk: boolean; reasons: string[] } {
    const highRiskPatterns = [
      { pattern: /删除|remove|delete|rm\s+-rf/i, category: '不可逆删除', severity: 'critical' },
      { pattern: /覆盖|overwrite|重写|replace/i, category: '覆盖已有数据', severity: 'high' },
      { pattern: /生产|prod|上线|部署|deploy/i, category: '生产环境操作', severity: 'high' },
      { pattern: /权限|permission|sudo|admin/i, category: '权限变更', severity: 'high' },
      { pattern: /数据库|database|migration|迁移/i, category: '数据迁移', severity: 'high' },
      { pattern: /配置|config|setting|环境变量/i, category: '配置变更', severity: 'medium' },
      { pattern: /依赖|dependency|npm install|pip install/i, category: '依赖变更', severity: 'medium' },
      { pattern: /重构|refactor|重写|重写整个/i, category: '大规模重构', severity: 'medium' },
    ];

    const reasons: string[] = [];
    for (const { pattern, category } of highRiskPatterns) {
      if (pattern.test(task)) {
        reasons.push(category);
      }
    }

    return {
      isHighRisk: reasons.length > 0,
      reasons,
    };
  }
}

/**
 * 执行质疑模式分析
 */
export function analyzeWithDoubt(task: string, proposedSolution: string): DoubtAnalysis {
  // 1. CLAIM — 方案概述
  const claim = proposedSolution;

  // 2. EXTRACT — 提取关键假设
  const assumptions = extractAssumptions(task, proposedSolution);

  // 3. DOUBT — 找漏洞
  const doubts = generateDoubts(task, proposedSolution, assumptions);

  // 4. RECONCILE — 权衡
  const reconciliation = generateReconciliation(doubts);

  // 5. STOP — 最终建议
  const recommendation = determineRecommendation(doubts, reconciliation);

  return {
    claim,
    assumptions,
    doubts,
    reconciliation,
    recommendation,
    reason: generateReason(recommendation, doubts),
  };
}

/**
 * 从方案和任务中提取关键假设
 */
function extractAssumptions(task: string, solution: string): string[] {
  const assumptions: string[] = [];

  // 常见假设模式
  const assumptionPatterns = [
    { regex: /假设|assume|假设我们/i, extract: '显式假设' },
    { regex: /如果|if|假如/i, extract: '条件假设' },
    { regex: /应该|should|会|will/i, extract: '预期行为' },
    { regex: /因为|since|as|由于/i, extract: '因果假设' },
  ];

  for (const { regex, extract } of assumptionPatterns) {
    const matches = solution.match(regex);
    if (matches) {
      assumptions.push(`${extract}（来自方案文本）`);
    }
  }

  // 从任务中提取隐含假设
  if (task.includes('生产') || task.includes('prod')) {
    assumptions.push('生产环境数据完整性和可用性');
  }
  if (task.includes('用户') || task.includes('user')) {
    assumptions.push('用户行为和数据的一致性');
  }
  if (task.includes('性能') || task.includes('performance')) {
    assumptions.push('性能指标的测量方法和基线');
  }

  return assumptions.length > 0 ? assumptions : ['无显式假设（需进一步确认）'];
}

/**
 * 生成潜在质疑
 */
function generateDoubts(task: string, solution: string, assumptions: string[]): DoubtAnalysis['doubts'] {
  const doubts: DoubtAnalysis['doubts'] = [];

  // 基于任务的质疑
  if (task.includes('删除') || task.includes('delete')) {
    doubts.push({
      pattern: '数据丢失',
      severity: 'critical',
      description: '删除操作是否可逆？是否有备份？',
      impact: '可能导致不可恢复的数据丢失',
    });
  }

  if (task.includes('覆盖') || task.includes('overwrite')) {
    doubts.push({
      pattern: '数据覆盖',
      severity: 'high',
      description: '被覆盖的数据是否有版本控制？能否回滚？',
      impact: '可能丢失历史数据或用户输入',
    });
  }

  if (task.includes('生产') || task.includes('prod')) {
    doubts.push({
      pattern: '生产影响',
      severity: 'high',
      description: '是否会影响在线用户？是否有回滚方案？',
      impact: '可能导致服务中断或用户体验下降',
    });
  }

  if (task.includes('重构') || task.includes('refactor')) {
    doubts.push({
      pattern: '重构风险',
      severity: 'medium',
      description: '重构是否会影响现有功能？测试覆盖率如何？',
      impact: '可能引入回归 bug',
    });
  }

  if (assumptions.some(a => a.includes('预期') || a.includes('应该'))) {
    doubts.push({
      pattern: '假设验证',
      severity: 'medium',
      description: '方案中的预期行为是否有验证机制？',
      impact: '假设错误可能导致方案失败',
    });
  }

  // 通用质疑
  if (doubts.length === 0) {
    doubts.push({
      pattern: '边界条件',
      severity: 'low',
      description: '是否考虑了边界情况？（空输入、异常值、并发等）',
      impact: '边界情况可能导致意外行为',
    });
  }

  return doubts;
}

/**
 * 生成权衡分析
 */
function generateReconciliation(doubts: DoubtAnalysis['doubts']): DoubtAnalysis['reconciliation'] {
  const highSeverityCount = doubts.filter(d => d.severity === 'high' || d.severity === 'critical').length;

  return {
    pros: [
      '方案有明确的目标和步骤',
      '质疑模式已识别潜在风险',
    ],
    cons: doubts.map(d => `[${d.severity.toUpperCase()}] ${d.description}`),
    alternatives: highSeverityCount > 0 ? [
      '先在小范围/测试环境验证',
      '准备回滚方案',
      '分阶段实施，每步验证',
    ] : [
      '当前方案可继续执行',
    ],
  };
}

/**
 * 确定最终建议
 */
function determineRecommendation(
  doubts: DoubtAnalysis['doubts'],
  reconciliation: DoubtAnalysis['reconciliation'],
): DoubtAnalysis['recommendation'] {
  const criticalCount = doubts.filter(d => d.severity === 'critical').length;
  const highCount = doubts.filter(d => d.severity === 'high').length;

  if (criticalCount > 0) {
    return 'abort';
  }
  if (highCount > 0) {
    return 'seek-human-input';
  }
  if (reconciliation.cons.length > 2) {
    return 'proceed-with-caution';
  }
  return 'proceed';
}

/**
 * 生成建议理由
 */
function generateReason(
  recommendation: DoubtAnalysis['recommendation'],
  doubts: DoubtAnalysis['doubts'],
): string {
  switch (recommendation) {
    case 'abort':
      return '存在致命风险，建议立即停止并重新评估方案';
    case 'seek-human-input':
      return `存在 ${doubts.filter(d => d.severity === 'high').length} 个高风险问题，建议请求人工确认`;
    case 'proceed-with-caution':
      return '存在若干中低风险问题，建议谨慎执行并密切监控';
    default:
      return '未发现重大风险，可继续执行';
  }
}

/**
 * 格式化质疑报告为 Markdown
 */
export function formatDoubtReport(analysis: DoubtAnalysis): string {
  const lines: string[] = [];

  lines.push('### 🔍 质疑模式分析');
  lines.push('');
  lines.push('**方案（CLAIM）**：');
  lines.push(`\`\`\`\n${analysis.claim}\n\`\`\``);
  lines.push('');

  lines.push('**关键假设（EXTRACT）**：');
  for (const assumption of analysis.assumptions) {
    lines.push(`- ${assumption}`);
  }
  lines.push('');

  lines.push('**潜在问题（DOUBT）**：');
  for (const doubt of analysis.doubts) {
    const icon = {
      critical: '🔴',
      high: '🟠',
      medium: '🟡',
      low: '🟢',
    }[doubt.severity];
    lines.push(`${icon} **${doubt.pattern}**（${doubt.severity}）`);
    lines.push(`   - ${doubt.description}`);
    if (doubt.impact) {
      lines.push(`   - 影响：${doubt.impact}`);
    }
  }
  lines.push('');

  lines.push('**权衡分析（RECONCILE）**：');
  lines.push(`- ✅ 优点：${analysis.reconciliation.pros.join('; ')}`);
  lines.push(`- ❌ 缺点：${analysis.reconciliation.cons.join('; ')}`);
  lines.push(`- 🔄 备选：${analysis.reconciliation.alternatives.join('; ')}`);
  lines.push('');

  const recommendationIcon = {
    proceed: '✅',
    'proceed-with-caution': '⚠️',
    'seek-human-input': '🛑',
    abort: '🚫',
  }[analysis.recommendation];

  lines.push(`**最终建议（STOP）**：${recommendationIcon} **${analysis.recommendation.toUpperCase()}**`);
  lines.push(`> ${analysis.reason}`);

  return lines.join('\n');
}