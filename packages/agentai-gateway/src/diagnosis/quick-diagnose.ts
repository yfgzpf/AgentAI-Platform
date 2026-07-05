/**
 * 快速诊断 - ALTES | 岐黄
 *
 * 职责：快速判断执行策略（先诊后治）
 * - 简单任务 → 直接执行（单刀直入）
 * - 需求模糊 → 先澄清（先诊后治）
 * - 复杂任务 → 走 MasterController（分阶段调理）
 *
 * 不重复 MasterController 的工作，只做前置判断
 */

export interface QuickDiagnosisResult {
  /** 执行策略 */
  strategy: 'direct' | 'clarify' | 'orchestrate';
  /** 任务类型 */
  taskType: 'chat' | 'coding' | 'debug' | 'analysis' | 'complex';
  /** 复杂度 */
  complexity: 'simple' | 'medium' | 'complex';
  /** 置信度 0-1 */
  confidence: number;
  /** 澄清问题（strategy=clarify 时） */
  clarificationQuestions?: string[];
  /** 原因 */
  reason: string;
}

/**
 * 快速诊断 - 决定执行策略
 */
export async function quickDiagnose(
  message: string,
  context?: { history?: any[] }
): Promise<QuickDiagnosisResult> {
  const trimmed = message.trim();
  const length = trimmed.length;
  
  // 1. 超简单对话 → 直接执行
  if (isSimpleChat(trimmed)) {
    return {
      strategy: 'direct',
      taskType: 'chat',
      complexity: 'simple',
      confidence: 0.95,
      reason: '简单对话，无需编排',
    };
  }
  
  // 2. 需求模糊 → 先澄清（先诊后治）
  const ambiguity = detectAmbiguity(trimmed);
  if (ambiguity.score > 0.6) {
    return {
      strategy: 'clarify',
      taskType: inferTaskType(trimmed),
      complexity: 'medium',
      confidence: 0.6,
      clarificationQuestions: ambiguity.questions,
      reason: '需求模糊，需要澄清',
    };
  }
  
  // 3. 复杂任务 → 走 MasterController（分阶段调理）
  if (isComplexTask(trimmed)) {
    return {
      strategy: 'orchestrate',
      taskType: 'complex',
      complexity: 'complex',
      confidence: 0.7,
      reason: '复杂任务，需要拆解执行',
    };
  }
  
  // 4. 默认直接执行
  return {
    strategy: 'direct',
    taskType: inferTaskType(trimmed),
    complexity: length > 200 ? 'medium' : 'simple',
    confidence: 0.8,
    reason: '明确任务，直接执行',
  };
}

// ═══════════════════════════════════════════════════════════
// 判断函数
// ═══════════════════════════════════════════════════════════

/** 简单对话 */
function isSimpleChat(text: string): boolean {
  const simplePatterns = [
    /^(你好|hi|hello|谢谢|感谢|bye|再见|ok|好的|嗯|哦|是|不是|对|不对|yes|no|算了|没事|收到|明白|懂了|了解)$/i,
    /^(谢谢|thanks|thank you)$/i,
  ];
  return simplePatterns.some(p => p.test(text));
}

/** 检测歧义 */
function detectAmbiguity(text: string): { score: number; questions: string[] } {
  const questions: string[] = [];
  let score = 0;
  
  // 模糊动词
  if (/(?:帮我|请|能).{0,5}(?:搞一下|弄一下|处理一下|看一下|改一下|优化一下)/i.test(text)) {
    score += 0.4;
    questions.push('您希望具体达到什么效果？');
  }
  
  // 指代不明
  if (/(?:这个|那个|它|这|那)(?:文件|代码|页面|功能)?/i.test(text)) {
    score += 0.3;
    questions.push('您指的是哪个具体的文件或功能？');
  }
  
  // 未决选择
  if (/(?:用|选|采用).{0,10}(?:还是|或者|或)/i.test(text)) {
    score += 0.3;
    questions.push('您倾向于选择哪一个方案？');
  }
  
  // 缺少关键信息
  if (/(?:写|实现|做).{0,5}(?:个|一个)/i.test(text) && text.length < 50) {
    score += 0.2;
    questions.push('请提供更多细节要求');
  }
  
  return { score: Math.min(1, score), questions };
}

/** 复杂任务 */
function isComplexTask(text: string): boolean {
  const complexPatterns = [
    /(?:系统|架构|平台|框架)/i,
    /(?:多个|批量|自动化|定时)/i,
    /(?:集成|对接|迁移|重构)/i,
    /(?:设计|规划|方案)/i,
    /(?:模块|组件|服务|微服务)/i,
  ];
  return complexPatterns.some(p => p.test(text)) && text.length > 100;
}

/** 推断任务类型 */
function inferTaskType(text: string): QuickDiagnosisResult['taskType'] {
  if (/debug|错误|异常|bug|报错|失败/i.test(text)) return 'debug';
  if (/分析|评估|review|检查|优化/i.test(text)) return 'analysis';
  if (/写|实现|创建|开发|代码|函数|类/i.test(text)) return 'coding';
  return 'chat';
}
