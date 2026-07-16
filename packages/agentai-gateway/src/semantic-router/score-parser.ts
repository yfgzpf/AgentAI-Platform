/**
 * ScoreParser: 解析 LLM 返回的语义路由结果
 * 将 LLM 的 JSON 输出解析为结构化的路由决策
 */

export interface RoutingDecision {
  skillName: string;
  confidence: number;
  reason: string;
  method: 'llm' | 'cache' | 'fallback' | 'sanitized';
}

export class ScoreParser {
  /**
   * 从 LLM 响应中提取 JSON 并解析为 RoutingDecision
   */
  static parse(llmResponse: string, method: RoutingDecision['method'] = 'llm'): RoutingDecision {
    try {
      // 尝试提取 JSON 块（可能在 ```json ... ``` 中，也可能直接在文本中）
      const jsonStr = this.extractJson(llmResponse);
      if (!jsonStr) {
        // LLM 返回了非 JSON 内容，降级
        return { skillName: '', confidence: 0.0, reason: 'LLM 返回格式非 JSON', method };
      }

      const parsed = JSON.parse(jsonStr) as Record<string, any>;

      // 验证必需字段
      const skillName = (parsed.skill || '').toString().trim();
      const confidence = Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0));
      const reason = (parsed.reason || '无说明').toString();

      return { skillName, confidence, reason, method };
    } catch (e) {
      // JSON 解析失败，降级
      return {
        skillName: '',
        confidence: 0.0,
        reason: `LLM 返回解析失败: ${(e as Error).message}`,
        method,
      };
    }
  }

  /**
   * 从 LLM 的响应文本中提取 JSON 块
   * 支持 ```json ... ``` 包裹或直接 JSON 文本
   */
  static extractJson(text: string): string | null {
    // 先尝试提取代码块中的 JSON
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch[1]?.trim()) {
      return codeBlockMatch[1]!.trim();
    }

    // 尝试找到 JSON 对象的起始和结束
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        JSON.parse(jsonMatch[0]);
        return jsonMatch[0];
      } catch {
        // 不是有效的 JSON，继续
      }
    }

    return null;
  }

  /**
   * 判断路由是否成功（高置信度匹配）
   */
  static isSuccess(decision: RoutingDecision): boolean {
    return decision.confidence >= 0.75 && decision.skillName !== '';
  }

  /**
   * 判断是否需要 fallback
   */
  static needsFallback(decision: RoutingDecision): boolean {
    return !this.isSuccess(decision) || decision.method === 'fallback' || decision.method === 'sanitized';
  }
}
