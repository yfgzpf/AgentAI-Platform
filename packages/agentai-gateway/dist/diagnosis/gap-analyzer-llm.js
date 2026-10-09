/**
 * 缺口分析器 - LLM版本
 * 岐枢 | PulseFlow - 闻阶段
 *
 * 使用免费轻量模型分析信息缺口
 * 预算：100 token/任务（规范9.3）
 */
import { analyzeGapsByRules, generateClarificationQuestions } from './gap-analyzer.js';
/**
 * 使用免费轻量模型分析缺口
 *
 * @param message 用户消息
 * @param router LLM路由器
 * @returns 缺口分析结果
 */
export async function analyzeGapsWithLLM(message, router) {
    const prompt = `分析以下用户请求的信息缺口，输出JSON格式：

用户请求："${message.slice(0, 500)}"

请分析：
1. 是否有模糊的需求描述？
2. 是否缺少必要的上下文信息？
3. 是否有未明确的技术选择？
4. 范围是否清晰？

输出格式：
{
  "hasGaps": true/false,
  "gaps": [
    {
      "type": "missing_context|ambiguous_requirement|unclear_scope|technical_unknown",
      "description": "缺口描述",
      "severity": "low|medium|high"
    }
  ],
  "clarificationQuestions": ["问题1", "问题2"]
}

只输出JSON，不要其他内容。`;
    try {
        // 使用免费轻量模型（agentai/zhipu）
        const response = await router.chat({
            model: 'agentai', // 免费模型
            messages: [
                { role: 'system', content: '你是一个需求分析助手，专门识别信息缺口。' },
                { role: 'user', content: prompt },
            ],
            temperature: 0.3, // 低温度，稳定输出
            maxTokens: 200, // 限制输出长度（注意：使用 camelCase）
        });
        const content = response.content || '';
        const tokensUsed = response.usage?.totalTokens || 100;
        // 解析JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // 解析失败，返回无缺口
            return {
                hasGaps: false,
                gaps: [],
                clarificationQuestions: [],
                tokensUsed,
            };
        }
        const result = JSON.parse(jsonMatch[0]);
        return {
            hasGaps: result.hasGaps || false,
            gaps: result.gaps || [],
            clarificationQuestions: result.clarificationQuestions || [],
            tokensUsed,
        };
    }
    catch (err) {
        console.error(`[gap-analyzer] ❌ LLM分析失败: ${err.message}`);
        // 失败时降级为规则分析
        return analyzeGapsWithRules(message);
    }
}
/**
 * 规则降级分析（无成本）
 * 使用 gap-analyzer.ts 的完整模式库 (替代内联简化版)
 */
function analyzeGapsWithRules(message) {
    // 调用 gap-analyzer.ts 的完整规则模式库
    const detectedGaps = analyzeGapsByRules(message, 'general', 'medium');
    // 适配为 GapAnalysisResult 格式
    const gaps = detectedGaps.map(g => ({
        type: (g.type in { missing_context: 1, ambiguous_requirement: 1, unclear_scope: 1, technical_unknown: 1 }
            ? g.type
            : 'ambiguous_requirement'),
        description: g.description,
        severity: g.severity,
    }));
    // 使用 gap-analyzer.ts 的问题生成器
    const questions = generateClarificationQuestions(detectedGaps, 3);
    return {
        hasGaps: gaps.length > 0,
        gaps,
        clarificationQuestions: questions,
        tokensUsed: 0, // 规则分析无成本
    };
}
/**
 * 快速缺口检测（先规则后LLM）
 * 预算控制：如果规则能识别，就不调用LLM
 */
export async function analyzeGaps(message, router, options) {
    // 先用规则快速检测
    const ruleResult = analyzeGapsWithRules(message);
    // 如果规则已识别明显缺口，直接返回（节省token）
    if (ruleResult.hasGaps && ruleResult.gaps.some(g => g.severity === 'high')) {
        console.log(`[gap-analyzer] ✅ 规则识别缺口，跳过LLM`);
        return ruleResult;
    }
    // 如果需要LLM深度分析
    if (options?.useLLM !== false && router) {
        try {
            const llmResult = await analyzeGapsWithLLM(message, router);
            console.log(`[gap-analyzer] ✅ LLM分析完成 | tokens=${llmResult.tokensUsed}`);
            return llmResult;
        }
        catch (err) {
            console.warn(`[gap-analyzer] ⚠️ LLM失败，使用规则结果`);
            return ruleResult;
        }
    }
    return ruleResult;
}
