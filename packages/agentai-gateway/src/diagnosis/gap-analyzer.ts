/**
 * 缺口分析器
 * ALTES | 岐黄 - 望闻问切之"闻"
 *
 * 职责：
 * 1. 深度分析信息缺口
 * 2. 评估缺口影响
 * 3. 生成追问问题
 *
 * @module diagnosis/gap-analyzer
 */

import {
  InformationGap,
  GapType,
  TaskType,
  ComplexityLevel,
  DiagnosisContext,
} from '../types/diagnosis.js';

// ═══════════════════════════════════════════════════════════
// 缺口模式库
// ═══════════════════════════════════════════════════════════

/**
 * 缺口模式定义
 */
interface GapPattern {
  type: GapType;
  patterns: RegExp[];
  severity: 'low' | 'medium' | 'high';
  canSelfFill: boolean;
  generateQuestion: (match: RegExpMatchArray, context?: DiagnosisContext) => string;
}

/**
 * 缺口模式库
 */
const GAP_PATTERNS: GapPattern[] = [
  // 缺少上下文
  {
    type: 'missing_context',
    patterns: [
      /(?:这个|那个|它|这|那)(?:文件|代码|页面|功能|地方|东西)?/i,
      /(?:这里|那里|这边|那边)/i,
      /(?:如上|如下|前文|后文)/i,
    ],
    severity: 'medium',
    canSelfFill: true,
    generateQuestion: () => '您指的是哪个具体的文件或代码？',
  },
  
  // 需求模糊
  {
    type: 'ambiguous_requirement',
    patterns: [
      /(?:帮我|请|能).{0,5}(?:搞一下|弄一下|处理一下|看一下|弄一下|改一下|优化一下|调整一下)/i,
      /(?:做|处理|弄|搞|整).{0,3}(?:个|一下|下)/i,
      /(?:随便|大致|大概|差不多)/i,
    ],
    severity: 'high',
    canSelfFill: false,
    generateQuestion: () => '您希望具体达到什么效果？',
  },
  
  // 范围不清
  {
    type: 'unclear_scope',
    patterns: [
      /(?:用|选|采用|使用).{0,10}(?:还是|或者|或|versus|vs)/i,
      /(?:A|方案一|第一种).{0,5}(?:B|方案二|第二种)/i,
      /(?:等等|之类|等等)/i,
    ],
    severity: 'medium',
    canSelfFill: false,
    generateQuestion: (match) => `您倾向于选择${match[0]}中的哪一个？`,
  },
  
  // 技术未知
  {
    type: 'technical_unknown',
    patterns: [
      /(?:技术栈|框架|库|工具)(?:是|用)?(?:什么|哪个)?/i,
      /(?:怎么|如何)(?:实现|做到|解决)/i,
      /(?:有没有|是否有)(?:更好的|更优的|推荐的)(?:方案|方法|做法)/i,
    ],
    severity: 'low',
    canSelfFill: true,
    generateQuestion: () => '您有偏好的技术方案吗？',
  },
  
  // 偏好未知
  {
    type: 'missing_preference',
    patterns: [
      /(?:好看|美观|漂亮|简洁|简单|复杂|详细)/i,
      /(?:快|慢|性能|效率|优化)/i,
      /(?:安全|稳定|可靠)/i,
    ],
    severity: 'low',
    canSelfFill: true,
    generateQuestion: () => '您更看重哪方面：性能、可读性还是功能完整性？',
  },
];

// ═══════════════════════════════════════════════════════════
// 任务特定缺口
// ═══════════════════════════════════════════════════════════

/**
 * 代码任务缺口
 */
