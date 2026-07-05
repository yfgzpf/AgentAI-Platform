/**
 * 任务感知层
 * ALTES | 岐黄 - 望闻问切之"望"
 *
 * 职责：
 * 1. 分析用户真实意图（望其表）
 * 2. 识别信息缺口（闻其声）
 * 3. 决定是否需要追问（问其症）
 *
 * @module diagnosis/task-perception
 */

import { classifyComplexity } from '../model-classifier.js';
import { IntentClarifier, Ambiguity } from '../meta/intent-clarifier.js';
import {
  TaskPerceptionReport,
  InformationGap,
  TaskType,
  ActionType,
  DiagnosisContext,
  DiagnosisConfig,
  ComplexityLevel,
} from '../types/diagnosis.js';
import {
  TASK_TYPE_KEYWORDS,
  COMPLEXITY_KEYWORDS,
  DEFAULT_DIAGNOSIS_CONFIG,
} from './constants.js';

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 任务感知 - 分析用户请求，生成感知报告
 *
 * 对应中医"望闻问"三诊：
 * - 望：观其表 → 分析任务类型和复杂度
 * - 闻：听其声 → 识别信息缺口
 * - 问：问其症 → 决定是否需要追问
 */
export async function perceiveTask(
  messages: any[],
  context?: DiagnosisContext,
  config?: DiagnosisConfig
): Promise<TaskPerceptionReport> {
  const cfg = { ...DEFAULT_DIAGNOSIS_CONFIG, ...config };
  
  // 提取用户文本
  const userText = extractUserText(messages);
  const contextLength = estimateContextLength(messages);
  
  // 1. 望 - 分析任务类型和复杂度
  const taskType = inferTaskType(userText);
  const complexity = classifyComplexity(userText, contextLength);
  
  // 2. 闻 - 识别歧义和信息缺口
  const clarifier = new IntentClarifier();
  const ambiguities = clarifier.detectAmbiguities(userText, {
    openFiles: context?.projectPath ? [context.projectPath] : undefined,
    currentModel: undefined,
    lastMentionedFile: undefined,
    workspace: context?.projectPath,
  });
  
  // 3. 转换歧义为信息缺口
  const gaps = convertAmbiguitiesToGaps(ambiguities, userText);
  
  // 4. 计算歧义度
  const ambiguity = calculateAmbiguity(gaps, complexity, userText);
  
  // 5. 决定行动
  const suggestedAction = determineAction(gaps, ambiguity, complexity, cfg);
  
  // 6. 提取关键实体
  const entities = extractEntities(userText);
  
  // 7. 生成意图摘要
  const intentSummary = generateIntentSummary(userText, taskType, complexity);
  
  return {
    taskType,
    complexity,
    ambiguity,
    gapList: gaps,
    suggestedAction,
    intentSummary,
    entities,
  };
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 提取用户文本
 */
function extractUserText(messages: any[]): string {
  return messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join('\n')
    .slice(0, 2000); // 安全截断
}

/**
 * 估算上下文长度
 */
function estimateContextLength(messages: any[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);
}

/**
 * 推断任务类型
 */
function inferTaskType(text: string): TaskType {
  const lowerText = text.toLowerCase();
  
  for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return type as TaskType;
      }
    }
  }
  
  return 'general';
}

/**
 * 将歧义转换为信息缺口
 */
function convertAmbiguitiesToGaps(ambiguities: Ambiguity[], userText: string): InformationGap[] {
  return ambiguities.map(ambiguity => {
    let type: InformationGap['type'];
    let canSelfFill = false;
    
    switch (ambiguity.type) {
      case 'vague_verb':
        type = 'ambiguous_requirement';
        canSelfFill = false;
        break;
      case 'unclear_reference':
        type = 'missing_context';
        canSelfFill = true; // 有时可从上下文推断
        break;
      case 'unresolved_choice':
        type = 'unclear_scope';
        canSelfFill = false;
        break;
      case 'missing_param':
        type = 'technical_unknown';
        canSelfFill = false;
        break;
      default:
        type = 'missing_context';
        canSelfFill = false;
    }
    
    return {
      type,
      description: ambiguity.text,
      severity: ambiguity.severity,
      suggestedResolution: ambiguity.suggestedQuestions[0] || '请提供更多细节',
      canSelfFill,
    };
  });
}

/**
 * 计算歧义度 0-1
 */
