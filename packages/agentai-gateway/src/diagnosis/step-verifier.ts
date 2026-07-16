/**
 * 步骤验证器
 * ALTES | 岐黄 - 因证施治之"调方"
 *
 * 职责：
 * 1. 验证步骤执行结果
 * 2. 评估结果质量
 * 3. 决定是否需要调整方案
 *
 * @module diagnosis/step-verifier
 */

import {
  TreatmentStep,
  StepVerificationResult,
  DiagnosisContext,
} from '../types/diagnosis.js';

// ═══════════════════════════════════════════════════════════
// 主入口函数
// ═══════════════════════════════════════════════════════════

/**
 * 验证步骤执行结果
 *
 * 对应中医"调方"：
 * - 验证药效 → 检查结果是否符合预期
 * - 辨证调整 → 决定是否需要调整方案
 */
export async function verifyStep(
  step: TreatmentStep,
  result: any,
  context: DiagnosisContext
): Promise<StepVerificationResult> {
  // 1. 基础验证
  const basicCheck = performBasicCheck(result);
  if (!basicCheck.passed) {
    return {
      passed: false,
      score: 0,
      issues: basicCheck.issues,
      suggestion: '执行失败，请检查错误信息',
      needsRetry: true,
      needsPlanAdjustment: false,
    };
  }
  
  // 2. 内容验证
  const contentCheck = verifyContent(step, result);
  
  // 3. 质量评估
  const qualityScore = assessQuality(result);
  
  // 4. 综合评分
  const score = calculateScore(contentCheck, qualityScore);
  
  // 5. 决定后续行动
  const decision = makeDecision(score, contentCheck.issues);
  
  return {
    passed: decision.passed,
    score,
    issues: contentCheck.issues,
    suggestion: decision.suggestion,
    needsRetry: decision.needsRetry,
    needsPlanAdjustment: decision.needsPlanAdjustment,
  };
}

// ═══════════════════════════════════════════════════════════
// 基础验证
// ═══════════════════════════════════════════════════════════

interface BasicCheckResult {
  passed: boolean;
  issues: string[];
}

/**
 * 执行基础检查
 */
function performBasicCheck(result: any): BasicCheckResult {
  const issues: string[] = [];
  
  // 检查是否为空
  if (!result) {
    issues.push('执行结果为空');
    return { passed: false, issues };
  }
  
  // 检查是否有错误
  if (result.error || result.errors) {
    issues.push(`执行出错: ${result.error || result.errors}`);
    return { passed: false, issues };
  }
  
  // 检查是否有内容
  const content = extractContent(result);
  if (!content || content.length < 10) {
    issues.push('执行结果内容过少');
    return { passed: false, issues };
  }
  
  return { passed: true, issues };
}

// ═══════════════════════════════════════════════════════════
// 内容验证
// ═══════════════════════════════════════════════════════════

interface ContentCheckResult {
  passed: boolean;
  issues: string[];
  matches: string[];
}

/**
 * 验证内容是否符合预期
 */
function verifyContent(
  step: TreatmentStep,
  result: any
): ContentCheckResult {
  const issues: string[] = [];
  const matches: string[] = [];
  const content = extractContent(result);
  
  // 根据步骤类型验证
  if (step.description.includes('代码') || step.description.includes('coding')) {
    // 代码验证
    if (content.includes('function') || content.includes('class') || content.includes('const')) {
      matches.push('包含代码结构');
    } else {
      issues.push('未检测到代码结构');
    }
    
    if (content.includes('error') || content.includes('Error')) {
      issues.push('代码中包含错误信息');
    }
  }
  
  if (step.description.includes('测试') || step.description.includes('test')) {
    // 测试验证
    if (content.includes('test') || content.includes('describe') || content.includes('it(')) {
      matches.push('包含测试结构');
    } else {
      issues.push('未检测到测试代码');
    }
  }
  
  if (step.description.includes('文档') || step.description.includes('doc')) {
    // 文档验证
    if (content.length > 100) {
      matches.push('文档内容充足');
    } else {
      issues.push('文档内容过短');
    }
  }
  
  // 通用验证：检查是否包含预期关键词
  const expectedKeywords = extractKeywords(step.expectedOutput);
  for (const keyword of expectedKeywords) {
    if (content.toLowerCase().includes(keyword.toLowerCase())) {
      matches.push(`包含关键词: ${keyword}`);
    }
  }
  
  return {
    passed: issues.length === 0,
    issues,
    matches,
  };
}

// ═══════════════════════════════════════════════════════════
// 质量评估
// ═══════════════════════════════════════════════════════════

/**
 * 评估结果质量
 */