const CODING_GAPS: GapPattern[] = [
  {
    type: 'missing_context',
    patterns: [
      /(?:函数|方法|类|组件)(?:叫|名为)?/i,
      /(?:输入|输出|参数|返回值)/i,
    ],
    severity: 'medium',
    canSelfFill: false,
    generateQuestion: () => '这个函数的输入参数和期望输出是什么？',
  },
  {
    type: 'technical_unknown',
    patterns: [
      /(?:算法|数据结构|设计模式)/i,
      /(?:时间复杂度|空间复杂度|性能)/i,
    ],
    severity: 'medium',
    canSelfFill: true,
    generateQuestion: () => '您对算法复杂度有要求吗？',
  },
];

/**
 * 调试任务缺口
 */
const DEBUGGING_GAPS: GapPattern[] = [
  {
    type: 'missing_context',
    patterns: [
      /(?:报错|错误|异常|bug|问题)/i,
      /(?:运行|执行|调用)(?:不了|失败|出错)/i,
    ],
    severity: 'high',
    canSelfFill: false,
    generateQuestion: () => '具体的错误信息是什么？',
  },
  {
    type: 'missing_context',
    patterns: [
      /(?:期望|应该|想要)(?:结果|输出)/i,
      /(?:实际|现在|当前)(?:结果|输出)/i,
    ],
    severity: 'medium',
    canSelfFill: false,
    generateQuestion: () => '期望的行为和实际的行为分别是什么？',
  },
];

/**
 * 分析任务缺口
 */
const ANALYSIS_GAPS: GapPattern[] = [
  {
    type: 'unclear_scope',
    patterns: [
      /(?:分析|评估| review)(?:一下|下)?/i,
    ],
    severity: 'medium',
    canSelfFill: false,
    generateQuestion: () => '您希望重点分析哪些方面？',
  },
];

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 分析缺口
 */
export function analyzeGaps(
  userText: string,
  taskType: TaskType,
  complexity: ComplexityLevel,
  context?: DiagnosisContext
): InformationGap[] {
  const gaps: InformationGap[] = [];
  
  // 1. 通用缺口检测
  for (const pattern of GAP_PATTERNS) {
    const detected = detectPattern(userText, pattern);
    gaps.push(...detected);
  }
  
  // 2. 任务特定缺口检测
  const taskSpecificPatterns = getTaskSpecificPatterns(taskType);
  for (const pattern of taskSpecificPatterns) {
    const detected = detectPattern(userText, pattern);
    gaps.push(...detected);
  }
  
  // 3. 去重
  const uniqueGaps = deduplicateGaps(gaps);
  
  // 4. 根据复杂度调整严重度
  const adjustedGaps = adjustSeverityByComplexity(uniqueGaps, complexity);
  
  return adjustedGaps;
}

/**
 * 生成追问问题
 */
export function generateClarificationQuestions(
  gaps: InformationGap[],
  maxQuestions: number = 3
): string[] {
  // 按严重度排序
  const sortedGaps = [...gaps].sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
  
  // 优先选择不可自我补全的缺口
  const criticalGaps = sortedGaps.filter(g => !g.canSelfFill);
  const otherGaps = sortedGaps.filter(g => g.canSelfFill);
  
  // 生成问题
  const questions: string[] = [];
  
  for (const gap of criticalGaps.slice(0, maxQuestions)) {
    questions.push(gap.suggestedResolution);
  }
  
  // 如果关键问题不够，补充其他问题
  if (questions.length < maxQuestions) {
    for (const gap of otherGaps.slice(0, maxQuestions - questions.length)) {
      questions.push(gap.suggestedResolution);
    }
  }
  
  return questions;
}

/**
 * 评估缺口影响
 */