function calculateAmbiguity(
  gaps: InformationGap[],
  complexity: ComplexityLevel,
  userText: string
): number {
  // 基础歧义度
  let ambiguity = 0;
  
  // 根据缺口数量和严重程度
  for (const gap of gaps) {
    const severityWeight = { low: 0.1, medium: 0.2, high: 0.3 }[gap.severity];
    ambiguity += severityWeight;
  }
  
  // 根据复杂度调整
  const complexityWeight = {
    ultraSimple: 0.1,
    simple: 0.15,
    medium: 0.2,
    complex: 0.25,
    hard: 0.3,
  }[complexity];
  
  ambiguity += complexityWeight;
  
  // 根据文本长度调整（太短通常更歧义）
  if (userText.length < 20) {
    ambiguity += 0.2;
  }
  
  // 归一化到 0-1
  return Math.min(1, Math.max(0, ambiguity));
}

/**
 * 决定行动类型
 */
function determineAction(
  gaps: InformationGap[],
  ambiguity: number,
  complexity: ComplexityLevel,
  config: DiagnosisConfig
): ActionType {
  // 高歧义 → 询问用户
  if (ambiguity > config.ambiguityThreshold) {
    return 'ask';
  }
  
  // 检查是否有不可自我补全的高严重度缺口
  const criticalGaps = gaps.filter(
    g => g.severity === 'high' && !g.canSelfFill
  );
  if (criticalGaps.length > 0) {
    return 'ask';
  }
  
  // 检查是否都可自我补全
  const allSelfFillable = gaps.length > 0 && gaps.every(g => g.canSelfFill);
  if (allSelfFillable && config.allowSelfFill) {
    return 'self_fill';
  }
  
  // 超简单任务 → 直接执行
  if (complexity === 'ultraSimple' && gaps.length === 0) {
    return 'proceed';
  }
  
  // 默认询问
  return 'ask';
}

/**
 * 提取关键实体
 */
function extractEntities(text: string): string[] {
  const entities: string[] = [];
  
  // 文件路径
  const filePaths = text.match(/[\w\-./]+\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|h|json|yaml|yml|md|txt)/gi);
  if (filePaths) {
    entities.push(...filePaths);
  }
  
  // 函数/类名
  const identifiers = text.match(/(?:函数|类|const|let|var|function|class|interface|type)\s+(\w+)/gi);
  if (identifiers) {
    entities.push(...identifiers.map(s => s.split(/\s+/).pop()!));
  }
  
  // 技术栈关键词
  const techStacks = ['react', 'vue', 'angular', 'node', 'python', 'docker', 'kubernetes'];
  for (const tech of techStacks) {
    if (text.toLowerCase().includes(tech)) {
      entities.push(tech);
    }
  }
  
  return [...new Set(entities)];
}

/**
 * 生成意图摘要
 */
function generateIntentSummary(
  userText: string,
  taskType: TaskType,
  complexity: ComplexityLevel
): string {
  // 取前 30 字作为摘要
  const shortText = userText.slice(0, 30).replace(/\n/g, ' ');
  
  const typeLabels: Record<TaskType, string> = {
    coding: '编写代码',
    debugging: '调试修复',
    refactoring: '重构优化',
    analysis: '分析诊断',
    writing: '文档写作',
    creative: '创意生成',
    general: '通用对话',
  };
  
  const complexityLabels: Record<ComplexityLevel, string> = {
    ultraSimple: '超简单',
    simple: '简单',
    medium: '中等',
    complex: '复杂',
    hard: '困难',
  };
  
  return `${typeLabels[taskType]}(${complexityLabels[complexity]}): ${shortText}${userText.length > 30 ? '...' : ''}`;
}

// ═══════════════════════════════════════════════════════════
// 导出测试函数
// ═══════════════════════════════════════════════════════════

/**
 * 测试任务感知
 */
export async function testTaskPerception(): Promise<void> {
  const testCases = [
    { input: '你好', expected: { taskType: 'general', complexity: 'ultraSimple' } },
    { input: '帮我写个排序函数', expected: { taskType: 'coding', complexity: 'simple' } },
    { input: '这个文件有点问题，帮我看一下', expected: { taskType: 'debugging', complexity: 'medium' } },
    { input: '帮我设计一个微服务架构的电商系统', expected: { taskType: 'coding', complexity: 'hard' } },
  ];
  
  for (const testCase of testCases) {
    const messages = [{ role: 'user', content: testCase.input }];
    const result = await perceiveTask(messages);
    
    console.log('输入:', testCase.input);
    console.log('结果:', {
      taskType: result.taskType,
      complexity: result.complexity,
      ambiguity: result.ambiguity.toFixed(2),
      action: result.suggestedAction,
      gaps: result.gapList.length,
    });
    console.log('---');
  }
}

// 如果直接运行此文件，执行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  testTaskPerception().catch(console.error);
}