function assessQuality(result: any): number {
  const content = extractContent(result);
  let score = 0.5; // 基础分
  
  // 长度评分
  if (content.length > 500) score += 0.1;
  if (content.length > 1000) score += 0.1;
  if (content.length > 2000) score += 0.1;
  
  // 结构评分
  if (content.includes('\n')) score += 0.05; // 有换行，说明有结构
  if (/^#{1,6}\s/m.test(content)) score += 0.1; // 有 Markdown 标题
  if (/```[\s\S]*?```/.test(content)) score += 0.1; // 有代码块
  
  // 完整性评分
  if (!content.includes('TODO') && !content.includes('FIXME')) score += 0.1;
  if (!content.includes('...')) score += 0.05; // 没有省略号
  
  return Math.min(1, score);
}

// ═══════════════════════════════════════════════════════════
// 综合评分与决策
// ═══════════════════════════════════════════════════════════

interface Decision {
  passed: boolean;
  suggestion: string;
  needsRetry: boolean;
  needsPlanAdjustment: boolean;
}

/**
 * 计算综合评分
 */
function calculateScore(
  contentCheck: ContentCheckResult,
  qualityScore: number
): number {
  // 内容匹配度
  const matchRatio = contentCheck.matches.length / (contentCheck.matches.length + contentCheck.issues.length + 1);
  
  // 综合评分
  return matchRatio * 0.6 + qualityScore * 0.4;
}

/**
 * 做出决策
 */
function makeDecision(score: number, issues: string[]): Decision {
  // 优秀
  if (score >= 0.8) {
    return {
      passed: true,
      suggestion: '验证通过，继续下一步',
      needsRetry: false,
      needsPlanAdjustment: false,
    };
  }
  
  // 良好
  if (score >= 0.6) {
    return {
      passed: true,
      suggestion: '基本符合预期，有小问题可后续优化',
      needsRetry: false,
      needsPlanAdjustment: false,
    };
  }
  
  // 及格
  if (score >= 0.4) {
    return {
      passed: false,
      suggestion: `存在问题: ${issues.slice(0, 2).join(', ')}，建议重试`,
      needsRetry: true,
      needsPlanAdjustment: false,
    };
  }
  
  // 不及格
  return {
    passed: false,
    suggestion: `严重偏离预期: ${issues.slice(0, 2).join(', ')}，需要调整方案`,
    needsRetry: false,
    needsPlanAdjustment: true,
  };
}

// ═══════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════

/**
 * 提取内容
 */
function extractContent(result: any): string {
  if (typeof result === 'string') {
    return result;
  }
  
  if (result.content) {
    return typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  }
  
  if (result.message) {
    return typeof result.message === 'string' ? result.message : JSON.stringify(result.message);
  }
  
  if (result.text) {
    return result.text;
  }
  
  return JSON.stringify(result);
}

/**
 * 提取关键词
 */
function extractKeywords(text: string): string[] {
  // 提取关键名词和动词
  const words = text.split(/[\s,，.。;；!！?？]/);
  const keywords: string[] = [];
  
  for (const word of words) {
    if (word.length >= 2 && !isStopWord(word)) {
      keywords.push(word);
    }
  }
  
  return keywords.slice(0, 5); // 最多5个关键词
}

/**
 * 检查是否为停用词
 */
function isStopWord(word: string): boolean {
  const stopWords = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '这些', '那些', '这个', '那个', '之', '与', '及', '或', '但', '而', '如果', '因为', '所以', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'and', 'but', 'or', 'yet', 'so', 'if', 'because', 'although', 'though', 'while', 'where', 'when', 'that', 'which', 'who', 'whom', 'whose', 'what', 'whatever', 'whoever', 'whomever', 'this', 'these', 'those', 'such', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'we', 'us', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'i', 'me', 'my', 'mine', 'myself',
  ]);
  return stopWords.has(word.toLowerCase());
}

// ═══════════════════════════════════════════════════════════
// 批量验证
// ═══════════════════════════════════════════════════════════

/**
 * 批量验证多个步骤
 */
export async function verifySteps(
  steps: TreatmentStep[],
  results: any[],
  context: DiagnosisContext
): Promise<StepVerificationResult[]> {
  const verifications: StepVerificationResult[] = [];
  
  for (let i = 0; i < steps.length; i++) {
    const verification = await verifyStep(steps[i]!, results[i], context);
    verifications.push(verification);
    
    // 如果某一步失败，后续步骤标记为跳过
    if (!verification.passed && verification.needsPlanAdjustment) {
      for (let j = i + 1; j < steps.length; j++) {
        verifications.push({
          passed: false,
          score: 0,
          issues: ['前一步失败，此步骤跳过'],
          suggestion: '需要调整方案后重新执行',
          needsRetry: false,
          needsPlanAdjustment: true,
        });
      }
      break;
    }
  }
  
  return verifications;
}

// ═══════════════════════════════════════════════════════════
// 导出测试函数
// ═══════════════════════════════════════════════════════════

export function testStepVerifier(): void {
  const step: TreatmentStep = {
    id: 'step-1',
    order: 1,
    description: '编写登录函数',
    expectedOutput: '可运行的登录代码',
    verificationMethod: '检查代码是否能编译',
    estimatedTokens: 2000,
    parallelizable: false,
  };
  
  const context = { sessionId: 'test', userId: 'test' };
  
  // 测试通过的情况
  const goodResult = {
    content: `
function login(username, password) {
  // 验证输入
  if (!username || !password) {
    return { success: false, error: '用户名和密码不能为空' };
  }
  
  // 查询用户
  const user = db.findUser(username);
  if (!user) {
    return { success: false, error: '用户不存在' };
  }
  
  // 验证密码
  if (!verifyPassword(password, user.passwordHash)) {
    return { success: false, error: '密码错误' };
  }
  
  // 生成 token
  const token = generateToken(user.id);
  return { success: true, token };
}
    `,
  };
  
  // 测试失败的情况
  const badResult = {
    content: '我尝试写了代码但是出错了...',
  };
  
  verifyStep(step, goodResult, context).then(result => {
    console.log('通过案例:', result);
  });
  
  verifyStep(step, badResult, context).then(result => {
    console.log('失败案例:', result);
  });
}