export function assessGapImpact(
  gaps: InformationGap[],
  taskType: TaskType
): {
  canProceed: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedSuccessRate: number;
} {
  if (gaps.length === 0) {
    return { canProceed: true, riskLevel: 'low', estimatedSuccessRate: 0.95 };
  }
  
  // 统计
  const highSeverity = gaps.filter(g => g.severity === 'high').length;
  const mediumSeverity = gaps.filter(g => g.severity === 'medium').length;
  const nonSelfFillable = gaps.filter(g => !g.canSelfFill).length;
  
  // 计算成功率
  let successRate = 1.0;
  successRate -= highSeverity * 0.2;
  successRate -= mediumSeverity * 0.1;
  successRate -= nonSelfFillable * 0.15;
  successRate = Math.max(0.3, successRate);
  
  // 确定风险级别
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (highSeverity > 0 || nonSelfFillable >= 2) {
    riskLevel = 'high';
  } else if (mediumSeverity > 0 || nonSelfFillable === 1) {
    riskLevel = 'medium';
  }
  
  // 是否可继续
  const canProceed = highSeverity === 0 && nonSelfFillable <= 1;
  
  return {
    canProceed,
    riskLevel,
    estimatedSuccessRate: successRate,
  };
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 检测模式
 */
function detectPattern(
  text: string,
  pattern: GapPattern
): InformationGap[] {
  const gaps: InformationGap[] = [];
  
  for (const regex of pattern.patterns) {
    const matches = text.matchAll(regex);
    for (const match of matches) {
      gaps.push({
        type: pattern.type,
        description: match[0],
        severity: pattern.severity,
        suggestedResolution: pattern.generateQuestion(match),
        canSelfFill: pattern.canSelfFill,
      });
    }
  }
  
  return gaps;
}

/**
 * 获取任务特定模式
 */
function getTaskSpecificPatterns(taskType: TaskType): GapPattern[] {
  switch (taskType) {
    case 'coding':
      return CODING_GAPS;
    case 'debugging':
      return DEBUGGING_GAPS;
    case 'analysis':
      return ANALYSIS_GAPS;
    default:
      return [];
  }
}

/**
 * 去重缺口
 */
function deduplicateGaps(gaps: InformationGap[]): InformationGap[] {
  const seen = new Set<string>();
  return gaps.filter(gap => {
    const key = `${gap.type}:${gap.description}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 根据复杂度调整严重度
 */
function adjustSeverityByComplexity(
  gaps: InformationGap[],
  complexity: ComplexityLevel
): InformationGap[] {
  const severityBoost = {
    ultraSimple: 0,
    simple: 0,
    medium: 1,
    complex: 1,
    hard: 2,
  }[complexity];
  
  if (severityBoost === 0) {
    return gaps;
  }
  
  return gaps.map(gap => {
    const severityOrder = ['low', 'medium', 'high'];
    const currentIndex = severityOrder.indexOf(gap.severity);
    const newIndex = Math.min(severityOrder.length - 1, currentIndex + severityBoost);
    
    return {
      ...gap,
      severity: severityOrder[newIndex] as InformationGap['severity'],
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 导出测试函数
// ═══════════════════════════════════════════════════════════

/**
 * 测试缺口分析
 */
export function testGapAnalyzer(): void {
  const testCases = [
    {
      text: '帮我看一下这个文件',
      taskType: 'debugging' as TaskType,
      complexity: 'medium' as ComplexityLevel,
    },
    {
      text: '帮我优化一下代码',
      taskType: 'refactoring' as TaskType,
      complexity: 'simple' as ComplexityLevel,
    },
    {
      text: '用 React 还是 Vue 好？',
      taskType: 'coding' as TaskType,
      complexity: 'medium' as ComplexityLevel,
    },
  ];
  
  for (const testCase of testCases) {
    const gaps = analyzeGaps(testCase.text, testCase.taskType, testCase.complexity);
    const impact = assessGapImpact(gaps, testCase.taskType);
    const questions = generateClarificationQuestions(gaps);
    
    console.log('输入:', testCase.text);
    console.log('缺口:', gaps.map(g => `[${g.severity}] ${g.type}: ${g.description}`));
    console.log('影响:', impact);
    console.log('追问:', questions);
    console.log('---');
  }
}

// 如果直接运行此文件，执行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testGapAnalyzer();
}
